import Dht22Sensor from './dht22.mjs';
import OnOff from 'onoff';
import * as fs from 'fs';

const Gpio = OnOff.Gpio;

const IRRIGATION_CYCLE_INTERVAL = 7200000; //miliseconds = 2 hours
const TEMPERATURE_AND_HUMIDITY_CYCLE_INTERVAL = 900000; //miliseconds = 15 minutes
const SAFETY_CHECK_INTERVAL = 5000; //miliseconds = 5 seconds
const SAFETY_REENABLE_INTERVAL = 10800000; //miliseconds = 3 hours
const WRITE_HISTORY_INTERVAL = 60000; //miliseconds = 1 hour
const START_COOLING_TEMPERATURE_LIMIT = 50; //°C
const DATA_HISTORY_LIMIT = 60; //irrigation cycles measurement history
const SAFETY_SHUTDOWN_HISTORY_LIMIT = 300; //safety shutdowns history
const DAY_IRRIGATION_LIMIT = 3;

const moistureSensorsPowerPin = 25;
const moistureSensorsDataPins = [8, 7, 12, 16, 20, 21];
const flowerpotPumpsPins = [11, 5, 6, 13, 19, 26];
const waterTankLevelSensorPin = 2;
const waterTankPumpPin = 3;
const smallTankBottomSensorPowerPin = 10
const smallTankBottomSensorPin = 9;
const smallTankTopSensorPowerPin = 27;
const smallTankTopSensorPin = 22;
const temperatureAndHumiditySensorPin = 18;
const fansPin = 14;
const safetyPin1 = 17;
const safetyPin2 = 4;

export default class Irrigation {

	constructor() {
		this._flowerpotPumps = this._inicializeGpioPins(flowerpotPumpsPins, 'high');
		this._waterTankPump = this._inicializeGpioPin(waterTankPumpPin, 'high');
		this._moistureSensorsPower = this._inicializeGpioPin(moistureSensorsPowerPin, 'high');
		this._moistureSensors = this._inicializeGpioPins(moistureSensorsDataPins, 'in');
		this._waterTankLevelSensor = this._inicializeGpioPin(waterTankLevelSensorPin, 'in');
		this._smallTankBottomSensorPower = this._inicializeGpioPin(smallTankBottomSensorPowerPin, 'low');
		this._smallTankBottomSensor = this._inicializeGpioPin(smallTankBottomSensorPin, 'in', 'rising', { debounceTimeout: 10 });
		this._smallTankTopSensorPower = this._inicializeGpioPin(smallTankTopSensorPowerPin, 'low');
		this._smallTankTopSensor = this._inicializeGpioPin(smallTankTopSensorPin, 'in', 'falling', { debounceTimeout: 10 });
		this._coolingFans = this._inicializeGpioPin(fansPin, 'high');
		this._safetySensor1 = this._inicializeGpioPin(safetyPin1, 'in');
		this._safetySensor2 = this._inicializeGpioPin(safetyPin2, 'in');
		this._temperatureAndHumiditySensor = new Dht22Sensor(temperatureAndHumiditySensorPin);

		this._safetyShutdown = false;
		this._safetyShutdownInterval = null;
		this._coolingFansActivated = false;
		this._previousHumidity = 0;
		this._moistureSensorsDataHistory = {};
	}

	run() {
		this._irrigationCycle();
		this._temperatureAndHumidityCycle();
		setInterval(this._irrigationCycle.bind(this), IRRIGATION_CYCLE_INTERVAL);
		setInterval(this._temperatureAndHumidityCycle.bind(this), TEMPERATURE_AND_HUMIDITY_CYCLE_INTERVAL);
		setInterval(this._safetyCheckCycle.bind(this), SAFETY_CHECK_INTERVAL);
		setInterval(this._writeHistoryCycle.bind(this), WRITE_HISTORY_INTERVAL);
	}

	async back() {
		for (let pump of this._flowerpotPumps) {
			pump.writeSync(Gpio.LOW);
		}
		await this._sleep(60000);
		for (let pump of this._flowerpotPumps) {
			pump.writeSync(Gpio.HIGH);
		}

		return 0;
	}

