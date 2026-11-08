import type { PlayerStats, Stance } from '@fftr/shared';
import { applyI18n, getLang, onLangChange, setLang, t, type Lang } from '../i18n';

/**
 * Benutzeroberfläche im Spiel (HTML über der Spielfläche):
 * Seitenleiste mit Glimmerit, Strom, Minikarte und Bauleiste;
 * Befehlsleiste mit grossen Touch-Knöpfen; Meldungen; Pause- und Endbildschirm.
 */

export type BuildTab = 'building' | 'defense' | 'infantry' | 'vehicle' | 'air' | 'naval';
export const BUILD_TABS: BuildTab[] = ['building', 'defense', 'infantry', 'vehicle', 'air', 'naval'];

export interface BuildItemState {
  id: string;
  category: BuildTab;
  nameKey: string;
  cost: number;
  icon: string;
  available: boolean;
  /** Fehlende Voraussetzungen als Namen. */
  missing: string[];
  /** 0…1 während des Baus, sonst null. */
  progress: number | null;
  queued: number;
  paused: boolean;
  ready: boolean;
}

export interface CommandState {
  hasUnits: boolean;
  armed: boolean;
  stance: Stance | null;
  canDeploy: boolean;
  /** Ausgewählter Transporter hat Passagiere. */
  canUnload: boolean;
  /** Ausgewähltes eigenes Gebäude. */
  building: { repairing: boolean; damaged: boolean; passengers: number } | null;
  placing: boolean;
}

export interface HudActions {
  stop(): void;
  clearSelection(): void;
  saveGroup(n: number): void;
  recallGroup(n: number): void;
  centerOnSelection(): void;
  armAttack(): void;
  cycleStance(): void;
  deploy(): void;
  /** Transporter entladen bzw. Bunker räumen. */
  unload(): void;
  sellSelected(): void;
  repairSelected(): void;
  confirmPlacement(): void;
  cancelPlacement(): void;
  buildItem(category: BuildTab, id: string, action: 'click' | 'alt'): void;
  minimapJump(fx: number, fy: number): void;
  pause(): void;
  resume(): void;
  surrender(): void;
  toMenu(): void;
  playAgain(): void;
  sendPing(kind: 'help' | 'attack'): void;
  /** Kampagne: zum Briefing der nächsten Mission. */
  nextMission(): void;
}

/** Ein Missionsziel für die Anzeige. */
export interface ObjectiveView {
  key: string;
  status: 'open' | 'done' | 'failed';
}

const ICONS = {
  stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  attack:
    '<svg viewBox="0 0 24 24" class="line"><circle cx="12" cy="12" r="7"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/></svg>',
  aggressive: '<svg viewBox="0 0 24 24" class="line"><path d="M5 19L19 5M13 5h6v6M5 13l6 6"/></svg>',
  hold: '<svg viewBox="0 0 24 24" class="line"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg>',
  passive: '<svg viewBox="0 0 24 24" class="line"><circle cx="12" cy="12" r="8"/><path d="M8 12h8"/></svg>',
  deploy: '<svg viewBox="0 0 24 24" class="line"><path d="M4 20h16M6 20V10l6-5 6 5v10M10 20v-6h4v6"/></svg>',
  unload: '<svg viewBox="0 0 24 24" class="line"><path d="M4 8h12v8H4zM16 11h3l2 3v2h-5M12 20l3 3M12 20h7M8 4v4"/><circle cx="8" cy="18" r="1.5"/></svg>',
  sell: '<svg viewBox="0 0 24 24" class="line"><circle cx="12" cy="12" r="8"/><path d="M14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.6 2.5 2 2.5.9 2.5 2-1 2-2.5 2c-1 0-2-.5-2.5-1.5M12 6.5v11"/></svg>',
  repair: '<svg viewBox="0 0 24 24" class="line"><path d="M14 6a4 4 0 0 0 5 5l-8 8a2.1 2.1 0 0 1-3-3l8-8a4 4 0 0 0-2-2z"/></svg>',
  ok: '<svg viewBox="0 0 24 24" class="line"><path d="M5 12l5 5 9-10"/></svg>',
  cancel: '<svg viewBox="0 0 24 24" class="line"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" class="line"><path d="M6 15l6-6 6 6"/></svg>',
};

