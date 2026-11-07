import * as Phaser from 'phaser';
import { GameScene } from './game/GameScene';
import { applyI18n } from './i18n';
import './style.css';

applyI18n(document);

/**
 * Einstiegspunkt. Ab Etappe 2 kommt hier ein Hauptmenü vor die Spielszene.
 */
new Phaser.Game({
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
  scene: [GameScene],
});
