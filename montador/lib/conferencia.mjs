// Conferência da escala online (Task 30) — Conferencia_de_Links.
//
// Antes do fechamento, o editor confere, com o MESMO código do viewer, que
// cada nome publicado em atual.json abre o WhatsApp da pessoa certa. Usa
// `buscarContato` de src/utils/contact.js (o que o viewer usa para linkar) e a
// divisão por vírgula de `formatarLista` (src/utils/formatter.js), além de
// `normalizarNome` de src/utils/name.js.
//
// Campos exibidos pelo viewer:
//  - CAMPOS_LISTA (EQUIPE LOUVOR, MENSAGEM MUSICAL): viewer usa formatarLista,
//    então o valor é dividido por vírgula e cada nome é linkado;
//  - CAMPOS_NOME (REGENTE LOUVOR, AUDIOVISUAL, SUPORTE, ANCIÃO, PREGADOR):
//    viewer usa formatarNome, então o valor inteiro é um único nome (vírgula
//    nestes campos quebra o link, logo é erro).
//
// Regras (Requisito 22):
//  - louvor (REGENTE LOUVOR, EQUIPE LOUVOR, MENSAGEM MUSICAL): sem link, ou link
//    de telefone diferente do da pessoa/responsável do grupo escalado → erro
//    (22.3);
//  - qualquer campo exibido (inclusive AUDIOVISUAL, SUPORTE, ANCIÃO, PREGADOR):
//    nome que resolve para telefone de pessoa diferente da designada → erro
//    (22.4);
//  - nome que casa (após normalização) com mais de uma entrada → erro (22.5);
//  - vírgula em campo de formatarNome → erro (22.6);
//  - caractere fora dos Caracteres_de_Nome no nome publicado, ou "<"/">" em
//    OBS, ANCIÃO ou PREGADOR → erro (22.7);
//  - lista cada erro com culto (data), campo, nome e o número que o link abre
//    (22.8).
//
// A função só depende dos arquivos (linhas de atual.json e contatos.json) e do
// Cadastro (base), então a mesma chamada serve ao fechamento, ao ajuste e à
// verificação dos arquivos remotos.
//
// Feature: melhoras-domingao (F. Envio) — Task 30; Property 30;
// Requisitos 22.1-22.8, 29.6.

import { buscarContato } from '../../src/utils/contact.js';
import { normalizarNome } from '../../src/utils/name.js';
import { problemasNome, problemasTextoLivre } from '../../scripts/lib/texto-publico.js';

/** Campos que o viewer renderiza com formatarLista (divide por vírgula). */
export const CAMPOS_LISTA = ['EQUIPE LOUVOR', 'MENSAGEM MUSICAL'];

/** Campos que o viewer renderiza com formatarNome (nome único). */
export const CAMPOS_NOME = ['REGENTE LOUVOR', 'AUDIOVISUAL', 'SUPORTE', 'ANCIÃO', 'PREGADOR'];

/** Campos de louvor: exigem link e número certo. */
const CAMPOS_LOUVOR = new Set(['REGENTE LOUVOR', 'EQUIPE LOUVOR', 'MENSAGEM MUSICAL']);

/** Dígitos de um telefone/URL (ou '' quando ausente). */
function digitos(telefone) {
  return String(telefone == null ? '' : telefone).replace(/\D/g, '');
}

/**
 * Nomes de um campo como o viewer os vê:
 *  - CAMPOS_LISTA: valor dividido por vírgula, cada parte trim;
 *  - CAMPOS_NOME: o valor inteiro como um único nome.
 * Ignora '' e '-'.
 *
 * @param {string} campo
 * @param {string} valor
 * @returns {string[]}
 */
export function nomesComoOViewer(campo, valor) {
  const txt = String(valor == null ? '' : valor).trim();
  if (txt === '' || txt === '-') return [];
  if (CAMPOS_LISTA.includes(campo)) {
    return txt
      .split(',')
      .map((n) => n.trim())
      .filter((n) => n !== '' && n !== '-');
  }
  return [txt];
}

/**
 * Chaves de contatos cujo nome ou apelido, após normalizarNome, casa com o
 * nome dado (a mesma normalização que buscarContato usa).
 *
 * @param {Record<string, { telefone: string, apelidos?: string[] }>} contatos
 * @param {string} nome
 * @returns {string[]} chaves que casam
 */
export function entradasQueCasam(contatos, nome) {
  const alvo = normalizarNome(nome);
  const chaves = [];
  for (const chave of Object.keys(contatos || {})) {
    if (normalizarNome(chave) === alvo) {
      chaves.push(chave);
      continue;
    }
    const apelidos = (contatos[chave] && contatos[chave].apelidos) || [];
    if (apelidos.some((ap) => normalizarNome(ap) === alvo)) chaves.push(chave);
  }
  return chaves;
}

