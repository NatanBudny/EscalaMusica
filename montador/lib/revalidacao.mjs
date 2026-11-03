// Revalidação completa antes do envio (Task 29).
//
// Nada chega ao site com erro, e cada aviso precisa de ciência. Junta num só
// relatório:
//  - validarEscala: inativo, afastado, habilitação, dias permitidos,
//    indisponibilidade, conflitos no culto, consecutivos, MM por mês, equipe
//    incompleta e regente vazio, com o Nível de parametros.json (RF021.1);
//  - travaTelefone: cada participante do louvor precisa de telefone no
//    cadastro; para um Grupo_Escalavel, o responsável é quem precisa de
//    telefone. Só Departamento é isento, e cada nome de um campo com vírgula é
//    avaliado separadamente (RF021.3, RF006.16);
//  - verificarObs: a OBS de cada culto não pode ter termo proibido nem "<"/">"
//    (problemasObs de scripts/lib/texto-publico.js) (RF021.4);
//  - validarCatalogo: integridade do Catálogo_de_Regras (RF021.4);
//  - um aviso por votante da Enquete ainda pendente de associação (RF021.5).
//
// A conferência de links (Task 30, montador/lib/conferencia.mjs) entra em
// revalidarParaEnvio: conferirLinks(linhasAtual, derivarContatos(...), base)
// adiciona seus erros ao relatório e devolve a tabela em `conferencia`.
//
// Feature: melhoras-domingao (F. Envio) — Tasks 29 e 30; Properties 28 e 30;
// Requisitos 6.16, 21.1-21.5, 22.1-22.8, 29.6.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { validarEscala, ROOT } from './regras.mjs';
import { nomesParticipantes } from './contexto.mjs';
import { gerarLinhasAtual } from './publicar.mjs';
import { validarCatalogo as validarCatalogoRaiz } from '../../scripts/lib/validar-catalogo.js';
import { problemasObs } from '../../scripts/lib/texto-publico.js';
import { derivarContatos } from '../../scripts/lib/contatos.js';
import { analisarEnquete } from './indisponibilidade.mjs';
import { conferirLinks } from './conferencia.mjs';

/** Campos de louvor publicados cujos nomes exigem telefone no cadastro. */
const CAMPOS_LOUVOR = ['REGENTE LOUVOR', 'EQUIPE LOUVOR', 'MENSAGEM MUSICAL'];

/** Dígitos de um telefone (ou '' quando ausente). */
function digitos(telefone) {
  return String(telefone == null ? '' : telefone).replace(/\D/g, '');
}

/**
 * Índices do cadastro para resolver o nome publicado de um participante:
 * - pessoas por nome exato (como é publicado, `pessoa.nome`);
 * - grupos escaláveis por `nome_exibicao`.
 *
 * @param {object} base - contexto de carregarContexto
 */
function indicesDoCadastro(base) {
  const pessoaPorNome = new Map();
  for (const p of (base.cadastro && base.cadastro.pessoas) || []) {
    pessoaPorNome.set(String(p.nome || '').trim(), p);
  }
  const grupoPorNome = new Map();
  const grupos = base.grupos instanceof Map ? base.grupos : new Map();
  for (const g of grupos.values()) {
    if (g && g.nome_exibicao) grupoPorNome.set(String(g.nome_exibicao).trim(), g);
  }
  return { pessoaPorNome, grupoPorNome, porId: (base.cadastro && base.cadastro.porId) || new Map() };
}

/**
 * Trava de telefone: cada participante do louvor precisa de telefone no
 * cadastro. Para um Grupo_Escalavel, o responsável é quem precisa ter telefone.
 * Só Departamento é isento. Cada nome de um campo com vírgula é avaliado
 * separadamente (nomesParticipantes já divide e ignora '', '-' e Departamento).
 *
 * @param {object[]} linhasAtual - saída de gerarLinhasAtual
 * @param {object} base - contexto (cadastro, grupos)
 * @returns {object[]} ItemValidacao[] (nivel 'bloqueio')
 */
export function travaTelefone(linhasAtual, base) {
  const { pessoaPorNome, grupoPorNome } = indicesDoCadastro(base);
  const erros = [];

  for (const linha of Array.isArray(linhasAtual) ? linhasAtual : []) {
    const data = linha.DATA;
    for (const campo of CAMPOS_LOUVOR) {
      for (const nome of nomesParticipantes(linha[campo])) {
        const grupo = grupoPorNome.get(nome);
        if (grupo) {
          const porId = (base.cadastro && base.cadastro.porId) || new Map();
          const responsavel = porId.get(grupo.responsavel_id) || null;
          const tel = responsavel ? digitos(responsavel.telefone) : '';
          if (!tel) {
            erros.push({
              id: `sem_telefone|${data}|${campo}|${nome}`,
              chave: 'sem_telefone',
              refs: [],
              nivel: 'bloqueio',
              data,
              slot: campo,
              pessoaId: grupo.responsavel_id || null,
              texto: `${data}: ${nome} (${campo}) — responsável do grupo sem telefone no cadastro.`,
            });
          }
          continue;
        }

        const pessoa = pessoaPorNome.get(nome);
        if (!pessoa) {
          // Nome que não é pessoa nem grupo: tratado como "fora do cadastro"
          // por validarEscala; aqui não gera trava de telefone.
          continue;
        }
        if (!digitos(pessoa.telefone)) {
          erros.push({
            id: `sem_telefone|${data}|${campo}|${nome}`,
            chave: 'sem_telefone',
            refs: [],
            nivel: 'bloqueio',
            data,
            slot: campo,
            pessoaId: pessoa.id,
            texto: `${data}: ${nome} (${campo}) — sem telefone no cadastro.`,
          });
        }
      }
    }
  }

  return erros;
}

