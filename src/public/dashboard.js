// Plant catalog — maps plant ID to display properties.
// emoji: displayed icon; name: label shown below icon;
// color: optional CSS rgba background tint on the icon circle (used to visually distinguish tomato variants).
const PLANT_CATALOG = {
    'tomato-red':    { emoji: '🍅', name: 'Rajče červené',  color: 'rgba(220, 38,  38,  0.22)', border: '#dc2626' },
    'tomato-yellow': { emoji: '🍅', name: 'Rajče žluté',    color: 'rgba(234, 179, 8,   0.25)', border: '#eab308' },
    'tomato-orange': { emoji: '🍅', name: 'Rajče oranžové', color: 'rgba(249, 115, 22,  0.22)', border: '#f97316' },
    'chives':        { emoji: '🌿', name: 'Pažitka'                                                               },
    'mint':          { emoji: '🌱', name: 'Máta'                                                                  },
    'lettuce':       { emoji: '🥬', name: 'Salát'                                                                 },
    'strawberry':    { emoji: '🍓', name: 'Jahoda'                                                                },
    'daffodil':      { emoji: '🌼', name: 'Narcisky'                                                              },
};

// Mapping: pump index → display position in the balcony grid
// col/row use CSS grid coordinates (1-based)
// Optional flags:
//   portrait: true  — longer side vertical (spans all 4 rows)
//   circular: true  — pot has round/oval shape
//   plant: string   — plant ID from PLANT_CATALOG; omit to show no icon
const POT_LAYOUT = [
    { index: 0,    col: 1, row: 1, rowSpan: 3, label: '13', portrait: true, plant: 'tomato-red',    forceable: true },  // short side — LEFT, portrait
    { index: 6,    col: 2, row: 1, label: '1',  plant: 'tomato-red',    forceable: true },  // single row
    { index: 1,    col: 3, row: 1, label: '2',  plant: 'tomato-orange', forceable: true },
    { index: 2,    col: 4, row: 1, label: '3',  plant: 'tomato-orange', forceable: true },
    { index: 9,    col: 5, row: 1, label: '4',  plant: 'daffodil', circular: true, disabled: true },
    { index: 10,   col: 2, row: 3, label: '5',  plant: 'chives', disabled: true },  // double row — top shelf
    { index: 11,   col: 3, row: 3, label: '6',  plant: 'lettuce'       },
    { index: 12,   col: 4, row: 3, label: '7',  plant: 'chives'        },  // Pažitka, hardware Máty (8)
    { index: null, col: 5, row: 3, label: '8',  plant: 'mint', circular: true, disabled: true },
    { index: 7,    col: 2, row: 4, label: '9',  plant: 'tomato-yellow' },  // double row — bottom shelf
    { index: 8,    col: 3, row: 4, label: '10', plant: 'tomato-orange' },
    { index: 4,    col: 4, row: 4, label: '11', plant: 'lettuce'       },
    { index: 3,    col: 5, row: 4, label: '12', plant: 'lettuce', disabled: true },
];

// ── Build balcony grid ─────────────────────────────────────────────────────

const grid = document.getElementById('balcony-grid');

