// Catalogo tipado de erros do dominio voltado ao operador (`AppError`).
//
// Design.md, "Modelo de erro voltado ao operador": todo erro vira um `AppError`
// com cinco blocos em portugues (o que nao foi concluido, por que, o que foi
// preservado, impacto, o que fazer agora) e um `technicalReference` sanitizado
// (sem segredos). Este modulo define o contrato e uma fabrica central para os
// codigos emitiveis pela camada de comandos.
//
// TypeScript puro: sem I/O. As mensagens sao fixas e em portugues.

/** Acao segura oferecida ao operador para recuperar-se do erro. */
export interface AppErrorAction {
  readonly id: string;
  readonly label: string;
}

/**
 * Erro voltado ao operador. Espelha o contrato de `design.md`:
 *   title            -> bloco "O que nao foi concluido"
 *   explanationPtBr  -> bloco "Por que aconteceu"
 *   preserved        -> bloco "O que foi preservado"
 *   impact           -> bloco "Impacto na escala vigente"
 *   actions          -> bloco "O que fazer agora"
 */
export interface AppError {
  readonly code: string;
  readonly title: string;
  readonly explanationPtBr: string;
  readonly preserved: string[];
  readonly changed: string[];
  readonly impact: string;
  readonly actions: AppErrorAction[];
  /** Referencia tecnica sanitizada (IDs, horarios); NUNCA contem segredos. */
  readonly technicalReference?: string;
}

/** Codigos de erro emitiveis pela camada de comandos. */
export type CommandErrorCode =
  | 'revisao-divergente'
  | 'validacao-dominio'
  | 'auditoria-invalida'
  | 'sem-alteracao'
  | 'comando-falhou';

interface ErrorTemplate {
  readonly title: string;
  readonly explanationPtBr: string;
  readonly preserved: string[];
  readonly impact: string;
  readonly actions: AppErrorAction[];
}

const TEMPLATES: Record<CommandErrorCode, ErrorTemplate> = {
  'revisao-divergente': {
    title: 'A alteracao nao foi aplicada porque a revisao mudou.',
    explanationPtBr:
      'O estado foi alterado por outra operacao depois que esta edicao comecou. ' +
      'Para evitar sobrescrever o trabalho de outra alteracao, a edicao foi recusada.',
    preserved: ['a revisao atual do estado', 'todos os dados ja gravados'],
    impact: 'Nenhuma mudanca foi aplicada; a escala vigente permanece como estava.',
    actions: [
      { id: 'recarregar', label: 'Recarregar o estado atual e revisar' },
      { id: 'reaplicar', label: 'Refazer a alteracao sobre a revisao mais recente' },
    ],
  },
  'validacao-dominio': {
    title: 'A alteracao foi recusada pela validacao.',
    explanationPtBr:
      'O resultado proposto violaria uma regra do cadastro ou do formato exigido. ' +
      'A operacao foi interrompida antes de gravar qualquer coisa.',
    preserved: ['o agregado anterior', 'a revisao atual'],
    impact: 'Nenhuma mudanca foi aplicada; a escala vigente permanece como estava.',
    actions: [
      { id: 'corrigir', label: 'Ir ao campo indicado e corrigir' },
      { id: 'cancelar', label: 'Cancelar a edicao' },
    ],
  },
  'auditoria-invalida': {
    title: 'A alteracao nao foi registrada porque a auditoria seria invalida.',
    explanationPtBr:
      'O evento de auditoria gerado para esta alteracao nao passou no esquema de ' +
      'auditoria. Isso impede registrar campos nao permitidos (inclusive segredos).',
    preserved: ['o agregado anterior', 'a revisao atual', 'o registro de auditoria existente'],
    impact: 'Nenhuma mudanca foi aplicada; a escala vigente permanece como estava.',
    actions: [{ id: 'reportar', label: 'Repetir a operacao ou reportar o problema' }],
  },
  'sem-alteracao': {
    title: 'Nenhuma alteracao foi detectada.',
    explanationPtBr:
      'O estado proposto e identico ao estado atual. Nenhuma revisao ou evento ' +
      'de auditoria e necessario.',
    preserved: ['o estado atual', 'a revisao atual'],
    impact: 'A escala vigente permanece exatamente como estava.',
    actions: [{ id: 'fechar', label: 'Fechar' }],
  },
  'comando-falhou': {
    title: 'A operacao nao foi concluida.',
    explanationPtBr: 'Nao foi possivel identificar a causa com precisao.',
    preserved: ['o estado anterior'],
    impact: 'Nenhuma mudanca confirmada; a escala vigente permanece como estava.',
    actions: [{ id: 'tentar-novamente', label: 'Tentar novamente' }],
  },
};

/**
 * Cria um `AppError` a partir de um codigo conhecido. Permite sobrescrever a
 * explicacao (para detalhar a causa), os campos preservados/alterados e a
 * referencia tecnica sanitizada.
 */
export function makeAppError(
  code: CommandErrorCode,
  overrides: {
    explanationPtBr?: string;
    preserved?: string[];
    changed?: string[];
    impact?: string;
    technicalReference?: string;
  } = {},
): AppError {
  const t = TEMPLATES[code];
  return {
    code,
    title: t.title,
    explanationPtBr: overrides.explanationPtBr ?? t.explanationPtBr,
    preserved: overrides.preserved ?? [...t.preserved],
    changed: overrides.changed ?? [],
    impact: overrides.impact ?? t.impact,
    actions: t.actions.map((a) => ({ ...a })),
    ...(overrides.technicalReference !== undefined
      ? { technicalReference: overrides.technicalReference }
      : {}),
  };
}

/** Lista de todos os codigos de erro emitiveis (util para catalogos/testes). */
export const COMMAND_ERROR_CODES: readonly CommandErrorCode[] = Object.keys(
  TEMPLATES,
) as CommandErrorCode[];
