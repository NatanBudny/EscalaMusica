// Publicador do montador: gera o atual.json (schema EXATO do visualizador),
// lê o atual.json de volta para CultoMontagem (ida e volta) e faz backup do
// anterior em old/AAAA/MMAAAA.json.
//
// NÃO fala com o git: apenas grava os arquivos e devolve a lista de caminhos
// tocados. Quem comita (commit seletivo) e envia é a rota do servidor, via
// montador/lib/git.mjs.
//
// Reaproveita a convenção de schema de scripts/publicacao/publicar-escala-mensal.js.
//
// Feature: melhoras-domingao (E. Montagem) — Tasks 22, 24, 27.

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, toBrDate } from './regras.mjs';
import { tipoDoCulto, tipoDaLinhaAtual, slotsDoCulto, departamentoDoCulto } from './contexto.mjs';
import { normalizarNome } from '../../src/utils/name.js';

export const CAMPOS_ATUAL = [
  'DATA',
  'DIA SEMANA',
  'ACOMP',
  'REGENTE LOUVOR',
  'EQUIPE LOUVOR',
  'MENSAGEM MUSICAL',
  'LOUVORES ES',
  'LOUVORES CULTO',
  'TEMA CULTO',
  'AUDIOVISUAL',
  'ANCIÃO',
  'PREGADOR',
  'SUPORTE',
  'OBS',
];

const DIA_ACENTUADO = {
  'quarta-feira': 'quarta-feira',
  sabado: 'sábado',
  domingo: 'domingo',
};

/** Slots de mensagem musical por modelo. */
const SLOTS_MM = ['mm_es', 'mm_culto', 'mm_domingo'];

function converterDataBR(dataBR) {
  const partes = String(dataBR || '').trim().split('/');
  if (partes.length !== 3) return null;
  const [dia, mes, ano] = partes;
  return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
}

/** Nome de uma pessoa por ID (ou '' quando ausente). */
function nomeDePessoa(id, base) {
  if (id == null) return '';
  const p = base.cadastro && base.cadastro.porId.get(id);
  return p ? p.nome : '';
}

/** nome_exibicao de um grupo por chave (ou '' quando ausente). */
function nomeDeGrupo(chave, base) {
  const g = base.grupos && base.grupos.get(chave);
  return g ? g.nome_exibicao : '';
}

/** Nome publicado de um ocupante (id de pessoa, 'grupo:<chave>' ou texto). */
function nomePublicado(ocupante, base) {
  if (ocupante == null || ocupante === '') return '';
  if (typeof ocupante === 'number') return nomeDePessoa(ocupante, base);
  if (typeof ocupante === 'string') {
    if (ocupante.startsWith('grupo:')) return nomeDeGrupo(ocupante.slice('grupo:'.length), base);
    return ocupante; // texto livre / nome já resolvido
  }
  if (ocupante && ocupante.foraDoCadastro) return ocupante.foraDoCadastro;
  return String(ocupante);
}

/** Junta nomes de MM na ordem mm_es, mm_culto, mm_domingo; só os preenchidos. */
function mmParaCampo(culto, base) {
  const mm = culto.mm || {};
  const nomes = [];
  for (const slot of SLOTS_MM) {
    const v = Array.isArray(mm) ? undefined : mm[slot];
    if (v == null || v === '') continue;
    const nome = nomePublicado(v, base);
    if (nome) nomes.push(nome);
  }
  // Suporte a mm como array (compatibilidade): mantém a ordem dada.
  if (Array.isArray(mm)) {
    for (const v of mm) {
      const nome = nomePublicado(v, base);
      if (nome) nomes.push(nome);
    }
  }
  return nomes.join(', ');
}

/**
 * Converte um CultoMontagem (ocupantes por ID/'grupo:<chave>') numa linha de
 * atual.json. Usa `tipoDoCulto`: quarta/sem_louvor → "-"; departamental → nome
 * do departamento; louvor → nomes por ID e nome_exibicao de grupo; assumidoPor
 * publica o grupo nos três campos de louvor. Campos que o editor não edita são
 * preservados da linha anterior de atual.json quando a data já existe (passada
 * em `anterior`).
 *
 * @param {object} culto - CultoMontagem
 * @param {object} base - { cadastro, grupos }
 * @param {object} [anterior] - linha de atual.json da mesma data (para preservar campos)
 */
