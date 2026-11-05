// Gestão de pessoas pela tela (CRUD) gravando em pessoas.json.
//
// Reaproveita carregarPessoas() do projeto para VALIDAR o arquivo após cada
// alteração (IDs únicos, nomes/aliases únicos, vínculos simétricos, proximo_id).
// Assim a tela nunca grava um pessoas.json inválido.
//
// Toda gravação grava também contatos.json (derivado) e devolve a lista de
// caminhos tocados — o pathspec do commit seletivo da rota.

import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { carregarPessoas } from '../../scripts/lib/cadastro.js';
import { derivarContatos } from '../../scripts/lib/contatos.js';
import { problemasNome } from '../../scripts/lib/texto-publico.js';
import normalizar from '../../scripts/lib/normalizar.js';
import {
  migracoesPendentes as calcularMigracoesPendentes,
  diferencasContatos,
  pendenciasCaracteresCadastro,
  aplicarMigracaoContatos,
  aplicarMigracaoGrupos,
  migrarRegrasPorNome,
  propostaGrupos,
} from './migracoes.mjs';
import { ROOT } from './regras.mjs';

function pessoasPath(root) {
  return resolve(root, 'pessoas.json');
}

export function lerArquivo(root = ROOT) {
  return JSON.parse(readFileSync(pessoasPath(root), 'utf8'));
}

