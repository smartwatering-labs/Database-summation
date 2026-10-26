"""Transparent engineering heuristics; all actuator limits still require firmware validation."""
from datetime import datetime, timezone, timedelta
from .validation import ValidationError, number, text, validate_config


PULSE_ON_MS, PULSE_OFF_MS, UNATTENDED_OFFSET = 3000, 25000, 3


def clamp(value, low, high):
    return max(low, min(high, value))


def season_for_latitude(latitude, month=None):
    month = month or datetime.now(timezone.utc).month
    northern = latitude >= 0
    seasons = ("winter", "spring", "summer", "autumn") if northern else ("summer", "autumn", "winter", "spring")
    return seasons[((month % 12) // 3)]


def validate_scenario(data, plants, builtin_flow=22):
    if not isinstance(data, dict):
        raise ValidationError("请提交场景对象")
    if not isinstance(data.get("plantId"), str) or data["plantId"] not in plants:
        raise ValidationError("请选择知识库中的植物", "plantId")
    # Only a server-verified external result is passed in by the API.
    custom = data.get("customLocation")
    if not isinstance(custom, dict) or not custom.get("selectable") or custom.get("selectionLevel") != "city":
        raise ValidationError("请先通过外部列表选择城市或直辖市", "locationToken")
    data = dict(data, season=season_for_latitude(custom["latitude"]))
    for key, options in (("cultivation", ("pot", "ground")), ("light", ("shade", "partial", "full")),
                         ("siteType", ("outdoor", "indoor", "greenhouse")),
                         ("season", ("spring", "summer", "autumn", "winter"))):
        if data.get(key, "outdoor" if key == "siteType" else None) not in options:
            raise ValidationError("请选择有效选项", key)
    cleaned = {key: data[key] for key in ("plantId", "cultivation", "light", "season")}
    cleaned["siteType"] = data.get("siteType", "outdoor")
    cleaned["unattended"] = True
    cleaned["customLocation"] = custom
    cleaned["locationId"] = custom["id"]
    variant = data.get("supplyVariant", "builtin")
    if variant not in ("builtin", "valve"):
        raise ValidationError("请选择自带水泵或电磁阀控制用户水泵", "supplyVariant")
    cleaned["supplyVariant"] = variant
    cleaned["potLiters"] = number(data.get("potLiters", 10), "potLiters", 0.5, 200)
    cleaned["reservoirLiters"] = number(data.get("reservoirLiters"), "reservoirLiters", 0.5, 1000)
    cleaned["flowRateMlSec"] = number(builtin_flow, "固定水泵流量", 1, 200) if variant == "builtin" else number(data.get("flowRateMlSec"), "flowRateMlSec", 1, 200)
    cleaned["currentRevision"] = number(data.get("currentRevision", 0), "currentRevision", 0, 2147483646, True)
    if data.get("configVersion", "1.0") not in ("1.0", "2.0"):
        raise ValidationError("配置格式版本无效", "configVersion")
    cleaned["configVersion"] = data.get("configVersion", "1.0")
    if cleaned["configVersion"] == "2.0":
        target = text(data.get("targetDeviceId"), "targetDeviceId", 64)
        if not all(ch.isascii() and (ch.isalnum() or ch in "-_") for ch in target):
            raise ValidationError("目标设备 ID 格式无效", "targetDeviceId")
        cleaned["targetDeviceId"] = target
    report = data.get("deviceObservation")
    if report is not None:
        if not isinstance(report, dict) or cleaned["configVersion"] != "2.0" or report.get("deviceId") != cleaned["targetDeviceId"]:
            raise ValidationError("设备实测摘要必须与当前 2.0 配置目标一致", "deviceObservation")
        if report.get("complete") is not True or report.get("timeQuality") != "trusted":
            raise ValidationError("设备实测摘要需要完成准备期和可信时间", "deviceObservation")
        valid = number(report.get("validSamples"), "有效样本数", 10, 100000, True)
        total = number(report.get("totalSamples"), "总样本数", valid, 100000, True)
        if valid / total < .8:
            raise ValidationError("准备期有效样本比例低于 80%", "deviceObservation")
        number(report.get("durationSeconds"), "准备期时长", 600, 86400, True)
        revision = number(report.get("configRevision"), "实测配置版本", 0, 2147483646, True)
        if revision != cleaned["currentRevision"]:
            raise ValidationError("设备实测配置版本已变化，请重新准备", "deviceObservation")
        observed = number(report.get("finishedAt"), "实测完成时间", 1700000000, 4102444800, True)
        age = datetime.now(timezone.utc).timestamp() - observed
        if age < -300 or age > 3600:
            raise ValidationError("设备实测摘要需在一小时内完成", "deviceObservation")
        cleaned["deviceObservation"] = {
            "deviceId": report["deviceId"], "temperatureC": number(report.get("temperatureC"), "实测温度", -20, 60),
            "humidityPct": number(report.get("humidityPct"), "实测空气湿度", 0, 100),
            "finishedAt": observed, "validSamples": valid, "totalSamples": total,
            "configRevision": revision, "source": "browser-forwarded-device-summary"}
    observation = data.get("onsiteObservation")
    if observation is not None:
        if not isinstance(observation, dict):
            raise ValidationError("现场测量必须是对象", "onsiteObservation")
        temperature = number(observation.get("temperatureC"), "现场温度", -20, 60)
        humidity = number(observation.get("humidityPct"), "现场空气湿度", 0, 100)
        observed_at = text(observation.get("observedAt"), "现场测量时间", 40)
        try:
            measured = datetime.fromisoformat(observed_at.replace("Z", "+00:00"))
            if measured.tzinfo is None:
                raise ValueError("timezone required")
            measured = measured.astimezone(timezone.utc)
        except ValueError:
            raise ValidationError("现场测量时间需包含时区", "onsiteObservation.observedAt")
        if measured > datetime.now(timezone.utc) + timedelta(minutes=5):
            raise ValidationError("现场测量时间不能晚于当前时间", "onsiteObservation.observedAt")
        cleaned["onsiteObservation"] = {"temperatureC": temperature, "humidityPct": humidity,
                                         "observedAt": measured.isoformat(), "source": "user-manual"}
    return cleaned


def derive_parameters(scene, plant, location, environment, weights, versions):
    measured = scene.get("deviceObservation")
    effective_environment = measured or environment
    light = weights["light"][scene["light"]]
    cultivation = weights["cultivation"][scene["cultivation"]]
    size = clamp((scene["potLiters"] / 10) ** 0.55, 0.4, 2.5) if scene["cultivation"] == "pot" else 1
    temperature = clamp(1 + (effective_environment["temperatureC"] - 22) * 0.025, 0.65, 1.5)
    humidity = clamp(1 + (60 - effective_environment["humidityPct"]) * 0.004, 0.8, 1.25)
    # Precipitation does not suppress watering from a forecast alone. Firmware's rain
    # veto and measured soil conditions remain authoritative.
    daily = round(clamp(plant["dailyMl"] * light * cultivation * size * temperature * humidity, 25, 2500))
    raw = [plant["soilWeight"], plant["tempWeight"] * temperature, plant["airWeight"] * humidity]
    normalized = [round(x / sum(raw), 4) for x in raw]
    normalized[-1] = round(1 - sum(normalized[:-1]), 4)
    threshold = round(clamp(plant["threshold"] - (light - 1) * 8 + UNATTENDED_OFFSET, 20, 90), 1)
    seasonal_days = weights["season"][scene["season"]]
    pulse_on, pulse_off = PULSE_ON_MS, PULSE_OFF_MS
    desired_round = daily * seasonal_days
    pulses = int(clamp(round(desired_round / (scene["flowRateMlSec"] * pulse_on / 1000)), 1, 12))
    round_ml = round(pulses * pulse_on / 1000 * scene["flowRateMlSec"], 1)
    now = datetime.now(timezone.utc)
    source = "device-summary+api" if measured else environment["source"]
    config = {
        "revision": scene["currentRevision"] + 1, "timestamp": int(now.timestamp()),
        "configVersion": scene["configVersion"], "protocolVersion": "1.0", "deviceModel": "ESP32-WATER-C3",
        "plant": plant["name"], "plantId": plant["id"], "country": location["country"],
        "locationName": location["name"], "locationCode": location["id"],
        "season": scene["season"], "supplyVariant": scene["supplyVariant"],
        "source": source, "sourceVersion": versions, "generatedAt": now.isoformat(),
        "wateringStrategy": "pulse", "waterNeedMlDay": daily, "recommendedMode": "PREPARE",
        "params": dict(zip(("soilWeight", "tempWeight", "airWeight"), normalized)) | {
            "threshold": threshold, "pulseCount": pulses, "pulseOnMs": pulse_on, "pulseOffMs": pulse_off},
        "display": {"dailyWaterNeedMl": daily, "roundWaterMl": round_ml, "estimatedIntervalDays": seasonal_days,
                    "reservoirDays": round(scene["reservoirLiters"] * 1000 / daily, 1),
                    "flowRateMlSec": scene["flowRateMlSec"], "plant": plant["name"], "source": source, "irrigationMethod": "pulse"}
    }
    if scene["configVersion"] == "2.0":
        config["targetDeviceId"] = scene["targetDeviceId"]
        config["params"]["minWaterIntervalSeconds"] = int(seasonal_days * 86400)
    warnings = ["这是初始建议值，启用长期运行前请核对传感器读数和实际出水",
                "续航指水箱按估算日需水量可支持的天数，不包含电池与太阳能供电续航",
                "季节间隔用于本次水量估算；设备实际浇水仍受传感器及安全保护约束"]
    if scene["configVersion"] == "1.0":
        warnings.append("当前配置没有固件可执行的最短浇水间隔字段")
    else:
        warnings.append("最短浇水间隔已写入控制参数；自动运行须由支持 2.0 配置的固件执行，并通过传感器及运行保护检查")
    review = plant.get("review", {}).get("status", "engineering")
    validation = plant.get("fieldValidation", {}).get("status", "untested")
    if review == "engineering":
        warnings.append("植物参数仍为工程建议，资料来源待核对")
    elif review == "uncertain":
        warnings.append("植物资料存在存疑项，请核对来源和适用条件")
    if validation == "untested":
        warnings.append("该植物参数尚无实物栽培验证记录")
    suitability = plant.get("suitability", {})
    if (scene["configVersion"] == "2.0" and review == "reviewed" and suitability.get("context") == scene["siteType"]
            and any(suitability.get(key) is not None for key in ("temperatureMinC", "humidityMinPct"))):
        config["environmentReference"] = {key: value for key, value in suitability.items() if value is not None}
        config["environmentReference"].update(title=plant["evidence"]["title"], reference=plant["evidence"]["reference"])
    plant_fit = {"context": scene["siteType"], "source": "regional-weather", "temperature": "unavailable", "humidity": "unavailable"}
    onsite = scene.get("onsiteObservation")
    onsite_fit = None
    if onsite:
        age = datetime.now(timezone.utc) - datetime.fromisoformat(onsite["observedAt"])
        quality = "recent-manual" if age <= timedelta(hours=24) else "stale-manual"
        onsite_fit = {"context": scene["siteType"], "source": "user-manual", "quality": quality,
                      "temperature": "unavailable", "humidity": "unavailable"}
        if review == "reviewed" and suitability.get("context") == scene["siteType"] and quality == "recent-manual":
            for name, value, low_key, high_key in (("temperature", onsite["temperatureC"], "temperatureMinC", "temperatureMaxC"),
                                                   ("humidity", onsite["humidityPct"], "humidityMinPct", "humidityMaxPct")):
                low, high = suitability.get(low_key), suitability.get(high_key)
                if low is not None and high is not None:
                    onsite_fit[name] = "within" if low <= value <= high else "outside"
                    onsite_fit[name + "Range"] = {"min": low, "max": high}
                    if onsite_fit[name] == "outside":
                        warnings.append(("现场温度" if name == "temperature" else "现场空气湿度") + "超出该植物已核对参考范围")
        if quality == "stale-manual":
            warnings.append("现场测量超过 24 小时，请重新测量后判断适配")
    if scene["siteType"] != "outdoor" and not onsite:
        warnings.append("当前场景的室内或温室实际温湿度尚未提供；城市天气只作为区域参考")
    if review == "reviewed" and suitability.get("context") == scene["siteType"] == "outdoor":
        for name, value, low_key, high_key in (("temperature", environment["temperatureC"], "temperatureMinC", "temperatureMaxC"),
                                               ("humidity", environment["humidityPct"], "humidityMinPct", "humidityMaxPct")):
            low, high = suitability.get(low_key), suitability.get(high_key)
            if low is not None and high is not None:
                plant_fit[name] = "within" if low <= value <= high else "outside"
                plant_fit[name + "Range"] = {"min": low, "max": high}
                if plant_fit[name] == "outside":
                    label = "温度" if name == "temperature" else "湿度"
                    warnings.append(f"城市天气{label}超出该植物已核对参考范围；请核对种植位置的实际环境")
    if round_ml < desired_round * 0.8:
        warnings.append("按当前流量与脉冲上限，单轮水量低于估算目标；请实测后调整硬件方案，勿直接启用无人值守")
    explanations = [
        f"植物初始参考日需水量 {plant['dailyMl']} mL；结合栽培体积与光照得到场景修正",
        f"温度系数 {temperature:.2f}、空气湿度系数 {humidity:.2f}；计算输入来自" + ("用户选择的设备准备期报告" if measured else " Open-Meteo"),
        f"土壤／温度／空气权重归一化为 {normalized[0]:.2f}／{normalized[1]:.2f}／{normalized[2]:.2f}",
        f"每轮 {pulses} 次，每次开泵 3 秒、间隔 25 秒；按 {scene['flowRateMlSec']} mL/s 估算单轮水量",
        "设备固定无人值守，触发阈值增加 3；首次配置推荐先进入 PREPARE 采样",
        "降水、海拔与日照用于环境说明；未将短期预报当作长期气候或直接替代雨量传感器"
    ]
    evidence = plant.get("evidence", {})
    basis = {"reviewStatus": review, "fieldValidationStatus": validation,
             "title": evidence.get("title", ""), "reference": evidence.get("reference", ""),
             "conditions": evidence.get("conditions", ""), "numericBasis": evidence.get("numericBasis", "")}
    return {"status": "ok", "source": source, "storage": "temporary", "config": validate_config(config),
            "params": config["params"], "environment": environment, "explanations": explanations,
            "plantBasis": basis, "plantFit": plant_fit, "onsiteObservation": onsite, "deviceObservation": measured,
            "onsiteFit": onsite_fit, "warnings": warnings}

def formula_catalog(weights):
    """Read-only explanation of the active engine; coefficients come from the DB."""
    return {
        "version": "2026.10.14-bound-config-and-device-summary",
        "builtinFlowMlSec": weights["flowRateMlSec"],
        "coefficients": {key: weights[key] for key in ("light", "cultivation", "season")},
        "conventions": "clamp(x,a,b)=限制在[a,b]；round 使用 Python 四舍六入五成双；时间单位毫秒，流量 mL/s",
        "previousBehavior": "当前阈值统一增加 3；自带泵采用知识库流量估值，电磁阀变体使用用户实测流量",
        "items": [
            {"name": "花盆体积系数 S", "formula": "花盆：clamp((容积L / 10)^0.55, 0.4, 2.5)；地栽：1"},
            {"name": "温度系数 T", "formula": "clamp(1 + (所选输入温度°C - 22) × 0.025, 0.65, 1.5)；默认区域天气，主动选择后使用合格设备准备期报告"},
            {"name": "湿度系数 H", "formula": "clamp(1 + (60 - 所选输入空气湿度%) × 0.004, 0.8, 1.25)"},
            {"name": "估算日需水量 D（mL）", "formula": "round(clamp(植物dailyMl × 光照L × 栽培C × S × T × H, 25, 2500))"},
            {"name": "三项权重", "formula": "原始值=[soilWeight, tempWeight×T, airWeight×H]；前两项=round(原始值/总和,4)，末项=round(1-前两项之和,4)"},
            {"name": "触发阈值", "formula": f"round(clamp(植物阈值 - (L-1)×8 + {UNATTENDED_OFFSET}, 20, 90),1)"},
            {"name": "季节间隔 I（天）", "formula": "按纬度与当前月份判断季节，读取数据库 season 对应值；1.0 仅用于水量估算，2.0 同时写入最短浇水间隔 I×86400 秒"},
            {"name": "流量 Q（mL/s）", "formula": f"自带泵：知识库估值 {weights['flowRateMlSec']}，待样机实测；电磁阀变体：用户实测值，范围1–200"},
            {"name": "脉冲次数 N", "formula": f"clamp(round(D × I / (Q × {PULSE_ON_MS}/1000)), 1, 12)"},
            {"name": "估算单轮水量 R（mL）", "formula": f"round(N × {PULSE_ON_MS}/1000 × Q,1)"},
            {"name": "水箱续航（天）", "formula": "round(储水量L × 1000 / D,1)"},
            {"name": "保护窗口（ms）", "formula": f"N × ({PULSE_ON_MS} + {PULSE_OFF_MS}) ≤ 360000；R < D×I×0.8 时提示单轮水量不足"},
            {"name": "天气输入边界", "formula": "温度与湿度进入修正；降水、海拔、日照只展示，不替代设备传感器，不启动水泵"}
        ]
    }
