/**
 * obs-publico.js
 *
 * Termos proibidos em textos publicados (OBS do atual.json e campo Observação
 * do card da montagem). A lista nasce de scripts/validacao/validar-obs-publico.js,
 * que passa a importá-la para manter a mesma saída de linha de comando.
 *
 * IMPORTANTE: o prefixo "PUBLICAR:" exigido pelo script de linha de comando NÃO
 * é exigido no editor — a OBS vem do campo "Observação" do card e o viewer a
 * exibe literalmente. Este módulo cuida apenas da lista de termos proibidos; o
 * prefixo continua sendo responsabilidade do script.
 *
 * Feature: melhoras-domingao (F. Envio) — Task 26; Requisitos 15.8, 15.9.
 */

/** Termos típicos de anotações internas/sensíveis que não podem ir ao público. */
export const TERMOS_PROIBIDOS = [
  /\bdesenvolvimento\b/i,
  /\binterno\b/i,
  /\bprivad[oa]\b/i,
  /\brascunho\b/i,
  /\bdraft\b/i,
  /\bpenden(te|cia)\b/i,
  /\bajuste\b/i,
  /\bsubstitui(cao|ção)\b/i,
  /\bwhats(app)?\b/i,
  /\btelefone\b/i,
  /\bcontato\b/i,
  /\be-?mail\b/i,
  /\bsenha\b/i,
  /\btoken\b/i,
  /\bcpf\b/i,
  /\brg\b/i,
  /\btodo\b/i,
  /\bobs\s*interna\b/i,
];

/** O texto contém algum termo proibido? Devolve o primeiro padrão ou null. */
export function termoProibido(texto) {
  const valor = String(texto == null ? '' : texto);
  return TERMOS_PROIBIDOS.find((rx) => rx.test(valor)) || null;
}