	async test() {
		console.log('!!!RUNNING SYSTEM TEST!!!');
		console.log('');
		console.log('Inicialization completed');
		console.log('');

		this._waterTankPump.writeSync(Gpio.LOW);
		console.log('Water tank pump activated');
		await this._sleep(2000);
		this._waterTankPump.writeSync(Gpio.HIGH);
		console.log('Water tank pump deactivated');
		console.log('');

		for (let pump of this._flowerpotPumps) {
			pump.writeSync(Gpio.LOW);
			console.log(`Pump activated: ${this._flowerpotPumps.indexOf(pump) + 1}`);
			await this._sleep(2000);
			pump.writeSync(Gpio.HIGH);
			console.log(`Pump deactivated: ${this._flowerpotPumps.indexOf(pump) + 1}`);
			console.log('');
		}

		console.log('Cooling fans activated');
		this._activateCoolingFans();
		await this._sleep(5000);
		this._deactivateCoolingFans();
		console.log('Cooling fans deactivated');
		console.log('');

		console.log('Moisture sensors activated');
		this._moistureSensorsPower.writeSync(Gpio.LOW);
		await this._sleep(10000);
		this._moistureSensorsPower.writeSync(Gpio.HIGH);
		console.log('Moisture sensors deactivated');
		console.log('');

		console.log('Small tank moisture sensors activated');
		this._activateMoistureSensor(this._smallTankBottomSensorPower);
		this._activateMoistureSensor(this._smallTankTopSensorPower);
		await this._sleep(10000);
		this._deactivateMoistureSensor(this._smallTankBottomSensorPower);
		this._deactivateMoistureSensor(this._smallTankTopSensorPower);
		console.log('Small tank moisture sensors deactivated');
		console.log('');

		return 0;
	}

	async _irrigationCycle() {
		if (this._isIrrigationDayTime()) {

			if (this._coolingFansActivated) {
				this._deactivateCoolingFans();
			}

			const currentDayHistoryData = this._getCurrentDayHistoryData();
			const moistureSensorsCycleData = await this._getMoistureSensorsData(
				this._moistureSensors,
				this._moistureSensorsPower
			);

			for (let index = 0; index < moistureSensorsCycleData.length; index++) {
				if (
					this._isMoistureSensorOutOfWater(moistureSensorsCycleData[index]) &&
					!this._isTankEmpty() &&
					currentDayHistoryData[index] < DAY_IRRIGATION_LIMIT &&
					this._flowerpotPumps[index]
				) {
					await this._activateWaterTankPump();
					await this._activateFlowerpotPump(this._flowerpotPumps[index]);
				}
			}

			if (this._coolingFansActivated) {
				this._activateCoolingFans();
			}

			this._storeDataToHistory(moistureSensorsCycleData);
		}
	}

	_temperatureAndHumidityCycle() {
		const { temperature, humidity } = this._getTemperatureAndHumidity();

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
	}

