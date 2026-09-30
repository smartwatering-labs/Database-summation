"""Transparent engineering heuristics; all actuator limits still require firmware validation."""
from datetime import datetime, timezone
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
                         ("season", ("spring", "summer", "autumn", "winter"))):
        if data.get(key) not in options:
            raise ValidationError("请选择有效选项", key)
    cleaned = {key: data[key] for key in ("plantId", "cultivation", "light", "season")}
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
    cleaned["waterSource"] = text(data.get("waterSource"), "waterSource", 200)
    return cleaned


def derive_parameters(scene, plant, location, environment, weights, versions):
    light = weights["light"][scene["light"]]
    cultivation = weights["cultivation"][scene["cultivation"]]
    size = clamp((scene["potLiters"] / 10) ** 0.55, 0.4, 2.5) if scene["cultivation"] == "pot" else 1
    temperature = clamp(1 + (environment["temperatureC"] - 22) * 0.025, 0.65, 1.5)
    humidity = clamp(1 + (60 - environment["humidityPct"]) * 0.004, 0.8, 1.25)
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
    source = environment["source"]
    config = {
        "revision": scene["currentRevision"] + 1, "timestamp": int(now.timestamp()),
        "configVersion": "1.0", "protocolVersion": "1.0", "deviceModel": "ESP32-WATER-C3",
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
    warnings = ["这是初始建议值，启用长期运行前请完成土壤和水泵实物标定",
                "续航指水箱按估算日需水量可支持的天数，不包含电池与太阳能供电续航",
                "季节间隔是固件允许触发的最短间隔；实际浇水仍由土壤、雨量和需求值决定"]
    if round_ml < desired_round * 0.8:
        warnings.append("按当前流量与脉冲上限，单轮水量低于估算目标；请实测后调整硬件方案，勿直接启用无人值守")
    explanations = [
        f"植物初始参考日需水量 {plant['dailyMl']} mL；结合栽培体积与光照得到场景修正",
        f"温度系数 {temperature:.2f}、空气湿度系数 {humidity:.2f}；环境资料来源为 {'Open-Meteo' if source == 'api' else '静态参考库'}",
        f"土壤／温度／空气权重归一化为 {normalized[0]:.2f}／{normalized[1]:.2f}／{normalized[2]:.2f}",
        f"每轮 {pulses} 次，每次开泵 3 秒、间隔 25 秒；按 {scene['flowRateMlSec']} mL/s 估算单轮水量",
        "设备固定无人值守，触发阈值增加 3；首次配置推荐先进入 PREPARE 校准",
        "降水、海拔与日照用于环境说明；未将短期预报当作长期气候或直接替代雨量传感器"
    ]
    return {"status": "ok", "source": source, "storage": "temporary", "config": validate_config(config),
            "params": config["params"], "environment": environment, "explanations": explanations, "warnings": warnings}

def formula_catalog(weights):
    """Read-only explanation of the active engine; coefficients come from the DB."""
    return {
        "version": "2026.09.10-unattended-variants",
        "builtinFlowMlSec": weights["flowRateMlSec"],
        "coefficients": {key: weights[key] for key in ("light", "cultivation", "season")},
        "conventions": "clamp(x,a,b)=限制在[a,b]；round 使用 Python 四舍六入五成双；时间单位毫秒，流量 mL/s",
        "previousBehavior": "原阈值公式中无人值守时加 3、有人看护时加 0；原流量对所有设备开放填写；现统一加 3，自带泵固定流量",
        "items": [
            {"name": "花盆体积系数 S", "formula": "花盆：clamp((容积L / 10)^0.55, 0.4, 2.5)；地栽：1"},
            {"name": "温度系数 T", "formula": "clamp(1 + (API温度°C - 22) × 0.025, 0.65, 1.5)"},
            {"name": "湿度系数 H", "formula": "clamp(1 + (60 - API空气湿度%) × 0.004, 0.8, 1.25)"},
            {"name": "估算日需水量 D（mL）", "formula": "round(clamp(植物dailyMl × 光照L × 栽培C × S × T × H, 25, 2500))"},
            {"name": "三项权重", "formula": "原始值=[soilWeight, tempWeight×T, airWeight×H]；前两项=round(原始值/总和,4)，末项=round(1-前两项之和,4)"},
            {"name": "触发阈值", "formula": f"round(clamp(植物阈值 - (L-1)×8 + {UNATTENDED_OFFSET}, 20, 90),1)"},
            {"name": "季节最短间隔 I（天）", "formula": "按纬度与当前月份判断季节，读取数据库 season 对应值；南北半球季节相反"},
            {"name": "流量 Q（mL/s）", "formula": f"自带泵：{weights['flowRateMlSec']}（后端固定）；电磁阀变体：用户实测值，范围1–200"},
            {"name": "脉冲次数 N", "formula": f"clamp(round(D × I / (Q × {PULSE_ON_MS}/1000)), 1, 12)"},
            {"name": "估算单轮水量 R（mL）", "formula": f"round(N × {PULSE_ON_MS}/1000 × Q,1)"},
            {"name": "水箱续航（天）", "formula": "round(储水量L × 1000 / D,1)"},
            {"name": "保护窗口（ms）", "formula": f"N × ({PULSE_ON_MS} + {PULSE_OFF_MS}) ≤ 360000；R < D×I×0.8 时提示单轮水量不足"},
            {"name": "天气输入边界", "formula": "温度与湿度进入修正；降水、海拔、日照只展示，不替代设备传感器，不启动水泵"}
        ]
    }
