# 本地运行与上线部署

网站使用标准 Python + Flask + Waitress，入口为 `app.py`。本机已用 Python.org 的 [Python 3.13.15](https://www.python.org/downloads/release/python-31315/) 安装包配置独立 Python，并校验安装包 SHA-256 和发布者签名。旧 `.venv` 已移除，程序和浏览器测试不需要 OpenAI 提供的运行时。Python 安装在 Windows 当前用户的常规程序目录，后续可以正常升级或卸载。

## 本地启动

双击 `prototype/start.bat`，或在项目根目录执行 `./prototype/start.ps1`。在新电脑先安装官方 Python，然后执行 `./prototype/start.ps1 -InstallDependencies`。依赖通过该脚本选定的解释器安装，避免 `pip` 和 `python` 指向不同环境。

终端中会显示 Python 路径与访问地址。服务默认在 `http://127.0.0.1:5000`；终端关闭或 Ctrl+C 后停止。若端口已被占用，关闭旧网站进程，或设置 `$env:PORT='5001'` 后启动。

手动方式（在 `prototype` 内）：

```powershell
py -3 -m pip install -r requirements.txt
py -3 app.py
```

`app.py` 和启动脚本读取操作系统环境变量，不自动加载 `.env`。`.env.example` 专供 Docker Compose；本地开发使用 README 中的 `$env:变量名='值'` 方式。

## 上传哪些文件

部署应用目录为 `prototype`，必须包含 `app.py`、`requirements.txt`、`engine/`、`knowledge_base/`、`templates/`、`static/`。Docker 方式另需 `Dockerfile`、`.dockerignore` 和 `compose.yaml`。

不上传本地 Python 安装目录、旧虚拟环境、`node_modules/`、测试截图或开发数据库。`instance/system.sqlite3` 会自动创建；部署用户需要对 `instance/` 有写权限。需要保留系统维护日志时，为该目录配置持久化存储。后端不存储用户配置和设备历史。

## Docker 部署

服务器安装 Docker Engine 和 Compose 后，在应用目录执行：

```sh
cp .env.example .env
python3 -c 'import secrets; print(secrets.token_urlsafe(32))'
```

将生成的随机值写入 `.env` 的 `ADMIN_TOKEN=`，再生成另一随机值写入 `LOCATION_TOKEN_SECRET=`。填写真实管理域名和地图服务联系信息后启动：

```sh
docker compose up -d --build
docker compose logs --tail=50 watering
curl -f http://127.0.0.1:5000/api/settings
```

容器使用官方 `python:3.13-slim` 镜像和非 root 用户运行。Compose 默认启用 `APP_ENV=production`，关闭模拟入口，以命名卷持久化 `instance/`，端口只绑定服务器回环地址。管理员密钥缺失或仍为开发默认值时，部署会失败并给出错误。

更新代码后重复 `docker compose up -d --build`。停止服务用 `docker compose down`；通常不要加 `-v`，该参数会删除系统数据卷。

## 域名与 HTTPS

把公共域名和管理子域名都解析到服务器，在同一服务器上用 Nginx / Caddy 配置 HTTPS，将请求反向代理到 `127.0.0.1:5000`。生产 `.env` 必须将 `ADMIN_HOSTS` 设为管理子域名，并为地点服务设置带真实联系地址的 `GEOCODING_USER_AGENT`。例如已有 Caddy 环境时，用实际域名替换：

```caddyfile
watering.example.com {
    reverse_proxy 127.0.0.1:5000
}

admin.watering.example.com {
    reverse_proxy 127.0.0.1:5000
}
```

域名、证书和代理服务由部署环境配置。本轮没有购买域名或发布公网服务。远程 Web Bluetooth 需要 HTTPS 和支持该 API 的浏览器；普通局域网 HTTP 地址不能替代安全上下文。

## 不使用 Docker

在服务器安装受支持的 Python，用服务器自己的环境安装 `requirements.txt`。可以使用服务器创建的标准 venv 做包隔离，但不能上传本机虚拟环境。把 `python app.py` 交给 systemd 或主机平台进程管理器，设置工作目录为应用目录，并配置：

- `APP_ENV=production`
- `ADMIN_TOKEN=独立生成的强密钥`
- `LOCATION_TOKEN_SECRET=另一独立生成的强密钥`（至少 32 字符，多进程共享同一个值）
- `DEMO_ENABLED=0`
- `HOST=127.0.0.1` 和 `PORT=5000`（平台要求监听所有网卡时使用 `HOST=0.0.0.0`，同时配置平台入口和访问限制）
- `ADMIN_HOSTS=admin.watering.example.com`
- `GEOCODING_USER_AGENT=WateringPlatform/1.0 (ops@watering.example.com)`
- 按固件填写三个 `BLE_*_UUID`，其余环境变量见 README。

`app.py` 已使用 Waitress，不需要 Flask 开发服务器。静态托管服务无法运行此 Python API，需要支持 Python 进程或容器的主机。

## 当前验证范围

地点与天气均需要服务器能访问外部 HTTPS API。国家、中国省市和海外主要城市分别使用外部 JSON 数据接口，地址可通过环境变量替换，详见 [地点联动说明](locations.md)。大多数城市直接使用外部中心点，尚无坐标的城市通过 Nominatim 查询；天气使用 Open-Meteo。无内部地点目录、天气缓存或静态降级。地点选择令牌有效期一小时；未设置固定签名密钥的本地服务重启后，旧令牌失效，重新选择即可。

国家自动补全在外部返回列表的页面内存副本中筛选，不逐字请求 Nominatim。需要补查坐标时，仅在选择城市后请求；该适配器每进程最多每秒发起一次请求。公共服务限制按整个应用计算，生产多实例应通过统一网关限流，或配置合适配额和许可的地图服务。遵循 [Nominatim 使用政策](https://operations.osmfoundation.org/policies/nominatim/) 与 [Open-Meteo 条款](https://open-meteo.com/en/terms)。不得批量穷举地理编码接口。

升级启动会删除旧数据库中的地点目录和旧环境表的地点条目；植物、计算系数、维护日志保留。已有备份、用户主动导出的配置文件不自动删除。反向代理应避免记录请求体，以免把地点输入和令牌写入访问日志。

已在本机官方 Python 中运行后端测试、检查依赖并启动服务。Docker 配置作为部署入口提供，本机没有 Docker，因此没有声称已完成容器构建或服务器验证。真实 BLE 仍按 [联调清单](ble-protocol.md#上实物前必须完成) 验证。

参考：[Python Windows 安装说明](https://docs.python.org/3.13/using/windows.html)、[Flask 使用 Waitress 部署](https://flask.palletsprojects.com/en/stable/deploying/waitress/)、[Docker Compose 环境变量](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/)。
