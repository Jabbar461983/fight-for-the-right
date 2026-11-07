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
packages/server   Colyseus-Server (Mehrspieler), führt den Spielkern autoritativ aus
data/             Inhalte: rules/ (Waffen, Gebäude, Fraktionen, KI), units/, maps/ (Tiled-JSON), i18n/
scripts/          Werkzeuge (z.B. Kartengenerator)
```

### Spielkern-Module (`packages/shared/src`)
| Datei | Aufgabe |
| --- | --- |
| `data/rules.ts` | Lädt + prüft alle Regel-Dateien (Zod), rechnet in Ticks/Welteinheiten um, Fraktions-Modifikatoren |
| `sim/simulation.ts` | Zustand (Spieler, Einheiten, Gebäude, Geschosse), Befehle, Tick-Reihenfolge, Sieg/Niederlage |
| `sim/movement.ts` | A*/Flussfeld-Bewegung, Gedränge, Festfahr-Erkennung |
| `sim/production.ts` | Bauschlangen, Platzieren (`canPlace`), Strom, Lager, Reparatur, Verkaufen |
| `sim/economy.ts` | Kristallfelder (nachwachsend), Sammler-Zustandsmaschine |
| `sim/combat.ts` | Zielwahl (nur Sichtbares), Schiessen, Geschosse, Flächenschaden, Panzerungsklassen |
| `sim/tasks.ts` | Einheiten-Aufgaben: Angriff, Angriffsbewegung, Verfolgen (Haltungen), Ingenieur, Bauwagen |
| `sim/fog.ts` | Sicht je Spieler (Verbündete teilen), Erkundet, «Geister» gesehener Gebäude |
| `sim/setup.ts` | Gefechts-Start: Bauwagen + Eskorte je Startplatz, KI-Spieler anhängen |
| `ai/skirmishAi.ts` | KI: nur über `sim.issue()`, sieht nur durch eigene Augen; Stufen in `data/rules/ai.json` |

Tick-Reihenfolge: Befehle → Produktion → Reparatur → Wirtschaft → Aufgaben → Kampf → Geschosse →
Bewegung → Strom → Nebel (alle 3 Ticks) → Sieg (alle 15 Ticks) → KI. Tote Objekte werden mit `dead`
markiert und erst gesammelt entfernt (`cleanup`). Ereignisse (`SimEvent`) holt der Client mit `drainEvents()`.
`victory: 'none'` schaltet die automatische Niederlage aus (Tests, spätere Kampagnenmissionen).

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
- `main.ts` → `ui/Menu.ts` (Hauptmenü, Gefecht-Einrichtung, Einstellungen, Credits) → startet `GameScene`.
- `GameScene` verbindet Simulation, Darstellung, Eingabe und Oberfläche; interpoliert zwischen Ticks
  (`prevX/prevY`), zeigt Gegner nur im Sichtbereich, Gebäude-«Geister» im Nebel, Comic-Effekte aus Ereignissen.
- Kontextbefehl (Rechtsklick/Tippen) je nach Ziel: Angriff, Ernten, Andocken, Ingenieur, sonst Fahren.
  Angriffsbewegung: A bzw. Knopf, dann Linksklick/Tippen. Platzieren: Maus folgt; Touch tippen + ✓.
- Eingabe über **DOM-Pointer-Events** (`input/InputController.ts`), nicht Phaser-Input. Maus und Touch getrennt.
- Oberfläche als **HTML/CSS** (`ui/Hud.ts`, `style.css`): Glimmerit, Strom, Minikarte (nur mit Radar + Strom),
  Bauleiste mit Reitern, Befehlsleiste, Meldungen + Sprechblase, Pause, Endbildschirm.
  Smartphone-Layout per Media-Query `(max-width: 900px), (max-height: 520px)`.
- Grafiken sind **Platzhalter**, zur Laufzeit auf Canvas gezeichnet: `game/terrainPainter.ts` (Gelände mit
  runden Rändern, freistehende Bäume), `game/textures.ts` (Einheiten/Gebäude je Fraktion + Spielerfarbe,
  Effekte, Bauleisten-Symbole). Texture-Keys bleiben beim späteren Austausch gegen Sprites gleich.
- Einstellungen in IndexedDB (`storage.ts`), Sprache in localStorage (synchron beim Start nötig).
- Dev-Hilfen: `?play` (Gefecht sofort starten), `?debug` (Wege anzeigen), `window.fftr` (nur `npm run dev`).
- Achtung Browser-Vorschau: Ist das Fenster ausgeblendet, zeichnet der Browser kaum neu – Screenshots sind
  dann veraltet. Zustand lieber per `window.fftr` prüfen.

### Mehrspieler (`@fftr/server` + `shared/src/net`)
- **Server-autoritativ:** Der Server (`GameRoom.ts`) rechnet die Simulation; Clients schicken nur Befehle
  (`'cmd'`, geprüft durch `sim.issue`). Alle 2 Ticks bekommt jeder Client eine **Momentaufnahme**
  (`net/snapshot.ts`): nur was er sehen darf (Nebel → kein Schummeln) und nur Änderungen. Der Client
  trägt sie in eine **Spiegel-Simulation** ein (`applySnapshot`, `sim.mirror*`), die nie `step()` aufruft –
  die Spielszene stellt sie wie im Einzelspieler dar und interpoliert zwischen den Aufnahmen.
- **Lobby** ohne Colyseus-Schema: der Server schickt den Zustand als Nachricht `'lobby'`; Regeln (Startprüfung,
  Teams je Modus, Namensfilter, Raumcodes) in `net/lobby.ts`. Nachrichten werden mit zod geprüft.
- Raumcode = Colyseus-`roomId` (6 Zeichen ohne 0/O/1/I/L), Räume privat; Einladung per `?join=CODE`.
- Verbindungsabbruch: Platz bleibt 2 Min. frei (`allowReconnection`); Seite neu laden → automatische Rückkehr
  (Token in sessionStorage). Wer endgültig geht, wird durch eine KI ersetzt.
- Server-Adresse im Client: `VITE_SERVER_URL` (beim Bauen, GitHub-Variable `SERVER_URL`), lokal `ws://<host>:2567`.
- Hosting: **Render Free** (Frankfurt) über `render.yaml`; schläft nach 15 Min. ohne Spieler, Aufwachen ≈ 1 Min.
  (der Client weckt per `/health` und zeigt einen Hinweis). Deploy nach grüner CI (`autoDeployTrigger: checksPass`).

