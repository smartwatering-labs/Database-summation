# ESP32-C3 蓝牙配置与 OLED 固件

固件版本 **3.4.0**，协议 **SWS-BLE 1.0**。网页和设备共用固定 GATT UUID，支持接收网站生成的客制化配置、校验、保存到 NVS、读回、状态查询和 OLED 显示。上电即广播，断开后恢复广播，无网页连接也保持显示。

本工程是可独立烧录的通信与显示固件。它尚未接入传感器、继电器、伺服机构、自动浇水和深度休眠；不会把固定数字冒充实测采样。`DISPLAY` / `PREPARE` 仅切换状态名称，都保持蓝牙在线；不接受 `LONGRUN`。网页根据握手能力显示这一边界。

## 1. 硬件默认值

依据项目 `123.1 ESP32C3 chip.md`，默认目标为 ESP32-C3、4 MB Flash、板载 **72×40 OLED**。OLED 暂按 SSD1306、I²C 地址 `0x3C`、SDA GPIO5 / SCL GPIO6 配置。控制器与引脚仍需以你的实物确认；资料中接口命名并不完全一致。

在 `ble_oled_pairing/include/board_config.h` 调整：

| 配置 | 默认 | 其他选项 |
| --- | --- | --- |
| SWS_OLED_VARIANT | 0 | 0=SSD1306 72×40；1=SSD1306 128×64；2=SH1106 128×64 |
| SWS_OLED_SDA / SWS_OLED_SCL | 5 / 6 | 实际 I²C 引脚 |
| SWS_OLED_ADDRESS | 0x3C | 例如 0x3D，填写七位地址 |

OLED 未响应时仍启动蓝牙，串口输出 `OLED=missing`。固件不对泵或继电器引脚写入控制信号。原资料对继电器有效电平、土壤 ADC 标定存在冲突，整机控制需另行核对。

## 2. 在本机编译和烧录

优先使用本机 **Arduino IDE 2 / Arduino CLI**，不需要 OpenAI、Codex 或项目虚拟环境。

第一次操作请直接按照 [ESP32-C3 固件上传详细步骤](烧录步骤.md) 执行，其中包含开发板菜单、端口识别、BOOT/RESET 操作、上传后验证和故障排查。

1. Arduino IDE 的开发板管理器安装 **esp32 by Espressif Systems 3.3.10**。
2. 库管理器安装 **NimBLE-Arduino 2.3.6**、**ArduinoJson 7.4.2**、**U8g2 2.36.15**。库可能显示作者 h2zero、Benoit Blanchon、oliver。
3. 打开 `ble_oled_pairing/ble_oled_pairing.ino`，选择 **ESP32C3 Dev Module**，Flash Size **4 MB**、USB CDC On Boot **Enabled**。本机项目已有这三份依赖时，下面的脚本会优先使用项目内版本；IDE 使用库管理器的版本。
4. 点击“验证”编译。插入板子后选择对应串口，再点击“上传”。上传将替换板子当前程序；不勾选擦除所有 Flash，正常更新保留 NVS 配置。

也可双击当前目录 `build.bat`，只编译，不会自动选择设备烧录。PowerShell 命令：

```powershell
# 在本目录运行；只构建
.\build.ps1
# 查看端口
.\build.ps1 -ListPorts
# 指定你实际看到的端口后编译并上传；COM5 仅为示例
.\build.ps1 -Upload -Port COM5
```

如果 Arduino IDE 安装位置不同，增加 `-ArduinoCli '实际路径\arduino-cli.exe'`。上传失败时先关闭串口监视器，确认 USB 数据线与端口；必要时使用板子的 BOOT / RESET 按钮进入下载模式。不同板子的 USB / UART 电路不同，以实物为准。

构建输出位于 `build/`，包括 `ble_oled_pairing.ino.bin`、bootloader 和分区文件；使用 Arduino 上传流程会自动选择正确偏移。不要仅凭文件名猜测烧录地址。`platformio.ini` 保留了 Arduino 2.0.17 的另一套构建配置，本次推荐 Arduino 3.3.10 路径。

## 3. 从网站连接