const HOLD_MS = 500;

/** Langes Drücken (Touch) bzw. Rechtsklick als Zweitaktion. */
function onPress(el: HTMLElement, click: () => void, alt: () => void): void {
  let timer: number | undefined;
  let fired = false;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    fired = false;
    timer = window.setTimeout(() => {
      fired = true;
      navigator.vibrate?.(20);
      alt();
    }, HOLD_MS);
  });
  const cancel = () => clearTimeout(timer);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerup', (e) => {
    clearTimeout(timer);
    if (e.button === 0 && !fired) click();
  });
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    clearTimeout(timer);
    // Nach langem Drücken (Touch) schickt der Browser oft noch ein contextmenu – nicht doppelt auslösen.
    if (fired) {
      fired = false;
      return;
    }
    alt();
  });
}

export class Hud {
  readonly minimap: HTMLCanvasElement;
  private els: Record<string, HTMLElement> = {};
  private tab: BuildTab = 'building';
  private items: BuildItemState[] = [];
  private renderedTabKey = '';
  private feed: HTMLElement;
  private bubble: HTMLElement;
  private overlay: HTMLElement;
  private sellArmed = 0;
  private lastCmdKey = '';
  private cleanup: (() => void)[] = [];

  private connection: HTMLElement;

  constructor(
    private readonly sidebar: HTMLElement,
    private readonly commandBar: HTMLElement,
    private readonly stage: HTMLElement,
    private readonly actions: HudActions,
    private readonly multiplayer = false,
  ) {
    this.buildSidebar();
    this.minimap = sidebar.querySelector('#minimap')!;
    this.feed = this.addToStage('div', 'msg-feed');
    this.bubble = this.addToStage('div', 'bubble');
    this.bubble.hidden = true;
    this.overlay = this.addToStage('div', 'game-overlay');
    this.overlay.hidden = true;
    this.connection = this.addToStage('div', 'connection-banner');
    this.connection.hidden = true;
    applyI18n(document);
    onLangChange(() => {
      this.renderedTabKey = '';
      this.lastCmdKey = '';
      this.renderBuildBar();
    });
  }

  private addToStage(tag: string, cls: string): HTMLElement {
    const el = document.createElement(tag);
    el.className = cls;
    this.stage.appendChild(el);
    this.cleanup.push(() => el.remove());
    return el;
  }

  destroy(): void {
    for (const fn of this.cleanup) fn();
    this.sidebar.innerHTML = '';
    this.commandBar.innerHTML = '';
  }

  // ───────────── Seitenleiste ─────────────

