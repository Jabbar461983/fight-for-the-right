import { applyI18n, getLang, onLangChange, setLang, t, type Lang } from '../i18n';

/**
 * Benutzeroberfläche als HTML über dem Spiel: Seitenleiste (Desktop rechts,
 * Smartphone einklappbar unten) und Befehlsleiste mit grossen Touch-Knöpfen.
 * HTML statt Phaser, weil Layout, Schrift und Barrierefreiheit so viel einfacher sind.
 */

export interface HudActions {
  stop(): void;
  clearSelection(): void;
  saveGroup(n: number): void;
  recallGroup(n: number): void;
  centerOnSelection(): void;
}

export interface SelectionEntry {
  nameKey: string;
  count: number;
}

const ICONS = {
  stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  attack:
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="none" stroke-width="2.5"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6" stroke-width="2.5"/></svg>',
  stance:
    '<svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" fill="none" stroke-width="2.5"/></svg>',
  deselect: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke-width="3"/></svg>',
};

/** Ab dieser Dauer gilt ein Druck auf einen Gruppenknopf als «speichern». */
const GROUP_HOLD_MS = 500;

export class Hud {
  private selectionList: HTMLElement;
  private selectionTitle: HTMLElement;
  private stats: HTMLElement;
  private toast: HTMLElement;
  private groupBadges: HTMLElement[] = [];
  private toastTimer: number | undefined;
  private lastSelection: SelectionEntry[] = [];

  constructor(
    private readonly sidebar: HTMLElement,
    private readonly commandBar: HTMLElement,
    private readonly actions: HudActions,
  ) {
    this.buildSidebar();
    this.buildCommandBar();
    this.selectionList = sidebar.querySelector('#selection-list')!;
    this.selectionTitle = sidebar.querySelector('#selection-title')!;
    this.stats = sidebar.querySelector('#stats')!;
    this.toast = document.createElement('div');
    this.toast.className = 'toast';
    this.toast.hidden = true;
    commandBar.parentElement!.appendChild(this.toast);
    applyI18n(document);
    this.setSelection([], true);
    onLangChange(() => this.setSelection(this.lastSelection, true));
  }

