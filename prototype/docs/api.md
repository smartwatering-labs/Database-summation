# Web API 与资料来源

本实现使用 Flask 3.1；前后端同源。API JSON 使用 camelCase，错误响应为 `{ "status": "error", "message": "…", "field": "…" }`。API 响应设置 `Cache-Control: no-store`，POST 请求须使用 `application/json`，最大体积 64 KB。

| 方法 | 路径 | 请求 / 响应 |
| --- | --- | --- |
| GET | `/` | 公共 HTML 页面骨架；当 Host 是 `ADMIN_HOSTS` 管理子域名时返回独立管理端 |
| GET | `/offline-kit`、`/offline-sw.js` | 可缓存的独立配置文件与 BLE 入口；不请求生成 API，不存储用户配置 |
| GET | `/api/settings` | 公开协议版本、演示开关、BLE UUID；不返回管理员密钥 |
| GET | `/api/plants` | `items`、`version`、`provenance` |
| GET | `/api/locations` | 兼容入口，固定空 `items`，标记 `storage: external-only`；无内部地点目录 |
| GET | `/api/weather`、`/api/environment` | 旧式 locationId 查询返回 410；改用下述 POST |
| GET | `/api/locations/countries` | 外部国家列表，`items` 含中文名、英文名、代码和 `selectionToken` |
| POST | `/api/locations/children` | `{parentToken}` → 中国省份／城市列表，或海外主要城市列表；每项带 `selectionToken` |
| POST | `/api/locations/select` | `{selectionToken}` → 已确认城市 `location`，含天气与生成使用的 `locationToken` |
| POST | `/api/locations/resolve` | 旧手写区县查询返回 410，提示刷新使用联动列表 |
| POST | `/api/environment`、`/api/locations/environment` | `{locationToken}` → 该已确认地点的实时 API 天气 |
| POST | `/api/configurations/generate` | 场景输入 → `config`、`params`、`environment`、`explanations`、`warnings` |
| POST | `/api/configurations/import` | `{config, currentRevision?}` → 已验证规范配置；currentRevision 可用于拒绝旧版本 |
| POST | `/api/configurations/export` | `{config}` → JSON 文件响应，剥除导入的认证／签名字段 |
| GET | `/api/admin/health` | SQLite 状态、运行时长、知识库版本 |
| GET | `/api/admin/stats` | 本进程内请求、错误、生成次数和平均耗时；无用户标识 |
| GET | `/api/admin/logs?limit=50` | 最多 100 条系统日志；持久化上限 500 条 |
| GET | `/api/admin/formulas` | 当前引擎公式、边界、数据库系数与版本；只读 |
| GET/PUT | `/api/admin/libraries/plants` | 获取或以乐观锁版本更新数据库植物库 |
| GET | `/api/admin/git/status` | Git 仓库可用性与工作区状态 |
| POST | `/api/admin/git/snapshot` | 管理员主动生成数据库植物库审计快照并尝试 Git 提交 |

管理员接口使用 `Authorization: Bearer <ADMIN_TOKEN>`，且只接受 `ADMIN_HOSTS` 中的 Host。没有用户注册或登录系统；管理员令牌只在当前管理端页面内存使用，离开或主动退出时清除。

公共页面的 JSON 文件导入、导出和设备配置读回在浏览器内按 1.0 / 2.0 配置规则校验并清理字段；上述 import/export API 仍可供同源调用。已加载页面在本地服务中断后仍可处理文件及发送已加载配置。`/offline-kit` 首次联网打开后缓存页面及协议代码；以后可断网重新打开、主动导入本机配置文件并通过 BLE 发送。新配置生成须请求后端。

## 场景输入

```json
{
  "plantId": "tomato",
  "locationToken": "列表选择确认后返回的有效签名令牌",
  "cultivation": "pot",
  "potLiters": 10,
  "light": "partial",
  "supplyVariant": "builtin",
  "reservoirLiters": 20,
  "currentRevision": 0
}
```

`cultivation`: pot / ground；`light`: shade / partial / full。`supplyVariant`: builtin / valve；builtin 流量由数据库系数固定（当前 22 mL/s），忽略客户端流量覆盖；valve 必须提交 `flowRateMlSec`，范围 1–200 mL/s。设备始终无人值守，提交 `unattended:false` 不会改变该规则。

地点必须来自外部联动列表。先获取国家列表，输入联想仅在页面内存筛选中文名、英文名和代码的前缀。点击国家后，把该项 `selectionToken` 作为 `parentToken` 获取下级列表。中国需要省份和城市，直辖市、香港和澳门的省级项 `terminal:true` 可直接确认；其他国家直接返回主要城市，不选择省份。

