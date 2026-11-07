import * as Phaser from 'phaser';
import { GameScene, type GameSceneData } from './game/GameScene';
import { applyI18n } from './i18n';
import { loadSettings } from './storage';
import { Menu, type GameConfig } from './ui/Menu';
import './style.css';

/**
 * Einstieg: Hauptmenü (HTML) und Spielfläche (Phaser). Das Menü startet die
 * Spielszene mit der gewählten Gefechts-Einstellung.
 */

applyI18n(document);
void loadSettings();

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
    onExit: () => {
      game.scene.stop('game');
      app.classList.remove('in-game');
      menu.show('main');
    },
  };
  if (game.scene.isActive('game')) game.scene.stop('game');
  game.scene.start('game', data);
}

const menu = new Menu(app, startGame);

// Schnellstart für Tests: ?play startet sofort ein Gefecht mit den letzten Einstellungen
if (new URLSearchParams(location.search).has('play')) {
  window.setTimeout(() => (document.querySelector('[data-go="skirmish"]') as HTMLButtonElement | null)?.click(), 50);
  window.setTimeout(() => (document.getElementById('start') as HTMLButtonElement | null)?.click(), 400);
}
