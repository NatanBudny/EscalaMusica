// Testes unitarios da PublicProjection (tarefa 9.1).
//
// Validacao objetiva: sentinelas privadas injetadas em TODAS as categorias
// (alias privado, telefone sem autorizacao, notas administrativas, insumos
// privados, campos privados e segredos) NAO aparecem na previa, no pacote
// serializado nem nos bloqueios/erros; um telefone sem autorizacao vigente
// gera BLOQUEIO (nunca descarte silencioso).

import { describe, it, expect } from 'vitest';
import { SCHEMA_VERSION } from '../schemas/models';
import type { ExternalInput, ScheduleDraft, Service } from '../schemas/models';
import { RegistryService } from '../registry/registry-service';
import { canonicalBytes, sha256Hex } from '../schemas/canonical';
import {
  projectPublic,
  PRIVATE_SENTINEL_PREFIX,
  type PublicProjectionInput,
} from './publicProjection';

// IDs deterministicos.
const ID = {
  personAuthorized: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  personNoPhone: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  personUnauthorizedPhone: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  dept: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  cycle: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  service: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  role: '10101010-1010-4010-8010-101010101010',
  authPhone: '20202020-2020-4020-8020-202020202020',
  authAlias: '30303030-3030-4030-8030-303030303030',
  op: '40404040-4040-4040-8040-404040404040',
} as const;

const NOW_UTC = '2026-02-01T12:00:00Z';
const AT = '2026-02-15';
const PURPOSE = 'Confirmacao de escala por WhatsApp';

/** Hash de valor igual ao default da projecao (SHA-256 do UTF-8 canonico). */
function hashValue(value: string): string {
  return sha256Hex(canonicalBytes(value));
}

/**
 * Monta um cadastro com tres pessoas e um departamento, autorizando o telefone
 * e um alias publico da primeira pessoa. As demais pessoas carregam sentinelas
 * privadas (alias privado, notas administrativas, telefone sem autorizacao).
 */
function buildRegistry(): RegistryService {
  const reg = new RegistryService();

  // Pessoa com telefone + alias AUTORIZADOS.
  const phone = '+5511999990000';
  const aliasPub = 'Aninha';
  reg.addPerson({
    id: ID.personAuthorized,
    canonicalName: 'Ana Maria',
    aliases: [
      { value: aliasPub },
      { value: `${PRIVATE_SENTINEL_PREFIX}_ALIAS_X` }, // alias privado (sentinela)
    ],
    phoneE164: phone,
    administrativeNotes: `${PRIVATE_SENTINEL_PREFIX}_NOTA_ADMIN`,
    now: NOW_UTC,
  });
  reg.registerAuthorization({
    id: ID.authPhone,
    subjectId: ID.personAuthorized,
    field: 'phone',
    valueHash: hashValue(phone),
    purpose: PURPOSE,
    approvedBy: ID.op,
    validFrom: '2026-01-01',
    validUntil: '2026-12-31',
    now: NOW_UTC,
  });
  reg.registerAuthorization({
    id: ID.authAlias,
    subjectId: ID.personAuthorized,
    field: 'alias',
    valueHash: hashValue(aliasPub),
    purpose: PURPOSE,
    approvedBy: ID.op,
    validFrom: '2026-01-01',
    now: NOW_UTC,
  });

  // Pessoa SEM telefone, com nota administrativa sentinela.
  reg.addPerson(
    makePersonInput(ID.personNoPhone, 'Bruno', {
      administrativeNotes: `${PRIVATE_SENTINEL_PREFIX}_NOTA_BRUNO`,
    }),
  );

  // Departamento ativo.
  reg.addDepartment({ id: ID.dept, canonicalName: 'Sonoplastia', now: NOW_UTC });

  return reg;
}

function makePersonInput(
  id: string,
  canonicalName: string,
  extra: { administrativeNotes?: string; phoneE164?: string } = {},
): Parameters<RegistryService['addPerson']>[0] {
  return {
    id,
    canonicalName,
    now: NOW_UTC,
    ...(extra.phoneE164 ? { phoneE164: extra.phoneE164 } : {}),
    ...(extra.administrativeNotes ? { administrativeNotes: extra.administrativeNotes } : {}),
  };
}

function buildServices(): Service[] {
  return [
    {
      schemaVersion: SCHEMA_VERSION,
      id: ID.service,
      cycleId: ID.cycle,
      date: '2026-02-07',
      computedWeekday: 'saturday',
      kind: 'regular',
      externalInputIds: [],
    },
  ];
}

