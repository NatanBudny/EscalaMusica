// Importação da indisponibilidade pelo editor (Task 17).
//
// - validarEnquete(obj, mes): confere o formato e lista datas fora do mês.
// - analisarEnquete(enquete, cadastro): associa cada votante por telefone, por
//   nome/apelido normalizado ou deixa pendente (ambíguo / só por semelhança).
// - gravarImportacao(mes, enquete, decisoes, opts): grava a Enquete, a
//   Indisponibilidade_Vinculada (via montarVinculada) e o snapshot em arquivo/,
//   e devolve o relatório e os apelidos novos a gravar no cadastro.
//
// Feature: melhoras-domingao (D. Mês e insumos) — Task 17; Property 24;
// Requisitos 14.1 a 14.14.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { carregarPessoas } from '../../scripts/lib/cadastro.js';
import { problemasNome } from '../../scripts/lib/texto-publico.js';
import normalizar from '../../scripts/lib/normalizar.js';
import { resolverPessoaPorNome } from '../../scripts/lib/fuzzy-match.js';
import { normalizarNome } from '../../src/utils/name.js';
import { nomesDaEnquete, montarVinculada } from '../../scripts/lib/indisponibilidade.js';
import { ROOT } from './regras.mjs';

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Valida o formato da enquete e lista as datas fora do mês aberto.
 *
 * @param {object} obj
 * @param {string} mes - 'AAAA-MM'
 * @returns {{ erros: string[], datasIgnoradas: string[] }}
 */
export function validarEnquete(obj, mes) {
  const erros = [];
  const datasIgnoradas = [];

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { erros: ['Arquivo da enquete inválido (esperado um objeto JSON).'], datasIgnoradas };
  }
  if (!Array.isArray(obj.datas)) {
    erros.push('Campo "datas" ausente ou inválido (esperado um array).');
    return { erros, datasIgnoradas };
  }
  for (const entrada of obj.datas) {
    const ref = entrada && entrada.data_referencia;
    if (ref === 'geral') continue;
    if (!DATA_RE.test(String(ref || ''))) {
      erros.push(`data_referencia inválida: "${ref}" (esperado AAAA-MM-DD ou "geral").`);
      continue;
    }
    if (!ref.startsWith(`${mes}-`)) {
      datasIgnoradas.push(ref);
    }
  }
  return { erros, datasIgnoradas };
}

/**
 * Normaliza o telefone para o formato 55+DDD+número, aceitando a ausência do
 * nono dígito. Devolve o conjunto de formas comparáveis (com e sem nono dígito).
 */
function formasTelefone(digitos) {
  const formas = new Set();
  const d = String(digitos || '').replace(/\D/g, '');
  if (!d) return formas;
  formas.add(d);
  // 55 + DDD(2) + número(8 ou 9). Normaliza removendo/adicionando o 9.
  const m = d.match(/^55(\d{2})(\d{8,9})$/);
  if (m) {
    const ddd = m[1];
    const num = m[2];
    if (num.length === 9 && num[0] === '9') {
      formas.add(`55${ddd}${num.slice(1)}`); // sem o nono dígito
    } else if (num.length === 8) {
      formas.add(`55${ddd}9${num}`); // com o nono dígito
    }
  }
  return formas;
}

/** Índice de telefone normalizado → lista de pessoas. */
function indicePorTelefone(pessoas) {
  const mapa = new Map();
  for (const p of pessoas) {
    const formas = formasTelefone(p.telefone);
    for (const f of formas) {
      if (!mapa.has(f)) mapa.set(f, []);
      mapa.get(f).push(p);
    }
  }
  return mapa;
}

/** Índice de nome/apelido normalizado → lista de pessoas. */
function indicePorNomeNorm(pessoas) {
  const mapa = new Map();
  const add = (chave, p) => {
    if (!chave) return;
    if (!mapa.has(chave)) mapa.set(chave, []);
    if (!mapa.get(chave).includes(p)) mapa.get(chave).push(p);
  };
  for (const p of pessoas) {
    add(normalizar(p.nome), p);
    for (const alias of p.aliases || []) add(normalizar(alias), p);
  }
  return mapa;
}

