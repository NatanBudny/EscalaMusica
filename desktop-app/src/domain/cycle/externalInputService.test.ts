import { describe, expect, it } from 'vitest';
import {
  EXTERNAL_INPUT_LIMITS,
  ExternalInputService,
  buildConfirmationSummary,
  type Provenance,
  type RegisterExternalInput,
} from './externalInputService';
import type { ExternalInputType } from '../schemas/models';

// Proveniencia valida reutilizavel (Requisito 4.8).
const PROV: Provenance = {
  source: 'PDF anciaos 2026-02',
  operatorId: 'op-1',
  updatedAt: '2026-02-01T10:00:00Z',
};

const SERVICE = 'svc-1';

function reg<T extends ExternalInputType>(
  id: string,
  type: T,
  value: RegisterExternalInput<T>['value'],
  provenance: Provenance = PROV,
): RegisterExternalInput<T> {
  return { id, serviceId: SERVICE, type, value, provenance };
}

/** String de comprimento exato preenchida com 'a'. */
const str = (n: number): string => 'a'.repeat(n);

describe('ExternalInputService - proveniencia obrigatoria (Requisito 4.8)', () => {
  it('rejeita insumo sem fonte (nenhuma mutacao)', () => {
    const svc = new ExternalInputService();
    const r = svc.register(
      reg('i1', 'theme', { text: 'Gratidao' }, { ...PROV, source: '   ' }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('missing-provenance');
    expect(svc.snapshot().inputs).toHaveLength(0);
  });

  it('rejeita insumo sem operador', () => {
    const svc = new ExternalInputService();
    const r = svc.register(reg('i1', 'theme', { text: 'Gratidao' }, { ...PROV, operatorId: '' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('missing-provenance');
  });

  it('rejeita insumo sem data de atualizacao', () => {
    const svc = new ExternalInputService();
    const r = svc.register(reg('i1', 'theme', { text: 'Gratidao' }, { ...PROV, updatedAt: '' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('missing-provenance');
  });

  it('salva fonte, data e operador quando a proveniencia e valida', () => {
    const svc = new ExternalInputService();
    const r = svc.register(reg('i1', 'theme', { text: 'Gratidao' }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.source).toBe(PROV.source);
      expect(r.value.operatorId).toBe(PROV.operatorId);
      expect(r.value.updatedAt).toBe(PROV.updatedAt);
    }
  });
});

describe('ExternalInputService - observacao exige classificacao (Requisito 4.7)', () => {
  it('rejeita observacao sem classificacao (nenhuma mutacao)', () => {
    const svc = new ExternalInputService();
    const r = svc.register(
      reg('o1', 'observation', { text: 'Avisar sobre ensaio' } as never),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('observation-missing-classification');
    expect(svc.snapshot().inputs).toHaveLength(0);
  });

  it('aceita observacao publica e deriva visibilidade public', () => {
    const svc = new ExternalInputService();
    const r = svc.register(
      reg('o1', 'observation', { text: 'Culto especial', classification: 'public' }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.visibility).toBe('public');
  });

  it('aceita observacao privada e deriva visibilidade private', () => {
    const svc = new ExternalInputService();
    const r = svc.register(
      reg('o1', 'observation', { text: 'Nota interna', classification: 'private' }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.visibility).toBe('private');
  });
});

describe('ExternalInputService - anciao e pregador (Requisitos 4.1, 4.2)', () => {
  it('anciao exige uma Pessoa_Canonica', () => {
    const svc = new ExternalInputService();
    const bad = svc.register(reg('e1', 'elder', { personId: '' }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('elder-missing-person');

    const good = svc.register(reg('e2', 'elder', { personId: 'p-1' }));
    expect(good.ok).toBe(true);
  });

  it('pregador aceita pessoa ou departamento', () => {
    const svc = new ExternalInputService();
    const person = svc.register(reg('pr1', 'preacher', { subject: { type: 'person', id: 'p-1' } }));
    expect(person.ok).toBe(true);
    const dept = svc.register(
      reg('pr2', 'preacher', { subject: { type: 'department', id: 'd-1' } }),
    );
    expect(dept.ok).toBe(true);
  });

  it('pregador rejeita sujeito ausente', () => {
    const svc = new ExternalInputService();
    const r = svc.register(reg('pr1', 'preacher', { subject: { type: 'person', id: '' } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('preacher-missing-subject');
  });
});

describe('ExternalInputService - audiovisual/sonoplastia 1..20 (Requisito 4.3)', () => {
  it('rejeita 0 pessoas (abaixo do minimo)', () => {
    const svc = new ExternalInputService();
    const r = svc.register(reg('a1', 'audio', { personIds: [] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('audio-cardinality');
  });

  it('aceita 1 pessoa (borda inferior)', () => {
    const svc = new ExternalInputService();
    const r = svc.register(reg('a1', 'audio', { personIds: ['p-1'] }));
    expect(r.ok).toBe(true);
  });

  it('aceita 20 pessoas (borda superior)', () => {
    const svc = new ExternalInputService();
    const ids = Array.from({ length: EXTERNAL_INPUT_LIMITS.audioMax }, (_, i) => `p-${i}`);
    const r = svc.register(reg('a1', 'audio', { personIds: ids }));
    expect(r.ok).toBe(true);
  });

  it('rejeita 21 pessoas (acima do maximo)', () => {
    const svc = new ExternalInputService();
    const ids = Array.from({ length: EXTERNAL_INPUT_LIMITS.audioMax + 1 }, (_, i) => `p-${i}`);
    const r = svc.register(reg('a1', 'audio', { personIds: ids }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('audio-cardinality');
  });

  it('rejeita pessoa repetida', () => {
    const svc = new ExternalInputService();
    const r = svc.register(reg('a1', 'audio', { personIds: ['p-1', 'p-1'] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('audio-duplicate');
  });
});

describe('ExternalInputService - musica ES e pedido (Requisitos 4.4, 4.6)', () => {
  it('titulo da musica: aceita 1 e 200, rejeita 0 e 201', () => {
    const svc = new ExternalInputService();
    expect(svc.register(reg('m1', 'sabbath-school-song', { title: str(1) })).ok).toBe(true);
    expect(svc.register(reg('m2', 'sabbath-school-song', { title: str(200) })).ok).toBe(true);
    expect(svc.register(reg('m3', 'sabbath-school-song', { title: str(0) })).ok).toBe(false);
    expect(svc.register(reg('m4', 'sabbath-school-song', { title: str(201) })).ok).toBe(false);
  });

  it('pedido de musica: aceita 1 e 200, rejeita 0 e 201 caracteres', () => {
    const svc = new ExternalInputService();
    expect(svc.register(reg('r1', 'song-request', { description: str(1) })).ok).toBe(true);
    expect(svc.register(reg('r2', 'song-request', { description: str(200) })).ok).toBe(true);
    expect(svc.register(reg('r3', 'song-request', { description: str(0) })).ok).toBe(false);
    expect(svc.register(reg('r4', 'song-request', { description: str(201) })).ok).toBe(false);
  });
});

describe('ExternalInputService - tema do culto 1..200 (Requisito 4.5)', () => {
  it('aceita 1 e 200, rejeita 0 e 201 caracteres', () => {
    const svc = new ExternalInputService();
    expect(svc.register(reg('t1', 'theme', { text: str(1) })).ok).toBe(true);
    expect(svc.register(reg('t2', 'theme', { text: str(200) })).ok).toBe(true);
    expect(svc.register(reg('t3', 'theme', { text: str(0) })).ok).toBe(false);
    expect(svc.register(reg('t4', 'theme', { text: str(201) })).ok).toBe(false);
  });
});

describe('ExternalInputService - conferencia antes de confirmar (Requisito 4.20)', () => {
  it('validate nao salva e retorna o resumo de conferencia', () => {
    const svc = new ExternalInputService();
    const r = svc.validate(reg('t1', 'theme', { text: 'Fe e obras' }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.typeLabel).toBe('Tema do culto');
      expect(r.value.source).toBe(PROV.source);
      expect(r.value.lines.join(' ')).toContain('Fe e obras');
    }
    // Nada foi salvo.
    expect(svc.snapshot().inputs).toHaveLength(0);
  });

  it('o resumo da observacao inclui a classificacao', () => {
    const summary = buildConfirmationSummary(
      reg('o1', 'observation', { text: 'Aviso', classification: 'public' }),
    );
    expect(summary.classification).toBe('public');
    expect(summary.lines.join(' ')).toContain('publica');
  });

  it('validate falha quando o insumo e invalido (conferencia revela o erro)', () => {
    const svc = new ExternalInputService();
    const r = svc.validate(reg('a1', 'audio', { personIds: [] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('audio-cardinality');
  });
});

describe('ExternalInputService - PDF apenas referencia e estado imutavel', () => {
  it('o servico armazena insumos digitados; nao ha parsing de PDF (sem fonte de dados externa)', () => {
    const svc = new ExternalInputService();
    // Toda entrada e um valor digitado tipado; nao existe caminho que aceite
    // "arquivo PDF" como fonte de dados.
    const r = svc.register(reg('e1', 'elder', { personId: 'p-1' }));
    expect(r.ok).toBe(true);
    const byService = svc.forService(SERVICE);
    expect(byService).toHaveLength(1);
    expect(byService[0]!.type).toBe('elder');
  });

  it('nao muta o snapshot retornado (copia defensiva)', () => {
    const svc = new ExternalInputService();
    svc.register(reg('e1', 'elder', { personId: 'p-1' }));
    const snap = svc.snapshot();
    // Mutar o valor retornado nao afeta o estado interno (copia defensiva).
    (snap.inputs[0]!.value as { personId: string }).personId = 'ADULTERADO';
    const fresh = svc.snapshot();
    expect((fresh.inputs[0]!.value as { personId: string }).personId).toBe('p-1');
  });

  it('rejeita id duplicado preservando o primeiro', () => {
    const svc = new ExternalInputService();
    expect(svc.register(reg('x', 'theme', { text: 'A' })).ok).toBe(true);
    const dup = svc.register(reg('x', 'theme', { text: 'B' }));
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe('duplicate-id');
    expect(svc.snapshot().inputs).toHaveLength(1);
  });
});
