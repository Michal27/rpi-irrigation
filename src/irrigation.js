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

const GPIO_OFFSET = detectGpioOffset();

const IRRIGATION_CYCLE_INTERVAL = 7200000; //miliseconds = 2 hours
const TEMPERATURE_AND_HUMIDITY_CYCLE_INTERVAL = 900000; //miliseconds = 15 minutes
const SAFETY_CHECK_INTERVAL = 5000; //miliseconds = 5 seconds
const SAFETY_REENABLE_INTERVAL = 10800000; //miliseconds = 3 hours
const WRITE_HISTORY_INTERVAL = 60000; //miliseconds = 1 minute
const START_COOLING_TEMPERATURE_LIMIT = 50; //°C
const DATA_HISTORY_LIMIT = 60; //irrigation cycles measurement history
const SAFETY_SHUTDOWN_HISTORY_LIMIT = 300; //safety shutdowns history
const TEMPERATURE_HUMIDITY_HISTORY_LIMIT = 672; //7 days × 96 readings/day (15 min interval)
const DAY_IRRIGATION_LIMIT = 3;
const PUMP_ACTIVATION_DURATION = 30000; //miliseconds = 30 seconds

const moistureSensorsPowerPin = 25;
const moistureSensor7PowerPin = 27;
const moistureSensorsDataPins = [8, 7, 12, 16, 20, 21, 22];
const gpioPumpsPins = [11, 5, 6, 13, 19, 26, 24];
const waterTankLevelSensorPin = 23;
const safetyPin3PowerPin = 10;
const temperatureAndHumiditySensorPin = 18;
const fansPin = 14;
const safetyPin1 = 17;
const safetyPin2 = 4;
const safetyPin3 = 9;

const mcpPumpPins = [8, 9, 10, 11, 12, 13];
const mcpSensorPins = [0, 1, 2, 3, 4, 5];

export default class Irrigation {

	constructor() {
		this._gpioPumps = this._inicializeGpioPins(gpioPumpsPins, 'high');
		this._moistureSensorsPower = this._inicializeGpioPin(moistureSensorsPowerPin, 'high');
		this._moistureSensor7Power = this._inicializeGpioPin(moistureSensor7PowerPin, 'high');
		this._moistureSensors = this._inicializeGpioPins(moistureSensorsDataPins, 'in');
		this._waterTankLevelSensor = this._inicializeGpioPin(waterTankLevelSensorPin, 'in');
		this._safetySensor3Power = this._inicializeGpioPin(safetyPin3PowerPin, 'high');
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
		this._safetyShutdownInterval = null;
		this._irrigationRunning = false;
		this._coolingFansActivated = false;
		this._previousHumidity = 0;
		this._moistureSensorsDataHistory = {};
		this._safetyShutdownsHistory = {};
		this._temperatureHumidityHistory = {};
		this._lastSensorReadings = new Array(gpioPumpsPins.length + mcpPumpPins.length).fill(null);
		this._activePumpIndex = null;
		this._lastTemperature = null;
		this._lastHumidity = null;
		this._lastCpuTemperature = null;
	}

	run() {
		this._irrigationCycle();
		this._temperatureAndHumidityCycle();
		setInterval(this._irrigationCycle.bind(this), IRRIGATION_CYCLE_INTERVAL);
		setInterval(this._temperatureAndHumidityCycle.bind(this), TEMPERATURE_AND_HUMIDITY_CYCLE_INTERVAL);
		setInterval(this._safetyCheckCycle.bind(this), SAFETY_CHECK_INTERVAL);
		setInterval(this._writeHistoryCycle.bind(this), WRITE_HISTORY_INTERVAL);
	}

	async test() {
		console.log('!!!RUNNING SYSTEM TEST!!!');
		console.log('');

		for (let pin of mcpPumpPins) {
			this._mcp.digitalWrite(pin, this._mcp.LOW);
			console.log(`MCP23017 pump pin ${pin} activated`);
			await this._sleep(1000);
			this._mcp.digitalWrite(pin, this._mcp.HIGH);
			console.log(`MCP23017 pump pin ${pin} deactivated`);
		}
		console.log('');

		for (let pump of this._gpioPumps) {
			pump.writeSync(Gpio.LOW);
			console.log(`GPIO pump activated: ${this._gpioPumps.indexOf(pump) + 1}`);
			await this._sleep(1000);
			pump.writeSync(Gpio.HIGH);
			console.log(`GPIO pump deactivated: ${this._gpioPumps.indexOf(pump) + 1}`);
			console.log('');
		}

		console.log('Cooling fans activated');
		this._activateCoolingFans();
		await this._sleep(10000);
		this._deactivateCoolingFans();
		console.log('Cooling fans deactivated');
		console.log('');

		console.log('Moisture sensors activated');
		this._moistureSensorsPower.writeSync(Gpio.LOW);
		this._moistureSensor7Power.writeSync(Gpio.LOW);
		await this._sleep(60000);
		this._moistureSensorsPower.writeSync(Gpio.HIGH);
		this._moistureSensor7Power.writeSync(Gpio.HIGH);
		console.log('Moisture sensors deactivated');
		console.log('');

		return 0;
	}

