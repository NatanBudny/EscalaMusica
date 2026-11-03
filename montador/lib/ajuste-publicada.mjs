// Ajustar escala publicada (Task 37).
//
// Corrige um único campo de um culto já publicado em atual.json, com as MESMAS
// regras do envio (revalidação + conferência de links), sem refazer o mês e sem
// a tela de WhatsApp. O ajuste:
//   1. lista os cultos de atual.json para a interface (listarPublicada);
//   2. prevê a revalidação do ajuste sem gravar (previsaoAjuste);
//   3. grava só o campo alterado, recalcula os Controles_de_Rotacao, cria um
//      Commit_Seletivo de atual.json e dos controles, envia e deixa o chamador
//      seguir para a verificação automática do site (ajustar).
//
// Campos editáveis (Requisito 28.2):
//   - 'REGENTE LOUVOR', 'EQUIPE LOUVOR', 'MENSAGEM MUSICAL': `valor` é uma lista
//     de ocupantes (id de pessoa ou 'grupo:<chave>'); o nome publicado é
//     `pessoa.nome` ou `nome_exibicao`;
//   - 'OBS': texto público (placeholder "Este texto será publicado na escala
//     online"), validado por problemasObs;
//   - 'ACOMP': Banda/PB.
//
// A revalidação reaproveita revalidarParaEnvio (Tasks 29/30) sobre a escala do
// mês inteira lida de atual.json (cultosDeAtual) com o campo alterado aplicado,
// então inclui validarEscala, travaTelefone, verificarObs, validarCatalogo e a
// Conferencia_de_Links. Só grava quando não há erro e todo aviso tem ciência
// (Requisito 28.3), como o fechamento (Property 31).
//
// A gravação altera apenas o campo escolhido do culto escolhido (Property 36):
// as demais linhas e os demais campos da linha ficam idênticos.
//
// Feature: melhoras-domingao (F. Envio) — Task 37; Properties 31, 36;
// Requisitos 28.1 a 28.5.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ROOT, carregarContexto, toBrDate } from './regras.mjs';
import { criarGit } from './git.mjs';
import { cultosDeAtual, cultoParaAtual, CAMPOS_ATUAL } from './publicar.mjs';
import { revalidarParaEnvio } from './revalidacao.mjs';
import { atualizarControles } from './controles.mjs';
import { ErroFechamento } from './fechamento.mjs';

/** Campos de nome (valor = lista de ocupantes). */
const CAMPOS_NOME = new Set(['REGENTE LOUVOR', 'EQUIPE LOUVOR', 'MENSAGEM MUSICAL']);

/** Todos os campos que o ajuste aceita editar. */
const CAMPOS_EDITAVEIS = new Set([...CAMPOS_NOME, 'OBS', 'ACOMP']);

