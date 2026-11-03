// Teste de componente da grade de montagem manual (tarefa 6.1).
//
// Verifica os estados observaveis e mensagens em portugues das validacoes
// objetivas da tarefa (requirements.md, Requisito 5), pela UI real:
//  - toda atribuicao ACEITA usa um sujeito ELEGIVEL (5.2 / Property 16):
//    o botao de um candidato nao selecionavel fica desabilitado e a inclusao
//    de um candidato selecionavel salva a atribuicao;
//  - contrariar Preferencia_de_Escala exige justificativa (5.10 / Property 20):
//    sem justificativa, erro inline e nenhuma gravacao; com justificativa,
//    a atribuicao e salva;
//  - violar Regra_Fundamental sem excecao vigente e BLOQUEADO (5.11): o
//    candidato fica nao selecionavel (botao desabilitado) e o conflito aparece;
//  - remover atribuicao (5.1) limpa a celula.
//
// Sem mocks: a fabrica de contexto usa RegistryService e RuleSetService reais.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AssemblyGrid, type AssemblyGridProps } from './AssemblyGrid';
import { RegistryService } from '../../domain/registry/registry-service';
import { RuleSetService } from '../../domain/rules/rule-set-service';
import { field, lit } from '../../domain/rules/predicate';
import type { EligibilityContext } from '../../domain/eligibility';
import { SCHEMA_VERSION } from '../../domain/schemas/models';
import type {
  ApprovedRuleSet,
  Person,
  Rule,
  ScheduleDraft,
  Service,
} from '../../domain/schemas/models';

afterEach(() => cleanup());

const NOW = '2026-02-01T12:00:00Z';
// A elegibilidade trata o roleId como a propria habilitacao (capabilityId):
// por isso as pessoas habilitadas listam o ROLE como capability.
const ROLE_REGENTE = 'role-regente';
const RS_VERSION = 'rs-1';

function person(
  id: string,
  caps: string[],
  weekdays: Person['allowedWeekdays'],
  participation: Person['participation'] = 'active',
): Person {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    canonicalName: id,
    aliases: [],
    participation,
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

function ruleSet(rules: Rule[]): ApprovedRuleSet {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: RS_VERSION,
    version: 'v1',
    status: 'approved',
    validFrom: '2026-01-01',
    rules,
    sourceDecisions: [],
    approvedBy: 'op-1',
    approvedAt: NOW,
    createdAt: NOW,
  };
}

function service(id: string): Service {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    cycleId: 'cycle-1',
    date: '2026-02-04',
    computedWeekday: 'wednesday',
    kind: 'regular',
    externalInputIds: [],
  };
}

function initialDraft(): ScheduleDraft {
  return {
    schemaVersion: SCHEMA_VERSION,
    cycleId: 'cycle-1',
    revision: 'a'.repeat(64),
    assignments: [],
    publicFields: [],
    privateNotes: [],
    createdAt: NOW,
  };
}

/** Fabrica de contexto: o cadastro e as regras sao fixos; o rascunho varia. */
function contextFactory(people: Person[], rules: Rule[]) {
  const registry = registryWith(people);
  const ruleService = new RuleSetService([ruleSet(rules)], []);
  return (draft: ScheduleDraft): EligibilityContext => ({
    registry,
    rules: ruleService,
    ruleSetVersionId: RS_VERSION,
    services: [service('svc-1')],
    unavailabilities: [],
    propagation: { propagatingLinkTypeIds: new Set<string>() },
    externalInputs: [],
    history: [],
    draft,
  });
}

function baseProps(people: Person[], rules: Rule[] = []): AssemblyGridProps {
  return {
    services: [{ id: 'svc-1', label: 'Quarta 04/02' }],
    roles: [{ id: ROLE_REGENTE, label: 'Regente' }],
    initialDraft: initialDraft(),
    contextFactory: contextFactory(people, rules),
  };
}

function openCell(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Montar Regente de Quarta 04/02' }));
}

// --------------------------------------------------------------------------
// 5.2 / Property 16 — somente sujeitos elegiveis sao escolhiveis
// --------------------------------------------------------------------------

describe('AssemblyGrid - toda atribuicao aceita usa sujeito elegivel (5.2 / Property 16)', () => {
  it('inclui um candidato elegivel e exibe o status de atribuicao salva', () => {
    render(<AssemblyGrid {...baseProps([person('p-a', [ROLE_REGENTE], ['wednesday'])])} />);
    openCell();

    const list = screen.getByRole('list', { name: 'Lista de candidatos' });
    fireEvent.click(within(list).getByRole('button', { name: 'Escolher p-a' }));

    expect(screen.getByRole('status')).toHaveTextContent('Atribuicao salva: p-a.');
    // A celula da grade passa a exibir o sujeito atribuido.
    expect(
      screen.getByRole('button', { name: 'Montar Regente de Quarta 04/02' }),
    ).toHaveTextContent('p-a');
  });

  it('desabilita a escolha de candidato nao elegivel (nao habilitado)', () => {
    render(<AssemblyGrid {...baseProps([person('p-x', ['cap-outra'], ['wednesday'])])} />);
    openCell();

    const list = screen.getByRole('list', { name: 'Lista de candidatos' });
    const choose = within(list).getByRole('button', { name: 'Escolher p-x' });
    expect(choose).toBeDisabled();
  });
});

