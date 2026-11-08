/**
 * Prüft, ob der Server einen echten Verbindungsabbruch übersteht, nach dem der Spieler NICHT
 * zurückkommt (z.B. Handy im Standby oder WLAN weg). Der Gast läuft in einem eigenen Prozess,
 * der hart beendet wird. In der Lobby wartet der Server 30 s, im Spiel 2 Minuten auf die Rückkehr.
 *
 * Aufruf: node scripts/drop-test.ts ws://localhost:2567 [lobby|game]
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@colyseus/sdk';

const url = process.argv[2] ?? 'ws://localhost:2567';
const phase = process.argv[3] ?? 'lobby';

// ───────────── Gast-Prozess ─────────────
if (phase === 'guest') {
  const room = await new Client(url).joinById(process.argv[4], { name: 'Gast' });
  for (const t of ['lobby', 'start', 'snap', 'error', 'ping']) room.onMessage(t, () => undefined);
  room.send('ready', { ready: true });
  console.log('GAST_BEREIT');
  await new Promise(() => undefined); // läuft, bis der Prozess beendet wird
}

const http = url.replace(/^ws/, 'http');
const health = async () => {
  try {
    const r = await fetch(`${http}/health`);
    return r.ok ? 'ok' : `HTTP ${r.status}`;
  } catch (e) {
    return `NICHT ERREICHBAR (${(e as Error).message})`;
  }
};

const host = await new Client(url).create('game', { name: 'Gastgeber' });
let lobbyInfo = '';
host.onMessage('lobby', (l: { started: boolean; slots: { kind: string; name: string; connected: boolean }[] }) => {
  lobbyInfo = l.slots.map((s) => `${s.kind}${s.kind === 'human' ? (s.connected ? '+' : '-') : ''}:${s.name}`).join(' | ');
});
for (const t of ['start', 'snap', 'error', 'ping']) host.onMessage(t, () => undefined);
host.onLeave((code: number) => console.log(`!!! Gastgeber getrennt (Code ${code})`));
console.log('Raum', host.roomId, '– Phase', phase);

const guest = spawn(process.execPath, [fileURLToPath(import.meta.url), url, 'guest', host.roomId], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise<void>((resolve) => guest.stdout.on('data', (d: Buffer) => d.toString().includes('GAST_BEREIT') && resolve()));
await new Promise((r) => setTimeout(r, 6000)); // Raum muss ein paar Sekunden alt sein
if (phase === 'game') {
  host.send('start');
  await new Promise((r) => setTimeout(r, 3000));
}
console.log('vorher:', lobbyInfo);
guest.kill('SIGKILL'); // harter Abbruch, kein Abmelden
console.log('Gast-Prozess beendet. Server:', await health());
const wait = phase === 'game' ? 140 : 45;
for (let s = 15; s <= wait; s += 15) {
  await new Promise((r) => setTimeout(r, 15_000));
  console.log(`${s} s: Server ${await health()} – Plätze: ${lobbyInfo}`);
}
await host.leave(true).catch(() => undefined);
process.exit(0);
