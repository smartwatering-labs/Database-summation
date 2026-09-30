# 浇水平台

按项目资料库 `../9100XSB-main/浇水项目` 中当前需求与 2026-09-09 后端修订实现的本地可运行网页。网站代码、依赖、运行数据、测试和说明文档统一位于 `prototype`。界面规范见 [design.md](design.md)。

## 启动

使用本机 Python 3.10 或更新版本，不依赖 Codex、OpenAI 捆绑运行时或项目虚拟环境。本机已安装官方 Python 3.13.15 及网站依赖。

**日常启动：双击 `prototype/start.bat`**，或在项目根目录运行：

```powershell
.\prototype\start.ps1
```

打开 **http://127.0.0.1:5000**。服务由 Waitress 托管，默认仅监听本机；保持启动窗口开启，按 Ctrl+C 停止。无需打开 Codex。`start.bat` 仅为当前 PowerShell 进程设置脚本执行参数，不修改系统执行策略。

也可双击 [打开网站.html](打开网站.html)。它会检测本机服务并自动进入网页；服务未启动时会说明如何启动。HTML 入口不能替代 `start.bat`，因为配置生成、管理员监控和数据库都需要本地 Flask 服务。

**在另一台 Windows 电脑首次安装：** 安装 [官方 Python](https://www.python.org/downloads/windows/)，重新打开终端，在项目根目录执行：

```powershell
.\prototype\start.ps1 -InstallDependencies
```

脚本优先通过 `py -3` 查找本机 Python，再尝试 `python` / `python3`，并显示实际解释器路径。需要指定某个版本时，可使用 `-PythonPath 'C:\path\to\python.exe'`；`-SetupOnly` 只检查或安装依赖，不启动服务。

也可以在 `prototype` 中直接运行，完全不使用脚本：

```powershell
py -3 -m pip install -r requirements.txt
py -3 app.py
```

Linux / macOS 在 `prototype` 中使用 `python3 -m pip install -r requirements.txt` 和 `python3 app.py`。若系统 Python 受包管理器保护，使用服务器自行创建的标准环境或下述 Docker 部署，不需要复制本机环境目录。

网站运行只需要 Python；Node.js 和 Playwright 仅用于开发测试。上线文件、Docker 和 HTTPS 配置见 [部署说明](docs/deployment.md)。

## 已实现

- 首页：大幅 3D 模型、蓝牙入口和渐进式详情按钮；硬件资料、快捷入口、兼容性与唤醒说明保留在详情中。
- 产品介绍：采样、浇水、休眠流程，三种模式与首次使用指导。
- 个性化库编译：国家输入支持中文／英文前缀联想，点击补全。中国提供 34 个省级选项和完整下级城市列表；直辖市及港澳跳过城市选择。其他国家直接选择主要城市（最多 8 个）。地点列表来自外部 JSON API，不写入数据库；选中后自动通过 API 查询天气。操作与来源见 [地点联动说明](docs/locations.md)。
- 供水装置：自带水泵固定 22 mL/s；电磁阀控制用户水泵时才填写实测流量。设备统一无人值守，无开关选项。
- 设备页：握手后显示状态与采样，10 秒限频读取、需求值画布、最近一周历史分页。
- 配置操作：生成页负责发送配置；硬件页负责读取配置、模式切换、重启和恢复出厂确认。
- 管理员监控：独立管理子域名的健康状态、运行统计、数据库知识库维护、维护日志、只读计算公式和 Git 快照接口。公式说明见 [docs/formulas.md](docs/formulas.md)。
- ESP32-C3 固件已独立放在项目根目录的 `../esp32-firmware`，支持 BLE 认证、配置分包校验、NVS 保存与读回、二次确认操作，以及 72×40 OLED 连接状态和配置数字显示。见 [编译与烧录说明](../esp32-firmware/README.md)。该目录不属于网站部署文件。
- 模拟设备：显式点击后启用，可走通配置、历史与设备操作，不访问真实蓝牙。

## 重要边界

**真实设备仍需实物联调。** 项目包含可单独烧录的 ESP32-C3 蓝牙/OLED 固件 3.4.0；网页与同源 C++ 协议核心已通过软件测试。当前固件不控制水泵或采集传感器，状态与历史返回空采样。整机还需要 GPIO、执行器、传感器校准、供电与认证联调；协议说明见 [BLE 通信契约](../esp32-firmware/docs/ble-protocol.md)。

模拟设备的设备 ID 以 `DEMO-` 开头，界面持续显示模拟标记。它只用于软件交互验证，不证明硬件通信成功。

用户配置只保存在页面内存中：不使用 localStorage、sessionStorage、IndexedDB、Cookie 或 Service Worker 缓存配置。刷新、关闭页面会清除；导出文件是用户主动保存的副本。后端只持久化知识库和系统维护日志，不创建用户／设备／会话／配置历史表。

知识库是带版本的**工程初始建议库**，未声称为经过农艺验证的资料。泵流量默认 22 mL/s 来自项目文档，需实测；续航展示的是**水箱续航**，不包含电池。首次配置推荐 PREPARE，不自动启动 LONGRUN 或水泵。继电器电平、ADC 标定和固件参数边界仍需实物确认。

用户页面已接入提供的临时外壳 OBJ/MTL 模型：首页微斜正面、产品介绍斜向俯视、配置页展开外壳、设备页合拢平视。采用纯白背景、本地工业金属 PBR 纹理与蓝色重点色；首页/介绍页使用悬浮详情按钮，配置/设备页使用可滚动的常驻玻璃面板。侧栏默认展开，可平滑收起。切页先隐藏文字，模型直接过渡至最新目标后再渐显文字。内部芯片位置暂留空。模型、贴图、Three.js 和加载器都从本地 Flask 静态目录读取，不使用 CDN，不需要 Node 构建。模型或 WebGL 不可用时保留硬件参考图和业务操作。正式模型替换与测试说明见 [3D 展示说明](docs/model-presentation.md)。

## 环境变量

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 监听地址 |
| `PORT` | `5000` | 端口 |
| `APP_ENV` | `development` | 生产环境设置为 `production` |
| `ADMIN_TOKEN` | `6767` | 仅开发期临时值；生产模式强制要求至少 16 字符且不得为默认值 |
| `WEATHER_ENABLED` | `1` | 查询 Open-Meteo；禁用或查询失败时不能生成新配置 |
| `DEMO_ENABLED` | `1` | 是否显示模拟设备入口 |
| `ADMIN_HOSTS` | `admin.localhost` | 管理端允许的主机名；生产环境必须设为真实管理子域名 |
| `GEOCODING_ENABLED` | `1` | 是否允许地点匹配服务 |
| `GEOCODING_BASE_URL` | Nominatim 搜索接口 | 可替换为有配额的地图服务兼容接口 |
| `GEOCODING_USER_AGENT` | 开发标识 | 生产环境应带真实联系地址，遵循地图服务策略 |
| `LOCATION_TOKEN_SECRET` | 进程随机值 | 地点结果签名密钥；生产多进程须设置相同的独立强密钥 |
| `BLE_SERVICE_UUID` | 项目验证 UUID | 实际服务 UUID，可在部署环境覆盖 |
| `BLE_WRITE_UUID` | 项目验证 UUID | 带响应写入特征 UUID |
| `BLE_NOTIFY_UUID` | 项目验证 UUID | 通知特征 UUID |

例如切换本地端口并保持外部服务启用：

```powershell
$env:PORT='5001'
$env:WEATHER_ENABLED='1'
py -3 app.py
```

远程访问需部署 HTTPS，且浏览器必须支持 Web Bluetooth。框架不启用跨域接口。管理端本地地址为 **http://admin.localhost:5000**；部署时反向代理必须把实际管理子域名保留在 Host 头中转发给应用。不要把默认开发密钥的服务直接公开到网络；正式部署需配置强管理员密钥、HTTPS 和访问控制。浏览器能力说明参见 [Web Bluetooth 文档](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API)。

## 技术结构与后续 UI 改进

```text
app.py                       Flask API / SQLite 系统数据 / Waitress 启动
start.ps1 / start.bat         本机 Python 启动入口
Dockerfile / compose.yaml    容器部署入口
engine/rules.py              可解释参数推导
engine/validation.py         场景与配置边界校验
engine/environment.py        外部天气接口及失败校验（不缓存）
engine/geocoding.py          可替换的地点匹配适配器
engine/location_catalog.py   外部国家、省市和主要城市列表
knowledge_base/              带版本的 JSON 知识库
templates/index.html        页面骨架
static/css/tokens.css        颜色、宽度、间距等设计变量
static/css/app.css           页面与组件布局
static/js/pages/             公共页面视图
static/js/admin-app.js       独立管理端应用
static/js/services/          Flask API / BLE / 协议 / 模拟设备
static/js/app.js             导航、内存状态与交互协调
tests/                      后端、协议、浏览器流程测试
docs/                       API、BLE 对接与实现对照
instance/system.sqlite3     运行时知识库与系统日志（自动创建）
```

数据库中的 `library_documents` 是植物和计算权重的唯一运行时数据源；仓库 JSON 只用于首次初始化。地点与天气完全来自外部 API，不写入数据库或服务端缓存。启动时清理旧版地点库和旧环境表中的地点记录。已确认地点用一小时有效的签名令牌保存在页面内存中，后端不保存会话；刷新或过期需重新查询。管理端的 Git 功能仅在管理员主动操作时将数据库版本导出为审计快照并提交，不能反向覆盖数据库。前端使用原生 ES Modules，不需要额外 Node 构建链。

## 测试

```powershell
py -3 -m unittest discover -s tests -v
npm ci
npm test
npm run browser:install
npm run test:browser
```

测试命令在 `prototype` 中执行。后端单元测试模拟上游响应，覆盖断网、异常数据及令牌校验。浏览器测试需要启用地图与天气的本地服务、可联网环境、Node.js 22 或更新版本，以及 `npm ci` 安装的项目 Playwright。默认使用 `npm run browser:install` 下载的 Chromium，也可设置 `BROWSER_PATH` 指向本机 Chrome / Edge 来跳过下载。`TEST_URL`、`TEST_ADMIN_TOKEN` 和 `ARTIFACT_DIR` 分别覆盖服务地址、测试管理员密钥和截图目录。`py -3 tests/check_external_apis.py` 验证全部中国省级与下级目录、新设城市及中日英城市天气样本。外部测试会受服务配额和网络影响。

详细需求映射、已测与待联调项目见 [docs/implementation.md](docs/implementation.md)。环境字段与接口说明见 [docs/api.md](docs/api.md)。
