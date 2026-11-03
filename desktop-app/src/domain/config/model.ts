// Modelo da configuracao operacional versionada e do estado de homologacao.
//
// Este modulo e TypeScript puro (sem I/O, sem acesso a arquivos). Ele descreve
// a configuracao que o aplicativo usa para operar e o registro de homologacao
// que, somente quando valido, autoriza a publicacao real e a escrita nos
// arquivos vigentes (atual.json, contatos.json).
//
// IMPORTANTE (requisitos 16.7, 16.8): enquanto nao houver um registro de
// homologacao valido, o corte (publicacao real e escrita nos arquivos vigentes)
// permanece DESABILITADO por padrao e o fluxo atual continua sendo o oficial.
// Este modulo nunca acessa nem altera o legado; apenas descreve e valida a
// configuracao e o gate de transicao.

/** Versao de schema reconhecida para a configuracao operacional. */
export const OPERATIONAL_CONFIG_SCHEMA_VERSION = '1' as const;

/** Dias da semana canonicos usados pelo dominio. */
export type Weekday =
  'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

/**
 * Minimos de sistema operacional suportados (requisito 16.3 / defaults do
 * desenho). Versionados na configuracao e revisaveis antes da homologacao.
 */
export interface OperatingSystemMinimums {
  /** Ex.: "Windows 10 22H2" */
  readonly windowsMinimum: string;
  /** Arquiteturas Windows suportadas, ex.: ["x64"] */
  readonly windowsArchitectures: readonly string[];
  /** Ex.: "macOS 12 Monterey" */
  readonly macosMinimum: string;
  /** Arquiteturas macOS suportadas, ex.: ["intel", "apple-silicon"] */
  readonly macosArchitectures: readonly string[];
}

/**
 * Destino Git aprovado (requisitos 10.4, 10.20). O backend compara
 * repositorio/branch com estes valores aprovados, nunca com valores livres
 * vindos da UI.
 */
export interface GitDestination {
  /** URL remota do repositorio aprovado. */
  readonly remoteUrl: string;
  /** Branch operacional aprovada. */
  readonly branch: string;
}

/**
 * Destinos de publicacao: repositorio privado de gestao, repositorio publico do
 * site e endereco publico do GitHub Pages verificado (requisito 10.4, 10.22).
 */
export interface PublicationDestinations {
  readonly privateManagement: GitDestination;
  readonly publicSite: GitDestination;
  /** Endereco publico onde o resultado e verificado (Site_Publico). */
  readonly publicPagesUrl: string;
}

/** Classificacao de um campo persistido (requisito 11.1). */
export type FieldClassification = 'public' | 'private';

/**
 * Classificacao obrigatoria de campos (requisito 11.1): cada campo persistido
 * pertence a exatamente uma categoria. A chave e o caminho logico do campo
 * (ex.: "person.phone"); o valor e a categoria.
 */
export interface FieldClassificationMap {
  readonly [fieldPath: string]: FieldClassification;
}

/**
 * Politica de retencao de backups (requisitos 13.9, 13.10). Limites de
 * quantidade e tempo; publicacoes oficiais sao sempre preservadas.
 */
export interface RetentionPolicy {
  /** Numero maximo de backups nao oficiais retidos (> 0). */
  readonly maxBackups: number;
  /** Idade maxima em meses para backups nao oficiais (> 0). */
  readonly maxAgeMonths: number;
  /**
   * Preserva backups marcados como publicacao oficial independentemente de
   * idade/quantidade. Deve ser `true` para respeitar o requisito 13.10.
   */
  readonly preserveOfficialPublications: boolean;
}

/**
 * Capacidades offline (default do desenho / requisito aberto 8). Lista as
 * etapas que funcionam sobre a copia local e as que exigem internet.
 */
export interface OfflineCapabilities {
  /** Etapas que funcionam offline (sobre copia local). */
  readonly offlineStages: readonly string[];
  /** Etapas que exigem internet (aprovacao final, publicacao, verificacao). */
  readonly onlineRequiredStages: readonly string[];
}

/** Formatos portaveis documentados e suportados (requisito 16.4). */
export interface SupportedFormats {
  /** Formatos de importacao documentados, ex.: ["backup-v1"]. */
  readonly importFormats: readonly string[];
  /** Formatos de exportacao documentados, ex.: ["atual.json", "contatos.json"]. */
  readonly exportFormats: readonly string[];
}

/**
 * Informacao de custo recorrente opcional (requisito 16.3). Documenta servicos
 * pagos opcionais; a opcao sem custo recorrente obrigatorio deve existir.
 */
export interface RecurringCostInfo {
  readonly service: string;
  readonly purpose: string;
  /** Valor por periodo de cobranca; 0 para a opcao sem custo. */
  readonly amount: number;
  readonly currency: string;
  readonly billingPeriod: string;
}

/**
 * Registro de homologacao (requisitos 16.7, 16.8, 16.11, 16.12). Somente um
 * registro com `confirmed: true` e todas as condicoes atendidas autoriza o
 * corte (publicacao real e escrita nos arquivos vigentes).
 */
export interface HomologationRecord {
  /** Homologacao confirmada pelo Aprovador. */
  readonly confirmed: boolean;
  /** Quantidade de registros de migracao rejeitados (deve ser 0). */
  readonly rejectedCount: number;
  /** Quantidade de registros de migracao pendentes (deve ser 0). */
  readonly pendingCount: number;
  /** Quantidade de divergencias na comparacao publica (deve ser 0). */
  readonly divergenceCount: number;
  /** Ensaio de restauracao concluido e verificado em teste. */
  readonly restoreVerified: boolean;
  /** Referencia ao backup de transicao (obrigatoria quando confirmado). */
  readonly transitionBackupId?: string;
  /** Responsavel pela confirmacao (obrigatorio quando confirmado). */
  readonly approvedBy?: string;
  /** Instante UTC RFC 3339 da confirmacao (obrigatorio quando confirmado). */
  readonly approvedAt?: string;
}

/**
 * Configuracao operacional versionada completa. E a fonte unica usada para
 * decidir destinos, classificacao de campos, retencao, offline, formatos e o
 * estado de homologacao que controla o feature gate de transicao.
 */
export interface OperationalConfig {
  readonly schemaVersion: typeof OPERATIONAL_CONFIG_SCHEMA_VERSION;
  readonly osMinimums: OperatingSystemMinimums;
  readonly destinations: PublicationDestinations;
  readonly fieldClassifications: FieldClassificationMap;
  readonly retention: RetentionPolicy;
  readonly offline: OfflineCapabilities;
  readonly formats: SupportedFormats;
  /** Perfis autorizados a publicar (requisito 11.12). */
  readonly authorizedPublishProfiles: readonly string[];
  /** Custos recorrentes opcionais documentados (requisito 16.3). */
  readonly recurringCosts: readonly RecurringCostInfo[];
  /**
   * Estado de homologacao. Ausente (`undefined`) significa nao homologado:
   * o corte permanece bloqueado e o fluxo atual continua oficial.
   */
  readonly homologation?: HomologationRecord;
}
