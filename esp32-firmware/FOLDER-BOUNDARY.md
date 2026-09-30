# 目录边界

此目录包含 ESP32-C3 固件源码、编译/烧录脚本、生成物、固件专用测试和本地编译工具，不参与网站部署。

网站运行目录是相邻的 `prototype/`。网站只通过浏览器 Web Bluetooth 与已烧录的设备通信，不会读取此目录中的源码或二进制文件。两边依靠 `SWS-BLE 1.0`、三个固定 GATT UUID 和握手声明的容量保持兼容。

部署网站时可只复制 `prototype/`。修改 BLE UUID、认证算法、协议版本、配置字段或容量限制时，需要同步检查 `prototype/static/js/services/` 与本目录的 `ble_oled_pairing/include/sws_core.h`、`ble_oled_pairing/ble_oled_pairing.ino`。
