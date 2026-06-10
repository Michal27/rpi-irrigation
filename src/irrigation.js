import Dht22Sensor from './dht22.js';
import OnOff from 'onoff';
import MCP23017 from 'node-mcp23017';
import * as fs from 'fs';

const Gpio = OnOff.Gpio;

// Auto-detect GPIO sysfs base offset.
// Kernel 6.6+ (Raspberry Pi OS Trixie) shifted GPIO numbering by +512.
// Older kernels used base 0. We find the main BCM chip by its pin count (54).
function detectGpioOffset() {
    try {
        const chips = fs.readdirSync('/sys/class/gpio')
            .filter(d => /^gpiochip\d+$/.test(d));
        for (const chip of chips) {
            const ngpio = parseInt(fs.readFileSync(`/sys/class/gpio/${chip}/ngpio`, 'utf8').trim());
            if (ngpio >= 50) { // main BCM GPIO chip has 54 pins
                return parseInt(fs.readFileSync(`/sys/class/gpio/${chip}/base`, 'utf8').trim());
            }
        }
    } catch {}
    return 0; // fallback for older kernels where base was 0
}

export const GPIO_OFFSET = detectGpioOffset();

const IRRIGATION_CYCLE_INTERVAL = 7200000; //miliseconds = 2 hours
const TEMPERATURE_AND_HUMIDITY_CYCLE_INTERVAL = 900000; //miliseconds = 15 minutes
const SAFETY_CHECK_INTERVAL = 5000; //miliseconds = 5 seconds
const WRITE_HISTORY_INTERVAL = 60000; //miliseconds = 1 minute
const START_COOLING_TEMPERATURE_LIMIT = 50; //°C
const DATA_HISTORY_LIMIT = 60; //irrigation cycles measurement history
const SAFETY_EVENT_LOG_LIMIT = 100; //safety event log entries
const TEMPERATURE_HUMIDITY_HISTORY_LIMIT = 672; //7 days × 96 readings/day (15 min interval)
const DAY_IRRIGATION_LIMIT = 3;
const PUMP_ACTIVATION_DURATION = 120000; //miliseconds = 2 minutes (default)
const PUMP_DURATION_OVERRIDES = {
    2:  60000,  // truhlík 3  (rajče oranžové)
    3:  60000,  // truhlík 12 (salát)
    10: 60000,  // truhlík 5  (pažitka)
    11: 60000,  // truhlík 6  (salát)
};

// Free GPIO pins (BCM): 10, 15, 27
// Free MCP23017 pins:   6, 7, 14, 15

export const moistureSensorsPowerPin = 25;
export const moistureSensorsDataPins = [8, 7, 12, 16, 20, 21, 22];
export const gpioPumpsPins = [11, 5, 6, 13, 19, 26, 24];
export const waterTankLevelSensorPin = 23;
export const temperatureAndHumiditySensorPin = 18;
export const fansPin = 14;
export const safetyPin1 = 17;
export const safetyPin2 = 4;
export const safetyPin3 = 9;

export const mcpPumpPins = [8, 9, 10, 11, 12, 13];
export const mcpSensorPins = [0, 1, 2, 3, 4, 5];

export default class Irrigation {

