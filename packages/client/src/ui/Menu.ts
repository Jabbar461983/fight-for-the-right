import {
  AI_LEVELS,
  ARMOR_CLASSES,
  effectiveness,
  CHAT_MESSAGES,
  FACTIONS,
  GAME_MODES,
  GAME_SPEEDS,
  START_CREDITS,
  normalizeCode,
  type AiLevel,
  type Faction,
  type GameStartInfo,
  type LobbySlot,
  type SlotSetup,
} from '@fftr/shared';
import { MAPS, getMission, getMissions, getRules, mapInfo } from '../data';
import { applyI18n, getLang, onLangChange, setLang, t, type Lang } from '../i18n';
import { PLAYER_COLORS, iconFor } from '../game/textures';
import { NetSession } from '../net/NetSession';
import { getItem, getSettings, loadProgress, saveLastDifficulty, saveSettings, setItem, type CampaignProgress } from '../storage';
import { emblem, portrait } from './portraits';
import { armorIcon, ratingTable } from './armorIcons';
import { play, setVolumes } from '../audio/sound';

/** Alles, was die Spielszene für eine Partie braucht. */
export interface GameConfig {
  mapId: string;
  slots: SlotSetup[];
  startCredits: number;
  /** Die id des Spielers an diesem Gerät. */
  localPlayer: number;
  /** Nur im Mehrspieler: Verbindung und Startinfo vom Server. */
  net?: NetSession;
  speed?: number;
  /** Kampagnen-Mission (Einzelspieler). */
  mission?: { id: string; difficulty: AiLevel };
  /** Neutrale Glimmerit-Quellen (Standard: an). */
  bonusPoints?: boolean;
}

const NAME_KEY = 'fftr.name';
/** Teams mit eigener Kampagne. */
const CAMPAIGN_FACTIONS = ['aero', 'granite'] as const;

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

type Screen = 'main' | 'skirmish' | 'settings' | 'credits' | 'multiplayer' | 'lobby' | 'campaign' | 'briefing' | 'guide';

/** Spielkonfiguration aus der Startinfo des Servers. */
export function configFromStart(info: GameStartInfo, net: NetSession): GameConfig {
  return {
    mapId: info.mapId,
    startCredits: info.startCredits,
    localPlayer: info.localPlayer,
    speed: info.speed,
    net,
    slots: info.players.map((p) => ({ id: p.id, name: p.name, faction: p.faction, color: p.color, team: p.team, ai: p.ai ? 'easy' : undefined })),
  };
}

/**
 * Hauptmenü und Untermenüs als HTML-Überlagerung, inklusive Mehrspieler-Lobby.
 */
export class Menu {
  private root: HTMLElement;
  private config: GameConfig;
  private screen: Screen = 'main';
  private net: NetSession | null = null;
  private status = '';
  private busy = false;
  private joinCode = '';

  constructor(
    parent: HTMLElement,
    private readonly onStart: (config: GameConfig) => void,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'menu';
    parent.appendChild(this.root);
    this.config = this.defaultConfig();
    void getItem<GameConfig>('lastSkirmish').then((c) => {
      if (c && MAPS.some((m) => m.id === c.mapId) && Array.isArray(c.slots) && c.slots.length >= 2) {
        for (const s of c.slots) if (s.ai && !AI_LEVELS.includes(s.ai)) s.ai = 'easy';
        this.config = { ...c, net: undefined };
        if (this.screen === 'skirmish') this.render();
      }
    });
    onLangChange(() => this.render());

    // Einladungslink (?join=CODE) → direkt zum Beitreten
    const join = new URLSearchParams(location.search).get('join');
    if (join) {
      this.joinCode = normalizeCode(join);
      this.screen = 'multiplayer';
    }
    this.render();
    void this.tryResume();
  }

  private defaultConfig(): GameConfig {
    return {
      mapId: MAPS[0].id,
      startCredits: 3000,
      localPlayer: 1,
      slots: [
        { id: 1, name: '', faction: 'aero', color: 0, team: 0 },
        { id: 2, name: '', faction: 'granite', color: 1, team: 0, ai: 'easy' },
      ],
    };
  }

  show(screen: Screen = 'main'): void {
    this.screen = screen;
    this.root.hidden = false;
    this.render();
  }

