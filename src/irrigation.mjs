import Dht22Sensor from './dht22.mjs';
import OnOff from 'onoff';

const Gpio = OnOff.Gpio;

const IRRIGATION_CYCLE_INTERVAL = 180000; //miliseconds = 1 min
const DATA_HISTORY_LIMIT = 60; //irrigation cycles measurement history
const DAY_IRRIGATION_LIMIT = 2;

const moistureSensorsPowerPins = [14, 15, 18, 23, 24, 25];
const moistureSensorsDataPins = [8, 7, 12, 16, 20, 21];
const flowerpotPumpsPins = [11, 5, 6, 13, 19, 26];
const waterTankLevelSensorPin = 2;
const waterTankPumpPin = 3;
const smallTankBottomSensorPowerPin = 10
const smallTankBottomSensorPin = 9;
const smallTankTopSensorPowerPin = 27;
const smallTankTopSensorPin = 22;
const safetyPin1 = 17;
const safetyPin2 = 4;

export default class Irrigation {

	constructor() {
		this._flowerpotPumps = this._inicializeGpioPins(flowerpotPumpsPins, 'high');
		this._waterTankPump = this._inicializeGpioPin(waterTankPumpPin, 'high');
		this._moistureSensorsPower = this._inicializeGpioPins(moistureSensorsPowerPins, 'low');
		this._moistureSensors = this._inicializeGpioPins(moistureSensorsDataPins, 'in');
		this._waterTankLevelSensor = this._inicializeGpioPin(waterTankLevelSensorPin, 'in');
		this._smallTankBottomSensorPower = this._inicializeGpioPin(smallTankBottomSensorPowerPin, 'low');
		this._smallTankBottomSensor = this._inicializeGpioPin(smallTankBottomSensorPin, 'in', 'rising', { debounceTimeout: 10 });
		this._smallTankTopSensorPower = this._inicializeGpioPin(smallTankTopSensorPowerPin, 'low');
		this._smallTankTopSensor = this._inicializeGpioPin(smallTankTopSensorPin, 'in', 'falling', { debounceTimeout: 10 });

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
		this._irrigationCycle();
		setInterval(this._irrigationCycle.bind(this), IRRIGATION_CYCLE_INTERVAL);
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
		console.log('Inicialization completed');

		this._waterTankPump.writeSync(Gpio.Low);
		await this._sleep(1000);
		this._waterTankPump.writeSync(Gpio.HIGH);

		for (let pump of this._flowerpotPumps) {
			pump.writeSync(Gpio.LOW);
			await this._sleep(1000);
			pump.writeSync(Gpio.HIGH);
		}

		for (let sensor of this._moistureSensorsPower) {
			this._activateMoistureSensor(sensor);
			await this._sleep(1000);
			this._deactivateMoistureSensor(sensor);
		}

		return 0;
	}

	async _irrigationCycle() {
		if (this._isIrrigationDayTime()) {
			let moistureSensorsCycleData = [];
			const currentDayHistoryData = this._getCurrentDayHistoryData();

			for (const [index, moistureSensor] of this._moistureSensors.entries()) {
				let moistureSensorData = await this._getMoistureSensorData(moistureSensor, this._moistureSensorsPower[index]);
				moistureSensorsCycleData.push(moistureSensorData);
console.log(moistureSensorData);
				if (
					this._isMoistureSensorOutOfWater(moistureSensorData) &&
					!this._isTankEmpty() &&
					currentDayHistoryData[index] < DAY_IRRIGATION_LIMIT
				) {
					await this._activateWaterTankPump();
					await this._activateFlowerpotPump(this._flowerpotPumps[index]);
				}
			}

			this._storeDataToHistory(moistureSensorsCycleData);
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

	_getSensorData(sensor) {
		return sensor.readSync();
	}

	async _getMoistureSensorData(moistureSensor, moistureSensorPower) {
		let moistureSensorData = 1;

		this._activateMoistureSensor(moistureSensorPower);
		await this._sleep(100);
		moistureSensorData = moistureSensor.readSync();
		this._deactivateMoistureSensor(moistureSensorPower);

		return moistureSensorData;
	}

	_isTankEmpty() {
		return this._waterTankLevelSensor.readSync() === Gpio.LOW;
	}

	_isMoistureSensorOutOfWater(gpioValue) {
		return gpioValue === Gpio.HIGH;
	}

	async _activateWaterTankPump() {
		let smallTankTopSensorData = Gpio.HIGH;
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

		for (let i = 0; i < 450; i++) {
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
		let smallTankBottomSensorData = Gpio.HIGH;

		pump.writeSync(Gpio.LOW);

		for (let i = 0; i < 300; i++) {
			smallTankBottomSensorData = await this._getMoistureSensorData(
				this._smallTankBottomSensor,
				this._smallTankBottomSensorPower
			);

			if (this._isMoistureSensorOutOfWater(smallTankBottomSensorData)) {
				break;
			}

			await this._sleep(100);
		}

		pump.writeSync(Gpio.HIGH);

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
