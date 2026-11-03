// Testes de componente do painel de treinamento (tarefa 16.2 / 16.3).
//
// Validacao objetiva: o treino e operado pelos controles; usa dados ficticios;
// a publicacao e SIMULADA; ao fim o isolamento e verificado (hashes reais
// inalterados) e a cobertura das etapas e comprovada. Requisitos: 15.11-15.14.

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TrainingPanel } from './TrainingPanel';
import { WIZARD_STAGES, STAGE_LABELS } from '../wizard/wizardState';

const AT = '2099-01-01T00:00:00Z';
const clock = () => AT;

describe('TrainingPanel (15.11-15.14)', () => {
  it('inicia o treino e exibe os dados ficticios', () => {
    render(<TrainingPanel realOperational={{ pessoas: ['REAL'] }} realPublic={{ atual: [] }} now={clock} />);
    fireEvent.click(screen.getByRole('button', { name: /iniciar treinamento/i }));
    expect(screen.getByText(/dados ficticios do treino/i)).toBeInTheDocument();
    expect(screen.getByText(/FULANO DE TESTE/i)).toBeInTheDocument();
  });

  it('percorre todas as etapas, publica simulado, restaura e conclui — isolamento verificado', () => {
    render(<TrainingPanel realOperational={{ pessoas: ['REAL'] }} realPublic={{ atual: [{ DATA: '01/01' }] }} now={clock} />);
    fireEvent.click(screen.getByRole('button', { name: /iniciar treinamento/i }));

    for (const stage of WIZARD_STAGES) {
      fireEvent.click(
        screen.getByRole('button', { name: new RegExp(`registrar etapa: ${STAGE_LABELS[stage]}`, 'i') }),
      );
    }
    fireEvent.click(screen.getByRole('button', { name: /publicar \(simulado\)/i }));
    fireEvent.click(screen.getByRole('button', { name: /restaurar \(ensaio\)/i }));
    fireEvent.click(screen.getByRole('button', { name: /concluir treinamento/i }));

    // Isolamento: os dados reais passados por prop nao mudaram.
    expect(screen.getByTestId('isolation')).toHaveTextContent(/isolamento verificado/i);
    // Cobertura completa das etapas exigidas.
    expect(screen.getByTestId('coverage-complete')).toBeInTheDocument();
    // Publicacao simulada registrada.
    expect(screen.getByText(/publicacoes simuladas: 1/i)).toBeInTheDocument();
  });

  it('antes de completar o percurso, aponta etapas faltantes', () => {
    render(<TrainingPanel realOperational={{}} realPublic={{}} now={clock} />);
    fireEvent.click(screen.getByRole('button', { name: /iniciar treinamento/i }));
    // So a abertura foi registrada no start; faltam etapas.
    expect(screen.getByRole('note')).toHaveTextContent(/faltam registrar/i);
  });
});
