import { z } from 'zod';
import { AI_LEVELS, FACTIONS, type AiLevel, type Faction } from '../data/rules';

/**
 * Lobby und Nachrichten zwischen Client und Server im Mehrspieler.
 * Gemeinsam genutzt, damit beide Seiten dieselben Regeln kennen.
 */

export const MAX_SLOTS = 4;
/** Spieler-id je Lobby-Platz (Platz 1 = Spieler 1 = Startplatz 1 der Karte). */
export const PLAYER_SLOT_IDS = [1, 2, 3, 4] as const;
export const GAME_MODES = ['ffa', 'teams', 'coop'] as const;
export type GameMode = (typeof GAME_MODES)[number];
export const START_CREDITS = [2000, 3000, 5000, 10000] as const;
export const GAME_SPEEDS = [0.75, 1, 1.25, 1.5] as const;
/** Vorgefertigte Chat-Nachrichten (kein freier Text – kinderfreundlich). */
export const CHAT_MESSAGES = ['hello', 'ready', 'goodLuck', 'wait', 'gg', 'thanks'] as const;
export type ChatMessage = (typeof CHAT_MESSAGES)[number];
/** Schnellnachrichten an Verbündete im Spiel. */
export const PING_KINDS = ['help', 'attack'] as const;
export type PingKind = (typeof PING_KINDS)[number];
/** So lange (Sekunden) darf ein Spieler nach einem Verbindungsabbruch zurückkehren. */
export const RECONNECT_SECONDS = 120;

export type SlotKind = 'open' | 'closed' | 'human' | 'ai';

export interface LobbySlot {
  kind: SlotKind;
  /** Colyseus-Sitzung (nur bei Menschen). */
  sessionId: string;
  name: string;
  faction: Faction;
  color: number;
  team: number;
  ready: boolean;
  ai: AiLevel;
  connected: boolean;
}

export interface LobbyState {
  code: string;
  hostSessionId: string;
  mapId: string;
  mode: GameMode;
  startCredits: number;
  speed: number;
  /** Neutrale Glimmerit-Quellen auf der Karte (Ingenieure können sie übernehmen). */
  bonusPoints: boolean;
  slots: LobbySlot[];
  chat: { from: string; msg: ChatMessage }[];
  started: boolean;
}

/** Startinformationen für ein Spiel (auch beim Wiederverbinden). */
export interface GameStartInfo {
  mapId: string;
  speed: number;
  startCredits: number;
  /** Spieler-id dieses Clients. */
  localPlayer: number;
  players: { id: number; name: string; faction: Faction; color: number; team: number; ai: boolean }[];
}

// ───────────── Nachrichten Client → Server (geprüft) ─────────────

export const LobbyMessages = {
  slot: z.object({ slot: z.number().int().min(0).max(MAX_SLOTS - 1), kind: z.enum(['open', 'closed', 'ai']), ai: z.enum(AI_LEVELS).optional() }),
  slotSettings: z.object({
    slot: z.number().int().min(0).max(MAX_SLOTS - 1),
    faction: z.enum(FACTIONS).optional(),
    color: z.number().int().min(0).max(7).optional(),
    team: z.number().int().min(0).max(2).optional(),
    ai: z.enum(AI_LEVELS).optional(),
  }),
  settings: z.object({
    mapId: z.string().max(40).optional(),
    mode: z.enum(GAME_MODES).optional(),
    startCredits: z.number().int().optional(),
    speed: z.number().optional(),
    bonusPoints: z.boolean().optional(),
  }),
  ready: z.object({ ready: z.boolean() }),
  chat: z.object({ msg: z.enum(CHAT_MESSAGES) }),
  ping: z.object({ kind: z.enum(PING_KINDS), x: z.number().int(), y: z.number().int() }),
};

// ───────────── Spielername ─────────────

/** Kleine Liste unerwünschter Wortteile (Deutsch/Englisch). Bewusst einfach gehalten. */
const BLOCKED = [
  'arsch', 'fick', 'fuck', 'shit', 'scheiss', 'scheiß', 'bitch', 'hure', 'nazi', 'hitler', 'wichs', 'fotze',
  'schlampe', 'penis', 'vagina', 'porn', 'sex', 'cunt', 'dick', 'kacke', 'idiot', 'spast', 'nigg', 'schwuchtel',
];

/**
 * Bereinigt einen Spielernamen: 2–16 Zeichen, nur Buchstaben, Ziffern, Leerzeichen, - und _.
 * Unpassende Namen werden durch «Kommandant» ersetzt.
 */
export function cleanName(raw: unknown, fallback = 'Kommandant'): string {
  if (typeof raw !== 'string') return fallback;
  const name = raw
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);
  if (name.length < 2) return fallback;
  // Erst Zahlen-Ersatzzeichen (1 → i …) zurückübersetzen, dann alles ausser Buchstaben entfernen
  const simple = name
    .toLowerCase()
    .replace(/0/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/[^a-zäöüß]/g, '');
  if (BLOCKED.some((w) => simple.includes(w))) return fallback;
  return name;
}

/** Einladungscode: 6 Zeichen ohne Verwechslungsgefahr (kein 0/O, 1/I/L). */
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function makeRoomCode(random: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(random() * CODE_CHARS.length)];
  return s;
}

export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

/** Leerer Slot. */
export function emptySlot(i: number, kind: SlotKind = 'open'): LobbySlot {
  return {
    kind,
    sessionId: '',
    name: '',
    faction: i % 2 === 0 ? 'aero' : 'granite',
    color: i,
    team: 0,
    ready: false,
    ai: 'easy',
    connected: false,
  };
}

/**
 * Prüft, ob mit diesen Einstellungen gestartet werden kann.
 * Gibt einen Fehler-Schlüssel (für die Sprachdatei) zurück oder null.
 */
export function validateStart(state: LobbyState, maxPlayers: number): string | null {
  const active = state.slots.filter((s) => s.kind === 'human' || s.kind === 'ai');
  if (active.length < 2) return 'lobby.err.tooFew';
  if (active.length > maxPlayers) return 'lobby.err.tooMany';
  if (state.slots.some((s) => s.kind === 'human' && !s.ready && s.sessionId !== state.hostSessionId)) return 'lobby.err.notReady';
  if (state.mode === 'teams') {
    const teams = new Set(active.map((s) => s.team));
    if (active.some((s) => s.team === 0) || teams.size < 2) return 'lobby.err.teams';
  }
  if (state.mode === 'coop') {
    if (!active.some((s) => s.kind === 'ai')) return 'lobby.err.coopNeedsAi';
  }
  return null;
}

/** Team je Slot nach Spielmodus. */
export function teamFor(state: LobbyState, slot: LobbySlot, index: number): number {
  switch (state.mode) {
    case 'ffa':
      return 0;
    case 'teams':
      return slot.team;
    case 'coop':
      return slot.kind === 'ai' ? 2 : 1;
  }
  return index;
}