/** Converte "DD/MM/AAAA" → "AAAA-MM-DD" (ou null). */
function dataIso(dataBR) {
  const m = String(dataBR || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** Mês ("AAAA-MM") da primeira linha de atual.json, ou null. */
function mesDoAtual(linhas) {
  for (const linha of Array.isArray(linhas) ? linhas : []) {
    const iso = dataIso(linha && linha.DATA);
    if (iso) return iso.slice(0, 7);
  }
  return null;
}

/** Lê atual.json como array de linhas (ou []). */
function lerAtual(root) {
  const caminho = resolve(root, 'atual.json');
  if (!existsSync(caminho)) return [];
  try {
    const dados = JSON.parse(readFileSync(caminho, 'utf8'));
    return Array.isArray(dados) ? dados : [];
  } catch {
    return [];
  }
}

/**
 * Lista os cultos de atual.json para a tela "Ajustar escala publicada".
 *
 * @param {{ root?: string }} [opts]
 * @returns {{ mes: string|null, linhas: object[] }}
 */
export function listarPublicada({ root = ROOT } = {}) {
  const linhas = lerAtual(root);
  return { mes: mesDoAtual(linhas), linhas };
}

/**
 * Valida a entrada do ajuste (campo conhecido e valor coerente).
 * @returns {string|null} mensagem de erro de forma, ou null
 */
function problemaDeForma({ data, campo, valor }) {
  if (!data) return 'data obrigatória.';
  if (!campo || !CAMPOS_EDITAVEIS.has(campo)) {
    return `campo inválido: ${campo}.`;
  }
  if (CAMPOS_NOME.has(campo) && !Array.isArray(valor)) {
    return 'para campos de nome, valor deve ser uma lista de ocupantes.';
  }
  if ((campo === 'OBS' || campo === 'ACOMP') && typeof valor !== 'string') {
    return `para ${campo}, valor deve ser texto.`;
  }
  return null;
}

/**
 * Aplica o campo alterado a uma linha de atual.json, devolvendo a nova linha
 * (sem mutar a original). Para campos de nome, gera o texto publicado via
 * cultoParaAtual sobre um CultoMontagem com só aquele slot preenchido; para OBS
 * e ACOMP, grava o texto direto. Nenhum outro campo é tocado.
 *
 * @param {object} linha - LinhaAtual original
 * @param {string} campo
 * @param {Array|string} valor
 * @param {object} base - contexto (para resolver ids → nome publicado)
 * @returns {object} nova linha
 */
function aplicarCampo(linha, campo, valor, base) {
  const nova = { ...linha };

  if (campo === 'OBS' || campo === 'ACOMP') {
    nova[campo] = valor;
    return nova;
  }

  // Campo de nome: monta um CultoMontagem mínimo só com o slot do campo e lê o
  // valor publicado de volta por cultoParaAtual (mesma geração do fechamento).
  const iso = dataIso(linha.DATA) || '';
  const diaNorm = String(linha['DIA SEMANA'] || '').toLowerCase();
  const modelo = diaNorm.includes('sab')
    ? 'sabado'
    : diaNorm.includes('dom')
      ? 'domingo'
      : 'sem_louvor';
  const ocupantes = Array.isArray(valor) ? valor : [];
  const cultoTmp = {
    data: iso,
    dia_semana: modelo,
    modelo_louvor: modelo,
    tipo: 'louvor',
    regente: null,
    equipe: [],
    mm: {},
  };
  if (campo === 'REGENTE LOUVOR') {
    cultoTmp.regente = ocupantes[0] != null ? ocupantes[0] : null;
  } else if (campo === 'EQUIPE LOUVOR') {
    cultoTmp.equipe = ocupantes;
  } else if (campo === 'MENSAGEM MUSICAL') {
    if (modelo === 'sabado') {
      if (ocupantes[0] != null) cultoTmp.mm.mm_es = ocupantes[0];
      if (ocupantes[1] != null) cultoTmp.mm.mm_culto = ocupantes[1];
    } else {
      if (ocupantes[0] != null) cultoTmp.mm.mm_domingo = ocupantes[0];
    }
  }
  const gerada = cultoParaAtual(cultoTmp, base, linha);
  nova[campo] = gerada[campo];
  return nova;
}

/**
 * Revalida a escala do mês inteira (lida de atual.json) com o campo alterado
 * aplicado, reaproveitando revalidarParaEnvio. Devolve o relatório completo e a
 * nova linha da data ajustada.
 *
 * @returns {{ erros, avisos, conferencia, mes, novaLinha, linhasAjustadas }}
 */
function revalidarAjuste({ data, campo, valor }, root) {
  const linhas = lerAtual(root);
  const mes = mesDoAtual(linhas);
  if (!mes) {
    throw new ErroFechamento({
      status: 422,
      erros: [
        {
          id: 'ajuste|sem-atual',
          chave: 'ajuste',
          refs: [],
          nivel: 'bloqueio',
          data,
          slot: campo,
          pessoaId: null,
          texto: 'Nenhuma escala publicada para ajustar.',
        },
      ],
    });
  }

  const alvoBR = toBrDate(data);
  const idx = linhas.findIndex((l) => l.DATA === alvoBR);
  if (idx === -1) {
    throw new ErroFechamento({
      status: 422,
      erros: [
        {
          id: `ajuste|data|${data}`,
          chave: 'ajuste',
          refs: [],
          nivel: 'bloqueio',
          data,
          slot: campo,
          pessoaId: null,
          texto: `Culto ${alvoBR} não está em atual.json.`,
        },
      ],
    });
  }

  const base = carregarContexto(mes, { root });

  // Aplica o campo na linha-alvo e revalida o mês inteiro com a mudança.
  const novaLinha = aplicarCampo(linhas[idx], campo, valor, base);
  const linhasAjustadas = linhas.map((l, i) => (i === idx ? novaLinha : l));

  // Só as linhas do mês do ajuste entram na montagem (atual.json pode conter
  // outro mês durante a transição).
  const linhasDoMes = linhasAjustadas.filter((l) => dataIso(l.DATA)?.slice(0, 7) === mes);
  const cultos = cultosDeAtual(linhasDoMes, base);
  const { erros, avisos, conferencia } = revalidarParaEnvio(base, cultos, { root });

  return { erros, avisos, conferencia, mes, novaLinha, linhasAjustadas, base };
}

/**
 * Prevê a revalidação do ajuste sem gravar nada.
 *
 * @param {{ data: string, campo: string, valor: Array|string }} entrada
 * @param {{ root?: string }} [opts]
 * @returns {{ erros, avisos, conferencia: { tabela } }}
 */
export function previsaoAjuste({ data, campo, valor }, { root = ROOT } = {}) {
  const forma = problemaDeForma({ data, campo, valor });
  if (forma) {
    return {
      erros: [
        {
          id: `ajuste|forma|${campo}`,
          chave: 'ajuste',
          refs: [],
          nivel: 'bloqueio',
          data,
          slot: campo,
          pessoaId: null,
          texto: forma,
        },
      ],
      avisos: [],
      conferencia: { tabela: [] },
    };
  }

  try {
    const { erros, avisos, conferencia } = revalidarAjuste({ data, campo, valor }, root);
    return { erros, avisos, conferencia: { tabela: (conferencia && conferencia.tabela) || [] } };
  } catch (err) {
    if (err instanceof ErroFechamento) {
      return { erros: err.erros, avisos: [], conferencia: { tabela: [] } };
    }
    throw err;
  }
}

/** Garante a ordem de chaves de CAMPOS_ATUAL numa linha. */
function ordenarChaves(linha) {
  const o = {};
  for (const k of CAMPOS_ATUAL) o[k] = linha[k] ?? '';
  // Preserva quaisquer chaves extras que já existissem na linha.
  for (const k of Object.keys(linha)) if (!(k in o)) o[k] = linha[k];
  return o;
}

/**
 * Aplica o ajuste: revalida com as regras do envio, grava SÓ o campo alterado
 * em atual.json, recalcula os controles, comita atual.json + controles e envia.
 *
 * @param {{ data, campo, valor, ciencias?: string[] }} entrada
 * @param {{ root?: string, git?: object }} [opts]
 * @returns {Promise<{ relatorio: object, git: object }>}
 * @throws {ErroFechamento} 422 (erro de revalidação) ou 409 (aviso sem ciência)
 */
export async function ajustar(
  { data, campo, valor, ciencias = [] },
  { root = ROOT, git = criarGit({ cwd: root }) } = {},
) {
  const forma = problemaDeForma({ data, campo, valor });
  if (forma) {
    throw new ErroFechamento({
      status: 422,
      erros: [
        {
          id: `ajuste|forma|${campo}`,
          chave: 'ajuste',
          refs: [],
          nivel: 'bloqueio',
          data,
          slot: campo,
          pessoaId: null,
          texto: forma,
        },
      ],
    });
  }

  // Sincroniza antes de mexer no atual.json.
  const pull = await git.pullRebase();
  if (pull && pull.conflitos) {
    throw new ErroFechamento({
      status: 409,
      conflitos: pull.conflitos,
      mensagem: 'Conflito de sincronização ao ajustar.',
    });
  }

  const { erros, avisos, conferencia, mes, novaLinha, linhasAjustadas } = revalidarAjuste(
    { data, campo, valor },
    root,
  );

  if (erros.length > 0) {
    throw new ErroFechamento({ status: 422, erros });
  }
  const semCiencia = avisos.filter((a) => !ciencias.includes(a.id));
  if (semCiencia.length > 0) {
    throw new ErroFechamento({ status: 409, avisosSemCiencia: semCiencia });
  }

  // Grava SÓ o campo alterado: parte das linhas originais e troca apenas o
  // campo da linha-alvo (Property 36). Como revalidarAjuste já montou
  // linhasAjustadas trocando só a linha-alvo, e aplicarCampo tocou só `campo`,
  // o atual.json resultante difere do original somente nesse campo.
  const alvoBR = toBrDate(data);
  const linhasFinais = linhasAjustadas.map((l) =>
    l.DATA === alvoBR ? ordenarChaves(novaLinha) : l,
  );

  const atualPath = resolve(root, 'atual.json');
  writeFileSync(atualPath, `${JSON.stringify(linhasFinais, null, 2)}\n`, 'utf8');

  // Recalcula os três controles de rotação com o campo já ajustado.
  const base = carregarContexto(mes, { root });
  const { arquivos: controles } = atualizarControles(mes, {
    root,
    parametros: base.parametros,
  });

  const arquivos = ['atual.json', ...controles];
  const commit = await git.commitSeletivo(
    arquivos,
    `Ajusta escala publicada ${alvoBR} — ${campo} (editor de escala)`,
  );
  const envio = await git.enviar();

  return {
    relatorio: {
      ok: true,
      mes,
      data: alvoBR,
      campo,
      arquivos,
      avisos,
      conferencia: { tabela: (conferencia && conferencia.tabela) || [] },
    },
    git: {
      commit: commit && (commit.commit || commit.semAlteracoes ? commit : undefined),
      push: envio && envio.push,
      conflitos: envio && envio.conflitos,
      erro: envio && envio.erro,
    },
  };
}