1. 双击 `prototype/start.bat`，用支持 Web Bluetooth 的 Chrome / Edge 打开 `http://127.0.0.1:5000`。HTML 入口仅负责打开本地服务。
2. 板子上电，OLED 显示“蓝牙:未连接”。不需要先在系统设置中配对。
3. 网站点击“连接设备”，选择 **SWS-ESP32C3**，保留默认 UUID；等待握手认证。
4. 在“个性化库编译”生成配置，点击原位置的发送按钮。网站显示成功的条件是固件返回 `saved:true` 且 revision 一致。
5. “硬件情况查看”可以读取配置与版本、切换 DISPLAY / PREPARE、重启及恢复出厂。重启后需重新连接。

服务 UUID：`2d26a7cc-1d45-4eae-9280-2a97346fd001`；写入特征末尾 `002`；通知特征末尾 `003`。设备 ID 使用芯片完整 MAC 派生，显示为 `C3-xxxxxxxxxxxx`。只允许一个连接客户端。

## 4. OLED 行为

屏幕顶行始终显示真实 BLE 链路状态“蓝牙:连接”或“蓝牙:未连接”，这与完成应用层认证是两个状态。

- 空闲：显示等待连接、等待认证或等待数据包，以及当前配置版本 R。
- 收包：显示已收到分包数 / 总分包数。
- 保存成功：约 18 秒轮播配置版本、阈值、脉冲次数、ON/OFF 毫秒、土/温/空气权重、日需水量、每轮水量、流量、估计间隔和储水天数；缺失可选数值显示 `--`。
- 校验或操作失败：短暂显示失败信息，详细原因由网页展示。
- 轮播结束：自动回到蓝牙状态与等待信息；重启恢复配置版本，但不重复播放旧的保存成功提示。

## 5. 保存和通信约束

- 业务消息最大 8192 字节、配置最大 6144 字节、最多 70 帧；每帧业务数据 120 字节。网页握手后协商并提前校验容量。
- 全包 UTF-8 CRC32、严格 Base64、重复帧一致性检查、20 秒接收超时；中途断开不会提交不完整配置。
- 校验型号、版本、递增 revision、权重和、阈值、脉冲范围及六分钟单轮上限；收到配置不会执行泵动作。
- `watercfg/package` 单个 NVS blob 保存 CRC32 和完整配置；仅在写入成功、回读字节一致后报告保存成功。开机重新读取并检查 CRC 和配置结构。
- 随机 nonce / 二次确认令牌有效期 30 秒、单次使用；断开即清除会话。重启和恢复出厂在最终回执排队发出后执行，网页仍需处理断线。
- 开发认证为 SHA-256(nonce + `SWS2026C3`)。公开口令不提供生产级设备身份认证或链路加密；更换口令必须同步网页认证适配器，量产需设计独立的设备密钥供应方案。

完整消息契约见 `docs/ble-protocol.md`。

## 6. 验证与待联调

`ble_oled_pairing/include/sws_core.h` 同时用于设备和本机 C++ 测试程序，测试不是另一套模拟协议实现。`tests/firmware.test.mjs` 使用网页的真实分包与设备控制代码，通过编译后的 C++ 程序验证配置收发、中文 UTF-8、CRC、乱序/重复、超时、认证消费、令牌过期、递增版本、重启恢复、存储失败、恢复出厂等路径。

本机复测：在 `esp32-firmware` 执行 `.\tests\test-firmware.ps1`（需要本机 MinGW 和 Node；脚本可指定编译器及 ArduinoJson 路径）。Node 与 MinGW 仅用于开发测试。时间和 NVS 在本机测试中通过硬件适配层模拟；实际 ESP32 使用 mbedTLS、NimBLE 和 Preferences。

还需用实物完成：板型/屏幕控制器/I²C 引脚核对，Windows 蓝牙发现和重连，完整配置收发，真实断电后读回，中途断线不保存，OLED 每页可读，重启和恢复出厂。没有完成这些检查前，网站设置中 `ble.verified` 保持 false。

历史主程序文件 `SWS_33.ino` / `SWS_35.ino` 在资料中被引用，但仓库没有对应源码。这份固件不能直接声称保留原主程序的浇水与传感器功能；后续集成位置是 `sws::Platform` 硬件适配层与 Endpoint 状态/历史接口。
