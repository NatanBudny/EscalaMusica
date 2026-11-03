import { describe, expect, it } from 'vitest';

import { canonicalBytes, canonicalHash } from './canonical';
import { InMemorySnapshotStore, stagedWrite, type Snapshot } from './staging';
import { validFixtures } from './fixtures';

const decoder = new TextDecoder();
const asString = (bytes: Uint8Array): string => decoder.decode(bytes);

function snapshotOf(value: unknown): Snapshot {
  return { bytes: canonicalBytes(value), revision: canonicalHash(value) };
}

describe('stagedWrite', () => {
  it('efetiva o novo snapshot quando a validacao passa (Req 12.1)', () => {
    const store = new InMemorySnapshotStore(snapshotOf({ v: 1 }));
    const result = stagedWrite(store, { v: 2 }, { validate: () => ({ valid: true, issues: [] }) });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.revision).toBe(canonicalHash({ v: 2 }));
    }
    expect(store.revision).toBe(canonicalHash({ v: 2 }));
    expect(asString(store.readStage()!.bytes)).toBe(asString(canonicalBytes({ v: 2 })));
  });

  it('cria o primeiro snapshot quando nao havia nenhum', () => {
    const store = new InMemorySnapshotStore(null);
    const result = stagedWrite(store, { novo: true });
    expect(result.ok).toBe(true);
    expect(store.revision).toBe(canonicalHash({ novo: true }));
  });

  it('nao troca e preserva o snapshot anterior quando a validacao reprova (Req 12.11)', () => {
    const previous = snapshotOf({ v: 1 });
    const store = new InMemorySnapshotStore(previous);
    const result = stagedWrite(
      store,
      { v: 999 },
      { validate: () => ({ valid: false, issues: [{ message: 'invariante violado' }] }) },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('validation');
      expect(result.preservedRevision).toBe(previous.revision);
      expect(result.message).toContain('invariante violado');
    }
    // Snapshot anterior intacto.
    expect(store.revision).toBe(previous.revision);
    expect(asString(store.readStage()!.bytes)).toBe(asString(previous.bytes));
  });

  it('preserva o snapshot quando uma falha e injetada antes da troca (Req 12.11)', () => {
    const previous = snapshotOf({ v: 1 });
    const store = new InMemorySnapshotStore(previous);
    const result = stagedWrite(
      store,
      { v: 2 },
      {
        validate: () => ({ valid: true, issues: [] }),
        beforeCommit: () => {
          throw new Error('falha injetada antes da troca');
        },
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('commit');
      expect(result.preservedRevision).toBe(previous.revision);
    }
    // A troca nunca aconteceu.
    expect(store.revision).toBe(previous.revision);
    expect(asString(store.readStage()!.bytes)).toBe(asString(previous.bytes));
  });

  it('preserva o snapshot quando o commit do store falha (troca atomica)', () => {
    const previous = snapshotOf({ v: 1 });
    const store = new InMemorySnapshotStore(previous);
    store.failNextCommit('disco cheio');

    const result = stagedWrite(store, { v: 2 }, { validate: () => ({ valid: true, issues: [] }) });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('commit');
      expect(result.preservedRevision).toBe(previous.revision);
      expect(result.message).toContain('disco cheio');
    }
    expect(store.revision).toBe(previous.revision);
  });

  it('reporta falha de staging para valores nao serializaveis sem alterar o estado', () => {
    const previous = snapshotOf({ v: 1 });
    const store = new InMemorySnapshotStore(previous);
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const result = stagedWrite(store, circular);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('staging');
      expect(result.preservedRevision).toBe(previous.revision);
    }
    expect(store.revision).toBe(previous.revision);
  });

  it('a revisao efetivada equivale ao hash canonico do valor (entidade real)', () => {
    const store = new InMemorySnapshotStore(null);
    const result = stagedWrite(store, validFixtures.monthlyCycle, {
      validate: () => ({ valid: true, issues: [] }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.revision).toBe(canonicalHash(validFixtures.monthlyCycle));
    }
  });

  it('a revisao independe da ordem das chaves do candidato', () => {
    const storeA = new InMemorySnapshotStore(null);
    const storeB = new InMemorySnapshotStore(null);
    const resA = stagedWrite(storeA, { a: 1, b: 2 });
    const resB = stagedWrite(storeB, { b: 2, a: 1 });
    expect(resA.ok && resB.ok && resA.revision === resB.revision).toBe(true);
  });
});
