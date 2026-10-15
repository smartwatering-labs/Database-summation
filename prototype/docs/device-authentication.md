# 设备独立密钥认证

2026-10-15。浏览器与离线入口按握手能力采用同一认证实现。

development 沿用公开开发摘要。hmac-sha256-v1 使用通过 USB 供应的 32 字节设备密钥。所有者凭据为 deviceId 和 64 位十六进制 secret，由用户主动导入当前页面内存。

握手先验证 HMAC-SHA256(key, device|deviceId|nonce) 设备证明，再提交 client|deviceId|nonce 客户端证明。operator 与 viewer 使用各自密钥和 client|role|deviceId|nonce 证明；握手中的 deviceProofs 按角色返回设备证明。后续请求使用 action=secured，payload 包含递增 sequence、原业务 JSON UTF-8 的 Base64 body 和 mac。请求签名覆盖 request|deviceId|nonce|sequence|body，回复使用 response 前缀。回复外层 status=secured，解封装后沿用现有进度、保存回执和二次确认接口。

序号从 1 严格递增，握手和断线重置会话。错误设备证明、未封装消息、内容修改和重放均停止请求。认证配置上限 4000 字节，业务消息上限 8192 字节，历史和事件按实际大小分页。

独立停止通道只执行关闭：单个 GATT 字节 ! 中断普通传输，关闭执行器、清除旧请求并返回停止回执，再重新握手核对状态。

身份密钥位于 waterauth NVS，恢复出厂保留身份。USB 工具先核对设备 ID，以新文件保存凭据；已有密钥须通过明确的 --rotate 轮换。--role operator 可执行运行操作，不能改配置或恢复出厂；--role viewer 可读状态、历史、事件、配置与时间探测，并可执行紧急停止。USB --revoke 撤销非所有者角色。撤销或轮换后应断开现有 BLE 会话并重连。配置导出和后端生成处理业务配置，凭据独立管理。

HMAC 提供设备身份和消息完整性。设备启动时已有所有者密钥，则 BLE 写入特征要求加密；首次供应所有者密钥后重启设备使该属性生效。无输入输出设备使用 Just Works 配对，链路加密自身不提供抗主动中间人保护，应用层仍需核验 HMAC 设备证明。NVS 密钥未启用 Flash 加密，生产发布需评估物理读取风险。供应、轮换及断电后的身份恢复需在实物上确认。
