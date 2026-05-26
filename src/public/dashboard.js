// Mapping: pump index → display position in the balcony grid
// col/row use CSS grid coordinates (1-based)
// Optional flags:
//   portrait: true  — longer side vertical (spans all 4 rows)
//   circular: true  — pot has round/oval shape
const POT_LAYOUT = [
    { index: 12, col: 1, row: 1, rowSpan: 3, label: '13', portrait: true },  // short side — LEFT, portrait
    { index: 0,  col: 2, row: 1, label: '1'  },  // single row
    { index: 1,  col: 3, row: 1, label: '2'  },
    { index: 2,  col: 4, row: 1, label: '3'  },
    { index: 3,  col: 5, row: 1, label: '4'  },
    { index: 4,  col: 2, row: 3, label: '5'  },  // double row — top shelf
    { index: 5,  col: 3, row: 3, label: '6'  },
    { index: 6,  col: 4, row: 3, label: '7'  },
    { index: 7,  col: 5, row: 3, label: '8'  },
    { index: 8,  col: 2, row: 4, label: '9'  },  // double row — bottom shelf
    { index: 9,  col: 3, row: 4, label: '10' },
    { index: 10, col: 4, row: 4, label: '11' },
    { index: 11, col: 5, row: 4, label: '12' },
];

// ── Build balcony grid ─────────────────────────────────────────────────────

const grid = document.getElementById('balcony-grid');

POT_LAYOUT.forEach(({ index, col, row, rowSpan = 1, label, portrait = false, circular = false }) => {
    const el = document.createElement('div');
    el.className = 'pot state-unknown';
    if (portrait) el.classList.add('pot-portrait');
    if (circular) el.classList.add('pot-circular');
    el.dataset.index = index;
    el.style.setProperty('--grid-col', col);
    el.style.setProperty('--grid-row', rowSpan > 1 ? `${row} / ${row + rowSpan}` : String(row));
    el.innerHTML = `
        <div class="pot-info">
            <span class="pot-label">${label}</span>
            <span class="pot-count">—</span>
        </div>
        <button class="irrigate-btn" data-index="${index}" title="Ruční zavlažení">💧</button>
    `;
    grid.appendChild(el);
});

// ── Chart ──────────────────────────────────────────────────────────────────

const chart = new Chart(document.getElementById('climate-chart'), {
    type: 'line',
    data: {
        labels: [],
        datasets: [
            {
                label: 'Teplota (°C)',
                data: [],
                borderColor: '#ef4444',
                backgroundColor: 'rgba(239,68,68,0.08)',
                yAxisID: 'yTemp',
                tension: 0.3,
                pointRadius: 0,
                borderWidth: 2,
            },
            {
                label: 'Vlhkost (%)',
                data: [],
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59,130,246,0.08)',
                yAxisID: 'yHumid',
                tension: 0.3,
                pointRadius: 0,
                borderWidth: 2,
            },
            {
                label: 'CPU (°C)',
                data: [],
                borderColor: '#f97316',
                backgroundColor: 'rgba(249,115,22,0.08)',
                yAxisID: 'yTemp',
                tension: 0.3,
                pointRadius: 0,
                borderWidth: 2,
            },
        ],
    },
    options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: {
                labels: { color: '#9ca3af', boxWidth: 12 },
            },
        },
        scales: {
            x: {
                ticks: { color: '#6b7280', maxTicksLimit: 10, maxRotation: 0 },
                grid:  { color: '#1f2937' },
            },
            yTemp: {
                type: 'linear',
                position: 'left',
                ticks: { color: '#ef4444' },
                grid:  { color: '#374151' },
                title: { display: true, text: '°C', color: '#ef4444' },
            },
            yHumid: {
                type: 'linear',
                position: 'right',
                ticks: { color: '#3b82f6' },
                grid:  { drawOnChartArea: false },
                title: { display: true, text: '%', color: '#3b82f6' },
            },
        },
    },
});

function formatTime(utcString) {
    return new Date(utcString).toLocaleTimeString('cs-CZ', {
        hour: '2-digit', minute: '2-digit',
    });
}

// ── Status update ──────────────────────────────────────────────────────────

let lastHistoryLength = 0;

function applyStatus(status) {
    // Header values
    const tempEl = document.getElementById('temp-value');
    tempEl.textContent = status.temperature !== null ? `${status.temperature} °C` : '—';

    const humidEl = document.getElementById('humid-value');
    humidEl.textContent = status.humidity !== null ? `${status.humidity} %` : '—';

    const cpuEl = document.getElementById('cpu-value');
    cpuEl.textContent = status.cpuTemperature !== null ? `${status.cpuTemperature} °C` : '—';

    const tankEl = document.getElementById('tank-value');
    if (status.tankEmpty === null) {
        tankEl.textContent = '—';
        tankEl.className = 'value';
    } else if (status.tankEmpty) {
        tankEl.textContent = '⚠ Prázdná';
        tankEl.className = 'value value-warn';
    } else {
        tankEl.textContent = 'OK';
        tankEl.className = 'value value-ok';
    }

    document.getElementById('safety-alert').hidden = !status.safetyShutdown;

    const pumpsBlocked = status.safetyShutdown || status.tankEmpty || status.activePumpIndex !== null;

    // Pot states
    POT_LAYOUT.forEach(({ index }) => {
        const el = grid.querySelector(`.pot[data-index="${index}"]`);
        if (!el) return;

        const count = status.dailyCounts?.[index] ?? 0;
        el.querySelector('.pot-count').textContent = `${count}×`;

        el.classList.remove('state-wet', 'state-dry', 'state-active', 'state-unknown');

        if (status.activePumpIndex === index) {
            el.classList.add('state-active');
        } else if (status.sensorReadings?.[index] === null) {
            el.classList.add('state-unknown');
        } else if (status.sensorReadings?.[index] === 1) {  // HIGH = dry
            el.classList.add('state-dry');
        } else {
            el.classList.add('state-wet');
        }

        el.querySelector('.irrigate-btn').disabled = pumpsBlocked;
    });

    // Chart — update only when new history data arrives
    const history = status.temperatureHistory ?? [];
    if (history.length !== lastHistoryLength) {
        lastHistoryLength = history.length;
        chart.data.labels = history.map(d => formatTime(d.time));
        chart.data.datasets[0].data = history.map(d => d.temperature);
        chart.data.datasets[1].data = history.map(d => d.humidity);
        chart.data.datasets[2].data = history.map(d => d.cpuTemperature);
        chart.update('none');
    }
}

// ── Manual irrigation ──────────────────────────────────────────────────────

grid.addEventListener('click', async (e) => {
    const btn = e.target.closest('.irrigate-btn');
    if (!btn || btn.disabled) return;

    const index = parseInt(btn.dataset.index, 10);
    btn.disabled = true;

    try {
        await fetch(`/api/irrigate/${index}`, { method: 'POST' });
    } catch (err) {
        console.error('Irrigation request failed:', err);
        btn.disabled = false;
    }
});

// ── SSE connection ─────────────────────────────────────────────────────────

const evtSource = new EventSource('/api/events');

evtSource.onmessage = (e) => {
    try {
        applyStatus(JSON.parse(e.data));
    } catch (err) {
        console.error('Failed to parse status:', err);
    }
};

evtSource.onerror = () => console.warn('SSE reconnecting…');
