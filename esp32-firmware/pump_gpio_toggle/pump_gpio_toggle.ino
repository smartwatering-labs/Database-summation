#include <Arduino.h>
#include <driver/gpio.h>
#include <Wire.h>
#include <U8g2lib.h>

constexpr uint8_t PUMP_PIN = 2;  // GPIO2: this unit's reversed SIGS mapping
constexpr uint32_t SWITCH_INTERVAL_MS = 10000;
constexpr uint8_t OLED_SDA = 5, OLED_SCL = 6, OLED_ADDRESS = 0x3C;

U8G2_SSD1306_72X40_ER_F_HW_I2C display(U8G2_R0, U8X8_PIN_NONE, OLED_SCL, OLED_SDA);

uint8_t outputLevel = HIGH;
uint32_t lastSwitchAt = 0;
uint32_t lastDisplayAt = 0, lastOledProbeAt = 0;
bool oledReady = false;

void tryInitOled(uint32_t now) {
  lastOledProbeAt = now;
  Wire.beginTransmission(OLED_ADDRESS);
  if (Wire.endTransmission() != 0) return;
  display.setI2CAddress(OLED_ADDRESS << 1);
  display.begin();
  display.setBusClock(400000);
  display.setPowerSave(0);
  oledReady = true;
  Serial.println("OLED READY | SSD1306 72x40 | SDA=5 SCL=6 address=0x3C");
}

void updateDisplay(uint32_t now, bool force = false) {
  if (!oledReady || (!force && static_cast<uint32_t>(now - lastDisplayAt) < 100)) return;
  lastDisplayAt = now;
  const uint32_t elapsed = now - lastSwitchAt;
  const uint32_t remainingMs = elapsed < SWITCH_INTERVAL_MS ? SWITCH_INTERVAL_MS - elapsed : 0;
  const char* level = outputLevel == HIGH ? "HIGH" : "LOW";
  char line[20];

  display.clearBuffer();
  display.setFont(u8g2_font_5x7_tf);
  snprintf(line, sizeof(line), "GPIO2 R:%d", digitalRead(PUMP_PIN));
  display.drawStr(0, 7, line);
  display.setFont(u8g2_font_10x20_tf);
  display.drawStr((display.getDisplayWidth() - display.getStrWidth(level)) / 2, 28, level);
  display.setFont(u8g2_font_5x7_tf);
  snprintf(line, sizeof(line), "NEXT %lus", static_cast<unsigned long>((remainingMs + 999) / 1000));
  display.drawStr(0, 39, line);
  display.sendBuffer();
}

void printOutputLevel() {
  delayMicroseconds(5);
  Serial.printf("%lu ms | GPIO%u = %s | readback = %d\n",
                static_cast<unsigned long>(millis()),
                static_cast<unsigned>(PUMP_PIN),
                outputLevel == HIGH ? "HIGH" : "LOW",
                digitalRead(PUMP_PIN));
}

void setup() {
  // Preload HIGH before enabling the output to avoid an initial LOW pulse.
  // Arduino-ESP32 digitalWrite() requires pinMode() to have run first.
  gpio_set_level(static_cast<gpio_num_t>(PUMP_PIN), outputLevel);
  pinMode(PUMP_PIN, OUTPUT);
  digitalWrite(PUMP_PIN, outputLevel);

  Serial.begin(115200);
  lastSwitchAt = millis();
  printOutputLevel();
  Wire.begin(OLED_SDA, OLED_SCL);
  Wire.setTimeOut(30);
  tryInitOled(millis());
  if (!oledReady) Serial.println("OLED NOT FOUND | retrying every second");
  updateDisplay(millis(), true);
}

void loop() {
  const uint32_t now = millis();
  if (static_cast<uint32_t>(now - lastSwitchAt) >= SWITCH_INTERVAL_MS) {
    lastSwitchAt = now;
    outputLevel = outputLevel == HIGH ? LOW : HIGH;
    digitalWrite(PUMP_PIN, outputLevel);
    printOutputLevel();
    updateDisplay(now, true);
  }
  if (!oledReady && static_cast<uint32_t>(now - lastOledProbeAt) >= 1000) tryInitOled(now);
  updateDisplay(now);
  delay(1);
}