  private buildSidebar() {
    const sb = this.sidebar;
    // Auf kleinen Bildschirmen startet die Leiste eingeklappt (auch nach Drehen/Grössenänderung).
    const smallQuery = window.matchMedia('(max-width: 900px), (max-height: 520px)');
    if (smallQuery.matches) sb.classList.add('collapsed');
    smallQuery.addEventListener('change', (e) => sb.classList.toggle('collapsed', e.matches));
    sb.innerHTML = `
      <header class="sb-header">
        <h1 data-i18n="game.title"></h1>
        <button class="sb-toggle" type="button" data-i18n-title="ui.menu">
          <svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6" fill="none" stroke-width="3"/></svg>
        </button>
      </header>
      <div class="sb-body">
        <section class="panel">
          <h2 id="selection-title"></h2>
          <ul id="selection-list"></ul>
        </section>
        <details class="panel help">
          <summary data-i18n="help.title"></summary>
          <h3 data-i18n="help.mouse"></h3>
          <ul>${[1, 2, 3, 4, 5, 6].map((i) => `<li data-i18n="help.mouse.${i}"></li>`).join('')}</ul>
          <h3 data-i18n="help.touch"></h3>
          <ul>${[1, 2, 3, 4, 5].map((i) => `<li data-i18n="help.touch.${i}"></li>`).join('')}</ul>
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

    sb.querySelector('.sb-toggle')!.addEventListener('click', () => sb.classList.toggle('collapsed'));
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
        if (document.fullscreenElement) {
          await document.exitFullscreen();
        } else {
          await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
          // Querformat sperren, wo der Browser es erlaubt (Android).
          await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })
            .lock?.('landscape')
            .catch(() => undefined);
        }
      } catch {
        // Vollbild abgelehnt – nichts zu tun.
      }
    });
  }

  private buildCommandBar() {
    const bar = this.commandBar;
    bar.innerHTML = `
      <button type="button" data-cmd="stop" data-i18n-title="cmd.stop">${ICONS.stop}</button>
      <button type="button" data-cmd="attack" data-i18n-title="cmd.attackMove" disabled>${ICONS.attack}</button>
      <button type="button" data-cmd="stance" data-i18n-title="cmd.stance" disabled>${ICONS.stance}</button>
      ${[1, 2, 3, 4]
        .map(
          (n) =>
            `<button type="button" class="group" data-group="${n}" data-i18n-title="cmd.group">${n}<span class="badge" hidden></span></button>`,
        )
        .join('')}
      <button type="button" data-cmd="deselect" data-i18n-title="cmd.deselect">${ICONS.deselect}</button>`;

    bar.querySelector('[data-cmd="stop"]')!.addEventListener('click', () => this.actions.stop());
    bar.querySelector('[data-cmd="deselect"]')!.addEventListener('click', () => this.actions.clearSelection());

    bar.querySelectorAll<HTMLButtonElement>('[data-group]').forEach((btn) => {
      const n = Number(btn.dataset.group);
      this.groupBadges[n] = btn.querySelector('.badge')!;
      let timer: number | undefined;
      let saved = false;
      let lastTap = 0;
      btn.addEventListener('pointerdown', () => {
        saved = false;
        timer = window.setTimeout(() => {
          saved = true;
          navigator.vibrate?.(20);
          this.actions.saveGroup(n);
          this.showToast(t('ui.groupSaved', { n }));
        }, GROUP_HOLD_MS);
      });
      const cancel = () => clearTimeout(timer);
      btn.addEventListener('pointerleave', cancel);
      btn.addEventListener('pointercancel', cancel);
      btn.addEventListener('pointerup', () => {
        clearTimeout(timer);
        if (saved) return;
        const now = performance.now();
        this.actions.recallGroup(n);
        if (now - lastTap < 350) this.actions.centerOnSelection();
        lastTap = now;
      });
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });
    // Platzhalter {n} im Tooltip der Gruppenknöpfe
    onLangChange(() => this.updateGroupTitles());
    queueMicrotask(() => this.updateGroupTitles());
  }

  private updateGroupTitles() {
    this.commandBar.querySelectorAll<HTMLButtonElement>('[data-group]').forEach((btn) => {
      const text = t('cmd.group', { n: btn.dataset.group! });
      btn.title = text;
      btn.setAttribute('aria-label', text);
    });
  }

  /** Zeigt die Grösse einer Gruppe als kleines Abzeichen am Knopf. */
  setGroupSize(n: number, size: number): void {
    const badge = this.groupBadges[n];
    if (!badge) return;
    badge.hidden = size === 0;
    badge.textContent = String(size);
  }

  /** Aktualisiert die Auswahlanzeige (nur wenn sich etwas geändert hat). */
  setSelection(entries: SelectionEntry[], force = false): void {
    const same =
      !force &&
      entries.length === this.lastSelection.length &&
      entries.every((e, i) => e.nameKey === this.lastSelection[i].nameKey && e.count === this.lastSelection[i].count);
    if (same) return;
    this.lastSelection = entries;
    const total = entries.reduce((s, e) => s + e.count, 0);
    this.selectionTitle.textContent =
      total === 0 ? t('hud.selectionNone') : `${t('hud.selection')}: ${t('hud.selectionCount', { count: total })}`;
    this.selectionList.innerHTML = entries
      .map((e) => `<li><span>${t(e.nameKey)}</span><b>×${e.count}</b></li>`)
      .join('');
    this.commandBar.classList.toggle('has-selection', total > 0);
  }

  setStats(fps: number, units: number): void {
    this.stats.textContent = t('hud.stats', { fps: Math.round(fps), units });
  }

  showToast(text: string): void {
    this.toast.textContent = text;
    this.toast.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toast.hidden = true), 1500);
  }
}
