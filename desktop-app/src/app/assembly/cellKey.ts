// Chave estavel de uma celula (culto x funcao) da grade de montagem, usada para
// destaque de validacao e navegacao (tarefa 8.2). Mantida fora do componente
// para nao quebrar o fast refresh (um arquivo de componente so deve exportar
// componentes).
export function cellKey(serviceId: string, roleId: string): string {
  return `${serviceId}\u0000${roleId}`;
}
