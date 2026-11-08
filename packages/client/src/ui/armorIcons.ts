import { ARMOR_CLASSES, type ArmorClass } from '@fftr/shared';
import { t } from '../i18n';

/**
 * Eigene Symbole für die Ziel-Arten (Panzerungsklassen) und die Sterne-Bewertung
 * «wie wirksam gegen …». Einfache Comic-Silhouetten als SVG (färbbar über currentColor).
 */
const PATHS: Record<ArmorClass, string> = {
  // Soldat: Helm, Kopf, Schultern
  infantry:
    '<path d="M6 8.5a6 5 0 0 1 12 0v1H6z"/><circle cx="12" cy="12" r="3.2"/><path d="M4.5 22c0-4.5 3.4-6.5 7.5-6.5s7.5 2 7.5 6.5z"/>',
  // Fahrzeug: kleiner Panzer mit Rohr
  light:
    '<rect x="2" y="13" width="20" height="5.5" rx="2.7"/><rect x="7" y="8.5" width="8" height="5" rx="1.5"/><rect x="14" y="10" width="8" height="1.8" rx=".9"/><circle cx="6" cy="20.5" r="1.4"/><circle cx="12" cy="20.5" r="1.4"/><circle cx="18" cy="20.5" r="1.4"/>',
  // Schwer: dicker Koloss mit Doppelrohr und Panzerplatte
  heavy:
    '<path d="M1.5 12.5h21v6.5a2 2 0 0 1-2 2h-17a2 2 0 0 1-2-2z"/><path d="M5 7h10l2 5.5H3z"/><rect x="15" y="7.6" width="8" height="1.6" rx=".8"/><rect x="15" y="10.2" width="8" height="1.6" rx=".8"/>',
  // Gebäude: Halle mit Schornstein
  building: '<path d="M2 21V11l6-4v4l6-4v4l6-4V21z"/><rect x="17" y="2.5" width="3" height="6"/>',
  // Luft: Hubschrauber mit Rotor
  air: '<rect x="2" y="3.5" width="20" height="1.8" rx=".9"/><rect x="11" y="4.5" width="2" height="4"/><path d="M5 9.5h11a5 5 0 0 1 0 10H9a4 4 0 0 1-4-4z"/><path d="M15 13h7.5v2.5H15z"/>',
};

/** Symbol als SVG-Text. */
export function armorIcon(c: ArmorClass, size = 16): string {
  return `<svg class="armor-icon ${c}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true">${PATHS[c]}</svg>`;
}

/** Sterne: gefüllte und leere (0 = trifft nicht). */
export function starsHtml(n: number): string {
  if (n <= 0) return `<span class="stars none">${t('rating.none')}</span>`;
  return `<span class="stars" aria-label="${n}/5"><b>${'★'.repeat(n)}</b>${'★'.repeat(5 - n)}</span>`;
}

/** Tabelle: alle Ziel-Arten mit Symbol, Namen und Sternen. */
export function ratingTable(r: Record<ArmorClass, number>): string {
  return `<table class="rating">${ARMOR_CLASSES.map(
    (c) => `<tr class="${r[c] >= 4 ? 'strong' : ''}"><td>${armorIcon(c, 18)}</td><td>${t(`armor.${c}`)}</td><td>${starsHtml(r[c])}</td></tr>`,
  ).join('')}</table>`;
}

/** Als Text (Tooltip mit der Maus). */
export function ratingText(r: Record<ArmorClass, number>): string {
  return ARMOR_CLASSES.map((c) => `${t(`armor.${c}`)}: ${r[c] > 0 ? '★'.repeat(r[c]) + '☆'.repeat(5 - r[c]) : t('rating.none')}`).join('\n');
}
