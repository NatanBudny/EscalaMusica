// Teste de integracao da validacao com a grade de montagem e o gate de avanco
// (tarefa 8.2).
//
// Verifica, pela UI real e com o ValidationEngine real (sem mocks), as
// validacoes objetivas da tarefa:
//  - 7.24: totais SEPARADOS de bloqueios, avisos e aprovadas, com a revisao e a
//    versao de regras validadas;
//  - 7.3 / 1.5: cada achado/pendencia mostra culto, campo, motivo e acao; a
//    celula afetada e DESTACADA na grade e a navegacao foca a celula;
//  - 7.1 / 7.23: alterar um campo INVALIDA os resultados derivados (o relatorio
//    fica desatualizado) e fecha o gate ate uma nova validacao completa;
//  - 8.1: zero bloqueios na validacao completa da revisao atual habilita APENAS
//    o avanco de etapa; a publicacao direta permanece SEMPRE desabilitada.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AssemblyValidationView } from './AssemblyValidationView';
import { RegistryService } from '../../domain/registry/registry-service';
import { RuleSetService } from '../../domain/rules/rule-set-service';
import type { EligibilityContext } from '../../domain/eligibility';
import type { RuleSetStructuralConfig, ValidationInput } from '../../domain/validation';
import { SCHEMA_VERSION } from '../../domain/schemas/models';
import type {
  ApprovedRuleSet,
  Assignment,
  Person,
  ScheduleDraft,
  Service,
} from '../../domain/schemas/models';

afterEach(() => cleanup());

const NOW = '2026-02-01T12:00:00Z';
const ROLE_REGENTE = 'role-regente';
const RS_VERSION = 'rs-1';
const SERVICE_ID = 'svc-1';

function person(
  id: string,
  caps: string[],
  weekdays: Person['allowedWeekdays'],
): Person {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    canonicalName: id,
    aliases: [],
    participation: 'active',
    publicContactAuthorizationIds: [],
    capabilityIds: caps,
    allowedWeekdays: weekdays,
    leaves: [],
    links: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function registryWith(people: Person[]): RegistryService {
  const reg = new RegistryService();
  for (const p of people) {
    const r = reg.addPerson({
      id: p.id,
      canonicalName: p.canonicalName,
      capabilityIds: p.capabilityIds,
      allowedWeekdays: p.allowedWeekdays,
      now: NOW,
    });
    if (!r.ok) throw new Error(`fixture invalida: ${r.error.message}`);
  }
  return reg;
}

function ruleSet(): ApprovedRuleSet {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: RS_VERSION,
    version: 'v1',
    status: 'approved',
    validFrom: '2026-02-01',
    validUntil: '2026-02-28',
    rules: [],
    sourceDecisions: [],
    approvedBy: 'op-1',
    approvedAt: NOW,
    createdAt: NOW,
  };
}

function service(): Service {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: SERVICE_ID,
    cycleId: 'cycle-1',
    date: '2026-02-04',
    computedWeekday: 'wednesday',
    kind: 'regular',
    externalInputIds: [],
  };
}

function draftWith(assignments: Assignment[]): ScheduleDraft {
  return {
    schemaVersion: SCHEMA_VERSION,
    cycleId: 'cycle-1',
    revision: 'a'.repeat(64),
    assignments,
    publicFields: [],
    privateNotes: [],
    createdAt: NOW,
  };
}

const EMPTY_STRUCTURAL: RuleSetStructuralConfig = {
  worshipTeamRoleIds: [],
  wednesdayForbiddenWorshipRoleIds: [],
  wednesdayRequiredExternalTypes: [],
  musicalMessageRoleIds: [],
  incompatibleRolePairs: [],
  externalRoleIds: [],
  ownWorshipRoleIds: [],
  departmentWorshipRequiredRoleIds: [],
  communicationRoleIds: [],
  propagation: { propagatingLinkTypeIds: new Set<string>() },
};

/** Monta as fabricas de contexto (elegibilidade) e de validacao reais. */
function makeFactories(people: Person[]) {
  const registry = registryWith(people);
  const ruleService = new RuleSetService([ruleSet()], []);

  const contextFactory = (draft: ScheduleDraft): EligibilityContext => ({
    registry,
    rules: ruleService,
    ruleSetVersionId: RS_VERSION,
    services: [service()],
    unavailabilities: [],
    propagation: { propagatingLinkTypeIds: new Set<string>() },
    externalInputs: [],
    history: [],
    draft,
  });

  const validationInputFactory = (draft: ScheduleDraft): ValidationInput => ({
    cycleId: 'cycle-1',
    draft,
    services: [service()],
    externalInputs: [],
    unavailabilities: [],
    people,
    departments: [],
    ruleSet: ruleSet(),
    exceptions: [],
    structural: EMPTY_STRUCTURAL,
  });

  return { contextFactory, validationInputFactory };
}

function baseProps(people: Person[], initialDraft: ScheduleDraft) {
  const { contextFactory, validationInputFactory } = makeFactories(people);
  return {
    services: [{ id: SERVICE_ID, label: 'Quarta 04/02' }],
    roles: [{ id: ROLE_REGENTE, label: 'Regente' }],
    initialDraft,
    contextFactory,
    validationInputFactory,
    serviceLabel: (id: string) => (id === SERVICE_ID ? 'Quarta 04/02' : id),
    roleLabel: (id: string) => (id === ROLE_REGENTE ? 'Regente' : id),
  };
}

