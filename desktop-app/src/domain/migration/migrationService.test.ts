// Testes unitarios e golden da migracao e homologacao (tarefas 14.1-14.4, 14.6).
//
// Requisitos: 9.4-9.7, 9.13, 9.14, 16.5-16.12.

import { describe, it, expect } from 'vitest';
import { createBackup } from '../backup/backupService';
import {
  compareForHomologation,
  evaluateHomologationGate,
  normalizePhone,
  rehearseRestore,
  runMigration,
  type MigrationSource,
} from './migrationService';

// --------------------------------------------------------------------------
// 14.1 — importacao e classificacao
// --------------------------------------------------------------------------

describe('runMigration (14.1 / 9.4-9.7, 9.14)', () => {
  it('nunca resolve identidade ambigua (0 ou varias -> pending)', () => {
    const sources: MigrationSource[] = [
      { sourceFile: 'pessoas.json', sourcePosition: '[0]', sourceIdentity: 'Andre', identityMatches: 1 },
      { sourceFile: 'pessoas.json', sourcePosition: '[1]', sourceIdentity: 'Fulano', identityMatches: 0 },
      { sourceFile: 'pessoas.json', sourcePosition: '[2]', sourceIdentity: 'Ana', identityMatches: 2 },
    ];
    const r = runMigration(sources);
    expect(r.items[0]!.classification).toBe('imported');
    expect(r.items[1]!.classification).toBe('pending');
    expect(r.items[2]!.classification).toBe('pending');
    expect(r.totals.pending).toBe(2);
  });

  it('normaliza telefone ou marca pendente', () => {
    const sources: MigrationSource[] = [
      { sourceFile: 'contatos.json', sourcePosition: 'ANA', sourceIdentity: 'Ana', identityMatches: 1, rawPhone: '(43) 99999-8888' },
      { sourceFile: 'contatos.json', sourcePosition: 'BOB', sourceIdentity: 'Bob', identityMatches: 1, rawPhone: '123' },
    ];
    const r = runMigration(sources);
    expect(r.items[0]!.classification).toBe('transformed');
    expect(r.items[0]!.normalizedPhone).toBe('+5543999998888');
    expect(r.items[1]!.classification).toBe('pending');
  });

  it('o lote com pendencias continua gravavel apenas quando nao ha rejeitados', () => {
    const r = runMigration([
      { sourceFile: 'x', sourcePosition: '0', sourceIdentity: 'A', identityMatches: 1 },
    ]);
    expect(r.committable).toBe(true);
  });
});

describe('normalizePhone', () => {
  it('reconhece formatos BR comuns', () => {
    expect(normalizePhone('43999998888')).toBe('+5543999998888');
    expect(normalizePhone('+55 43 99999-8888')).toBe('+5543999998888');
    expect(normalizePhone('abc')).toBeUndefined();
  });
});

// --------------------------------------------------------------------------
// 14.2 — comparacao campo a campo
// --------------------------------------------------------------------------

describe('compareForHomologation (14.2 / 16.7-16.9)', () => {
  it('equivalencia semantica ignora ordem de chaves', () => {
    const cand = { 's1.tema': { a: 1, b: 2 } };
    const view = { 's1.tema': { b: 2, a: 1 } };
    const r = compareForHomologation(cand, view);
    expect(r.equivalent).toBe(true);
    expect(r.divergenceCount).toBe(0);
  });

  it('detecta divergencia, ausencia e excesso', () => {
    const cand = { a: '1', c: 'extra' };
    const view = { a: '2', b: 'faltou' };
    const r = compareForHomologation(cand, view);
    expect(r.divergenceCount).toBe(3);
    expect(r.comparisons.find((c) => c.key === 'a')!.result).toBe('divergent');
    expect(r.comparisons.find((c) => c.key === 'b')!.result).toBe('missing-in-candidate');
    expect(r.comparisons.find((c) => c.key === 'c')!.result).toBe('extra-in-candidate');
  });
});

// --------------------------------------------------------------------------
// 14.3 — ensaio de restauracao
// --------------------------------------------------------------------------

