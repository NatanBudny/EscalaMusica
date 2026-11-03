import { describe, expect, it } from 'vitest';

import {
  STAGE_ORDER,
  activeServices,
  addExtraordinaryService,
  completeStage,
  cycleStateFacts,
  hasExclusiveState,
  openCycle,
  pendingForStage,
  removeService,
  wizardView,
  type CycleAggregate,
  type OpenCycleInput,
  type StageFacts,
} from './cycleService';
import { generateAutomaticDates } from './calendar';
import { validateEntity } from '../schemas/validator';
import type { MonthlyCycle, Uuid } from '../schemas/models';

const NOW = '2026-01-15T12:00:00Z';

const uuid = (n: number): Uuid =>
  `00000000-0000-4000-8000-${(n >>> 0).toString(16).padStart(12, '0')}`;

function baseInput(year: number, month: number): OpenCycleInput {
  return {
    year,
    month,
    cycleId: uuid(1),
    ruleSetVersionId: uuid(2),
    serviceId: (i) => uuid(1000 + i),
    initialDraftRevision: 'a'.repeat(64),
    now: NOW,
  };
}

function openOrThrow(year: number, month: number): CycleAggregate {
  const r = openCycle(baseInput(year, month), null);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

const allFactsTrue: StageFacts = {
  hasActiveService: true,
  collectionComplete: true,
  assemblyComplete: true,
  validationCleared: true,
  approvalValid: true,
  publicationConfirmed: true,
};

describe('CycleService.openCycle', () => {
  it('cria exatamente um ciclo com o periodo e estado iniciais corretos (2.1, 2.8)', () => {
    const agg = openOrThrow(2025, 3);
    expect(agg.cycle.period).toBe('2025-03');
    expect(agg.cycle.state).toBe('open');
    expect(agg.cycle.stage).toBe('opening');
    // Schema valido.
    expect(validateEntity('monthlyCycle', agg.cycle).valid).toBe(true);
    for (const s of agg.services) {
      expect(validateEntity('service', s).valid).toBe(true);
    }
  });

  it('gera exatamente as datas automaticas do mes (2.3, 2.6)', () => {
    const agg = openOrThrow(2025, 3);
    const expected = generateAutomaticDates(2025, 3);
    expect(agg.services.map((s) => s.date)).toEqual(expected.map((d) => d.date));
    expect(agg.services.map((s) => s.computedWeekday)).toEqual(expected.map((d) => d.weekday));
    expect(agg.services.every((s) => s.kind === 'regular')).toBe(true);
  });

  it('abertura idempotente: periodo existente retorna o mesmo agregado (2.2)', () => {
    const first = openOrThrow(2025, 3);
    // Segunda abertura informando o agregado existente.
    const second = openCycle({ ...baseInput(2025, 3), cycleId: uuid(99) }, first);
    expect(second.ok).toBe(true);
    if (second.ok) {
      // Mesmo objeto, nenhum dado alterado.
      expect(second.value).toBe(first);
      expect(second.value.cycle.id).toBe(first.cycle.id); // id original preservado
    }
  });

  it('rejeita ano fora do intervalo e indica o valor (2.9)', () => {
    for (const bad of [0, 10000, 1.5]) {
      const r = openCycle(baseInput(bad, 1), null);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe('year-out-of-range');
        expect(r.error.offendingValue).toBe(String(bad));
      }
    }
  });

  it('rejeita mes fora do intervalo e indica o valor (2.9)', () => {
    for (const bad of [0, 13]) {
      const r = openCycle(baseInput(2025, bad), null);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe('month-out-of-range');
        expect(r.error.offendingValue).toBe(String(bad));
      }
    }
  });

  it('fevereiro bissexto e nao bissexto geram as datas corretas', () => {
    const leap = openOrThrow(2020, 2); // 2020-02-29 e sabado
    expect(leap.services.map((s) => s.date)).toContain('2020-02-29');
    const nonLeap = openOrThrow(2023, 2);
    expect(nonLeap.services.map((s) => s.date)).not.toContain('2023-02-29');
  });

  it('bordas de ano/mes: 0001-01 e 9999-12 abrem sem erro', () => {
    expect(openCycle(baseInput(1, 1), null).ok).toBe(true);
    expect(openCycle(baseInput(9999, 12), null).ok).toBe(true);
  });
});

