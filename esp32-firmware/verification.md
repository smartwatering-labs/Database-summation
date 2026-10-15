# 固件验证记录

日期：2026-09-11。固件 3.4.0，SWS-BLE 1.0，configuration-oled 能力。

- 本机 `build.ps1` 构建成功：Arduino ESP32 3.3.10；NimBLE-Arduino 2.3.6、ArduinoJson 7.4.2、U8g2 2.36.15。
- 目标 `esp32:esp32:esp32c3:CDCOnBoot=cdc`，默认 SSD1306 72×40 / SDA5 / SCL6 / 0x3C。
- 程序 765936 / 1310720 字节（58%）；静态变量 26948 / 327680 字节（8%）。动态 JSON / BLE 内存还会在运行时分配，不能把此值当作峰值占用。
- 输出 `build/ble_oled_pairing.ino.bin`，关联 bootloader、分区和 ELF；`build/manifest.json` 记录源码与应用二进制 SHA256。去掉 Arduino 自动插入的 `#line` 指令后，编译目录中的 main.cpp 与交付源码内容一致。
- 目录调整后，本机 Arduino 构建已重新通过。`tests/test-firmware.ps1` 本次未完成：项目内 PlatformIO MinGW 包缺少 `bits/c++config.h`，本机也没有全局 `g++` / `clang++` / Visual Studio `cl` 可用；这是主机测试编译器缺失，不是 ESP32 固件编译错误。补齐任一 C++ 编译器后可重新运行该测试。
- 本机 Python `-m unittest discover -s tests -p test_*.py` 通过 24 项网站回归测试。
- 原 PlatformIO 6.12.0 / GCC 8.4 路径在本机出现编译器 `CreateProcess` 启动错误，未完成验证；交付脚本走已成功验证的 Arduino 3.3.10 路径。

尚未烧录实物。BLE 无线发现、Windows GATT 通知吞吐、OLED 像素显示、真实 Flash 断电恢复、重启/恢复出厂与具体板型仍需实测。软件测试中的“重启恢复”是共用 Endpoint 重新构造后的持久化回读，不能代替芯片断电试验。

此版本没有传感器采样、泵控制或深度休眠。网页据此显示空采样并隐藏 LONGRUN，`ble.verified=false`。协议文档和 README 列出了后续硬件接入位置。
