# GPIO2 高低电平切换测试（本机反接映射）

用 Arduino IDE 打开同目录的 `pump_gpio_toggle.ino`，选择 **ESP32C3 Dev Module** 和实际串口后上传。使用 ESP32 板包自带的 Arduino、GPIO、Wire 接口，以及 **U8g2** 库（本机已安装 2.36.19；其他环境可在库管理器搜索安装）。

本机 SIGS1↔SIGS2 已确认反接，泵栅极实际落在 GPIO2，因此本测试固件使用 **GPIO2**。上电后 GPIO2 先输出 HIGH，10 秒后输出 LOW，再过 10 秒输出 HIGH，持续循环。10-01 泵驱动为高电平开泵，所以 HIGH 段应转、LOW 段应停；程序仍按电平命名，便于核对。

板载 OLED 按主固件相同设置驱动：**SSD1306 72×40、SDA GPIO5、SCL GPIO6、地址 0x3C**。屏幕中央大字显示 `HIGH` / `LOW`，顶部 `GPIO2 R:1` / `GPIO2 R:0` 是引脚逻辑回读，底部 `NEXT 10s` 是距下一次切换的倒计时。屏幕每 100 ms 更新一次；若启动时未发现 OLED，每秒重试检测，GPIO2 仍继续按 10 秒间隔切换。

串口监视器设为 **115200**，每次切换会打印类似内容：

```text
0 ms | GPIO2 = HIGH | readback = 1
10000 ms | GPIO2 = LOW | readback = 0
20000 ms | GPIO2 = HIGH | readback = 1
```

串口中的时间以实际运行时刻为准；`readback` 是 ESP32 引脚逻辑回读，并非水泵运行反馈。不连接串口监视器也会持续切换。

观察时分别记录 HIGH、LOW 对应的水泵实际动作。判断控制极性需以 ESP32 与驱动板的共同 GND 为参考；切断 ESP32 GND 后的现象不能作为本测试的高低电平判据。

如果以后把 SIGS1↔SIGS2 改回针1对针1（1=SERVO、2=SOLAR-IN、3=PUMP），泵会回到 GPIO7；此时把本文件的 `PUMP_PIN` 改回 7，并同步把主固件 `board_config.h` 的 `SWS_PUMP_PIN` / `SWS_SERVO_PIN` 改回 7 / 2。

这是独立测试固件。完成后重新上传 `../ble_oled_pairing/ble_oled_pairing.ino`，即可恢复主固件的网页蓝牙功能。
