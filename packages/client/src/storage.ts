/**
 * Kleiner Schlüssel-Wert-Speicher in IndexedDB (Einstellungen, später
 * Kampagnenfortschritt). Funktioniert der Speicher nicht (privates Fenster),
 * läuft das Spiel trotzdem – es merkt sich dann eben nichts.
 */

const DB_NAME = 'fight-for-the-right';
const STORE = 'kv';
let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

export async function getItem<T>(key: string): Promise<T | undefined> {
  const db = await open();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export async function setItem(key: string, value: unknown): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Kampagnenfortschritt: je Mission die geschafften Schwierigkeitsgrade. */
export interface CampaignProgress {
  done: Record<string, ('easy' | 'medium' | 'hard')[]>;
  /** Zuletzt gewählter Schwierigkeitsgrad. */
  lastDifficulty?: 'easy' | 'medium' | 'hard';
}

export async function loadProgress(): Promise<CampaignProgress> {
  const p = await getItem<CampaignProgress>('campaign');
  return { done: {}, ...(p ?? {}) };
}

/** Mission geschafft → speichern (schaltet die nächste frei). */
export async function markMissionDone(id: string, difficulty: 'easy' | 'medium' | 'hard'): Promise<CampaignProgress> {
  const p = await loadProgress();
  const list = p.done[id] ?? [];
  if (!list.includes(difficulty)) list.push(difficulty);
  p.done[id] = list;
  await setItem('campaign', p);
  return p;
}

export async function saveLastDifficulty(d: 'easy' | 'medium' | 'hard'): Promise<void> {
  const p = await loadProgress();
  p.lastDifficulty = d;
  await setItem('campaign', p);
}

/** Einstellungen des Spiels. */
export interface Settings {
  /** Spieltempo im Einzelspieler (1 = normal). */
  gameSpeed: number;
  musicVolume: number;
  sfxVolume: number;
}

export const DEFAULT_SETTINGS: Settings = { gameSpeed: 1, musicVolume: 0.6, sfxVolume: 0.8 };

let settings: Settings = { ...DEFAULT_SETTINGS };

export async function loadSettings(): Promise<Settings> {
  const s = await getItem<Partial<Settings>>('settings');
  settings = { ...DEFAULT_SETTINGS, ...(s ?? {}) };
  return settings;
}

export function getSettings(): Settings {
  return settings;
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  settings = { ...settings, ...patch };
  await setItem('settings', settings);
}
