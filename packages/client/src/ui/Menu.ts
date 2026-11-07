import { AI_LEVELS, FACTIONS, type AiLevel, type Faction, type SlotSetup } from '@fftr/shared';
import { MAPS, getRules } from '../data';
import { applyI18n, getLang, onLangChange, setLang, t, type Lang } from '../i18n';
import { PLAYER_COLORS, iconFor } from '../game/textures';
import { getItem, getSettings, saveSettings, setItem } from '../storage';

/** Alles, was die Spielszene für ein Gefecht braucht. */
export interface GameConfig {
  mapId: string;
  slots: SlotSetup[];
  startCredits: number;
  /** Die id des Spielers an diesem Gerät. */
  localPlayer: number;
}

const START_CREDITS = [2000, 3000, 5000, 10000];
/** In dieser Etappe spielbare KI-Stufen. */
const ENABLED_AI: AiLevel[] = ['easy'];

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/**
 * Hauptmenü und Untermenüs als HTML-Überlagerung.
 */
export class Menu {
  private root: HTMLElement;
  private config: GameConfig;
  private screen: 'main' | 'skirmish' | 'settings' | 'credits' = 'main';

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
        // Gespeicherte KI-Stufen nur übernehmen, wenn sie schon spielbar sind
        for (const s of c.slots) if (s.ai && !ENABLED_AI.includes(s.ai)) s.ai = 'easy';
        this.config = c;
        if (this.screen === 'skirmish') this.render();
      }
    });
    onLangChange(() => this.render());
    this.render();
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

  show(screen: Menu['screen'] = 'main'): void {
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
    }
    applyI18n(this.root);
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
          <button type="button" disabled><span data-i18n="menu.campaign"></span><small>${t('menu.comingSoon', { n: 5 })}</small></button>
          <button type="button" class="primary" data-go="skirmish" data-i18n="menu.skirmish"></button>
          <button type="button" disabled><span data-i18n="menu.multiplayer"></span><small>${t('menu.comingSoon', { n: 3 })}</small></button>
          <button type="button" data-go="settings" data-i18n="menu.settings"></button>
          <button type="button" data-go="credits" data-i18n="menu.credits"></button>
        </div>
      </div>`;
    this.root.querySelectorAll<HTMLButtonElement>('[data-go]').forEach((b) =>
      b.addEventListener('click', () => this.show(b.dataset.go as Menu['screen'])),
    );
  }

  private renderSkirmish(): void {
    const cfg = this.config;
    const map = MAPS.find((m) => m.id === cfg.mapId) ?? MAPS[0];
    const rules = getRules();
    const me = cfg.slots[0];
    const factionCard = (f: Faction) => {
      const tank = rules.unit(f, 'lightTank')!;
      return `<button type="button" class="faction-card ${me.faction === f ? 'active' : ''}" data-faction="${f}">
        <img src="${iconFor(tank, PLAYER_COLORS[me.color])}" alt="" />
        <b data-i18n="faction.${f}"></b><small data-i18n="faction.${f}.desc"></small></button>`;
    };
    const slotRow = (s: SlotSetup, i: number) => `
      <div class="slot-row" data-slot="${i}">
        <span class="slot-name" style="--c:${hex(PLAYER_COLORS[s.color])}">${s.ai ? t('skirmish.computer') : t('skirmish.you')}</span>
        <select data-field="faction">${FACTIONS.map((f) => `<option value="${f}" ${s.faction === f ? 'selected' : ''}>${t(`faction.${f}`)}</option>`).join('')}</select>
        <span class="swatches">${PLAYER_COLORS.map(
          (c, ci) =>
            `<button type="button" class="swatch ${s.color === ci ? 'active' : ''}" data-color="${ci}" style="background:${hex(c)}" aria-label="${t('skirmish.color')} ${ci + 1}" ${
              cfg.slots.some((o, oi) => oi !== i && o.color === ci) ? 'disabled' : ''
            }></button>`,
        ).join('')}</span>
        <select data-field="team" aria-label="${t('skirmish.team')}">${[0, 1, 2]
          .map((tm) => `<option value="${tm}" ${s.team === tm ? 'selected' : ''}>${tm === 0 ? t('skirmish.noTeam') : `${t('skirmish.team')} ${tm}`}</option>`)
          .join('')}</select>
        ${
          s.ai
            ? `<select data-field="ai" aria-label="${t('skirmish.difficulty')}">${AI_LEVELS.map(
                (l) =>
                  `<option value="${l}" ${s.ai === l ? 'selected' : ''} ${ENABLED_AI.includes(l) ? '' : 'disabled'}>${t(`ai.${l}`)}${
                    ENABLED_AI.includes(l) ? '' : ` (${t('menu.comingSoon', { n: 4 })})`
                  }</option>`,
              ).join('')}</select>`
            : '<span></span>'
        }
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
          <label class="disabled"><span data-i18n="skirmish.bonusPoints"></span>
            <select disabled><option>${t('menu.comingSoon', { n: 4 })}</option></select>
          </label>
        </div>
        <h3 data-i18n="skirmish.players"></h3>
        <div class="slots">${cfg.slots.map(slotRow).join('')}</div>
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
    this.root.querySelector('[data-go="main"]')!.addEventListener('click', () => this.show('main'));
    this.root.querySelector('#start')!.addEventListener('click', () => {
      const names = cfg.slots.map((s, i) => ({ ...s, name: s.ai ? `${t('skirmish.computer')} ${i}` : t('skirmish.you') }));
      const game: GameConfig = { ...cfg, slots: names };
      void setItem('lastSkirmish', cfg);
      this.hide();
      this.onStart(game);
    });
  }

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
          <label class="disabled"><span data-i18n="settings.music"></span><input type="range" min="0" max="1" step="0.1" value="${s.musicVolume}" disabled /></label>
          <label class="disabled"><span data-i18n="settings.sfx"></span><input type="range" min="0" max="1" step="0.1" value="${s.sfxVolume}" disabled /></label>
          <small data-i18n="settings.audioLater"></small>
        </div>
        <div class="menu-actions"><button type="button" data-go="main" data-i18n="menu.back"></button></div>
      </div>`;
    this.root.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) =>
      b.addEventListener('click', () => setLang(b.dataset.lang as Lang)),
    );
    this.root.querySelector<HTMLSelectElement>('#speed')!.addEventListener('change', (e) => {
      void saveSettings({ gameSpeed: Number((e.target as HTMLSelectElement).value) });
    });
    this.root.querySelector('[data-go="main"]')!.addEventListener('click', () => this.show('main'));
  }

  private renderCredits(): void {
    this.root.innerHTML = `
      <div class="menu-card">
        <h2 data-i18n="credits.title"></h2>
        <p class="credits" data-i18n="credits.text"></p>
        <div class="menu-actions"><button type="button" data-go="main" data-i18n="menu.back"></button></div>
      </div>`;
    this.root.querySelector('[data-go="main"]')!.addEventListener('click', () => this.show('main'));
  }
}