	constructor() {
		this._gpioPumps = this._inicializeGpioPins(gpioPumpsPins, 'high');
		this._moistureSensorsPower = this._inicializeGpioPin(moistureSensorsPowerPin, 'high');
		this._moistureSensors = this._inicializeGpioPins(moistureSensorsDataPins, 'in');
		this._waterTankLevelSensor = this._inicializeGpioPin(waterTankLevelSensorPin, 'in');
		this._coolingFans = this._inicializeGpioPin(fansPin, 'high');
		this._safetySensor1 = this._inicializeGpioPin(safetyPin1, 'in');
		this._safetySensor2 = this._inicializeGpioPin(safetyPin2, 'in');
		this._safetySensor3 = this._inicializeGpioPin(safetyPin3, 'in');
		this._temperatureAndHumiditySensor = new Dht22Sensor(temperatureAndHumiditySensorPin);
		this._mcp = new MCP23017({address: 0x20, device: null, debug: true});

		mcpPumpPins.forEach(pin => {
			this._mcp.pinMode(pin, this._mcp.OUTPUT);
			this._mcp.digitalWrite(pin, this._mcp.HIGH);
		});
		mcpSensorPins.forEach(pin => {
			this._mcp.pinMode(pin, this._mcp.INPUT);
		});

		this._safetyShutdown = false;
		this._lastSafetyStates = [null, null, null];
		this._safetyEventLog = [];
		this._irrigationRunning = false;
		this._coolingFansActivated = false;
		this._previousHumidity = 0;
		this._moistureSensorsDataHistory = {};
		this._temperatureHumidityHistory = {};
		this._lastSensorReadings = new Array(gpioPumpsPins.length + mcpPumpPins.length).fill(null);
		this._activePumpIndex = null;
		this._lastTemperature = null;
		this._lastHumidity = null;
		this._lastCpuTemperature = null;
		this._lastIrrigationCycleStartTime = null;
		this._lastIrrigationCycleEndTime = null;

		this._loadHistoryFromFiles();
	}

	async run() {
		await this._safetyCheckCycle();
		this._irrigationCycle();
		this._temperatureAndHumidityCycle();
		setInterval(this._irrigationCycle.bind(this), IRRIGATION_CYCLE_INTERVAL);
		setInterval(this._temperatureAndHumidityCycle.bind(this), TEMPERATURE_AND_HUMIDITY_CYCLE_INTERVAL);
		setInterval(this._safetyCheckCycle.bind(this), SAFETY_CHECK_INTERVAL);
		setInterval(this._writeHistoryCycle.bind(this), WRITE_HISTORY_INTERVAL);
	}