function associado(pessoa, por) {
  return {
    estado: 'associado',
    por,
    pessoaId: pessoa.id,
    opcoes: [],
  };
}

function pendente(pessoas, porNome, chave) {
  // Quando não há candidatos diretos, sugere os mais parecidos por fuzzy.
  let opcoes = pessoas.map((p) => ({ id: p.id, nome: p.nome, confianca: 1 }));
  if (opcoes.length === 0 && porNome) {
    opcoes = maisParecidas(chave, porNome, 3);
  }
  return { estado: 'pendente', por: null, pessoaId: null, opcoes };
}

/** Até N pessoas mais parecidas por Dice (fuzzy-match), em ordem decrescente. */
function maisParecidas(chave, porNome, n = 3) {
  const vistos = new Map();
  // porNome é Map<chaveNormalizada, pessoa>; reusa resolverPessoaPorNome com
  // threshold 0 para pegar o melhor, mas precisamos de múltiplos: iteramos.
  for (const [, pessoa] of porNome) {
    const r = resolverPessoaPorNome(chave, new Map([[normalizar(pessoa.nome), pessoa]]), 0);
    if (r) {
      const atual = vistos.get(pessoa.id);
      if (!atual || r.confianca > atual.confianca) {
        vistos.set(pessoa.id, { id: pessoa.id, nome: pessoa.nome, confianca: Math.round(r.confianca * 100) / 100 });
      }
    }
  }
  return [...vistos.values()]
    .sort((a, b) => b.confianca - a.confianca || a.nome.localeCompare(b.nome))
    .slice(0, n);
}

/**
 * Analisa cada votante da enquete e devolve a associação proposta.
 *
 * @param {object} enquete
 * @param {{ pessoas: object[], porNome: Map }} cadastro
 * @returns {Array<{ nomeEnquete, estado, por, pessoaId, opcoes }>}
 */
export function analisarEnquete(enquete, cadastro) {
  const pessoas = cadastro.pessoas;
  const porTelefone = indicePorTelefone(pessoas);
  const porNomeNorm = indicePorNomeNorm(pessoas);

  const resultado = [];
  for (const nomeEnquete of nomesDaEnquete(enquete)) {
    const digitos = nomeEnquete.replace(/\D/g, '');
    let assoc;
    if (digitos) {
      // Telefone: tenta cada forma normalizada; une as pessoas encontradas.
      const encontradas = new Map();
      for (const f of formasTelefone(digitos)) {
        for (const p of porTelefone.get(f) || []) encontradas.set(p.id, p);
      }
      const ps = [...encontradas.values()];
      if (ps.length === 1) assoc = associado(ps[0], 'telefone');
      else if (ps.length > 1) assoc = pendente(ps, cadastro.porNome, normalizar(nomeEnquete));
    }
    if (!assoc) {
      const chave = normalizar(nomeEnquete);
      const iguais = porNomeNorm.get(chave) || [];
      if (iguais.length === 1) assoc = associado(iguais[0], 'nome');
      else if (iguais.length > 1) assoc = pendente(iguais, cadastro.porNome, chave);
      else assoc = pendente([], cadastro.porNome, chave);
    }
    resultado.push({ nomeEnquete, ...assoc });
  }
  return resultado;
}

function insumoDir(root, mes) {
  const [ano, mm] = mes.split('-');
  return resolve(root, `escalas/${ano}/${mm}/insumos`);
}

function arquivoDir(root, mes) {
  const [ano, mm] = mes.split('-');
  return resolve(root, `escalas/${ano}/${mm}/arquivo`);
}

function relativo(root, caminho) {
  return caminho.slice(root.length + 1).replace(/\\/g, '/');
}

