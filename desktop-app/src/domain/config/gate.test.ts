import { describe, expect, it } from 'vitest';

import {
  CURRENT_FLOW_OFFICIAL_MESSAGE,
  createDefaultOperationalConfig,
  evaluateCutoverGate,
  isConfigValid,
  isHomologationValid,
  isLiveFileWriteEnabled,
  isRealPublicationEnabled,
  validateHomologationRecord,
  validateOperationalConfig,
  type HomologationRecord,
  type OperationalConfig,
} from './index';

// Registro de homologacao valido reutilizado nos testes.
function validHomologation(): HomologationRecord {
  return {
    confirmed: true,
    rejectedCount: 0,
    pendingCount: 0,
    divergenceCount: 0,
    restoreVerified: true,
    transitionBackupId: 'bkp-transicao-1',
    approvedBy: 'operador@igreja',
    approvedAt: '2026-01-10T12:00:00Z',
  };
}

describe('validateOperationalConfig', () => {
  it('aceita a configuracao padrao conservadora', () => {
    const config = createDefaultOperationalConfig();
    expect(validateOperationalConfig(config)).toEqual([]);
    expect(isConfigValid(config)).toBe(true);
  });

  it('rejeita configuracao ausente', () => {
    expect(validateOperationalConfig(null)).toContain('Configuracao operacional ausente.');
    expect(isConfigValid(undefined)).toBe(false);
  });

  it('rejeita versao de schema desconhecida', () => {
    const config = {
      ...createDefaultOperationalConfig(),
      schemaVersion: '999',
    } as unknown as OperationalConfig;
    const problems = validateOperationalConfig(config);
    expect(problems.some((p) => p.includes('Versao de schema'))).toBe(true);
  });

  it('exige repositorios privado e publico separados', () => {
    const sameUrl = 'https://example.invalid/mesmo.git';
    const config = createDefaultOperationalConfig({
      destinations: {
        privateManagement: { remoteUrl: sameUrl, branch: 'main' },
        publicSite: { remoteUrl: sameUrl, branch: 'main' },
        publicPagesUrl: 'https://example.invalid/',
      },
    });
    expect(validateOperationalConfig(config)).toContain(
      'Repositorio privado e publico devem ser separados.',
    );
  });

  it('exige branches dos destinos', () => {
    const config = createDefaultOperationalConfig({
      destinations: {
        privateManagement: { remoteUrl: 'https://example.invalid/a.git', branch: '' },
        publicSite: { remoteUrl: 'https://example.invalid/b.git', branch: 'main' },
        publicPagesUrl: 'https://example.invalid/',
      },
    });
    expect(validateOperationalConfig(config)).toContain(
      'Branch do repositorio privado de gestao ausente.',
    );
  });

  it('rejeita classificacao de campo invalida', () => {
    const config = createDefaultOperationalConfig({
      fieldClassifications: {
        'person.phone': 'secreto' as unknown as 'private',
      },
    });
    const problems = validateOperationalConfig(config);
    expect(problems.some((p) => p.includes('classificacao invalida'))).toBe(true);
  });

  it('rejeita classificacao de campos vazia', () => {
    const config = createDefaultOperationalConfig({ fieldClassifications: {} });
    expect(validateOperationalConfig(config)).toContain('Classificacao de campos vazia.');
  });

  it('exige retencao que preserva publicacoes oficiais', () => {
    const config = createDefaultOperationalConfig({
      retention: {
        maxBackups: 24,
        maxAgeMonths: 24,
        preserveOfficialPublications: false,
      },
    });
    expect(validateOperationalConfig(config)).toContain(
      'A retencao deve preservar as publicacoes oficiais.',
    );
  });

  it('rejeita limites de retencao invalidos', () => {
    const config = createDefaultOperationalConfig({
      retention: {
        maxBackups: 0,
        maxAgeMonths: -1,
        preserveOfficialPublications: true,
      },
    });
    const problems = validateOperationalConfig(config);
    expect(problems).toContain('Limite de quantidade de backups invalido.');
    expect(problems).toContain('Limite de tempo de retencao invalido.');
  });

  it('exige ao menos a opcao sem custo recorrente obrigatorio', () => {
    const config = createDefaultOperationalConfig({
      recurringCosts: [
        {
          service: 'Servico pago',
          purpose: 'extra',
          amount: 10,
          currency: 'BRL',
          billingPeriod: 'mes',
        },
      ],
    });
    expect(validateOperationalConfig(config)).toContain(
      'Deve existir uma opcao operacional sem custo recorrente obrigatorio (R$ 0,00).',
    );
  });

  it('exige perfis autorizados a publicar', () => {
    const config = createDefaultOperationalConfig({ authorizedPublishProfiles: [] });
    expect(validateOperationalConfig(config)).toContain(
      'Nenhum perfil autorizado a publicar foi informado.',
    );
  });

  it('exige etapas que requerem internet', () => {
    const config = createDefaultOperationalConfig({
      offline: { offlineStages: ['opening'], onlineRequiredStages: [] },
    });
    expect(validateOperationalConfig(config)).toContain(
      'Capacidades offline nao informadas corretamente.',
    );
  });
});

