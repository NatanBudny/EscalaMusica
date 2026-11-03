import { describe, expect, it } from 'vitest';

import {
  defaultRecordValidator,
  isCompletePartition,
  neverResolvesAmbiguous,
  resolveIdentityMatches,
  runImportPipeline,
  type ImportBatch,
  type RecordValidator,
} from './importPipeline';
import type { IdentitySubject } from '../registry/identity';

// --------------------------------------------------------------------------
// Fixtures de cadastro (sujeitos do namespace de identidade)
// --------------------------------------------------------------------------

const andre: IdentitySubject = {
  id: 'p-andre',
  kind: 'person',
  canonicalName: 'André',
  aliases: ['Andre Silva'],
};
const dani: IdentitySubject = {
  id: 'p-dani',
  kind: 'person',
  canonicalName: 'Dani',
  aliases: [],
};
// Dois sujeitos distintos com o mesmo nome -> ambiguidade real.
const anaA: IdentitySubject = { id: 'p-ana-1', kind: 'person', canonicalName: 'Ana', aliases: [] };
const anaB: IdentitySubject = { id: 'p-ana-2', kind: 'person', canonicalName: 'Ana', aliases: [] };
const louvor: IdentitySubject = {
  id: 'd-louvor',
  kind: 'department',
  canonicalName: 'Departamento de Louvor',
  aliases: ['Louvor'],
};

const SUBJECTS: IdentitySubject[] = [andre, dani, louvor];

function batch(records: ImportBatch['records'], sourceFile = 'lote.json'): ImportBatch {
  return { sourceFile, records };
}

// --------------------------------------------------------------------------
// resolveIdentityMatches — identidade exata, nunca fuzzy
// --------------------------------------------------------------------------

describe('resolveIdentityMatches', () => {
  it('encontra correspondencia unica por nome canonico (insensivel a caixa/espacos)', () => {
    expect(resolveIdentityMatches('  andré  ', SUBJECTS)).toEqual(['p-andre']);
  });

  it('encontra correspondencia unica por alias', () => {
    expect(resolveIdentityMatches('Andre Silva', SUBJECTS)).toEqual(['p-andre']);
    expect(resolveIdentityMatches('louvor', SUBJECTS)).toEqual(['d-louvor']);
  });

  it('retorna vazio quando nao ha correspondencia (sem fuzzy)', () => {
    // "Andr" e proximo de "André", mas NAO corresponde: nunca fuzzy.
    expect(resolveIdentityMatches('Andr', SUBJECTS)).toEqual([]);
    expect(resolveIdentityMatches('Daniel', SUBJECTS)).toEqual([]);
  });

  it('retorna todos os sujeitos quando o nome e ambiguo', () => {
    expect(resolveIdentityMatches('Ana', [anaA, anaB])).toEqual(['p-ana-1', 'p-ana-2']);
  });
});

// --------------------------------------------------------------------------
// Validacao de lote atomica (9.5-9.7)
// --------------------------------------------------------------------------

describe('runImportPipeline - validacao de lote atomica (9.5-9.7)', () => {
  it('rejeita o lote inteiro quando um unico registro e invalido e nao aplica nada', () => {
    const result = runImportPipeline(
      batch([
        { position: 'linha 1', name: 'André' },
        { position: 'linha 2', name: '   ' }, // invalido: nome vazio
        { position: 'linha 3', name: 'Dani' },
      ]),
      SUBJECTS,
    );

    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        sourceFile: 'lote.json',
        position: 'linha 2',
        field: 'name',
      });
      // Nada aplicado: totais somam o lido, zero em todas as categorias.
      expect(result.totals).toEqual({ read: 3, imported: 0, transformed: 0, rejected: 0, pending: 0 });
    }
  });

  it('informa arquivo, posicao, campo e motivo para cada valor invalido (9.7)', () => {
    const result = runImportPipeline(
      batch(
        [
          { position: 'item[0]', name: '' },
          { position: '', name: 'Dani' },
        ],
        'externos.json',
      ),
      SUBJECTS,
    );
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sourceFile: 'externos.json', position: 'item[0]', field: 'name' }),
          expect.objectContaining({ sourceFile: 'externos.json', position: '', field: 'position' }),
        ]),
      );
    }
  });

  it('usa validador de formato customizado e rejeita o lote quando um campo falha', () => {
    const strict: RecordValidator = (r) =>
      (r.payload?.['date'] as string | undefined) === undefined
        ? [{ field: 'date', reason: 'data obrigatoria ausente' }]
        : [];
    const result = runImportPipeline(
      batch([
        { position: '1', name: 'André', payload: { date: '2026-02-04' } },
        { position: '2', name: 'Dani' }, // sem date
      ]),
      SUBJECTS,
      { validateRecord: strict },
    );
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({ position: '2', field: 'date' });
    }
  });
});

// --------------------------------------------------------------------------
// Resolucao de identidade e classificacao (4.12-4.14, 9.13, 9.14)
// --------------------------------------------------------------------------