export function cultoParaAtual(culto, base = {}, anterior = null) {
  const dia = culto.dia_semana;
  const tipo = culto.tipo || tipoDoCulto(culto);
  let regente = '';
  let equipe = '';
  let mm = '';

  if (culto.assumidoPor) {
    const nome = nomePublicado(culto.assumidoPor, base);
    regente = nome;
    equipe = nome;
    mm = nome;
  } else if (tipo === 'quarta' || tipo === 'sem_louvor') {
    regente = '-';
    equipe = '-';
    mm = '-';
  } else if (tipo === 'departamental') {
    const dep = (culto.departamento || departamentoDoCulto(culto) || culto.pregador || '').toUpperCase().trim();
    regente = dep;
    equipe = dep;
    mm = dep;
  } else {
    regente = nomePublicado(culto.regente, base);
    equipe = (culto.equipe || [])
      .map((e) => nomePublicado(e, base))
      .filter(Boolean)
      .join(', ');
    mm = mmParaCampo(culto, base);
  }

  const prev = anterior || {};
  const acomp = culto.acomp || prev.ACOMP || (dia === 'sabado' ? 'BANDA' : 'PB');
  const audiovisual =
    culto.audiovisual != null && culto.audiovisual !== ''
      ? culto.audiovisual
      : prev.AUDIOVISUAL || '';
  // SUPORTE: usa o valor do culto quando definido; senão preserva o da linha
  // anterior. Só cai para "-" quando não há valor algum (nem no culto nem antes).
  let suporte;
  if (culto.suporte != null) suporte = culto.suporte;
  else if (prev.SUPORTE != null) suporte = prev.SUPORTE;
  else suporte = '-';

  return {
    DATA: toBrDate(culto.data),
    'DIA SEMANA': DIA_ACENTUADO[dia] || dia,
    ACOMP: acomp,
    'REGENTE LOUVOR': regente,
    'EQUIPE LOUVOR': equipe,
    'MENSAGEM MUSICAL': mm,
    'LOUVORES ES': culto.louvoresEs != null ? culto.louvoresEs : prev['LOUVORES ES'] || '',
    'LOUVORES CULTO': culto.louvoresCulto != null ? culto.louvoresCulto : prev['LOUVORES CULTO'] || '',
    'TEMA CULTO': culto.temaCulto != null ? culto.temaCulto : prev['TEMA CULTO'] || '',
    AUDIOVISUAL: audiovisual,
    'ANCIÃO': culto.anciao != null && culto.anciao !== '' ? culto.anciao : prev['ANCIÃO'] || '',
    PREGADOR: culto.pregador != null && culto.pregador !== '' ? culto.pregador : prev.PREGADOR || '',
    SUPORTE: suporte,
    OBS: culto.obs != null ? culto.obs : prev.OBS || '',
  };
}

/** Ordena linhas de atual.json por data (ISO). */
function ordenarPorData(rows) {
  const toIso = (br) => {
    const [dd, mm, yyyy] = String(br).split('/');
    return `${yyyy}-${mm}-${dd}`;
  };
  return [...rows].sort((a, b) => toIso(a.DATA).localeCompare(toIso(b.DATA)));
}

/** Garante a ordem de chaves de CAMPOS_ATUAL. */
function ordenarChaves(r) {
  const o = {};
  for (const k of CAMPOS_ATUAL) o[k] = r[k] ?? '';
  return o;
}

/**
 * Gera as linhas de atual.json a partir dos CultoMontagem (ordenadas por data,
 * chaves de CAMPOS_ATUAL). Preserva os campos não editados pelo editor a partir
 * do atual.json atual quando a data já existe nele.
 *
 * @param {object} base - { cadastro, grupos, root? }
 * @param {object[]} cultos - CultoMontagem[]
 * @returns {object[]} LinhaAtual[]
 */
export function gerarLinhasAtual(base, cultos) {
  const root = base.root || ROOT;
  const atualPath = resolve(root, 'atual.json');
  const anterioresPorData = new Map();
  if (existsSync(atualPath)) {
    try {
      const atual = JSON.parse(readFileSync(atualPath, 'utf8'));
      if (Array.isArray(atual)) {
        for (const linha of atual) anterioresPorData.set(converterDataBR(linha.DATA), linha);
      }
    } catch {
      /* atual.json ilegível: ignora */
    }
  }

  const rows = (Array.isArray(cultos) ? cultos : []).map((c) =>
    cultoParaAtual(c, base, anterioresPorData.get(c.data) || null),
  );
  return ordenarPorData(rows).map(ordenarChaves);
}