function regenteCell(): HTMLElement {
  return screen.getByRole('button', { name: 'Montar Regente de Quarta 04/02' });
}

// --------------------------------------------------------------------------
// 7.24 totais e identificacao + 8.1 gate sem bloqueios
// --------------------------------------------------------------------------

describe('AssemblyValidationView - validacao sem bloqueios (7.24 / 8.1)', () => {
  it('mostra totais separados, revisao/versao e habilita APENAS o avanco', () => {
    render(
      <AssemblyValidationView {...baseProps([person('p-a', [ROLE_REGENTE], ['wednesday'])], draftWith([]))} />,
    );

    // Antes de validar: avanco desabilitado, publicacao desabilitada.
    expect(screen.getByRole('button', { name: 'Avancar para a proxima etapa' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Validar escala completa' }));

    // 7.24: totais separados e identificacao.
    expect(screen.getByTestId('total-blocking')).toHaveTextContent('0');
    expect(screen.getByTestId('total-passed')).toHaveTextContent('18');
    expect(screen.getByText('v1')).toBeInTheDocument();

    // 8.1: zero bloqueios habilita o avanco; publicacao permanece desabilitada.
    expect(
      screen.getByRole('button', { name: 'Avancar para a proxima etapa' }),
    ).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeDisabled();
  });

  it('o avanco chama onAdvanceStage somente quando habilitado', () => {
    const onAdvanceStage = vi.fn();
    render(
      <AssemblyValidationView
        {...baseProps([person('p-a', [ROLE_REGENTE], ['wednesday'])], draftWith([]))}
        onAdvanceStage={onAdvanceStage}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Validar escala completa' }));
    fireEvent.click(screen.getByRole('button', { name: 'Avancar para a proxima etapa' }));
    expect(onAdvanceStage).toHaveBeenCalledTimes(1);
  });
});

// --------------------------------------------------------------------------
// 7.3 / 1.5 destaque e navegacao de achado bloqueante
// --------------------------------------------------------------------------

describe('AssemblyValidationView - bloqueio destaca celula e navega (7.3 / 1.5)', () => {
  // Pessoa nao habilitada atribuida diretamente no rascunho inicial => a
  // verificacao 7.16 gera bloqueio para a celula (culto x funcao).
  function blockingProps() {
    const people = [person('p-x', ['cap-outra'], ['wednesday'])];
    const initial = draftWith([
      { id: 'a-1', serviceId: SERVICE_ID, roleId: ROLE_REGENTE, subject: { type: 'person', id: 'p-x' }, source: 'manual' },
    ]);
    return baseProps(people, initial);
  }

  it('destaca a celula afetada e mantem o avanco desabilitado', () => {
    render(<AssemblyValidationView {...blockingProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Validar escala completa' }));

    expect(Number(screen.getByTestId('total-blocking').textContent)).toBeGreaterThan(0);
    // 8.1/7.23: com bloqueio, avanco desabilitado.
    expect(screen.getByRole('button', { name: 'Avancar para a proxima etapa' })).toBeDisabled();

    // 7.3: a celula do Regente fica destacada (aria-invalid).
    expect(regenteCell()).toHaveAttribute('aria-invalid', 'true');
  });

  it('clicar em "Ir ao campo" foca a celula do culto afetado', () => {
    render(<AssemblyValidationView {...blockingProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Validar escala completa' }));

    const pendencias = screen.getByRole('region', { name: 'Pendencias bloqueantes' });
    fireEvent.click(within(pendencias).getAllByRole('button', { name: /Ir para/ })[0]!);

    // A celula focada fica selecionada (aria-pressed) e abre o painel de candidatos.
    expect(regenteCell()).toHaveAttribute('aria-pressed', 'true');
  });
});

// --------------------------------------------------------------------------
// 7.1 / 7.23 alterar campo invalida resultados derivados
// --------------------------------------------------------------------------

describe('AssemblyValidationView - alterar campo invalida derivados (7.1 / 7.23)', () => {
  it('apos uma validacao limpa, incluir uma atribuicao fecha o gate ate revalidar', () => {
    render(
      <AssemblyValidationView {...baseProps([person('p-a', [ROLE_REGENTE], ['wednesday'])], draftWith([]))} />,
    );

    // Valida: sem bloqueios => avanco habilitado.
    fireEvent.click(screen.getByRole('button', { name: 'Validar escala completa' }));
    expect(
      screen.getByRole('button', { name: 'Avancar para a proxima etapa' }),
    ).not.toBeDisabled();

    // Altera um campo pela grade (inclui p-a como Regente).
    fireEvent.click(regenteCell());
    const list = screen.getByRole('list', { name: 'Lista de candidatos' });
    fireEvent.click(within(list).getByRole('button', { name: 'Escolher p-a' }));

    // 7.1/7.23: resultados derivados invalidados => desatualizado e gate fechado.
    expect(screen.getByRole('alert')).toHaveTextContent(/nao valem para a revisao atual/i);
    expect(screen.getByRole('button', { name: 'Avancar para a proxima etapa' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeDisabled();

    // Revalidar reabre o gate (ainda sem bloqueios).
    fireEvent.click(screen.getByRole('button', { name: 'Validar escala completa' }));
    expect(
      screen.getByRole('button', { name: 'Avancar para a proxima etapa' }),
    ).not.toBeDisabled();
  });
});
