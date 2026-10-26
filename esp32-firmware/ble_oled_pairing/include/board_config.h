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
// This unit's SIGS1<->SIGS2 cable is reversed: GPIO2 reaches the pump gate
// (Q7/R1/R17) and GPIO7 reaches SERVO1. The two outputs are swapped below so
// the web/OLED pump and servo commands reach the correct device. If the cable
// is corrected to pin1-pin1, restore PUMP=7 and SERVO=2.
constexpr uint8_t SWS_SENSOR_POWER_PIN=0,SWS_SOLAR_PIN=1,SWS_SERVO_PIN=7;
constexpr uint8_t SWS_RAIN_PIN=3,SWS_SOIL_PIN=4,SWS_PUMP_PIN=2,SWS_DHT_PIN=10;
constexpr uint8_t SWS_PUMP_ON_LEVEL=HIGH,SWS_PUMP_OFF_LEVEL=LOW;
// Set this only after the assembled board has a verified active-low wake button.
// The 10-01 pin list assigns no such button; timer wake remains available.
#ifndef SWS_WAKE_PIN
#define SWS_WAKE_PIN -1
#endif
#if SWS_WAKE_PIN < -1 || SWS_WAKE_PIN > 21
#error SWS_WAKE_PIN must be -1 or an ESP32-C3 GPIO number
#endif
#if SWS_WAKE_PIN == 8 || SWS_WAKE_PIN == 9 || SWS_WAKE_PIN == 18 || SWS_WAKE_PIN == 19 || SWS_WAKE_PIN == 0 || SWS_WAKE_PIN == 1 || SWS_WAKE_PIN == 2 || SWS_WAKE_PIN == 3 || SWS_WAKE_PIN == 4 || SWS_WAKE_PIN == 5 || SWS_WAKE_PIN == 6 || SWS_WAKE_PIN == 7 || SWS_WAKE_PIN == 10
#error SWS_WAKE_PIN conflicts with a reserved or assigned 10-01 pin
#endif
