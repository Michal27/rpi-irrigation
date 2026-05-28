import { createServer } from './server.js';

const PORT = 3000;

// Generates 96 fake temperature/humidity readings (24 h at 15 min intervals)
function generateHistory() {
    const history = [];
    const now = Date.now();
    for (let i = 95; i >= 0; i--) {
        const t = new Date(now - i * 15 * 60 * 1000);
        history.push({
            time: t.toUTCString(),
            temperature:    (22 + Math.sin(i / 10) * 6  + Math.random()).toFixed(1),
            humidity:       (55 + Math.cos(i / 8)  * 15 + Math.random()).toFixed(1),
            cpuTemperature: (52 + Math.sin(i / 12) * 8  + Math.random()).toFixed(1),
        });
    }
    return history;
}

// Fake sensor readings: mix of wet (0) and dry (1)
const sensorReadings = [1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0];
const dailyCounts    = [2, 1, 3, 0, 1, 2, 0, 1, 3, 0, 2, 1, 0];
const history        = generateHistory();

let activePumpIndex = null;
let activePumpTimeout = null;

const mockIrrigation = {
    getStatus() {
        const last = history[history.length - 1];
        return {
            sensorReadings,
            activePumpIndex,
            dailyCounts,
            tankEmpty:      false,
            safetyShutdown: false,
            temperature:    last.temperature,
            humidity:       last.humidity,
            cpuTemperature: last.cpuTemperature,
            temperatureHistory: history,
        };
    },

    async triggerManualIrrigation(pumpIndex) {
        if (activePumpIndex !== null) return false;
        activePumpIndex = pumpIndex;
        clearTimeout(activePumpTimeout);
        activePumpTimeout = setTimeout(() => { activePumpIndex = null; }, 5000);
        return true;
    },
};

const app = createServer(mockIrrigation);
app.listen(PORT, () => {
    console.log(`Dev dashboard: http://localhost:${PORT}`);
    console.log('Running with mock data — no hardware required.');
});
