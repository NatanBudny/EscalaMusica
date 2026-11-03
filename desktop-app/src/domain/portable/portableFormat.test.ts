// Testes unitarios dos formatos portaveis e round-trip (tarefa 9.3).
//
// Validacao objetiva: exportar/importar/exportar sem edicao preserva entidades
// e bytes, salvo os metadados de geracao declarados como variaveis
// (`metadata.generatedAt`, `metadata.exporterVersion`). Entradas invalidas sao
// rejeitadas sem reconstruir entidades (tudo-ou-nada), relatando caminho e
// motivo.
//
// Requisitos: 9.9, 9.10, 16.4 (e 9.5-9.7 para a atomicidade da importacao).

import { describe, it, expect } from 'vitest';
import { validFixtures, validEntitySet } from '../schemas/fixtures';
import {
  PORTABLE_FORMAT_VERSION,
  PORTABLE_KIND,
  VARIABLE_METADATA_KEYS,
  exportPortable,
  importPortable,
  portableStringify,
  roundTrip,
  type PortableEntities,
} from './portableFormat';

// Conjunto coerente que cobre TODAS as categorias documentadas (o
// validEntitySet ja passa na integridade referencial; acrescentamos auditoria).
function fullEntities(): PortableEntities {
  return {
    people: validEntitySet.people ?? [],
    departments: validEntitySet.departments ?? [],
    publicAuthorizations: validEntitySet.publicAuthorizations ?? [],
    ruleSets: validEntitySet.ruleSets ?? [],
    exceptions: validEntitySet.exceptions ?? [],
    cycles: validEntitySet.cycles ?? [],
    services: validEntitySet.services ?? [],
    drafts: validEntitySet.drafts ?? [],
    externalInputs: validEntitySet.externalInputs ?? [],
    unavailabilities: validEntitySet.unavailabilities ?? [],
    auditEvents: [validFixtures.auditEvent],
  };
}

