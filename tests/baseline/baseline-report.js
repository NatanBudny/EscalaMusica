/**
 * Baseline report builder.
 *
 * Produces a canonical, deterministic summary of the public contract observed
 * in the legacy artifacts (atual.json / contatos.json). The report is written
 * to a versioned location inside the repository (tests/) and is NEVER part of
 * the published Artefato_Estatico. It exists so a future scaffold can be proven
 * equivalent to the pre-scaffold baseline.
 *
 * Spec: gestao-leiga-de-escalas / Task 1.2
 * Requirements: 16.1, 16.8
 */

import { createHash } from 'node:crypto';

export const BASELINE_REPORT_VERSION = '1.0.0';

/** SHA-256 of a UTF-8 string, hex-encoded. */
export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Stable JSON.stringify with sorted object keys (arrays keep their order). */
export function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Builds the baseline report object from parsed artifacts.
 * Deterministic: same inputs → byte-identical canonical form.
 */
export function buildBaselineReport({ atual, contatos }) {
  const scheduleKeys = atual.length
    ? [...new Set(atual.flatMap((r) => Object.keys(r)))].sort()
    : [];

  const weekdays = [...new Set(atual.map((r) => r['DIA SEMANA']).filter(Boolean))].sort();

  const contactNames = Object.keys(contatos).sort();
  const aliasCount = contactNames.reduce(
    (acc, n) => acc + (contatos[n].apelidos ? contatos[n].apelidos.length : 0),
    0,
  );

  return {
    reportVersion: BASELINE_REPORT_VERSION,
    artifact: {
      atual: {
        recordCount: atual.length,
        scheduleKeys,
        weekdays,
        contentHash: sha256(canonicalJson(atual)),
      },
      contatos: {
        entryCount: contactNames.length,
        aliasCount,
        contentHash: sha256(canonicalJson(contatos)),
      },
    },
  };
}