describe('rehearseRestore (14.3 / 16.10-16.12)', () => {
  const priv = createBackup({ id: 'p', period: '2026-02', sourceVersion: 'v1', createdAt: '2026-02-20T10:00:00Z', operatorId: 'op', categories: ['registry'], officialPublication: false, files: [{ path: 'a.json', content: '1' }] });
  const pub = createBackup({ id: 'pub', period: '2026-02', sourceVersion: 'v1', createdAt: '2026-02-20T10:00:00Z', operatorId: 'op', categories: ['public'], officialPublication: true, files: [{ path: 'atual.json', content: '[]' }] });

  it('verifica quando ambos os backups estao integros', () => {
    expect(rehearseRestore({ privateBackup: priv, publicBackup: pub }).verified).toBe(true);
  });

  it('falha quando um backup esta corrompido', () => {
    const corrupted = { ...priv, files: [{ path: 'a.json', content: 'ALTERADO' }] };
    const r = rehearseRestore({ privateBackup: corrupted, publicBackup: pub });
    expect(r.verified).toBe(false);
    expect(r.issues.length).toBeGreaterThan(0);
  });
});

// --------------------------------------------------------------------------
// 14.4 — gate de homologacao (golden do fluxo completo)
// --------------------------------------------------------------------------

describe('evaluateHomologationGate (14.4 / Property 47)', () => {
  const okMigration = runMigration([{ sourceFile: 'x', sourcePosition: '0', sourceIdentity: 'A', identityMatches: 1 }]);
  const okComparison = compareForHomologation({ a: '1' }, { a: '1' });
  const okRestore = { verified: true, issues: [] };

  it('permite somente quando tudo esta limpo', () => {
    const g = evaluateHomologationGate({ migration: okMigration, comparison: okComparison, restore: okRestore });
    expect(g.allowed).toBe(true);
    expect(g.reasons).toEqual([]);
  });

  it('bloqueia com pendencias de migracao', () => {
    const withPending = runMigration([{ sourceFile: 'x', sourcePosition: '0', sourceIdentity: 'A', identityMatches: 0 }]);
    const g = evaluateHomologationGate({ migration: withPending, comparison: okComparison, restore: okRestore });
    expect(g.allowed).toBe(false);
  });

  it('bloqueia com divergencia na comparacao', () => {
    const div = compareForHomologation({ a: '1' }, { a: '2' });
    const g = evaluateHomologationGate({ migration: okMigration, comparison: div, restore: okRestore });
    expect(g.allowed).toBe(false);
  });

  it('bloqueia quando a restauracao nao foi verificada', () => {
    const g = evaluateHomologationGate({ migration: okMigration, comparison: okComparison, restore: { verified: false, issues: ['x'] } });
    expect(g.allowed).toBe(false);
  });
});

// --------------------------------------------------------------------------
// 14.6 — golden da migracao real (aliases, depto, formatos, divergencias)
// --------------------------------------------------------------------------

describe('golden: migracao real identifica cada transformacao/pendencia (14.6)', () => {
  it('reproduz o relatorio esperado para um lote representativo', () => {
    const sources: MigrationSource[] = [
      // Alias conflitante (varias correspondencias) -> pendente.
      { sourceFile: 'indisponibilidade.json', sourcePosition: '[3]', sourceIdentity: 'Andre', identityMatches: 2 },
      // Departamento separado, importado.
      { sourceFile: 'acionato.json', sourcePosition: '[0]', sourceIdentity: 'Sonoplastia', identityMatches: 1, isDepartment: true },
      // Telefone normalizavel -> transformado.
      { sourceFile: 'contatos.json', sourcePosition: 'LUIZ', sourceIdentity: 'Luiz Antonio', identityMatches: 1, rawPhone: '4399999-0001' },
      // Telefone ilegivel -> pendente.
      { sourceFile: 'contatos.json', sourcePosition: 'XY', sourceIdentity: 'XY', identityMatches: 1, rawPhone: 'sem numero' },
    ];
    const r = runMigration(sources);
    expect(r.items.map((i) => i.classification)).toEqual(['pending', 'imported', 'transformed', 'pending']);
    expect(r.totals).toEqual({ imported: 1, transformed: 1, rejected: 0, pending: 2 });
    // Particao completa: soma das classificacoes == total de itens.
    const soma = Object.values(r.totals).reduce((s, n) => s + n, 0);
    expect(soma).toBe(sources.length);
  });
});
