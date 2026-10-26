# SWS-BLE 1.0 通信契约

适用于网页 `sws-json-v1` 和 ESP32-C3 固件 **3.8.0**。10-01 运行能力为 `watering-board-10-01`，旧通信固件沿用 `configuration-oled`。模式、自动运行前置及认证均由握手声明，真机结果与软件验证分别记录。

## GATT 与连接

| 用途 | UUID | 属性 |
| --- | --- | --- |
| 服务 | 2d26a7cc-1d45-4eae-9280-2a97346fd001 | 设备广播此服务 |
| 网页 → 设备 | 2d26a7cc-1d45-4eae-9280-2a97346fd002 | WRITE，带响应写入；所有者密钥已供应并重启后要求链路加密 |
| 设备 → 网页 | 2d26a7cc-1d45-4eae-9280-2a97346fd003 | NOTIFY，连接后先订阅 |

设备广播名 `SWS-ESP32C3`，只允许一个客户端。网页通过 UUID 过滤发现，不先通过操作系统手动配对。需要支持 Web Bluetooth 的浏览器、localhost 或 HTTPS、用户点击和蓝牙授权。断线后设备恢复广播，重新连接必须重新握手。设备 ID 使用完整芯片 MAC 派生。

NimBLE 回调只把接收字节送入有界队列；JSON、认证、NVS 与 OLED 在主循环处理。发送通知按队列执行，失败重试超过 3 秒关闭连接；RX / TX 超限也关闭连接，避免继续处理残缺数据。

## 业务消息

请求：

```json
{"id":"唯一消息编号","protocol":"SWS-BLE","protocolVersion":"1.0","action":"status","payload":{}}
```

成功：`{id,protocol,protocolVersion,status:"ok",payload:{...}}`。
失败：`{id,protocol,protocolVersion,status:"error",message:"可展示原因"}`。
进度：`{id,protocol,protocolVersion,status:"progress",stage:"validating"}`。

id 非空、最多 80 字节；请求 payload 必须为对象。最终响应沿用请求 id；进度消息不结束请求。尚未识别有效 id 的损坏分包不发送无归属响应，网页按超时处理。

## 分包与容量

完整业务 JSON → UTF-8 → 每帧最多 120 字节 → Base64，外层 JSON 后追加换行：

```json
{"id":"唯一消息编号","index":0,"total":8,"checksum":"8位小写CRC32","data":"Base64片段"}
```

CRC32 针对完整 UTF-8 业务 JSON，多项式 `0xedb88320`、初始值和最终异或 `0xffffffff`。初次握手的写入默认按 20 字节传输；握手后使用设备返回的 writeChunkBytes，按实际 MTU−3、最多 244 字节发送，MTU 为 23 时保持 20 字节。通知也遵守相同容量。换行可能跨 GATT 写入/通知边界，接收端先拼行再拼帧。

- 固件：完整业务消息 **8192 字节**，配置 JSON **6144 字节**，最多 **70 帧**，单行最多 **512 字节**，同时仅一条未完成消息。
- index 从 0 开始。接受乱序帧、内容完全一致的重复帧；拒绝冲突重复、元信息不一致、非规范 Base64、超限和 CRC 错误。
- 整条未完成消息 / 未完成分包行超时 **20 秒**，主动清除。断线清除重组、通知队列、认证与操作令牌。
- 握手返回 `transport:{maxMessageBytes:8192,maxConfigBytes:6144,maxFrames:70,framePayloadBytes:120,writeChunkBytes:20}`；示例写入容量为默认值，运行适配器按实际协商 MTU 更新该字段。网页在写 GATT 前检查 UTF-8 字节数及帧数，并使用协商值。
- 网页通用接收器保留 64 KB / 1024 帧 / 最多 8 条消息的防护上限；设备输出仍遵守本固件的较小上限。
- 网页请求串行，单次总超时 20 秒。status / history / getConfiguration 因超时或损坏最多重试一次；所有写入与确认操作不自动重放。

