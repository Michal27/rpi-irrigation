import OnOff from 'onoff';
import MCP23017 from 'node-mcp23017';
import {
    GPIO_OFFSET,
    moistureSensorsPowerPin,
    moistureSensorsDataPins, gpioPumpsPins,
    safetyPin1, safetyPin2, safetyPin3,
    mcpSensorPins, mcpPumpPins,
} from './irrigation.js';

const Gpio = OnOff.Gpio;
const pin = n => GPIO_OFFSET + n;

// ── GPIO init ─────────────────────────────────────────────────────────────

const moistureSensorsPower = new Gpio(pin(moistureSensorsPowerPin), 'high');
const safetySensor1        = new Gpio(pin(safetyPin1), 'in');
const safetySensor2        = new Gpio(pin(safetyPin2), 'in');
const safetySensor3        = new Gpio(pin(safetyPin3), 'in');
const moistureSensors      = moistureSensorsDataPins.map(p => new Gpio(pin(p), 'in'));
const gpioPumps            = gpioPumpsPins.map(p => new Gpio(pin(p), 'high'));

// ── MCP23017 init ─────────────────────────────────────────────────────────

const mcp = new MCP23017({ address: 0x20, device: null, debug: false });
mcpPumpPins.forEach(p => { mcp.pinMode(p, mcp.OUTPUT); mcp.digitalWrite(p, mcp.HIGH); });
mcpSensorPins.forEach(p => { mcp.pinMode(p, mcp.INPUT); });

// ── Power on sensors permanently ──────────────────────────────────────────

moistureSensorsPower.writeSync(Gpio.LOW);

// ── State ─────────────────────────────────────────────────────────────────

const TOTAL = gpioPumpsPins.length + mcpPumpPins.length;
const pumpActive  = new Array(TOTAL).fill(false);
const sensorState = new Array(TOTAL).fill(null); // null = unknown, 0 = wet, 1 = dry

function readMcpPin(p) {
    return new Promise(resolve => {
        mcp.digitalRead(p, (_p, err, value) => resolve(err ? null : (value ? 1 : 0)));
    });
}

function setPump(index, on) {
    if (index < gpioPumps.length) {
        gpioPumps[index].writeSync(on ? Gpio.LOW : Gpio.HIGH);
    } else {
        const mcpPin = mcpPumpPins[index - gpioPumps.length];
        mcp.digitalWrite(mcpPin, on ? mcp.LOW : mcp.HIGH);
    }
    pumpActive[index] = on;
}

// ── Render ────────────────────────────────────────────────────────────────

function render(safetyStates) {
    process.stdout.write('\x1Bc'); // clear screen

    const LINE = '═'.repeat(56);
    console.log('\n' + LINE);
    console.log('  SENSOR DEBUG  (Ctrl+C to exit)');
    console.log(LINE);

    // Safety sensors
    const anySafetyWet = safetyStates.some(v => v === Gpio.LOW);
    if (anySafetyWet) {
        const W = '⚠'.repeat(28);
        console.log('\n' + W);
        console.log('  !!! SAFETY SENSOR MOKRO — VODA NA PODLAZE !!!');
        safetyStates.forEach((v, i) => {
            if (v === Gpio.LOW) {
                const p = [safetyPin1, safetyPin2, safetyPin3][i];
                console.log(`  >>> Sensor ${i + 1}  (GPIO ${p})  <<<`);
            }
        });
        console.log(W + '\n');
    } else {
        console.log('\n▸ SAFETY SENSORS');
        const safetyPins = [safetyPin1, safetyPin2, safetyPin3];
        safetyStates.forEach((v, i) => {
            const state = v === Gpio.HIGH ? '✓ sucho' : '⚠ MOKRO';
            console.log(`  Sensor ${i + 1}  (GPIO ${String(safetyPins[i]).padStart(2)})    ${state}`);
        });
    }

    // Moisture sensors + pumps
    console.log('\n▸ MOISTURE SENSORS + PUMPS');
    console.log('  ' + '─'.repeat(54));

    for (let i = 0; i < gpioPumps.length; i++) {
        const s = sensorState[i];
        const wet   = s === 0;
        const label = `GPIO ${String(i + 1).padStart(2)}  data:${String(moistureSensorsDataPins[i]).padStart(2)}  pump:${String(gpioPumpsPins[i]).padStart(2)}`;
        const state = s === null ? '???' : wet ? 'MOKRO ●' : 'sucho  ';
        const pump  = pumpActive[i] ? 'PUMPA ON  ←' : '          ';
        console.log(`  ${label.padEnd(32)}${state.padEnd(10)}${pump}`);
    }
    for (let i = 0; i < mcpSensorPins.length; i++) {
        const idx   = gpioPumps.length + i;
        const s     = sensorState[idx];
        const wet   = s === 0;
        const label = `MCP  ${String(i + 1).padStart(2)}  sens:${mcpSensorPins[i]}      pump:${mcpPumpPins[i]} `;
        const state = s === null ? '???' : wet ? 'MOKRO ●' : 'sucho  ';
        const pump  = pumpActive[idx] ? 'PUMPA ON  ←' : '          ';
        console.log(`  ${label.padEnd(32)}${state.padEnd(10)}${pump}`);
    }

    console.log('\n' + LINE + '\n');
}

// ── Poll loop ─────────────────────────────────────────────────────────────

async function poll() {
    // GPIO moisture sensors
    for (let i = 0; i < moistureSensors.length; i++) {
        sensorState[i] = moistureSensors[i].readSync();
    }
    // MCP moisture sensors
    for (let i = 0; i < mcpSensorPins.length; i++) {
        sensorState[gpioPumps.length + i] = await readMcpPin(mcpSensorPins[i]);
    }

    // Update pumps based on sensor state
    for (let i = 0; i < TOTAL; i++) {
        const wet = sensorState[i] === 0;
        if (wet && !pumpActive[i])  setPump(i, true);
        if (!wet && pumpActive[i]) setPump(i, false);
    }

    // Safety sensors
    const safetyStates = [
        safetySensor1.readSync(),
        safetySensor2.readSync(),
        safetySensor3.readSync(),
    ];

    render(safetyStates);
}

async function loop() {
    await poll();
    setTimeout(loop, 400);
}

// ── Cleanup on exit ───────────────────────────────────────────────────────

function cleanup() {
    for (let i = 0; i < TOTAL; i++) setPump(i, false);
    moistureSensorsPower.writeSync(Gpio.HIGH);
    console.log('\nVšechny pumpy vypnuty, napájení senzorů vypnuto.');
    process.exit(0);
}

process.on('SIGINT',  cleanup);
process.on('SIGTERM', cleanup);

// ── Start ─────────────────────────────────────────────────────────────────

loop();
