# Credits

«Fight for the Right» ist ein Hobbyprojekt für Freunde und Kinder.

## Grafik, Sound, Musik

Es gibt **keine fremden Bilder, Töne oder Musikstücke**. Alles wird vom Spiel selbst erzeugt:

| Inhalt | Quelle | Lizenz |
| --- | --- | --- |
| Gelände, Einheiten, Gebäude, Effekte, Bauleisten-Symbole | Eigene Zeichnung im Code (`packages/client/src/game/textures.ts`, `terrainPainter.ts`) | Teil dieses Projekts |
| Porträts (Lyra Funke, Berta Basalt, Dr. Ida Quarz) | Eigene Zeichnung im Code (`packages/client/src/ui/portraits.ts`) | Teil dieses Projekts |
| Geräusche und Musik | Zur Laufzeit synthetisiert mit WebAudio (`packages/client/src/audio/sound.ts`), eigene Melodien | Teil dieses Projekts |
| Tileset-Bild für den Karteneditor (`data/maps/terrain-tiles.png`) | Erzeugt von `scripts/generate-maps.ts` | Teil dieses Projekts |
| Schrift | Systemschrift des Geräts (keine eingebettete Schrift) | – |

Kommt später ein externes Asset dazu, wird es hier mit Quelle und Lizenz eingetragen (CC0 bevorzugt).

## Software

| Bibliothek | Zweck | Lizenz |
| --- | --- | --- |
| [Phaser](https://phaser.io) | Darstellung im Browser | MIT |
| [Colyseus](https://colyseus.io) | Mehrspieler-Server | MIT |
| [Zod](https://zod.dev) | Prüfung der Datendateien | MIT |
| [Vite](https://vite.dev) | Entwicklungsserver und Build | MIT |
| [Vitest](https://vitest.dev) | Automatische Tests | MIT |
| [TypeScript](https://www.typescriptlang.org) | Programmiersprache | Apache-2.0 |
