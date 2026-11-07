import { DIRS, type GameMap } from '../map/gameMap';
import type { MoveClass } from '../map/terrain';
import type { TilePoint } from '../path/astar';

/**
 * Sammelt `count` freie Kacheln rund um das Ziel (Breitensuche nach aussen).
 * Ergibt eine kompakte «Traube» – jede Einheit der Gruppe bekommt einen
 * eigenen Platz, damit sich am Ziel nicht alle auf einen Punkt drängen.
 * Gibt es weniger freie Kacheln als Einheiten, werden Plätze mehrfach vergeben.
 */
export function collectSlots(map: GameMap, cls: MoveClass, goal: TilePoint, count: number): TilePoint[] {
  const slots: TilePoint[] = [];
  if (count <= 0 || !map.passable(goal.tx, goal.ty, cls)) return slots;
  const seen = new Uint8Array(map.width * map.height);
  const queue: number[] = [map.index(goal.tx, goal.ty)];
  seen[queue[0]] = 1;
  for (let head = 0; head < queue.length && slots.length < count; head++) {
    const cur = queue[head];
    const x = cur % map.width;
    const y = (cur - x) / map.width;
    slots.push({ tx: x, ty: y });
    for (const [dx, dy] of DIRS) {
      if (!map.canStep(x, y, dx, dy, cls)) continue;
      const ni = map.index(x + dx, y + dy);
      if (seen[ni]) continue;
      seen[ni] = 1;
      queue.push(ni);
    }
  }
  const found = slots.length;
  for (let i = found; i < count && found > 0; i++) slots.push(slots[i % found]);
  return slots;
}
