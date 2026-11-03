// Testes unitarios do PublicationOrchestrator (tarefa 12).
//
// Requisitos: 10.2-10.23, 12.4-12.7.

import { describe, it, expect } from 'vitest';
import {
  advanceSaga,
  applyConfirmationEffects,
  applyPackage,
  markIncomplete,
  packageHash,
  planRollback,
  startPublication,
  verifyPublicSite,
  type ConfirmationEffects,
  type PublicationPackage,
  type PublicTree,
} from './publicationOrchestrator';

const PKG: PublicationPackage = {
  packageId: 'pkg-1',
  period: '2026-02',
  files: [
    { path: 'atual.json', content: '[{"DATA":"01/02/2026"}]' },
    { path: 'contatos.json', content: '{"ANA":{"telefone":"https://wa.me/55","apelidos":[]}}' },
  ],
  removals: ['velho.json'],
};

describe('applyPackage (Property 35 / 10.2, 10.5, 10.19)', () => {
  it('produz diff exato (added/changed/removed) e nova arvore', () => {
    const initial: PublicTree = { 'velho.json': 'x', 'atual.json': '[]' };
    const r = applyPackage(initial, PKG, '2026-02');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.diff.added).toEqual(['contatos.json']);
    expect(r.diff.changed).toEqual(['atual.json']);
    expect(r.diff.removed).toEqual(['velho.json']);
    expect(r.tree['velho.json']).toBeUndefined();
    expect(r.tree['atual.json']).toBe(PKG.files[0]!.content);
  });

  it('rejeita destino divergente sem mutar a arvore', () => {
    const initial: PublicTree = { a: '1' };
    const r = applyPackage(initial, PKG, '2099-12');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('destination-divergent');
    expect(initial).toEqual({ a: '1' });
  });

  it('packageHash e estavel e independe da ordem de arquivos', () => {
    const a = packageHash(PKG);
    const reordered: PublicationPackage = { ...PKG, files: [...PKG.files].reverse() };
    expect(packageHash(reordered)).toBe(a);
  });
});

describe('verifyPublicSite (Property 36 / 10.12-10.14, 10.22)', () => {
  it('confirma com igualdade integral', () => {
    const observed = {
      'atual.json': PKG.files[0]!.content,
      'contatos.json': PKG.files[1]!.content,
    };
    expect(verifyPublicSite(PKG, observed).ok).toBe(true);
  });

  it('nao confirma se o site nao foi consultado', () => {
    const r = verifyPublicSite(PKG, undefined);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('not-consulted');
  });

  it('nao confirma com arquivo ausente', () => {
    const observed = { 'atual.json': PKG.files[0]!.content };
    const r = verifyPublicSite(PKG, observed);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('missing-file');
  });

  it('nao confirma com conteudo divergente', () => {
    const observed = {
      'atual.json': 'ALTERADO',
      'contatos.json': PKG.files[1]!.content,
    };
    const r = verifyPublicSite(PKG, observed);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('content-mismatch');
  });

  it('nao confirma se um removido ainda esta presente', () => {
    const observed = {
      'atual.json': PKG.files[0]!.content,
      'contatos.json': PKG.files[1]!.content,
      'velho.json': 'ainda aqui',
    };
    const r = verifyPublicSite(PKG, observed);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('removed-still-present');
  });
});

describe('saga de publicacao', () => {
  const ctx = { publicationId: 'pub-1', packageId: 'pkg-1', period: '2026-02', at: '2026-02-20T10:00:00Z' };

  it('avanca sequencialmente ate confirmado', () => {
    let rec = startPublication(ctx);
    for (const s of ['private-synced', 'backed-up', 'pushed', 'pages-processing', 'confirmed'] as const) {
      const r = advanceSaga(rec, s, ctx.at);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      rec = r.record;
    }
    expect(rec.state).toBe('confirmed');
    expect(rec.confirmedAt).toBe(ctx.at);
  });

  it('recusa pulo de estado', () => {
    const rec = startPublication(ctx);
    const r = advanceSaga(rec, 'pushed', ctx.at);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('non-sequential');
  });

  it('reaplicar o mesmo estado e idempotente', () => {
    const rec = startPublication(ctx);
    const r = advanceSaga(rec, 'prepared', ctx.at);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.record.state).toBe('prepared');
  });

  it('markIncomplete preserva as tentativas', () => {
    let rec = startPublication(ctx);
    const adv = advanceSaga(rec, 'private-synced', ctx.at);
    if (adv.ok) rec = adv.record;
    const inc = markIncomplete(rec, 'incomplete', ctx.at, 'push falhou');
    expect(inc.state).toBe('incomplete');
    expect(inc.attempts.length).toBeGreaterThan(rec.attempts.length);
  });
});

describe('efeitos de confirmacao idempotentes (Property 37)', () => {
  it('reprocessar o mesmo packageId nao duplica efeitos', () => {
    const base: ConfirmationEffects = { confirmedPackageIds: [], rotationContributions: {} };
    const first = applyConfirmationEffects(base, 'pkg-1', { ana: 2, bruno: 1 });
    const second = applyConfirmationEffects(first, 'pkg-1', { ana: 2, bruno: 1 });
    expect(second).toBe(first); // no-op idempotente
    expect(second.confirmedPackageIds).toEqual(['pkg-1']);
    expect(second.rotationContributions).toEqual({ ana: 2, bruno: 1 });
  });
});

describe('planRollback', () => {
  it('restaura a arvore anterior por commit compensatorio', () => {
    const previous = { 'atual.json': 'anterior' };
    const plan = planRollback(previous);
    expect(plan.compensatory).toBe(true);
    expect(plan.restoreTree).toEqual(previous);
  });
});
