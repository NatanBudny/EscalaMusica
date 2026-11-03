// Testes de componente e integracao do CycleWizard (tarefas 16.1, 16.3).
//
// Validacao objetiva: o ciclo e operavel somente pelos controles (sem JSON,
// Markdown, IA ou terminal); a etapa atual, as pendencias e a ajuda contextual
// aparecem em portugues; o avanco so e permitido sem pendencias.
//
// Requisitos: 1.1-1.8, 1.11, 10.1, 10.23.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CycleWizard } from './CycleWizard';
import { deriveWizard, advanceStage, WIZARD_STAGES } from './wizardState';

describe('deriveWizard (logica pura)', () => {
  it('marca etapas anteriores como done, a atual como current e as seguintes como upcoming', () => {
    const view = deriveWizard({ currentStage: 'assembly', pendingByStage: {} });
    expect(view.stages.find((s) => s.stage === 'opening')!.status).toBe('done');
    expect(view.stages.find((s) => s.stage === 'assembly')!.status).toBe('current');
    expect(view.stages.find((s) => s.stage === 'validation')!.status).toBe('upcoming');
    expect(view.canAdvance).toBe(true);
    expect(view.nextStage).toBe('validation');
  });

  it('marca a etapa atual como blocked e impede avanco quando ha pendencias', () => {
    const view = deriveWizard({ currentStage: 'validation', pendingByStage: { validation: ['resolver bloqueio X'] } });
    expect(view.stages.find((s) => s.stage === 'validation')!.status).toBe('blocked');
    expect(view.canAdvance).toBe(false);
    expect(view.nextStage).toBeUndefined();
  });

  it('nao avanca alem do fechamento', () => {
    expect(advanceStage({ currentStage: 'closing', pendingByStage: {} })).toBe('closing');
  });
});

describe('CycleWizard (componente)', () => {
  it('exibe as sete etapas e a ajuda contextual sob demanda', () => {
    render(<CycleWizard input={{ currentStage: 'opening', pendingByStage: {} }} />);
    for (const stage of WIZARD_STAGES) {
      // Cada rotulo aparece ao menos uma vez.
      expect(screen.getAllByText(new RegExp(labelOf(stage), 'i')).length).toBeGreaterThan(0);
    }
    // A ajuda so aparece ao clicar.
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /o que fazer agora/i }));
    expect(screen.getByRole('note')).toBeInTheDocument();
  });

  it('habilita o avanco quando a etapa nao tem pendencias e chama onAdvance', () => {
    const onAdvance = vi.fn();
    render(<CycleWizard input={{ currentStage: 'opening', pendingByStage: {} }} onAdvance={onAdvance} />);
    const btn = screen.getByRole('button', { name: /avancar etapa/i });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onAdvance).toHaveBeenCalledWith('collection');
  });

  it('desabilita o avanco e lista as pendencias como alertas', () => {
    render(<CycleWizard input={{ currentStage: 'validation', pendingByStage: { validation: ['bloqueio A', 'bloqueio B'] } }} />);
    expect(screen.getByRole('button', { name: /avancar etapa/i })).toBeDisabled();
    expect(screen.getAllByRole('alert')).toHaveLength(2);
  });
});

function labelOf(stage: string): string {
  const map: Record<string, string> = {
    opening: 'Abertura',
    collection: 'Coleta',
    assembly: 'Montagem',
    validation: 'Validacao',
    approval: 'Aprovacao',
    publication: 'Publicacao',
    closing: 'Fechamento',
  };
  return map[stage] ?? stage;
}
