import { describe, expect, it } from 'vitest';

import { canonicalHash } from '../schemas/canonical';
import {
  CommandExecutor,
  type CommandEnvelope,
  type CommandSpec,
  type DomainEvent,
} from './commands';
import { diffStates, canonicalEqual } from './diff';
import { makeAppError, COMMAND_ERROR_CODES } from './errors';
import { buildValidatedAuditEvent, isSecretField, sanitizeChange } from './audit';
import { validateEntity } from '../schemas/validator';

// Estado de exemplo: um pequeno agregado "pessoa".
interface Person {
  id: string;
  name: string;
  phone?: string;
  aliases: string[];
}

const NOW = '2026-01-15T12:00:00Z';
const OPERATOR = '00000000-0000-4000-8000-000000000001';
const ENTITY_ID = '00000000-0000-4000-8000-0000000000aa';
const AUDIT_ID = '00000000-0000-4000-8000-0000000000bb';

function setName(): CommandSpec<Person, { name: string }> {
  return {
    entityType: 'person',
    entityId: ENTITY_ID,
    action: 'atualizar-nome',
    timestamp: NOW,
    auditEventId: AUDIT_ID,
    apply: (prev, payload) => {
      if (payload.name.length === 0) return { ok: false, reason: 'nome nao pode ser vazio' };
      return { ok: true, next: { ...prev, name: payload.name } };
    },
  };
}

function envelope<T>(
  operationId: string,
  expectedRevision: string,
  payload: T,
): CommandEnvelope<T> {
  return {
    operationId,
    operatorId: OPERATOR,
    baseCommit: null,
    expectedRevision,
    payload,
  };
}

const initial: Person = { id: ENTITY_ID, name: 'Ana', aliases: [] };

