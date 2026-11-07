# Fight for the Right – Projektleitfaden

2D-Echtzeit-Strategiespiel im Browser (Basisbau, Glimmerit-Wirtschaft, Armeen) im Retro-Futurismus-Comic-Stil.
Hobbyprojekt für Freunde und Kinder: **Spielspass, Stabilität und Erweiterbarkeit vor technischer Perfektion.**
Vollständige Anforderungen: Entwicklungs-Prompt von Christian (7.11.2026), Kapitel 1–9.

## Verbindliche Leitplanken

- **Rechtliches:** Keine Namen, Einheiten, Grafiken, Sounds oder Texte bestehender Spiele. Nur eigene Inhalte
  oder freie Assets (CC0 bevorzugt), jedes Asset mit Quelle + Lizenz in `CREDITS.md`.
- **Kinderfreundlich:** Kein Blut, keine realistischen Verletzungen. Infanterie verschwindet in Comic-Wolke /
  springt mit Mini-Fallschirm ab. Keine realen Staaten, Flaggen, Ideologien, Symbole.
- **Touch ist gleichwertig** mit Maus/Tastatur, jede Funktion braucht einen Touch-Weg (Knöpfe ≥ 44×44 px).
- **Keine fest verdrahteten Texte:** alles über `data/i18n/de.json` + `en.json` (`t('schlüssel')` bzw. `data-i18n`).
- **Daten statt Code:** Werte von Einheiten, Gebäuden, Karten, Missionen liegen als JSON in `data/` und werden
  beim Laden mit Zod geprüft.
- Arbeit in **Etappen** (Kapitel 9). Am Ende jeder Etappe: spielbar, Tests grün, Testanleitung an Christian,
  auf OK warten.

## Architektur

```
packages/shared   Spielkern – reine TypeScript-Logik, KEINE Phaser-/DOM-Abhängigkeit
packages/client   Browser: Phaser 4 (Darstellung), eigene DOM-Eingabe, HTML-Oberfläche
packages/server   (ab Etappe 3) Colyseus-Server, führt den Spielkern autoritativ aus
data/             Inhalte: units/, maps/ (Tiled-JSON), i18n/
scripts/          Werkzeuge (z.B. Kartengenerator)
```

### Spielkern (`@fftr/shared`)
- **Deterministisch:** nur Ganzzahl-Arithmetik. Positionen in Welteinheiten, `TILE = 1024` Einheiten pro Kachel
  (Darstellung: 32 px). Kein `Math.random`, kein `Math.sin/cos/atan2`, keine Zeitstempel in der Simulation.
  Zufall nur über `Rng` mit Startwert. Divisionen mit `Math.trunc`. Iteration immer nach id sortiert.
- **Fester Takt:** `TICK_RATE = 15` Ticks/s. `Simulation.step()` rechnet genau einen Tick.
- **Befehle:** `sim.issue(player, command)` prüft Form + Besitz und reiht ein; ausgeführt zu Beginn des
  nächsten Ticks. Im Mehrspieler sind genau diese Befehle die Netzwerk-Nachrichten.
- **Wegfindung:** einzelne Einheit → A* (`path/astar.ts`, 8 Richtungen, keine Ecken schneiden, Strassen
  bevorzugt) + Glättung per Sichtlinie. Gruppe → gemeinsames Flussfeld (`path/flowField.ts`, gecacht) +
  Formationsplätze (`sim/formation.ts`); kurz vor dem Ziel direkt bzw. per A* zum eigenen Platz.
- **Gedränge:** Abstoßung über `SpatialHash`; Stehende weichen Fahrenden aus, Entgegenkommende weichen rechts aus.
  «Festgefahren» = Restweg schrumpft 3 s lang nicht → neu planen bzw. aufgeben, wenn nah am Ziel.
- **Unerreichbare Ziele** (Wasser, Insel) → nächste erreichbare Kachel (`resolveGoal`, Zusammenhangskomponenten).
- `stateHash()` liefert eine Prüfsumme – für Synchronitätstests und später den Mehrspieler.

### Client (`@fftr/client`)
- `GameScene` verbindet Simulation, Darstellung und Eingabe; interpoliert zwischen Ticks (`prevX/prevY`).
- Eingabe über **DOM-Pointer-Events** (`input/InputController.ts`), nicht Phaser-Input. Maus und Touch getrennt.
- Oberfläche (Seitenleiste, Befehlsleiste) als **HTML/CSS** (`ui/Hud.ts`, `style.css`), Smartphone-Layout per
  Media-Query `(max-width: 900px), (max-height: 520px)`.
- Grafiken sind **Platzhalter**, zur Laufzeit auf Canvas gezeichnet (`game/textures.ts`). Texture-Keys bleiben
  beim späteren Austausch gegen Sprites gleich.
- Dev-Hilfen: `?units=200` (Anzahl Starteinheiten), `?debug` (Wege anzeigen), `window.fftr` (nur `npm run dev`).

### Karten
- Format: Tiled-JSON, Ebene `terrain` (Tileset-Kacheln mit Eigenschaft `terrain`), Objektebene mit
  `spawn` (Eigenschaft `player`) und `crystalField` (`radius`, `amount`). Geländearten:
  grass, sand, road, forest (nur Infanterie), cliff, water, bridge.
- Startkarten werden von `scripts/generate-maps.ts` erzeugt (`npm run maps`), punktsymmetrisch für Fairness.
  Danach dürfen sie im Editor Tiled weiterbearbeitet werden (Tileset-Bild `data/maps/terrain-tiles.png`).

## Befehle

```bash
npm install          # Abhängigkeiten
npm run dev          # Spiel lokal starten (http://localhost:5173, im WLAN über die angezeigte Network-Adresse)
npm test             # Tests des Spielkerns (Vitest)
npm run typecheck    # TypeScript-Prüfung aller Pakete
npm run build        # Produktions-Build nach packages/client/dist
npm run maps         # Startkarten neu erzeugen
```

## Konventionen

- TypeScript strict. Bezeichner Englisch, **Kommentare, Commits und Doku Deutsch**.
- Spiellogik nur in `shared`, mit Tests in `packages/shared/test`. Neue Mechanik → neuer Test.
- Kleine, sinnvoll benannte Commits (z.B. `Wegfindung: Flussfelder für Gruppen`).
- Tastenbelegung: Pfeiltasten = Kamera; WASD = Kamera nur ohne Auswahl (mit Auswahl: S = Stopp, A = Angriff).
- Deployment: Push auf `main` → GitHub Actions testet, baut und veröffentlicht auf GitHub Pages.

## Stand

- **Etappe 1 – Fundament:** umgesetzt, wartet auf Abnahme durch Christian.
  Monorepo, Tests, Pages-Deployment, Karte Kristalltal, Kamera (Maus/Tastatur/Touch), Auswahl und Bewegung
  mit A* + Flussfeldern. 200 Einheiten laufen lokal mit 60 fps (Tick ≈ 2–3 ms).
- **Nächstes (Etappe 2):** Wirtschaft (Sammler, Raffinerie), Basisbau mit Bauleiste, Strom, Kampf, Nebel,
  gemeinsame Einheiten beider Fraktionen, KI Leicht, Sieg/Niederlage, Hauptmenü.
- Offene Punkte: Strg+Zahl wird von manchen Browsern abgefangen (Ausweichweg: Gruppenknopf lange drücken).
  Gelände hat noch keine weichen Übergänge (Autotiling) – kommt mit den echten Grafiken.
