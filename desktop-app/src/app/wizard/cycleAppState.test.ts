// Testes da orquestracao pura das sete etapas (tarefa 16.1).
//
// Validacao objetiva: as pendencias de cada etapa sao derivadas do progresso e
// da conectividade; o avanco so e possivel sem pendencias; a conciliacao
// pendente bloqueia todas as etapas; etapas que exigem rede ficam bloqueadas
// offline. Requisitos: 1.4, 1.5, 1.6, 1.10, 10.1, 10.23.

import { describe, it, expect } from 'vitest';
import {
  type Connectivity,
  type CycleProgress,
  derivePendingByStage,
  deriveSyncStatus,
  stageRequiresOnline,
} from './cycleAppState';
import { WIZARD_STAGES } from './wizardState';

const EMPTY: CycleProgress = {
  monthChosen: false,
  calendarGenerated: false,
  requiredInputsCount: 0,
  providedInputsCount: 0,
  unavailabilityReviewed: false,
  pendingImports: 0,
  unfilledRequiredCells: 5,
  validationComplete: false,
  validationStale: false,
  blockingFindings: 0,
  previewGenerated: false,
  unacknowledgedWarnings: 0,
  approvalRegistered: false,
  packagePublished: false,
  publicSiteVerified: false,
  closingConfirmed: false,
  unresolvedReconcileConflicts: 0,
};

const DONE: CycleProgress = {
  monthChosen: true,
  calendarGenerated: true,
  requiredInputsCount: 3,
  providedInputsCount: 3,
  unavailabilityReviewed: true,
  pendingImports: 0,
  unfilledRequiredCells: 0,
  validationComplete: true,
  validationStale: false,
  blockingFindings: 0,
  previewGenerated: true,
  unacknowledgedWarnings: 0,
  approvalRegistered: true,
  packagePublished: true,
  publicSiteVerified: true,
  closingConfirmed: true,
  unresolvedReconcileConflicts: 0,
};

describe('derivePendingByStage', () => {
  it('ciclo recem-aberto tem pendencias em todas as etapas operacionais', () => {
    const pending = derivePendingByStage(EMPTY, 'online');
    expect(pending.opening.length).toBeGreaterThan(0);
    expect(pending.collection.length).toBeGreaterThan(0);
    expect(pending.assembly.length).toBeGreaterThan(0);
    expect(pending.validation.length).toBeGreaterThan(0);
    expect(pending.approval.length).toBeGreaterThan(0);
    expect(pending.publication.length).toBeGreaterThan(0);
    expect(pending.closing.length).toBeGreaterThan(0);
  });

  it('progresso completo online zera todas as pendencias', () => {
    const pending = derivePendingByStage(DONE, 'online');
    for (const stage of WIZARD_STAGES) {
      expect(pending[stage]).toHaveLength(0);
    }
  });

  it('offline bloqueia a publicacao mesmo com tudo pronto', () => {
    const pending = derivePendingByStage(DONE, 'offline');
    expect(pending.publication.some((p) => /internet/i.test(p))).toBe(true);
    // As demais etapas concluidas permanecem sem pendencias.
    expect(pending.opening).toHaveLength(0);
    expect(pending.assembly).toHaveLength(0);
  });

  it('conciliacao pendente bloqueia TODAS as etapas', () => {
    const progress: CycleProgress = { ...DONE, unresolvedReconcileConflicts: 2 };
    const pending = derivePendingByStage(progress, 'online');
    for (const stage of WIZARD_STAGES) {
      expect(pending[stage][0]).toMatch(/conciliacao/i);
    }
  });

  it('validacao desatualizada exige nova validacao completa', () => {
    const progress: CycleProgress = { ...DONE, validationStale: true };
    const pending = derivePendingByStage(progress, 'online');
    expect(pending.validation.some((p) => /validacao completa/i.test(p))).toBe(true);
  });

  it('importacoes pendentes bloqueiam a coleta (sem fuzzy automatico)', () => {
    const progress: CycleProgress = { ...DONE, pendingImports: 1 };
    const pending = derivePendingByStage(progress, 'online');
    expect(pending.collection.some((p) => /importacoes pendentes/i.test(p))).toBe(true);
  });
});

describe('stageRequiresOnline', () => {
  it('publicacao exige online; demais nao', () => {
    expect(stageRequiresOnline('publication')).toBe(true);
    expect(stageRequiresOnline('assembly')).toBe(false);
    expect(stageRequiresOnline('closing')).toBe(false);
  });
});

describe('deriveSyncStatus', () => {
  it('offline com fila descreve as alteracoes pendentes', () => {
    const s = deriveSyncStatus({ connectivity: 'offline' as Connectivity, queuedOperations: 2, pendingConflicts: 0 });
    expect(s.connectivity).toBe('offline');
    expect(s.label).toMatch(/offline/i);
    expect(s.label).toMatch(/2/);
  });

  it('online com conflitos sinaliza a necessidade de escolha', () => {
    const s = deriveSyncStatus({ connectivity: 'online', queuedOperations: 0, pendingConflicts: 1 });
    expect(s.label).toMatch(/conflito/i);
  });

  it('online sem pendencias indica sincronizado', () => {
    const s = deriveSyncStatus({ connectivity: 'online', queuedOperations: 0, pendingConflicts: 0 });
    expect(s.label).toMatch(/sincronizado/i);
  });
});
