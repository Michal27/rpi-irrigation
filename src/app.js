import Irrigation from './irrigation.js';
import { createServer } from './server.js';

const PORT = 3000;

const irrigation = new Irrigation();
irrigation.run();

const app = createServer(irrigation);
app.listen(PORT, () => {
	console.log(`Dashboard: http://localhost:${PORT}`);
});