/**
 * Grava a importação: Enquete, Indisponibilidade_Vinculada e snapshot. Decisões
 * do usuário por nome (sem telefone) com texto nos Caracteres_de_Nome geram
 * apelidos novos (gravados em pessoas.json fora desta função, pela rota).
 *
 * @param {string} mes
 * @param {object} enquete
 * @param {object} decisoes - { [nomeEnquete]: pessoaId|null }
 * @param {{ root?: string, hoje?: string, cadastro?: object }} [opts]
 * @returns {{ relatorio, arquivos, apelidosNovos, vinculada }}
 */
export function gravarImportacao(mes, enquete, decisoes = {}, { root = ROOT, hoje } = {}) {
  const cadastro =
    root === ROOT ? carregarPessoas() : carregarPessoas(resolve(root, 'pessoas.json'));

  const analises = analisarEnquete(enquete, cadastro);

  // Monta o Map de mapeamentos e o relatório com base nas decisões.
  const mapeamentos = new Map();
  const associados = [];
  const pendentes = [];
  const apelidosNovos = [];

  for (const a of analises) {
    let pessoaId = null;
    let por = a.por;
    if (a.estado === 'associado') {
      pessoaId = a.pessoaId;
    } else if (Object.prototype.hasOwnProperty.call(decisoes, a.nomeEnquete)) {
      const escolha = decisoes[a.nomeEnquete];
      if (escolha != null && escolha !== 'ignorar') {
        pessoaId = Number(escolha);
        por = 'usuario';
      }
    }

    if (pessoaId != null && cadastro.porId.has(pessoaId)) {
      mapeamentos.set(a.nomeEnquete, pessoaId);
      associados.push({ nomeEnquete: a.nomeEnquete, pessoaId, por });
      // Confirmação por nome (não por telefone) grava apelido se o texto é válido.
      if (por !== 'telefone') {
        const temDigitos = a.nomeEnquete.replace(/\D/g, '') !== '';
        if (!temDigitos && problemasNome(a.nomeEnquete).length === 0) {
          const pessoa = cadastro.porId.get(pessoaId);
          const apelido = normalizarNome(a.nomeEnquete);
          const jaTem =
            pessoa.nome === apelido || (pessoa.aliases || []).includes(apelido);
          if (apelido && !jaTem) {
            apelidosNovos.push({ pessoaId, apelido });
          }
        }
      }
    } else {
      pendentes.push({ nomeEnquete: a.nomeEnquete, opcoes: a.opcoes });
    }
  }

  const { datasIgnoradas } = validarEnquete(enquete, mes);

  const agora = (hoje ? new Date(`${hoje}T00:00:00Z`) : new Date())
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z');

  const vinculada = montarVinculada(enquete, cadastro, mapeamentos, {
    fonte: `escalas/${mes.split('-')[0]}/${mes.split('-')[1]}/insumos/indisponibilidade-cantores.json`,
    agora,
    mes,
  });

  // Caminhos.
  const dirInsumos = insumoDir(root, mes);
  const dirArquivo = arquivoDir(root, mes);
  mkdirSync(dirInsumos, { recursive: true });
  mkdirSync(dirArquivo, { recursive: true });

  const enquetePath = resolve(dirInsumos, 'indisponibilidade-cantores.json');
  const vinculadaPath = resolve(dirInsumos, 'indisponibilidade-cantores-vinculada.json');
  const dataSnap = (hoje || new Date().toISOString().slice(0, 10));
  const snapshotPath = resolve(dirArquivo, `indisponibilidade-cantores-${dataSnap}.json`);

  writeFileSync(enquetePath, `${JSON.stringify(enquete, null, 2)}\n`, 'utf8');
  writeFileSync(vinculadaPath, `${JSON.stringify(vinculada, null, 2)}\n`, 'utf8');
  writeFileSync(snapshotPath, `${JSON.stringify(enquete, null, 2)}\n`, 'utf8');

  const arquivos = [
    relativo(root, enquetePath),
    relativo(root, vinculadaPath),
    relativo(root, snapshotPath),
  ];

  return {
    relatorio: { associados, pendentes, ignorados: datasIgnoradas },
    arquivos,
    apelidosNovos,
    vinculada,
  };
}