/**
 * Índices do cadastro a partir de `base`:
 *  - pessoaPorNome: nome publicado exato (pessoa.nome) → pessoa;
 *  - pessoaPorNomeNorm: nome normalizado → pessoa (ANCIÃO/PREGADOR);
 *  - grupoPorNome: nome_exibicao → grupo;
 *  - porId: id → pessoa.
 */
function indicesDoCadastro(base) {
  const pessoaPorNome = new Map();
  const pessoaPorNomeNorm = new Map();
  // Apelido normalizado → pessoa, só quando o apelido é de uma pessoa só (o
  // viewer também linka por apelido: buscarContato).
  const pessoaPorApelidoNorm = new Map();
  const apelidoRepetido = new Set();
  for (const p of (base.cadastro && base.cadastro.pessoas) || []) {
    pessoaPorNome.set(String(p.nome || '').trim(), p);
    pessoaPorNomeNorm.set(normalizarNome(String(p.nome || '')), p);
    for (const ap of p.aliases || []) {
      const k = normalizarNome(String(ap || ''));
      if (!k) continue;
      if (pessoaPorApelidoNorm.has(k) && pessoaPorApelidoNorm.get(k).id !== p.id) apelidoRepetido.add(k);
      else pessoaPorApelidoNorm.set(k, p);
    }
  }
  for (const k of apelidoRepetido) pessoaPorApelidoNorm.delete(k);
  const grupoPorNome = new Map();
  const grupos = base.grupos instanceof Map ? base.grupos : new Map();
  for (const g of grupos.values()) {
    if (g && g.nome_exibicao) grupoPorNome.set(String(g.nome_exibicao).trim(), g);
  }
  const porId = (base.cadastro && base.cadastro.porId) || new Map();
  return { pessoaPorNome, pessoaPorNomeNorm, pessoaPorApelidoNorm, grupoPorNome, porId };
}

/**
 * Quem o campo designa (pelo nome publicado) e qual telefone é o esperado:
 *  - louvor → pessoa de pessoa.nome igual, ou responsável do grupo de
 *    nome_exibicao igual. Inexistente → { foraDoCadastro: true } (erro);
 *  - AUDIOVISUAL/SUPORTE → pessoa do cadastro de mesmo nome (exato), ou
 *    { semLink: true } (texto fora do cadastro não deve ter link);
 *  - ANCIÃO/PREGADOR → pessoa do cadastro de mesmo nome normalizado, ou
 *    { livre: true } (texto livre: só ambiguidade e caracteres são conferidos).
 *
 * Telefones são comparados por dígitos.
 *
 * @returns {{ telefone?: string, semLink?: boolean, livre?: boolean, foraDoCadastro?: boolean }}
 */
function designado(indices, campo, nome) {
  const { pessoaPorNome, pessoaPorNomeNorm, pessoaPorApelidoNorm, grupoPorNome, porId } = indices;
  // Escala externa (sonoplastia, ancião, pregador) chega como foi escrita na
  // escala do outro departamento, muitas vezes pelo apelido (ex.: "JÚNIOR
  // OLIVEIRA" = ENOQUE JR.). Nome exato primeiro; depois apelido único.
  const externo = (texto) =>
    pessoaPorNomeNorm.get(normalizarNome(texto)) ||
    (pessoaPorApelidoNorm && pessoaPorApelidoNorm.get(normalizarNome(texto))) ||
    null;

  if (CAMPOS_LOUVOR.has(campo)) {
    const pessoa = pessoaPorNome.get(nome.trim());
    if (pessoa) return { telefone: digitos(pessoa.telefone) };
    const grupo = grupoPorNome.get(nome.trim());
    if (grupo) {
      const responsavel = porId.get(grupo.responsavel_id) || null;
      return { telefone: responsavel ? digitos(responsavel.telefone) : '' };
    }
    return { foraDoCadastro: true };
  }

  if (campo === 'AUDIOVISUAL' || campo === 'SUPORTE') {
    // "Mesmo nome" é comparado com a normalização do viewer (buscarContato
    // também é insensível a acento/caixa), senão "JÚNIOR FERREIRA" não casaria
    // com a pessoa "JUNIOR FERREIRA" e geraria falso positivo.
    const pessoa = externo(nome);
    if (pessoa) return { telefone: digitos(pessoa.telefone) };
    return { semLink: true };
  }

  // ANCIÃO / PREGADOR.
  const pessoa = externo(nome);
  if (pessoa) return { telefone: digitos(pessoa.telefone) };
  return { livre: true };
}

