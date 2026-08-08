# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run the irrigation system + web dashboard
npm run go
# equivalent to: node src/app.js  — dashboard at http://<rpi-ip>:3000

# Run hardware diagnostics (tests all components, prints ✓/⚠/✗ per item)
npm test
# equivalent to: node src/diagnostics.js

# Live sensor + pump debug (sensors power on, wet sensor activates its pump)
npm run sensor
# equivalent to: node src/sensor.js
```

## Architecture

This is a Raspberry Pi automated irrigation system. All source files are ES modules (`"type": "module"` v `package.json`). Requires Node.js >= 20.

**Entry points:**
- `src/irrigation.js` — exports the `Irrigation` class; `npm run go` runs this directly (no separate `main` wrapper)
- `src/diagnostics.js` — hardware diagnostics, run via `npm test`
- `src/sensor.js` — live sensor/pump debug script, run via `npm run sensor`
- `src/defaultReset.js` — one-off operational script

**Core class — `Irrigation` (`src/irrigation.js`):**
- Constructor initializes all GPIO pins and the MCP23017 I2C expander, then `run()` starts four `setInterval` loops
- Four cycles: irrigation (2 h), temperature/humidity (15 min), safety check (5 s), history write (1 min)
- Irrigation only runs between 08:00–23:00 CZ time (UTC+2 hardcoded)
- History is written to `irrigationHistory.txt` and `safetyShutdownsHistory.txt` in the working directory

**`Dht22Sensor` (`src/dht22.js`):** Wraps `node-dht-sensor` for DHT22 on GPIO 18; returns `{temperature, humidity}` or zeros on error.

## Hardware / GPIO conventions

All pumps and fans are **active-LOW** (driven by EM relays): `LOW` (0) activates, `HIGH` (1) deactivates. Moisture sensors are read as `HIGH` (1) = dry/out-of-water.

Pin assignments (BCM numbering):

| Purpose | Pin(s) |
|---|---|
| Moisture sensor power (all 7 sensors) | 25 |
| Moisture sensor data (GPIO, 7 sensors) | 8, 7, 12, 16, 20, 21, 22 |
| Flowerpot pumps (GPIO, 7 pumps) | 11, 5, 6, 13, 19, 26, 24 |
| Water tank level sensor | 23 |
| DHT22 temp/humidity | 18 |
| Cooling fans | 14 |
| Safety sensors (always powered) | 17, 4, 9 |

MCP23017 I2C expander: address `0x20`, pins 0–5 inputs (moisture sensors), pins 8–13 outputs (pumps), all active-LOW.

## Key operational logic

- **Safety shutdown:** If any of the 3 safety sensors (pins 17, 4, 9) reads LOW (wet floor), `_safetyShutdown` is set and the system locks out new irrigations for 3 hours (`SAFETY_REENABLE_INTERVAL`). Requires manual restart after that.
- **Flowerpot watering:** All 13 pumps draw directly from the main 50 L tank. Each pump runs for a fixed `PUMP_ACTIVATION_DURATION` (30 s). GPIO pumps use `_activateFlowerpotPump()`; MCP pumps use `_activateMcpPump()`. Max 3 irrigations per flowerpot per day (`DAY_IRRIGATION_LIMIT`).
- **Sensor reading:** `_getAllMoistureSensorsData()` powers GPIO pin 25 (all 7 moisture sensors share one power pin), reads all 7 GPIO sensors then all 6 MCP sensors (pins 0–5), returning a 13-element array (indices 0–6 = GPIO, 7–12 = MCP).
- **Cooling:** Fans activate when temperature exceeds 50 °C; they are paused during irrigation cycles and re-enabled after.
