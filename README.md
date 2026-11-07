# Fight for the Right

Ein 2D-Echtzeit-Strategiespiel im Browser: Auf der Inselgruppe Neu-Aurora streiten die **Aero-Liga** und die
**Granit-Union** um die leuchtenden Glimmerit-Kristalle. Basis bauen, Kristalle ernten, Armee aufstellen –
bunt, augenzwinkernd und kinderfreundlich.

Läuft auf PC (Maus + Tastatur), Tablet und Smartphone (Touch).

**Spielen:** https://jabbar461983.github.io/fight-for-the-right/

## Lokal starten

Voraussetzung: [Node.js](https://nodejs.org) 22 oder neuer.

```bash
npm install
npm run dev
```

Dann im Browser http://localhost:5173 öffnen. Zum Testen auf Tablet oder Handy im selben WLAN die
«Network»-Adresse verwenden, die im Terminal angezeigt wird.

## Projektaufbau

| Ordner | Inhalt |
| --- | --- |
| `packages/shared` | Spielkern: Simulation, Wegfindung, Regeln – ohne Grafik, mit Tests |
| `packages/client` | Browser-Spiel: Darstellung (Phaser), Steuerung, Oberfläche |
| `data` | Einheitenwerte, Karten (Tiled-JSON), Texte (Deutsch/Englisch) |
| `scripts` | Hilfswerkzeuge, z.B. Kartengenerator |

Mehr Details für Entwickler: [CLAUDE.md](CLAUDE.md). Quellen und Lizenzen: [CREDITS.md](CREDITS.md).