// ---------------------------------------------------------------------------
// Leitura do atual.json de volta para CultoMontagem (ida e volta)
// ---------------------------------------------------------------------------

/** Índice normalizado nome/apelido → id de pessoa (accent-insensitive). */
function indicePessoas(base) {
  const idx = new Map();
  const pessoas = (base.cadastro && base.cadastro.pessoas) || [];
  for (const p of pessoas) {
    idx.set(normalizarNome(p.nome), p.id);
    for (const a of p.apelidos || []) idx.set(normalizarNome(a), p.id);
  }
  return idx;
}

/** Índice normalizado nome_exibicao → chave de grupo. */
function indiceGrupos(base) {
  const idx = new Map();
  for (const [chave, g] of (base.grupos || new Map()).entries()) {
    idx.set(normalizarNome(g.nome_exibicao), chave);
  }
  return idx;
}

/** Resolve um nome publicado para ocupante: id | 'grupo:<chave>' | { foraDoCadastro }. */
function resolverNome(nome, idxPessoas, idxGrupos) {
  const n = normalizarNome(nome);
  if (idxGrupos.has(n)) return `grupo:${idxGrupos.get(n)}`;
  if (idxPessoas.has(n)) return idxPessoas.get(n);
  return { foraDoCadastro: nome };
}

/** Divide um campo por vírgula, limpando '' e '-'. */
function nomesDoCampo(valor) {
  return String(valor || '')
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n && n !== '-');
}

/**
 * Lê as linhas de atual.json de volta para CultoMontagem (ocupantes por ID /
 * 'grupo:<chave>'). Preserva LOUVORES ES, TEMA CULTO e SUPORTE; MENSAGEM
 * MUSICAL do modelo sábado: 1º nome → mm_es, 2º → mm_culto; domingo: 1º →
 * mm_domingo. Quando os três campos de louvor são iguais ao nome_exibicao de um
 * grupo `culto_inteiro`, marca `assumidoPor`. Nomes além das vagas do modelo
 * vão para `culto.excedentes` (nunca descartados); nomes não resolvidos ficam
 * "fora do cadastro".
 *
 * @param {object[]} linhas - LinhaAtual[]
 * @param {object} base - { cadastro, grupos, parametros? }
 * @returns {object[]} CultoMontagem[]
 */
export function cultosDeAtual(linhas, base) {
  const idxPessoas = indicePessoas(base);
  const idxGrupos = indiceGrupos(base);
  const parametros = base.parametros;

  return (Array.isArray(linhas) ? linhas : []).map((linha) => {
    const data = converterDataBR(linha.DATA);
    const diaNorm = normalizarNome(linha['DIA SEMANA']).toLowerCase();
    const tipo = tipoDaLinhaAtual(linha);
    const modelo =
      diaNorm === 'sabado' ? 'sabado' : diaNorm === 'domingo' ? 'domingo' : 'sem_louvor';

    const culto = {
      data,
      dia_semana: linha['DIA SEMANA'],
      modelo_louvor: modelo,
      tipo: tipo === 'quarta' ? 'quarta' : tipo,
      acomp: linha.ACOMP || '',
      anciao: linha['ANCIÃO'] || '',
      pregador: linha.PREGADOR || '',
      audiovisual: linha.AUDIOVISUAL || '',
      suporte: linha.SUPORTE != null ? linha.SUPORTE : '-',
      louvoresEs: linha['LOUVORES ES'] || '',
      louvoresCulto: linha['LOUVORES CULTO'] || '',
      temaCulto: linha['TEMA CULTO'] || '',
      obs: linha.OBS || '',
      regente: null,
      equipe: [],
      mm: {},
      assumidoPor: null,
      excedentes: [],
    };

    if (tipo !== 'louvor') {
      // quarta / departamental / sem louvor: sem funções de louvor.
      culto.slots = [];
      return culto;
    }

    culto.slots = slotsDoCulto({ dia_semana: linha['DIA SEMANA'], modelo_louvor: modelo }, parametros);

    const regenteNomes = nomesDoCampo(linha['REGENTE LOUVOR']);
    const equipeNomes = nomesDoCampo(linha['EQUIPE LOUVOR']);
    const mmNomes = nomesDoCampo(linha['MENSAGEM MUSICAL']);

    // Culto assumido por grupo culto_inteiro: os três campos iguais ao mesmo
    // nome_exibicao de um grupo de modo 'culto_inteiro'.
    const unico =
      regenteNomes.length === 1 &&
      equipeNomes.length === 1 &&
      mmNomes.length === 1 &&
      normalizarNome(regenteNomes[0]) === normalizarNome(equipeNomes[0]) &&
      normalizarNome(equipeNomes[0]) === normalizarNome(mmNomes[0]);
    if (unico) {
      const oc = resolverNome(regenteNomes[0], idxPessoas, idxGrupos);
      if (typeof oc === 'string' && oc.startsWith('grupo:')) {
        const g = base.grupos.get(oc.slice('grupo:'.length));
        if (g && g.modo === 'culto_inteiro') {
          culto.assumidoPor = oc;
          return culto;
        }
      }
    }

    // Regente (uma vaga).
    if (regenteNomes.length > 0) {
      culto.regente = resolverNome(regenteNomes[0], idxPessoas, idxGrupos);
      for (let i = 1; i < regenteNomes.length; i += 1) {
        culto.excedentes.push({
          campo: 'REGENTE LOUVOR',
          nome: regenteNomes[i],
          ocupante: resolverNome(regenteNomes[i], idxPessoas, idxGrupos),
        });
      }
    }

    // Equipe (tamanho do modelo).
    const tamEquipe = (parametros && parametros.equipe && parametros.equipe.tamanho) || 5;
    equipeNomes.forEach((nome, i) => {
      const oc = resolverNome(nome, idxPessoas, idxGrupos);
      if (i < tamEquipe) culto.equipe.push(oc);
      else culto.excedentes.push({ campo: 'EQUIPE LOUVOR', nome, ocupante: oc });
    });

    // MM: slots do modelo em ordem.
    const slotsMm = culto.slots.filter((s) => s.startsWith('mm_'));
    mmNomes.forEach((nome, i) => {
      const oc = resolverNome(nome, idxPessoas, idxGrupos);
      if (i < slotsMm.length) culto.mm[slotsMm[i]] = oc;
      else culto.excedentes.push({ campo: 'MENSAGEM MUSICAL', nome, ocupante: oc });
    });

    return culto;
  });
}