describe('CycleService.addExtraordinaryService (2.4, 2.6, 2.7)', () => {
  it('inclui exatamente um culto extraordinario e preserva as datas existentes', () => {
    const agg = openOrThrow(2025, 3);
    const before = agg.services.map((s) => s.date);
    // Escolhe uma segunda-feira (nao gerada automaticamente): 2025-03-03.
    const r = addExtraordinaryService(agg, { date: '2025-03-03', serviceId: uuid(5000), now: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const added = r.value.services.find((s) => s.id === uuid(5000));
      expect(added?.kind).toBe('extraordinary');
      expect(added?.computedWeekday).toBe('monday');
      // Datas anteriores preservadas.
      for (const d of before) {
        expect(r.value.services.map((s) => s.date)).toContain(d);
      }
      expect(r.value.services.length).toBe(agg.services.length + 1);
    }
  });

  it('rejeita data fora do periodo do ciclo (date-not-in-period)', () => {
    const agg = openOrThrow(2025, 3);
    const r = addExtraordinaryService(agg, { date: '2025-04-01', serviceId: uuid(5001), now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('date-not-in-period');
  });

  it('rejeita dia da semana informado divergente e preserva o estado (2.7)', () => {
    const agg = openOrThrow(2025, 3);
    // 2025-03-03 e segunda; declarar como domingo diverge.
    const r = addExtraordinaryService(agg, {
      date: '2025-03-03',
      serviceId: uuid(5002),
      declaredWeekday: 'sunday',
      now: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('weekday-mismatch');
    // Estado preservado: nenhuma mutacao no agregado original.
    expect(agg.services.find((s) => s.id === uuid(5002))).toBeUndefined();
  });

  it('aceita dia da semana informado coincidente', () => {
    const agg = openOrThrow(2025, 3);
    const r = addExtraordinaryService(agg, {
      date: '2025-03-03',
      serviceId: uuid(5003),
      declaredWeekday: 'monday',
      now: NOW,
    });
    expect(r.ok).toBe(true);
  });

  it('rejeita data duplicada de culto ativo', () => {
    const agg = openOrThrow(2025, 3);
    const existing = agg.services[0]!.date;
    const r = addExtraordinaryService(agg, { date: existing, serviceId: uuid(5004), now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('duplicate-date');
  });
});

describe('CycleService.removeService (2.5, 2.10)', () => {
  it('remove data com motivo valido e registra o motivo (apos trim)', () => {
    const agg = openOrThrow(2025, 3);
    const target = agg.services[0]!;
    const r = removeService(agg, {
      serviceId: target.id,
      reason: '  cancelado por feriado  ',
      operatorId: uuid(7),
      now: NOW,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const removed = r.value.services.find((s) => s.id === target.id);
      expect(removed?.removed?.reason).toBe('cancelado por feriado');
      expect(removed?.removed?.operatorId).toBe(uuid(7));
      // Nao integra mais os cultos ativos.
      expect(activeServices(r.value).map((s) => s.id)).not.toContain(target.id);
    }
  });

  it('rejeita motivo ausente/so espacos (2.10)', () => {
    const agg = openOrThrow(2025, 3);
    const target = agg.services[0]!;
    for (const reason of ['', '   ', '\t\n']) {
      const r = removeService(agg, { serviceId: target.id, reason, operatorId: uuid(7), now: NOW });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('removal-reason-length');
    }
  });

  it('rejeita motivo > 500 caracteres apos trim (2.10)', () => {
    const agg = openOrThrow(2025, 3);
    const target = agg.services[0]!;
    const r = removeService(agg, {
      serviceId: target.id,
      reason: `  ${'x'.repeat(501)}  `,
      operatorId: uuid(7),
      now: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('removal-reason-length');
  });

  it('aceita exatamente 500 caracteres (borda)', () => {
    const agg = openOrThrow(2025, 3);
    const target = agg.services[0]!;
    const r = removeService(agg, {
      serviceId: target.id,
      reason: 'x'.repeat(500),
      operatorId: uuid(7),
      now: NOW,
    });
    expect(r.ok).toBe(true);
  });

  it('rejeita culto inexistente e ja removido, preservando o estado', () => {
    const agg = openOrThrow(2025, 3);
    const notFound = removeService(agg, {
      serviceId: uuid(99999),
      reason: 'motivo',
      operatorId: uuid(7),
      now: NOW,
    });
    expect(notFound.ok).toBe(false);
    if (!notFound.ok) expect(notFound.error.code).toBe('service-not-found');

    const first = removeService(agg, {
      serviceId: agg.services[0]!.id,
      reason: 'motivo',
      operatorId: uuid(7),
      now: NOW,
    });
    expect(first.ok).toBe(true);
    if (first.ok) {
      const again = removeService(first.value, {
        serviceId: agg.services[0]!.id,
        reason: 'de novo',
        operatorId: uuid(7),
        now: NOW,
      });
      expect(again.ok).toBe(false);
      if (!again.ok) expect(again.error.code).toBe('service-already-removed');
    }
  });
});

describe('CycleService estado exclusivo (2.8)', () => {
  it('cada estado tem semantica exclusiva', () => {
    const open = openOrThrow(2025, 3).cycle;
    expect(hasExclusiveState(open)).toBe(true);
    expect(cycleStateFacts(open)).toEqual({
      state: 'open',
      draftEditable: true,
      isCurrentSchedule: false,
      readOnly: false,
    });
    const published: MonthlyCycle = { ...open, state: 'published' };
    expect(cycleStateFacts(published)).toEqual({
      state: 'published',
      draftEditable: false,
      isCurrentSchedule: true,
      readOnly: true,
    });
    const archived: MonthlyCycle = { ...open, state: 'archived' };
    expect(cycleStateFacts(archived)).toEqual({
      state: 'archived',
      draftEditable: false,
      isCurrentSchedule: false,
      readOnly: true,
    });
  });
});

describe('CycleService assistente das sete etapas (1.4, 1.5, 1.6)', () => {
  it('apresenta as sete etapas na ordem fixa', () => {
    const cycle = openOrThrow(2025, 3).cycle;
    const view = wizardView(cycle, allFactsTrue);
    expect(view.stages).toEqual([
      'opening',
      'collection',
      'assembly',
      'validation',
      'approval',
      'publication',
      'closing',
    ]);
    expect(STAGE_ORDER.length).toBe(7);
  });

  it('identifica pendencias bloqueantes da etapa atual (1.5)', () => {
    const facts: StageFacts = { ...allFactsTrue, hasActiveService: false };
    const pend = pendingForStage('opening', facts);
    expect(pend.length).toBe(1);
    expect(pend[0]!.id).toBe('opening.no-active-service');
    // Com fatos satisfeitos, sem pendencias.
    expect(pendingForStage('opening', allFactsTrue)).toEqual([]);
  });

  it('bloqueia avanco sem pre-condicao e preserva o ciclo (1.5)', () => {
    const cycle = openOrThrow(2025, 3).cycle;
    const facts: StageFacts = { ...allFactsTrue, hasActiveService: false };
    const r = completeStage(cycle, facts, {
      stage: 'opening',
      result: 'ok',
      operatorId: uuid(7),
      now: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('stage-precondition');
    // Ciclo original preservado.
    expect(cycle.stage).toBe('opening');
    expect(cycle.stageCompletions.length).toBe(0);
  });

  it('bloqueia conclusao de etapa que nao e a atual', () => {
    const cycle = openOrThrow(2025, 3).cycle;
    const r = completeStage(cycle, allFactsTrue, {
      stage: 'validation',
      result: 'ok',
      operatorId: uuid(7),
      now: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('stage-not-current');
  });

  it('conclui etapa e avanca, registrando a conclusao auditada (1.6)', () => {
    let cycle = openOrThrow(2025, 3).cycle;
    const r = completeStage(cycle, allFactsTrue, {
      stage: 'opening',
      result: 'datas confirmadas',
      operatorId: uuid(7),
      now: NOW,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      cycle = r.value;
      expect(cycle.stage).toBe('collection');
      expect(cycle.stageCompletions).toEqual([
        { stage: 'opening', result: 'datas confirmadas', completedAt: NOW, operatorId: uuid(7) },
      ]);
    }
  });

  it('percorre todas as sete etapas em ordem ate o fechamento', () => {
    let cycle = openOrThrow(2025, 3).cycle;
    for (const stage of STAGE_ORDER) {
      const r = completeStage(cycle, allFactsTrue, {
        stage,
        result: `${stage} ok`,
        operatorId: uuid(7),
        now: NOW,
      });
      expect(r.ok).toBe(true);
      if (r.ok) cycle = r.value;
    }
    // Concluir closing nao avanca (permanece em closing) e registra as 7 conclusoes.
    expect(cycle.stage).toBe('closing');
    expect(cycle.stageCompletions.map((c) => c.stage)).toEqual(STAGE_ORDER);
  });
});
