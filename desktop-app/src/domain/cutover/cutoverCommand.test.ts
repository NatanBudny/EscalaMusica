// Testes do comando guiado de corte (tarefa 19.1).
//
// Validacao objetiva: sem registro de homologacao valido o comando NAO executa
// e informa que o fluxo atual continua oficial; com o gate aberto, a saga roda
// na ordem canonica; qualquer falha apos o backup dispara rollback
// compensatorio e preserva a vigente anterior.
// Requisitos: 10.2-10.4, 12.7-12.10, 16.7-16.12.

import { describe, it, expect, vi } from 'vitest';
import { OPERATIONAL_CONFIG_SCHEMA_VERSION, type OperationalConfig } from '../config/model';
import { runCutover, type CutoverEffects } from './cutoverCommand';

function validConfig(): OperationalConfig {
  return {
    schemaVersion: OPERATIONAL_CONFIG_SCHEMA_VERSION,
    osMinimums: {
      windowsMinimum: 'Windows 10 22H2',
      windowsArchitectures: ['x64'],
      macosMinimum: 'macOS 12 Monterey',
      macosArchitectures: ['intel', 'apple-silicon'],
    },
    destinations: {
      privateManagement: { remoteUrl: 'https://example.com/privado.git', branch: 'main' },
      publicSite: { remoteUrl: 'https://example.com/publico.git', branch: 'gh-pages' },
      publicPagesUrl: 'https://example.com/',
    },
    fieldClassifications: { 'person.phone': 'private', 'service.date': 'public' },
    retention: { maxBackups: 10, maxAgeMonths: 12, preserveOfficialPublications: true },
    offline: { offlineStages: ['assembly'], onlineRequiredStages: ['publication'] },
    formats: { importFormats: ['backup-v1'], exportFormats: ['atual.json', 'contatos.json'] },
    authorizedPublishProfiles: ['publicador'],
    recurringCosts: [{ service: 'nenhum', purpose: 'uso padrao', amount: 0, currency: 'BRL', billingPeriod: 'mensal' }],
    homologation: {
      confirmed: true,
      rejectedCount: 0,
      pendingCount: 0,
      divergenceCount: 0,
      restoreVerified: true,
      transitionBackupId: 'backup-transicao-1',
      approvedBy: 'aprovador',
      approvedAt: '2026-02-20T10:00:00Z',
    },
  };
}

function happyEffects(): CutoverEffects {
  return {
    createFinalBackup: vi.fn(() => 'backup-final-1'),
    checkDestinations: vi.fn(() => true),
    publishApprovedPackage: vi.fn(() => 'pub-1'),
    registerTransitionMilestone: vi.fn(() => true),
    preserveLegacy: vi.fn(() => true),
    compensatingRollback: vi.fn(() => true),
  };
}

describe('runCutover (19.1)', () => {
  it('bloqueia quando nao ha homologacao valida e informa que o fluxo atual continua oficial', () => {
    const effects = happyEffects();
    const outcome = runCutover(undefined, effects);
    expect(outcome.status).toBe('blocked');
    if (outcome.status === 'blocked') {
      expect(outcome.reasons.length).toBeGreaterThan(0);
      expect(outcome.currentFlowOfficialMessage).toMatch(/fluxo atual continua oficial/i);
    }
    // Nenhum efeito foi executado.
    expect(effects.createFinalBackup).not.toHaveBeenCalled();
    expect(effects.publishApprovedPackage).not.toHaveBeenCalled();
  });

  it('bloqueia quando a homologacao tem pendencias', () => {
    const config = validConfig();
    const comPendencia: OperationalConfig = {
      ...config,
      homologation: { ...config.homologation!, pendingCount: 1 },
    };
    const outcome = runCutover(comPendencia, happyEffects());
    expect(outcome.status).toBe('blocked');
  });

  it('executa a saga completa na ordem canonica quando o gate esta aberto', () => {
    const effects = happyEffects();
    const outcome = runCutover(validConfig(), effects);
    expect(outcome.status).toBe('completed');
    if (outcome.status === 'completed') {
      expect(outcome.executed).toEqual([
        'backup-final',
        'check-destinations',
        'publish-approved',
        'register-milestone',
        'preserve-legacy',
      ]);
      expect(outcome.backupId).toBe('backup-final-1');
      expect(outcome.publicationId).toBe('pub-1');
    }
    // Sem falha, nao ha rollback.
    expect(effects.compensatingRollback).not.toHaveBeenCalled();
  });

  it('falha no backup final nao inicia o corte e nao faz rollback', () => {
    const effects: CutoverEffects = { ...happyEffects(), createFinalBackup: vi.fn(() => null) };
    const outcome = runCutover(validConfig(), effects);
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.failedStep).toBe('backup-final');
      expect(outcome.rolledBack).toBe(false);
    }
    expect(effects.checkDestinations).not.toHaveBeenCalled();
  });

  it('falha na publicacao dispara rollback compensatorio e preserva a vigente anterior', () => {
    const rollback = vi.fn(() => true);
    const effects: CutoverEffects = {
      ...happyEffects(),
      publishApprovedPackage: vi.fn(() => null),
      compensatingRollback: rollback,
    };
    const outcome = runCutover(validConfig(), effects);
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.failedStep).toBe('publish-approved');
      expect(outcome.rolledBack).toBe(true);
    }
    expect(rollback).toHaveBeenCalledWith('backup-final-1');
  });

  it('falha ao preservar o legado tambem reverte', () => {
    const effects: CutoverEffects = { ...happyEffects(), preserveLegacy: vi.fn(() => false) };
    const outcome = runCutover(validConfig(), effects);
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.failedStep).toBe('preserve-legacy');
      expect(outcome.rolledBack).toBe(true);
    }
  });
});
