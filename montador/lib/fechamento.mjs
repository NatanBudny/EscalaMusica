// Fechamento completo em processo (Task 31).
//
// Um clique faz tudo que scripts/publicacao/publicar-fechamento.js fazia, sem
// shell, e envia ao GitHub. Etapas (design "Fechamento"):
//   1. git.pullRebase() — conflito → 409.
//   2. carregarContexto(mes) e revalidarParaEnvio (inclui a conferência de
//      links da Task 30). Erro → 422; aviso sem ciência → 409.
//   3. Dentro de um registro de arquivos tocados (para restaurar em falha):
//      - backup do atual.json anterior em old/AAAA/MMAAAA.json;
//      - atual.json = linhasAtual (RF006);
//      - contatos.json = derivarContatos(pessoas, grupos) (o mesmo conferido);
//      - três controles de rotação (RF022);
//      - linha em processos/logs/publicacoes.md (RF008);
//      - limpeza dos insumos temporários (como coletor-lixo-pos-publicacao.js).
//   4. Em falha de qualquer etapa antes do commit, restaura tudo e relança.
//   5. commitSeletivo dos caminhos tocados e enviar().
//
// Feature: melhoras-domingao (F. Envio) — Task 31; Properties 31, 32, 5;
// Requisitos 6.17, 21.8, 23.1 a 23.10.

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';

import { ROOT, carregarContexto } from './regras.mjs';
import { criarGit } from './git.mjs';
import { gerarLinhasAtual, backupAtual } from './publicar.mjs';
import { revalidarParaEnvio } from './revalidacao.mjs';
import { atualizarControles } from './controles.mjs';
import { derivarContatos } from '../../scripts/lib/contatos.js';
import { separarExcecoes, registroExcecoes, caminhoExcecoes } from './excecoes.mjs';

/** Insumos preservados pela limpeza (iguais ao coletor-lixo-pos-publicacao.js). */
const INSUMOS_PRESERVADOS = new Set([
  'indisponibilidade-cantores.json',
  // Mantido para o ajuste da escala publicada conferir a enquete (05/11/2026).
  'indisponibilidade-cantores-vinculada.json',
  'mapeamento-indisponibilidade-contatos.md',
]);

const LOG_PUBLICACOES = 'processos/logs/publicacoes.md';

/**
 * Erro de fechamento com status HTTP (409 conflito/ciência, 422 validação).
 */
export class ErroFechamento extends Error {
  constructor({ status, erros = [], avisosSemCiencia = [], conflitos, mensagem }) {
    super(mensagem || `Fechamento recusado (${status}).`);
    this.name = 'ErroFechamento';
    this.status = status;
    this.erros = erros;
    this.avisosSemCiencia = avisosSemCiencia;
    if (conflitos) this.conflitos = conflitos;
  }
}

/**
 * Registro dos arquivos tocados por uma operação, para restaurar o estado
 * anterior (conteúdo ou ausência) se alguma etapa falhar antes do commit.
 */
class Tocados {
  constructor(root) {
    this.root = root;
    this.ordem = []; // caminhos relativos, na ordem em que foram tocados
    this.anterior = new Map(); // rel → { existia, conteudo }
  }

  _backup(rel) {
    if (!rel || this.anterior.has(rel)) return;
    const abs = resolve(this.root, rel);
    if (existsSync(abs)) {
      this.anterior.set(rel, { existia: true, conteudo: readFileSync(abs) });
    } else {
      this.anterior.set(rel, { existia: false, conteudo: null });
    }
  }

  _marcar(rel) {
    if (!rel) return;
    if (!this.ordem.includes(rel)) this.ordem.push(rel);
  }

  /** Registra caminhos já modificados por outra função (ex.: backupAtual, controles). */
  registrar(...rels) {
    for (const rel of rels) {
      if (!rel) continue;
      // O backup já pode ter sido feito antes da escrita; aqui só garante que
      // o caminho entre no commit. O estado anterior desses arquivos (que não
      // existiam) é "ausente", então restaurar significa removê-los.
      if (!this.anterior.has(rel)) this.anterior.set(rel, { existia: false, conteudo: null });
      this._marcar(rel);
    }
  }

