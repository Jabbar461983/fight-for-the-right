import * as Phaser from 'phaser';
import { GameScene, type GameSceneData } from './game/GameScene';
import { music, play, setVolumes, unlockAudio } from './audio/sound';
import { applyI18n } from './i18n';
import { loadSettings } from './storage';
import { Menu, type GameConfig } from './ui/Menu';
import './style.css';

/**
 * Einstieg: Hauptmenü (HTML) und Spielfläche (Phaser). Das Menü startet die
 * Spielszene mit der gewählten Gefechts-Einstellung.
 */

applyI18n(document);
void loadSettings().then((s) => setVolumes(s.musicVolume, s.sfxVolume));

// Ton: erst nach der ersten Berührung erlaubt; Klick-Geräusch für alle Knöpfe
const unlock = () => unlockAudio();
window.addEventListener('pointerdown', unlock, true);
window.addEventListener('keydown', unlock, true);
document.addEventListener(
  'click',
  (e) => {
    const b = (e.target as HTMLElement | null)?.closest('button');
    if (b && !b.disabled) play('click', 0.6);
  },
  true,
);
music('menu');

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#1b1d2e',
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: '100%',
    height: '100%',
  },
  render: {
    antialias: true,
    roundPixels: false,
  },
  // Eingabe läuft über unseren eigenen InputController (DOM-Pointer-Events).
  input: {
    keyboard: false,
    mouse: false,
    touch: false,
    gamepad: false,
  },
  disableContextMenu: true,
  banner: false,
  scene: [],
});
game.scene.add('game', GameScene, false);

const app = document.getElementById('app')!;

function startGame(config: GameConfig): void {
  app.classList.add('in-game');
  const data: GameSceneData = {
    config,
    onExit: (next) => {
      game.scene.stop('game');
      app.classList.remove('in-game');
      music('menu');
      if (next?.briefing) menu.openBriefing(next.briefing);
      else menu.show(config.mission ? 'campaign' : 'main');
    },
  };
  if (game.scene.isActive('game')) game.scene.stop('game');
  game.scene.start('game', data);
}

const menu = new Menu(app, startGame);

// Schnellstart für Tests: ?play startet sofort ein Gefecht mit den letzten Einstellungen,
// ?mission=a1 öffnet das Briefing einer Mission (auch gesperrte – nur zum Testen)
const params = new URLSearchParams(location.search);
if (params.get('mission')) menu.openBriefing(params.get('mission')!);
if (params.has('play')) {
  window.setTimeout(() => (document.querySelector('[data-go="skirmish"]') as HTMLButtonElement | null)?.click(), 50);
  window.setTimeout(() => (document.getElementById('start') as HTMLButtonElement | null)?.click(), 400);
}
