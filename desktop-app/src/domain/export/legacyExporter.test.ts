// Testes unitarios do LegacyExporter (tarefa 9.2).
//
// Validacao objetiva: o artefato produzido (atual.json/contatos.json) satisfaz
// o contrato consumido pelo Visualizador_Atual (chaves, tipos, datas DD/MM/YYYY,
// delimitadores, forma wa.me, ordem) — os mesmos contratos congelados em
// tests/baseline. Nomes com delimitador ambiguo e telefones invalidos sao
// rejeitados sem produzir saida ambigua.
//
// Requisitos: 9.1, 9.2, 9.3, 9.8, 9.9, 9.10, 10.7, 10.16, 16.1, 16.2.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type {
  PublicAssignment,
  PublicContactDTO,
  PublicProjectionDTO,
  PublicServiceDTO,
} from '../projection/publicProjection';
import type { Weekday } from '../schemas/models';
import { ATUAL_KEYS, exportLegacy, waMeFromE164, type LegacyExportConfig } from './legacyExporter';

// --------------------------------------------------------------------------
// Contrato do visualizador (espelha tests/baseline/legacy-contract.test.js)
// --------------------------------------------------------------------------

const DATE_RE = /^\d{2}\/\d{2}\/\d{4}$/;
const WA_RE = /^https:\/\/wa\.me\/\d{8,15}$/;

function assertAtualContract(dados: readonly Record<string, unknown>[]): void {
  expect(Array.isArray(dados)).toBe(true);
  for (const rec of dados) {
    for (const key of ATUAL_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(rec, key)).toBe(true);
      expect(typeof rec[key]).toBe('string');
    }
    expect(rec['DATA']).toMatch(DATE_RE);
    expect(String(rec['DIA SEMANA']).trim().length).toBeGreaterThan(0);
  }
}

function assertContatosContract(contatos: Record<string, { telefone: string; apelidos: unknown }>): void {
  expect(typeof contatos).toBe('object');
  expect(Array.isArray(contatos)).toBe(false);
  for (const nome of Object.keys(contatos)) {
    const entry = contatos[nome]!;
    expect(typeof entry.telefone).toBe('string');
    expect(Array.isArray(entry.apelidos)).toBe(true);
    expect(entry.telefone).toMatch(WA_RE);
    for (const alias of entry.apelidos as unknown[]) expect(typeof alias).toBe('string');
  }
}

// --------------------------------------------------------------------------
// IDs de funcao -> colunas legadas (contrato de compatibilidade)
// --------------------------------------------------------------------------

const ROLE = {
  acomp: 'r-acomp',
  regente: 'r-regente',
  equipe: 'r-equipe',
  mensagem: 'r-mensagem',
  audiovisual: 'r-audiovisual',
  anciao: 'r-anciao',
  pregador: 'r-pregador',
  suporte: 'r-suporte',
} as const;

const CONFIG: LegacyExportConfig = {
  columns: {
    roleColumns: {
      [ROLE.acomp]: 'ACOMP',
      [ROLE.regente]: 'REGENTE LOUVOR',
      [ROLE.equipe]: 'EQUIPE LOUVOR',
      [ROLE.mensagem]: 'MENSAGEM MUSICAL',
      [ROLE.audiovisual]: 'AUDIOVISUAL',
      [ROLE.anciao]: 'ANCIÃO',
      [ROLE.pregador]: 'PREGADOR',
      [ROLE.suporte]: 'SUPORTE',
    },
    fieldColumns: {
      theme: 'TEMA CULTO',
      'sabbath-school-song': 'LOUVORES ES',
      'song-request': 'LOUVORES CULTO',
      observation: 'OBS',
      TEMA: 'TEMA CULTO',
    },
    listColumns: ['EQUIPE LOUVOR', 'MENSAGEM MUSICAL'],
    songColumns: ['LOUVORES ES', 'LOUVORES CULTO'],
  },
};

// --------------------------------------------------------------------------
// Builders
// --------------------------------------------------------------------------

function a(roleId: string, name: string, type: PublicAssignment['subjectType'] = 'person'): PublicAssignment {
  return { serviceId: 's', roleId, name, subjectType: type };
}

