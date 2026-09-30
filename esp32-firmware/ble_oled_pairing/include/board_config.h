#pragma once
// Hardware source: 123.1 ESP32C3 chip.md (on-board 72 x 40 OLED, GPIO 5/6).
// Change only this file for a different OLED or board wiring.
#ifndef SWS_OLED_VARIANT
#define SWS_OLED_VARIANT 0 // 0: SSD1306 72x40; 1: SSD1306 128x64; 2: SH1106 128x64
#endif
#ifndef SWS_OLED_SDA
#define SWS_OLED_SDA 5
#endif
#ifndef SWS_OLED_SCL
#define SWS_OLED_SCL 6
#endif
#ifndef SWS_OLED_ADDRESS
#define SWS_OLED_ADDRESS 0x3C
#endif
#ifndef SWS_DEVICE_SECRET
#define SWS_DEVICE_SECRET "SWS2026C3" // Public development profile, matches browser.
#endif
constexpr char SWS_SERVICE_UUID[] = "2d26a7cc-1d45-4eae-9280-2a97346fd001";
constexpr char SWS_WRITE_UUID[] = "2d26a7cc-1d45-4eae-9280-2a97346fd002";
constexpr char SWS_NOTIFY_UUID[] = "2d26a7cc-1d45-4eae-9280-2a97346fd003";
