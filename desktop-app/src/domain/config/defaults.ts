// Defaults conservadores da configuracao operacional (conforme desenho).
//
// Produz uma configuracao valida estruturalmente, porem SEM registro de
// homologacao. Com isso o corte (publicacao real e escrita nos arquivos
// vigentes) permanece DESABILITADO por padrao e o fluxo atual continua oficial
// (requisitos 16.7, 16.8). A homologacao so e adicionada por um registro
// explicito e valido.

import type { OperationalConfig } from './model';
import { OPERATIONAL_CONFIG_SCHEMA_VERSION } from './model';

/**
 * Cria a configuracao operacional padrao com os defaults revisaveis do desenho.
 * Os destinos Git/Pages devem ser confirmados antes da homologacao; os valores
 * aqui sao placeholders aprovados apenas para estrutura, nunca de producao.
 *
 * O resultado NAO contem `homologation`, portanto o feature gate de transicao
 * permanece fechado por padrao.
 */
export function createDefaultOperationalConfig(
  overrides?: Partial<OperationalConfig>,
): OperationalConfig {
  const base: OperationalConfig = {
    schemaVersion: OPERATIONAL_CONFIG_SCHEMA_VERSION,
    osMinimums: {
      windowsMinimum: 'Windows 10 22H2',
      windowsArchitectures: ['x64'],
      macosMinimum: 'macOS 12 Monterey',
      macosArchitectures: ['intel', 'apple-silicon'],
    },
    destinations: {
      privateManagement: {
        remoteUrl: 'https://example.invalid/private-management.git',
        branch: 'main',
      },
      publicSite: {
        remoteUrl: 'https://example.invalid/public-site.git',
        branch: 'main',
      },
      publicPagesUrl: 'https://example.invalid/',
    },
    fieldClassifications: {
      'person.canonicalName': 'public',
      'person.phone': 'private',
      'person.administrativeNotes': 'private',
      'service.date': 'public',
      'service.theme': 'public',
      'audit.event': 'private',
    },
    retention: {
      maxBackups: 24,
      maxAgeMonths: 24,
      preserveOfficialPublications: true,
    },
    offline: {
      offlineStages: ['opening', 'collection', 'assembly', 'validation', 'preview', 'training'],
      onlineRequiredStages: ['approval-final', 'publication', 'public-verification'],
    },
    formats: {
      importFormats: ['backup-v1'],
      exportFormats: ['atual.json', 'contatos.json', 'backup-v1'],
    },
    authorizedPublishProfiles: ['operator'],
    recurringCosts: [
      {
        service: 'GitHub Pages',
        purpose: 'Hospedagem estatica do visualizador',
        amount: 0,
        currency: 'BRL',
        billingPeriod: 'mes',
      },
    ],
    // Sem homologacao por padrao: o corte permanece bloqueado.
  };

  return { ...base, ...overrides };
}
