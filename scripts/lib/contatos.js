/**
 * contatos.js
 *
 * Deriva `contatos.json` a partir de `pessoas.json` (lógica pura, reusada pelo
 * script `scripts/manutencao/gerar-contatos.js` e pelo editor de escala).
 *
 * Formato de saída:
 * {
 *   "NOME": { "telefone": "https://wa.me/<dígitos>", "apelidos": ["ALIAS1", ...] }
 * }
 *
 * Inclui exatamente:
 * - cada pessoa com telefone preenchido (chave = nome, apelidos = aliases);
 * - uma entrada por Grupo_Escalável (`grupos[*].escalavel === true`) cujo
 *   responsável tem telefone (chave = nome_exibicao, telefone do responsável,
 *   apelidos vazios).
 *
 * Chaves ordenadas alfabeticamente (pt-BR, insensível a acento/caixa).
 *
 * Feature: melhoras-domingao (B. Cadastro) — Property 3; Requisitos 3.2, 23.4.
 */

/** Só os dígitos do telefone. */
function digitos(valor) {
  return String(valor || '').replace(/\D/g, '');
}

/**
 * Deriva o objeto de contatos a partir das pessoas e dos grupos.
 *
 * @param {Array<object>} pessoas - lista de pessoas de pessoas.json
 * @param {Record<string, object>} [grupos] - mapa de grupos de pessoas.json
 * @returns {Record<string, { telefone: string, apelidos: string[] }>}
 */
export function derivarContatos(pessoas, grupos = {}) {
  const lista = Array.isArray(pessoas) ? pessoas : [];
  const porId = new Map();
  for (const p of lista) porId.set(p.id, p);

  const contatos = {};

  // Pessoas com telefone.
  for (const pessoa of lista) {
    const tel = digitos(pessoa.telefone);
    if (!tel) continue;
    contatos[pessoa.nome] = {
      telefone: `https://wa.me/${tel}`,
      apelidos: Array.isArray(pessoa.aliases) ? [...pessoa.aliases] : [],
    };
  }

  // Grupos escaláveis cujo responsável tem telefone.
  const gruposObj = grupos && typeof grupos === 'object' ? grupos : {};
  for (const def of Object.values(gruposObj)) {
    if (!def || def.escalavel !== true) continue;
    const responsavel = porId.get(def.responsavel_id);
    if (!responsavel) continue;
    const tel = digitos(responsavel.telefone);
    if (!tel) continue;
    const chave = def.nome_exibicao;
    if (!chave) continue;
    contatos[chave] = {
      telefone: `https://wa.me/${tel}`,
      apelidos: [],
    };
  }

  // Ordena as chaves alfabeticamente para consistência.
  const chavesOrdenadas = Object.keys(contatos).sort((a, b) =>
    a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }),
  );

  const resultado = {};
  for (const chave of chavesOrdenadas) {
    resultado[chave] = contatos[chave];
  }
  return resultado;
}