	async _irrigationCycle() {
		if (this._irrigationRunning || !this._isIrrigationDayTime()) {
			return;
		}

		this._irrigationRunning = true;

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
		} finally {
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
		const safetySensorData1 = this._getSensorData(this._safetySensor1);
		const safetySensorData2 = this._getSensorData(this._safetySensor2);
		const safetySensorData3 = this._getSensorData(this._safetySensor3);

		if (
			!this._isMoistureSensorOutOfWater(safetySensorData1) ||
			!this._isMoistureSensorOutOfWater(safetySensorData2) ||
			!this._isMoistureSensorOutOfWater(safetySensorData3)
		) {
			this._safetyShutdown = true;
			this._storeSafetyShutdownToHistory();

			if (!this._safetyShutdownInterval) {
				this._safetyShutdownInterval = setTimeout(() => {
					this._safetyShutdown = false;
					this._safetyShutdownInterval = null;
				}, SAFETY_REENABLE_INTERVAL);
			}
		}
	}

	_writeHistoryCycle() {
		let irrigationHistory = null;
		let safetyShutdownsHistory = null;
		let temperatureHumidityHistory = null;

		try {
			irrigationHistory = JSON.stringify(this._moistureSensorsDataHistory);
		}
		catch (err) {
			console.warn(err);
		}

		try {
			safetyShutdownsHistory = JSON.stringify(this._safetyShutdownsHistory);
		}
		catch (err) {
			console.warn(err);
		}

		try {
			temperatureHumidityHistory = JSON.stringify(this._temperatureHumidityHistory);
		}
		catch (err) {
			console.warn(err);
		}

		if (irrigationHistory) {
			fs.writeFile("irrigationHistory.txt", irrigationHistory, (err) => {
				if (err) {
					console.warn(err);
				}
			});
		}

		if (safetyShutdownsHistory) {
			fs.writeFile("safetyShutdownsHistory.txt", safetyShutdownsHistory, (err) => {
				if (err) {
					console.warn(err);
				}
			});
		}

		if (temperatureHumidityHistory) {
			fs.writeFile("temperatureHumidityHistory.txt", temperatureHumidityHistory, (err) => {
				if (err) {
					console.warn(err);
				}
			});
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

	_storeSafetyShutdownToHistory() {
		const actualDate = this._getActualCZDate();
		const historyKeys = Object.keys(this._safetyShutdownsHistory);

		this._safetyShutdownsHistory[actualDate.toUTCString()] = true;

		if (historyKeys.length > SAFETY_SHUTDOWN_HISTORY_LIMIT) {
			delete this._safetyShutdownsHistory[historyKeys[0]];
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
			return new Date(key).toDateString() === actualDate.toDateString();
		}).map((currentDayKey) => {
			this._moistureSensorsDataHistory[currentDayKey].forEach((sensorData, index) => {
				result[index] += sensorData;
			})
		});

		return result;
	}

	_getActualCZDate() {
		const actualDate = new Date();
		actualDate.setHours(actualDate.getHours() + 2); //CZ summer time

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
		this._moistureSensor7Power.writeSync(Gpio.LOW);
		await this._sleep(100);

		for (let moistureSensor of this._moistureSensors) {
			result.push(moistureSensor.readSync());
			await this._sleep(50);
		}

		for (let pin of mcpSensorPins) {
			result.push(this._mcp.digitalRead(pin));
			await this._sleep(50);
		}

		// Deactivated by Gpio.HIGH because of EM Relay switching (active-LOW)
		this._moistureSensorsPower.writeSync(Gpio.HIGH);
		this._moistureSensor7Power.writeSync(Gpio.HIGH);

		this._lastSensorReadings = result;
		return result;
	}

	_isTankEmpty() {
		return this._waterTankLevelSensor.readSync() === Gpio.LOW;
	}

	_isMoistureSensorOutOfWater(gpioValue) {
		return gpioValue === Gpio.HIGH;
	}

	async _activateGpioPump(pump) {
		this._activePumpIndex = this._gpioPumps.indexOf(pump);
		pump.writeSync(Gpio.LOW);
		await this._sleep(PUMP_ACTIVATION_DURATION);
		pump.writeSync(Gpio.HIGH);
		this._activePumpIndex = null;
		return 0;
	}

	async _activateMcpPump(pumpPin) {
		this._activePumpIndex = this._gpioPumps.length + mcpPumpPins.indexOf(pumpPin);
		this._mcp.digitalWrite(pumpPin, this._mcp.LOW);
		await this._sleep(PUMP_ACTIVATION_DURATION);
		this._mcp.digitalWrite(pumpPin, this._mcp.HIGH);
		this._activePumpIndex = null;
		return 0;
	}

	getStatus() {
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
		const actualDayHours = actualDate.getHours();

		return actualDayHours >= 8 && actualDayHours <= 23;
	}

	_sleep(ms) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}
