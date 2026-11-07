/**
 * Lasttest gegen einen laufenden Server: erstellt einen Raum mit 3 KI-Gegnern
 * (4 Spieler auf «Vier Winde»), startet und misst, wie gleichmässig die
 * Momentaufnahmen ankommen und ob der Server 15 Ticks pro Sekunde schafft.
 *
 * Aufruf: node scripts/load-test.ts wss://fight-for-the-right.onrender.com 120
 */
import { Client } from '@colyseus/sdk';

const url = process.argv[2] ?? 'ws://localhost:2567';
const seconds = Number(process.argv[3] ?? 60);

const client = new Client(url);
const room = await client.create('game', { name: 'Lasttest' });
console.log('Raum', room.roomId);
// Nachrichten, die hier nicht gebraucht werden (sonst warnt das SDK)
room.onMessage('lobby', () => undefined);
room.onMessage('start', () => undefined);
room.onMessage('error', (e: unknown) => console.log('Fehler', e));
room.send('settings', { mapId: 'vier-winde' });
for (const slot of [1, 2, 3]) room.send('slot', { slot, kind: 'ai', ai: 'easy' });
await new Promise((r) => setTimeout(r, 800));

const gaps: number[] = [];
let last = 0;
let firstTick = -1;
let lastTick = 0;
let start = 0;
let bytes = 0;
let units = 0;
room.onMessage('snap', (s: { t: number; u?: unknown[] }) => {
  const now = performance.now();
  if (firstTick < 0) {
    firstTick = s.t;
    start = now;
  } else gaps.push(now - last);
  last = now;
  lastTick = s.t;
  units += s.u?.length ?? 0;
  bytes += JSON.stringify(s).length;
});
room.send('start');

const report = () => {
  const elapsed = (last - start) / 1000;
  const sorted = [...gaps].sort((a, b) => a - b);
  const p = (q: number) => sorted[Math.floor(q * (sorted.length - 1))]?.toFixed(0);
  console.log(
    `${elapsed.toFixed(0)} s: ${((lastTick - firstTick) / elapsed).toFixed(1)} Ticks/s, Abstand Median ${p(0.5)} ms, 95% ${p(0.95)} ms, max ${p(1)} ms, ~${(bytes / Math.max(1, gaps.length)).toFixed(0)} Bytes/Aufnahme`,
  );
};
const timer = setInterval(report, 15_000);
await new Promise((r) => setTimeout(r, seconds * 1000));
clearInterval(timer);
report();
await room.leave();
process.exit(0);
