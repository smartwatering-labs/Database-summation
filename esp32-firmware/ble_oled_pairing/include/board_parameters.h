#pragma once
#include <cstdint>

// Fixed driver and control parameters for the 10-01 board.
#ifndef SWS_DHT_MODEL
#define SWS_DHT_MODEL 11
#endif
#if SWS_DHT_MODEL != 11 && SWS_DHT_MODEL != 22
#error SWS_DHT_MODEL must be 11 or 22
#endif
constexpr uint32_t SWS_SENSOR_SETTLE_MS=2000,SWS_SAMPLE_INTERVAL_MS=2000;
constexpr double SWS_SOLAR_DIVIDER=0.2;
constexpr uint32_t SWS_SERVO_MOVE_MS=500;
constexpr int SWS_SERVO_PARK_US=1500,SWS_SERVO_WIPE_US=1600;
namespace sws {
constexpr int SENSOR_ADC_MIN=16,SENSOR_ADC_MAX=4079,RAIN_THRESHOLD=1000;
constexpr bool RAIN_WET_BELOW=true;
}