function inferAnoMes(rows) {
  for (const r of rows) {
    const m = String(r.DATA || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return { mes: m[2], ano: m[3] };
  }
  return null;
}

/**
 * Faz backup do atual.json atual em old/AAAA/MMAAAA.json (quando ainda não
 * existe) e devolve o caminho relativo criado, ou null.
 *
 * @param {{ root?: string }} [opts]
 */
export function backupAtual({ root = ROOT } = {}) {
  const atualPath = resolve(root, 'atual.json');
  if (!existsSync(atualPath)) return null;
  let anterior;
  try {
    anterior = JSON.parse(readFileSync(atualPath, 'utf8'));
  } catch {
    return null;
  }
  const anoMes = inferAnoMes(anterior);
  if (!anoMes) return null;
  const backupDir = resolve(root, 'old', anoMes.ano);
  const backupPath = resolve(backupDir, `${anoMes.mes}${anoMes.ano}.json`);
  if (existsSync(backupPath)) return null;
  if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });
  copyFileSync(atualPath, backupPath);
  return `old/${anoMes.ano}/${anoMes.mes}${anoMes.ano}.json`;
}

/**
 * Publica a escala: escreve atual.json e faz backup do anterior. Retorna um
 * relatório com o que foi feito, incluindo `arquivos` (caminhos relativos ao
 * repositório tocados pela operação) para o commit seletivo da rota.
 *
 * Aceita tanto CultoMontagem (novo, com `base`) quanto o formato antigo da UI.
 *
 * @param {object[]} cultos - cultos da UI (ordenados por data)
 * @param {object} [base] - { cadastro, grupos, root? } para resolver nomes por ID
 */
export async function publicarEscala(cultos, base = {}) {
  const root = base.root || ROOT;
  const rowsOrdenadas = gerarLinhasAtual({ ...base, root }, cultos);

  const atualPath = resolve(root, 'atual.json');

  // Backup do atual.json anterior.
  const backupRel = backupAtual({ root });

  writeFileSync(atualPath, `${JSON.stringify(rowsOrdenadas, null, 2)}\n`, 'utf8');

  // Caminhos tocados pela operação (relativos ao repositório), para o commit
  // seletivo feito pela rota do servidor.
  const arquivos = ['atual.json'];
  if (backupRel) arquivos.push(backupRel);

  return {
    cultos: rowsOrdenadas.length,
    backup: backupRel,
    arquivos,
  };
}
