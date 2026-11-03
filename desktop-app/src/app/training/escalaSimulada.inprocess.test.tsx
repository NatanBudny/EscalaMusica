// Percurso E2E in-process da "Escala Simulada" (tarefa 16.4).
//
// Objetivo (Requisitos 1.1-1.3, 1.9, 15.12-15.14): automatizar, pela interface,
// o percurso COMPLETO do modo de treinamento — abertura, coleta, sugestao,
// revisao manual, validacao, aprovacao, publicacao SIMULADA, fechamento e
// restauracao — exercitando SOMENTE os controles (sem terminal, sem JSON) e
// comprovando o ISOLAMENTO: os hashes dos dados reais permanecem inalterados do
// inicio ao fim.
//
// Este teste e o EQUIVALENTE IN-PROCESS do E2E desktop (Playwright), que fica
// guardado em `escalaSimulada.e2e.test.ts` ate a homologacao (driver + app
// empacotada). Aqui driblamos a dependencia de navegador/driver executando a
// mesma logica observavel atraves do `TrainingPanel` (React Testing Library).
//
// Requisitos: 1.1-1.3, 1.9, 15.12-15.14.

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TrainingPanel } from './TrainingPanel';
import { WIZARD_STAGES, STAGE_LABELS } from '../wizard/wizardState';
import { canonicalHash } from '../../domain/schemas/canonical';

const AT = '2099-01-01T00:00:00Z';

describe('16.4 — Escala Simulada (percurso E2E in-process)', () => {
  it('percorre todas as etapas pelos controles, publica simulado, restaura e conclui — isolamento preservado', () => {
    // Estado REAL imutavel: fixamos o hash antes do exercicio.
    const realOperational = { pessoas: ['PESSOA REAL'], ciclos: ['2026-02'] };
    const realPublic = { atual: [{ DATA: '07/02/2026', REGENTE: 'REAL' }] };
    const hashOperacionalAntes = canonicalHash(realOperational);
    const hashPublicoAntes = canonicalHash(realPublic);

    render(
      <TrainingPanel realOperational={realOperational} realPublic={realPublic} now={() => AT} />,
    );

    // 1) Abertura do treino (fixtures ficticias).
    fireEvent.click(screen.getByRole('button', { name: /iniciar treinamento/i }));
    expect(screen.getByText(/FULANO DE TESTE/i)).toBeInTheDocument();

    // 2) Percorre as sete etapas (abertura, coleta, montagem/sugestao, validacao,
    //    aprovacao, publicacao, fechamento) usando SOMENTE os controles.
    for (const stage of WIZARD_STAGES) {
      fireEvent.click(
        screen.getByRole('button', {
          name: new RegExp(`registrar etapa: ${STAGE_LABELS[stage]}`, 'i'),
        }),
      );
    }

    // 3) Publicacao SIMULADA (nunca toca a rede real) + restauracao + conclusao.
    fireEvent.click(screen.getByRole('button', { name: /publicar \(simulado\)/i }));
    fireEvent.click(screen.getByRole('button', { name: /restaurar \(ensaio\)/i }));
    fireEvent.click(screen.getByRole('button', { name: /concluir treinamento/i }));

    // 4a) Cobertura: todas as etapas + restauracao + conclusao foram registradas.
    expect(screen.getByTestId('coverage-complete')).toBeInTheDocument();
    // 4b) Publicacao simulada registrada (contingente ao destino simulado).
    expect(screen.getByText(/publicacoes simuladas: 1/i)).toBeInTheDocument();
    // 4c) Isolamento verificado pela UI.
    expect(screen.getByTestId('isolation')).toHaveTextContent(/isolamento verificado/i);

    // 5) Prova objetiva de isolamento: os objetos reais e seus hashes nao mudaram.
    expect(canonicalHash(realOperational)).toBe(hashOperacionalAntes);
    expect(canonicalHash(realPublic)).toBe(hashPublicoAntes);
  });
});
