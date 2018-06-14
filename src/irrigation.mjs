import Dht22Sensor from './dht22.mjs';
import OnOff from 'onoff';

const Gpio = OnOff.Gpio;

const IRRIGATION_CYCLE_INTERVAL = 3600000; //miliseconds = 1 hour
const DATA_HISTORY_LIMIT = 60; //irrigation cycles measurement history
const DAY_IRRIGATION_LIMIT = 2;

const moistureSensorsPowerPins = [14, 15, 18, 23, 24, 25];
const moistureSensorsDataPins = [8, 7, 12, 16, 20, 21];
const flowerpotPumpsPins = [11, 5, 6, 13, 19, 26];
const waterTankLevelSensorPin = 2;
const waterTankPumpPin = 3;
const smallTankBottomSensorPin = 9;
const smallTankBottomSensorPowerPin = 10
const smallTankTopSensorPin = 22;
const smallTankTopSensorPin = 27;

export default class Irrigation {

	constructor() {
		this._flowerpotPumps = this._inicializeGpioPin(flowerpotPumpsPins, 'out', Gpio.HIGH);
		this._waterTankPump = this._inicializeGpioPin(waterTankPumpPin, 'out', Gpio.HIGH);
		this._moistureSensorsPower = this._inicializeGpioPins(moistureSensorsPowerPins, 'out', Gpio.LOW);
		this._moistureSensors = this._inicializeGpioPins(moistureSensorsDataPins, 'in');
		this._waterTankLevelSensor = this._inicializeGpioPins(waterTankLevelSensorPin, 'in');
		this._smallTankBottomSensorPower = this._inicializeGpioPin(smallTankBottomSensorPowerPin, 'out', Gpio.LOW);
		this._smallTankBottomSensor = this._inicializeGpioPin(smallTankBottomSensorPin, 'in');
		this._smallTankTopSensorPower = this._inicializeGpioPin(smallTankTopSensorPowerPin, 'out', Gpio.LOW);
		this._smallTankTopSensor = this._inicializeGpioPin(smallTankTopSensorPin, 'in');

		this._moistureSensorsDataHistory = {};
	}


	//let dht22Sensor = new Dht22Sensor();


	/*levelSensor.watch((err, value) => {
		if (err) {
			throw err;
		}

		console.log(value);
	})*/

	/*console.log(dht22Sensor.getData());
	setInterval(() => {
		console.log(dht22Sensor.getData());
	}, 5000);*/

	run() {
		setInterval(this._irrigationCycle, IRRIGATION_CYCLE_INTERVAL);
	}

	_irrigationCycle() {
		if (this._isIrrigationDayTime()) {
			let moistureSensorsCycleData = [];
			const currentDayHistoryData = this._getCurrentDayHistoryData();

			this._moistureSensors.map((moistureSensor, index) => {
				let moistureSensorData = this._getMoistureSensorData(moistureSensor, this._moistureSensorsPower[index]);
				moistureSensorsCycleData.push(moistureSensorData);

				if (
					this._isMoistureSensorOutOfWater(moistureSensorData) &&
					!this._isTankEmpty() &&
					currentDayHistoryData[index] < DAY_IRRIGATION_LIMIT
				) {
					this._activateWaterTankPump();
					this._activateFlowerpotPump(this._flowerpotPumps[index]);
				}
			});

			_storeDataToHistory(moistureSensorsCycleData);
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

	_getCurrentDayHistoryData() {
		const actualDate = this._getActualCZDate();
		const dataHistoryKeys = Object.keys(this._moistureSensorsDataHistory);
		let result = [0, 0, 0, 0, 0, 0];

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

	_inicializeGpioPin(gpioPins, gpioType, initValue = null) {
		const gpioPin = new Gpio(gpioPins, gpioType);

		if (initData && gpioType === 'out') {
			gpioPin.writeSync(initValue);
		}

		return gpioPin;
	}

	_inicializeGpioPins(gpioPins, gpioType, initValue = null) {
		return gpioPins.map((pin) => {
			return this._inicializeGpioPin(pin, gpioType, initValue);
		})
	}

	_activateMoistureSensor(moistureSensorPower) {
		moistureSensorPower.writeSync(Gpio.HIGH);
	}

	_deactivateMoistureSensor(moistureSensorPower) {
		moistureSensorPower.writeSync(Gpio.LOW);
	}

	_getSensorData(sensor) {
		return sensor.readSync();
	}

	async _getMoistureSensorData(moistureSensor, moistureSensorPower) {
		const moistureSensorData = 1;

		this._activateMoistureSensor(moistureSensor);
		await this._sleep(500);

		moistureSensorData = this._readSensorData(moistureSensor);

		this._deactivateMoistureSensor(moistureSensor);

		return moistureSensorData;
	}

	_isTankEmpty() {
		return this._waterTankLevelSensor.readSync() === 0;
	}

	_isMoistureSensorOutOfWater(gpioValue) {
		return gpioValue === 0;
	}

	async _activateWaterTankPump() {
		this._waterTankPump.writeSync(Gpio.LOW);

		await this._sleep(5000);

		this._waterTankPump.writeSync(Gpio.HIGH);
	}

	async _activateFlowerpotPump(pump) {
		pump.writeSync(Gpio.LOW);

		await this._sleep(6000);

		pump.writeSync(Gpio.HIGH);
	}

	_isIrrigationDayTime() {
		const actualDate = this._getActualCZDate();
		const actualDayHours = actualDate.getHours();

		return actualDayHours >= 8 && actualDayHours <= 20;
	}

	_sleep(ms) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}
