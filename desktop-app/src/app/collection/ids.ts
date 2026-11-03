// Reexporta os utilitarios de id/instante usados pela interface de coleta.
// Mantem um unico ponto de geracao de UUID e instante UTC para a aplicacao.
export { newUuid, nowUtc } from '../registry/ids';
