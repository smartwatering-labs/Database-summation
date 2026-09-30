"""External-only geocoding. No location catalog, address cache or disk persistence."""
import math
import threading
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import json

from .validation import ValidationError, text

class GeocodingService:
    def __init__(self, enabled=True, base_url="https://nominatim.openstreetmap.org/search",
                 user_agent="WateringPlatform/1.0", timeout=8, log=lambda *args: None):
        self.enabled, self.base_url, self.user_agent = enabled, base_url, user_agent
        self.timeout, self.log = timeout, log
        self.lock = threading.Lock()
        self.last_request = -1.0

    def resolve(self, raw):
        if not isinstance(raw, dict):
            raise ValidationError("请提交地点搜索条件", "location")
        country = text(raw.get("country"), "country", 80)
        query = text(raw.get("query"), "query", 200)
        if not self.enabled:
            raise ValidationError("外部地图服务未启用，请联系管理员开启后重试", "location", 503)
        # Explicit searches only, never per-keystroke autocomplete on the public API.
        with self.lock:
            if time.monotonic() - self.last_request < 1:
                raise ValidationError("地点查询较频繁，请等待一秒后重试", "location", 429)
            self.last_request = time.monotonic()
        params = urlencode({"q": query + ", " + country, "format": "geocodejson",
                            "addressdetails": 1, "extratags": 1, "limit": 8,
                            "accept-language": "zh-CN,en", "layer": "address"})
        try:
            request = Request(self.base_url + "?" + params, headers={"User-Agent": self.user_agent, "Accept": "application/json"})
            with urlopen(request, timeout=self.timeout) as response:
                data = json.loads(response.read(256000))
            if not isinstance(data, dict) or not isinstance(data.get("features"), list):
                raise ValueError("invalid geocoder response")
            candidates = [self._candidate(row) for row in data["features"]]
            candidates = [row for row in candidates if row]
            if not candidates:
                raise ValidationError("地图未找到该地点，请补充当地名称、区县或邮政编码后重试", "location", 404)
            return {"status": "ok", "provider": "OpenStreetMap Nominatim", "candidates": candidates,
                    "storage": "page-only", "attribution": "© OpenStreetMap contributors · ODbL",
                    "notice": "请选择区县或更细地点；城市、省或国家级结果需继续细化"}
        except ValidationError:
            raise
        except HTTPError as error:
            self.log("warning", "geocoding_unavailable", f"地图 API 返回 HTTP {error.code}")
            message = "地图服务拒绝访问，请管理员检查服务地址、请求标识与配额" if error.code in (401, 403) else "地图服务暂时不可用，请稍后重试"
            raise ValidationError(message, "location", 503) from error
        except Exception as error:
            self.log("warning", "geocoding_unavailable", "地图 API 连接失败或数据格式无效")
            raise ValidationError("无法取得外部地图数据，请检查网络后重试；未使用本地地点替代", "location", 503) from error

    @staticmethod
    def _candidate(feature):
        try:
            geometry = feature["geometry"]
            if geometry["type"] != "Point":
                return None
            longitude, latitude = geometry["coordinates"][:2]
            if any(isinstance(x, bool) or not isinstance(x, (float, int)) or not math.isfinite(x) for x in (latitude, longitude)):
                return None
            if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
                return None
            g = feature["properties"]["geocoding"]
            kind = str(g.get("type", "unknown"))
            name, country = str(g.get("name", "")), str(g.get("country", ""))
            admin = g.get("admin") or {}
            if not isinstance(admin, dict):
                admin = {}
            extra = g.get("extra") or {}
            try:
                own_level = int(extra.get("admin_level", 0))
            except (TypeError, ValueError):
                own_level = 0
            boundary = g.get("osm_key") == "boundary" and g.get("osm_value") == "administrative"
            country_code = str(g.get("country_code", "")).lower()
            # Chinese counties/districts can be classified as "city" by Nominatim.
            # Use the object's own boundary level, never its parent's level6 name.
            local_boundary = boundary and kind not in ("country", "state") and (
                (country_code == "cn" and 6 <= own_level <= 11) or
                (country_code != "cn" and 8 <= own_level <= 11))
            district = g.get("district") or (name if kind in ("district", "county") else "") or g.get("county") or ""
            # GeocodeJSON's normalized address category is used instead of assuming
            # one OSM admin_level means the same thing in every country.
            precise = local_boundary or kind in ("district", "county") or (
                kind in ("locality", "street", "house") and bool(district))
            if local_boundary:
                district = name
            if not country or not name:
                return None
            return {"id": f"osm:{g.get('osm_type', 'place')}:{g.get('osm_id', g.get('place_id', ''))}",
                    "name": name[:200], "displayName": str(g.get("label", name))[:200],
                    "country": country[:80], "countryCode": str(g.get("country_code", ""))[:2],
                    "state": str(g.get("state", ""))[:100], "city": str(g.get("city", ""))[:100],
                    "district": str(district)[:100], "admin": {str(k)[:20]: str(v)[:100] for k, v in list(admin.items())[:12]},
                    "latitude": latitude, "longitude": longitude, "addressType": kind, "adminLevel": own_level or None,
                    "selectable": precise, "precision": "区县或更细" if precise else "需要更具体地点",
                    "provider": "OpenStreetMap Nominatim"}
        except (KeyError, TypeError, ValueError, IndexError):
            return None