POT_LAYOUT.forEach(({ index, col, row, rowSpan = 1, label, portrait = false, circular = false, plant, disabled = false, forceable = false }) => {
    const el = document.createElement('div');
    el.className = disabled ? 'pot state-disabled' : 'pot state-unknown';
    if (portrait) el.classList.add('pot-portrait');
    if (circular) el.classList.add('pot-circular');
    if (index !== null) el.dataset.index = index;
    el.style.setProperty('--grid-col', col);
    el.style.setProperty('--grid-row', rowSpan > 1 ? `${row} / ${row + rowSpan}` : String(row));

    const plantEntry = plant ? PLANT_CATALOG[plant] : null;
    const plantHtml = plantEntry ? `
        <div class="pot-plant" style="--plant-color: ${plantEntry.color ?? 'transparent'}; --plant-border: ${plantEntry.border ?? 'transparent'}">
            <span class="pot-plant-icon">${plantEntry.emoji}</span>
            <span class="pot-plant-name">${plantEntry.name}</span>
        </div>` : '';

    const actionsHtml = disabled ? '' : `
        <div class="pot-actions">
            <button class="irrigate-btn" data-index="${index}" title="Ruční zavlažení">💧</button>
            ${forceable ? `<button class="force-btn" data-index="${index}" title="Automatické zavlažení">⏱</button>` : ''}
        </div>`;

    el.innerHTML = `
        <div class="pot-info">
            <span class="pot-label">${label}</span>
            <span class="pot-count">—</span>
        </div>
        ${plantHtml}
        ${actionsHtml}
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
    // The stored timestamp is real CZ time serialised as if it were UTC
    // (server adds +2 h before calling toUTCString). Rendering with
    // timeZone:'UTC' prevents the browser from adding another +2 h offset.
    return new Date(utcString).toLocaleTimeString('cs-CZ', {
        hour: '2-digit', minute: '2-digit',
        timeZone: 'UTC',
    });
}

// ── Status update ──────────────────────────────────────────────────────────

let lastHistoryLength = 0;
let currentForcedIrrigations = {};

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
    document.getElementById('cycle-active').hidden = !status.irrigationRunning;

    document.getElementById('last-cycle-value').textContent =
        status.lastIrrigationTime ? formatTime(status.lastIrrigationTime) : '—';
    document.getElementById('next-cycle-value').textContent =
        status.nextIrrigationTime ? formatTime(status.nextIrrigationTime) : '—';

    const toggleBtn = document.getElementById('safety-toggle-btn');
    if (status.safetyShutdown) {
        toggleBtn.textContent = '▶ Obnovit zavlažování';
        toggleBtn.className = 'safety-toggle-btn safety-toggle-resume';
    } else {
        toggleBtn.textContent = '⏹ Zastavit zavlažování';
        toggleBtn.className = 'safety-toggle-btn safety-toggle-stop';
    }

    renderSafetyLog(status.safetyLog ?? []);

    const pumpsBlocked = status.safetyShutdown || status.tankEmpty || status.activePumpIndex !== null;

    // Pot states
    POT_LAYOUT.forEach(({ index, disabled }) => {
        if (disabled || index === null) return;
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

        const forceBtn = el.querySelector('.force-btn');
        if (forceBtn) {
            const n = status.forcedIrrigations?.[index] ?? 0;
            forceBtn.textContent = n > 0 ? `⏱ ${n}×` : '⏱';
            forceBtn.classList.toggle('is-active', n > 0);
        }
    });

    currentForcedIrrigations = status.forcedIrrigations ?? {};

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

// ── Safety log ─────────────────────────────────────────────────────────────

function formatDuration(startStr, endStr) {
    const mins = Math.round((new Date(endStr) - new Date(startStr)) / 60000);
    if (mins < 60) return `${mins} min`;
    return `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

let lastSafetyLogLength = 0;

function renderSafetyLog(log) {
    if (log.length === lastSafetyLogLength) return;
    lastSafetyLogLength = log.length;

    const container = document.getElementById('safety-log');
    if (log.length === 0) {
        container.innerHTML = '<p class="safety-log-empty">Žádné záznamy.</p>';
        return;
    }

    const rows = [...log].reverse().map(entry => {
        if (entry.type === 'sensor') {
            const from = formatTime(entry.startTime);
            const active = entry.endTime === null;
            const to   = active ? '<span class="safety-log-active">probíhá</span>' : formatTime(entry.endTime);
            const dur  = active ? '' : ` (${formatDuration(entry.startTime, entry.endTime)})`;
            return `<tr>
                <td><span class="safety-log-wet">Sensor ${entry.sensor} (GPIO ${entry.pin})</span></td>
                <td>${from}</td>
                <td>${to}${dur}</td>
                <td>Sensor</td>
            </tr>`;
        }
        const time = formatTime(entry.time);
        const label = entry.type === 'manual_stop' ? 'Ruční zastavení' : 'Ruční obnovení';
        return `<tr class="safety-log-manual">
            <td>${label}</td>
            <td>${time}</td>
            <td>—</td>
            <td>Manuální</td>
        </tr>`;
    }).join('');

    container.innerHTML = `<table class="safety-log-table">
        <thead><tr><th>Událost</th><th>Od</th><th>Do</th><th>Typ</th></tr></thead>
        <tbody>${rows}</tbody>
    </table>`;
}

// ── Safety toggle button ───────────────────────────────────────────────────

document.getElementById('safety-toggle-btn').addEventListener('click', async () => {
    const isShutdown = document.getElementById('safety-toggle-btn')
        .classList.contains('safety-toggle-resume');
    const msg = isShutdown
        ? 'Opravdu chcete obnovit zavlažování?'
        : 'Opravdu chcete zastavit zavlažování?';
    if (!confirm(msg)) return;
    const action = isShutdown ? 'resume' : 'shutdown';
    try {
        await fetch(`/api/safety/${action}`, { method: 'POST' });
    } catch (err) {
        console.error('Safety toggle failed:', err);
    }
});

// ── Test Discord notification ──────────────────────────────────────────────

document.getElementById('test-discord-btn').addEventListener('click', async () => {
    const btn    = document.getElementById('test-discord-btn');
    const result = document.getElementById('test-discord-result');
    btn.disabled = true;
    result.textContent = '…odesílám';
    result.style.color = '#6b7280';
    try {
        const res  = await fetch('/api/test/discord', { method: 'POST' });
        const data = await res.json();
        if (data.sent) {
            result.textContent = '✓ Zpráva odeslána';
            result.style.color = '#22c55e';
        } else {
            result.textContent = '✗ DISCORD_WEBHOOK_URL není nastavena';
            result.style.color = '#f97316';
        }
    } catch {
        result.textContent = '✗ Chyba spojení';
        result.style.color = '#ef4444';
    }
    btn.disabled = false;
});

// ── Forced irrigation modal ────────────────────────────────────────────────

let forceModalIndex = null;
let forceModalSelected = 0;

const forceModal       = document.getElementById('force-modal');
const forceModalSub    = document.getElementById('force-modal-sub');
const forceModalOpts   = document.getElementById('force-modal-options');
const forceModalSaveBtn   = document.getElementById('force-modal-save');
const forceModalCancelBtn = document.getElementById('force-modal-cancel');

function openForceModal(index) {
    const pot = POT_LAYOUT.find(p => p.index === index);
    if (!pot) return;
    const plantName = pot.plant ? PLANT_CATALOG[pot.plant]?.name ?? '' : '';
    forceModalSub.textContent = `Truhlík ${pot.label}${plantName ? ' — ' + plantName : ''}`;
    forceModalIndex    = index;
    forceModalSelected = currentForcedIrrigations[index] ?? 0;
    updateForceModalOptions();
    forceModal.hidden = false;
}

function updateForceModalOptions() {
    forceModalOpts.querySelectorAll('button').forEach(btn => {
        btn.classList.toggle('is-selected', Number(btn.dataset.n) === forceModalSelected);
    });
}

forceModalOpts.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-n]');
    if (!btn) return;
    forceModalSelected = Number(btn.dataset.n);
    updateForceModalOptions();
});