	async diagnostics() {
		const LINE = '═'.repeat(54);
		let passed = 0, warned = 0, failed = 0;

		const ok   = msg => { passed++; return `✓ ${msg}`; };
		const warn = msg => { warned++; return `⚠ ${msg}`; };
		const fail = msg => { failed++; return `✗ ${msg}`; };

		const row = (label, value, status) => {
			const l = String(label).padEnd(32);
			const v = String(value ?? '—').padEnd(14);
			console.log(`  ${l}${v}${status ?? ''}`);
		};

		const section = name => console.log(`\n▸ ${name}`);

		console.log('\n' + LINE);
		console.log('  IRRIGATION SYSTEM — DIAGNOSTICS');
		console.log(LINE);

		// ── System info ───────────────────────────────────────────
		section('SYSTEM INFO');
		row('GPIO offset', GPIO_OFFSET);
		row('Node.js', process.version);

		// ── DHT22 ─────────────────────────────────────────────────
		section(`CLIMATE SENSOR  (DHT22, GPIO ${temperatureAndHumiditySensorPin})`);
		const { temperature, humidity } = this._getTemperatureAndHumidity();
		if (temperature === 0 && humidity === 0) {
			row('Sensor', 'no data', fail('no reading — check GPIO 18 wiring'));
		} else {
			row('Temperature', `${temperature} °C`, ok('OK'));
			row('Humidity',    `${humidity} %`,     ok('OK'));
		}

		// ── CPU ───────────────────────────────────────────────────
		section('CPU');
		const cpuTemp = this._getCpuTemperature();
		row('Temperature',
			cpuTemp !== null ? `${cpuTemp} °C` : null,
			cpuTemp !== null ? ok('OK') : fail('read error'));

		// ── Water tank ────────────────────────────────────────────
		section(`WATER TANK  (GPIO ${waterTankLevelSensorPin})`);
		const tankVal = this._waterTankLevelSensor.readSync();
		row('Level sensor',
			tankVal === Gpio.HIGH ? 'HIGH' : 'LOW',
			tankVal === Gpio.HIGH ? ok('has water') : warn('empty or sensor disconnected'));

		// ── Safety sensors ────────────────────────────────────────
		section('SAFETY SENSORS');
		const safetySensors = [this._safetySensor1, this._safetySensor2, this._safetySensor3];
		const safetyPins    = [safetyPin1, safetyPin2, safetyPin3];
		for (let i = 0; i < safetySensors.length; i++) {
			const val = this._getSensorData(safetySensors[i]);
			row(`Sensor ${i + 1}  (GPIO ${String(safetyPins[i]).padStart(2)})`,
				val === Gpio.HIGH ? 'HIGH' : 'LOW',
				val === Gpio.HIGH ? ok('safe / dry') : warn('WET — check floor!'));
		}

		// ── Moisture sensors ──────────────────────────────────────
		section(`MOISTURE SENSORS  (power: GPIO ${moistureSensorsPowerPin})`);
		const allSensorData = await this._getAllMoistureSensorsData();

		for (let i = 0; i < moistureSensorsDataPins.length; i++) {
			const val = allSensorData[i];
			row(`GPIO ${i + 1}  (data pin ${String(moistureSensorsDataPins[i]).padStart(2)})`,
				val === Gpio.HIGH ? 'HIGH' : 'LOW',
				val === Gpio.HIGH ? ok('dry') : warn('wet or wiring issue'));
		}
		for (let i = 0; i < mcpSensorPins.length; i++) {
			const val = allSensorData[moistureSensorsDataPins.length + i];
			row(`MCP  ${i + 1}  (pin  ${mcpSensorPins[i]})`,
				val === 1 ? 'HIGH' : 'LOW',
				val === 1 ? ok('dry') : warn('wet or wiring issue'));
		}

		// ── GPIO pumps ────────────────────────────────────────────
		section('PUMPS  GPIO  (1 s each)');
		for (let i = 0; i < this._gpioPumps.length; i++) {
			const pump = this._gpioPumps[i];
			const pin  = gpioPumpsPins[i];
			try {
				pump.writeSync(Gpio.LOW);
				await this._sleep(1000);
				pump.writeSync(Gpio.HIGH);
				row(`Pump ${String(i + 1).padStart(2)}  (GPIO ${String(pin).padStart(2)})`, '', ok('OK'));
			} catch (err) {
				row(`Pump ${String(i + 1).padStart(2)}  (GPIO ${String(pin).padStart(2)})`, '', fail(err.message));
			}
		}

		// ── MCP pumps ─────────────────────────────────────────────
		section('PUMPS  MCP23017  (1 s each)');
		for (let i = 0; i < mcpPumpPins.length; i++) {
			const pin     = mcpPumpPins[i];
			const pumpNum = this._gpioPumps.length + i + 1;
			try {
				this._mcp.digitalWrite(pin, this._mcp.LOW);
				await this._sleep(1000);
				this._mcp.digitalWrite(pin, this._mcp.HIGH);
				row(`Pump ${String(pumpNum).padStart(2)}  (MCP pin ${String(pin).padStart(2)})`, '', ok('OK'));
			} catch (err) {
				row(`Pump ${String(pumpNum).padStart(2)}  (MCP pin ${String(pin).padStart(2)})`, '', fail(err.message));
			}
		}

		// ── Cooling fans ──────────────────────────────────────────
		section(`COOLING FANS  (GPIO ${fansPin}, 3 s)`);
		try {
			this._activateCoolingFans();
			await this._sleep(3000);
			this._deactivateCoolingFans();
			row('Fans', '', ok('OK'));
		} catch (err) {
			row('Fans', '', fail(err.message));
		}

		// ── Summary ───────────────────────────────────────────────
		console.log('\n' + LINE);
		if (failed === 0 && warned === 0) {
			console.log(`  ✓ All ${passed} checks passed`);
		} else {
			const parts = [];
			if (passed) parts.push(`${passed} OK`);
			if (warned) parts.push(`${warned} warning${warned > 1 ? 's' : ''}`);
			if (failed) parts.push(`${failed} error${failed > 1 ? 's' : ''}`);
			console.log(`  RESULT: ${parts.join('  |  ')}`);
		}
		console.log(LINE + '\n');
	}

