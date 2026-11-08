/**
 * Comic-Porträts der Figuren (Platzhalter, zur Laufzeit auf Canvas gezeichnet).
 * Später gegen gezeichnete Bilder austauschbar – die Schlüssel bleiben gleich.
 *
 * - aero:       Kommandantin Lyra Funke (Aero-Liga) – Fliegerhaube mit Brille, rote Haare
 * - granite:    Kommandantin Berta Basalt (Granit-Union) – Stahlhelm mit Nieten, dunkler Zopf
 * - researcher: Dr. Ida Quarz – Brille, Kittel, Glimmerit-Anhänger
 */
export type PortraitKind = 'aero' | 'granite' | 'researcher';

const cache = new Map<string, string>();
const OUTLINE = '#1d1a2b';

/**
 * Wappen der Fraktionen (für Meldungen im Spiel):
 * - Aero-Liga: weisse Flügel mit gelbem Blitz auf blauem Kreis
 * - Granit-Union: zwei Berggipfel in einem genieteten Schild auf Steingrau
 */
export function emblem(faction: 'aero' | 'granite'): string {
  const key = `emblem_${faction}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.lineWidth = 5;
  g.strokeStyle = OUTLINE;
  const path = (pts: [number, number][]) => {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) g.lineTo(x, y);
    g.closePath();
  };
  if (faction === 'aero') {
    // Blauer Kreis mit hellem Ring
    g.beginPath();
    g.arc(64, 64, 58, 0, Math.PI * 2);
    g.fillStyle = '#2f6fd0';
    g.fill();
    g.stroke();
    g.beginPath();
    g.arc(64, 64, 48, 0, Math.PI * 2);
    g.lineWidth = 3;
    g.strokeStyle = '#bfe9ff';
    g.stroke();
    g.lineWidth = 4;
    g.strokeStyle = OUTLINE;
    // Flügel (links und gespiegelt rechts), je drei Federn
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const y = 52 + i * 12;
        const len = 40 - i * 9;
        path([
          [64 + side * 10, y - 4],
          [64 + side * (10 + len), y - 10 + i * 2],
          [64 + side * (6 + len), y + 6],
          [64 + side * 10, y + 7],
        ]);
        g.fillStyle = '#ffffff';
        g.fill();
        g.stroke();
      }
    }
    // Blitz in der Mitte
    path([
      [70, 26],
      [52, 66],
      [64, 66],
      [56, 102],
      [78, 56],
      [66, 56],
    ]);
    g.fillStyle = '#ffd23f';
    g.fill();
    g.stroke();
  } else {
    // Steingrauer Hintergrund-Kreis
    g.beginPath();
    g.arc(64, 64, 58, 0, Math.PI * 2);
    g.fillStyle = '#6b6f7a';
    g.fill();
    g.stroke();
    // Schild
    g.beginPath();
    g.moveTo(30, 28);
    g.lineTo(98, 28);
    g.lineTo(98, 66);
    g.quadraticCurveTo(98, 96, 64, 112);
    g.quadraticCurveTo(30, 96, 30, 66);
    g.closePath();
    g.fillStyle = '#e2a04a';
    g.fill();
    g.stroke();
    // Zwei Berggipfel mit Schneekappen
    path([
      [36, 88],
      [56, 46],
      [72, 72],
      [80, 58],
      [94, 88],
    ]);
    g.fillStyle = '#8c929e';
    g.fill();
    g.stroke();
    path([
      [49, 60],
      [56, 46],
      [63, 60],
      [56, 56],
    ]);
    g.fillStyle = '#ffffff';
    g.fill();
    g.lineWidth = 2;
    g.stroke();
    // Nieten am Schildrand
    g.fillStyle = '#ffd23f';
    for (const [x, y] of [
      [38, 36],
      [90, 36],
      [64, 36],
    ]) {
      g.beginPath();
      g.arc(x, y, 4, 0, Math.PI * 2);
      g.fill();
    }
  }
  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}

export function portrait(kind: PortraitKind, mood: 'normal' | 'angry' = 'normal'): string {
  const key = `${kind}_${mood}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const bg = kind === 'aero' ? '#5ab4ff' : kind === 'granite' ? '#e2a04a' : '#7be0b8';
  const stroke = (w = 4) => {
    g.lineWidth = w;
    g.strokeStyle = OUTLINE;
    g.stroke();
  };
  const fill = (color: string, w = 4) => {
    g.fillStyle = color;
    g.fill();
    stroke(w);
  };

  // Hintergrund mit Comic-Strahlen
  g.fillStyle = bg;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(255,255,255,0.25)';
  for (let i = 0; i < 12; i += 2) {
    g.beginPath();
    g.moveTo(64, 70);
    g.arc(64, 70, 120, (i * Math.PI) / 6, ((i + 1) * Math.PI) / 6);
    g.fill();
  }

  // Schultern / Uniform
  g.beginPath();
  g.ellipse(64, 132, 50, 34, 0, Math.PI, 0);
  fill(kind === 'aero' ? '#2f6fd0' : kind === 'granite' ? '#6b6f7a' : '#f4f4f4');
  if (kind === 'researcher') {
    // Kittelkragen
    g.beginPath();
    g.moveTo(48, 100);
    g.lineTo(64, 122);
    g.lineTo(80, 100);
    stroke(3);
  } else {
    // Rangabzeichen
    g.beginPath();
    g.arc(86, 112, 6, 0, Math.PI * 2);
    fill('#ffd23f', 3);
  }

  // Haare hinten
  const hair = kind === 'aero' ? '#e8603c' : kind === 'granite' ? '#3b2a24' : '#a4683b';
  g.beginPath();
  g.ellipse(64, 66, 36, 40, 0, 0, Math.PI * 2);
  fill(hair);
  if (kind === 'granite') {
    // Zopf
    g.beginPath();
    g.ellipse(98, 90, 8, 16, -0.4, 0, Math.PI * 2);
    fill(hair, 3);
  }

  // Gesicht
  g.beginPath();
  g.ellipse(64, 70, 28, 31, 0, 0, Math.PI * 2);
  fill('#f6c89a');
  // Wangen
  g.fillStyle = 'rgba(232,96,60,0.35)';
  g.beginPath();
  g.arc(47, 80, 6, 0, Math.PI * 2);
  g.arc(81, 80, 6, 0, Math.PI * 2);
  g.fill();

  // Augen
  const eyeY = 68;
  g.fillStyle = OUTLINE;
  g.beginPath();
  g.arc(53, eyeY, 4, 0, Math.PI * 2);
  g.arc(75, eyeY, 4, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(54.5, eyeY - 1.5, 1.4, 0, Math.PI * 2);
  g.arc(76.5, eyeY - 1.5, 1.4, 0, Math.PI * 2);
  g.fill();
  // Augenbrauen
  g.beginPath();
  if (mood === 'angry') {
    g.moveTo(46, 58);
    g.lineTo(59, 62);
    g.moveTo(82, 58);
    g.lineTo(69, 62);
  } else {
    g.moveTo(47, 60);
    g.quadraticCurveTo(53, 56, 59, 60);
    g.moveTo(69, 60);
    g.quadraticCurveTo(75, 56, 81, 60);
  }
  stroke(3);
  // Mund
  g.beginPath();
  if (mood === 'angry') {
    g.moveTo(55, 88);
    g.quadraticCurveTo(64, 83, 73, 88);
    stroke(3);
  } else {
    g.moveTo(54, 84);
    g.quadraticCurveTo(64, 94, 74, 84);
    g.closePath();
    fill('#c0392b', 3);
  }

  if (kind === 'aero') {
    // Fliegerhaube mit Brille auf der Stirn
    g.beginPath();
    g.ellipse(64, 48, 32, 20, 0, Math.PI, 0);
    g.lineTo(96, 52);
    g.lineTo(32, 52);
    g.closePath();
    fill('#8a5a35');
    g.beginPath();
    g.arc(52, 48, 8, 0, Math.PI * 2);
    fill('#bfe9ff', 3);
    g.beginPath();
    g.arc(76, 48, 8, 0, Math.PI * 2);
    fill('#bfe9ff', 3);
    g.beginPath();
    g.moveTo(60, 48);
    g.lineTo(68, 48);
    stroke(3);
  } else if (kind === 'granite') {
    // Stahlhelm mit Nieten
    g.beginPath();
    g.ellipse(64, 50, 36, 24, 0, Math.PI, 0);
    g.lineTo(102, 54);
    g.lineTo(26, 54);
    g.closePath();
    fill('#8c929e');
    g.fillStyle = '#ffd23f';
    for (const x of [42, 64, 86]) {
      g.beginPath();
      g.arc(x, 44, 3.5, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    // Brille und Glimmerit-Anhänger
    g.beginPath();
    g.arc(53, 68, 9, 0, Math.PI * 2);
    stroke(3);
    g.beginPath();
    g.arc(75, 68, 9, 0, Math.PI * 2);
    stroke(3);
    g.beginPath();
    g.moveTo(64, 104);
    g.lineTo(70, 112);
    g.lineTo(64, 122);
    g.lineTo(58, 112);
    g.closePath();
    fill('#5ff0ff', 3);
    // Haarknoten
    g.beginPath();
    g.arc(64, 36, 10, 0, Math.PI * 2);
    fill(hair, 3);
  }

  // Rahmen
  g.lineWidth = 6;
  g.strokeStyle = OUTLINE;
  g.strokeRect(3, 3, 122, 122);

  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}