forceModalSaveBtn.addEventListener('click', async () => {
    if (forceModalIndex === null) return;
    forceModal.hidden = true;
    try {
        await fetch('/api/forced-irrigations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ index: forceModalIndex, count: forceModalSelected }),
        });
    } catch (err) {
        console.error('Forced irrigation save failed:', err);
    }
    forceModalIndex = null;
});

forceModalCancelBtn.addEventListener('click', () => {
    forceModal.hidden = true;
    forceModalIndex = null;
});

forceModal.addEventListener('click', (e) => {
    if (e.target === forceModal) {
        forceModal.hidden = true;
        forceModalIndex = null;
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !forceModal.hidden) {
        forceModal.hidden = true;
        forceModalIndex = null;
    }
});

grid.addEventListener('click', (e) => {
    const btn = e.target.closest('.force-btn');
    if (!btn) return;
    openForceModal(parseInt(btn.dataset.index, 10));
});

// ── Clear safety log ───────────────────────────────────────────────────────

document.getElementById('clear-log-btn').addEventListener('click', async () => {
    if (!confirm('Opravdu chcete vymazat celý safety log?')) return;
    try {
        await fetch('/api/safety/clear-log', { method: 'POST' });
    } catch (err) {
        console.error('Clear log failed:', err);
    }
});

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

// ── Manual sensor read ─────────────────────────────────────────────────────

document.getElementById('sensor-read-btn').addEventListener('click', async () => {
    const btn = document.getElementById('sensor-read-btn');
    btn.disabled = true;
    btn.textContent = '⟳ Měřím…';
    try {
        await fetch('/api/sensors/read', { method: 'POST' });
    } catch (err) {
        console.error('Sensor read request failed:', err);
    }
    btn.textContent = '⟳ Měření sensorů';
    btn.disabled = false;
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