  hide(): void {
    this.root.hidden = true;
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  /** Nach dem Neuladen der Seite: in einen laufenden Raum zurück. */
  private async tryResume(): Promise<void> {
    const net = await NetSession.resume();
    if (!net) return;
    this.attach(net);
    if (!net.start) this.show('lobby');
  }

  private render(): void {
    switch (this.screen) {
      case 'main':
        this.renderMain();
        break;
      case 'skirmish':
        this.renderSkirmish();
        break;
      case 'settings':
        this.renderSettings();
        break;
      case 'credits':
        this.renderCredits();
        break;
      case 'multiplayer':
        this.renderMultiplayer();
        break;
      case 'lobby':
        this.renderLobby();
        break;
      case 'campaign':
        this.renderCampaign();
        break;
      case 'briefing':
        this.renderBriefing();
        break;
      case 'guide':
        this.renderGuide();
        break;
    }
    applyI18n(this.root);
  }

  private bindGo(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-go]').forEach((b) =>
      b.addEventListener('click', () => this.show(b.dataset.go as Screen)),
    );
  }

  private renderMain(): void {
    this.root.innerHTML = `
      <div class="menu-card main">
        <div class="logo">
          <div class="logo-crystal"></div>
          <h1 data-i18n="game.title"></h1>
          <p data-i18n="game.tagline"></p>
        </div>
        <div class="menu-buttons">
          <button type="button" class="primary" data-go="campaign" data-i18n="menu.campaign"></button>
          <button type="button" class="primary" data-go="skirmish" data-i18n="menu.skirmish"></button>
          <button type="button" class="primary" data-go="multiplayer" data-i18n="menu.multiplayer"></button>
          <button type="button" data-go="guide" data-i18n="menu.guide"></button>
          <button type="button" data-go="settings" data-i18n="menu.settings"></button>
          <button type="button" data-go="credits" data-i18n="menu.credits"></button>
        </div>
      </div>`;
    this.bindGo();
  }

  // ───────────── Kampagne ─────────────

  private progress: CampaignProgress = { done: {} };
  private briefingId = '';
  private difficulty: AiLevel = 'medium';

  /** Direkt zum Briefing einer Mission (z.B. «Nächste Mission» nach einem Sieg). */
  openBriefing(id: string): void {
    this.briefingId = id;
    void loadProgress().then((p) => {
      this.progress = p;
      this.difficulty = p.lastDifficulty ?? this.difficulty;
      this.show('briefing');
    });
  }

  /** Ist die Mission freigeschaltet? (erste je Fraktion immer, sonst Vorgängerin geschafft) */
  private unlocked(id: string): boolean {
    const m = getMission(id);
    if (!m) return false;
    const prev = getMissions().find((o) => o.faction === m.faction && o.order === m.order - 1);
    return !prev || (this.progress.done[prev.id]?.length ?? 0) > 0;
  }

  private renderCampaign(): void {
    // Fortschritt nachladen (asynchron), dann neu zeichnen
    void loadProgress().then((p) => {
      if (JSON.stringify(p) === JSON.stringify(this.progress)) return;
      this.progress = p;
      if (this.screen === 'campaign') this.render();
    });
    const column = (f: 'aero' | 'granite') => {
      const missions = getMissions().filter((m) => m.faction === f);
      const cards = missions
        .map((m) => {
          const open = this.unlocked(m.id);
          const done = this.progress.done[m.id] ?? [];
          const stars = AI_LEVELS.map((l) => `<i class="star ${done.includes(l) ? 'on' : ''}" title="${t(`ai.${l}`)}">★</i>`).join('');
          return `<button type="button" class="mission-card ${done.length ? 'done' : ''}" data-mission="${m.id}" ${open ? '' : 'disabled'}>
            <span class="mission-no">${m.id.toUpperCase()}</span>
            <span class="mission-title">${t(m.titleKey)}</span>
            <span class="mission-state">${open ? stars : `🔒 ${t('campaign.locked')}`}</span>
          </button>`;
        })
        .join('');
      return `<section class="campaign-col ${f}">
        <header><img src="${portrait(f)}" alt="" /><div><b>${t(`faction.${f}`)}</b><small>${t(`commander.${f}`)}</small></div></header>
        ${cards}
      </section>`;
    };
    this.root.innerHTML = `
      <div class="menu-card wide">
        <h2 data-i18n="campaign.title"></h2>
        <p class="muted" data-i18n="campaign.intro"></p>
        <div class="campaign-cols">${CAMPAIGN_FACTIONS.map(column).join('')}</div>
        <div class="menu-actions"><button type="button" data-go="main" data-i18n="menu.back"></button></div>
      </div>`;
    this.root.querySelectorAll<HTMLButtonElement>('[data-mission]').forEach((b) =>
      b.addEventListener('click', () => this.openBriefing(b.dataset.mission!)),
    );
    this.bindGo();
  }

  private renderBriefing(): void {
    const m = getMission(this.briefingId);
    if (!m) {
      this.show('campaign');
      return;
    }
    const paragraphs = t(m.briefingKey)
      .split('\n')
      .map((p) => `<p>${esc(p)}</p>`)
      .join('');
    this.root.innerHTML = `
      <div class="menu-card wide briefing ${m.faction}">
        <h2><span class="mission-no">${m.id.toUpperCase()}</span> ${esc(t(m.titleKey))}</h2>
        <div class="briefing-body">
          <figure><img src="${portrait(m.faction === 'granite' ? 'granite' : 'aero')}" alt="" /><figcaption>${t(`commander.${m.faction}`)}</figcaption></figure>
          <div class="briefing-text">
            ${paragraphs}
            <h3 data-i18n="campaign.goals"></h3>
            <ul class="goals">${m.briefingGoals.map((g) => `<li>${esc(t(g))}</li>`).join('')}</ul>
          </div>
        </div>
        <h3 data-i18n="skirmish.difficulty"></h3>
        <div class="difficulty-buttons">${AI_LEVELS.map(
          (l) => `<button type="button" data-level="${l}" class="${this.difficulty === l ? 'active' : ''}">${t(`ai.${l}`)}${(this.progress.done[m.id] ?? []).includes(l) ? ' ★' : ''}</button>`,
        ).join('')}</div>
        <div class="menu-actions">
          <button type="button" data-go="campaign" data-i18n="menu.back"></button>
          <button type="button" class="primary big" id="mission-start" data-i18n="campaign.start"></button>
        </div>
      </div>`;
    this.root.querySelectorAll<HTMLButtonElement>('[data-level]').forEach((b) =>
      b.addEventListener('click', () => {
        this.difficulty = b.dataset.level as AiLevel;
        void saveLastDifficulty(this.difficulty);
        this.render();
      }),
    );
    this.root.querySelector('#mission-start')!.addEventListener('click', () => {
      this.hide();
      this.onStart({
        mapId: m.map,
        startCredits: 0,
        localPlayer: 1,
        slots: m.players.map((p) => ({ id: p.id, name: t(p.nameKey), faction: p.faction, color: p.color, team: p.team })),
        mission: { id: m.id, difficulty: this.difficulty },
      });
    });
    this.bindGo();
  }

  // ───────────── Gefecht gegen KI ─────────────

  private renderSkirmish(): void {
    const cfg = this.config;
    const map = mapInfo(cfg.mapId);
    // Zu viele Plätze für die Karte → kürzen
    if (cfg.slots.length > map.maxPlayers) cfg.slots = cfg.slots.slice(0, map.maxPlayers);
    const rules = getRules();
    const me = cfg.slots[0];
    const factionCard = (f: Faction) => {
      return `<button type="button" class="faction-card ${me.faction === f ? 'active' : ''}" data-faction="${f}">
        <img class="emblem" src="${emblem(f)}" alt="" />
        <b data-i18n="faction.${f}"></b><small data-i18n="faction.${f}.desc"></small></button>`;
    };
    const slotRow = (s: SlotSetup, i: number) => `
      <div class="slot-row" data-slot="${i}">
        <span class="slot-name" style="--c:${hex(PLAYER_COLORS[s.color])}">${s.ai ? `${t('skirmish.computer')} ${i}` : t('skirmish.you')}</span>
        ${this.factionSelect(s.faction)}
        ${this.swatches(s.color, cfg.slots.filter((_, oi) => oi !== i).map((o) => o.color))}
        ${this.teamSelect(s.team)}
        ${s.ai ? this.aiSelect(s.ai) : '<span></span>'}
        ${s.ai && cfg.slots.length > 2 ? `<button type="button" class="small" data-remove="${i}" aria-label="${t('lobby.remove')}">✕</button>` : '<span></span>'}
      </div>`;
    this.root.innerHTML = `
      <div class="menu-card wide">
        <h2 data-i18n="skirmish.title"></h2>
        <div class="faction-cards">${FACTIONS.map(factionCard).join('')}</div>
        <div class="form-grid">
          <label><span data-i18n="skirmish.map"></span>
            <select id="map-select">${MAPS.map((m) => `<option value="${m.id}" ${m.id === map.id ? 'selected' : ''}>${t(m.nameKey)}</option>`).join('')}</select>
            <small>${t(`map.${map.id}.desc`)}</small>
          </label>
          <label><span data-i18n="skirmish.startCredits"></span>
            <select id="credits-select">${START_CREDITS.map((c) => `<option value="${c}" ${cfg.startCredits === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
          </label>
          <label><span data-i18n="skirmish.bonusPoints"></span>
            <select id="bonus-select">${this.onOffOptions(cfg.bonusPoints ?? true)}</select>
          </label>
        </div>
        <h3 data-i18n="skirmish.players"></h3>
        <div class="slots">${cfg.slots.map(slotRow).join('')}</div>
        ${cfg.slots.length < map.maxPlayers ? `<button type="button" class="add-ai" id="add-ai">+ ${t('lobby.addAi')}</button>` : ''}
        <div class="menu-actions">
          <button type="button" data-go="main" data-i18n="menu.back"></button>
          <button type="button" class="primary big" id="start" data-i18n="menu.start"></button>
        </div>
      </div>`;

    const rerender = () => this.render();
    this.root.querySelectorAll<HTMLButtonElement>('[data-faction]').forEach((b) =>
      b.addEventListener('click', () => {
        me.faction = b.dataset.faction as Faction;
        rerender();
      }),
    );
    this.root.querySelector<HTMLSelectElement>('#map-select')!.addEventListener('change', (e) => {
      cfg.mapId = (e.target as HTMLSelectElement).value;
      rerender();
    });
    this.root.querySelector<HTMLSelectElement>('#credits-select')!.addEventListener('change', (e) => {
      cfg.startCredits = Number((e.target as HTMLSelectElement).value);
    });
    this.root.querySelector<HTMLSelectElement>('#bonus-select')!.addEventListener('change', (e) => {
      cfg.bonusPoints = (e.target as HTMLSelectElement).value === 'on';
    });
    this.root.querySelector('#add-ai')?.addEventListener('click', () => {
      const used = new Set(cfg.slots.map((s) => s.color));
      const color = PLAYER_COLORS.findIndex((_, i) => !used.has(i));
      cfg.slots.push({ id: cfg.slots.length + 1, name: '', faction: cfg.slots.length % 2 ? 'granite' : 'aero', color, team: 0, ai: 'easy' });
      rerender();
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((b) =>
      b.addEventListener('click', () => {
        cfg.slots.splice(Number(b.dataset.remove), 1);
        cfg.slots.forEach((s, i) => (s.id = i + 1));
        rerender();
      }),
    );
    this.root.querySelectorAll<HTMLElement>('.slot-row').forEach((row) => {
      const s = cfg.slots[Number(row.dataset.slot)];
      row.querySelectorAll<HTMLSelectElement>('select[data-field]').forEach((sel) =>
        sel.addEventListener('change', () => {
          const v = sel.value;
          if (sel.dataset.field === 'faction') s.faction = v as Faction;
          if (sel.dataset.field === 'team') s.team = Number(v);
          if (sel.dataset.field === 'ai') s.ai = v as AiLevel;
          rerender();
        }),
      );
      row.querySelectorAll<HTMLButtonElement>('[data-color]').forEach((b) =>
        b.addEventListener('click', () => {
          s.color = Number(b.dataset.color);
          rerender();
        }),
      );
    });
    this.bindGo();
    this.root.querySelector('#start')!.addEventListener('click', () => {
      const named = cfg.slots.map((s, i) => ({ ...s, name: s.ai ? `${t('skirmish.computer')} ${i}` : t('skirmish.you') }));
      const game: GameConfig = { ...cfg, slots: named };
      void setItem('lastSkirmish', { ...cfg, net: undefined });
      this.hide();
      this.onStart(game);
    });
  }

  private factionSelect(value: Faction, disabled = false): string {
    return `<select data-field="faction" ${disabled ? 'disabled' : ''}>${FACTIONS.map(
      (f) => `<option value="${f}" ${value === f ? 'selected' : ''}>${t(`faction.${f}`)}</option>`,
    ).join('')}</select>`;
  }

  private teamSelect(value: number, disabled = false): string {
    return `<select data-field="team" aria-label="${t('skirmish.team')}" ${disabled ? 'disabled' : ''}>${[0, 1, 2]
      .map((tm) => `<option value="${tm}" ${value === tm ? 'selected' : ''}>${tm === 0 ? t('skirmish.noTeam') : `${t('skirmish.team')} ${tm}`}</option>`)
      .join('')}</select>`;
  }

  private onOffOptions(on: boolean): string {
    return `<option value="on" ${on ? 'selected' : ''}>${t('menu.on')}</option><option value="off" ${on ? '' : 'selected'}>${t('menu.off')}</option>`;
  }

  private aiSelect(value: AiLevel, disabled = false): string {
    return `<select data-field="ai" aria-label="${t('skirmish.difficulty')}" ${disabled ? 'disabled' : ''}>${AI_LEVELS.map(
      (l) => `<option value="${l}" ${value === l ? 'selected' : ''}>${t(`ai.${l}`)}</option>`,
    ).join('')}</select>`;
  }

  private swatches(value: number, taken: number[], disabled = false): string {
    return `<span class="swatches">${PLAYER_COLORS.map(
      (c, ci) =>
        `<button type="button" class="swatch ${value === ci ? 'active' : ''}" data-color="${ci}" style="background:${hex(c)}" aria-label="${t('skirmish.color')} ${ci + 1}" ${
          disabled || taken.includes(ci) ? 'disabled' : ''
        }></button>`,
    ).join('')}</span>`;
  }

  // ───────────── Mehrspieler: Beitreten / Erstellen ─────────────

  private savedName(): string {
    try {
      return localStorage.getItem(NAME_KEY) ?? '';
    } catch {
      return '';
    }
  }

  private renderMultiplayer(): void {
    this.root.innerHTML = `
      <div class="menu-card">
        <h2 data-i18n="mp.title"></h2>
        <div class="form-grid single">
          <label><span data-i18n="mp.name"></span>
            <input id="mp-name" maxlength="16" autocomplete="nickname" value="${esc(this.savedName())}" placeholder="${t('mp.namePlaceholder')}" />
          </label>
        </div>
        <div class="menu-buttons">
          <button type="button" class="primary" id="mp-create" data-i18n="mp.create"></button>
        </div>
        <div class="join-row">
          <input id="mp-code" maxlength="6" autocapitalize="characters" autocomplete="off" placeholder="${t('mp.codePlaceholder')}" value="${esc(this.joinCode)}" />
          <button type="button" class="primary" id="mp-join" data-i18n="mp.join"></button>
        </div>
        <p class="status" id="mp-status">${esc(this.status)}</p>
        <div class="menu-actions"><button type="button" data-go="main" data-i18n="menu.back"></button></div>
      </div>`;
    this.bindGo();
    const nameEl = this.root.querySelector<HTMLInputElement>('#mp-name')!;
    const codeEl = this.root.querySelector<HTMLInputElement>('#mp-code')!;
    codeEl.addEventListener('input', () => {
      codeEl.value = normalizeCode(codeEl.value);
      this.joinCode = codeEl.value;
    });
    const name = () => {
      const n = nameEl.value.trim();
      try {
        localStorage.setItem(NAME_KEY, n);
      } catch {
        // egal
      }
      return n || t('mp.defaultName');
    };
    this.root.querySelector('#mp-create')!.addEventListener('click', () => void this.connect(() => NetSession.create(name())));
    this.root.querySelector('#mp-join')!.addEventListener('click', () => {
      const code = normalizeCode(codeEl.value);
      if (code.length !== 6) {
        this.setStatus(t('mp.err.code'));
        return;
      }
      void this.connect(() => NetSession.join(code, name()));
    });
    if (this.joinCode) nameEl.focus();
  }

  private setStatus(text: string): void {
    this.status = text;
    const el = this.root.querySelector('#mp-status');
    if (el) el.textContent = text;
  }

  private async connect(open: () => Promise<NetSession>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.setStatus(t('mp.connecting'));
    try {
      await NetSession.wake(() => this.setStatus(t('mp.waking')));
      const net = await open();
      this.status = '';
      this.attach(net);
      this.show('lobby');
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      this.setStatus(/voll|full/i.test(msg) ? t('mp.err.full') : /läuft|running/i.test(msg) ? t('mp.err.started') : /not found|nicht gefunden|invalid/i.test(msg) ? t('mp.err.notFound') : t('mp.err.connect'));
    } finally {
      this.busy = false;
    }
  }

  /** Verbindung übernehmen: Lobby-Updates anzeigen, bei Spielstart die Szene starten. */
  private attach(net: NetSession): void {
    this.net = net;
    net.onLobby = () => {
      if (this.screen === 'lobby' && this.visible) this.render();
    };
    net.onError = (key) => {
      this.status = t(key);
      if (this.screen === 'lobby') this.render();
    };
    net.onStart = (info) => {
      this.hide();
      this.onStart(configFromStart(info, net));
    };
    net.onConnection = (state) => {
      if (state === 'lost' && this.screen === 'lobby' && this.visible) {
        this.net = null;
        this.status = t('mp.err.lost');
        this.show('multiplayer');
      }
    };
    if (net.start) {
      this.hide();
      this.onStart(configFromStart(net.start, net));
    }
  }

  // ───────────── Lobby ─────────────

  private renderLobby(): void {
    const net = this.net;
    const lobby = net?.lobby;
    if (!net || !lobby) {
      this.root.innerHTML = `<div class="menu-card"><p>${t('mp.connecting')}</p></div>`;
      return;
    }
    const host = net.isHost;
    const map = mapInfo(lobby.mapId);
    const link = `${location.origin}${location.pathname}?join=${lobby.code}`;
    const taken = (i: number) => lobby.slots.filter((s, oi) => oi !== i && (s.kind === 'human' || s.kind === 'ai')).map((s) => s.color);
    const mine = lobby.slots.find((s) => s.kind === 'human' && s.sessionId === net.sessionId);
    const row = (s: LobbySlot, i: number) => {
      const own = s.kind === 'human' && s.sessionId === net.sessionId;
      const editable = own || (host && s.kind === 'ai');
      const usable = i < map.maxPlayers;
      let label: string;
      if (s.kind === 'human') {
        label = `${esc(s.name)}${s.sessionId === lobby.hostSessionId ? ' 👑' : ''}${s.connected ? '' : ` (${t('lobby.offline')})`}`;
      } else if (host && usable) {
        label = `<select data-kind="${i}">
          <option value="open" ${s.kind === 'open' ? 'selected' : ''}>${t('lobby.open')}</option>
          <option value="closed" ${s.kind === 'closed' ? 'selected' : ''}>${t('lobby.closed')}</option>
          <option value="ai" ${s.kind === 'ai' ? 'selected' : ''}>${t('skirmish.computer')}</option></select>`;
      } else {
        label = s.kind === 'ai' ? t('skirmish.computer') : t(s.kind === 'open' ? 'lobby.open' : 'lobby.closed');
      }
      const active = s.kind === 'human' || s.kind === 'ai';
      return `<div class="slot-row lobby-row ${usable ? '' : 'unusable'}" data-slot="${i}">
        <span class="slot-name" style="--c:${active ? hex(PLAYER_COLORS[s.color]) : 'transparent'}">${label}</span>
        ${active ? this.factionSelect(s.faction, !editable) : '<span></span>'}
        ${active ? this.swatches(s.color, taken(i), !editable) : '<span></span>'}
        ${active && lobby.mode === 'teams' ? this.teamSelect(s.team, !editable) : '<span></span>'}
        ${s.kind === 'ai' ? this.aiSelect(s.ai, !(host && editable)) : s.kind === 'human' ? `<span class="ready ${s.ready || s.sessionId === lobby.hostSessionId ? 'on' : ''}">${s.ready || s.sessionId === lobby.hostSessionId ? '✔' : '…'}</span>` : '<span></span>'}
      </div>`;
    };
    const hostSel = host ? '' : 'disabled';
    this.root.innerHTML = `
      <div class="menu-card wide">
        <h2 data-i18n="lobby.title"></h2>
        <div class="code-box">
          <span data-i18n="lobby.code"></span>
          <b class="room-code">${lobby.code}</b>
          <button type="button" id="copy-link" data-i18n="lobby.invite"></button>
        </div>
        <div class="form-grid">
          <label><span data-i18n="skirmish.map"></span>
            <select id="lb-map" ${hostSel}>${MAPS.map((m) => `<option value="${m.id}" ${m.id === lobby.mapId ? 'selected' : ''}>${t(m.nameKey)}</option>`).join('')}</select>
            <small>${t(`map.${map.id}.desc`)}</small>
          </label>
          <label><span data-i18n="lobby.mode"></span>
            <select id="lb-mode" ${hostSel}>${GAME_MODES.map((m) => `<option value="${m}" ${m === lobby.mode ? 'selected' : ''}>${t(`mode.${m}`)}</option>`).join('')}</select>
          </label>
          <label><span data-i18n="skirmish.startCredits"></span>
            <select id="lb-credits" ${hostSel}>${START_CREDITS.map((c) => `<option value="${c}" ${lobby.startCredits === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
          </label>
          <label><span data-i18n="lobby.speed"></span>
            <select id="lb-speed" ${hostSel}>${GAME_SPEEDS.map((v) => `<option value="${v}" ${lobby.speed === v ? 'selected' : ''}>${v}×</option>`).join('')}</select>
          </label>
          <label><span data-i18n="skirmish.bonusPoints"></span>
            <select id="lb-bonus" ${hostSel}>${this.onOffOptions(lobby.bonusPoints ?? true)}</select>
          </label>
        </div>
        <h3 data-i18n="skirmish.players"></h3>
        <div class="slots">${lobby.slots.map(row).join('')}</div>
        <h3 data-i18n="lobby.chat"></h3>
        <div class="chat-log">${lobby.chat
          .slice(-6)
          .map((c) => `<div><b>${esc(c.from)}:</b> ${t(`chat.${c.msg}`)}</div>`)
          .join('')}</div>
        <div class="chat-buttons">${CHAT_MESSAGES.map((m) => `<button type="button" data-chat="${m}">${t(`chat.${m}`)}</button>`).join('')}</div>
        <p class="status">${esc(this.status)}</p>
        <div class="menu-actions">
          <button type="button" id="lb-leave" data-i18n="lobby.leave"></button>
          ${
            host
              ? `<button type="button" class="primary big" id="lb-start" data-i18n="lobby.start"></button>`
              : `<button type="button" class="primary big ${mine?.ready ? 'on' : ''}" id="lb-ready">${t(mine?.ready ? 'lobby.notReady' : 'lobby.ready')}</button>`
          }
        </div>
      </div>`;

    const send = (type: string, msg?: unknown) => {
      this.status = '';
      net.send(type, msg);
    };
    this.root.querySelector('#copy-link')!.addEventListener('click', async () => {
      try {
        if (navigator.share) await navigator.share({ title: 'Fight for the Right', text: t('lobby.shareText', { code: lobby.code }), url: link });
        else {
          await navigator.clipboard.writeText(link);
          this.status = t('lobby.copied');
          this.render();
        }
      } catch {
        // abgebrochen
      }
    });
    const onChange = (id: string, fn: (v: string) => void) =>
      this.root.querySelector<HTMLSelectElement>(id)?.addEventListener('change', (e) => fn((e.target as HTMLSelectElement).value));
    onChange('#lb-map', (v) => send('settings', { mapId: v }));
    onChange('#lb-mode', (v) => send('settings', { mode: v }));
    onChange('#lb-credits', (v) => send('settings', { startCredits: Number(v) }));
    onChange('#lb-speed', (v) => send('settings', { speed: Number(v) }));
    onChange('#lb-bonus', (v) => send('settings', { bonusPoints: v === 'on' }));
    this.root.querySelectorAll<HTMLSelectElement>('[data-kind]').forEach((sel) =>
      sel.addEventListener('change', () => send('slot', { slot: Number(sel.dataset.kind), kind: sel.value, ai: 'easy' })),
    );
    this.root.querySelectorAll<HTMLElement>('.lobby-row').forEach((rowEl) => {
      const slot = Number(rowEl.dataset.slot);
      rowEl.querySelectorAll<HTMLSelectElement>('select[data-field]').forEach((sel) =>
        sel.addEventListener('change', () => {
          const f = sel.dataset.field!;
          send('slotSettings', { slot, [f]: f === 'team' ? Number(sel.value) : sel.value });
        }),
      );
      rowEl.querySelectorAll<HTMLButtonElement>('[data-color]').forEach((b) =>
        b.addEventListener('click', () => send('slotSettings', { slot, color: Number(b.dataset.color) })),
      );
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-chat]').forEach((b) => b.addEventListener('click', () => send('chat', { msg: b.dataset.chat })));
    this.root.querySelector('#lb-start')?.addEventListener('click', () => send('start'));
    this.root.querySelector('#lb-ready')?.addEventListener('click', () => send('ready', { ready: !mine?.ready }));
    this.root.querySelector('#lb-leave')!.addEventListener('click', () => {
      void net.leave();
      this.net = null;
      this.show('multiplayer');
    });
  }

  // ───────────── Einstellungen & Credits ─────────────

  private renderSettings(): void {
    const s = getSettings();
    this.root.innerHTML = `
      <div class="menu-card">
        <h2 data-i18n="settings.title"></h2>
        <div class="form-grid single">
          <label><span data-i18n="settings.language"></span>
            <span class="lang">
              <button type="button" data-lang="de" class="${getLang() === 'de' ? 'active' : ''}">Deutsch</button>
              <button type="button" data-lang="en" class="${getLang() === 'en' ? 'active' : ''}">English</button>
            </span>
          </label>
          <label><span data-i18n="settings.gameSpeed"></span>
            <select id="speed">${[0.5, 0.75, 1, 1.25, 1.5, 2]
              .map((v) => `<option value="${v}" ${s.gameSpeed === v ? 'selected' : ''}>${v}×</option>`)
              .join('')}</select>
          </label>
          <label><span data-i18n="settings.music"></span><input id="vol-music" type="range" min="0" max="1" step="0.1" value="${s.musicVolume}" /></label>
          <label><span data-i18n="settings.sfx"></span><input id="vol-sfx" type="range" min="0" max="1" step="0.1" value="${s.sfxVolume}" /></label>
          <label class="check"><input id="low-fx" type="checkbox" ${s.lowFx ? 'checked' : ''} /><span data-i18n="settings.lowFx"></span></label>
          <small data-i18n="settings.lowFxHint"></small>
        </div>
        <div class="menu-actions"><button type="button" data-go="main" data-i18n="menu.back"></button></div>
      </div>`;
    this.root.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) =>
      b.addEventListener('click', () => setLang(b.dataset.lang as Lang)),
    );
    this.root.querySelector<HTMLSelectElement>('#speed')!.addEventListener('change', (e) => {
      void saveSettings({ gameSpeed: Number((e.target as HTMLSelectElement).value) });
    });
    const music = this.root.querySelector<HTMLInputElement>('#vol-music')!;
    const sfx = this.root.querySelector<HTMLInputElement>('#vol-sfx')!;
    const applyVol = () => {
      setVolumes(Number(music.value), Number(sfx.value));
      void saveSettings({ musicVolume: Number(music.value), sfxVolume: Number(sfx.value) });
    };
    music.addEventListener('input', applyVol);
    sfx.addEventListener('input', applyVol);
    // Hörprobe beim Loslassen
    sfx.addEventListener('change', () => play('build'));
    this.root.querySelector<HTMLInputElement>('#low-fx')!.addEventListener('change', (e) => {
      void saveSettings({ lowFx: (e.target as HTMLInputElement).checked });
    });
    this.bindGo();
  }

  /** Spielanleitung: aufklappbare Abschnitte, kurz und kindgerecht. */
  private renderGuide(): void {
    const rules = getRules();
    const icon = (id: string) => {
      const d = rules.unit('aero', id);
      return d ? `<img src="${iconFor(d, PLAYER_COLORS[0])}" alt="" />` : '';
    };
    const section = (id: string, body: string, open = false) =>
      `<details class="guide-part" ${open ? 'open' : ''}><summary>${t(`guide.${id}.title`)}</summary>${body}</details>`;
    const para = (key: string) => `<p>${esc(t(key))}</p>`;
    const list = (prefix: string, n: number) => `<ul>${Array.from({ length: n }, (_, i) => `<li>${esc(t(`${prefix}.${i + 1}`))}</li>`).join('')}</ul>`;
    const matchups = ['rifleman', 'rocketeer', 'lightTank', 'artillery', 'flakWagon', 'gunship', 'engineer']
      .map((id) => {
        const d = rules.unit('aero', id);
        const table = d?.weapon ? ratingTable(effectiveness(d)) : '';
        return `<div class="matchup">${icon(id)}<div><b>${t(`unit.${id}`)}</b><small>${esc(t(`guide.units.${id}`))}</small>${table}</div></div>`;
      })
      .join('');
    this.root.innerHTML = `
      <div class="menu-card wide guide">
        <h2 data-i18n="guide.title"></h2>
        ${section('goal', para('guide.goal.text'), true)}
        ${section('start', list('guide.start', 5))}
        ${section('mouse', `<ul>${[1, 2, 3, 4, 5, 6, 'transport'].map((i) => `<li>${esc(t(`help.mouse.${i}`))}</li>`).join('')}</ul>`)}
        ${section('touch', `<ul>${[1, 2, 3, 4, 5, 6, 'transport'].map((i) => `<li>${esc(t(`help.touch.${i}`))}</li>`).join('')}</ul>`)}
        ${section('economy', list('guide.economy', 4))}
        ${section('power', para('guide.power.text'))}
        ${section('units', `${para('guide.units.text')}${para('guide.units.legend')}<p class="armor-legend">${ARMOR_CLASSES.map((c) => `<span>${armorIcon(c, 20)} ${t(`armor.${c}`)}</span>`).join('')}</p><div class="matchups">${matchups}</div>`)}
        ${section('tips', list('guide.tips', 5))}
        <div class="menu-actions"><button type="button" data-go="main" data-i18n="menu.back"></button></div>
      </div>`;
    this.bindGo();
  }

  private renderCredits(): void {
    this.root.innerHTML = `
      <div class="menu-card">
        <h2 data-i18n="credits.title"></h2>
        <p class="credits" data-i18n="credits.text"></p>
        <div class="menu-actions"><button type="button" data-go="main" data-i18n="menu.back"></button></div>
      </div>`;
    this.bindGo();
  }
}
