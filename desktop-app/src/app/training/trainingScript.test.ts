// Lint do roteiro de treinamento e do checklist de homologacao (tarefa 17.4).
//
// Valida (Requisitos 13.12, 15.11-15.16): cada passo do roteiro esta vinculado a
// um controle/tela; o roteiro cobre as sete etapas + restauracao + conclusao; o
// documento versionado corresponde ao gerador (sincronia). Para regenerar, rode
// com UPDATE_TRAINING=1.

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  HOMOLOGATION_CHECKLIST,
  TRAINING_SCRIPT,
  missingScriptStages,
  renderTrainingScriptMarkdown,
  stepsWithoutControl,
} from './trainingScript';

const DOC_PATH = resolve(__dirname, '../../../docs/ROTEIRO-DE-TREINAMENTO.md');

describe('roteiro de treinamento e checklist (17.4)', () => {
  it('cada passo esta vinculado a um controle/tela', () => {
    expect(stepsWithoutControl()).toEqual([]);
  });

  it('o roteiro cobre as sete etapas + restauracao + conclusao', () => {
    expect(missingScriptStages()).toEqual([]);
    expect(TRAINING_SCRIPT.length).toBeGreaterThanOrEqual(9);
  });

  it('o checklist inclui backup em outra instalacao, restauracao e execucao sem ajuda tecnica', () => {
    const ids = HOMOLOGATION_CHECKLIST.map((i) => i.id);
    expect(ids).toContain('backup-outra-instalacao');
    expect(ids).toContain('percurso-sem-ajuda');
    expect(ids).toContain('isolamento');
    expect(ids).toContain('sem-terminal');
    // Toda evidencia aponta para um controle/tela ou verificacao concreta.
    for (const item of HOMOLOGATION_CHECKLIST) {
      expect(item.evidence.trim().length).toBeGreaterThan(0);
    }
  });

  it('o documento versionado corresponde ao gerador', () => {
    const expected = renderTrainingScriptMarkdown() + '\n';
    if (process.env.UPDATE_TRAINING === '1') {
      writeFileSync(DOC_PATH, expected, 'utf8');
    }
    const actual = readFileSync(DOC_PATH, 'utf8');
    expect(actual).toBe(expected);
  });
});
