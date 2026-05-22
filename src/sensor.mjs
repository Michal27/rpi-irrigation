import OnOff from 'onoff';

const Gpio = OnOff.Gpio;
const sensor = new Gpio(22, 'in', 'both');
const power = new Gpio(27, 'out');
power.writeSync(Gpio.HIGH);

sensor.watch((err, value) => {
	if (err) {
		throw err;
	}

	console.log(value);
});
