// Catalogo versionado de falhas ligado aos codigos emitiveis da aplicacao
// (tarefa 17.3) e fonte unica para a ajuda e o README (tarefa 17.2/17.4).
//
// Objetivo (Requisitos 1.7, 1.8, 12.12, 15.10, 15.16): para CADA codigo de erro
// que a aplicacao pode emitir, existe EXATAMENTE UM procedimento vigente,
// descrevendo em portugues: sintoma, dados preservados, dados alterados,
// impacto, correcao e confirmacao de que a falha foi superada. A ajuda
// contextual e o README sao GERADOS a partir deste mesmo catalogo tipado, de
// modo que documentacao e codigo permanecem sincronizados (Property 46).
//
// TypeScript puro, sem I/O. Os codigos vem do catalogo de `AppError`
// (`COMMAND_ERROR_CODES`), garantindo que nenhum procedimento fique orfao e que
// nenhum codigo emitivel fique sem procedimento.

import {
  COMMAND_ERROR_CODES,
  makeAppError,
  type CommandErrorCode,
} from '../commands/errors';

/** Versao do catalogo de falhas (muda quando os procedimentos mudam). */
export const FAILURE_CATALOG_VERSION = '1.0.0';

/** Procedimento vigente de recuperacao de uma falha, voltado ao operador. */
export interface FailureProcedure {
  /** Codigo emitivel ao qual este procedimento corresponde (1:1). */
  readonly code: CommandErrorCode;
  /** Sintoma observavel pelo operador (o que ele ve). */
  readonly symptom: string;
  /** Dados que a aplicacao preserva quando a falha ocorre. */
  readonly preserved: readonly string[];
  /** Dados eventualmente alterados (vazio quando nada muda). */
  readonly changed: readonly string[];
  /** Impacto na escala vigente. */
  readonly impact: string;
  /** Passos de correcao, em ordem. */
  readonly correction: readonly string[];
  /** Como confirmar que a falha foi superada. */
  readonly confirmation: string;
}

/**
 * Procedimentos vigentes, um por codigo emitivel. A chave e o codigo; isso
 * torna impossivel haver dois procedimentos para o mesmo codigo.
 */
const PROCEDURES: Record<CommandErrorCode, Omit<FailureProcedure, 'code'>> = {
  'revisao-divergente': {
    symptom:
      'Ao salvar uma alteracao, aparece a mensagem de que a revisao mudou e a edicao foi recusada.',
    preserved: ['a revisao atual do estado', 'todos os dados ja gravados'],
    changed: [],
    impact: 'Nenhuma mudanca foi aplicada; a escala vigente permanece como estava.',
    correction: [
      'Recarregue o estado atual pelo botao indicado.',
      'Revise a alteracao sobre a versao mais recente.',
      'Salve novamente.',
    ],
    confirmation: 'A alteracao e aceita e a grade passa a exibir o novo valor.',
  },
  'validacao-dominio': {
    symptom: 'A alteracao e recusada e o campo problematico e destacado com o motivo.',
    preserved: ['o agregado anterior', 'a revisao atual'],
    changed: [],
    impact: 'Nenhuma mudanca foi aplicada; a escala vigente permanece como estava.',
    correction: [
      'Va ao campo destacado.',
      'Ajuste o valor conforme a regra indicada na mensagem.',
      'Confirme novamente.',
    ],
    confirmation: 'A validacao deixa de apontar o campo e a alteracao e aceita.',
  },
  'auditoria-invalida': {
    symptom:
      'A alteracao nao e registrada e aparece aviso de que o registro de auditoria seria invalido.',
    preserved: ['o agregado anterior', 'a revisao atual', 'o registro de auditoria existente'],
    changed: [],
    impact: 'Nenhuma mudanca foi aplicada; a escala vigente permanece como estava.',
    correction: [
      'Repita a operacao.',
      'Se persistir, anote o codigo exibido e reporte ao responsavel tecnico.',
    ],
    confirmation: 'A operacao conclui e a auditoria registra a alteracao sem campos proibidos.',
  },
  'sem-alteracao': {
    symptom: 'Ao salvar, aparece a mensagem de que nenhuma alteracao foi detectada.',
    preserved: ['o estado atual', 'a revisao atual'],
    changed: [],
    impact: 'A escala vigente permanece exatamente como estava.',
    correction: [
      'Verifique se voce realmente alterou algum campo.',
      'Se nao havia mudanca, apenas feche a mensagem.',
    ],
    confirmation: 'Ao fazer uma mudanca real e salvar, a alteracao e aceita.',
  },
  'comando-falhou': {
    symptom: 'A operacao nao conclui e aparece uma mensagem generica de falha.',
    preserved: ['o estado anterior'],
    changed: [],
    impact: 'Nenhuma mudanca confirmada; a escala vigente permanece como estava.',
    correction: [
      'Tente novamente a operacao.',
      'Se persistir, anote o codigo exibido e reporte ao responsavel tecnico.',
    ],
    confirmation: 'A operacao conclui normalmente na nova tentativa.',
  },
};

/** Todos os procedimentos vigentes, em ordem estavel por codigo. */
export function allProcedures(): readonly FailureProcedure[] {
  return [...COMMAND_ERROR_CODES]
    .slice()
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((code) => ({ code, ...PROCEDURES[code] }));
}

/** Procedimento de um codigo especifico (ou `undefined` se inexistente). */
export function procedureFor(code: CommandErrorCode): FailureProcedure | undefined {
  const p = PROCEDURES[code];
  return p ? { code, ...p } : undefined;
}

/**
 * Codigos emitiveis que NAO possuem procedimento (deve ser sempre vazio). Usado
 * pelo teste de sincronizacao (Property 46).
 */
export function codesWithoutProcedure(): readonly CommandErrorCode[] {
  return COMMAND_ERROR_CODES.filter((code) => PROCEDURES[code] === undefined);
}

/**
 * Procedimentos ORFAOS: chaves em `PROCEDURES` que nao correspondem a nenhum
 * codigo emitivel (deve ser sempre vazio). Usado pelo teste de sincronizacao.
 */
export function orphanProcedures(): readonly string[] {
  const emitibles = new Set<string>(COMMAND_ERROR_CODES);
  return Object.keys(PROCEDURES).filter((key) => !emitibles.has(key));
}

/**
 * Gera o markdown do catalogo de falhas (ajuda/README) a partir do mesmo
 * catalogo tipado. Deterministico: a ordem e por codigo.
 */
export function renderFailureCatalogMarkdown(): string {
  const lines: string[] = [];
  lines.push(`# Catalogo de falhas (versao ${FAILURE_CATALOG_VERSION})`);
  lines.push('');
  lines.push(
    'Para cada situacao de erro, veja o sintoma, o que foi preservado, o impacto, ' +
      'como corrigir e como confirmar que a falha foi superada.',
  );
  lines.push('');
  for (const p of allProcedures()) {
    // Reusa o titulo oficial do AppError para manter a mensagem alinhada a UI.
    const err = makeAppError(p.code);
    lines.push(`## ${err.title} (\`${p.code}\`)`);
    lines.push('');
    lines.push(`- Sintoma: ${p.symptom}`);
    lines.push(`- Preservado: ${p.preserved.join('; ')}.`);
    lines.push(`- Alterado: ${p.changed.length > 0 ? p.changed.join('; ') + '.' : 'nada.'}`);
    lines.push(`- Impacto: ${p.impact}`);
    lines.push('- Correcao:');
    for (const step of p.correction) lines.push(`  1. ${step}`);
    lines.push(`- Confirmacao: ${p.confirmation}`);
    lines.push('');
  }
  return lines.join('\n');
}
