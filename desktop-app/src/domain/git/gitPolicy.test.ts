// Testes unitarios da politica Git (tarefa 11.4).
//
// Requisitos: 1.2, 10.4, 10.18, 10.20, 13.13-13.16.

import { describe, it, expect } from 'vitest';
import type { GitDestination } from '../config/model';
import { assertNoForce, checkDestination, commitMessage, decidePush } from './gitPolicy';

const APPROVED: GitDestination = { remoteUrl: 'https://github.com/org/privado.git', branch: 'operacional' };

describe('checkDestination (10.4, 10.20)', () => {
  it('aceita o destino aprovado (ignora .git e barra final)', () => {
    expect(checkDestination({ remoteUrl: 'https://github.com/org/privado', branch: 'operacional' }, APPROVED).ok).toBe(true);
  });

  it('bloqueia repositorio diferente', () => {
    const r = checkDestination({ remoteUrl: 'https://github.com/org/outro.git', branch: 'operacional' }, APPROVED);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('repository-not-approved');
  });

  it('bloqueia branch diferente', () => {
    const r = checkDestination({ remoteUrl: 'https://github.com/org/privado.git', branch: 'main' }, APPROVED);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('branch-not-approved');
  });
});

describe('decidePush (13.15, Property 44)', () => {
  it('faz push fast-forward quando o remoto esta no baseCommit', () => {
    const d = decidePush({ baseCommit: 'A', localCommit: 'B', remoteHead: 'A' });
    expect(d.action).toBe('push');
  });

  it('nao faz nada quando o remoto ja esta no commit local', () => {
    const d = decidePush({ baseCommit: 'A', localCommit: 'B', remoteHead: 'B' });
    expect(d.action).toBe('up-to-date');
  });

  it('bloqueia (non-fast-forward) quando o remoto divergiu', () => {
    const d = decidePush({ baseCommit: 'A', localCommit: 'B', remoteHead: 'C' });
    expect(d.action).toBe('block-diverged');
  });
});

describe('commitMessage e assertNoForce (13.14)', () => {
  it('inclui o operationId na mensagem', () => {
    const msg = commitMessage({ summary: 'troca de regente', operationId: 'op-1' });
    expect(msg).toContain('operationId: op-1');
  });

  it('rejeita flags de force', () => {
    expect(assertNoForce(['push', 'origin', 'operacional'])).toBe(true);
    expect(assertNoForce(['push', '--force'])).toBe(false);
    expect(assertNoForce(['push', '--force-with-lease'])).toBe(false);
  });
});