列表项包含 `id`、`name`、`kind`、`countryCode`、`province`、`terminal`、`selectionToken`。只有 `terminal:true` 才可提交 `/select`。确认结果含 `displayName`、`country`、`state`、`city`、坐标、`selectionLevel:city`、`locationToken`。中国城市目录使用外部省市区数据，以行政代码关联地图中心点；新增城市若暂无边界坐标，选中时查询 Nominatim，不从列表中删除。详细来源和覆盖口径见 [地点联动](locations.md)。

列表令牌与地点确认令牌使用不同签名用途，均有效一小时，只在浏览器内存保存；后端不保存列表或会话。输入国家文字本身不能作为已确认地点。后端拒绝未完成层级选择、过期和篡改令牌，忽略客户端坐标及其他地点覆盖。签名不是加密，不应放入 URL 或日志。切换上级选项时，前端立即清除下级和天气并取消旧请求。季节按验证后的纬度与当前 UTC 月份决定。

`currentRevision` 仅用于生成下一设备版本，不保存在数据库。实际下发前再次读取设备版本；配置旧于或等于当前版本时拒绝发送，用户需重新生成。

已连接设备若握手声明 2.0 配置、最短间隔及目标绑定能力，页面提交 `configVersion:"2.0"` 与 `targetDeviceId`。后端按季节间隔生成 `params.minWaterIntervalSeconds`；固件 3.7.0 将其用于自主运行保护。旧设备仍生成 1.0 配置。

可选 `deviceObservation` 由用户主动选择真实设备准备期报告：目标与当前 revision 一致、已标定、可信时间、至少十分钟、10 个有效样本及 80% 有效率，报告需在一小时内。合格温湿度代替天气温湿度参与本次参数计算，设备标定流量同时参与水量估算；地点和天气查询仍执行。返回的 `deviceObservation` 留在临时结果，后端保持无个人配置及采样历史。2.0 可携带经审核且位置匹配的 `environmentReference` 范围摘要。

## 参数推导与限制

完整公式见 [计算公式](formulas.md)，管理端登录后也可查看。日需水量由植物初值及栽培、体积、光照、温湿度系数估算；阈值统一应用无人值守偏移 +3。季节间隔与对应变体流量用于估算脉冲次数。

网页当前验证范围为阈值 20–90、次数 1–12、单次开泵 500–5000ms、关泵 5000–60000ms，单轮按 `次数 × (开泵 + 关泵)` 保守计算不超过 6 分钟。这些是应用层暂定限制，**不是已核实的固件上限**；必须与实际固件再次对齐。

生成默认开泵 3000ms、关泵 25000ms；水箱续航按 `储水量 / 估算日需水量` 计算。无法满足估算单轮目标时明确提示，不突破参数上限。后端不根据天气预报直接发起浇水。

## Open-Meteo 映射

使用 [Open-Meteo Forecast API](https://open-meteo.com/en/docs)，无需 API key 的公开开发接口。实际使用应遵循服务许可及使用条款。

| 平台字段 | 上游字段 | 含义 |
| --- | --- | --- |
| temperatureC | current.temperature_2m | 当前温度 °C |
| humidityPct | current.relative_humidity_2m | 当前相对湿度 % |
| elevationM | elevation | 海拔 m |
| precipitationMmDay | daily.precipitation_sum 的均值 | 未来 7 天日平均降水 mm |
| sunshineHoursDay | daily.sunshine_duration 的均值 / 3600 | 未来 7 天日平均日照小时 |

短期预报不称为长期气候平均值；界面显示观测时间、时区、查询时间与预报范围。仅温度、湿度进入本期参数修正；海拔、降水、日照作为环境上下文。每次预览、重试和生成都重新查询，不读内部天气库、不在服务器缓存结果。

天气及补查地图单次联网超时 8 秒；外部列表请求每次 10 秒，GitHub Raw 失败时尝试同一文件的 CDN 镜像，浏览器列表请求上限 30 秒。天气异常、缺失值、异常数值或禁用联网返回 503，并停止生成配置。成功结果固定 `source: api`、`cached: false`。地图未找到结果返回 404，限频返回 429；篡改或过期的地点令牌返回 409，需要重新匹配。系统日志只存固定维护摘要，不记录请求体、用户地址、配置、令牌、蓝牙 nonce 或设备采样。

## 版本与签名

协议版本 `1.0`、配置格式版本 `1.0`、固件版本、知识库版本和设备配置 `revision` 分别管理。配置包采用文档的 `deviceModel: ESP32-WATER-C3` 与 `params` 格式，不输出 snake_case 的旧字段。

现有资料的 `signature` 派生规则没有具体固件可验证，因此**未伪造签名**。当前 BLE 草案使用文档定义的 nonce + 开发密钥 SHA-256 认证后发送规范配置。强认证、加密与实际固件签名验证仍是对接项，详见 [BLE 协议](ble-protocol.md)。