/** Nome canônico: UPPER, sem acentos duplicados de espaço, trim. */
function normalizarNome(valor) {
  return String(valor || '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizarAlias(valor) {
  return normalizarNome(valor);
}

/** Só dígitos no telefone (ex.: 554399... ). Vazio permitido. */
function normalizarTelefone(valor) {
  return String(valor || '').replace(/\D/g, '');
}

const DIAS_VALIDOS = new Set(['domingo', 'sabado', 'quarta-feira']);

/**
 * Monta um objeto pessoa a partir dos campos vindos da tela, aplicando defaults
 * coerentes com o schema do pessoas.json.
 */
function montarPessoa(dados, idExistente) {
  const hab = dados.habilitacoes || {};
  const mm = hab.mensagem_musical || {};
  const diasPermitidos = Array.isArray(dados.dias_permitidos)
    ? dados.dias_permitidos.filter((d) => DIAS_VALIDOS.has(d))
    : null;

  let afastado = null;
  if (dados.afastado && dados.afastado.ativo) {
    afastado = {
      ativo: true,
      ate: dados.afastado.ate || null,
      motivo: dados.afastado.motivo || '',
    };
  }

  // Campos do pessoas.json que a tela não edita (ex.: incentivo) são mantidos
  // como estavam: na edição, `dados` já chega mesclado com o registro salvo.
  const preservados = {};
  for (const [chave, valor] of Object.entries(dados || {})) {
    if (!CAMPOS_GERIDOS.has(chave)) preservados[chave] = valor;
  }

  return {
    ...preservados,
    id: idExistente,
    nome: normalizarNome(dados.nome),
    aliases: Array.isArray(dados.aliases)
      ? [...new Set(dados.aliases.map(normalizarAlias).filter(Boolean))]
      : [],
    telefone: normalizarTelefone(dados.telefone),
    genero: dados.genero === 'M' ? 'M' : 'F',
    ativo: dados.ativo !== false,
    perfil_canto: dados.perfil_canto || null,
    notas: dados.notas || '',
    habilitacoes: {
      regente: hab.regente === true,
      equipe: hab.equipe === true,
      mensagem_musical: {
        es: mm.es === true,
        culto: mm.culto === true,
        domingo: mm.domingo === true,
      },
      sonoplastia: hab.sonoplastia === true,
    },
    afastado,
    vinculos: Array.isArray(dados.vinculos) ? dados.vinculos : [],
    dias_permitidos: diasPermitidos && diasPermitidos.length > 0 ? diasPermitidos : null,
    limite_mensal: normalizarLimiteMensal(dados.limite_mensal),
    // Contato pelo WhatsApp de outra pessoa (ex.: convidada sem telefone
    // próprio). Ausente = telefone próprio.
    ...(Number.isInteger(dados.contato_via_id) ? { contato_via_id: dados.contato_via_id } : {}),
  };
}

/**
 * Resolve "contato via outra pessoa": copia o telefone da pessoa vinculada.
 * Devolve os dados ajustados, ou um erro em português quando o vínculo não
 * serve (pessoa inexistente, a própria pessoa ou sem telefone).
 *
 * @param {object} arquivo - pessoas.json
 * @param {object} dados - campos da tela (podem trazer contato_via_id)
 * @param {number|null} id - pessoa editada (null = nova)
 * @returns {{ dados: object, via: object|null, erro: string|null }}
 */
function aplicarContatoVia(arquivo, dados, id) {
  const bruto = dados ? dados.contato_via_id : null;
  if (bruto == null || bruto === '') {
    const { contato_via_id: _ignorado, ...resto } = dados || {};
    return { dados: resto, via: null, erro: null };
  }
  const viaId = Number(bruto);
  const via = Number.isInteger(viaId) ? arquivo.pessoas.find((p) => p.id === viaId) : null;
  if (!via) return { dados, via: null, erro: 'A pessoa escolhida como contato não existe no cadastro.' };
  if (id != null && via.id === id) return { dados, via: null, erro: 'O contato precisa ser de outra pessoa.' };
  const tel = normalizarTelefone(via.telefone);
  if (!tel) return { dados, via: null, erro: `${via.nome} não tem telefone no cadastro para servir de contato.` };
  return { dados: { ...dados, contato_via_id: via.id, telefone: tel }, via, erro: null };
}

/**
 * Mantém o telefone de quem usa o contato de outra pessoa igual ao telefone
 * atual dessa pessoa (ex.: a mãe trocou de número). Muta o arquivo.
 */
function sincronizarContatosVia(arquivo) {
  const porId = new Map(arquivo.pessoas.map((p) => [p.id, p]));
  for (const p of arquivo.pessoas) {
    if (!Number.isInteger(p.contato_via_id)) continue;
    const via = porId.get(p.contato_via_id);
    const tel = via ? normalizarTelefone(via.telefone) : '';
    if (tel) p.telefone = tel;
  }
}

/** Campos que montarPessoa monta a partir da tela (os demais são preservados). */
const CAMPOS_GERIDOS = new Set([
  'id',
  'nome',
  'aliases',
  'telefone',
  'genero',
  'ativo',
  'perfil_canto',
  'notas',
  'habilitacoes',
  'afastado',
  'vinculos',
  'dias_permitidos',
  'limite_mensal',
  'contato_via_id',
]);

/** Máximo de escalas no mês: inteiro de 1 a 31, ou null (sem limite). */
function normalizarLimiteMensal(valor) {
  if (valor == null || valor === '') return null;
  const n = Number(valor);
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null;
}

/**
 * Grava pessoas.json E contatos.json (derivado), validando antes e fazendo
 * backup. Lança se o cadastro for inválido (nada é gravado nesse caso).
 *
 * @returns {{ arquivos: string[] }} caminhos relativos tocados
 */
export function gravarValidado(arquivo, root = ROOT) {
  sincronizarContatosVia(arquivo);

  // Recalcula proximo_id (P2): max(ids)+1.
  const maxId = Math.max(0, ...arquivo.pessoas.map((p) => p.id));
  arquivo.proximo_id = maxId + 1;
  arquivo.ultima_atualizacao = new Date().toISOString().slice(0, 10);

  const conteudo = `${JSON.stringify(arquivo, null, 2)}\n`;

  // Validação: grava em arquivo temporário e carrega para validar a estrutura.
  const tmpPath = resolve(root, '.pessoas.tmp.json');
  writeFileSync(tmpPath, conteudo, 'utf8');
  try {
    carregarPessoas(tmpPath); // lança Error se inválido
  } catch (err) {
    // Remove o tmp e propaga o erro de validação — sem tocar nos arquivos reais.
    try {
      writeFileSync(tmpPath, '', 'utf8');
    } catch {
      /* ignore */
    }
    throw new Error(`Validação falhou: ${err.message}`);
  }

  const alvoPessoas = pessoasPath(root);

  // Backup do pessoas.json atual antes de sobrescrever.
  // IMPORTANTE: NAO usar a pasta old/ — ela é reservada ao histórico de escalas.
  // Backups de pessoas vão para pasta própria (ignorada no git).
  if (existsSync(alvoPessoas)) {
    const backupDir = resolve(root, 'montador', 'backups-pessoas');
    if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    copyFileSync(alvoPessoas, resolve(backupDir, `pessoas-${stamp}.json`));
  }

  writeFileSync(alvoPessoas, conteudo, 'utf8');

  // Deriva e grava contatos.json a partir do mesmo cadastro.
  const contatos = derivarContatos(arquivo.pessoas, arquivo.grupos || {});
  const alvoContatos = resolve(root, 'contatos.json');
  writeFileSync(alvoContatos, `${JSON.stringify(contatos, null, 2)}\n`, 'utf8');

  // Limpa o tmp.
  try {
    writeFileSync(tmpPath, '', 'utf8');
  } catch {
    /* ignore */
  }

  return { arquivos: ['pessoas.json', 'contatos.json'] };
}

// ---------------------------------------------------------------------------
// Task 6: validações do cadastro (telefone, duplicidade, caracteres)
// ---------------------------------------------------------------------------

/** Formato de telefone válido: 55 + DDD (1–9 cada) + número de 8 ou 9 dígitos. */
const TELEFONE_RE = /^55[1-9]{2}\d{8,9}$/;

/**
 * Valida o texto do telefone. Devolve { ok, digitos }.
 * Aceita vazio (sem telefone) ou um número no formato esperado.
 *
 * @param {string} texto
 * @returns {{ ok: boolean, digitos: string }}
 */
export function validarTelefone(texto) {
  const dig = normalizarTelefone(texto);
  if (dig === '') return { ok: true, digitos: '' };
  return { ok: TELEFONE_RE.test(dig), digitos: dig };
}

/** Todos os nomes/apelidos de uma pessoa (não normalizados). */
function nomesDePessoa(p) {
  return [p.nome, ...(p.aliases || [])];
}

/** nome_exibicao de cada grupo escalável. */
function nomesExibicaoDeGrupos(grupos) {
  const nomes = [];
  for (const def of Object.values(grupos || {})) {
    if (def && def.escalavel === true && def.nome_exibicao) nomes.push(def.nome_exibicao);
  }
  return nomes;
}

/**
 * Verifica uma pessoa (nova ou editada) contra o cadastro atual, devolvendo
 * erros (bloqueiam), avisos (exigem confirmação) e os nomes das outras pessoas
 * que já usam o mesmo telefone (informativo).
 *
 * @param {object} dados - campos vindos da tela (nome, aliases, telefone...)
 * @param {number|null} id - id da pessoa editada (ou null para nova)
 * @param {{ root?: string }} [opts]
 * @returns {{ erros: string[], avisos: string[], telefoneCompartilhadoCom: string[] }}
 */
export function verificarPessoa(dadosTela, id = null, { root = ROOT } = {}) {
  const arquivo = lerArquivo(root);
  const grupos = arquivo.grupos || {};
  const erros = [];
  const avisos = [];

  // Contato via outra pessoa: valida o vínculo e usa o telefone dela.
  const contato = aplicarContatoVia(arquivo, dadosTela || {}, id);
  if (contato.erro) erros.push(contato.erro);
  const dados = contato.dados;

  const nome = normalizarNome(dados.nome);
  const aliases = Array.isArray(dados.aliases)
    ? [...new Set(dados.aliases.map(normalizarAlias).filter(Boolean))]
    : [];
  const meusNomes = [nome, ...aliases];

  // 1) Caracteres de nome (erro): nome e cada apelido.
  for (const texto of meusNomes) {
    const probs = problemasNome(texto);
    if (probs.length > 0) {
      erros.push(`"${texto}": ${probs.join(' ')}`);
    }
  }

  // Telefone fora do formato (erro).
  const tel = validarTelefone(dados.telefone);
  if (!tel.ok) {
    erros.push(
      'Telefone inválido. Esperado: 55 + DDD (2 dígitos) + número de 8 ou 9 dígitos. Ex.: 5543999998888.',
    );
  }

  // Máximo de escalas no mês: vazio (sem limite) ou inteiro de 1 a 31.
  if (dados.limite_mensal != null && dados.limite_mensal !== '' && normalizarLimiteMensal(dados.limite_mensal) == null) {
    erros.push('Máximo de escalas no mês deve ser um número inteiro de 1 a 31 (ou vazio para sem limite).');
  }

  // 2) Duplicidade exata e normalizada contra outras pessoas e nome_exibicao de grupos.
  const outrasPessoas = arquivo.pessoas.filter((p) => p.id !== id);
  const gruposNomes = nomesExibicaoDeGrupos(grupos);

  // Conjunto de nomes exatos de outros (pessoas + grupos).
  const exatosOutros = new Map(); // nomeExato -> descrição
  for (const p of outrasPessoas) {
    for (const n of nomesDePessoa(p)) exatosOutros.set(n, `pessoa ${p.nome}`);
  }
  for (const g of gruposNomes) exatosOutros.set(g, `grupo ${g}`);

  // Conjunto normalizado de outros.
  const normOutros = new Map(); // normalizado -> descrição
  for (const p of outrasPessoas) {
    for (const n of nomesDePessoa(p)) {
      const k = normalizar(n);
      if (k) normOutros.set(k, `pessoa ${p.nome}`);
    }
  }
  for (const g of gruposNomes) {
    const k = normalizar(g);
    if (k) normOutros.set(k, `grupo ${g}`);
  }

  for (const n of meusNomes) {
    if (exatosOutros.has(n)) {
      erros.push(`"${n}" é igual ao nome de ${exatosOutros.get(n)}.`);
      continue;
    }
    const k = normalizar(n);
    if (k && normOutros.has(k)) {
      avisos.push(`"${n}" se parece com ${normOutros.get(k)} (possível duplicidade).`);
    }
  }

  // 3) Telefone compartilhado (informativo): outras pessoas com o mesmo número.
  const telefoneCompartilhadoCom = [];
  if (tel.ok && tel.digitos) {
    for (const p of outrasPessoas) {
      if (normalizarTelefone(p.telefone) === tel.digitos) telefoneCompartilhadoCom.push(p.nome);
    }
  }

  return { erros, avisos, telefoneCompartilhadoCom };
}

/** Telefone salvo da pessoa (ou '' para pessoa nova). */
function telefoneSalvo(arquivo, id) {
  if (id == null) return '';
  const p = arquivo.pessoas.find((x) => x.id === id);
  return p ? normalizarTelefone(p.telefone) : '';
}

/**
 * Salva (cria ou atualiza) uma pessoa aplicando as regras de confirmação:
 * - telefone novo ou alterado exige confirmacaoTelefone === true;
 * - avisos de duplicidade exigem confirmarAvisos === true;
 * - erros (duplicidade exata, caracteres, telefone fora do formato) sempre
 *   recusam o salvamento.
 *
 * Telefone compartilhado com outras pessoas NÃO exige confirmação extra.
 *
 * @param {object} dados
 * @param {{ id?: number|null, confirmacaoTelefone?: boolean, confirmarAvisos?: boolean, root?: string }} [opts]
 * @returns {{ pessoa: object, arquivos: string[] }}
 */
export function salvarPessoa(
  dadosTela,
  { id = null, confirmacaoTelefone = false, confirmarAvisos = false, root = ROOT } = {},
) {
  const arquivo = lerArquivo(root);
  const { erros, avisos } = verificarPessoa(dadosTela, id, { root });

  if (erros.length > 0) {
    throw new Error(erros.join(' '));
  }
  if (avisos.length > 0 && confirmarAvisos !== true) {
    const err = new Error(`Confirme os avisos antes de salvar: ${avisos.join(' ')}`);
    err.avisos = avisos;
    throw err;
  }

  // Contato via outra pessoa: o telefone é o dela (já confirmado no cadastro).
  const { dados, via } = aplicarContatoVia(arquivo, dadosTela, id);

  // Telefone novo/alterado exige confirmação no WhatsApp (exceto contato via
  // outra pessoa, cujo número já foi confirmado no cadastro dela).
  const telNovo = normalizarTelefone(dados.telefone);
  const telAntigo = telefoneSalvo(arquivo, id);
  if (!via && telNovo && telNovo !== telAntigo && confirmacaoTelefone !== true) {
    throw new Error('Confirme no WhatsApp o telefone novo ou alterado antes de salvar.');
  }

  if (id == null) {
    const maxId = Math.max(0, ...arquivo.pessoas.map((p) => p.id));
    const pessoa = montarPessoa(dados, maxId + 1);
    if (!pessoa.nome) throw new Error('Nome é obrigatório.');
    arquivo.pessoas.push(pessoa);
    const { arquivos } = gravarValidado(arquivo, root);
    return { pessoa, arquivos };
  }

  const idx = arquivo.pessoas.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error(`Pessoa com ID ${id} não encontrada.`);
  const mesclado = { ...arquivo.pessoas[idx], ...dados };
  // A tela mandou "telefone próprio" (contato_via_id vazio): desfaz o vínculo.
  if (dadosTela && 'contato_via_id' in dadosTela && !via) delete mesclado.contato_via_id;
  const atualizada = montarPessoa(mesclado, id);
  if (!atualizada.nome) throw new Error('Nome é obrigatório.');
  arquivo.pessoas[idx] = atualizada;
  const { arquivos } = gravarValidado(arquivo, root);
  return { pessoa: atualizada, arquivos };
}

/** Lê o contatos.json atual (ou {} quando ausente/ inválido). */
function lerContatos(root) {
  const caminho = resolve(root, 'contatos.json');
  if (!existsSync(caminho)) return {};
  try {
    return JSON.parse(readFileSync(caminho, 'utf8'));
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Task 9: última vez em que cada pessoa serviu (atual.json + old/AAAA/*.json)
// ---------------------------------------------------------------------------

/** Campos de participação que contam para "última vez". */
const CAMPOS_PARTICIPACAO = ['REGENTE LOUVOR', 'EQUIPE LOUVOR', 'MENSAGEM MUSICAL'];

/** Nomes/apelidos de uma célula de atual.json (divide por vírgula). */
function nomesDaCelula(valor) {
  return String(valor || '')
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n && n !== '-');
}

/**
 * Lê todas as linhas de escala (arrays) de atual.json e old/AAAA/*.json.
 * @returns {object[]} linhas com campo DATA (AAAA-MM-DD)
 */
function coletarLinhasHistorico(root) {
  const linhas = [];

  function tentarArray(caminho) {
    if (!existsSync(caminho)) return;
    try {
      const dados = JSON.parse(readFileSync(caminho, 'utf8'));
      if (Array.isArray(dados)) linhas.push(...dados);
    } catch {
      /* ignora arquivos inválidos */
    }
  }

  tentarArray(resolve(root, 'atual.json'));

  const oldDir = resolve(root, 'old');
  if (existsSync(oldDir)) {
    for (const ano of readdirSync(oldDir)) {
      const anoDir = resolve(oldDir, ano);
      let arquivos = [];
      try {
        arquivos = readdirSync(anoDir);
      } catch {
        continue;
      }
      for (const nome of arquivos) {
        if (nome.endsWith('.json')) tentarArray(resolve(anoDir, nome));
      }
    }
  }

  return linhas;
}

/**
 * Para cada pessoa, a data mais recente (AAAA-MM-DD) em que aparece em
 * REGENTE LOUVOR, EQUIPE LOUVOR ou MENSAGEM MUSICAL, ou null (nunca).
 *
 * @param {object[]} pessoas
 * @param {string} root
 * @returns {Record<number, string|null>}
 */
function calcularUltimaVez(pessoas, root) {
  const linhas = coletarLinhasHistorico(root);

  // Index: normalizado -> id de pessoa.
  const porNomeNorm = new Map();
  for (const p of pessoas) {
    for (const n of nomesDePessoa(p)) {
      const k = normalizar(n);
      if (k && !porNomeNorm.has(k)) porNomeNorm.set(k, p.id);
    }
  }

  const ultima = {};
  for (const p of pessoas) ultima[p.id] = null;

  for (const linha of linhas) {
    const data = linha.DATA || linha.data;
    if (!data) continue;
    for (const campo of CAMPOS_PARTICIPACAO) {
      for (const nome of nomesDaCelula(linha[campo])) {
        const id = porNomeNorm.get(normalizar(nome));
        if (id == null) continue;
        if (!ultima[id] || data > ultima[id]) ultima[id] = data;
      }
    }
  }

  return ultima;
}

/** Lista todas as pessoas (dados completos) para a tela de gestão. */
export function listarPessoas({ root = ROOT } = {}) {
  const arquivo = lerArquivo(root);
  const contatos = lerContatos(root);
  return {
    pessoas: arquivo.pessoas,
    grupos: arquivo.grupos || {},
    ultimaVez: calcularUltimaVez(arquivo.pessoas, root),
    migracoesPendentes: calcularMigracoesPendentes(arquivo, contatos),
  };
}

/**
 * Lista as migrações do cadastro: pendências e diferenças do contatos.json.
 * @returns {{ pendentes: string[], diferencas: object[] }}
 */
export function listarMigracoes({ root = ROOT } = {}) {
  const arquivo = lerArquivo(root);
  const contatos = lerContatos(root);
  return {
    pendentes: calcularMigracoesPendentes(arquivo, contatos),
    diferencas: diferencasContatos(contatos, arquivo),
    pendenciasCaracteres: pendenciasCaracteresCadastro(arquivo),
    propostaGrupos: propostaGrupos(),
  };
}

/**
 * Aplica a migração do contatos.json com as decisões informadas, gravando
 * pessoas.json e contatos.json. Devolve os arquivos tocados.
 */
export function aplicarMigracaoContatosRoot(decisoes, { root = ROOT } = {}) {
  const arquivo = lerArquivo(root);
  const contatos = lerContatos(root);
  const novo = aplicarMigracaoContatos(arquivo, contatos, decisoes);
  const { arquivos } = gravarValidado(novo, root);
  return { arquivos };
}

/** Aplica a migração de grupos escaláveis e grava (Task 8). */
export function aplicarMigracaoGruposRoot(grupos, { root = ROOT } = {}) {
  const arquivo = lerArquivo(root);
  const novo = aplicarMigracaoGrupos(arquivo, grupos);
  const { arquivos } = gravarValidado(novo, root);
  return { arquivos };
}

/**
 * Acrescenta apelidos a pessoas (usado pela importação da enquete, Task 17).
 * Cada item é { pessoaId, apelido }. Apelidos já existentes são ignorados.
 * Grava pessoas.json + contatos.json e devolve os arquivos (ou [] sem mudança).
 *
 * @param {Array<{ pessoaId: number, apelido: string }>} apelidos
 * @param {{ root?: string }} [opts]
 * @returns {{ arquivos: string[] }}
 */
export function aplicarApelidosRoot(apelidos, { root = ROOT } = {}) {
  const lista = Array.isArray(apelidos) ? apelidos : [];
  if (lista.length === 0) return { arquivos: [] };
  const arquivo = lerArquivo(root);
  let mudou = false;
  for (const { pessoaId, apelido } of lista) {
    const pessoa = arquivo.pessoas.find((p) => p.id === pessoaId);
    if (!pessoa || !apelido) continue;
    const ap = normalizarAlias(apelido);
    if (!ap) continue;
    pessoa.aliases = pessoa.aliases || [];
    if (pessoa.nome === ap || pessoa.aliases.includes(ap)) continue;
    pessoa.aliases.push(ap);
    mudou = true;
  }
  if (!mudou) return { arquivos: [] };
  const { arquivos } = gravarValidado(arquivo, root);
  return { arquivos };
}

/** Aplica a migração das regras por nome e grava (Task 7). */
export function aplicarMigracaoRegrasPorNomeRoot({ root = ROOT } = {}) {
  const arquivo = lerArquivo(root);
  const novo = migrarRegrasPorNome(arquivo);
  const { arquivos } = gravarValidado(novo, root);
  return { arquivos };
}

/** Cria uma nova pessoa. Retorna a pessoa criada e os arquivos tocados. */
export function criarPessoa(dados, { root = ROOT } = {}) {
  const arquivo = lerArquivo(root);
  const maxId = Math.max(0, ...arquivo.pessoas.map((p) => p.id));
  const novoId = maxId + 1;
  const pessoa = montarPessoa(dados, novoId);

  if (!pessoa.nome) throw new Error('Nome é obrigatório.');

  arquivo.pessoas.push(pessoa);
  const { arquivos } = gravarValidado(arquivo, root);
  return { pessoa, arquivos };
}

/** Atualiza uma pessoa existente (por id). Retorna a pessoa e os arquivos. */
export function atualizarPessoa(id, dados, { root = ROOT } = {}) {
  const arquivo = lerArquivo(root);
  const idx = arquivo.pessoas.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error(`Pessoa com ID ${id} não encontrada.`);

  const atualizada = montarPessoa({ ...arquivo.pessoas[idx], ...dados }, id);
  if (!atualizada.nome) throw new Error('Nome é obrigatório.');

  arquivo.pessoas[idx] = atualizada;
  const { arquivos } = gravarValidado(arquivo, root);
  return { pessoa: atualizada, arquivos };
}

// ---------------------------------------------------------------------------
// Task 7: vínculos (sempre_junto simétrico, familia_requerida, precisa_de)
// ---------------------------------------------------------------------------

/**
 * Aplica os vínculos de uma pessoa ao arquivo (mutando-o), garantindo simetria
 * de sempre_junto, grupo existente ou novo para familia_requerida, e precisa_de
 * unidirecional na própria pessoa.
 *
 * @param {object} arquivo - pessoas.json carregado (será mutado)
 * @param {number} id - id da pessoa cujos vínculos serão definidos
 * @param {{ sempreJunto?: number[], familiaRequerida?: string|null, precisaDe?: number[], novoGrupo?: { chave: string, membros_ids: number[] } }} vinc
 * @returns {object} o mesmo arquivo
 */
export function aplicarVinculos(
  arquivo,
  id,
  { sempreJunto = [], familiaRequerida = null, precisaDe = [], novoGrupo = null } = {},
) {
  arquivo.grupos = arquivo.grupos || {};
  const pessoa = arquivo.pessoas.find((p) => p.id === id);
  if (!pessoa) throw new Error(`Pessoa com ID ${id} não encontrada.`);

  // Cria um grupo novo, se solicitado, antes de referenciá-lo.
  if (novoGrupo && novoGrupo.chave) {
    arquivo.grupos[novoGrupo.chave] = arquivo.grupos[novoGrupo.chave] || {
      membros_ids: novoGrupo.membros_ids || [],
    };
    if (!familiaRequerida) familiaRequerida = novoGrupo.chave;
  }

  // Vínculos atuais de sempre_junto desta pessoa (antes da alteração).
  const antesSJ = (pessoa.vinculos || [])
    .filter((v) => v.tipo === 'sempre_junto')
    .map((v) => v.com_id);

  // Monta os novos vínculos da pessoa.
  const novos = [];
  for (const outroId of [...new Set(sempreJunto)]) {
    if (outroId !== id) novos.push({ tipo: 'sempre_junto', com_id: outroId });
  }
  if (familiaRequerida) {
    novos.push({ tipo: 'familia_requerida', grupo: familiaRequerida });
  }
  const comIds = [...new Set(precisaDe)].filter((x) => x !== id);
  if (comIds.length > 0) {
    novos.push({ tipo: 'precisa_de', com_ids: comIds });
  }
  pessoa.vinculos = novos;

  // Simetria de sempre_junto: adiciona recíproco nos novos, remove dos retirados.
  const agoraSJ = new Set(sempreJunto.filter((x) => x !== id));
  for (const outroId of agoraSJ) {
    const outro = arquivo.pessoas.find((p) => p.id === outroId);
    if (!outro) throw new Error(`Vínculo sempre_junto com ID inexistente: ${outroId}.`);
    outro.vinculos = outro.vinculos || [];
    const tem = outro.vinculos.some((v) => v.tipo === 'sempre_junto' && v.com_id === id);
    if (!tem) outro.vinculos.push({ tipo: 'sempre_junto', com_id: id });
  }
  for (const outroId of antesSJ) {
    if (agoraSJ.has(outroId)) continue;
    const outro = arquivo.pessoas.find((p) => p.id === outroId);
    if (!outro) continue;
    outro.vinculos = (outro.vinculos || []).filter(
      (v) => !(v.tipo === 'sempre_junto' && v.com_id === id),
    );
  }

  return arquivo;
}

/**
 * Salva os vínculos de uma pessoa (via aplicarVinculos) e grava, validando.
 */
export function salvarVinculos(id, vinc, { root = ROOT } = {}) {
  const arquivo = lerArquivo(root);
  aplicarVinculos(arquivo, id, vinc);
  const pessoa = arquivo.pessoas.find((p) => p.id === id);
  const { arquivos } = gravarValidado(arquivo, root);
  return { pessoa, arquivos };
}

// ---------------------------------------------------------------------------
// Task 10: desativar e excluir definitivamente
// ---------------------------------------------------------------------------

/** Desativa uma pessoa (ativo=false, habilitações zeradas), mantendo-a. */
export function desativarPessoa(id, { root = ROOT } = {}) {
  const arquivo = lerArquivo(root);
  const idx = arquivo.pessoas.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error(`Pessoa com ID ${id} não encontrada.`);
  const p = arquivo.pessoas[idx];
  p.ativo = false;
  p.habilitacoes = {
    regente: false,
    equipe: false,
    mensagem_musical: { es: false, culto: false, domingo: false },
    sonoplastia: false,
  };
  const { arquivos } = gravarValidado(arquivo, root);
  return { pessoa: p, arquivos };
}

/**
 * Lista os motivos que bloqueiam a exclusão definitiva de uma pessoa:
 * - participa de qualquer vínculo (próprio ou de outra pessoa);
 * - é membro ou responsável de algum grupo;
 * - aparece em old/AAAA/*.json ou atual.json.
 *
 * @returns {string[]} motivos (vazio = pode excluir)
 */
export function motivosBloqueioExclusao(id, { root = ROOT } = {}) {
  const arquivo = lerArquivo(root);
  const pessoa = arquivo.pessoas.find((p) => p.id === id);
  if (!pessoa) throw new Error(`Pessoa com ID ${id} não encontrada.`);
  const motivos = [];

  // Vínculos próprios.
  if ((pessoa.vinculos || []).length > 0) {
    motivos.push('tem vínculos (casal, família ou dependência).');
  }
  // Vínculos de outras pessoas que a referenciam.
  for (const p of arquivo.pessoas) {
    if (p.id === id) continue;
    for (const v of p.vinculos || []) {
      if (v.tipo === 'sempre_junto' && v.com_id === id) {
        motivos.push(`é parceira de ${p.nome} (sempre junto).`);
      } else if (v.tipo === 'precisa_de' && Array.isArray(v.com_ids) && v.com_ids.includes(id)) {
        motivos.push(`${p.nome} precisa dela (precisa_de).`);
      }
    }
  }
  // Grupos (membro ou responsável).
  for (const [chave, def] of Object.entries(arquivo.grupos || {})) {
    if (Array.isArray(def.membros_ids) && def.membros_ids.includes(id)) {
      motivos.push(`é membro do grupo "${def.nome_exibicao || chave}".`);
    }
    if (def.responsavel_id === id) {
      motivos.push(`é responsável do grupo "${def.nome_exibicao || chave}".`);
    }
  }
  // Histórico em old/ e atual.json.
  const ultima = calcularUltimaVez(arquivo.pessoas, root)[id];
  if (ultima) {
    motivos.push(`aparece no histórico (última vez em ${ultima}).`);
  }

  return motivos;
}

/**
 * Exclui definitivamente uma pessoa de pessoas.json. Lança se houver motivo
 * de bloqueio.
 *
 * @returns {{ pessoa: object, arquivos: string[] }}
 */
export function excluirPessoa(id, { root = ROOT } = {}) {
  const motivos = motivosBloqueioExclusao(id, { root });
  if (motivos.length > 0) {
    throw new Error(`Não é possível excluir: ${motivos.join(' ')}`);
  }
  const arquivo = lerArquivo(root);
  const idx = arquivo.pessoas.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error(`Pessoa com ID ${id} não encontrada.`);
  const [removida] = arquivo.pessoas.splice(idx, 1);
  const { arquivos } = gravarValidado(arquivo, root);
  return { pessoa: removida, arquivos };
}


