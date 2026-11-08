/**
 * Lasttest gegen einen laufenden Server: erstellt einen Raum mit 3 KI-Gegnern
 * (4 Spieler auf «Vier Winde», gemischte Teams), startet und misst, wie gleichmässig die
 * Momentaufnahmen ankommen und ob der Server 15 Ticks pro Sekunde schafft.
 * Verbindungsabbrüche und Server-Fehler werden mit Zeitpunkt gemeldet.
 *
 * Aufruf: node scripts/load-test.ts wss://fight-for-the-right.onrender.com 120 [easy|medium|hard]
 */
import { Client } from '@colyseus/sdk';

const url = process.argv[2] ?? 'ws://localhost:2567';
const seconds = Number(process.argv[3] ?? 60);
const level = process.argv[4] ?? 'easy';
const FACTIONS = ['volt', 'corsair', 'jungle', 'frost', 'aero', 'granite'];

const client = new Client(url);
const room = await client.create('game', { name: 'Lasttest' });
const t0 = performance.now();
const since = () => `${((performance.now() - t0) / 1000).toFixed(0)} s`;
console.log('Raum', room.roomId);
// Nachrichten, die hier nicht gebraucht werden (sonst warnt das SDK)
room.onMessage('lobby', () => undefined);
room.onMessage('start', () => undefined);
room.onMessage('ping', () => undefined);
room.onMessage('error', (e: unknown) => console.log('Fehler', e));
room.onDrop(() => console.log(`!!! ${since()}: Verbindung unterbrochen`));
room.onReconnect(() => console.log(`!!! ${since()}: wieder verbunden`));
room.onLeave((code: number) => console.log(`!!! ${since()}: Raum verlassen (Code ${code})`));
room.onError((code: number, msg?: string) => console.log(`!!! ${since()}: Raum-Fehler ${code} ${msg ?? ''}`));
room.send('settings', { mapId: 'vier-winde' });
room.send('slotSettings', { slot: 0, faction: FACTIONS[0] });
for (const slot of [1, 2, 3]) {
  room.send('slot', { slot, kind: 'ai', ai: level });
  room.send('slotSettings', { slot, faction: FACTIONS[slot] });
}
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
  const stale = ((performance.now() - last) / 1000).toFixed(0);
  console.log(
    `${since()}: Tick ${lastTick}, ${((lastTick - firstTick) / elapsed).toFixed(1)} Ticks/s, Abstand Median ${p(0.5)} ms, 95% ${p(0.95)} ms, max ${p(1)} ms, ~${(bytes / Math.max(1, gaps.length)).toFixed(0)} Bytes/Aufnahme, letzte Aufnahme vor ${stale} s`,
  );
};
const timer = setInterval(report, 60_000);
await new Promise((r) => setTimeout(r, seconds * 1000));
clearInterval(timer);
report();
await room.leave();
process.exit(0);
