"""Fresh external weather only: no fabricated values or persistent weather cache."""
import json
from datetime import datetime, timezone
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from .validation import ValidationError, number

class EnvironmentService:
    def __init__(self, enabled=True, timeout=8, log=lambda *args: None):
        self.enabled, self.timeout, self.log = enabled, timeout, log

    def get(self, location):
        return self.get_coordinates(location)

    def get_coordinates(self, location):
        if not self.enabled:
            raise ValidationError("外部天气服务未启用，无法生成配置", "environment", 503)
        latitude = number(location.get("latitude"), "latitude", -90, 90)
        longitude = number(location.get("longitude"), "longitude", -180, 180)
        query = urlencode({"latitude": latitude, "longitude": longitude,
                           "current": "temperature_2m,relative_humidity_2m",
                           "daily": "precipitation_sum,sunshine_duration", "forecast_days": 7, "timezone": "auto"})
        try:
            with urlopen(Request("https://api.open-meteo.com/v1/forecast?" + query,
                                 headers={"User-Agent": "WateringPlatform/1.0"}), timeout=self.timeout) as response:
                data = json.loads(response.read(256000))
            current, daily = data["current"], data["daily"]
            def mean(values, field, maximum):
                if not isinstance(values, list) or not values:
                    raise ValueError("missing weather series")
                return sum(number(v, field, 0, maximum) for v in values) / len(values)
            result = {
                "temperatureC": number(current["temperature_2m"], "temperature", -60, 60),
                "humidityPct": number(current["relative_humidity_2m"], "humidity", 0, 100),
                "elevationM": number(data["elevation"], "elevation", -500, 9000),
                "precipitationMmDay": round(mean(daily["precipitation_sum"], "precipitation", 3000), 2),
                "sunshineHoursDay": round(mean(daily["sunshine_duration"], "sunshine", 86400) / 3600, 2),
                "source": "api", "provider": "Open-Meteo", "cached": False,
                "observedAt": current["time"], "timezone": data.get("timezone", "auto"),
                "period": "当前温湿度 + 未来 7 天平均降水／日照",
                "fetchedAt": datetime.now(timezone.utc).isoformat(),
                "locationId": location["id"], "latitude": latitude, "longitude": longitude}
            if not isinstance(result["observedAt"], str) or not result["observedAt"]:
                raise ValueError("missing observation time")
            return result
        except Exception as error:
            self.log("warning", "environment_unavailable", "外部天气服务不可用或数据缺失，已停止生成配置")
            raise ValidationError("无法取得完整的外部天气数据，请稍后重试；未使用静态数据生成配置", "environment", 503) from error