	async _irrigationCycle() {
		if (this._irrigationRunning || !this._isIrrigationDayTime()) {
			return;
		}

		this._irrigationRunning = true;
		this._lastIrrigationCycleStartTime = new Date();

		try {

			if (this._coolingFansActivated) {
				this._deactivateCoolingFans();
			}

			const currentDayHistoryData = this._getCurrentDayHistoryData();
			const allSensorData = await this._getAllMoistureSensorsData();

			// GPIO pumps (indices 0–6)
			for (let index = 0; index < this._gpioPumps.length; index++) {
				if (
					this._isMoistureSensorOutOfWater(allSensorData[index]) &&
					!this._isTankEmpty() &&
					currentDayHistoryData[index] < DAY_IRRIGATION_LIMIT &&
					!this._safetyShutdown
				) {
					await this._activateGpioPump(this._gpioPumps[index]);
				}
			}

			// MCP pumps (indices 7–12)
			const mcpOffset = this._gpioPumps.length;
			for (let index = 0; index < mcpPumpPins.length; index++) {
				if (
					this._isMoistureSensorOutOfWater(allSensorData[mcpOffset + index]) &&
					!this._isTankEmpty() &&
					currentDayHistoryData[mcpOffset + index] < DAY_IRRIGATION_LIMIT &&
					!this._safetyShutdown
				) {
					await this._activateMcpPump(mcpPumpPins[index]);
				}
			}

			if (this._coolingFansActivated) {
				this._activateCoolingFans();
			}

			this._storeDataToHistory(allSensorData);
			await this._getAllMoistureSensorsData();
		} finally {
			this._lastIrrigationCycleEndTime = new Date();
			this._irrigationRunning = false;
		}
	}

	_temperatureAndHumidityCycle() {
		const { temperature, humidity } = this._getTemperatureAndHumidity();

		if (temperature === 0 && humidity === 0) {
			return;
		}

		this._lastTemperature = temperature;
		this._lastHumidity = humidity;
		this._lastCpuTemperature = this._getCpuTemperature();

		if (temperature > START_COOLING_TEMPERATURE_LIMIT) {
			this._coolingFansActivated = true;
			this._activateCoolingFans();
		} else {
			this._coolingFansActivated = false;
			this._deactivateCoolingFans();
		}

		if (this._previousHumidity && humidity > this._previousHumidity + 5) {
			console.log(`Humidity increased by ${humidity - this._previousHumidity}`);
		}

		this._previousHumidity = humidity;
		this._storeTemperatureHumidityToHistory(temperature, humidity, this._lastCpuTemperature);
	}

	_safetyCheckCycle() {
		const sensors = [this._safetySensor1, this._safetySensor2, this._safetySensor3];
		const pins    = [safetyPin1, safetyPin2, safetyPin3];

		for (let i = 0; i < sensors.length; i++) {
			const isWet = !this._isMoistureSensorOutOfWater(this._getSensorData(sensors[i]));
			const prev  = this._lastSafetyStates[i];

			if (isWet && prev !== true) {
				this._safetyShutdown = true;
				const startTime = this._getActualCZDate().toUTCString();
				this._safetyEventLog.push({ type: 'sensor', sensor: i + 1, pin: pins[i], startTime, endTime: null });
				if (this._safetyEventLog.length > SAFETY_EVENT_LOG_LIMIT) this._safetyEventLog.shift();
				console.warn(`[SAFETY] Sensor ${i + 1} (GPIO ${pins[i]}) detects water — shutdown activated`);
				this._sendDiscordNotification(`⚠️ SAFETY SHUTDOWN — Sensor ${i + 1} (GPIO ${pins[i]}) detekoval vodu!`);
			}

			if (!isWet && prev === true) {
				const endTime = this._getActualCZDate().toUTCString();
				const openEntry = [...this._safetyEventLog].reverse()
					.find(e => e.type === 'sensor' && e.sensor === i + 1 && e.endTime === null);
				if (openEntry) {
					openEntry.endTime = endTime;
					const mins = Math.round((new Date(endTime) - new Date(openEntry.startTime)) / 60000);
					console.log(`[SAFETY] Sensor ${i + 1} (GPIO ${pins[i]}) dry again — was wet for ${mins} min`);
				}
			}

			this._lastSafetyStates[i] = isWet;
		}
	}