function svc(partial: Partial<PublicServiceDTO> & { serviceId: string; date: string; weekday: Weekday }): PublicServiceDTO {
  return {
    serviceId: partial.serviceId,
    date: partial.date,
    weekday: partial.weekday,
    kind: partial.kind ?? 'regular',
    publicFields: partial.publicFields ?? {},
    publicInputs: partial.publicInputs ?? [],
    assignments: partial.assignments ?? [],
  };
}

function contact(subjectId: string, canonicalName: string, phoneE164?: string, aliases: string[] = []): PublicContactDTO {
  return phoneE164 === undefined
    ? { subjectId, canonicalName, aliases }
    : { subjectId, canonicalName, aliases, phoneE164 };
}

// --------------------------------------------------------------------------
// atual.json
// --------------------------------------------------------------------------

describe('exportLegacy — atual.json', () => {
  it('produz registros com as 14 chaves, datas DD/MM/YYYY e DIA SEMANA legado', () => {
    const dto: PublicProjectionDTO = {
      period: '2026-08',
      services: [
        svc({
          serviceId: 's1',
          date: '2026-08-05',
          weekday: 'wednesday',
          assignments: [
            a(ROLE.acomp, 'PB'),
            a(ROLE.anciao, 'MARCOS'),
            a(ROLE.pregador, 'ROSANA'),
          ],
        }),
      ],
      contacts: [],
    };

    const res = exportLegacy(dto, CONFIG);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    assertAtualContract(res.atual.value);
    const rec = res.atual.value[0]!;
    expect(rec['DATA']).toBe('05/08/2026');
    expect(rec['DIA SEMANA']).toBe('quarta-feira');
    expect(rec['ACOMP']).toBe('PB');
    expect(rec['ANCIÃO']).toBe('MARCOS');
    expect(rec['PREGADOR']).toBe('ROSANA');
    // Colunas sem valor permanecem presentes e vazias.
    expect(rec['LOUVORES ES']).toBe('');
    expect(rec['OBS']).toBe('');
  });

  it('agrega equipe por ", " e musicas por " | "', () => {
    const dto: PublicProjectionDTO = {
      period: '2026-08',
      services: [
        svc({
          serviceId: 's2',
          date: '2026-08-09',
          weekday: 'sunday',
          assignments: [
            a(ROLE.equipe, 'MARIA HELOISA'),
            a(ROLE.equipe, 'LUIZ ANTONIO'),
            a(ROLE.equipe, 'DANY KALLAS'),
          ],
          publicInputs: [
            { type: 'song-request', value: ['128 - Cristo, minha seguranca', '15 - Grandioso es Tu'] },
            { type: 'theme', value: 'A GRACA DE DEUS' },
          ],
        }),
      ],
      contacts: [],
    };

    const res = exportLegacy(dto, CONFIG);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const rec = res.atual.value[0]!;
    expect(rec['EQUIPE LOUVOR']).toBe('MARIA HELOISA, LUIZ ANTONIO, DANY KALLAS');
    expect(rec['LOUVORES CULTO']).toBe('128 - Cristo, minha seguranca | 15 - Grandioso es Tu');
    expect(rec['TEMA CULTO']).toBe('A GRACA DE DEUS');
  });

  it('ordena os registros cronologicamente pela data', () => {
    const dto: PublicProjectionDTO = {
      period: '2026-08',
      services: [
        svc({ serviceId: 's-c', date: '2026-08-15', weekday: 'saturday', assignments: [a(ROLE.anciao, 'C')] }),
        svc({ serviceId: 's-a', date: '2026-08-05', weekday: 'wednesday', assignments: [a(ROLE.anciao, 'A')] }),
        svc({ serviceId: 's-b', date: '2026-08-09', weekday: 'sunday', assignments: [a(ROLE.anciao, 'B')] }),
      ],
      contacts: [],
    };

    const res = exportLegacy(dto, CONFIG);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.atual.value.map((r) => r['DATA'])).toEqual(['05/08/2026', '09/08/2026', '15/08/2026']);
  });

  it('rejeita nome com delimitador ambiguo (", ")', () => {
    const dto: PublicProjectionDTO = {
      period: '2026-08',
      services: [
        svc({
          serviceId: 's3',
          date: '2026-08-05',
          weekday: 'wednesday',
          assignments: [a(ROLE.equipe, 'JOAO, MARIA')], // nome contem o delimitador
        }),
      ],
      contacts: [],
    };

    const res = exportLegacy(dto, CONFIG);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.blocks.some((b) => b.code === 'ambiguous-delimiter')).toBe(true);
  });

  it('rejeita valor de musica com delimitador ambiguo (" | ")', () => {
    const dto: PublicProjectionDTO = {
      period: '2026-08',
      services: [
        svc({
          serviceId: 's4',
          date: '2026-08-05',
          weekday: 'wednesday',
          publicInputs: [{ type: 'song-request', value: '1 - Hino A | com barra' }],
        }),
      ],
      contacts: [],
    };

    const res = exportLegacy(dto, CONFIG);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.blocks.some((b) => b.code === 'ambiguous-delimiter')).toBe(true);
  });

  it('rejeita data fora do formato ISO', () => {
    const dto: PublicProjectionDTO = {
      period: '2026-08',
      services: [svc({ serviceId: 's5', date: '05/08/2026', weekday: 'wednesday' })],
      contacts: [],
    };
    const res = exportLegacy(dto, CONFIG);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.blocks.some((b) => b.code === 'invalid-date')).toBe(true);
  });
});

