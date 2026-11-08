import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FACTIONS } from '../src/data/rules';
import { loadData, rules } from './helpers';

const de = loadData('i18n/de.json') as Record<string, string>;
const en = loadData('i18n/en.json') as Record<string, string>;

/** Alle .ts-Dateien des Clients. */
function clientFiles(dir = fileURLToPath(new URL('../../client/src', import.meta.url))): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? clientFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('Texte (i18n)', () => {
  it('Deutsch und Englisch haben dieselben Schlüssel, keiner ist leer', () => {
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
    for (const [k, v] of [...Object.entries(de), ...Object.entries(en)]) expect(v.trim(), k).not.toBe('');
  });

  it('keine Platzhalter-Texte mehr («kommt in Etappe», «Platzhalter», TODO)', () => {
    for (const [k, v] of [...Object.entries(de), ...Object.entries(en)]) {
      expect(/etappe|stage \d|platzhalter|placeholder text|todo/i.test(v), `${k}: ${v}`).toBe(false);
    }
  });

  it('jeder im Client fest genannte Schlüssel existiert', () => {
    const missing = new Set<string>();
    for (const file of clientFiles()) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/\bt\('([a-zA-Z0-9.-]+)'/g)) if (!de[m[1]]) missing.add(m[1]);
      for (const m of src.matchAll(/data-i18n(?:-title)?="([a-zA-Z0-9.-]+)"/g)) if (!de[m[1]]) missing.add(m[1]);
    }
    expect([...missing]).toEqual([]);
  });

  it('alle Einheiten und Gebäude haben Namen', () => {
    for (const f of FACTIONS) {
      for (const d of [...rules.unitsOf(f), ...rules.buildingsOf(f)]) {
        expect(de[d.nameKey], d.nameKey).toBeTruthy();
        expect(en[d.nameKey], d.nameKey).toBeTruthy();
      }
    }
  });
});
