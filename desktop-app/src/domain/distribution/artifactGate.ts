// Gate de distribuicao ao operador: assinatura, notarizacao e smoke por
// plataforma (tarefa 17.6).
//
// Objetivo (Requisitos 1.9, 15.2, 16.2): artefatos NAO assinados (ou, no macOS,
// NAO notarizados) sao REJEITADOS no pipeline de distribuicao ao operador. O
// fluxo de smoke do instalador (instalar -> abrir -> usar cofre -> atualizar ->
// desinstalar) e modelado como uma maquina de estados pura e testavel, de modo
// que a logica de aceitacao seja validada sem empacotar a aplicacao.
//
// TypeScript puro, sem I/O. A execucao real (assinar/notarizar/instalar) ocorre
// no CI por plataforma; aqui garantimos as REGRAS de aceitacao.

export type Platform = 'windows' | 'macos';

/** Metadados de um artefato candidato a distribuicao. */
export interface ArtifactDescriptor {
  readonly platform: Platform;
  readonly architecture: string;
  /** Formato do instalador (ex.: 'nsis', 'dmg', 'app'). */
  readonly format: string;
  /** Assinatura de codigo presente e valida. */
  readonly signed: boolean;
  /** Notarizacao presente e valida (obrigatoria no macOS). */
  readonly notarized: boolean;
}

/** Resultado da avaliacao do gate de distribuicao. */
export interface ArtifactGateResult {
  readonly accepted: boolean;
  readonly reasons: readonly string[];
}

/**
 * Decide se um artefato pode ser distribuido ao operador. Rejeita, com motivo em
 * portugues, artefatos nao assinados e artefatos macOS nao notarizados.
 */
export function evaluateArtifactGate(artifact: ArtifactDescriptor): ArtifactGateResult {
  const reasons: string[] = [];

  if (!artifact.signed) {
    reasons.push('Artefato nao assinado: a assinatura de codigo e obrigatoria.');
  }
  if (artifact.platform === 'macos' && !artifact.notarized) {
    reasons.push('Artefato macOS nao notarizado: a notarizacao e obrigatoria.');
  }
  if (artifact.architecture.trim().length === 0) {
    reasons.push('Arquitetura do artefato nao informada.');
  }
  if (artifact.format.trim().length === 0) {
    reasons.push('Formato do instalador nao informado.');
  }

  return { accepted: reasons.length === 0, reasons };
}

// --------------------------------------------------------------------------
// Smoke do instalador (maquina de estados pura)
// --------------------------------------------------------------------------

export type SmokeStep = 'install' | 'open' | 'use-vault' | 'update' | 'uninstall';

/** Ordem canonica do smoke do instalador. */
export const SMOKE_SEQUENCE: readonly SmokeStep[] = [
  'install',
  'open',
  'use-vault',
  'update',
  'uninstall',
];

export interface SmokeResult {
  readonly completed: boolean;
  /** Passos executados com sucesso, em ordem. */
  readonly executed: readonly SmokeStep[];
  /** Motivo de interrupcao, quando houver. */
  readonly stoppedReason?: string;
}

/**
 * Executa o smoke do instalador somente quando o artefato passa no gate. A
 * `runner` devolve `true`/`false` para cada passo; o smoke para no primeiro
 * passo que falhar. Puro: nao faz I/O (a `runner` e injetada).
 */
export function runInstallerSmoke(
  artifact: ArtifactDescriptor,
  runner: (step: SmokeStep) => boolean,
): SmokeResult {
  const gate = evaluateArtifactGate(artifact);
  if (!gate.accepted) {
    return { completed: false, executed: [], stoppedReason: gate.reasons.join(' ') };
  }
  const executed: SmokeStep[] = [];
  for (const step of SMOKE_SEQUENCE) {
    if (!runner(step)) {
      return { completed: false, executed, stoppedReason: `Falhou no passo: ${step}` };
    }
    executed.push(step);
  }
  return { completed: true, executed };
}

/**
 * Regra de atualizacao durante um ciclo em andamento (1.9/16.2): a atualizacao
 * deve ser ADIADA enquanto um ciclo estiver aberto, para nao interromper o
 * trabalho. Retorna `true` quando a atualizacao pode ocorrer agora.
 */
export function canUpdateNow(cycleInProgress: boolean): boolean {
  return !cycleInProgress;
}
