/**
 * links-whatsapp.js
 *
 * Monta a lista de envios de WhatsApp a partir de `atual.json` (escala
 * publicada) e dos Contatos_Derivados, usando os templates editáveis das
 * Mensagens_WhatsApp (scripts/lib/mensagens-whatsapp.js) no lugar do antigo
 * `MENSAGEM_TEMPLATE` fixo.
 *
 * Esta lib é a lógica pura compartilhada por:
 *  - scripts/publicacao/gerar-links-publicacao.js (gera o .md pela linha de
 *    comando);
 *  - montador/lib/whatsapp.mjs (listaDoMes → GET /api/whatsapp, sem gravar
 *    arquivo).
 *
 * Regras (RF025, RF026, RF029):
 *  - Pessoa participante de REGENTE LOUVOR, EQUIPE LOUVOR ou MENSAGEM MUSICAL:
 *    um único envio com o template `pessoa` e as funções que ela ocupa no mês.
 *  - Grupo_Escalavel escalado: um único envio, para o telefone do responsável,
 *    com `grupo.mensagem` se preenchida, senão o template `grupo` (modo
 *    `funcao`) ou `culto_inteiro` (modo `culto_inteiro`, com `{data}` dos
 *    cultos assumidos). Membros não recebem envio pelo grupo.
 *  - Contatos fixos: template `fixo`, telefone pelos Contatos_Derivados.
 *  - Convite do grupo do louvor: link direto (sem mensagem).
 *  - Departamentos, "-" e vazio nunca geram envio.
 *
 * Feature: melhoras-domingao (F. Envio) — Property 34; Requisitos 6.18, 25.2,
 * 25.3, 25.4, 25.10, 26.2, 26.7, 29.4.
 */

import { preencherMensagem } from './mensagens-whatsapp.js';

/** Campos de louvor que geram envio por pessoa/grupo. */
export const CAMPOS_LOUVOR = ['REGENTE LOUVOR', 'EQUIPE LOUVOR', 'MENSAGEM MUSICAL'];