	_safetyCheckCycle() {
		const safetySensorData1 = this._getSensorData(this._safetySensor1);
		const safetySensorData2 = this._getSensorData(this._safetySensor2);

		if (
			!this._isMoistureSensorOutOfWater(safetySensorData1) ||
			!this._isMoistureSensorOutOfWater(safetySensorData2)
		) {
			this._safetyShutdown = true;
			this._waterTankPump.writeSync(Gpio.HIGH);
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

		try {
			irrigationHistory = JSON.stringify(this._moistureSensorsDataHistory);
		}
		catch(err) {
			console.warn(err);
		}

		try {
			safetyShutdownsHistory = JSON.stringify(this._safetyShutdownsHistory);
		}
		catch(err) {
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
	}

	_storeDataToHistory(moistureSensorsCycleData) {
		const actualDate = this._getActualCZDate();
		const dataHistoryKeys = Object.keys(this._moistureSensorsDataHistory);

		this._moistureSensorsDataHistory[actualDate.toUTCString()] = moistureSensorsCycleData;

		if (dataHistoryKeys.length > DATA_HISTORY_LIMIT) {
			this._moistureSensorsDataHistory.delete(dataHistoryKeys[0]);
		}
	}

	_storeSafetyShutdownToHistory() {
		const actualDate = this._getActualCZDate();
		const historyKeys = Object.keys(this._safetyShutdownsHistory);

		this._safetyShutdownsHistory[actualDate.toUTCString()] = true;

		if (historyKeys.length > SAFETY_SHUTDOWN_HISTORY_LIMIT) {
			this._safetyShutdownsHistory.delete(historyKeys[0]);
		}
	}

	_getCurrentDayHistoryData() {
		const actualDate = this._getActualCZDate();
		const dataHistoryKeys = Object.keys(this._moistureSensorsDataHistory);
		let result = this._moistureSensors.map(() => {
			return 0;
		});

		dataHistoryKeys.filter((key) => {
			new Date(key).getDay() === actualDate.getDay()
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
		return new Gpio(pinNumber, direction, edge, options);
	}

	_inicializeGpioPins(gpioPins, direction, edge = 'none', options = {}) {
		return gpioPins.map((pin) => {
			return this._inicializeGpioPin(pin, direction, edge, options);
		})
	}

	_activateMoistureSensor(moistureSensorPower) {
		moistureSensorPower.writeSync(Gpio.HIGH);
	}

	_deactivateMoistureSensor(moistureSensorPower) {
		moistureSensorPower.writeSync(Gpio.LOW);
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

	async _getMoistureSensorsData(moistureSensors, moistureSensorsPower) {
		let result = [];

		// Activated by Gpio.LOW because of EM Relay switching
		moistureSensorsPower.writeSync(Gpio.LOW);
		await this._sleep(100);

		for (moistureSensor of moistureSensors) {
			result.push(moistureSensor.readSync());
			await this._sleep(50);
		}

		// Deactivated by Gpio.HIGH because of EM Relay switching
		moistureSensorsPower.writeSync(Gpio.HIGH);

		return result;
	}

	_isTankEmpty() {
		return this._waterTankLevelSensor.readSync() === Gpio.LOW;
	}

	_isMoistureSensorOutOfWater(gpioValue) {
		return gpioValue === Gpio.HIGH;
	}

	async _activateWaterTankPump() {
		if (this._safetyShutdown) {
			return -1;
		}

		let isWaterTankFull = false;

		this._activateMoistureSensor(this._smallTankTopSensorPower);
		await this._sleep(100);

		this._smallTankTopSensor.watch((err, sensorData) => {
			if (err) {
				throw err;
			}

			if (!this._isMoistureSensorOutOfWater(sensorData)) {
				this._waterTankPump.writeSync(Gpio.HIGH);
				isWaterTankFull = true;
			}
		});

		this._waterTankPump.writeSync(Gpio.LOW);

		for (let i = 0; i < 300; i++) {
			if (isWaterTankFull) {
				break;
			}

			await this._sleep(100);
		}

		this._smallTankTopSensor.unwatch();
		this._waterTankPump.writeSync(Gpio.HIGH);
		this._deactivateMoistureSensor(this._smallTankTopSensorPower);

		return 0;
	}

	async _activateFlowerpotPump(pump) {
		let isWaterTankEmpty = false;

		this._activateMoistureSensor(this._smallTankBottomSensorPower);
		await this._sleep(100);

		this._smallTankBottomSensor.watch((err, sensorData) => {
			if (err) {
				throw err;
			}
			if (this._isMoistureSensorOutOfWater(sensorData)) {
				pump.writeSync(Gpio.HIGH);
				isWaterTankEmpty = true;
			}
		});

		pump.writeSync(Gpio.LOW);

		for (let i = 0; i < 6000; i++) {
			if (isWaterTankEmpty) {
				break;
			}

			await this._sleep(100);
		}

		this._smallTankBottomSensor.unwatch();
		pump.writeSync(Gpio.HIGH);
		this._deactivateMoistureSensor(this._smallTankBottomSensorPower);

		return 0;
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