  /** Grava um JSON (ou texto) no caminho, guardando o estado anterior. */
  escrever(rel, dados) {
    this._backup(rel);
    const abs = resolve(this.root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    const texto =
      typeof dados === 'string' ? dados : `${JSON.stringify(dados, null, 2)}\n`;
    writeFileSync(abs, texto, 'utf8');
    this._marcar(rel);
  }

  /** Acrescenta uma linha a um arquivo de texto, guardando o estado anterior. */
  acrescentar(rel, linha) {
    this._backup(rel);
    const abs = resolve(this.root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    const atual = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
    const sep = atual.length === 0 || atual.endsWith('\n') ? '' : '\n';
    writeFileSync(abs, `${atual}${sep}${linha}\n`, 'utf8');
    this._marcar(rel);
  }

  /** Remove arquivos, guardando o estado anterior para restauração. */
  remover(...rels) {
    for (const rel of rels) {
      if (!rel) continue;
      this._backup(rel);
      const abs = resolve(this.root, rel);
      if (existsSync(abs)) rmSync(abs, { force: true });
      this._marcar(rel);
    }
  }

  /** Caminhos tocados (para o commit seletivo). */
  caminhos() {
    return [...this.ordem];
  }

  /** Restaura o estado anterior de todos os caminhos tocados. */
  restaurar() {
    for (const [rel, snap] of this.anterior) {
      const abs = resolve(this.root, rel);
      if (snap.existia) {
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, snap.conteudo);
      } else if (existsSync(abs)) {
        rmSync(abs, { force: true });
      }
    }
  }
}

/**
 * Alvos da limpeza pós-publicação (como coletor-lixo-pos-publicacao.js):
 * rascunho.md, publicada.md e os insumos do mês, exceto os preservados.
 *
 * @param {string} mes - "AAAA-MM"
 * @param {{ root?: string }} [opts]
 * @returns {string[]} caminhos relativos existentes
 */
export function alvosLimpeza(mes, { root = ROOT } = {}) {
  const [ano, mm] = String(mes).split('-');
  const base = `escalas/${ano}/${mm}`;
  const alvos = [`${base}/rascunho.md`, `${base}/publicada.md`];

  const insumosRel = `${base}/insumos`;
  const insumosAbs = resolve(root, insumosRel);
  if (existsSync(insumosAbs)) {
    for (const nome of readdirSync(insumosAbs)) {
      if (INSUMOS_PRESERVADOS.has(nome)) continue;
      const abs = resolve(insumosAbs, nome);
      if (existsSync(abs) && statSync(abs).isFile()) alvos.push(`${insumosRel}/${nome}`);
    }
  }

  return alvos.filter((rel) => existsSync(resolve(root, rel)));
}

/** Linha do log de publicações (RF008). */
export function linhaLog(mes, autor, agora = new Date(), qtdExcecoes = 0) {
  const [ano, mm] = String(mes).split('-');
  const data = agora.toISOString().slice(0, 10);
  const nomeMes = `${mm}/${ano}`;
  const extra =
    qtdExcecoes > 0
      ? ` ${qtdExcecoes} exceção(ões) confirmada(s) pelo diretor (ver ${caminhoExcecoes(mes)}).`
      : '';
  return `| ${data} | atual.json (${nomeMes}) | ${autor} | Fechamento pelo editor de escala.${extra} |`;
}

/** Rótulo "MM-AAAA" usado na mensagem de commit. */
function refCommit(mes) {
  const [ano, mm] = String(mes).split('-');
  return `${mm}/${ano}`;
}

/**
 * Reconstrói o objeto `grupos` do pessoas.json a partir do Map de grupos
 * escaláveis do contexto (derivarContatos espera o objeto, não o Map).
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

/**
 * Fecha (publica) a escala do mês em processo.
 *
 * @param {{ mes: string, cultos: object[], ciencias?: string[] }} entrada
 * @param {{ root?: string, git?: object, agora?: Date }} [opcoes]
 * @returns {Promise<object>} RelatorioFechamento
 * @throws {ErroFechamento} 409/422 quando a revalidação bloqueia
 */
export async function fechar(
  { mes, cultos, ciencias = [], excecoes = [] },
  { root = ROOT, git = criarGit({ cwd: root }), agora = new Date() } = {},
) {
  // 1. Sincroniza antes de gerar os arquivos.
  const pull = await git.pullRebase();
  if (pull && pull.conflitos) {
    throw new ErroFechamento({
      status: 409,
      conflitos: pull.conflitos,
      mensagem: 'Conflito de sincronização ao fechar.',
    });
  }

  // 2. Revalidação completa (inclui conferência de links).
  const base = carregarContexto(mes, { root });
  const { erros, avisos, linhasAtual, conferencia } = revalidarParaEnvio(
    base,
    Array.isArray(cultos) ? cultos : [],
    { root },
  );
  // Bloqueios de regra com exceção confirmada pelo diretor não impedem o envio.
  const { pendentes, confirmadas } = separarExcecoes(erros, excecoes);
  if (pendentes.length > 0) {
    throw new ErroFechamento({ status: 422, erros: pendentes });
  }
  const semCiencia = avisos.filter((a) => !ciencias.includes(a.id));
  if (semCiencia.length > 0) {
    throw new ErroFechamento({ status: 409, avisosSemCiencia: semCiencia });
  }

  // 3. Grava os arquivos, registrando tudo para restaurar em falha.
  const tocados = new Tocados(root);
  const autor = typeof git.autor === 'function' ? await git.autor() : '';
  try {
    // Registro das exceções confirmadas (fora do site, nunca na OBS pública).
    const registro = registroExcecoes(mes, confirmadas, { root, autor, origem: 'fechamento', agora });
    if (registro) tocados.escrever(registro.rel, registro.dados);

    // Backup do atual.json anterior (quando é de outro mês).
    const backupRel = backupAtual({ root });
    if (backupRel) tocados.registrar(backupRel);

    tocados.escrever('atual.json', linhasAtual);

    const contatos = derivarContatos(
      (base.cadastro && base.cadastro.pessoas) || [],
      gruposBrutosDoBase(base),
    );
    tocados.escrever('contatos.json', contatos);

    const { arquivos: controles } = atualizarControles(mes, {
      root,
      parametros: base.parametros,
    });
    tocados.registrar(...controles);

    tocados.acrescentar(LOG_PUBLICACOES, linhaLog(mes, autor, agora, confirmadas.length));

    tocados.remover(...alvosLimpeza(mes, { root }));
  } catch (e) {
    tocados.restaurar();
    const erro = new Error(`Falha ao fechar: ${e.message}`);
    erro.status = 500;
    throw erro;
  }

  // 4. Commit seletivo e envio.
  const commit = await git.commitSeletivo(
    tocados.caminhos(),
    `Publica escala ${refCommit(mes)} (editor de escala)`,
  );
  const envio = await git.enviar();

  return {
    ok: pendentes.length === 0,
    mes,
    cultos: linhasAtual.length,
    arquivos: tocados.caminhos(),
    avisos,
    excecoes: confirmadas,
    conferencia: { tabela: (conferencia && conferencia.tabela) || [] },
    commit: commit && (commit.commit || commit.semAlteracoes ? commit : undefined),
    push: envio && envio.push,
    mensagem: envio && envio.erro,
  };
}