  private buildSidebar() {
    const sb = this.sidebar;
    const smallQuery = window.matchMedia('(max-width: 900px), (max-height: 520px)');
    sb.classList.toggle('collapsed', smallQuery.matches);
    const onSmall = (e: MediaQueryListEvent) => sb.classList.toggle('collapsed', e.matches);
    smallQuery.addEventListener('change', onSmall);
    this.cleanup.push(() => smallQuery.removeEventListener('change', onSmall));

    sb.innerHTML = `
      <header class="sb-header">
        <div class="res">
          <span class="credits" title="${t('hud.credits')}"><i class="crystal-icon"></i><b id="credits">0</b></span>
          <span class="power" id="power-wrap" title="${t('hud.power')}"><i class="bolt">⚡</i><span class="power-bar"><span id="power-fill"></span></span></span>
        </div>
        <button class="icon-btn" id="pause-btn" type="button" data-i18n-title="cmd.pause">${ICONS.pause}</button>
        <button class="icon-btn sb-toggle" type="button" data-i18n-title="ui.menu">${ICONS.chevron}</button>
      </header>
      <div class="sb-body">
        <div class="minimap-wrap">
          <canvas id="minimap" width="200" height="200"></canvas>
          <div class="radar-off" id="radar-off" data-i18n="hud.radarOffline"></div>
        </div>
        <nav class="tabs">${BUILD_TABS.map((tb) => `<button type="button" data-tab="${tb}" data-i18n="tab.${tb}"></button>`).join('')}</nav>
        <div class="build-grid" id="build-grid"></div>
        <p class="place-hint" id="place-hint" hidden data-i18n="hud.placeHint"></p>
        ${
          this.multiplayer
            ? `<section class="panel row pings">
          <button type="button" data-ping="help" data-i18n="ping.help"></button>
          <button type="button" data-ping="attack" data-i18n="ping.attack"></button>
        </section>`
            : ''
        }
        <section class="panel">
          <h2 id="selection-title"></h2>
          <ul id="selection-list"></ul>
        </section>
        <details class="panel help">
          <summary data-i18n="help.title"></summary>
          <h3 data-i18n="help.mouse"></h3>
          <ul>${[1, 2, 3, 4, 5, 6, 'transport'].map((i) => `<li data-i18n="help.mouse.${i}"></li>`).join('')}</ul>
          <h3 data-i18n="help.touch"></h3>
          <ul>${[1, 2, 3, 4, 5, 6, 'transport'].map((i) => `<li data-i18n="help.touch.${i}"></li>`).join('')}</ul>
        </details>
        <section class="panel row">
          <span data-i18n="ui.language"></span>
          <span class="lang">
            <button type="button" data-lang="de">DE</button>
            <button type="button" data-lang="en">EN</button>
          </span>
          <button type="button" class="fullscreen" data-i18n="ui.fullscreen"></button>
        </section>
        <footer id="stats"></footer>
      </div>`;
    for (const id of ['credits', 'power-fill', 'power-wrap', 'radar-off', 'build-grid', 'place-hint', 'selection-title', 'selection-list', 'stats']) {
      this.els[id] = sb.querySelector(`#${id}`)!;
    }

    sb.querySelector('.sb-toggle')!.addEventListener('click', () => sb.classList.toggle('collapsed'));
    sb.querySelectorAll<HTMLButtonElement>('[data-ping]').forEach((b) =>
      b.addEventListener('click', () => {
        this.actions.sendPing(b.dataset.ping as 'help' | 'attack');
        // Auf dem Handy die Leiste schliessen, damit man auf die Karte tippen kann
        if (b.dataset.ping === 'attack') sb.classList.add('collapsed');
      }),
    );
    sb.querySelector('#pause-btn')!.addEventListener('click', () => this.actions.pause());
    sb.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab as BuildTab;
        this.renderedTabKey = '';
        this.renderBuildBar();
      }),
    );
    const langButtons = sb.querySelectorAll<HTMLButtonElement>('[data-lang]');
    const markLang = () => langButtons.forEach((b) => b.classList.toggle('active', b.dataset.lang === getLang()));
    langButtons.forEach((b) =>
      b.addEventListener('click', () => {
        setLang(b.dataset.lang as Lang);
        markLang();
      }),
    );
    markLang();
    const fs = sb.querySelector<HTMLButtonElement>('.fullscreen')!;
    if (!document.fullscreenEnabled) fs.hidden = true;
    fs.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else {
          await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
          await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape').catch(() => undefined);
        }
      } catch {
        // abgelehnt
      }
    });

    // Minikarte: tippen/ziehen bewegt die Kamera
    const mm = sb.querySelector<HTMLCanvasElement>('#minimap')!;
    let dragging = false;
    const jump = (e: PointerEvent) => {
      const r = mm.getBoundingClientRect();
      this.actions.minimapJump((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    };
    mm.addEventListener('pointerdown', (e) => {
      dragging = true;
      mm.setPointerCapture(e.pointerId);
      jump(e);
    });
    mm.addEventListener('pointermove', (e) => dragging && jump(e));
    mm.addEventListener('pointerup', () => (dragging = false));
    mm.addEventListener('pointercancel', () => (dragging = false));
  }

  setResources(credits: number, storage: number, produced: number, used: number): void {
    this.els.credits.textContent = String(credits);
    this.els.credits.parentElement!.title = `${t('hud.credits')}: ${credits} / ${storage}`;
    const fill = this.els['power-fill'];
    const max = Math.max(produced, used, 1);
    fill.style.width = `${Math.min(100, (used / max) * 100)}%`;
    this.els['power-wrap'].classList.toggle('low', used > produced);
    this.els['power-wrap'].title = `${t('hud.power')}: ${used} / ${produced}`;
  }

  setRadar(online: boolean): void {
    this.els['radar-off'].hidden = online;
  }

  // ───────────── Bauleiste ─────────────

  setBuildItems(items: BuildItemState[]): void {
    this.items = items;
    this.renderBuildBar();
  }

  private renderBuildBar(): void {
    const grid = this.els['build-grid'];
    if (!grid) return;
    this.sidebar.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === this.tab);
      const busy = this.items.some((i) => i.category === b.dataset.tab && (i.ready || i.progress !== null));
      b.classList.toggle('busy', busy);
      b.classList.toggle('has-ready', this.items.some((i) => i.category === b.dataset.tab && i.ready));
    });
    const list = this.items.filter((i) => i.category === this.tab);
    const key = `${this.tab}|${list.map((i) => i.id + i.icon.length).join(',')}`;
    if (key !== this.renderedTabKey) {
      this.renderedTabKey = key;
      grid.innerHTML = list
        .map(
          (i) => `<button type="button" class="build-item" data-id="${i.id}">
            <img src="${i.icon}" alt="" draggable="false" />
            <span class="bi-progress"></span>
            <span class="bi-name">${t(i.nameKey)}</span>
            <span class="bi-cost"><i class="crystal-icon"></i>${i.cost}</span>
            <span class="bi-badge" hidden></span>
            <span class="bi-state" hidden></span>
          </button>`,
        )
        .join('');
      grid.querySelectorAll<HTMLButtonElement>('.build-item').forEach((el) => {
        const id = el.dataset.id!;
        onPress(
          el,
          () => this.actions.buildItem(this.tab, id, 'click'),
          () => this.actions.buildItem(this.tab, id, 'alt'),
        );
      });
    }
    // Dynamische Teile aktualisieren
    for (const i of list) {
      const el = grid.querySelector<HTMLElement>(`[data-id="${i.id}"]`);
      if (!el) continue;
      el.classList.toggle('locked', !i.available && !i.ready && i.progress === null);
      el.classList.toggle('ready', i.ready);
      el.classList.toggle('paused', i.paused);
      el.title = i.available || i.ready ? `${t(i.nameKey)} – ${i.cost}` : t('hud.requires', { list: i.missing.join(', ') });
      el.querySelector<HTMLElement>('.bi-progress')!.style.height = i.progress !== null ? `${Math.round((1 - i.progress) * 100)}%` : '0%';
      el.querySelector<HTMLElement>('.bi-progress')!.classList.toggle('active', i.progress !== null);
      const badge = el.querySelector<HTMLElement>('.bi-badge')!;
      badge.hidden = i.queued < 2;
      badge.textContent = String(i.queued);
      const state = el.querySelector<HTMLElement>('.bi-state')!;
      const text = i.ready
        ? t('hud.ready')
        : i.paused
          ? t('hud.paused')
          : !i.available && i.progress === null
            ? t('hud.requires', { list: i.missing.join(', ') })
            : '';
      state.hidden = !text;
      state.textContent = text;
    }
    if (this.highlight) this.applyHighlight();
  }

  // ───────────── Tutorial-Hinweis: pulsierender Knopf ─────────────

  private highlight: string | null = null;

  /** Ziel: «cmd:deploy», «tab:infantry», «build:powerPlant» oder null. */
  setHighlight(target: string | null): void {
    this.highlight = target;
    this.applyHighlight();
  }

  private applyHighlight(): void {
    document.querySelectorAll('.hint').forEach((e) => e.classList.remove('hint'));
    if (!this.highlight) return;
    const [kind, id] = this.highlight.split(':');
    let el: Element | null = null;
    let inSidebar = true;
    if (kind === 'cmd') {
      el = this.commandBar.querySelector(`[data-cmd="${id}"]`);
      inSidebar = false;
    } else if (kind === 'tab') el = this.sidebar.querySelector(`[data-tab="${id}"]`);
    else if (kind === 'build') {
      const item = this.items.find((i) => i.id === id);
      // Liegt das Ziel in einem anderen Reiter, zuerst den Reiter zeigen
      el =
        item && item.category !== this.tab
          ? this.sidebar.querySelector(`[data-tab="${item.category}"]`)
          : this.els['build-grid']?.querySelector(`[data-id="${id}"]`) ?? null;
    }
    // Auf dem Handy ist die Seitenleiste vielleicht zugeklappt → den Aufklapp-Knopf zeigen
    if (inSidebar && this.sidebar.classList.contains('collapsed')) el = this.sidebar.querySelector('.sb-toggle');
    el?.classList.add('hint');
  }

  setPlacing(placing: boolean, touch: boolean): void {
    this.els['place-hint'].hidden = !(placing && touch);
  }

  // ───────────── Befehlsleiste ─────────────

  setCommands(s: CommandState): void {
    const key = JSON.stringify(s) + getLang();
    if (key === this.lastCmdKey) return;
    this.lastCmdKey = key;
    const bar = this.commandBar;
    const btn = (cmd: string, icon: string, title: string, extra = '') =>
      `<button type="button" data-cmd="${cmd}" title="${title}" aria-label="${title}" ${extra}>${icon}</button>`;
    let html = '';
    if (s.placing) {
      html = btn('placeOk', ICONS.ok, t('cmd.confirmPlace'), 'class="ok"') + btn('placeCancel', ICONS.cancel, t('cmd.cancel'));
    } else if (s.building) {
      html =
        btn('sell', ICONS.sell, this.sellArmed ? t('cmd.sellConfirm') : t('cmd.sell'), this.sellArmed ? 'class="warn"' : '') +
        btn('repair', ICONS.repair, t('cmd.repair'), `${s.building.damaged ? '' : 'disabled'} ${s.building.repairing ? 'class="on"' : ''}`) +
        (s.building.passengers > 0 ? btn('unload', ICONS.unload, t('cmd.evacuate'), 'class="ok"') : '') +
        btn('deselect', ICONS.cancel, t('cmd.deselect'));
    } else {
      const stanceIcon = s.stance ? ICONS[s.stance] : ICONS.aggressive;
      html =
        btn('stop', ICONS.stop, t('cmd.stop'), s.hasUnits ? '' : 'disabled') +
        btn('attack', ICONS.attack, t('cmd.attackMove'), `${s.hasUnits ? '' : 'disabled'} ${s.armed ? 'class="on"' : ''}`) +
        btn('stance', stanceIcon, s.stance ? t(`stance.${s.stance}`) : t('cmd.stance'), s.stance ? '' : 'disabled') +
        (s.canDeploy ? btn('deploy', ICONS.deploy, t('cmd.deploy'), 'class="ok"') : '') +
        (s.canUnload ? btn('unload', ICONS.unload, t('cmd.unload'), 'class="ok"') : '') +
        [1, 2, 3, 4]
          .map((n) => `<button type="button" class="group" data-group="${n}" title="${t('cmd.group', { n })}">${n}<span class="badge" hidden></span></button>`)
          .join('') +
        btn('deselect', ICONS.cancel, t('cmd.deselect'), s.hasUnits ? '' : 'disabled');
    }
    bar.innerHTML = html;
    bar.classList.toggle('has-selection', s.hasUnits || !!s.building || s.placing);
    if (this.highlight) this.applyHighlight();
    const on = (cmd: string, fn: () => void) => bar.querySelector(`[data-cmd="${cmd}"]`)?.addEventListener('click', fn);
    on('stop', () => this.actions.stop());
    on('attack', () => this.actions.armAttack());
    on('stance', () => this.actions.cycleStance());
    on('deploy', () => this.actions.deploy());
    on('unload', () => this.actions.unload());
    on('deselect', () => this.actions.clearSelection());
    on('placeOk', () => this.actions.confirmPlacement());
    on('placeCancel', () => this.actions.cancelPlacement());
    on('repair', () => this.actions.repairSelected());
    on('sell', () => {
      // Zweimal tippen, damit Kinder nicht aus Versehen verkaufen
      if (this.sellArmed && performance.now() - this.sellArmed < 3000) {
        this.sellArmed = 0;
        this.actions.sellSelected();
      } else {
        this.sellArmed = performance.now();
        this.lastCmdKey = '';
        this.setCommands(s);
        window.setTimeout(() => {
          this.sellArmed = 0;
          this.lastCmdKey = '';
          this.setCommands(s);
        }, 3000);
      }
    });
    bar.querySelectorAll<HTMLButtonElement>('[data-group]').forEach((b) => {
      const n = Number(b.dataset.group);
      let lastTap = 0;
      onPress(
        b,
        () => {
          const now = performance.now();
          this.actions.recallGroup(n);
          if (now - lastTap < 350) this.actions.centerOnSelection();
          lastTap = now;
        },
        () => {
          this.actions.saveGroup(n);
          this.message(t('msg.groupSaved', { n }), 'info');
        },
      );
    });
    this.refreshGroupBadges();
  }

  private groupSizes = new Map<number, number>();

  setGroupSize(n: number, size: number): void {
    this.groupSizes.set(n, size);
    this.refreshGroupBadges();
  }

  private refreshGroupBadges(): void {
    this.commandBar.querySelectorAll<HTMLElement>('[data-group]').forEach((b) => {
      const size = this.groupSizes.get(Number(b.dataset.group)) ?? 0;
      const badge = b.querySelector<HTMLElement>('.badge')!;
      badge.hidden = size === 0;
      badge.textContent = String(size);
    });
  }

  // ───────────── Auswahl & Statistik ─────────────

  setSelection(entries: { name: string; count: number }[]): void {
    const total = entries.reduce((s, e) => s + e.count, 0);
    this.els['selection-title'].textContent =
      total === 0 ? t('hud.selectionNone') : `${t('hud.selection')}: ${t('hud.selectionCount', { count: total })}`;
    this.els['selection-list'].innerHTML = entries.map((e) => `<li><span>${e.name}</span><b>×${e.count}</b></li>`).join('');
  }

  setStats(fps: number, units: number): void {
    this.els.stats.textContent = t('hud.stats', { fps: Math.round(fps), units });
  }

  // ───────────── Meldungen ─────────────

  /** Kurze Meldung oben links; wichtige zusätzlich als Sprechblase der Kommandantin. */
  message(text: string, kind: 'info' | 'warn' | 'good' = 'info', bubble = false): void {
    const line = document.createElement('div');
    line.className = `msg ${kind}`;
    line.textContent = text;
    this.feed.prepend(line);
    while (this.feed.children.length > 4) this.feed.lastElementChild?.remove();
    window.setTimeout(() => line.classList.add('fade'), 4000);
    window.setTimeout(() => line.remove(), 5000);
    // Während eines Funkspruchs keine zweite Sprechblase (die Meldung steht ja oben links)
    if (bubble && !this.radioBusy) {
      this.bubble.onclick = null;
      this.bubble.innerHTML = `<div class="commander ${kind}"></div><p></p>`;
      this.bubble.querySelector('p')!.textContent = text;
      this.bubble.hidden = false;
      window.clearTimeout(Number(this.bubble.dataset.timer));
      this.bubble.dataset.timer = String(window.setTimeout(() => (this.bubble.hidden = true), 4500));
    }
  }

  // ───────────── Kampagne: Funksprüche, Ziele, Countdown ─────────────

  private radioQueue: { text: string; img: string; name: string }[] = [];
  private radioBusy = false;
  private objectivesEl: HTMLElement | null = null;
  private objectivesOpen = true;
  private countdownText: string | null = null;
  private objectives: ObjectiveView[] = [];

  /** Funkspruch mit Porträt; mehrere hintereinander werden nacheinander gezeigt. */
  radio(text: string, img: string, name: string): void {
    const line = document.createElement('div');
    line.className = 'msg radio';
    line.textContent = `${name}: ${text}`;
    this.feed.prepend(line);
    while (this.feed.children.length > 4) this.feed.lastElementChild?.remove();
    window.setTimeout(() => line.classList.add('fade'), 6000);
    window.setTimeout(() => line.remove(), 7000);
    this.radioQueue.push({ text, img, name });
    if (!this.radioBusy) this.nextRadio();
  }

  private nextRadio(): void {
    const r = this.radioQueue.shift();
    if (!r) {
      this.radioBusy = false;
      this.bubble.hidden = true;
      return;
    }
    this.radioBusy = true;
    this.bubble.innerHTML = `<img class="portrait" src="${r.img}" alt="" /><div><b></b><p></p></div>`;
    this.bubble.querySelector('b')!.textContent = r.name;
    this.bubble.querySelector('p')!.textContent = r.text;
    this.bubble.hidden = false;
    // Lesezeit je nach Länge, Tippen schliesst früher
    const ms = Math.min(11000, 3500 + r.text.length * 45);
    window.clearTimeout(Number(this.bubble.dataset.timer));
    this.bubble.dataset.timer = String(window.setTimeout(() => this.nextRadio(), ms));
    this.bubble.onclick = () => {
      window.clearTimeout(Number(this.bubble.dataset.timer));
      this.nextRadio();
    };
  }

  setObjectives(list: ObjectiveView[]): void {
    this.objectives = list.map((o) => ({ ...o }));
    if (!this.objectivesEl) {
      this.objectivesEl = this.addToStage('div', 'objectives');
      this.stage.classList.add('has-objectives');
      this.cleanup.push(() => this.stage.classList.remove('has-objectives'));
      // Auf kleinen Bildschirmen anfangs zugeklappt
      this.objectivesOpen = !window.matchMedia('(max-width: 900px), (max-height: 520px)').matches;
    }
    this.renderObjectives();
  }

  toggleObjectives(): void {
    this.objectivesOpen = !this.objectivesOpen;
    this.renderObjectives();
  }

  setCountdown(text: string | null): void {
    this.countdownText = text;
    this.renderObjectives();
  }

  private renderObjectives(): void {
    const el = this.objectivesEl;
    if (!el) return;
    const icon = { open: '☐', done: '✔', failed: '✖' };
    el.classList.toggle('open', this.objectivesOpen);
    el.innerHTML = `
      <button type="button" class="obj-toggle" aria-expanded="${this.objectivesOpen}">📋 ${t('mission.objectives')} <small>(O)</small></button>
      ${this.countdownText ? `<div class="countdown">⏱ ${this.countdownText}</div>` : ''}
      ${
        this.objectivesOpen
          ? `<ul>${this.objectives.map((o) => `<li class="${o.status}"><i>${icon[o.status]}</i><span></span></li>`).join('')}</ul>`
          : ''
      }`;
    el.querySelectorAll('li span').forEach((s, i) => (s.textContent = t(this.objectives[i].key)));
    el.querySelector('.obj-toggle')!.addEventListener('click', () => this.toggleObjectives());
  }

  // ───────────── Pause & Ende ─────────────

  showPause(): void {
    this.overlay.hidden = false;
    // Im Mehrspieler läuft das Spiel weiter – nur Aufgeben oder Verlassen
    this.overlay.innerHTML = `
      <div class="menu-card">
        <h2 data-i18n="${this.multiplayer ? 'pause.mpTitle' : 'pause.title'}"></h2>
        ${this.multiplayer ? '<p class="muted" data-i18n="pause.mpHint"></p>' : ''}
        <div class="menu-buttons">
          <button type="button" class="primary" data-act="resume" data-i18n="${this.multiplayer ? 'pause.back' : 'pause.resume'}"></button>
          <button type="button" data-act="surrender" data-i18n="pause.surrender"></button>
          <button type="button" data-act="menu" data-i18n="${this.multiplayer ? 'pause.leave' : 'pause.mainMenu'}"></button>
        </div>
      </div>`;
    applyI18n(this.overlay);
    this.overlay.querySelector('[data-act="resume"]')!.addEventListener('click', () => this.actions.resume());
    this.overlay.querySelector('[data-act="menu"]')!.addEventListener('click', () => this.actions.toMenu());
    const sur = this.overlay.querySelector<HTMLButtonElement>('[data-act="surrender"]')!;
    let armed = false;
    sur.addEventListener('click', () => {
      if (armed) this.actions.surrender();
      else {
        armed = true;
        sur.textContent = t('pause.confirmSurrender');
        sur.classList.add('warn');
      }
    });
  }

  hideOverlay(): void {
    this.overlay.hidden = true;
    this.overlay.innerHTML = '';
  }

  showEnd(
    victory: boolean,
    rows: { name: string; color: string; stats: PlayerStats }[],
    seconds: number,
    campaign?: { reason?: string; hasNext: boolean },
  ): void {
    const keys: (keyof PlayerStats)[] = ['unitsBuilt', 'unitsLost', 'buildingsBuilt', 'buildingsLost', 'kills', 'harvested'];
    const mm = Math.floor(seconds / 60);
    const ss = String(Math.floor(seconds % 60)).padStart(2, '0');
    this.overlay.hidden = false;
    this.overlay.innerHTML = `
      <div class="menu-card wide end ${victory ? 'victory' : 'defeat'}">
        <h2>${t(victory ? 'end.victory' : 'end.defeat')}</h2>
        <p>${campaign ? t(victory ? 'mission.victoryText' : 'mission.defeatText') : t(victory ? 'end.victoryText' : 'end.defeatText')}</p>
        ${campaign?.reason ? `<p class="reason"></p>` : ''}
        <p class="muted">${t('end.time', { time: `${mm}:${ss}` })}</p>
        <div class="table-wrap"><table>
          <thead><tr><th>${t('end.player')}</th>${keys.map((k) => `<th>${t(`end.${k}`)}</th>`).join('')}</tr></thead>
          <tbody>${rows
            .map(
              (r) =>
                `<tr><td><i class="dot" style="background:${r.color}"></i>${r.name}</td>${keys.map((k) => `<td>${r.stats[k]}</td>`).join('')}</tr>`,
            )
            .join('')}</tbody>
        </table></div>
        <div class="menu-actions">
          ${
            campaign
              ? `<button type="button" data-act="menu">${t('mission.toCampaign')}</button>
                 <button type="button" ${campaign.hasNext ? '' : 'class="primary big"'} data-act="again">${t(victory ? 'mission.replay' : 'mission.retry')}</button>
                 ${campaign.hasNext ? `<button type="button" class="primary big" data-act="next">${t('mission.next')}</button>` : ''}`
              : `<button type="button" ${this.multiplayer ? 'class="primary big"' : ''} data-act="menu">${t('end.menu')}</button>
                 ${this.multiplayer ? '' : `<button type="button" class="primary big" data-act="again">${t('end.again')}</button>`}`
          }
        </div>
      </div>`;
    const reason = this.overlay.querySelector('.reason');
    if (reason && campaign?.reason) reason.textContent = campaign.reason;
    this.overlay.querySelector('[data-act="menu"]')!.addEventListener('click', () => this.actions.toMenu());
    this.overlay.querySelector('[data-act="again"]')?.addEventListener('click', () => this.actions.playAgain());
    this.overlay.querySelector('[data-act="next"]')?.addEventListener('click', () => this.actions.nextMission());
  }

  /** Hinweis bei Verbindungsproblemen (Mehrspieler). */
  setConnection(state: 'ok' | 'dropped' | 'lost'): void {
    this.connection.hidden = state === 'ok';
    this.connection.textContent = state === 'dropped' ? t('mp.reconnecting') : state === 'lost' ? t('mp.err.lost') : '';
    this.connection.classList.toggle('lost', state === 'lost');
  }
}