// --------------------------------------------------------------------------
// contatos.json
// --------------------------------------------------------------------------

describe('exportLegacy — contatos.json', () => {
  it('indexa por nome, deriva wa.me do E.164 e preserva aliases', () => {
    const dto: PublicProjectionDTO = {
      period: '2026-08',
      services: [],
      contacts: [
        contact('p1', 'ANDRE', '+5543920008370'),
        contact('p2', 'DANY KALLAS', '+554399990001', ['DANI']),
      ],
    };

    const res = exportLegacy(dto, CONFIG);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    assertContatosContract(res.contatos.value);
    expect(res.contatos.value['ANDRE']).toEqual({
      telefone: 'https://wa.me/5543920008370',
      apelidos: [],
    });
    expect(res.contatos.value['DANY KALLAS']).toEqual({
      telefone: 'https://wa.me/554399990001',
      apelidos: ['DANI'],
    });
  });

  it('omite pessoa sem telefone autorizado (projecao ja removeu o telefone)', () => {
    const dto: PublicProjectionDTO = {
      period: '2026-08',
      services: [],
      contacts: [contact('p1', 'SEM TELEFONE' /* phone undefined */)],
    };
    const res = exportLegacy(dto, CONFIG);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(Object.keys(res.contatos.value)).toHaveLength(0);
  });

  it('rejeita telefone fora de E.164', () => {
    const blocks: Parameters<typeof waMeFromE164>[2] = [];
    expect(waMeFromE164('5543999', 'p', blocks)).toBeUndefined();
    expect(blocks[0]?.code).toBe('invalid-phone');
    expect(waMeFromE164('+5543920008370', 'p', [])).toBe('https://wa.me/5543920008370');
  });

  it('rejeita colisao de nome canonico', () => {
    const dto: PublicProjectionDTO = {
      period: '2026-08',
      services: [],
      contacts: [contact('p1', 'JOAO', '+554399990001'), contact('p2', 'JOAO', '+554399990002')],
    };
    const res = exportLegacy(dto, CONFIG);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.blocks.some((b) => b.code === 'duplicate-contact-name')).toBe(true);
  });
});

// --------------------------------------------------------------------------
// Compatibilidade de contrato + determinismo (9.3, 9.8, 9.10, 10.16)
// --------------------------------------------------------------------------