GATT 写响应不等于配置保存。配置发送结果未知时，重新连接并读取设备配置核对。

## 握手与认证

1. `handshake` 返回协议、型号、设备 ID、版本、nonce、transport、runtimeProfile、supportedModes、automaticWatering、authProfile 和 capabilities。3.7.0 增加逐通道准备期摘要、五态质量、时间探测与角色授权；LONGRUN 在标定、配置、存储和时间前置就绪时出现。
2. 网页验证设备身份、型号和固件版本不低于 3.3。同一连接中设备 ID 改变会停止操作。
3. 开发认证：小写十六进制 SHA-256(nonce + `SWS2026C3`)；`authenticate` payload 为 `{auth}`。
4. 固件随机 nonce 有效 **30 秒**，成功或失败尝试均消费 nonce；成功返回 `{authenticated:true}`。断开或重新握手清除认证。
5. 除握手和认证外，所有操作需要已认证。配置 / 管理操作前网页重新握手；保存成功后固件消费认证状态，网页再次认证以读取结果。

开发口令用于未供应密钥的调试设备。生产身份使用 owner、operator、viewer 独立密钥和应用层 HMAC；密钥设备的 BLE 写入特征要求链路加密。Base64 / CRC32 用于编码与损坏检测。

## 动作与响应

| action | 请求 payload | 成功 payload / 行为 |
| --- | --- | --- |
| handshake | `{}` | 上述握手字段 |
| authenticate | `{auth,role?}` | `{authenticated:true,role}`，默认 owner |
| status | `{}` | deviceId、fwVersion、mode、plant、configRevision、configured、sample、storageReady、uptimeSeconds、bluetoothConnected、authenticated 等 |
| history | `{range:"7d",cursor:null,limit:24}` | `{deviceId,records:[],nextCursor:null,source:"no-sensor-data"}` |
| getConfiguration | `{}` | `{config}`，未配置时 config=null |
| setConfiguration | `{config}` | 校验、写入、回读一致后返回 `{saved:true,revision}` |
| prepareOperation | `{operation:"mode",mode:"PREPARE"}` 或 operation=`restart`/`factoryReset` | `{confirmationToken,expiresInSeconds:30}` |
| confirmOperation | `{confirmationToken}` | `{confirmed:true,mode}`；执行已绑定的操作 |
| manualServo | `{}` | `{started:true,durationMs}`；按实测端点执行一次舵机往返 |
| manualPump | `{on:true}` / `{on:false}` | `{pumpOn,maxRunSeconds:30}`；GPIO7 开泵或关泵 |

设备的 sample 携带 bootCount、sampleSeq、sampledAt、lastSyncAt、timeQuality、通道 quality、温湿度、土壤/雨量 ADC、太阳能电压与需求值；无效数值为 null。quality.status 为 valid / suspect / invalid / stale / unconfigured，包含连续失败数、跳变数及最近有效采样时间。history / events 按游标和实际 UTF-8 大小分页，最大 24 条。status 同时返回 authorizationRole、lastSyncAt、calibrationReady、controlState、controlInhibition、间隔剩余秒数、prepareSummary 和 quickCheck。prepareSummary.channels 含逐通道有效/失败次数、均值、极值、最大单次变化及采样区间，baseline 保存各通道基准。偏离事件携带 referenceMin/referenceMax、observedSummary 和恢复值。

syncTime 可请求 epochSeconds，或 sentAtEpochMs 与 estimatedOneWayMs；timeProbe 供网页测量一次 BLE 往返，设备返回 uptime 与时间可信状态。quickCheck 在 DISPLAY 开始三轮检查，可传 stimulatedSensorKey 并由操作人立即改变对应输入，以识别持续不变的通道。stop 关闭执行器并确认 stopped。独立 GATT 字节 ! 中断传输并返回 id=emergency-stop 的停止回执。密钥设备的双向认证、角色权限及消息封装见 prototype/docs/device-authentication.md。