/**
 * Verifica a OBS pública de cada culto (termo proibido, "<" e ">").
 *
 * @param {object[]} linhasAtual - saída de gerarLinhasAtual
 * @returns {object[]} ItemValidacao[] (nivel 'bloqueio')
 */
export function verificarObs(linhasAtual) {
  const erros = [];
  for (const linha of Array.isArray(linhasAtual) ? linhasAtual : []) {
    const texto = linha.OBS || '';
    for (const problema of problemasObs(texto)) {
      erros.push({
        id: `obs|${linha.DATA}|${problema}`,
        chave: 'obs',
        refs: [],
        nivel: 'bloqueio',
        data: linha.DATA,
        slot: 'OBS',
        pessoaId: null,
        texto: `${linha.DATA}: observação pública — ${problema}`,
      });
    }
  }
  return erros;
}

/** Lê a Enquete bruta do mês (ou null). */
function lerEnquete(mesAlvo, root) {
  if (!mesAlvo) return null;
  const [ano, mes] = String(mesAlvo).split('-');
  const caminho = resolve(root, `escalas/${ano}/${mes}/insumos/indisponibilidade-cantores.json`);
  if (!existsSync(caminho)) return null;
  try {
    return JSON.parse(readFileSync(caminho, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Avisos por votante da Enquete ainda pendente de associação.
 *
 * @param {object} base - contexto (mesAlvo, cadastro)
 * @param {{ root?: string }} [opts]
 * @returns {object[]} ItemValidacao[] (nivel 'aviso')
 */
export function avisosVotantesPendentes(base, { root = ROOT } = {}) {
  const enquete = lerEnquete(base.mesAlvo, root);
  if (!enquete) return [];
  const associacoes = analisarEnquete(enquete, base.cadastro);
  const avisos = [];
  for (const a of associacoes) {
    if (a.estado === 'pendente') {
      avisos.push({
        id: `votante_pendente|${a.nomeEnquete}`,
        chave: 'votante_pendente',
        refs: [],
        nivel: 'aviso',
        data: null,
        slot: null,
        pessoaId: null,
        texto: `Votante da enquete pendente de associação: ${a.nomeEnquete}.`,
      });
    }
  }
  return avisos;
}

/**
 * Converte os erros/avisos de validarCatalogo em ItemValidacao[].
 *
 * @param {{ root?: string }} [opts]
 * @returns {{ erros: object[], avisos: object[] }}
 */
export function revalidarCatalogo({ root = ROOT } = {}) {
  const { erros, avisos } = validarCatalogoRaiz(root);
  const comId = (lista, nivel) =>
    lista.map((texto, i) => ({
      id: `catalogo|${nivel}|${i}|${texto}`,
      chave: 'catalogo',
      refs: [],
      nivel,
      data: null,
      slot: null,
      pessoaId: null,
      texto: `Catálogo de regras: ${texto}`,
    }));
  return {
    erros: comId(erros, 'bloqueio'),
    avisos: comId(avisos, 'aviso'),
  };
}

/**
 * Revalidação completa antes do envio.
 *
 * @param {object} base - contexto de carregarContexto
 * @param {object[]} cultos - CultoMontagem (atribuições por ID / 'grupo:<chave>')
 * @param {{ root?: string }} [opts]
 * @returns {{ erros, avisos, linhasAtual, contatos, conferencia: { erros, tabela } }}
 */
export function revalidarParaEnvio(base, cultos, { root = ROOT } = {}) {
  const linhasAtual = gerarLinhasAtual(base, Array.isArray(cultos) ? cultos : []);
  const contatos = derivarContatos(
    (base.cadastro && base.cadastro.pessoas) || [],
    gruposBrutosDoBase(base),
  );

  const validacaoEscala = validarEscala(base, cultos);
  const catalogo = revalidarCatalogo({ root });
  // Conferência da escala online: confere, com o código do viewer, que cada
  // nome publicado em linhasAtual abre o WhatsApp da pessoa certa (Task 30,
  // Requisito 22). Usa o mesmo contatos.json que será publicado.
  const conferencia = conferirLinks(linhasAtual, contatos, base);

  const erros = [
    ...validacaoEscala.erros,
    ...travaTelefone(linhasAtual, base),
    ...verificarObs(linhasAtual),
    ...catalogo.erros,
    ...conferencia.erros,
  ];
  const avisos = [
    ...validacaoEscala.avisos,
    ...catalogo.avisos,
    ...avisosVotantesPendentes(base, { root }),
  ];

  return { erros, avisos, linhasAtual, contatos, conferencia };
}

/**
 * derivarContatos espera o objeto `grupos` do pessoas.json (com `escalavel`),
 * mas base.grupos é o Map de gruposEscalaveis. Reconstrói o objeto a partir do
 * Map, garantindo `escalavel: true` e o telefone pelo responsável.
 */
function gruposBrutosDoBase(base) {
  const grupos = {};
  const mapa = base.grupos instanceof Map ? base.grupos : new Map();
  for (const [chave, g] of mapa) {
    grupos[chave] = {
      escalavel: true,
      nome_exibicao: g.nome_exibicao,
      responsavel_id: g.responsavel_id,
      membros_ids: g.membros_ids,
      modo: g.modo,
      funcoes: g.funcoes,
      mensagem: g.mensagem,
    };
  }
  return grupos;
}