describe('exportLegacy — contrato do visualizador e determinismo', () => {
  function fullDto(): PublicProjectionDTO {
    return {
      period: '2026-08',
      services: [
        svc({
          serviceId: 's1',
          date: '2026-08-08',
          weekday: 'saturday',
          assignments: [
            a(ROLE.acomp, 'BANDA'),
            a(ROLE.regente, 'ANDRE'),
            a(ROLE.equipe, 'LUIZ ANTONIO'),
            a(ROLE.equipe, 'ARIADNY'),
            a(ROLE.audiovisual, 'ALEX'),
            a(ROLE.anciao, 'RICARDO'),
            a(ROLE.pregador, 'MORDOMIA'),
          ],
          publicInputs: [{ type: 'theme', value: 'MORDOMIA' }],
        }),
      ],
      contacts: [
        contact('p1', 'ANDRE', '+5543920008370'),
        contact('p2', 'ALEX', '+554396849723'),
        contact('p3', 'ARIADNY', '+554396158329'),
      ],
    };
  }

  it('o artefato satisfaz os contratos de atual.json e contatos.json', () => {
    const res = exportLegacy(fullDto(), CONFIG);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    assertAtualContract(res.atual.value);
    assertContatosContract(res.contatos.value);

    // O artefato e parseavel exatamente como o visualizador espera.
    const atualParsed = JSON.parse(new TextDecoder().decode(res.atual.bytes));
    const contatosParsed = JSON.parse(new TextDecoder().decode(res.contatos.bytes));
    assertAtualContract(atualParsed);
    assertContatosContract(contatosParsed);
  });

  it('entradas semanticamente equivalentes produzem os mesmos bytes (canonico)', () => {
    const r1 = exportLegacy(fullDto(), CONFIG);
    const r2 = exportLegacy(fullDto(), CONFIG);
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.atual.sha256).toBe(r2.atual.sha256);
    expect(r1.contatos.sha256).toBe(r2.contatos.sha256);
    expect([...r1.atual.bytes]).toEqual([...r2.atual.bytes]);
    expect([...r1.contatos.bytes]).toEqual([...r2.contatos.bytes]);
  });

  it('a ordem de contatos na entrada nao altera os bytes (serializacao canonica por chave)', () => {
    const base = fullDto();
    const reversed: PublicProjectionDTO = { ...base, contacts: [...base.contacts].reverse() };
    const r1 = exportLegacy(base, CONFIG);
    const r2 = exportLegacy(reversed, CONFIG);
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.contatos.sha256).toBe(r2.contatos.sha256);
  });
});

// --------------------------------------------------------------------------
// Propriedade complementar: o artefato sempre satisfaz o contrato (ou bloqueia)
// --------------------------------------------------------------------------

describe('exportLegacy — propriedade de conformidade de contrato', () => {
  it('todo DTO sem delimitadores ambiguos produz artefato conforme o contrato', () => {
    // Feature: gestao-leiga-de-escalas, Property 33: Serializacao legada e canonica
    const safeName = fc
      .string({ minLength: 1, maxLength: 12 })
      .filter((s) => !s.includes(',') && !s.includes('|') && s.trim().length > 0);
    const phone = fc.integer({ min: 10_000_000, max: 999_999_999_999 }).map((n) => `+55${n}`);

    const weekdays: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

    const serviceArb = fc.record({
      serviceId: fc.uuid(),
      date: fc
        .tuple(fc.integer({ min: 2020, max: 2030 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 28 }))
        .map(([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`),
      weekday: fc.constantFrom(...weekdays),
      anciao: safeName,
      pregador: safeName,
    });

    const contactArb = fc.record({ subjectId: fc.uuid(), name: safeName, phone });

    fc.assert(
      fc.property(
        fc.array(serviceArb, { maxLength: 6 }),
        fc.array(contactArb, { maxLength: 6 }),
        (services, contacts) => {
          const dto: PublicProjectionDTO = {
            period: '2026-08',
            services: services.map((s) =>
              svc({
                serviceId: s.serviceId,
                date: s.date,
                weekday: s.weekday,
                assignments: [a(ROLE.anciao, s.anciao), a(ROLE.pregador, s.pregador)],
              }),
            ),
            // Nomes unicos para evitar colisao de indice (irrelevante para a propriedade).
            contacts: contacts.map((c, i) => contact(c.subjectId, `${c.name}#${i}`, c.phone)),
          };

          const res = exportLegacy(dto, CONFIG);
          // Sem delimitadores ambiguos e com datas validas, a exportacao e OK.
          expect(res.ok).toBe(true);
          if (!res.ok) return;
          assertAtualContract(res.atual.value);
          assertContatosContract(res.contatos.value);
        },
      ),
      { numRuns: 100 },
    );
  });
});