/** Um campo é de louvor? */
function ehLouvor(campo) {
  return CAMPOS_LOUVOR.has(campo);
}

/** O campo designa um nome que deve existir no cadastro (para conferir caracteres)? */
function ehNomeDeCadastro(campo, esperado) {
  if (ehLouvor(campo)) return true;
  if (campo === 'AUDIOVISUAL' || campo === 'SUPORTE') return !esperado.semLink;
  // ANCIÃO/PREGADOR: só confere caracteres quando há pessoa de mesmo nome.
  return !esperado.livre;
}

/** Monta um ItemValidacao de erro da conferência. */
function erro(chave, linha, campo, nome, numero) {
  const data = linha.DATA || '';
  const partes = {
    virgula: `${data}: ${campo} "${nome}" contém vírgula — o link do viewer quebra.`,
    ambiguo: `${data}: ${campo} "${nome}" é ambíguo no contatos.json (casa com mais de uma entrada).`,
    sem_link: `${data}: ${campo} "${nome}" não tem link no contatos.json.`,
    link_errado: `${data}: ${campo} "${nome}" abre o número ${numero || '—'}, diferente do esperado.`,
    link_de_outra_pessoa: `${data}: ${campo} "${nome}" abre o número ${numero || '—'} de outra pessoa.`,
    caracteres: `${data}: ${campo} "${nome}" tem caractere não permitido para publicação.`,
    marcacao: `${data}: ${campo} "${nome}" contém "<" ou ">".`,
  };
  return {
    id: `conferencia|${chave}|${data}|${campo}|${nome}`,
    chave: `conferencia_${chave}`,
    refs: [],
    nivel: 'bloqueio',
    data,
    slot: campo,
    nome,
    numero: numero || null,
    texto: partes[chave] || `${data}: ${campo} "${nome}" — ${chave}.`,
  };
}

/**
 * Confere os links de cada nome publicado contra o contatos.json e o cadastro.
 *
 * @param {object[]} linhas - LinhaAtual[] (saída de gerarLinhasAtual)
 * @param {Record<string, { telefone: string, apelidos?: string[] }>} contatos
 * @param {object} base - contexto (cadastro, grupos)
 * @returns {{ erros: object[], tabela: Array<{ data: string, campo: string, nome: string, numero: string|null }> }}
 */
export function conferirLinks(linhas, contatos, base) {
  const indices = indicesDoCadastro(base);
  const erros = [];
  const tabela = [];
  const listas = Array.isArray(linhas) ? linhas : [];

  for (const linha of listas) {
    for (const campo of [...CAMPOS_LISTA, ...CAMPOS_NOME]) {
      const valor = linha[campo] || '';

      // Vírgula em campo de formatarNome quebra o link (22.6).
      if (CAMPOS_NOME.includes(campo) && String(valor).includes(',')) {
        erros.push(erro('virgula', linha, campo, String(valor).trim(), null));
        continue;
      }

      for (const nome of nomesComoOViewer(campo, valor)) {
        const casam = entradasQueCasam(contatos, nome);
        if (casam.length > 1) erros.push(erro('ambiguo', linha, campo, nome, null));

        // O número que o viewer abre (buscarContato: nome ou apelido).
        const contato = buscarContato(contatos, nome);
        const numero = digitos(contato && contato.telefone);
        const esperado = designado(indices, campo, nome);

        if (ehLouvor(campo)) {
          tabela.push({ data: linha.DATA || '', campo, nome, numero: numero || null });
          if (!numero) {
            erros.push(erro('sem_link', linha, campo, nome, null));
          } else if (esperado.foraDoCadastro || numero !== esperado.telefone) {
            erros.push(erro('link_errado', linha, campo, nome, numero));
          }
        } else if (
          numero &&
          (esperado.semLink || (esperado.telefone && numero !== esperado.telefone))
        ) {
          erros.push(erro('link_de_outra_pessoa', linha, campo, nome, numero));
        }

        if (ehNomeDeCadastro(campo, esperado) && problemasNome(nome).length) {
          erros.push(erro('caracteres', linha, campo, nome, null));
        }
      }
    }

    // "<"/">" em OBS, ANCIÃO e PREGADOR (22.7).
    for (const campo of ['OBS', 'ANCIÃO', 'PREGADOR']) {
      const texto = linha[campo] || '';
      if (problemasTextoLivre(texto).length) {
        erros.push(erro('marcacao', linha, campo, String(texto), null));
      }
    }
  }

  return { erros, tabela };
}
