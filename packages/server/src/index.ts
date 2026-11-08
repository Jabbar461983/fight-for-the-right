import { createServer } from './app';
import { openRoomCount } from './GameRoom';

/**
 * Einstieg des Mehrspieler-Servers.
 * Lokal: `npm run dev` (Port 2567). Auf Render: Port aus der Umgebungsvariable PORT.
 */
const port = Number(process.env.PORT ?? 2567);

// Ein unerwarteter Fehler darf nicht den ganzen Prozess (und damit alle Partien) beenden:
// protokollieren und weiterlaufen.
process.on('uncaughtException', (e) => console.error('Unerwarteter Fehler (Server läuft weiter):', e));
process.on('unhandledRejection', (e) => console.error('Unbehandelte Ablehnung (Server läuft weiter):', e));

const server = createServer();
await server.listen(port, '0.0.0.0');
console.log(`Fight for the Right – Server läuft auf Port ${port}`);

/**
 * Wachhalten: Render Free legt den Dienst nach 15 Minuten ohne neue HTTP-Anfrage schlafen –
 * offene Spielverbindungen (WebSocket) zählen dabei nicht. Solange ein Raum offen ist,
 * ruft der Server deshalb alle 4 Minuten seine eigene öffentliche Adresse auf.
 */
const publicUrl = process.env.RENDER_EXTERNAL_URL;
if (publicUrl) {
  setInterval(() => {
    if (openRoomCount() === 0) return;
    fetch(`${publicUrl}/health`).catch((e: unknown) => console.warn('Wachhalten fehlgeschlagen:', e));
  }, 4 * 60 * 1000).unref();
}
