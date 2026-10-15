# 设备数据与配置契约

更新：2026-10-15。协议 SWS-BLE 1.0；整机源码 3.7.0，配置格式 1.0 / 2.0。网页按真实握手能力启用功能，旧 configuration-oled 固件继续使用原有配置和空采样路径。

## 配置

2.0 要求 targetDeviceId 与当前设备一致、params.minWaterIntervalSeconds 为 3600–2592000 的整数秒。生成、导入、浏览器、固件、NVS 与读回使用同一契约。配置接收不会自动切换运行模式；正在执行脉冲时拒绝新配置。

environmentReference 为可选审核范围摘要，包含种植位置、标题、引用和至少一组完整的温度或湿度范围。生成端只采用已审核且位置匹配的条目；设备记录持续偏离和恢复事件。默认植物参数按工程建议管理。

## 采样与保护

sample 携带 bootCount、sampleSeq、sampledAt、timeQuality；deviceId + bootCount + sampleSeq 标识一次采样。未校时用启动序号表示，不填造日期。通道包含温湿度、土壤与雨量原始 ADC、太阳能输入电压及 quality；无效值为 null。

质量状态为 valid、stale、invalid、missing。开启空气读数替代后，stale 附带原采样序号和 ageSeconds，最大十分钟；土壤和雨量继续要求当前有效数据。准备期只统计直接有效样本。太阳能电压在实测分压标定完成后提供。

status 还包含 calibrationReady、controlState、controlInhibition、minIntervalRemainingSeconds、logStorageReady、prepareSummary 和 quickCheck。网页展示设备事实，趋势去重并跳过无效土壤对应需求点。

## 事件和历史

事件包含事件 ID、启动/事件序号、代码、级别、通道、配置 revision、发生与恢复时间、时间质量和控制影响。设备复测决定恢复；未校时恢复时间可为 0，仍标识已经恢复。

history 与 events 串行分页，每页最多 24 条，并按 UTF-8 容量进一步缩小。历史最多 168 条 / 48 KiB，事件最多 48 条 / 20 KiB；LittleFS 双槽、序号、记录数和逐字节 CRC 保护快照，逐条读写控制内存峰值。

## 运行操作

DISPLAY 周期采样、保持 BLE；PREPARE 执行十分钟统计；LONGRUN 要求标定、2.0 配置、可信时间及存储。syncTime 校时，quickCheck 开始三轮检查，stop 关闭执行器。独立 GATT 字节 ! 中断普通请求，停泵、清理会话并返回停止回执；网页再握手核对。

实测辅助生成由用户主动选择准备期报告，核对目标、revision、标定、可信时间、十分钟时长、样本数/有效率和一小时新鲜度；温湿度均值及标定流量进入该次计算，区域地点和天气继续查询。报告和结果为临时数据。

## 认证和验收

握手声明 development 或 hmac-sha256-v1。独立密钥设备使用双向证明和带序号的 HMAC 消息；说明见 device-authentication.md。业务包 8192 字节，开发配置 6144 字节，密钥认证配置 4000 字节。

源码、主机测试与模拟页面验证记录在完成情况文件中；真实 GATT、GPIO、Flash、负载和深睡结果在接板后登记。设备 verified 状态由实物验收更新。
