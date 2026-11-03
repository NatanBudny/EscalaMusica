// Testes unitarios da conciliacao offline (tarefa 11.5).
//
// Requisitos: 1.10, 12.3, 13.13-13.16.

import { describe, it, expect } from 'vitest';
import {
  applyChoices,
  conflictId,
  planSync,
  reconcile,
  type FieldChange,
  type QueuedOperation,
} from './reconcile';

function op(partial: Partial<QueuedOperation> & { operationId: string; baseCommit: string }): QueuedOperation {
  return {
    operationId: partial.operationId,
    baseCommit: partial.baseCommit,
    command: partial.command ?? 'editar',
    resultHash: partial.resultHash ?? 'h',
    at: partial.at ?? '2026-02-20T10:00:00Z',
  };
}

describe('planSync (1.10, 12.3)', () => {
  it('nada a sincronizar com fila vazia', () => {
    expect(planSync([], 'A').action).toBe('nothing-to-sync');
  });

  it('reaplica e envia quando o head remoto nao mudou', () => {
    const plan = planSync([op({ operationId: 'o1', baseCommit: 'A' })], 'A');
    expect(plan.action).toBe('replay-and-push');
  });

  it('exige conciliacao quando o head remoto mudou', () => {
    const plan = planSync([op({ operationId: 'o1', baseCommit: 'A' })], 'B');
    expect(plan.action).toBe('reconcile');
  });
});

describe('reconcile (13.15)', () => {
  it('combina automaticamente mudancas em campos distintos', () => {
    const local: FieldChange[] = [{ entityId: 'e1', field: 'nome', change: 'set', value: 'Ana' }];
    const remote: FieldChange[] = [{ entityId: 'e2', field: 'telefone', change: 'set', value: '+55...' }];
    const r = reconcile({ local, remote });
    expect(r.requiresOperatorChoice).toBe(false);
    expect(r.autoMerged).toHaveLength(2);
    expect(r.conflicts).toHaveLength(0);
  });

  it('conflito no mesmo campo exige escolha', () => {
    const local: FieldChange[] = [{ entityId: 'e1', field: 'nome', change: 'set', value: 'Ana' }];
    const remote: FieldChange[] = [{ entityId: 'e1', field: 'nome', change: 'set', value: 'Bruno' }];
    const r = reconcile({ local, remote });
    expect(r.requiresOperatorChoice).toBe(true);
    expect(r.conflicts[0]!.type).toBe('same-field');
  });

  it('mudanca identica dos dois lados converge sem conflito', () => {
    const same: FieldChange[] = [{ entityId: 'e1', field: 'nome', change: 'set', value: 'Ana' }];
    const r = reconcile({ local: same, remote: [...same] });
    expect(r.requiresOperatorChoice).toBe(false);
    expect(r.autoMerged).toHaveLength(1);
  });

  it('exclusao vs. alteracao e conflito', () => {
    const local: FieldChange[] = [{ entityId: 'e1', field: 'nome', change: 'delete' }];
    const remote: FieldChange[] = [{ entityId: 'e1', field: 'nome', change: 'set', value: 'X' }];
    const r = reconcile({ local, remote });
    expect(r.conflicts[0]!.type).toBe('delete-vs-modify');
  });

  it('categorias especiais divergentes (aprovacao/publicacao/regras) exigem escolha', () => {
    const r = reconcile({
      local: [],
      remote: [],
      localSpecial: [{ kind: 'approval', ref: 'ap-local' }, { kind: 'ruleset-version', ref: 'v1' }],
      remoteSpecial: [{ kind: 'approval', ref: 'ap-remote' }, { kind: 'ruleset-version', ref: 'v1' }],
    });
    // approval diverge (conflito); ruleset-version igual (sem conflito).
    expect(r.conflicts.some((c) => c.type === 'special' && c.kind === 'approval')).toBe(true);
    expect(r.conflicts.some((c) => c.type === 'special' && c.kind === 'ruleset-version')).toBe(false);
  });
});

describe('applyChoices (13.15)', () => {
  it('aplica as escolhas e lanca se faltar escolha', () => {
    const local: FieldChange[] = [{ entityId: 'e1', field: 'nome', change: 'set', value: 'Ana' }];
    const remote: FieldChange[] = [{ entityId: 'e1', field: 'nome', change: 'set', value: 'Bruno' }];
    const r = reconcile({ local, remote });
    const id = conflictId(r.conflicts[0]!);

    // Sem escolha -> lanca (nunca resolve automaticamente).
    expect(() => applyChoices(r, new Map())).toThrow();

    // Escolha explicita pelo remoto.
    const out = applyChoices(r, new Map([[id, 'remote']]));
    expect(out).toHaveLength(1);
    expect((out[0] as FieldChange).value).toBe('Bruno');
  });
});
