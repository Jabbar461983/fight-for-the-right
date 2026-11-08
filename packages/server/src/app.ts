import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { GameRoom, SERVER_VERSION, openRoomCount } from './GameRoom';

/** Baut den Server (ohne ihn zu starten) – so können Tests ihn selbst hochfahren. */
export function createServer(): Server {
  const server = new Server({
    transport: new WebSocketTransport({ pingInterval: 5000, pingMaxRetries: 3 }),
    express: (app) => {
      // Für den Gesundheits-Check des Hosters und zum Aufwecken nach dem Einschlafen
      app.get('/health', (_req, res) => {
        // uptime: Sekunden seit dem Start – zeigt, ob der Server neu gestartet wurde
        // version: Fingerabdruck der Inhalte – der Client prüft, ob er zum Server passt
        res.json({ ok: true, game: 'fight-for-the-right', version: SERVER_VERSION, uptime: Math.round(process.uptime()), rooms: openRoomCount() });
      });
    },
    greet: false,
  });
  server.define('game', GameRoom);
  return server;
}