3.8.0 握手声明 `manual-control`。手动命令须完成认证，仅 owner / operator 可执行；在 DISPLAY 模式执行，舵机要求实测标定且不能与水泵同时运行。status 增加 `manualPumpOn` 与 `servoBusy`，网页据设备状态显示按钮。水泵开启最多 30 秒，超时、BLE 断开、模式切换及停止操作均关泵；设备拒绝缺失布尔值的开关命令。旧固件未声明此能力时网页禁用按钮。

二次确认令牌绑定当前会话与操作，30 秒内单次使用；错误令牌、重新握手和断线使其失效。DISPLAY 和 PREPARE 保持在线；LONGRUN 在运行前置就绪时接受，断开 BLE 后按采样与脉冲流程进入深睡。恢复出厂清除业务配置、标定和运行记录，保留身份；重启操作先发最终回执，再执行重启，回执丢失时重连核对。

## 配置校验与持久化

配置使用 `deviceModel:"ESP32-WATER-C3"`、`configVersion:"1.0"` 或 `"2.0"`、递增整数 revision 和 params。设备声明 `maxConfigVersion:"2.0"`、`minimum-interval` 与 `target-bound-config`；浏览器按能力生成 2.0，设备核对本机 ID 并执行间隔保护。

| 字段 | 约束 |
| --- | --- |
| revision | 1–2147483647，必须大于设备已保存版本 |
| plant | 非空字符串，UTF-8 不超过 600 字节 |
| soilWeight / tempWeight / airWeight | 有限数字 0–1，和与 1 的误差不超过 0.015 |
| threshold | 20–90 |
| pulseCount | 整数 1–12 |
| pulseOnMs | 整数 500–5000 |
| pulseOffMs | 整数 5000–60000 |
| pulseCount × (pulseOnMs + pulseOffMs) | 不超过 360000 ms |
| targetDeviceId（2.0 必填） | 与当前芯片派生的设备 ID 一致，1–64 位 ASCII 字母、数字、`-`、`_` |
| params.minWaterIntervalSeconds（2.0 必填） | 整数 3600–2592000 秒，自主运行的最短间隔 |
| supplyVariant（可选） | builtin 或 valve |
| display 数值（可选） | dailyWaterNeedMl、roundWaterMl、estimatedIntervalDays、reservoirDays、flowRateMlSec，0–1000000 |

拒绝字符串数字、布尔数值、缺失必填、错误版本、过大包。其他元数据原样保存在配置中；网页导入先经过后端规范字段过滤。收到 `recommendedMode` 不会自行启动该模式或水泵。

NVS 命名空间 `watercfg`，键 `package` 保存单个 blob：四字节 CRC32 + 完整 UTF-8 配置。revision、植物名称直接从同一个 blob 读取，不分散写多个键。只有 putBytes 返回完整长度且回读与原文一致后发送 saved；失败显示“未确认保存”。重启检查长度、CRC、配置结构，无有效配置则版本为 0，并显示错误。该存储格式不自动迁移以前验证稿的零散 NVS 键，需要重新发送配置。

网页只有 `saved:true` 且 revision 匹配才提示成功。已得到最终保存回执后，即使后续状态读取失败仍保留已保存事实，并提示重连核对。

## OLED 与验证

顶行持续显示 BLE 链路“连接 / 未连接”；其余两行显示认证等待、收包进度、失败，或保存后约 18 秒的配置数字轮播。默认布局适配 72×40，支持在 board_config.h 切换 128×64 控制器。

软件验证使用与 ESP32 相同的 C++ Receiver / Endpoint，并由网页真实 FrameDecoder、BleTransport、DeviceController 驱动。测试包含正常读写、中文分包、乱序重复、CRC 错误、超时恢复、nonce 消费、令牌过期、非法配置、存储失败、模拟重启持久化及恢复出厂。主机测试的存储与时钟为注入适配器，不能替代真实 Flash 断电试验。

实物待测：GATT、OLED、ADC/DHT、MOS 泵与舵机、供电、NVS/LittleFS 断电、停止、GPIO 保持、深睡与连续运行。完成前 `ble.verified=false`。