function buildDraft(): ScheduleDraft {
  return {
    schemaVersion: SCHEMA_VERSION,
    cycleId: ID.cycle,
    revision: 'a'.repeat(64),
    assignments: [
      {
        id: 'assign-1',
        serviceId: ID.service,
        roleId: ID.role,
        subject: { type: 'person', id: ID.personAuthorized },
        source: 'manual',
        // Justificativa de override e privada; nunca deve vazar.
        preferenceOverrideReason: `${PRIVATE_SENTINEL_PREFIX}_JUSTIFICATIVA`,
      },
      {
        id: 'assign-2',
        serviceId: ID.service,
        roleId: ID.role,
        subject: { type: 'department', id: ID.dept },
        source: 'department-rule',
      },
    ],
    publicFields: [
      {
        serviceId: ID.service,
        fields: { TEMA: 'A graca que transforma' },
      },
    ],
    // Notas privadas carregam sentinela; nunca entram na projecao.
    privateNotes: [
      { id: 'note-1', serviceId: ID.service, text: `${PRIVATE_SENTINEL_PREFIX}_NOTA_CULTO` },
    ],
    createdAt: NOW_UTC,
  };
}

function buildExternalInputs(): ExternalInput[] {
  return [
    {
      schemaVersion: SCHEMA_VERSION,
      id: 'input-pub',
      serviceId: ID.service,
      type: 'theme',
      value: 'A graca que transforma',
      visibility: 'public',
      source: 'PDF do pregador',
      updatedAt: NOW_UTC,
      operatorId: ID.op,
    },
    {
      schemaVersion: SCHEMA_VERSION,
      id: 'input-priv',
      serviceId: ID.service,
      type: 'observation',
      value: `${PRIVATE_SENTINEL_PREFIX}_OBS_PRIVADA`,
      visibility: 'private',
      source: 'interno',
      updatedAt: NOW_UTC,
      operatorId: ID.op,
    },
  ];
}

function baseInput(reg: RegistryService): PublicProjectionInput {
  return {
    registry: reg,
    services: buildServices(),
    draft: buildDraft(),
    externalInputs: buildExternalInputs(),
    period: '2026-02',
    at: AT,
    purpose: { phonePurpose: PURPOSE },
    valueHash: hashValue,
  };
}

describe('projectPublic — allowlist e autorizacoes', () => {
  it('emite o pacote com telefone e alias autorizados e dados publicos', () => {
    const reg = buildRegistry();
    const result = projectPublic(baseInput(reg));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ana = result.dto.contacts.find((c) => c.subjectId === ID.personAuthorized);
    expect(ana).toBeDefined();
    expect(ana?.canonicalName).toBe('Ana Maria');
    expect(ana?.phoneE164).toBe('+5511999990000'); // 11.16
    expect(ana?.aliases).toEqual(['Aninha']); // so o alias autorizado

    // Culto com campos publicos e insumo publico.
    const svc = result.dto.services[0];
    expect(svc?.publicFields).toEqual({ TEMA: 'A graca que transforma' });
    expect(svc?.publicInputs).toEqual([{ type: 'theme', value: 'A graca que transforma' }]);

    // Atribuicoes com nome publico resolvido.
    const names = svc?.assignments.map((a) => a.name).sort();
    expect(names).toEqual(['Ana Maria', 'Sonoplastia']);
  });

  it('nenhuma sentinela privada aparece no pacote serializado, previa ou erros', () => {
    const reg = buildRegistry();
    const result = projectPublic(baseInput(reg));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const serializedDto = JSON.stringify(result.dto);
    const serializedBytes = new TextDecoder().decode(result.bytes);

    for (const blob of [serializedDto, serializedBytes]) {
      expect(blob).not.toContain(PRIVATE_SENTINEL_PREFIX);
      expect(blob).not.toContain('NOTA_ADMIN');
      expect(blob).not.toContain('ALIAS_X');
      expect(blob).not.toContain('JUSTIFICATIVA');
      expect(blob).not.toContain('OBS_PRIVADA');
      expect(blob).not.toContain('NOTA_CULTO');
    }
  });

  it('nenhum campo privado estrutural (notas, aliases privados, telefone sem auth) vaza', () => {
    const reg = buildRegistry();
    const result = projectPublic(baseInput(reg));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Bruno nao tem telefone nem alias publico: aparece so com nome e sem fone.
    const bruno = result.dto.contacts.find((c) => c.subjectId === ID.personNoPhone);
    expect(bruno).toBeDefined();
    expect(bruno?.phoneE164).toBeUndefined();
    expect(bruno?.aliases).toEqual([]);

    // O DTO nao possui chaves de campos privados.
    const all = JSON.stringify(result.dto);
    expect(all).not.toContain('administrativeNotes');
    expect(all).not.toContain('participation');
    expect(all).not.toContain('capabilityIds');
    expect(all).not.toContain('preferenceOverrideReason');
    expect(all).not.toContain('privateNotes');
  });
});