/** Meses por extenso (índice 1..12). */
const MESES_EXTENSO = [
  '',
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/** Normaliza um nome para comparação (sem acento, maiúsculo, sem ponto). */
export function normalizeNome(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Só os dígitos de um link wa.me (ou de um telefone cru). */
export function limparTelefone(waLink) {
  const match = String(waLink || '').match(/wa\.me\/(\+?\d+)/i);
  if (match) return match[1].replace('+', '');
  return String(waLink || '').replace(/\D/g, '');
}

/** Monta o link wa.me com a mensagem já codificada. */
export function montarLink(telefone, mensagem) {
  return `https://wa.me/${telefone}?text=${encodeURIComponent(mensagem)}`;
}

/**
 * Divide o valor de uma célula em nomes de participantes, respeitando contatos
 * compostos com " E " quando existe entrada exatamente assim.
 *
 * @param {string} celula
 * @param {Map<string, object>} lookupContato - índice normalizado de contatos
 * @returns {string[]}
 */
export function parseCelulaNomes(celula, lookupContato) {
  if (!celula) return [];
  const texto = String(celula).trim();
  if (!texto || texto === '-') return [];

  const partesVirgula = texto
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const nomes = [];

  for (const parte of partesVirgula) {
    const normalizado = normalizeNome(parte);
    // Mantém nomes compostos com "E" quando existe contato exatamente assim.
    if (/\sE\s/.test(normalizado) && !lookupContato.has(normalizado)) {
      const splitE = parte
        .split(/\s+e\s+/i)
        .map((p) => p.trim())
        .filter(Boolean);
      nomes.push(...splitE);
      continue;
    }
    nomes.push(parte);
  }

  return nomes;
}

/** Extrai { ano, mes } (strings zero-padded) da primeira DATA de atual.json. */
export function extrairAnoMes(escala) {
  for (const item of Array.isArray(escala) ? escala : []) {
    const data = String(item?.DATA || '').trim();
    const match = data.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (match) return { ano: match[3], mes: match[2] };
  }
  throw new Error('Não foi possível identificar ano/mês a partir de atual.json (campo DATA).');
}

/** "08", "2026" → "agosto/2026". */
export function mesAnoExtenso(mes, ano) {
  const idx = Number(mes);
  const nome = MESES_EXTENSO[idx] || String(mes);
  return `${nome}/${ano}`;
}

/** "15/08/2026" → "15/08". */
function diaMes(data) {
  const m = String(data || '').match(/^(\d{2})\/(\d{2})/);
  return m ? `${m[1]}/${m[2]}` : String(data || '');
}

/** Índice normalizado dos contatos derivados (nome e apelidos → registro). */
export function indexarContatos(contatos) {
  const lookup = new Map();
  for (const [nomePrincipal, payload] of Object.entries(contatos || {})) {
    const telefone = limparTelefone(payload?.telefone);
    if (!telefone) continue;
    const registro = { nomeContato: nomePrincipal, telefone };
    lookup.set(normalizeNome(nomePrincipal), registro);
    for (const apelido of payload?.apelidos || []) {
      lookup.set(normalizeNome(apelido), registro);
    }
  }
  return lookup;
}

/**
 * Monta a lista de envios de WhatsApp.
 *
 * @param {object[]} escala - linhas de atual.json
 * @param {Record<string, object>} contatos - Contatos_Derivados
 * @param {object} opts
 * @param {object} opts.mensagens - Mensagens_WhatsApp (templates, fixos, grupo_louvor)
 * @param {Record<string, object>} [opts.grupos] - grupos de pessoas.json (com escalavel)
 * @param {(linha: object) => boolean} [opts.ehIsento] - true p/ pular a linha (departamental)
 * @returns {{ mesAno: string, envios: Envio[], semContato: Array, avisos: string[] }}
 *   Envio = { chave, tipo: 'pessoa'|'grupo'|'fixo'|'convite', nome, funcoes, link }
 */
export function montarListaEnvios(escala, contatos, { mensagens, grupos = {}, ehIsento } = {}) {
  const lista = Array.isArray(escala) ? escala : [];
  const avisos = [];
  const lookupContato = indexarContatos(contatos);
  const { ano, mes } = extrairAnoMes(lista);
  const mesAno = mesAnoExtenso(mes, ano);

  const templates = (mensagens && mensagens.templates) || {};

  // Grupos escaláveis: nome_exibicao normalizado → definição.
  const gruposPorNome = new Map();
  for (const def of Object.values(grupos || {})) {
    if (!def || def.escalavel !== true || !def.nome_exibicao) continue;
    gruposPorNome.set(normalizeNome(def.nome_exibicao), def);
  }

  // 1) Varre a escala coletando pessoas e grupos escalados.
  const pessoasMap = new Map(); // chave normalizada → { nomeEscala, campos:Set }
  const gruposMap = new Map(); // chave normalizada → { def, campos:Set, datas:Set }

  for (const linha of lista) {
    if (typeof ehIsento === 'function' && ehIsento(linha)) continue;
    for (const campo of CAMPOS_LOUVOR) {
      const nomes = parseCelulaNomes(linha[campo], lookupContato);
      for (const nome of nomes) {
        const nomeExibicao = String(nome).trim();
        if (!nomeExibicao) continue;
        const chave = normalizeNome(nomeExibicao);

        const grupoDef = gruposPorNome.get(chave);
        if (grupoDef) {
          if (!gruposMap.has(chave)) {
            gruposMap.set(chave, { def: grupoDef, campos: new Set(), datas: new Set() });
          }
          const reg = gruposMap.get(chave);
          reg.campos.add(campo);
          reg.datas.add(diaMes(linha.DATA));
          continue;
        }

        if (!pessoasMap.has(chave)) {
          pessoasMap.set(chave, { nomeEscala: nomeExibicao, campos: new Set() });
        } else {
          pessoasMap.get(chave).campos.add(campo);
        }
        pessoasMap.get(chave).campos.add(campo);
      }
    }
  }

  // 2) Envios por pessoa (template `pessoa`), em ordem alfabética.
  const envios = [];
  const semContato = [];
  const pessoasOrdenadas = Array.from(pessoasMap.values()).sort((a, b) =>
    a.nomeEscala.localeCompare(b.nomeEscala, 'pt-BR', { sensitivity: 'base' }),
  );

  for (const pessoa of pessoasOrdenadas) {
    const campos = CAMPOS_LOUVOR.filter((c) => pessoa.campos.has(c));
    const encontrado = lookupContato.get(normalizeNome(pessoa.nomeEscala));
    if (!encontrado) {
      semContato.push({ nome: pessoa.nomeEscala, funcoes: campos });
      continue;
    }
    const texto = preencherMensagem(templates.pessoa, {
      nome: pessoa.nomeEscala,
      mesAno,
      funcoes: campos,
    });
    envios.push({
      chave: `pessoa:${pessoa.nomeEscala}`,
      tipo: 'pessoa',
      nome: pessoa.nomeEscala,
      funcoes: campos,
      link: montarLink(encontrado.telefone, texto),
    });
  }

  // 3) Envios por Grupo_Escalavel (um único por grupo, ao responsável).
  const gruposOrdenados = Array.from(gruposMap.values()).sort((a, b) =>
    (a.def.nome_exibicao || '').localeCompare(b.def.nome_exibicao || '', 'pt-BR', {
      sensitivity: 'base',
    }),
  );

  for (const { def, campos, datas } of gruposOrdenados) {
    const nomeGrupo = def.nome_exibicao;
    const encontrado = lookupContato.get(normalizeNome(nomeGrupo));
    const camposLista = CAMPOS_LOUVOR.filter((c) => campos.has(c));
    const datasLista = Array.from(datas).sort();

    if (!encontrado) {
      semContato.push({ nome: nomeGrupo, funcoes: camposLista });
      continue;
    }

    // Nome do responsável (Contatos_Derivados guardam o nome do grupo como
    // chave; o template usa o nome do responsável). Resolvido pelo chamador via
    // def.nome_responsavel quando disponível; senão, usa o nome do grupo.
    const nomeResponsavel = def.nome_responsavel || nomeGrupo;

    let texto;
    if (typeof def.mensagem === 'string' && def.mensagem.trim() !== '') {
      texto = preencherMensagem(def.mensagem, {
        nome: nomeResponsavel,
        mesAno,
        funcoes: camposLista,
        datas: datasLista,
        grupo: nomeGrupo,
      });
    } else {
      const template = def.modo === 'culto_inteiro' ? templates.culto_inteiro : templates.grupo;
      texto = preencherMensagem(template, {
        nome: nomeResponsavel,
        mesAno,
        funcoes: camposLista,
        datas: datasLista,
        grupo: nomeGrupo,
      });
    }

    envios.push({
      chave: `grupo:${nomeGrupo}`,
      tipo: 'grupo',
      nome: nomeGrupo,
      funcoes: camposLista,
      link: montarLink(encontrado.telefone, texto),
    });
  }

  // 4) Contatos fixos (template `fixo`).
  for (const fixo of (mensagens && mensagens.fixos) || []) {
    const encontrado = lookupContato.get(normalizeNome(fixo.nome));
    if (!encontrado) {
      avisos.push(`Contato fixo "${fixo.nome}" sem telefone em contatos.json.`);
      semContato.push({ nome: fixo.nome, funcoes: [], fixo: true, rotulo: fixo.rotulo });
      continue;
    }
    const texto = preencherMensagem(templates.fixo, { nome: fixo.nome, mesAno });
    envios.push({
      chave: `fixo:${fixo.nome}`,
      tipo: 'fixo',
      nome: fixo.nome,
      rotulo: fixo.rotulo || '',
      funcoes: [],
      link: montarLink(encontrado.telefone, texto),
    });
  }

  // 5) Convite do grupo do louvor (link direto, sem mensagem).
  const grupoLouvor = mensagens && mensagens.grupo_louvor;
  if (grupoLouvor) {
    envios.push({
      chave: 'convite:grupo-louvor',
      tipo: 'convite',
      nome: 'Grupo do louvor',
      funcoes: [],
      link: grupoLouvor,
    });
  }

  return { mesAno, envios, semContato, avisos };
}