	manualShutdown() {
		this._safetyShutdown = true;
		const time = this._getActualCZDate().toUTCString();
		this._safetyEventLog.push({ type: 'manual_stop', time });
		if (this._safetyEventLog.length > SAFETY_EVENT_LOG_LIMIT) this._safetyEventLog.shift();
		console.log('[SAFETY] Manual shutdown activated');
	}

	resumeIrrigation() {
		this._safetyShutdown = false;
		const time = this._getActualCZDate().toUTCString();
		this._safetyEventLog.push({ type: 'manual_resume', time });
		if (this._safetyEventLog.length > SAFETY_EVENT_LOG_LIMIT) this._safetyEventLog.shift();
		console.log('[SAFETY] Irrigation resumed manually');
	}

	async sendTestNotification() {
		const url = process.env.DISCORD_WEBHOOK_URL;
		if (!url) return false;
		try {
			await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content: '✅ Test notifikace z irrigation systému — Discord webhook funguje správně.' }),
			});
			return true;
		} catch (err) {
			console.warn('[Discord] Test notification failed:', err.message);
			return false;
		}
	}

	_sendDiscordNotification(message) {
		const url = process.env.DISCORD_WEBHOOK_URL;
		if (!url) return;
		fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ content: message }),
		}).catch(err => console.warn('[Discord] Notification failed:', err.message));
	}

	_loadHistoryFromFiles() {
		const files = [
			{ path: 'irrigationHistory.txt',          target: '_moistureSensorsDataHistory' },
			{ path: 'safetyEventLog.txt',             target: '_safetyEventLog'             },
			{ path: 'temperatureHumidityHistory.txt', target: '_temperatureHumidityHistory' },
		];

		for (const { path, target } of files) {
			try {
				const raw = fs.readFileSync(path, 'utf8');
				this[target] = JSON.parse(raw);
			} catch (err) {
				if (err.code !== 'ENOENT') {
					console.warn(`Failed to load history from ${path}:`, err.message);
				}
				// ENOENT = first run, no file yet — silently keep empty object
			}
		}
	}

	_writeHistoryCycle() {
		const writes = [
			{ path: 'irrigationHistory.txt',          data: this._moistureSensorsDataHistory },
			{ path: 'safetyEventLog.txt',             data: this._safetyEventLog             },
			{ path: 'temperatureHumidityHistory.txt', data: this._temperatureHumidityHistory },
		];

		for (const { path, data } of writes) {
			let serialized;
			try {
				serialized = JSON.stringify(data);
			} catch (err) {
				console.warn(err);
				continue;
			}
			fs.writeFile(path, serialized, err => { if (err) console.warn(err); });
		}
	}

	_storeDataToHistory(moistureSensorsCycleData) {
		const actualDate = this._getActualCZDate();
		const dataHistoryKeys = Object.keys(this._moistureSensorsDataHistory);

		this._moistureSensorsDataHistory[actualDate.toUTCString()] = moistureSensorsCycleData;

		if (dataHistoryKeys.length > DATA_HISTORY_LIMIT) {
			delete this._moistureSensorsDataHistory[dataHistoryKeys[0]];
		}
	}

