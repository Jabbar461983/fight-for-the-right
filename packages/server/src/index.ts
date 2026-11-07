import { createServer } from './app';

/**
 * Einstieg des Mehrspieler-Servers.
 * Lokal: `npm run dev` (Port 2567). Auf Render: Port aus der Umgebungsvariable PORT.
 */
const port = Number(process.env.PORT ?? 2567);
const server = createServer();
await server.listen(port, '0.0.0.0');
console.log(`Fight for the Right – Server läuft auf Port ${port}`);
