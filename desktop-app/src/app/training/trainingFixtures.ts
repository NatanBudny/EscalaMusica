// Fixtures ficticias e destino simulado do modo de treinamento (tarefa 16.2).
//
// Objetivo (Requisitos 15.11-15.14): o treino opera sobre dados ABSOLUTAMENTE
// ficticios, com workspace, credenciais e publicacao SIMULADOS, separados da
// operacao real. Nada aqui referencia pessoas, telefones ou cultos reais: os
// nomes sao claramente ficticios ("FULANO DE TESTE", etc.).
//
// Modulo TypeScript PURO (sem I/O). O "destino simulado" e apenas uma estrutura
// em memoria que registra o que SERIA publicado, sem jamais tocar a rede ou os
// arquivos reais.

/** Conjunto de dados ficticios usado como ponto de partida do treino. */
export interface TrainingFixtures {
  readonly pessoas: readonly string[];
  readonly departamentos: readonly string[];
  readonly mes: string;
  readonly cultos: readonly string[];
  /** Credencial SIMULADA (nunca e um token real). */
  readonly credencialSimulada: string;
}

/** Fixtures ficticias padrao (claramente irreais). */
export const DEFAULT_TRAINING_FIXTURES: TrainingFixtures = {
  pessoas: ['FULANO DE TESTE', 'BELTRANA DE TESTE', 'SICRANO DE TESTE'],
  departamentos: ['DEPARTAMENTO FICTICIO'],
  mes: '2099-01',
  cultos: ['2099-01-03 (sabado)', '2099-01-04 (domingo)'],
  credencialSimulada: 'token-de-treino-SIMULADO',
};

/** Destino de publicacao SIMULADO: registra pacotes sem publicar de verdade. */
export interface SimulatedPublishTarget {
  readonly repositorioSimulado: string;
  readonly publicados: readonly string[];
}

export function createSimulatedTarget(
  repositorioSimulado = 'repo-de-treino-SIMULADO',
): SimulatedPublishTarget {
  return { repositorioSimulado, publicados: [] };
}

/** Registra um pacote no destino simulado (puro: devolve novo destino). */
export function simulatedPublishTo(
  target: SimulatedPublishTarget,
  packageId: string,
): SimulatedPublishTarget {
  return { ...target, publicados: [...target.publicados, packageId] };
}