### Karten
- Format: Tiled-JSON, Ebene `terrain` (Tileset-Kacheln mit Eigenschaft `terrain`), Objektebene mit
  `spawn` (Eigenschaft `player`) und `crystalField` (`radius`, `amount`). Geländearten:
  grass, sand, road, forest (nur Infanterie), cliff, water, bridge.
- Startkarten werden von `scripts/generate-maps.ts` erzeugt (`npm run maps`), punktsymmetrisch für Fairness.
  Danach dürfen sie im Editor Tiled weiterbearbeitet werden (Tileset-Bild `data/maps/terrain-tiles.png`).

## Befehle

```bash
npm install          # Abhängigkeiten
npm run dev          # Server (Port 2567) + Client (http://localhost:5173, im WLAN: «Network»-Adresse)
npm test             # Tests von Spielkern und Server (Vitest)
npm run build:server # Server als einzelne Datei bündeln (packages/server/dist/server.js)
npm run typecheck    # TypeScript-Prüfung aller Pakete
npm run build        # Produktions-Build nach packages/client/dist
npm run maps         # Startkarten neu erzeugen
```

## Konventionen

- TypeScript strict. Bezeichner Englisch, **Kommentare, Commits und Doku Deutsch**.
- Spiellogik nur in `shared`, mit Tests in `packages/shared/test`. Neue Mechanik → neuer Test.
- Kleine, sinnvoll benannte Commits (z.B. `Wegfindung: Flussfelder für Gruppen`).
- Tastenbelegung: Pfeiltasten = Kamera; WASD = Kamera nur ohne Auswahl (mit Auswahl: S = Stopp,
  A = Angriffsbewegung, D = Bauwagen ausfahren). Esc: abbrechen, sonst Pause.
- Kinderschutz in der Bedienung: Verkaufen braucht zweimaliges Tippen, Aufgeben eine Bestätigung.
- Deployment: Push auf `main` → GitHub Actions testet, baut und veröffentlicht auf GitHub Pages.

## Stand

- **Etappe 1 – Fundament:** abgenommen (7.11.2026). Grafik wurde als «sehr rudimentär» empfunden →
  in Etappe 2 bessere Platzhalter (runde Geländeränder, Fraktions-Look) gezeichnet.
- **Etappe 3 – Multiplayer:** umgesetzt, wartet auf Abnahme. Räume mit Code/Link, Lobby (Plätze: Mensch/KI/
  offen/zu, Fraktion, Farbe, Team, Bereit, Chat mit vorgefertigten Nachrichten), Modi Jeder-gegen-jeden /
  Teams / Gemeinsam gegen KI, Schnellnachrichten mit Ping, Wiederverbinden, KI-Übernahme, Endstatistik.
  Karte «Vier Winde» (4 Spieler) vorgezogen für die 2v2-Abnahme. Gefecht gegen KI jetzt mit 1–3 Gegnern.
- **Etappe 2 – Spielbares Gefecht:** abgenommen (7.11.2026). Wirtschaft (Sammler, Raffinerie, Silo,
  Nachwachsen, Lager voll), Basisbau (Bauleiste, Platzieren grün/rot, Pause/Abbruch, Verkaufen, Reparieren),
  Strom (Mangel bremst Bau/Türme, schaltet Radar ab), Kampf (Waffen × Panzerung, Haltungen, Angriffsbewegung,
  Türme, Flächenschaden), Nebel mit Geistern, gemeinsame Bodeneinheiten beider Fraktionen (Aero billiger und
  schneller, Granit zäher), Ingenieur, Bauwagen, KI Leicht, Sieg/Niederlage/Aufgeben, Hauptmenü,
  Endstatistik. Getestet: komplette Partie gegen KI im Browser gewonnen; KI besiegt untätigen Gegner (Test).
- **Bewusst später:** Luft/See und Flugfeld/Werft/Technikzentrum/Flak-Stellung/Reparaturstation (Etappe 4),
  KI Mittel/Schwer (Etappe 4, Werte stehen schon in ai.json), Bonus-Punkte (Etappe 4), Sound (Etappe 6).
- Offene Punkte: Strg+Zahl wird von manchen Browsern abgefangen (Ausweichweg: Gruppenknopf lange drücken).
  KI gegen KI (Leicht) endet oft unentschieden – für Etappe 4/5 Balancing.
