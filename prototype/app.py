"""Flask application: temporary configurations, knowledge libraries, system monitoring."""
import hmac
import json
import os
import re
import secrets
import shutil
import sqlite3
import subprocess
import threading
import time
from collections import Counter
from contextlib import contextmanager
from datetime import date, datetime, timezone
from functools import wraps
from pathlib import Path

from flask import Flask, g, jsonify, make_response, render_template, request, send_file
from werkzeug.exceptions import HTTPException
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

from engine.environment import EnvironmentService
from engine.geocoding import GeocodingService
from engine.location_catalog import LocationCatalog
from engine.plant_library import SCHEMA_VERSION, empty_evidence, empty_review, empty_field_validation, empty_suitability, upgrade_plant_document
from engine.rules import derive_parameters, validate_scenario, formula_catalog
from engine.validation import ValidationError, number, text, validate_config

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent


def create_app(test_config=None):
    app = Flask(__name__)
    app.json.ensure_ascii = False
    app.config.update(
        MAX_CONTENT_LENGTH=64 * 1024,
        LOCATION_TOKEN_SECRET=os.getenv("LOCATION_TOKEN_SECRET") or secrets.token_hex(32),
        DATABASE=str(ROOT / "instance" / "system.sqlite3"),
        APP_ENV=os.getenv("APP_ENV", "development"),
        ADMIN_TOKEN=os.getenv("ADMIN_TOKEN", "6767"),
        WEATHER_ENABLED=os.getenv("WEATHER_ENABLED", "1") == "1",
        GEOCODING_ENABLED=os.getenv("GEOCODING_ENABLED", "1") == "1",
        GEOCODING_BASE_URL=os.getenv("GEOCODING_BASE_URL", "https://nominatim.openstreetmap.org/search"),
        GEOCODING_USER_AGENT=os.getenv("GEOCODING_USER_AGENT", "WateringPlatform/1.0"),
        ADMIN_HOSTS=tuple(host.strip().lower() for host in os.getenv("ADMIN_HOSTS", "admin.localhost").split(",") if host.strip()),
        GIT_ROOT=Path(os.getenv("GIT_ROOT", str(PROJECT_ROOT))).resolve(),
        DEMO_ENABLED=os.getenv("DEMO_ENABLED", "1") == "1",
    )
    if test_config:
        app.config.update(test_config)
    if app.config["APP_ENV"] == "production" and (app.config["ADMIN_TOKEN"] == "6767" or len(app.config["ADMIN_TOKEN"]) < 16):
        raise RuntimeError("生产环境必须设置至少 16 字符的 ADMIN_TOKEN，不能使用开发密钥")
    if app.config["APP_ENV"] == "production" and (not app.config["ADMIN_HOSTS"] or "admin.localhost" in app.config["ADMIN_HOSTS"]):
        raise RuntimeError("生产环境必须设置 ADMIN_HOSTS 为实际管理子域名")

    Path(app.config["DATABASE"]).parent.mkdir(parents=True, exist_ok=True)

    @contextmanager
    def database():
        conn = sqlite3.connect(app.config["DATABASE"], timeout=5)
        conn.row_factory = sqlite3.Row
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    with database() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS library_documents (
          name TEXT PRIMARY KEY,
          revision INTEGER NOT NULL,
          data TEXT NOT NULL,
          source TEXT NOT NULL,
          updatedAt TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS system_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, createdAt TEXT NOT NULL, level TEXT NOT NULL, event TEXT NOT NULL, message TEXT NOT NULL);
        """)
        # Retire the location catalog without touching plant or algorithm data.
        db.execute("PRAGMA secure_delete = ON")
        db.execute("DELETE FROM library_documents WHERE name = 'locations'")
        legacy = db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='environment_weight_library'").fetchone()
        if legacy:
            for row in db.execute("SELECT id, data FROM environment_weight_library").fetchall():
                value = json.loads(row["data"])
                if isinstance(value, dict) and "latitude" in value and "longitude" in value:
                    db.execute("DELETE FROM environment_weight_library WHERE id=?", (row["id"],))
        for name in ("plants", "environment_weights"):
            existing = db.execute("SELECT 1 FROM library_documents WHERE name = ?", (name,)).fetchone()
            if existing is None:
                seed = json.loads((ROOT / "knowledge_base" / f"{name}.json").read_text(encoding="utf-8"))
                if name == "plants":
                    seed, _ = upgrade_plant_document(seed)
                db.execute("INSERT INTO library_documents VALUES (?,?,?,?,?)", (name, 1, json.dumps(seed, ensure_ascii=False), "seed", datetime.now(timezone.utc).isoformat()))
        plant_row = db.execute("SELECT revision, data FROM library_documents WHERE name='plants'").fetchone()
        upgraded, changed = upgrade_plant_document(json.loads(plant_row["data"]))
        if changed:
            db.execute("UPDATE library_documents SET revision=?, data=?, source=?, updatedAt=? WHERE name='plants'",
                       (plant_row["revision"] + 1, json.dumps(upgraded, ensure_ascii=False), "schema-migration", datetime.now(timezone.utc).isoformat()))

    library_lock = threading.RLock()

    def library_document(name):
        with database() as db:
            row = db.execute("SELECT revision, data, source, updatedAt FROM library_documents WHERE name = ?", (name,)).fetchone()
        if row is None:
            raise RuntimeError(f"知识库不存在：{name}")
        data = json.loads(row["data"])
        data["version"] = f"db.{row['revision']}"
        data["revision"] = row["revision"]
        data["source"] = row["source"]
        data["updatedAt"] = row["updatedAt"]
        return data

    def current_libraries():
        with library_lock:
            return {name: library_document(name) for name in ("plants", "environment_weights")}

    def update_library(name, data, expected_revision, source):
        with library_lock, database() as db:
            row = db.execute("SELECT revision FROM library_documents WHERE name = ?", (name,)).fetchone()
            if row is None:
                raise ValidationError("知识库不存在", "library", 404)
            if expected_revision != row["revision"]:
                raise ValidationError("知识库已被其他管理员更新，请刷新后再保存", "expectedRevision", 409)
            revision = row["revision"] + 1
            updated_at = datetime.now(timezone.utc).isoformat()
            db.execute("UPDATE library_documents SET revision=?, data=?, source=?, updatedAt=? WHERE name=?",
                       (revision, json.dumps(data, ensure_ascii=False), source, updated_at, name))
        return library_document(name)

    def log(level, event, message):
        with database() as db:
            db.execute("INSERT INTO system_logs (createdAt,level,event,message) VALUES (?,?,?,?)",
                       (datetime.now(timezone.utc).isoformat(), level, event, message))
            db.execute("DELETE FROM system_logs WHERE id NOT IN (SELECT id FROM system_logs ORDER BY id DESC LIMIT 500)")

    environment = EnvironmentService(app.config["WEATHER_ENABLED"], log=log)
    geocoding = GeocodingService(app.config["GEOCODING_ENABLED"], app.config["GEOCODING_BASE_URL"], app.config["GEOCODING_USER_AGENT"], log=log)
    app.extensions["environment"] = environment
    app.extensions["geocoding"] = geocoding
    catalog = LocationCatalog(app.config["GEOCODING_ENABLED"])
    app.extensions["location_catalog"] = catalog
    started = time.monotonic()
    counts = Counter()
    counters_lock = threading.Lock()
    log("info", "startup", "服务启动，知识库就绪；不保存用户配置或设备历史")

    @app.before_request
    def begin_request():
        g.started = time.monotonic()
        # Precompressed public graphics only. Configurations and API responses
        # keep their existing no-store policy; no compression work runs per request.
        if request.endpoint == "static" and request.method in ("GET", "HEAD") and request.accept_encodings["gzip"] > 0:
            static_root = Path(app.static_folder).resolve()
            source = (static_root / request.view_args["filename"]).resolve()
            packed = source.with_name(source.name + ".gz")
            if source.is_relative_to(static_root) and source.suffix in (".glb", ".js") and source.is_file() and packed.is_file() and packed.stat().st_mtime_ns >= source.stat().st_mtime_ns:
                response = send_file(packed, mimetype="text/javascript" if source.suffix == ".js" else "model/gltf-binary", conditional=True, max_age=0)
                response.headers["Content-Encoding"] = "gzip"
                return response
        # Same-origin browser API. File uploads use application/json; no CORS.
        if request.method == "POST" and request.path.startswith("/api/"):
            if request.headers.get("Sec-Fetch-Site") == "cross-site":
                raise ValidationError("不接受跨站请求", status=403)
            if not request.is_json:
                raise ValidationError("请求必须使用 application/json")

    @app.after_request
    def finish_request(response):
        if request.endpoint == "static":
            response.vary.add("Accept-Encoding")
        if request.path.startswith("/api/"):
            elapsed = round((time.monotonic() - g.started) * 1000, 1)
            response.headers["Server-Timing"] = f"app;dur={elapsed}"
            response.headers["Cache-Control"] = "no-store"
            with counters_lock:
                counts["requests"] += 1
                counts["errors"] += int(response.status_code >= 400)
                counts["totalMs"] += elapsed
                if request.endpoint == "generate" and response.status_code == 200:
                    counts["generated"] += 1
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["Permissions-Policy"] = "bluetooth=(self)"
        response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
        if request.endpoint == "index":
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.errorhandler(ValidationError)
    def validation_error(error):
        return jsonify(status="error", message=str(error), field=error.field), error.status

    @app.errorhandler(HTTPException)
    def http_error(error):
        messages = {400: "JSON 格式无效", 404: "请求的资源不存在", 405: "请求方法不支持", 413: "文件过大，最多支持 64 KB"}
        return jsonify(status="error", message=messages.get(error.code, "请求失败")), error.code

    @app.errorhandler(Exception)
    def internal_error(error):
        log("error", "internal_error", "服务内部错误；请检查服务状态")
        return jsonify(status="error", message="服务暂时无法处理请求，请稍后重试"), 500

    def json_object():
        data = request.get_json()
        if not isinstance(data, dict):
            raise ValidationError("JSON 顶层必须为对象")
        return data

    def admin_required(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            if request.host.split(":", 1)[0].lower() not in app.config["ADMIN_HOSTS"]:
                return jsonify(status="error", message="管理员接口仅允许通过管理端域名访问"), 404
            supplied = request.headers.get("Authorization", "")
            expected = "Bearer " + app.config["ADMIN_TOKEN"]
            if not hmac.compare_digest(supplied.encode(), expected.encode()):
                return jsonify(status="error", message="管理员密钥不正确或未提供"), 403
            return view(*args, **kwargs)
        return wrapped

    def validate_plant_record(value):
        if not isinstance(value, dict):
            raise ValidationError("植物配置必须是对象", "plant")
        plant_id = text(value.get("id"), "id", 48)
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,47}", plant_id):
            raise ValidationError("id 只能使用小写字母、数字和连字符", "id")
        tags = value.get("tags", [])
        if not isinstance(tags, list) or len(tags) > 8 or any(not isinstance(tag, str) or not tag.strip() or len(tag.strip()) > 30 for tag in tags):
            raise ValidationError("tags 必须是最多 8 项的短文本列表", "tags")
        cleaned = {"id": plant_id, "name": text(value.get("name"), "name", 80), "category": text(value.get("category"), "category", 60),
                   "dailyMl": number(value.get("dailyMl"), "dailyMl", 1, 20000), "threshold": number(value.get("threshold"), "threshold", 20, 90),
                   "soilWeight": number(value.get("soilWeight"), "soilWeight", 0, 1), "tempWeight": number(value.get("tempWeight"), "tempWeight", 0, 1),
                   "airWeight": number(value.get("airWeight"), "airWeight", 0, 1), "tags": [tag.strip() for tag in tags]}
        if not 0.98 <= cleaned["soilWeight"] + cleaned["tempWeight"] + cleaned["airWeight"] <= 1.02:
            raise ValidationError("三项植物权重之和必须为 1", "plant")
        def fields(name, defaults, limits):
            raw = value.get(name, defaults)
            if not isinstance(raw, dict):
                raise ValidationError(f"{name} 必须是对象", name)
            if set(raw) - set(defaults):
                raise ValidationError(f"{name} 包含未知字段", name)
            return {key: text(raw.get(key, default), f"{name}.{key}", limits.get(key, 200), required=False)
                    for key, default in defaults.items()}
        evidence = fields("evidence", empty_evidence(), {"title": 160, "reference": 300, "referenceDate": 10,
                                                           "conditions": 300, "cultivar": 100, "growthStage": 100,
                                                           "medium": 100, "numericBasis": 500})
        review = fields("review", empty_review(), {"status": 30, "reviewedAt": 10, "note": 300})
        field_validation = fields("fieldValidation", empty_field_validation(),
                                  {"status": 30, "testedAt": 10, "conditions": 300, "summary": 500})
        for label, date_value in (("referenceDate", evidence["referenceDate"]), ("reviewedAt", review["reviewedAt"]),
                             ("testedAt", field_validation["testedAt"])):
            if date_value:
                try:
                    if date.fromisoformat(date_value).isoformat() != date_value:
                        raise ValueError()
                except ValueError:
                    raise ValidationError(f"{label} 应为 YYYY-MM-DD 日期", label)
        if review["status"] not in ("engineering", "reviewed", "uncertain", "retired"):
            raise ValidationError("资料审核状态无效", "review.status")
        if field_validation["status"] not in ("untested", "calibrated", "trial"):
            raise ValidationError("实物验证状态无效", "fieldValidation.status")
        if review["status"] == "reviewed" and not (evidence["title"] and evidence["reference"] and review["reviewedAt"]):
            raise ValidationError("资料已核对时须填写来源标题、引用与核对日期", "review")
        if field_validation["status"] != "untested" and not (field_validation["testedAt"] and field_validation["summary"]):
            raise ValidationError("实物验证须填写日期和结果摘要", "fieldValidation")
        suitability = value.get("suitability", empty_suitability())
        if not isinstance(suitability, dict) or set(suitability) - set(empty_suitability()):
            raise ValidationError("适配范围格式无效", "suitability")
        suitability = {**empty_suitability(), **suitability}
        if suitability["context"] not in ("outdoor", "indoor", "greenhouse"):
            raise ValidationError("适配场景无效", "suitability.context")
        for lower_key, upper_key, low, high in (("temperatureMinC", "temperatureMaxC", -40, 70),
                                                ("humidityMinPct", "humidityMaxPct", 0, 100)):
            lower, upper = suitability[lower_key], suitability[upper_key]
            if (lower is None) != (upper is None):
                raise ValidationError("适配范围须同时填写上下限", "suitability")
            if lower is not None:
                number(lower, "适配范围下限", low, high)
                number(upper, "适配范围上限", low, high)
                if lower >= upper:
                    raise ValidationError("适配范围上限须高于下限", "suitability")
                if review["status"] == "engineering":
                    raise ValidationError("适配范围须先完成资料审核", "suitability")
        cleaned.update(evidence=evidence, review=review, fieldValidation=field_validation, suitability=suitability)
        return cleaned

    def git_state():
        root = app.config["GIT_ROOT"]
        binary = shutil.which("git")
        if not binary or not (root / ".git").exists():
            return {"available": False, "root": str(root), "reason": "未找到可用 Git 仓库或 git 命令"}
        def run(*args):
            return subprocess.run([binary, "-C", str(root), *args], text=True, capture_output=True, timeout=8, check=False)
        head, status = run("rev-parse", "--short", "HEAD"), run("status", "--short")
        if head.returncode or status.returncode:
            return {"available": False, "root": str(root), "reason": "Git 仓库状态无法读取"}
        return {"available": True, "root": str(root), "head": head.stdout.strip(),
                "changes": [line[:300] for line in status.stdout.splitlines()[:100]]}

    @app.get("/")
    def index():
        if request.host.split(":", 1)[0].lower() in app.config["ADMIN_HOSTS"]:
            return render_template("admin.html")
        return render_template("index.html")

    @app.get("/offline-kit")
    def offline_kit():
        return render_template("offline-kit.html")

    @app.get("/offline-sw.js")
    def offline_sw():
        return app.send_static_file("offline-sw.js")

    @app.get("/api/settings")
    def settings():
        return jsonify(status="ok", protocol="SWS-BLE", protocolVersion="1.0", configVersion="1.0",
                       development=app.config["APP_ENV"] != "production", demoEnabled=app.config["DEMO_ENABLED"],
                       builtinFlowMlSec=library_document("environment_weights")["flowRateMlSec"],
                       supportedConfigVersions=["1.0", "2.0"],
                       ble={"serviceUuid": os.getenv("BLE_SERVICE_UUID", "2d26a7cc-1d45-4eae-9280-2a97346fd001"),
                            "writeUuid": os.getenv("BLE_WRITE_UUID", "2d26a7cc-1d45-4eae-9280-2a97346fd002"),
                            "notifyUuid": os.getenv("BLE_NOTIFY_UUID", "2d26a7cc-1d45-4eae-9280-2a97346fd003"),
                            "profile": "sws-json-v1", "verified": False, "firmwareVersion": "3.6.0"})

    @app.get("/api/plants")
    def plant_library():
        document = library_document("plants")
        document["items"] = [item for item in document["items"] if item.get("review", {}).get("status") != "retired"]
        return jsonify(status="ok", **document)

    location_signer = URLSafeTimedSerializer(app.config["LOCATION_TOKEN_SECRET"], salt="external-location-v2")
    catalog_signer = URLSafeTimedSerializer(app.config["LOCATION_TOKEN_SECRET"], salt="location-catalog-v1")

    def catalog_token(raw, key):
        try:
            node = catalog_signer.loads(text(raw.get(key), key, 6000), max_age=3600)
        except BadSignature:
            raise ValidationError("地点列表已过期或无效，请重新加载国家列表", key, 409)
        return node

    def catalog_response(items):
        return jsonify(status="ok", storage="page-only", items=[dict(item, selectionToken=catalog_signer.dumps(item)) for item in items])

    @app.get("/api/locations/countries")
    def location_countries():
        return catalog_response(catalog.countries())

    @app.post("/api/locations/children")
    def location_children():
        return catalog_response(catalog.children(catalog_token(json_object(), "parentToken")))

    @app.post("/api/locations/select")
    def location_select():
        location = catalog.select(catalog_token(json_object(), "selectionToken"), geocoding)
        return jsonify(status="ok", location=dict(location, locationToken=location_signer.dumps(location)))

    def verified_location(data):
        token = text(data.get("locationToken"), "locationToken", 6000)
        try:
            location = location_signer.loads(token, max_age=3600)
        except (BadSignature, SignatureExpired):
            raise ValidationError("地点确认已过期或无效，请重新通过地图 API 查询", "locationToken", 409)
        if not isinstance(location, dict) or not location.get("selectable") or location.get("selectionLevel") != "city":
            raise ValidationError("请通过列表完成国家、省份和城市选择", "locationToken")
        return location

    @app.get("/api/locations")
    def location_library():
        return jsonify(status="ok", items=[], storage="external-only", provider="OpenStreetMap Nominatim")

    @app.post("/api/locations/resolve")
    def resolve_location():
        raise ValidationError("地点填写已改为国家、省份和城市联动列表，请刷新网页", "location", 410)

    @app.post("/api/environment")
    @app.post("/api/locations/environment")
    def environment_lookup():
        location = verified_location(json_object())
        return jsonify(status="ok", **environment.get_coordinates(location))

    @app.get("/api/weather")
    @app.get("/api/environment")
    def retired_environment_lookup():
        raise ValidationError("请先通过外部地图查询地点，再提交 locationToken 查询天气", "locationToken", 410)

    @app.post("/api/configurations/generate")
    def generate():
        libraries = current_libraries()
        plants = {row["id"]: row for row in libraries["plants"]["items"] if row.get("review", {}).get("status") != "retired"}
        data = json_object()
        location = verified_location(data)
        scene = validate_scenario(dict(data, customLocation=location), plants, libraries["environment_weights"]["flowRateMlSec"])
        environment_data = environment.get_coordinates(location)
        result = derive_parameters(scene, plants[scene["plantId"]], dict(location, name=location["displayName"]),
                                   environment_data, libraries["environment_weights"],
                                   "/".join(libraries[k]["version"] for k in ("plants", "environment_weights")))
        return jsonify(result)

    @app.post("/api/configurations/import")
    def import_configuration():
        data = json_object()
        config = validate_config(data.get("config", data), data.get("currentRevision"))
        return jsonify(status="ok", storage="temporary", config=config, params=config["params"],
                       warnings=["导入文件已通过网页参数校验；设备仍需再次验证型号、版本、认证与安全范围"])

    @app.post("/api/configurations/export")
    def export_configuration():
        data = json_object()
        config = validate_config(data.get("config", data))
        response = make_response(json.dumps(config, ensure_ascii=False, indent=2) + "\n")
        response.headers["Content-Type"] = "application/json; charset=utf-8"
        response.headers["Content-Disposition"] = f'attachment; filename="watering-config-r{config["revision"]}.json"'
        return response

    @app.get("/api/admin/health")
    @admin_required
    def health():
        with database() as db:
            db.execute("SELECT 1").fetchone()
        libraries = current_libraries()
        return jsonify(status="ok", database="ok", uptimeSeconds=round(time.monotonic() - started),
                       weatherEnabled=app.config["WEATHER_ENABLED"], storage="database-library-and-system-only",
                       libraryVersions={key: value["version"] for key, value in libraries.items()},
                       development=app.config["APP_ENV"] != "production")

    @app.get("/api/admin/formulas")
    @admin_required
    def formulas():
        weights = library_document("environment_weights")
        return jsonify(status="ok", weightsVersion=weights["version"], **formula_catalog(weights))

    @app.get("/api/admin/stats")
    @admin_required
    def stats():
        with counters_lock:
            snapshot = dict(counts)
        with database() as db:
            logs_count = db.execute("SELECT COUNT(*) FROM system_logs").fetchone()[0]
        libraries = current_libraries()
        return jsonify(status="ok", requests=snapshot.get("requests", 0), errors=snapshot.get("errors", 0),
                       generated=snapshot.get("generated", 0), averageMs=round(snapshot.get("totalMs", 0) / max(1, snapshot.get("requests", 0)), 1),
                       plants=len(libraries["plants"]["items"]), locations=0, locationSource="external-api", logs=logs_count, since="本次服务启动")

    @app.get("/api/admin/logs")
    @admin_required
    def logs():
        try:
            limit = max(1, min(100, int(request.args.get("limit", 50))))
        except ValueError:
            raise ValidationError("limit 必须为整数")
        with database() as db:
            rows = db.execute("SELECT * FROM system_logs ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return jsonify(status="ok", items=[dict(row) for row in rows])

    @app.get("/api/admin/libraries/plants")
    @admin_required
    def admin_plants():
        return jsonify(status="ok", **library_document("plants"))

    @app.put("/api/admin/libraries/plants")
    @admin_required
    def save_plant():
        data = json_object()
        expected_revision = number(data.get("expectedRevision"), "expectedRevision", 1, 2147483646, True)
        source = text(data.get("source", "admin"), "source", 100)
        plant = validate_plant_record(data.get("plant"))
        document = library_document("plants")
        items = list(document.get("items", []))
        index = next((i for i, item in enumerate(items) if item.get("id") == plant["id"]), None)
        if index is None:
            items.append(plant)
        else:
            items[index] = plant
        stored = {"schemaVersion": SCHEMA_VERSION, "provenance": document.get("provenance", "公共植物参数库"), "items": items}
        updated = update_library("plants", stored, expected_revision, source)
        log("info", "plant_library_updated", f"植物库已更新至 {updated['version']}；植物 ID：{plant['id']}")
        return jsonify(status="ok", **updated)

    @app.get("/api/admin/git/status")
    @admin_required
    def git_status():
        return jsonify(status="ok", git=git_state())

    @app.post("/api/admin/git/snapshot")
    @admin_required
    def git_snapshot():
        data = json_object()
        message = text(data.get("message", "更新植物库快照"), "message", 120)
        status = git_state()
        if not status["available"]:
            raise ValidationError(status["reason"], "git", 409)
        document = library_document("plants")
        root = app.config["GIT_ROOT"]
        snapshot_dir = ROOT / "library_snapshots"
        snapshot_dir.mkdir(exist_ok=True)
        snapshot = snapshot_dir / f"plants-r{document['revision']}.json"
        snapshot.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        try:
            relative = snapshot.relative_to(root)
        except ValueError:
            raise ValidationError("GIT_ROOT 必须包含 prototype 目录", "git", 409)
        binary = shutil.which("git")
        add = subprocess.run([binary, "-C", str(root), "add", "--", str(relative)], text=True, capture_output=True, timeout=8, check=False)
        commit = subprocess.run([binary, "-C", str(root), "commit", "-m", message, "--", str(relative)], text=True, capture_output=True, timeout=12, check=False) if add.returncode == 0 else add
        if commit.returncode:
            raise ValidationError("Git 快照文件已生成，但提交失败；请检查仓库状态和 Git 用户身份", "git", 409)
        log("info", "plant_library_snapshot", f"已提交植物库 Git 快照 {snapshot.name}")
        return jsonify(status="ok", snapshot=str(relative).replace("\\", "/"), git=git_state())

    return app


if __name__ == "__main__":
    from waitress import serve
    host, port = os.getenv("HOST", "127.0.0.1"), int(os.getenv("PORT", "5000"))
    # admin.localhost resolves to ::1 in common Windows browsers. Bind both
    # loopbacks in local mode so the public and management local URLs work.
    if host == "127.0.0.1":
        print(f"浇水平台运行于 http://127.0.0.1:{port}；管理端 http://admin.localhost:{port}（Ctrl+C 停止）", flush=True)
        serve(create_app(), listen=f"127.0.0.1:{port} [::1]:{port}", threads=8)
    else:
        print(f"浇水平台运行于 http://{host}:{port}（Ctrl+C 停止）", flush=True)
        serve(create_app(), host=host, port=port, threads=8)