describe('validateHomologationRecord', () => {
  it('aceita um registro completo e valido', () => {
    expect(validateHomologationRecord(validHomologation())).toEqual([]);
    expect(isHomologationValid(validHomologation())).toBe(true);
  });

  it('rejeita registro ausente', () => {
    expect(validateHomologationRecord(undefined)).toContain('Registro de homologacao ausente.');
  });

  it('bloqueia quando ha rejeitados, pendentes ou divergencias', () => {
    const problems = validateHomologationRecord({
      ...validHomologation(),
      rejectedCount: 1,
      pendingCount: 2,
      divergenceCount: 3,
    });
    expect(problems).toContain('Existem registros de migracao rejeitados.');
    expect(problems).toContain('Existem registros de migracao pendentes.');
    expect(problems).toContain('Existem divergencias na comparacao publica.');
  });

  it('bloqueia quando a restauracao nao foi verificada', () => {
    const problems = validateHomologationRecord({
      ...validHomologation(),
      restoreVerified: false,
    });
    expect(problems).toContain('A restauracao do backup de transicao nao foi verificada em teste.');
  });

  it('exige backup de transicao, responsavel e data quando confirmado', () => {
    const base = validHomologation();
    const problems = validateHomologationRecord({
      confirmed: base.confirmed,
      rejectedCount: base.rejectedCount,
      pendingCount: base.pendingCount,
      divergenceCount: base.divergenceCount,
      restoreVerified: base.restoreVerified,
    });
    expect(problems).toContain('Referencia ao backup de transicao ausente.');
    expect(problems).toContain('Responsavel pela homologacao ausente.');
    expect(problems).toContain('Data e hora da homologacao ausentes.');
  });
});

describe('evaluateCutoverGate — feature gate de transicao', () => {
  it('BLOQUEIA por padrao quando a configuracao esta ausente', () => {
    const result = evaluateCutoverGate(null);
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('Configuracao operacional ausente.');
    expect(result.currentFlowOfficialMessage).toBe(CURRENT_FLOW_OFFICIAL_MESSAGE);
  });

  it('BLOQUEIA quando a configuracao e valida mas nao homologada', () => {
    const config = createDefaultOperationalConfig();
    const result = evaluateCutoverGate(config);
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('Registro de homologacao ausente.');
    // Informa em portugues que o fluxo atual continua oficial.
    expect(result.currentFlowOfficialMessage).toBe(CURRENT_FLOW_OFFICIAL_MESSAGE);
  });

  it('publicacao real e escrita vigente DESABILITADAS por padrao', () => {
    const config = createDefaultOperationalConfig();
    expect(isRealPublicationEnabled(config)).toBe(false);
    expect(isLiveFileWriteEnabled(config)).toBe(false);
    expect(isRealPublicationEnabled(undefined)).toBe(false);
    expect(isLiveFileWriteEnabled(null)).toBe(false);
  });

  it('PERMITE o corte somente com configuracao valida e homologacao valida', () => {
    const config = createDefaultOperationalConfig({ homologation: validHomologation() });
    const result = evaluateCutoverGate(config);
    expect(result.allowed).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.currentFlowOfficialMessage).toBeUndefined();
    expect(isRealPublicationEnabled(config)).toBe(true);
    expect(isLiveFileWriteEnabled(config)).toBe(true);
  });

  it('bloqueia se a config e invalida mesmo com homologacao valida', () => {
    const config = createDefaultOperationalConfig({
      homologation: validHomologation(),
      authorizedPublishProfiles: [],
    });
    const result = evaluateCutoverGate(config);
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('Nenhum perfil autorizado a publicar foi informado.');
  });

  it('acumula motivos de configuracao e de homologacao simultaneamente', () => {
    const config = createDefaultOperationalConfig({
      authorizedPublishProfiles: [],
      homologation: { ...validHomologation(), confirmed: false },
    });
    const result = evaluateCutoverGate(config);
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('Nenhum perfil autorizado a publicar foi informado.');
    expect(result.reasons).toContain('Homologacao nao confirmada pelo Aprovador.');
  });
});
