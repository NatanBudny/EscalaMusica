// Testes unitarios do journal, recuperacao e desfazer (tarefa 11.1).
//
// Validacao objetiva: falhas injetadas em cada marco nao promovem staging
// parcial; reinicio recupera o ultimo estado confirmado; desfazer restaura o
// hash anterior.
//
// Requisitos: 12.1-12.3, 12.11, 13.16.

import { describe, it, expect } from 'vitest';
import {
  advance,
  isCommitted,
  latestSnapshot,
  makeSnapshot,
  milestoneRank,
  recover,
  undo,
  type JournalEntry,
  type Snapshot,
} from './journal';

const AT = '2026-02-20T10:00:00Z';

function entry(partial: Partial<JournalEntry> & { operationId: string; milestone: JournalEntry['milestone'] }): JournalEntry {
  return {
    operationId: partial.operationId,
    milestone: partial.milestone,
    resultHash: partial.resultHash ?? 'h-' + partial.operationId + '-' + partial.milestone,
    parentHash: partial.parentHash ?? 'p-' + partial.operationId,
    at: partial.at ?? AT,
  };
}

describe('maquina de estados do journal (12.1)', () => {
  it('ordena os marcos prepared < files-written < committed < pushed', () => {
    expect(milestoneRank('prepared')).toBe(0);
    expect(milestoneRank('files-written')).toBe(1);
    expect(milestoneRank('committed')).toBe(2);
    expect(milestoneRank('pushed')).toBe(3);
  });

  it('considera committed e pushed como confirmados; prepared/files-written nao', () => {
    expect(isCommitted('prepared')).toBe(false);
    expect(isCommitted('files-written')).toBe(false);
    expect(isCommitted('committed')).toBe(true);
    expect(isCommitted('pushed')).toBe(true);
  });

  it('exige primeiro marco = prepared', () => {
    const r = advance(undefined, entry({ operationId: 'op1', milestone: 'committed' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('non-sequential');
  });

  it('avanca sequencialmente e recusa pulos de marco', () => {
    const p = entry({ operationId: 'op1', milestone: 'prepared' });
    const ok = advance(p, entry({ operationId: 'op1', milestone: 'files-written' }));
    expect(ok.ok).toBe(true);
    const skip = advance(p, entry({ operationId: 'op1', milestone: 'committed' }));
    expect(skip.ok).toBe(false);
  });

  it('recusa troca de operationId no meio do avanco', () => {
    const p = entry({ operationId: 'op1', milestone: 'prepared' });
    const r = advance(p, entry({ operationId: 'op2', milestone: 'files-written' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('operation-mismatch');
  });
});

describe('recuperacao de crash (12.3, 12.11)', () => {
  it('descarta staging parcial (prepared/files-written nao confirmados)', () => {
    const journal: JournalEntry[] = [
      entry({ operationId: 'op1', milestone: 'prepared' }),
      entry({ operationId: 'op1', milestone: 'files-written' }),
      entry({ operationId: 'op1', milestone: 'committed' }),
      // op2 interrompida no meio: nunca confirmada.
      entry({ operationId: 'op2', milestone: 'prepared' }),
      entry({ operationId: 'op2', milestone: 'files-written' }),
    ];
    const snap1: Snapshot<string> = { hash: 'h1', content: 'v1', operationId: 'op1', at: AT };
    const decision = recover(journal, [snap1]);
    expect(decision.discardOperationIds).toEqual(['op2']);
    expect(decision.recoverTo).toBe(snap1);
  });

  it('recupera para o ultimo snapshot confirmado da cadeia', () => {
    const s1: Snapshot<string> = { hash: 'h1', content: 'v1', operationId: 'op1', at: AT };
    const s2: Snapshot<string> = { hash: 'h2', parentHash: 'h1', content: 'v2', operationId: 'op2', at: AT };
    const s3: Snapshot<string> = { hash: 'h3', parentHash: 'h2', content: 'v3', operationId: 'op3', at: AT };
    expect(latestSnapshot([s1, s3, s2])).toBe(s3);
  });

  it('sem snapshots confirmados, nao ha para onde recuperar', () => {
    const decision = recover([entry({ operationId: 'op1', milestone: 'prepared' })], []);
    expect(decision.recoverTo).toBeUndefined();
    expect(decision.discardOperationIds).toEqual(['op1']);
  });
});

describe('desfazer (12.2)', () => {
  it('restaura exatamente o snapshot pai', () => {
    const parent = makeSnapshot({ content: { v: 1 }, operationId: 'op1', at: AT });
    const current = makeSnapshot({ content: { v: 2 }, parent, operationId: 'op2', at: AT });
    const r = undo(current, [parent, current]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.restored).toBe(parent);
    expect(r.restored.hash).toBe(current.parentHash);
  });

  it('recusa undo quando nao ha pai', () => {
    const only = makeSnapshot({ content: { v: 1 }, operationId: 'op1', at: AT });
    const r = undo(only, [only]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('no-parent');
  });

  it('recusa undo de operacao nao elegivel (ex.: publicada)', () => {
    const parent = makeSnapshot({ content: { v: 1 }, operationId: 'op1', at: AT });
    const current = makeSnapshot({ content: { v: 2 }, parent, operationId: 'op2', at: AT });
    const r = undo(current, [parent, current], () => false);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('not-eligible');
  });

  it('o hash do snapshot e o hash canonico do conteudo (independe da ordem das chaves)', () => {
    const a = makeSnapshot({ content: { x: 1, y: 2 }, operationId: 'op1', at: AT });
    const b = makeSnapshot({ content: { y: 2, x: 1 }, operationId: 'op1', at: AT });
    expect(a.hash).toBe(b.hash);
  });
});