describe('projectPublic — telefone sem autorizacao bloqueia', () => {
  it('bloqueia quando ha telefone destinado aos Dados_Publicos sem autorizacao vigente', () => {
    const reg = buildRegistry();
    // Pessoa com telefone mas SEM autorizacao.
    reg.addPerson(
      makePersonInput(ID.personUnauthorizedPhone, 'Carla', { phoneE164: '+5511888887777' }),
    );

    const result = projectPublic(baseInput(reg));

    expect(result.ok).toBe(false);
    if (result.ok) return;

    const block = result.blocks.find((b) => b.code === 'phone-not-authorized');
    expect(block).toBeDefined();
    expect(block?.reference).toBe(`pessoa:${ID.personUnauthorizedPhone}`);
    // O bloqueio NAO repete o valor do telefone.
    const serializedBlocks = JSON.stringify(result.blocks);
    expect(serializedBlocks).not.toContain('+5511888887777');
    expect(serializedBlocks).not.toContain('888887777');
  });

  it('bloqueia quando a autorizacao do telefone esta expirada (vigencia inclusiva)', () => {
    const reg = new RegistryService();
    const phone = '+5511777776666';
    reg.addPerson(
      makePersonInput('99999999-9999-4999-8999-999999999999', 'Dora', { phoneE164: phone }),
    );
    reg.registerAuthorization({
      id: '88888888-8888-4888-8888-888888888888',
      subjectId: '99999999-9999-4999-8999-999999999999',
      field: 'phone',
      valueHash: hashValue(phone),
      purpose: PURPOSE,
      approvedBy: ID.op,
      validFrom: '2026-01-01',
      validUntil: '2026-01-31', // expira antes de AT (2026-02-15)
      now: NOW_UTC,
    });

    const input: PublicProjectionInput = {
      registry: reg,
      services: [],
      draft: {
        schemaVersion: SCHEMA_VERSION,
        cycleId: ID.cycle,
        revision: 'a'.repeat(64),
        assignments: [],
        publicFields: [],
        privateNotes: [],
        createdAt: NOW_UTC,
      },
      externalInputs: [],
      period: '2026-02',
      at: AT,
      purpose: { phonePurpose: PURPOSE },
      valueHash: hashValue,
    };

    const result = projectPublic(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blocks.some((b) => b.code === 'phone-not-authorized')).toBe(true);
  });
});

describe('projectPublic — scanner de segredos (defesa em profundidade)', () => {
  it('bloqueia quando um campo publico do rascunho tem nome de segredo', () => {
    const reg = buildRegistry();
    const input = baseInput(reg);
    const draft = buildDraft();
    draft.publicFields = [{ serviceId: ID.service, fields: { TEMA: 'ok', token: 'xpto' } }];
    const result = projectPublic({ ...input, draft });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const block = result.blocks.find((b) => b.code === 'secret-field-name');
    expect(block).toBeDefined();
    // O valor do segredo nunca e repetido.
    expect(JSON.stringify(result.blocks)).not.toContain('xpto');
  });

  it('bloqueia quando um valor publico se assemelha a token GitHub', () => {
    const reg = buildRegistry();
    const input = baseInput(reg);
    const draft = buildDraft();
    draft.publicFields = [
      { serviceId: ID.service, fields: { OBS: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' } },
    ];
    const result = projectPublic({ ...input, draft });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blocks.some((b) => b.code === 'secret-value-leak')).toBe(true);
    expect(JSON.stringify(result.blocks)).not.toContain('ghp_ABCDEF');
  });
});

describe('projectPublic — determinismo', () => {
  it('produz os mesmos bytes e hash para a mesma entrada', () => {
    const r1 = projectPublic(baseInput(buildRegistry()));
    const r2 = projectPublic(baseInput(buildRegistry()));
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.sha256).toBe(r2.sha256);
    expect(new TextDecoder().decode(r1.bytes)).toBe(new TextDecoder().decode(r2.bytes));
  });

  it('pessoa inativa nunca entra nos contatos publicos', () => {
    const reg = buildRegistry();
    reg.deactivatePerson(ID.personNoPhone, NOW_UTC);
    const result = projectPublic(baseInput(reg));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dto.contacts.some((c) => c.subjectId === ID.personNoPhone)).toBe(false);
  });
});
