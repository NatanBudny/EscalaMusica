import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { normalizarNome } from '../../src/utils/name.js';
import { problemasNome } from './texto-publico.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const MODOS_GRUPO = new Set(['funcao', 'culto_inteiro']);
const FUNCOES_GRUPO = new Set(['regente', 'equipe', 'mm']);

/**
 * Carrega e valida pessoas.json. Retorna estrutura indexada.
 * @param {string} [caminhoPessoas] - Caminho opcional (default: ROOT/pessoas.json)
 * @returns {{ pessoas: object[], porId: Map<number, object>, porNome: Map<string, object>, grupos: Map<string, object> }}
 */
export function carregarPessoas(caminhoPessoas) {
  const caminho = caminhoPessoas || resolve(ROOT, 'pessoas.json');

  let conteudo;
  try {
    conteudo = readFileSync(caminho, 'utf8');
  } catch (err) {
    throw new Error(`Não foi possível ler o arquivo de pessoas: ${caminho} (${err.message})`);
  }

  let dados;
  try {
    dados = JSON.parse(conteudo);
  } catch (err) {
    throw new Error(`JSON inválido em ${caminho}: ${err.message}`);
  }

  const pessoas = dados.pessoas;
  if (!Array.isArray(pessoas)) {
    throw new Error('Campo "pessoas" deve ser um array no arquivo de cadastro.');
  }

  const porId = new Map();
  const porNome = new Map();
  const todosNomesEAliases = new Set();

  // Validar IDs únicos e positivos
  for (const pessoa of pessoas) {
    if (!Number.isInteger(pessoa.id) || pessoa.id <= 0) {
      throw new Error(`ID inválido: ${JSON.stringify(pessoa.id)}. IDs devem ser inteiros positivos.`);
    }
    if (porId.has(pessoa.id)) {
      throw new Error(`ID duplicado: ${pessoa.id} (pessoa "${pessoa.nome}").`);
    }
    porId.set(pessoa.id, pessoa);
  }

  // Validar nomes canônicos únicos (UPPER) e aliases globalmente únicos
  for (const pessoa of pessoas) {
    const nome = pessoa.nome;
    if (!nome || typeof nome !== 'string') {
      throw new Error(`Nome inválido para pessoa com ID ${pessoa.id}.`);
    }
    if (nome !== nome.toUpperCase()) {
      throw new Error(`Nome "${nome}" (ID ${pessoa.id}) deve ser UPPER CASE.`);
    }

    if (todosNomesEAliases.has(nome)) {
      throw new Error(`Nome duplicado: "${nome}" (ID ${pessoa.id}). Nomes devem ser únicos.`);
    }
    todosNomesEAliases.add(nome);
    porNome.set(nome, pessoa);

    const aliases = pessoa.aliases || [];
    for (const alias of aliases) {
      if (todosNomesEAliases.has(alias)) {
        throw new Error(
          `Alias duplicado: "${alias}" (ID ${pessoa.id}). Aliases devem ser globalmente únicos e não duplicar nomes.`
        );
      }
      todosNomesEAliases.add(alias);
      porNome.set(alias, pessoa);
    }
  }

  // Validar grupos
  const gruposRaw = dados.grupos || {};
  const grupos = new Map();

  // Índice normalizado de nomes/apelidos de pessoas, para checar colisão com
  // nome_exibicao de grupos escaláveis.
  const nomesNormPessoas = new Set();
  for (const pessoa of pessoas) {
    const k = normalizarNome(pessoa.nome);
    if (k) nomesNormPessoas.add(k);
    for (const alias of pessoa.aliases || []) {
      const ka = normalizarNome(alias);
      if (ka) nomesNormPessoas.add(ka);
    }
  }
  const nomesExibicaoNorm = new Set();

  for (const [nomeGrupo, defGrupo] of Object.entries(gruposRaw)) {
    const membrosIds = defGrupo.membros_ids;
    if (!Array.isArray(membrosIds)) {
      throw new Error(`Grupo "${nomeGrupo}": campo "membros_ids" deve ser um array.`);
    }
    for (const membroId of membrosIds) {
      if (!porId.has(membroId)) {
        throw new Error(
          `Grupo "${nomeGrupo}": membro com ID ${membroId} não existe no cadastro.`
        );
      }
    }

    // Validações específicas de Grupo_Escalavel (escalavel: true).
    if (defGrupo.escalavel === true) {
      if (membrosIds.length === 0) {
        throw new Error(`Grupo "${nomeGrupo}": grupo escalável precisa de ao menos um membro.`);
      }
      if (!porId.has(defGrupo.responsavel_id)) {
        throw new Error(
          `Grupo "${nomeGrupo}": responsável com ID ${defGrupo.responsavel_id} não existe no cadastro.`
        );
      }
      const modo = defGrupo.modo == null ? 'funcao' : defGrupo.modo;
      if (!MODOS_GRUPO.has(modo)) {
        throw new Error(`Grupo "${nomeGrupo}": modo inválido "${modo}" (use funcao ou culto_inteiro).`);
      }
      const funcoes = defGrupo.funcoes == null ? ['mm'] : defGrupo.funcoes;
      if (!Array.isArray(funcoes)) {
        throw new Error(`Grupo "${nomeGrupo}": "funcoes" deve ser um array.`);
      }
      for (const f of funcoes) {
        if (!FUNCOES_GRUPO.has(f)) {
          throw new Error(`Grupo "${nomeGrupo}": função inválida "${f}" (use regente, equipe ou mm).`);
        }
      }
      if (defGrupo.mensagem != null && typeof defGrupo.mensagem !== 'string') {
        throw new Error(`Grupo "${nomeGrupo}": "mensagem" deve ser texto ou null.`);
      }
      const nomeExib = defGrupo.nome_exibicao;
      const probs = problemasNome(nomeExib || '');
      if (probs.length > 0) {
        throw new Error(`Grupo "${nomeGrupo}": nome_exibicao inválido ("${nomeExib}"): ${probs.join(' ')}`);
      }
      const chaveNorm = normalizarNome(nomeExib);
      if (nomesNormPessoas.has(chaveNorm)) {
        throw new Error(
          `Grupo "${nomeGrupo}": nome_exibicao "${nomeExib}" coincide com nome ou apelido de pessoa.`
        );
      }
      if (nomesExibicaoNorm.has(chaveNorm)) {
        throw new Error(
          `Grupo "${nomeGrupo}": nome_exibicao "${nomeExib}" coincide com o de outro grupo.`
        );
      }
      nomesExibicaoNorm.add(chaveNorm);
    }

    grupos.set(nomeGrupo, defGrupo);
  }

  // Validar vínculos
  for (const pessoa of pessoas) {
    const vinculos = pessoa.vinculos || [];
    for (const vinculo of vinculos) {
      if (vinculo.tipo === 'sempre_junto') {
        if (!Number.isInteger(vinculo.com_id) || !porId.has(vinculo.com_id)) {
          throw new Error(
            `Vínculo "sempre_junto" da pessoa "${pessoa.nome}" (ID ${pessoa.id}) referencia ID inexistente: ${vinculo.com_id}.`
          );
        }
        // Validar simetria (P8): se A→B, então B→A
        const parceiro = porId.get(vinculo.com_id);
        const parceiroVinculos = parceiro.vinculos || [];
        const temReciprocidade = parceiroVinculos.some(
          (v) => v.tipo === 'sempre_junto' && v.com_id === pessoa.id
        );
        if (!temReciprocidade) {
          throw new Error(
            `Vínculo assimétrico (P8): "${pessoa.nome}" (ID ${pessoa.id}) tem sempre_junto com ID ${vinculo.com_id} ("${parceiro.nome}"), mas "${parceiro.nome}" não tem vínculo recíproco.`
          );
        }
      } else if (vinculo.tipo === 'familia_requerida') {
        if (!vinculo.grupo || !grupos.has(vinculo.grupo)) {
          throw new Error(
            `Vínculo "familia_requerida" da pessoa "${pessoa.nome}" (ID ${pessoa.id}) referencia grupo inexistente: "${vinculo.grupo}".`
          );
        }
      } else if (vinculo.tipo === 'precisa_de') {
        const comIds = vinculo.com_ids;
        if (!Array.isArray(comIds) || comIds.length === 0) {
          throw new Error(
            `Vínculo "precisa_de" da pessoa "${pessoa.nome}" (ID ${pessoa.id}) deve ter "com_ids" não vazio.`
          );
        }
        for (const comId of comIds) {
          if (!Number.isInteger(comId) || !porId.has(comId)) {
            throw new Error(
              `Vínculo "precisa_de" da pessoa "${pessoa.nome}" (ID ${pessoa.id}) referencia ID inexistente: ${comId}.`
            );
          }
          if (comId === pessoa.id) {
            throw new Error(
              `Vínculo "precisa_de" da pessoa "${pessoa.nome}" (ID ${pessoa.id}) não pode referenciar a própria pessoa.`
            );
          }
        }
      }
    }
  }

  // Validar proximo_id (P2): deve ser max(ids) + 1
  const maxId = Math.max(...pessoas.map((p) => p.id));
  const proximoIdEsperado = maxId + 1;
  if (dados.proximo_id !== proximoIdEsperado) {
    throw new Error(
      `proximo_id inválido (P2): valor no arquivo = ${dados.proximo_id}, esperado = ${proximoIdEsperado} (max ID ${maxId} + 1).`
    );
  }

  return { pessoas, porId, porNome, grupos };
}