describe('runImportPipeline - classificacao por item', () => {
  it('classifica como imported quando ha correspondencia unica', () => {
    const result = runImportPipeline(
      batch([{ position: '1', name: 'André' }]),
      SUBJECTS,
    );
    expect(result.applied).toBe(true);
    if (result.applied) {
      expect(result.items[0]!.item.classification).toBe('imported');
      expect(result.items[0]!.candidateSubjectIds).toEqual(['p-andre']);
      expect(result.totals).toEqual({ read: 1, imported: 1, transformed: 0, rejected: 0, pending: 0 });
    }
  });

  it('mantem pendente nome sem correspondencia e nao cria associacao (4.13, 9.14)', () => {
    const result = runImportPipeline(
      batch([{ position: '1', name: 'Fulano Inexistente' }]),
      SUBJECTS,
    );
    expect(result.applied).toBe(true);
    if (result.applied) {
      const item = result.items[0]!;
      expect(item.item.classification).toBe('pending');
      expect(item.candidateSubjectIds).toEqual([]);
      expect(item.item.reason).toContain('nenhuma correspondencia');
      expect(item.item.affectedFields).toEqual(['name']);
    }
  });

  it('mantem pendente nome ambiguo e expoe as opcoes sem escolher (4.12, 9.14)', () => {
    const result = runImportPipeline(
      batch([{ position: '1', name: 'Ana' }]),
      [anaA, anaB],
    );
    expect(result.applied).toBe(true);
    if (result.applied) {
      const item = result.items[0]!;
      expect(item.item.classification).toBe('pending');
      // Expoe as opcoes, mas nao escolhe nenhuma.
      expect(item.candidateSubjectIds).toEqual(['p-ana-1', 'p-ana-2']);
      expect(item.item.reason).toContain('multiplas correspondencias');
    }
  });

  it('classifica como transformed quando o predicado indica transformacao', () => {
    const result = runImportPipeline(
      batch([{ position: '1', name: 'André' }]),
      SUBJECTS,
      { needsTransform: () => true },
    );
    expect(result.applied).toBe(true);
    if (result.applied) {
      expect(result.items[0]!.item.classification).toBe('transformed');
      expect(result.totals.transformed).toBe(1);
      expect(result.totals.imported).toBe(0);
    }
  });

  it('o cenario real André/Dani nunca associa André ao cadastro de Dani', () => {
    // Regressao do bug legado: fuzzy associava "Andre" ao registro errado.
    const result = runImportPipeline(
      batch([{ position: '1', name: 'Andre' }]), // sem acento, nao casa com "André"
      SUBJECTS,
    );
    expect(result.applied).toBe(true);
    if (result.applied) {
      // Nao casa exatamente com "André" nem com "Dani": permanece pendente.
      expect(result.items[0]!.item.classification).toBe('pending');
      expect(result.items[0]!.candidateSubjectIds).not.toContain('p-dani');
    }
  });

  it('produz particao completa com mistura de classificacoes (4.14, 9.13)', () => {
    const result = runImportPipeline(
      batch([
        { position: '1', name: 'André' }, // imported
        { position: '2', name: 'Louvor' }, // imported (depto)
        { position: '3', name: 'Desconhecido' }, // pending (0)
      ]),
      SUBJECTS,
    );
    expect(result.applied).toBe(true);
    if (result.applied) {
      expect(result.totals).toEqual({ read: 3, imported: 2, transformed: 0, rejected: 0, pending: 1 });
      expect(isCompletePartition(result)).toBe(true);
      expect(neverResolvesAmbiguous(result)).toBe(true);
    }
  });

  it('gera ids de item deterministicos e estaveis entre execucoes', () => {
    const b = batch([{ position: 'linha 7', name: 'André' }], 'arq.json');
    const r1 = runImportPipeline(b, SUBJECTS);
    const r2 = runImportPipeline(b, SUBJECTS);
    expect(r1).toEqual(r2);
    if (r1.applied) {
      expect(r1.items[0]!.item.id).toBe('import:arq.json#linha 7');
    }
  });

  it('lote vazio produz relatorio aplicado com totais zerados', () => {
    const result = runImportPipeline(batch([]), SUBJECTS);
    expect(result.applied).toBe(true);
    expect(result.totals).toEqual({ read: 0, imported: 0, transformed: 0, rejected: 0, pending: 0 });
    expect(isCompletePartition(result)).toBe(true);
  });
});

// --------------------------------------------------------------------------
// defaultRecordValidator
// --------------------------------------------------------------------------

describe('defaultRecordValidator', () => {
  it('aceita registro com nome e posicao validos', () => {
    expect(defaultRecordValidator({ position: '1', name: 'Dani' })).toEqual([]);
  });

  it('rejeita nome vazio e posicao vazia', () => {
    const errors = defaultRecordValidator({ position: '  ', name: '' });
    expect(errors.map((e) => e.field).sort()).toEqual(['name', 'position']);
  });
});