describe('exportPortable', () => {
  it('produz um documento versionado com envelope e todas as categorias', () => {
    const art = exportPortable(fullEntities(), {
      generatedAt: '2026-01-15T12:00:00Z',
      exporterVersion: '1.0.0',
    });
    expect(art.document.kind).toBe(PORTABLE_KIND);
    expect(art.document.formatVersion).toBe(PORTABLE_FORMAT_VERSION);
    expect(art.document.payload.registry.people.length).toBe(2);
    expect(art.document.payload.rules.ruleSets.length).toBe(1);
    expect(art.document.payload.cycles.services.length).toBe(1);
    expect(art.document.payload.schedules.drafts.length).toBe(1);
    expect(art.document.payload.inputs.externalInputs.length).toBe(1);
    expect(art.document.payload.audit.auditEvents.length).toBe(1);
    expect(art.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(art.stableSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('preenche categorias ausentes com arrays vazios', () => {
    const art = exportPortable({ people: [validFixtures.person] });
    expect(art.document.payload.registry.departments).toEqual([]);
    expect(art.document.payload.audit.auditEvents).toEqual([]);
  });

  it('e deterministico: mesmas entidades e metadados produzem os mesmos bytes', () => {
    const a = exportPortable(fullEntities(), { generatedAt: '2026-01-15T12:00:00Z' });
    const b = exportPortable(fullEntities(), { generatedAt: '2026-01-15T12:00:00Z' });
    expect(a.sha256).toBe(b.sha256);
    expect(Array.from(a.bytes)).toEqual(Array.from(b.bytes));
  });

  it('metadados variaveis mudam os bytes completos mas NAO os bytes estaveis', () => {
    const a = exportPortable(fullEntities(), { generatedAt: '2026-01-15T12:00:00Z' });
    const b = exportPortable(fullEntities(), { generatedAt: '2030-06-01T00:00:00Z' });
    // Documento completo difere (generatedAt mudou)...
    expect(a.sha256).not.toBe(b.sha256);
    // ...mas a projecao estavel e identica.
    expect(a.stableSha256).toBe(b.stableSha256);
  });

  it('portableStringify emite texto canonico sem CR', () => {
    const art = exportPortable(fullEntities());
    const text = portableStringify(art.document);
    expect(text.includes('\r')).toBe(false);
    expect(JSON.parse(text)).toMatchObject({ kind: PORTABLE_KIND });
  });
});

describe('importPortable', () => {
  it('reconstroi exatamente as entidades exportadas (9.9)', () => {
    const art = exportPortable(fullEntities(), { generatedAt: '2026-01-15T12:00:00Z' });
    const result = importPortable(art.document);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entities.people).toEqual(art.document.payload.registry.people);
    expect(result.entities.ruleSets).toEqual(art.document.payload.rules.ruleSets);
    expect(result.entities.auditEvents).toEqual(art.document.payload.audit.auditEvents);
    expect(result.metadata.generatedAt).toBe('2026-01-15T12:00:00Z');
  });

  it('aceita o documento recem-parseado de JSON (string -> objeto)', () => {
    const art = exportPortable(fullEntities());
    const parsed = JSON.parse(portableStringify(art.document));
    const result = importPortable(parsed);
    expect(result.ok).toBe(true);
  });

  it('rejeita entrada que nao e objeto', () => {
    for (const bad of [null, 42, 'x', [], true]) {
      const r = importPortable(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.issues[0]?.kind).toBe('not-an-object');
    }
  });

  it('rejeita kind desconhecido', () => {
    const art = exportPortable(fullEntities());
    const r = importPortable({ ...art.document, kind: 'outro' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.kind === 'unknown-kind')).toBe(true);
  });

  it('rejeita formatVersion desconhecida', () => {
    const art = exportPortable(fullEntities());
    const r = importPortable({ ...art.document, formatVersion: '9.9.9' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.kind === 'unknown-format-version')).toBe(true);
  });

  it('rejeita payload malformado (grupo ausente)', () => {
    const art = exportPortable(fullEntities());
    const broken = {
      ...art.document,
      payload: { ...art.document.payload, registry: undefined },
    };
    const r = importPortable(broken);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.kind === 'malformed-payload')).toBe(true);
  });

  it('e tudo-ou-nada: uma entidade invalida impede qualquer reconstrucao (9.6)', () => {
    const art = exportPortable(fullEntities());
    const badPerson = { ...(validFixtures.person as object), schemaVersion: '9.9.9' };
    const broken = {
      ...art.document,
      payload: {
        ...art.document.payload,
        registry: { ...art.document.payload.registry, people: [badPerson] },
      },
    };
    const r = importPortable(broken);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.kind === 'unknown-version')).toBe(true);
      // O caminho e remapeado para dentro do payload.
      expect(r.issues.some((i) => i.path.startsWith('/payload/registry/people/0'))).toBe(true);
    }
  });

  it('detecta referencia quebrada entre categorias (culto->ciclo inexistente)', () => {
    const entities: PortableEntities = {
      ...fullEntities(),
      services: [
        {
          ...(validFixtures.service as object),
          cycleId: '00000000-0000-4000-8000-000000000000',
        },
      ],
    };
    const art = exportPortable(entities);
    const r = importPortable(art.document);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.kind === 'broken-reference')).toBe(true);
      expect(r.issues.some((i) => i.path.startsWith('/payload/cycles/services/0'))).toBe(true);
    }
  });

  it('reporta auditoria invalida com caminho correto', () => {
    const entities: PortableEntities = {
      auditEvents: [{ ...(validFixtures.auditEvent as object), token: 'segredo' }],
    };
    const art = exportPortable(entities);
    const r = importPortable(art.document);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.path.startsWith('/payload/audit/auditEvents/0'))).toBe(true);
  });
});

describe('roundTrip (export -> import -> export)', () => {
  it('preserva entidades e bytes estaveis mesmo com metadados variaveis distintos (9.10, 16.4)', () => {
    const outcome = roundTrip(fullEntities(), { generatedAt: '2026-01-15T12:00:00Z' });
    expect(outcome.reimportOk).toBe(true);
    expect(outcome.stableBytesEqual).toBe(true);
    expect(outcome.preserved).toBe(true);
    expect(outcome.issues).toEqual([]);
  });

  it('falha de forma observavel quando o documento de entrada e invalido', () => {
    const outcome = roundTrip({
      services: [
        { ...(validFixtures.service as object), cycleId: '00000000-0000-4000-8000-000000000000' },
      ],
    });
    expect(outcome.reimportOk).toBe(false);
    expect(outcome.preserved).toBe(false);
    expect(outcome.issues.length).toBeGreaterThan(0);
  });

  it('o conjunto reimportado reexportado tem os mesmos bytes estaveis da 1a exportacao', () => {
    const first = exportPortable(fullEntities(), { generatedAt: '2026-01-15T12:00:00Z' });
    const imported = importPortable(first.document);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    const second = exportPortable(imported.entities, { generatedAt: '2040-01-01T00:00:00Z' });
    expect(second.stableSha256).toBe(first.stableSha256);
    expect(Array.from(second.stableBytes)).toEqual(Array.from(first.stableBytes));
  });
});

describe('contrato de metadados variaveis documentados', () => {
  it('declara exatamente generatedAt e exporterVersion como variaveis', () => {
    expect([...VARIABLE_METADATA_KEYS].sort()).toEqual(['exporterVersion', 'generatedAt']);
  });
});