// --------------------------------------------------------------------------
// 5.11 — Regra_Fundamental sem excecao bloqueia a selecao
// --------------------------------------------------------------------------

describe('AssemblyGrid - Regra_Fundamental bloqueia a selecao (5.11)', () => {
  it('candidato que viola RF fica nao selecionavel e o conflito aparece na celula', () => {
    const rf: Rule = {
      id: 'rf-block',
      kind: 'fundamental',
      severity: 'blocking',
      applicability: { op: 'eq', args: [field('assignment.roleId'), lit(ROLE_REGENTE)] },
      assertion: { op: 'false' },
      messageTemplate: 'funcao bloqueada por RF',
      allowedExceptionTypeIds: [],
    };
    render(
      <AssemblyGrid {...baseProps([person('p-a', [ROLE_REGENTE], ['wednesday'])], [rf])} />,
    );
    openCell();

    const list = screen.getByRole('list', { name: 'Lista de candidatos' });
    expect(within(list).getByRole('button', { name: 'Escolher p-a' })).toBeDisabled();
    expect(within(list).getByText(/funcao bloqueada por RF/)).toBeInTheDocument();
  });
});

// --------------------------------------------------------------------------
// 5.10 / Property 20 — override de preferencia exige justificativa
// --------------------------------------------------------------------------

describe('AssemblyGrid - override de preferencia exige justificativa (5.10 / Property 20)', () => {
  const pref: Rule = {
    id: 'pref-1',
    kind: 'preference',
    severity: 'warning',
    applicability: { op: 'eq', args: [field('assignment.roleId'), lit(ROLE_REGENTE)] },
    assertion: { op: 'false' },
    messageTemplate: 'preferencia contrariada',
    allowedExceptionTypeIds: [],
  };

  it('bloqueia a inclusao sem justificativa e mostra erro inline (nenhuma gravacao)', () => {
    render(
      <AssemblyGrid {...baseProps([person('p-a', [ROLE_REGENTE], ['wednesday'])], [pref])} />,
    );
    openCell();

    const list = screen.getByRole('list', { name: 'Lista de candidatos' });
    fireEvent.click(within(list).getByRole('button', { name: 'Escolher p-a' }));

    expect(screen.getByRole('alert')).toHaveTextContent(/justificativa/i);
    // A celula continua vazia (nada foi salvo).
    expect(
      screen.getByRole('button', { name: 'Montar Regente de Quarta 04/02' }),
    ).toHaveTextContent('(vazio)');
  });

  it('salva a atribuicao quando a justificativa e preenchida', () => {
    render(
      <AssemblyGrid {...baseProps([person('p-a', [ROLE_REGENTE], ['wednesday'])], [pref])} />,
    );
    openCell();

    fireEvent.change(
      screen.getByLabelText('Justificativa (obrigatoria ao contrariar uma preferencia)'),
      { target: { value: 'decisao do coordenador' } },
    );
    const list = screen.getByRole('list', { name: 'Lista de candidatos' });
    fireEvent.click(within(list).getByRole('button', { name: 'Escolher p-a' }));

    expect(screen.getByRole('status')).toHaveTextContent('Atribuicao salva: p-a.');
  });
});

// --------------------------------------------------------------------------
// 5.1 — remover atribuicao
// --------------------------------------------------------------------------

describe('AssemblyGrid - remover atribuicao (5.1)', () => {
  it('remove a atribuicao da celula e volta ao estado vazio', () => {
    render(<AssemblyGrid {...baseProps([person('p-a', [ROLE_REGENTE], ['wednesday'])])} />);
    openCell();

    const list = screen.getByRole('list', { name: 'Lista de candidatos' });
    fireEvent.click(within(list).getByRole('button', { name: 'Escolher p-a' }));
    expect(
      screen.getByRole('button', { name: 'Montar Regente de Quarta 04/02' }),
    ).toHaveTextContent('p-a');

    // Reabre a celula e remove.
    openCell();
    fireEvent.click(screen.getByRole('button', { name: 'Remover atribuicao' }));

    expect(screen.getByRole('status')).toHaveTextContent('Atribuicao removida.');
    expect(
      screen.getByRole('button', { name: 'Montar Regente de Quarta 04/02' }),
    ).toHaveTextContent('(vazio)');
  });
});
