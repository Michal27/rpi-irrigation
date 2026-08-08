import sensor from 'node-dht-sensor';

const SENSOR_VERSION = 22;

export default class Dht22Sensor {

	constructor(gpioDataPin) {
		this._sensor = sensor;
		this._gpioDataPin = gpioDataPin;
	}

	getData() {
		const sensorData = this._readSensorData();

		if (sensorData.errors > 3 || !sensorData.isValid) {
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

		if (sensorData.errors > 3 || !sensorData.isValid) {
			this._handleError();
			return 0;
		}

		return sensorData.temperature;
	}

	getHumidity() {
		const sensorData = this._readSensorData();

		if (sensorData.errors > 3 || !sensorData.isValid) {
			this._handleError();
			return 0;
		}

		return sensorData.humidity;
	}

	_readSensorData() {
		try {
			return this._sensor.read(SENSOR_VERSION, this._gpioDataPin);
		} catch (err) {
			return { errors: 99, isValid: false };
		}
	}

	_handleError() {
		const ts = new Date().toISOString();
		console.warn(`[${ts}] dht22 sensor reading error — transient, will retry next cycle`);
	}
}
