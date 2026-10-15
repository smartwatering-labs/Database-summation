# 国家、省份与城市联动

本文件对应最新要求，替代先前的区县级手写匹配方式。地点列表通过服务器代理外部 JSON / 地图 API 取得；不打包进网站、不写 SQLite、不写服务端文件或缓存。国家联想使用本次外部响应，在页面内存中筛选，刷新后重新加载。

## 使用方式

1. 点入“国家 / 地区”可展开列表。输入“中”显示以“中”开头的候选（例如中国）；也可输入英文或国家代码。点击候选补全，支持方向键、Enter 和 Escape。
2. 选中国后显示“省份 / 直辖市”和“城市”。省份直接下拉选择，无需手写。选江苏后展示全部 13 个地级市，选城市后自动查询天气。
3. 北京、天津、上海、重庆选中即完成地点选择，不再出现城市栏。香港、澳门采用同样的单级选择；台湾省展开 22 个县市。
4. 其他国家不显示省份；直接展示外部数据中的首都及人口较多的主要城市，最多 8 个。名称采用上游原名，不自行编造中文译名。
5. 修改国家或省份立即清除旧地点、天气及确认令牌，旧配置标记为待重新生成。输入未确认、列表加载中、坐标或天气失败时，不允许生成新配置。

## 外部来源与覆盖

| 内容 | 外部来源 | 处理方式 |
| --- | --- | --- |
| 国家与地区 | [mledoze/countries](https://github.com/mledoze/countries) | 读取中文、英文名称与 ISO 代码；当前 250 项，包含地区 |
| 中国省级项与地图中心点 | [阿里云 DataV 地理数据](https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json) | 34 个省级选项；中心点用于城市尺度天气查询 |
| 中国大陆城市目录 | [Administrative-divisions-of-China](https://github.com/modood/Administrative-divisions-of-China) 的 `pca-code.json` | 省下完整地级行政单位，省／自治区直辖县级单位展开；不截取前 N 项。包括地区、自治州、盟等同级行政单位 |
| 台湾县市 | [TaiwanAddressCityAreaRoadChineseEnglishJSON](https://github.com/donma/TaiwanAddressCityAreaRoadChineseEnglishJSON) | 22 个县市，选择时查询地图坐标 |
| 海外主要城市 | [Natural Earth 50m Populated Places](https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-populated-places/) | 按 ISO 国家代码筛选，首都优先、人口排序，最多 8 个；使用城市点坐标 |
| 尚无中心点的城市 | [Nominatim](https://nominatim.org/release-docs/latest/api/Search/) | 只在点击确认时查坐标，不用于逐字自动补全 |
| 天气 | [Open-Meteo](https://open-meteo.com/en/docs) | 城市代表坐标的当前温湿度与短期预报；每次生成重新查询 |

外部 JSON 接口提供的是发布者维护的数据版本，并非各地政府行政变更的实时推送。城市名录和边界数据可能不同步，因此城市目录与坐标分别处理：例如目录中的新星市、白杨市即使未在旧地图边界中出现，也保留为可选项，确认时再取坐标。省下“城市”按地级及省直辖口径，不另列每个地级市所辖县级市／区县。

外部源缺失或网络不通时明确报错，不用内部参考地点代替。人口排序用来挑选少量主要城市，不代表旅游知名度排名；个别国家或地区在上游城市集中没有记录时提示未取得列表。

## 部署与接口

接口为 `GET /api/locations/countries`、`POST /api/locations/children`、`POST /api/locations/select`；详见 [API 说明](api.md)。后端对每个列表项签名，确认城市后另签发一小时有效的地点令牌。仅服务端从可信列表签出的最终项能用于天气和生成。

外部源可通过 `COUNTRIES_API_URL`、`CHINA_AREAS_API_URL`、`CHINA_CITIES_API_URL`、`WORLD_CITIES_API_URL`、`TAIWAN_CITIES_API_URL` 环境变量替换，但响应格式必须兼容。它们都是部署配置，用户请求不能传任意抓取地址。默认 GitHub Raw 失败时尝试相同文件的 jsDelivr 镜像；两者都失败则报错。单个连接超时 10 秒，浏览器地点请求等待上限 30 秒。

重试可点击“重新加载地点列表”，会清除旧选择。后端关闭 `GEOCODING_ENABLED` 会停止所有外部地点获取；天气仍由 `WEATHER_ENABLED` 独立控制。服务运行时只需本机 Python；新增数据源不需要 Node 构建或本地地点数据库。

## 验证命令

在 `prototype` 目录执行 `py -3 -m unittest discover -s tests -v` 检查联动数据、签名、过期、缺失数据和配置规则。联网运行 `py -3 tests/check_external_apis.py` 检查全部省级项及下级目录、江苏 13 城市、台湾 22 县市、白杨市与城市天气样本；不保存下载的列表。`npm run test:browser` 验证真实国家联想、省市选择、直辖市跳过、海外城市、天气及配置流程。
