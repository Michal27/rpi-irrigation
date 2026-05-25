import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createServer(irrigation) {
	const app = express();

	app.use(express.static(join(__dirname, 'public')));

	app.get('/chart.min.js', (req, res) => {
		res.sendFile(join(__dirname, '../node_modules/chart.js/dist/chart.umd.min.js'));
	});

	app.get('/api/status', (req, res) => {
		res.json(irrigation.getStatus());
	});

	app.get('/api/events', (req, res) => {
		res.setHeader('Content-Type', 'text/event-stream');
		res.setHeader('Cache-Control', 'no-cache');
		res.setHeader('Connection', 'keep-alive');

		const send = () => res.write(`data: ${JSON.stringify(irrigation.getStatus())}\n\n`);
		send();
		const interval = setInterval(send, 2000);
		req.on('close', () => clearInterval(interval));
	});

	app.post('/api/irrigate/:index', async (req, res) => {
		const index = parseInt(req.params.index, 10);
		if (isNaN(index) || index < 0 || index >= 13) {
			return res.status(400).json({ error: 'Invalid pump index' });
		}
		const success = await irrigation.triggerManualIrrigation(index);
		res.json({ success });
	});

	return app;
}
