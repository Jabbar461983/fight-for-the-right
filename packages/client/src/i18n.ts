import de from '@data/i18n/de.json';
import en from '@data/i18n/en.json';

/**
 * Mehrsprachigkeit. Alle sichtbaren Texte kommen aus data/i18n/<sprache>.json.
 * Im HTML: data-i18n="schlüssel" (Text) bzw. data-i18n-title="schlüssel" (Tooltip + aria-label).
 */

export type Lang = 'de' | 'en';
const DICTS: Record<Lang, Record<string, string>> = { de, en };
const STORAGE_KEY = 'fftr.lang';

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'de' || saved === 'en') return saved;
  } catch {
    // Speicher gesperrt (z.B. privates Fenster) – egal.
  }
  return navigator.language.toLowerCase().startsWith('de') ? 'de' : 'en';
}

let lang: Lang = initialLang();
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return lang;
}

/** Übersetzt einen Schlüssel. Platzhalter {name} werden ersetzt. Fehlt ein Text, erscheint der Schlüssel. */
export function t(key: string, params?: Record<string, string | number>): string {
  let s = DICTS[lang][key] ?? DICTS.de[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

export function setLang(l: Lang): void {
  lang = l;
  try {
    localStorage.setItem(STORAGE_KEY, l);
  } catch {
    // ignorieren
  }
  applyI18n(document);
  for (const fn of listeners) fn();
}

export function onLangChange(fn: () => void): void {
  listeners.add(fn);
}

/** Setzt alle Texte unterhalb von root neu. */
export function applyI18n(root: ParentNode): void {
  if (root === document) document.documentElement.lang = lang;
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n!);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    const text = t(el.dataset.i18nTitle!);
    el.title = text;
    el.setAttribute('aria-label', text);
  });
}