_storeTemperatureHumidityToHistory(temperature, humidity, cpuTemperature) {
		const actualDate = this._getActualCZDate();
		const historyKeys = Object.keys(this._temperatureHumidityHistory);

		this._temperatureHumidityHistory[actualDate.toUTCString()] = { temperature, humidity, cpuTemperature };

		if (historyKeys.length > TEMPERATURE_HUMIDITY_HISTORY_LIMIT) {
			delete this._temperatureHumidityHistory[historyKeys[0]];
		}
	}

	_getCurrentDayHistoryData() {
		const actualDate = this._getActualCZDate();
		const dataHistoryKeys = Object.keys(this._moistureSensorsDataHistory);
		let result = new Array(gpioPumpsPins.length + mcpPumpPins.length).fill(0);

		dataHistoryKeys.filter((key) => {
			const keyDate = new Date(key);
			return keyDate.getUTCFullYear() === actualDate.getUTCFullYear() &&
			       keyDate.getUTCMonth()    === actualDate.getUTCMonth() &&
			       keyDate.getUTCDate()     === actualDate.getUTCDate();
		}).map((currentDayKey) => {
			this._moistureSensorsDataHistory[currentDayKey].forEach((sensorData, index) => {
				result[index] += sensorData;
			})
		});

		return result;
	}

	_getActualCZDate() {
		const actualDate = new Date();
		// setUTCHours is timezone-independent — avoids double-offset when the
		// system clock is already set to CZ local time (UTC+2).
		actualDate.setUTCHours(actualDate.getUTCHours() + 2);
		return actualDate;
	}

	_inicializeGpioPin(pinNumber, direction, edge = 'none', options = {}) {
		return new Gpio(GPIO_OFFSET + pinNumber, direction, edge, options);
	}

	_inicializeGpioPins(gpioPins, direction, edge = 'none', options = {}) {
		return gpioPins.map((pin) => {
			return this._inicializeGpioPin(pin, direction, edge, options);
		});
	}

	_activateCoolingFans() {
		this._coolingFans.writeSync(Gpio.LOW);
	}

	_deactivateCoolingFans() {
		this._coolingFans.writeSync(Gpio.HIGH);
	}

	_getSensorData(sensor) {
		return sensor.readSync();
	}

	_getTemperatureAndHumidity() {
		return this._temperatureAndHumiditySensor.getData();
	}

	_getCpuTemperature() {
		try {
			const raw = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8');
			return parseFloat((parseInt(raw.trim()) / 1000).toFixed(1));
		} catch {
			return null;
		}
	}

	async _getAllMoistureSensorsData() {
		let result = [];

		// Activated by Gpio.LOW because of EM Relay switching (active-LOW)
		this._moistureSensorsPower.writeSync(Gpio.LOW);
		await this._sleep(100);

		try {
			for (let moistureSensor of this._moistureSensors) {
				result.push(moistureSensor.readSync());
				await this._sleep(50);
			}

			for (let pin of mcpSensorPins) {
				result.push(await this._readMcpPin(pin));
				await this._sleep(50);
			}
		} finally {
			// Deactivated by Gpio.HIGH because of EM Relay switching (active-LOW)
			this._moistureSensorsPower.writeSync(Gpio.HIGH);
		}

		this._lastSensorReadings = result;
		return result;
	}

	async readSensorsNow() {
		await this._getAllMoistureSensorsData();
	}

	// node-mcp23017's digitalRead is async/callback-based (uses readI2cBlock internally).
	// This helper wraps it as a Promise returning 1 (HIGH) or 0 (LOW), matching onoff's Gpio.HIGH/LOW convention.
	_readMcpPin(pin) {
		return new Promise((resolve) => {
			this._mcp.digitalRead(pin, (_pin, err, value) => {
				if (err) {
					console.error(`[MCP digitalRead] pin ${pin} error:`, err);
					resolve(null);
				} else {
					resolve(value ? 1 : 0);
				}
			});
		});
	}

	_isTankEmpty() {
		return this._waterTankLevelSensor.readSync() === Gpio.LOW;
	}

	_isMoistureSensorOutOfWater(gpioValue) {
		return gpioValue === Gpio.HIGH;
	}

	async _activateGpioPump(pump) {
		this._activePumpIndex = this._gpioPumps.indexOf(pump);
		const duration = PUMP_DURATION_OVERRIDES[this._activePumpIndex] ?? PUMP_ACTIVATION_DURATION;
		try {
			pump.writeSync(Gpio.LOW);
			await this._sleep(duration);
			pump.writeSync(Gpio.HIGH);
		} catch (err) {
			console.error(`[PUMP] GPIO write error (index ${this._activePumpIndex}): ${err.message}`);
			try { pump.writeSync(Gpio.HIGH); } catch {}
		} finally {
			this._activePumpIndex = null;
		}
	}

	async _activateMcpPump(pumpPin) {
		this._activePumpIndex = this._gpioPumps.length + mcpPumpPins.indexOf(pumpPin);
		const duration = PUMP_DURATION_OVERRIDES[this._activePumpIndex] ?? PUMP_ACTIVATION_DURATION;
		try {
			this._mcp.digitalWrite(pumpPin, this._mcp.LOW);
			await this._sleep(duration);
			this._mcp.digitalWrite(pumpPin, this._mcp.HIGH);
		} catch (err) {
			console.error(`[PUMP] MCP write error (index ${this._activePumpIndex}): ${err.message}`);
			try { this._mcp.digitalWrite(pumpPin, this._mcp.HIGH); } catch {}
		} finally {
			this._activePumpIndex = null;
		}
	}

	_computeNextIrrigationTime(lastStart) {
		if (!lastStart) return null;
		const candidate = new Date(lastStart.getTime() + IRRIGATION_CYCLE_INTERVAL);
		// Convert to CZ time (UTC+2) to check the daytime window (08:00–23:59 CZ)
		const czDate = new Date(candidate.getTime() + 2 * 3600000);
		if (czDate.getUTCHours() < 8) {
			czDate.setUTCHours(8, 0, 0, 0);
			return new Date(czDate.getTime() - 2 * 3600000);
		}
		return candidate;
	}

	getStatus() {
		const toCZString = d => {
			if (!d) return null;
			const shifted = new Date(d.getTime());
			shifted.setUTCHours(shifted.getUTCHours() + 2);
			return shifted.toUTCString();
		};

		return {
			sensorReadings: this._lastSensorReadings,
			activePumpIndex: this._activePumpIndex,
			dailyCounts: this._getCurrentDayHistoryData(),
			tankEmpty: this._isTankEmpty(),
			safetyShutdown: this._safetyShutdown,
			temperature: this._lastTemperature,
			humidity: this._lastHumidity,
			cpuTemperature: this._lastCpuTemperature,
			temperatureHistory: this._getRecentTemperatureHistory(),
			irrigationRunning: this._irrigationRunning,
			lastIrrigationTime: toCZString(this._lastIrrigationCycleEndTime),
			nextIrrigationTime: toCZString(
				this._computeNextIrrigationTime(this._lastIrrigationCycleStartTime)
			),
			safetyLog: this._safetyEventLog.slice(-20),
		};
	}

	async triggerManualIrrigation(pumpIndex) {
		if (this._safetyShutdown || this._isTankEmpty() || this._irrigationRunning) {
			return false;
		}

		this._irrigationRunning = true;
		try {
			if (pumpIndex < this._gpioPumps.length) {
				await this._activateGpioPump(this._gpioPumps[pumpIndex]);
			} else {
				await this._activateMcpPump(mcpPumpPins[pumpIndex - this._gpioPumps.length]);
			}
			const manualData = new Array(gpioPumpsPins.length + mcpPumpPins.length).fill(0);
			manualData[pumpIndex] = 1;
			this._storeDataToHistory(manualData);
			return true;
		} finally {
			this._irrigationRunning = false;
		}
	}

	_getRecentTemperatureHistory() {
		const keys = Object.keys(this._temperatureHumidityHistory);
		return keys.slice(-96).map(key => ({
			time: key,
			...this._temperatureHumidityHistory[key]
		}));
	}

	_isIrrigationDayTime() {
		const actualDate = this._getActualCZDate();
		return actualDate.getUTCHours() >= 8 && actualDate.getUTCHours() <= 23;
	}

	_sleep(ms) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}