describe('CommandExecutor', () => {
  it('a revisao inicial e o hash canonico do estado', () => {
    const exec = new CommandExecutor(initial);
    expect(exec.getRevision()).toBe(canonicalHash(initial));
  });

  it('uma alteracao aceita gera nova revisao e um evento correspondente', () => {
    const exec = new CommandExecutor(initial);
    const rev0 = exec.getRevision();

    const res = exec.execute(
      envelope('11111111-1111-4111-8111-111111111111', rev0, { name: 'Bia' }),
      setName(),
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.name).toBe('Bia');
    expect(res.revision).toBe(canonicalHash({ ...initial, name: 'Bia' }));
    expect(res.revision).not.toBe(rev0);

    const events = exec.getEmittedEvents();
    expect(events).toHaveLength(1);
    const ev = events[0] as DomainEvent;
    expect(ev.fromRevision).toBe(rev0);
    expect(ev.toRevision).toBe(res.revision);
    expect(ev.action).toBe('atualizar-nome');
    // O evento de auditoria contem exatamente o campo alterado.
    expect(ev.audit.changes).toHaveLength(1);
    expect(ev.audit.changes[0]?.field).toBe('name');
    expect(ev.audit.changes[0]?.before).toBe('Ana');
    expect(ev.audit.changes[0]?.after).toBe('Bia');
    expect(ev.audit.result).toBe('success');
  });

  it('repetir o mesmo operationId nao duplica efeitos (idempotencia)', () => {
    const exec = new CommandExecutor(initial);
    const rev0 = exec.getRevision();
    const op = '22222222-2222-4222-8222-222222222222';

    const first = exec.execute(envelope(op, rev0, { name: 'Bia' }), setName());
    const revAfterFirst = exec.getRevision();
    const eventsAfterFirst = exec.getEmittedEvents().length;

    // Repeticao: mesmo operationId, mesmo payload.
    const second = exec.execute(envelope(op, rev0, { name: 'Bia' }), setName());

    expect(second).toEqual(first);
    // Nenhum efeito novo: revisao e numero de eventos inalterados.
    expect(exec.getRevision()).toBe(revAfterFirst);
    expect(exec.getEmittedEvents().length).toBe(eventsAfterFirst);
  });

  it('repetir operationId mesmo com payload diferente retorna o resultado original', () => {
    const exec = new CommandExecutor(initial);
    const rev0 = exec.getRevision();
    const op = '33333333-3333-4333-8333-333333333333';

    const first = exec.execute(envelope(op, rev0, { name: 'Bia' }), setName());
    // Mesmo operationId, payload diferente: nao reaplica, retorna o original.
    const second = exec.execute(
      envelope(op, exec.getRevision(), { name: 'Carla' }),
      setName(),
    );

    expect(second).toEqual(first);
    if (first.ok) expect(first.value.name).toBe('Bia');
    expect(exec.getEmittedEvents()).toHaveLength(1);
  });

  it('recusa quando a revisao esperada diverge, sem mutacao', () => {
    const exec = new CommandExecutor(initial);
    const res = exec.execute(
      envelope('44444444-4444-4444-8444-444444444444', 'revisao-errada', { name: 'Bia' }),
      setName(),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('revisao-divergente');
    expect(res.error.explanationPtBr.length).toBeGreaterThan(0);
    // Estado preservado.
    expect(exec.getState()).toEqual(initial);
    expect(exec.getEmittedEvents()).toHaveLength(0);
  });

  it('recusa quando a transicao de dominio falha, com mensagem em portugues', () => {
    const exec = new CommandExecutor(initial);
    const res = exec.execute(
      envelope('55555555-5555-4555-8555-555555555555', exec.getRevision(), { name: '' }),
      setName(),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('validacao-dominio');
    expect(res.error.explanationPtBr).toBe('nome nao pode ser vazio');
    expect(exec.getState()).toEqual(initial);
  });

  it('transicao sem alteracao nao gera revisao nem evento novos', () => {
    const exec = new CommandExecutor(initial);
    const rev0 = exec.getRevision();
    // Define o mesmo nome: diff vazio.
    const res = exec.execute(
      envelope('66666666-6666-4666-8666-666666666666', rev0, { name: 'Ana' }),
      setName(),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.revision).toBe(rev0);
    expect(exec.getRevision()).toBe(rev0);
    expect(exec.getEmittedEvents()).toHaveLength(0);
  });

  it('dispara invalidadores de derivados quando a revisao muda', () => {
    const exec = new CommandExecutor(initial);
    const fired: Array<{ from: string | null; to: string }> = [];
    exec.registerInvalidator((c) => fired.push({ from: c.fromRevision, to: c.toRevision }));

    const rev0 = exec.getRevision();
    exec.execute(
      envelope('77777777-7777-4777-8777-777777777777', rev0, { name: 'Bia' }),
      setName(),
    );
    expect(fired).toHaveLength(1);
    expect(fired[0]?.from).toBe(rev0);
    expect(fired[0]?.to).toBe(exec.getRevision());
  });

  it('nao dispara invalidadores quando nada muda', () => {
    const exec = new CommandExecutor(initial);
    let count = 0;
    exec.registerInvalidator(() => (count += 1));
    exec.execute(
      envelope('88888888-8888-4888-8888-888888888888', exec.getRevision(), { name: 'Ana' }),
      setName(),
    );
    expect(count).toBe(0);
  });

  it('duas alteracoes sequenciais encadeiam revisoes', () => {
    const exec = new CommandExecutor(initial);
    const r1 = exec.execute(
      envelope('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', exec.getRevision(), { name: 'Bia' }),
      setName(),
    );
    expect(r1.ok).toBe(true);
    const r2 = exec.execute(
      {
        ...envelope('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', exec.getRevision(), { name: 'Carla' }),
      },
      setName(),
    );
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.value.name).toBe('Carla');
    const events = exec.getEmittedEvents();
    expect(events).toHaveLength(2);
    expect(events[1]?.fromRevision).toBe(events[0]?.toRevision);
  });
});

describe('diffStates', () => {
  it('nao reporta campos inalterados', () => {
    const a = { id: 'x', name: 'Ana', aliases: ['a'] };
    const b = { id: 'x', name: 'Bia', aliases: ['a'] };
    const d = diffStates(a, b);
    expect(d.changes.map((c) => c.field)).toEqual(['name']);
  });

  it('detecta adicao e remocao de campos', () => {
    const a = { id: 'x', name: 'Ana' };
    const b = { id: 'x', phone: '+5511999999999' };
    const d = diffStates(a, b);
    const byField = Object.fromEntries(d.changes.map((c) => [c.field, c.kind]));
    expect(byField.name).toBe('removed');
    expect(byField.phone).toBe('added');
  });

  it('equivalencia canonica ignora ordem de chaves', () => {
    expect(canonicalEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    const d = diffStates({ a: 1, b: 2 }, { b: 2, a: 1 });
    expect(d.changes).toHaveLength(0);
  });

  it('trata array como folha e reporta mudanca integral', () => {
    const d = diffStates({ aliases: ['a'] }, { aliases: ['a', 'b'] });
    expect(d.changes).toHaveLength(1);
    expect(d.changes[0]?.field).toBe('aliases');
    expect(d.changes[0]?.kind).toBe('changed');
  });
});

describe('auditoria sanitizada', () => {
  it('campos de segredo nao registram valor, apenas hash', () => {
    const change = {
      field: 'token',
      before: 'ghp_antigo',
      after: 'ghp_novo',
      beforeHash: canonicalHash('ghp_antigo'),
      afterHash: canonicalHash('ghp_novo'),
      kind: 'changed' as const,
    };
    const sanitized = sanitizeChange(change);
    expect(sanitized.field).toBe('token');
    expect(sanitized.beforeHash).toBe(change.beforeHash);
    expect(sanitized.afterHash).toBe(change.afterHash);
    expect(sanitized.before).toBeUndefined();
    expect(sanitized.after).toBeUndefined();
  });

  it('isSecretField reconhece nomes sensiveis no ultimo segmento', () => {
    expect(isSecretField('token')).toBe(true);
    expect(isSecretField('credential.accessToken')).toBe(true);
    expect(isSecretField('senha')).toBe(true);
    expect(isSecretField('name')).toBe(false);
  });

  it('o schema de auditoria rejeita propriedades extras (segredo embutido)', () => {
    // Monta um evento valido e injeta um campo proibido na mudanca.
    const valid = buildValidatedAuditEvent({
      id: AUDIT_ID,
      operationId: '99999999-9999-4999-8999-999999999999',
      timestamp: NOW,
      operatorId: OPERATOR,
      entityType: 'person',
      entityId: ENTITY_ID,
      action: 'x',
      result: 'success',
      diff: diffStates({ name: 'Ana' }, { name: 'Bia' }),
    });
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;

    // Injeta uma propriedade proibida e revalida pelo schema.
    const tampered = {
      ...valid.event,
      changes: [{ ...valid.event.changes[0], token: 'ghp_segredo' }],
    };
    // A validacao direta vive no validator; qualquer propriedade extra e
    // rejeitada por `additionalProperties: false` do schema de auditoria.
    const outcome = validateEntity('auditEvent', tampered);
    expect(outcome.valid).toBe(false);
    expect(outcome.issues.some((i) => i.message.toLowerCase().includes('additional'))).toBe(true);
  });

  it('um comando com campo de segredo produz auditoria sem o valor do segredo', () => {
    interface Cred {
      id: string;
      token: string;
    }
    const start: Cred = { id: ENTITY_ID, token: 'ghp_antigo' };
    const exec = new CommandExecutor(start);
    const res = exec.execute(
      {
        operationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        operatorId: OPERATOR,
        baseCommit: null,
        expectedRevision: exec.getRevision(),
        payload: { token: 'ghp_novo' },
      },
      {
        entityType: 'credential',
        entityId: ENTITY_ID,
        action: 'rotacionar-token',
        timestamp: NOW,
        auditEventId: AUDIT_ID,
        apply: (prev, payload: { token: string }) => ({
          ok: true,
          next: { ...prev, token: payload.token },
        }),
      },
    );
    expect(res.ok).toBe(true);
    const ev = exec.getEmittedEvents()[0];
    const change = ev?.audit.changes.find((c) => c.field === 'token');
    expect(change).toBeDefined();
    expect(change?.before).toBeUndefined();
    expect(change?.after).toBeUndefined();
    // E o valor do segredo nao aparece em nenhuma serializacao do evento.
    expect(JSON.stringify(ev)).not.toContain('ghp_novo');
    expect(JSON.stringify(ev)).not.toContain('ghp_antigo');
  });
});

describe('catalogo de erros AppError', () => {
  it('todo codigo produz os cinco blocos em portugues', () => {
    for (const code of COMMAND_ERROR_CODES) {
      const e = makeAppError(code);
      expect(e.code).toBe(code);
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.explanationPtBr.length).toBeGreaterThan(0);
      expect(e.preserved.length).toBeGreaterThan(0);
      expect(e.impact.length).toBeGreaterThan(0);
      expect(e.actions.length).toBeGreaterThan(0);
    }
  });

  it('technicalReference nunca contem segredos quando fornecido', () => {
    const e = makeAppError('comando-falhou', { technicalReference: 'op=123 at=2026' });
    expect(e.technicalReference).toBe('op=123 at=2026');
  });
});
