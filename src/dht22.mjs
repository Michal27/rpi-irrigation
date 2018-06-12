import sensor from 'node-dht-sensor';

const GPIO_DATA_PIN = 4;
const SENSOR_VERSION = 22;

export default class Dht22Sensor {

	constructor() {
		this._sensor = sensor;
	}

	getData() {
		const sensorData = this._readSensorData();

		if (sensorData.errors || !sensorData.isValid) {
			this._handleError();
			return {
				temperature: 0,
				humidity: 0
			}
		}

		return {
			temperature: sensorData.temperature.toFixed(1),
			humidity: sensorData.humidity.toFixed(1)
		};
	}

	getTemperature() {
		const sensorData = this._readSensorData();

		if (sensorData.errors || !sensorData.isValid) {
			this._handleError();
			return 0;
		}

		return sensorData.temperature;
	}

	getHumidity() {
		const sensorData = this._readSensorData();

		if (sensorData.errors || !sensorData.isValid) {
			this._handleError();
			return 0;
		}

		return sensorData.humidity;
	}

	_readSensorData() {
		return this._sensor.read(SENSOR_VERSION, GPIO_DATA_PIN);
	}

	_handleError() {
		console.log('dht22 sensor reading error!');
	}
}
