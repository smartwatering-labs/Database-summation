"""Canonical camelCase configuration validation at the application boundary."""
import math


class ValidationError(ValueError):
    def __init__(self, message, field=None, status=400):
        super().__init__(message)
        self.field = field
        self.status = status


def number(value, field, minimum, maximum, integer=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValidationError(f"{field} 必须是有效数字", field)
    if not minimum <= value <= maximum or (integer and int(value) != value):
        raise ValidationError(f"{field} 必须在 {minimum}–{maximum} 范围内" + ("且为整数" if integer else ""), field)
    return int(value) if integer else value


def text(value, field, maximum=120, required=True):
    if not isinstance(value, str) or len(value.strip()) > maximum or (required and not value.strip()):
        raise ValidationError(f"请填写有效的 {field}（最多 {maximum} 字）", field)
    return value.strip()


def validate_config(config, current_revision=None):
    if not isinstance(config, dict):
        raise ValidationError("配置必须是 JSON 对象")
    if config.get("deviceModel") != "ESP32-WATER-C3":
        raise ValidationError("设备型号必须为 ESP32-WATER-C3", "deviceModel")
    version = config.get("configVersion")
    if version not in ("1.0", "2.0"):
        raise ValidationError("不支持此配置格式版本，仅接受 1.0 或 2.0", "configVersion")
    if config.get("protocolVersion", "1.0") != "1.0":
        raise ValidationError("不支持此协议版本", "protocolVersion")
    revision = number(config.get("revision"), "revision", 1, 2147483647, True)
    if current_revision is not None:
        number(current_revision, "currentRevision", 0, 2147483646, True)
        if revision <= current_revision:
            raise ValidationError("配置版本不高于设备当前版本，请重新生成配置", "revision", 409)
    text(config.get("plant"), "plant")
    params = config.get("params")
    if not isinstance(params, dict):
        raise ValidationError("缺少 params 参数对象", "params")
    for key in ("soilWeight", "tempWeight", "airWeight"):
        number(params.get(key), key, 0, 1)
    if abs(sum(params[k] for k in ("soilWeight", "tempWeight", "airWeight")) - 1) > 0.015:
        raise ValidationError("三项权重之和必须为 1", "params")
    for key, low, high, integer in (("threshold", 20, 90, False), ("pulseCount", 1, 12, True),
                                   ("pulseOnMs", 500, 5000, True), ("pulseOffMs", 5000, 60000, True)):
        number(params.get(key), key, low, high, integer)
    if params["pulseCount"] * (params["pulseOnMs"] + params["pulseOffMs"]) > 360000:
        raise ValidationError("单轮脉冲总时长不得超过文档中的 6 分钟保护窗口", "params")
    if version == "2.0":
        target = text(config.get("targetDeviceId"), "targetDeviceId", 64)
        if not all(ch.isascii() and (ch.isalnum() or ch in "-_") for ch in target):
            raise ValidationError("目标设备 ID 格式无效", "targetDeviceId")
        number(params.get("minWaterIntervalSeconds"), "minWaterIntervalSeconds", 3600, 2592000, True)
    # Permit only documented metadata. Auth/secret/signature are created by the device
    # protocol, never trusted from imported files or retained in exported files.
    keys = ("revision", "timestamp", "configVersion", "protocolVersion", "deviceModel", "plant", "plantId",
            "country", "locationName", "locationCode", "postalCode", "climateZone", "season", "source",
            "sourceVersion", "generatedAt", "wateringStrategy", "waterNeedMlDay", "recommendedMode", "supplyVariant")
    clean = {k: config[k] for k in keys if k in config}
    if version == "2.0":
        clean["targetDeviceId"] = target
    for key, value in clean.items():
        if key not in ("revision", "timestamp", "waterNeedMlDay"):
            text(value, key, 200, required=False)
    if "timestamp" in clean:
        number(clean["timestamp"], "timestamp", 0, 9999999999999)
    if "waterNeedMlDay" in clean:
        number(clean["waterNeedMlDay"], "waterNeedMlDay", 0, 100000)
    if clean.get("recommendedMode", "PREPARE") not in ("PREPARE", "DISPLAY", "LONGRUN"):
        raise ValidationError("运行模式不合法", "recommendedMode")
    if clean.get("supplyVariant", "builtin") not in ("builtin", "valve"):
        raise ValidationError("供水变体不合法", "supplyVariant")
    clean["params"] = {k: params[k] for k in ("soilWeight", "tempWeight", "airWeight", "threshold", "pulseCount", "pulseOnMs", "pulseOffMs")}
    if version == "2.0":
        clean["params"]["minWaterIntervalSeconds"] = params["minWaterIntervalSeconds"]
    display = config.get("display", {})
    if not isinstance(display, dict):
        raise ValidationError("display 必须是对象", "display")
    clean["display"] = {}
    for key in ("dailyWaterNeedMl", "roundWaterMl", "estimatedIntervalDays", "reservoirDays", "flowRateMlSec"):
        if key in display and display[key] is not None:
            clean["display"][key] = number(display[key], key, 0, 1000000)
    for key in ("plant", "source", "irrigationMethod"):
        if key in display:
            clean["display"][key] = text(display[key], key)
    reference = config.get("environmentReference")
    if reference is not None:
        if version != "2.0" or not isinstance(reference, dict) or reference.get("context") not in ("outdoor", "indoor", "greenhouse"):
            raise ValidationError("环境参考需使用 2.0 格式及有效种植位置", "environmentReference")
        clean_reference = {"context": reference["context"], "title": text(reference.get("title"), "参考标题", 200),
                           "reference": text(reference.get("reference"), "参考来源", 300)}
        for prefix, low, high in (("temperature", -20, 60), ("humidity", 0, 100)):
            unit = "C" if prefix == "temperature" else "Pct"
            min_key, max_key = prefix + "Min" + unit, prefix + "Max" + unit
            if reference.get(min_key) is not None or reference.get(max_key) is not None:
                minimum = number(reference.get(min_key), min_key, low, high)
                maximum = number(reference.get(max_key), max_key, minimum, high)
                clean_reference.update({min_key: minimum, max_key: maximum})
        if len(clean_reference) == 3:
            raise ValidationError("环境参考至少需要一组完整范围", "environmentReference")
        clean["environmentReference"] = clean_reference
    return clean
