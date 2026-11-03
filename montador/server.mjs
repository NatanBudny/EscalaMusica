// Servidor web local do Montador de Escala.
//
// Node puro (sem dependências). Serve a interface em montador/public/ e expõe a
// API que reaproveita a lógica de regras do projeto (montador/lib/regras.mjs) e
// o publicador (montador/lib/publicar.mjs).
//
// Exporta criarServidor({ root, porta, git }) para permitir testar as rotas;
// só chama listen(porta, '127.0.0.1') quando executado diretamente.
//
// Uso: node montador/server.mjs  (ou npm run montar)

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  carregarContexto,
  candidatosParaCelula,
  candidatosSubstitutos,
  sugerirMes,
  validarEscala,
} from './lib/regras.mjs';
import { tipoDoCulto, slotsDoCulto, paraParticipacao } from './lib/contexto.mjs';
import { gerarLinhasAtual, cultosDeAtual } from './lib/publicar.mjs';
import { revalidarParaEnvio } from './lib/revalidacao.mjs';
import { fechar, ErroFechamento } from './lib/fechamento.mjs';
import { conferirSite } from './lib/verificacao-site.mjs';
import { listaDoMes } from './lib/whatsapp.mjs';
import { listarPublicada, previsaoAjuste, ajustar } from './lib/ajuste-publicada.mjs';
import { readFileSync } from 'node:fs';
import {
  listarPessoas,
  listarMigracoes,
  aplicarMigracaoContatosRoot,
  verificarPessoa,
  salvarPessoa,
  salvarVinculos,
  desativarPessoa,
  motivosBloqueioExclusao,
  excluirPessoa,
  aplicarMigracaoGruposRoot,
  aplicarMigracaoRegrasPorNomeRoot,
} from './lib/pessoas.mjs';
import { salvarGrupo, removerGrupo } from './lib/grupos.mjs';
import { abrirMes } from './lib/ciclo.mjs';
import {
  lerAcionato,
  salvarAcionato,
  lerSonoplastia,
  salvarSonoplastia,
} from './lib/insumos.mjs';
import { carregarPessoas } from '../scripts/lib/cadastro.js';
import {
  validarEnquete,
  analisarEnquete,
  gravarImportacao,
} from './lib/indisponibilidade.mjs';
import { aplicarApelidosRoot } from './lib/pessoas.mjs';
import {
  listarCatalogo,
  historico as historicoRegra,
  editarTexto,
  reverter,
  salvarParametros,
  salvarMensagens,
  reverterMensagens,
  validarCatalogo,
} from './lib/regras-catalogo.mjs';
import { carregarParametros } from '../scripts/lib/parametros.js';
import { carregarMensagens } from '../scripts/lib/mensagens-whatsapp.js';
import { problemasNome, problemasObs, problemasTextoLivre } from '../scripts/lib/texto-publico.js';
import { resumoParticipacao } from './lib/participacao.mjs';
import { resolve as resolvePath } from 'node:path';
import { criarGit } from './lib/git.mjs';
import { validarRequisicao, lerCorpoJson } from './lib/seguranca.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, 'public');
const PORT_PADRAO = Number(process.env.MONTADOR_PORT || 4599);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

const MES_RE = /^\d{4}-\d{2}$/;

/**
 * Cria o servidor HTTP do montador.
 *
 * @param {{ porta?: number, root?: string, git?: object }} opcoes
 * @returns {import('node:http').Server}
 */
export function criarServidor({ porta = PORT_PADRAO, git = criarGit() } = {}) {
  async function handleApi(req, res, url) {
    try {
      // Lê o corpo (com limite e content-type) só para métodos com corpo.
      let body = {};
      const metodo = (req.method || 'GET').toUpperCase();
      const precisaCorpo = metodo === 'POST' || metodo === 'PUT';

      if (precisaCorpo) {
        try {
          body = await lerCorpoJson(req);
        } catch (err) {
          sendJson(res, err.status || 400, { erro: err.message });
          return;
        }
      }

      if (req.method === 'GET' && url.pathname === '/api/saude') {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/sync/status') {
        sendJson(res, 200, await git.status());
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/sync/tentar-de-novo') {
        sendJson(res, 200, await git.enviar());
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/dados') {
        const mes = url.searchParams.get('mes');
        if (!mes || !MES_RE.test(mes)) {
          sendJson(res, 400, { erro: 'Parametro "mes" (YYYY-MM) obrigatorio.' });
          return;
        }
        const base = carregarContexto(mes);
        // Enriquecer cada culto com tipo/slots (CultoMontagem) e acomp padrão.
        const cultos = base.cultos.map((c) => {
          const tipo = tipoDoCulto(c);
          const slots = slotsDoCulto(c, base.parametros);
          const modelo = c.modelo_louvor || (c.dia_semana === 'sabado' ? 'sabado' : c.dia_semana === 'domingo' ? 'domingo' : 'sem_louvor');
          return {
            ...c,
            tipo,
            slots,
            modelo_louvor: modelo,
            acomp: c.acomp || (modelo === 'sabado' ? 'BANDA' : 'PB'),
          };
        });
        // Grupos escaláveis (para o seletor e estado por chave).
        const gruposObj = {};
        for (const [chave, g] of (base.grupos || new Map()).entries()) {
          gruposObj[chave] = {
            chave,
            nome_exibicao: g.nome_exibicao,
            membros_ids: g.membros_ids,
            responsavel_id: g.responsavel_id,
            modo: g.modo,
            funcoes: g.funcoes,
          };
        }
        // publicada: atribuições do mês em atual.json (por ID), ou null.
        let publicada = null;
        try {
          const atualPath = resolvePath(__dirname, '..', 'atual.json');
          if (existsSync(atualPath)) {
            const atual = JSON.parse(readFileSync(atualPath, 'utf8'));
            if (Array.isArray(atual)) {
              const doMes = atual.filter((l) => {
                const m = String(l.DATA || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
                return m && `${m[3]}-${m[2]}` === mes;
              });
              if (doMes.length > 0) publicada = cultosDeAtual(doMes, base);
            }
          }
        } catch {
          publicada = null;
        }
        sendJson(res, 200, {
          mes,
          cultos,
          grupos: gruposObj,
          publicada,
          avisosParametros: base.avisosParametros || [],
          pessoas: base.cadastro.pessoas
            .filter((p) => p.ativo)
            .map((p) => ({ id: p.id, nome: p.nome, genero: p.genero })),
          indisponibilidade: {
            datas: (base.indisponibilidade.datas || []).map((d) => ({
              data: d.data_referencia,
              nomes: d.indisponiveis_nomes || [],
            })),
            mesInteiro: base.indisponibilidade.indisponiveis_mes_inteiro?.nomes || [],
          },
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/candidatos') {
        const { mes, cultos, data, slot } = body;
        if (!mes || !MES_RE.test(mes) || !data || !slot) {
          sendJson(res, 400, { erro: 'mes, data e slot sao obrigatorios.' });
          return;
        }
        const base = carregarContexto(mes);
        const resultado = candidatosParaCelula(base, Array.isArray(cultos) ? cultos : [], data, slot);
        // Compatibilidade: também devolve candidatos.elegiveis (clientes antigos).
        sendJson(res, 200, { ...resultado, candidatos: resultado });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/substitutos') {
        const { mes, cultos, data, slot, pessoaId } = body;
        if (!mes || !MES_RE.test(mes) || !data || !slot) {
          sendJson(res, 400, { erro: 'mes, data e slot sao obrigatorios.' });
          return;
        }
        const base = carregarContexto(mes);
        const resultado = candidatosSubstitutos(
          base,
          Array.isArray(cultos) ? cultos : [],
          data,
          slot,
          pessoaId == null ? null : pessoaId,
        );
        sendJson(res, 200, { ...resultado, candidatos: resultado });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/sugerir') {
        const { mes, cultos, modo } = body;
        if (!mes || !MES_RE.test(mes)) {
          sendJson(res, 400, { erro: 'mes (YYYY-MM) obrigatorio.' });
          return;
        }
        const base = carregarContexto(mes);
        const opts = {};
        if (Array.isArray(cultos)) opts.cultos = cultos;
        if (modo === 'vazios' || modo === 'tudo') opts.modo = modo;
        const sugestoes = sugerirMes(base, opts);
        const resposta = { sugestoes, cultos: sugestoes };
        // Em modo 'vazios', devolve também a validação do resultado.
        if (opts.modo === 'vazios') {
          resposta.validacao = validarEscala(base, sugestoes);
        }
        sendJson(res, 200, resposta);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/validar') {
        const { mes, cultos } = body;
        if (!mes || !MES_RE.test(mes) || !Array.isArray(cultos)) {
          sendJson(res, 400, { erro: 'mes e cultos sao obrigatorios.' });
          return;
        }
        const base = carregarContexto(mes);
        const resultado = validarEscala(base, cultos);
        sendJson(res, 200, resultado);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/revalidar-envio') {
        const { mes, cultos } = body;
        if (!mes || !MES_RE.test(mes) || !Array.isArray(cultos)) {
          sendJson(res, 400, { erro: 'mes e cultos sao obrigatorios.' });
          return;
        }
        const base = carregarContexto(mes);
        const { erros, avisos, conferencia } = revalidarParaEnvio(base, cultos);
        sendJson(res, 200, {
          erros,
          avisos,
          conferencia: { tabela: (conferencia && conferencia.tabela) || [] },
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/fechar') {
        const { mes, cultos, ciencias } = body;
        if (!mes || !MES_RE.test(mes) || !Array.isArray(cultos)) {
          sendJson(res, 400, { erro: 'mes e cultos sao obrigatorios.' });
          return;
        }
        try {
          // Fechamento completo em processo: revalida (com conferência de
          // links), grava atual.json/contatos.json/controles/log, limpa os
          // insumos, comita só os arquivos tocados e envia.
          const relatorio = await fechar(
            { mes, cultos, ciencias: Array.isArray(ciencias) ? ciencias : [] },
            { git },
          );
          sendJson(res, 200, relatorio);
        } catch (err) {
          if (err instanceof ErroFechamento) {
            sendJson(res, err.status, {
              erro: err.message,
              erros: err.erros,
              avisosSemCiencia: err.avisosSemCiencia,
              ...(err.conflitos ? { conflitos: err.conflitos } : {}),
            });
            return;
          }
          sendJson(res, err.status || 500, { erro: err.message });
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/verificar-site') {
        // Verificação automática do site (Task 32): confere se o GitHub Pages
        // já publicou os arquivos enviados e, quando sim, roda a conferência de
        // links sobre o conteúdo remoto. Sem espera fixa — só pelo conteúdo.
        const resultado = await conferirSite({ git });
        sendJson(res, 200, resultado);
        return;
      }

      // --- Ajustar escala publicada (Task 37) ---

      if (req.method === 'GET' && url.pathname === '/api/publicada') {
        // Lista os cultos de atual.json para a tela de ajuste.
        sendJson(res, 200, listarPublicada());
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/publicada/previa') {
        // Prévia da revalidação do ajuste (sem gravar): inclui a conferência de
        // links. Erros bloqueiam o salvamento; avisos pedem ciência.
        const { data, campo, valor } = body;
        try {
          const resultado = previsaoAjuste({ data, campo, valor });
          sendJson(res, 200, resultado);
        } catch (err) {
          sendJson(res, err.status || 500, { erro: err.message });
        }
        return;
      }

      if (req.method === 'PUT' && url.pathname === '/api/publicada') {
        // Grava só o campo alterado, recalcula os controles, comita atual.json
        // e os controles, envia e deixa a UI seguir para a verificação do site
        // (sem WhatsApp).
        const { data, campo, valor, ciencias } = body;
        try {
          const resultado = await ajustar(
            { data, campo, valor, ciencias: Array.isArray(ciencias) ? ciencias : [] },
            { git },
          );
          sendJson(res, 200, resultado);
        } catch (err) {
          if (err instanceof ErroFechamento) {
            sendJson(res, err.status, {
              erro: err.message,
              erros: err.erros,
              avisosSemCiencia: err.avisosSemCiencia,
              ...(err.conflitos ? { conflitos: err.conflitos } : {}),
            });
            return;
          }
          sendJson(res, err.status || 500, { erro: err.message });
        }
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/whatsapp') {
        // Lista de WhatsApp do mês (Task 34): monta um envio por pessoa e por
        // Grupo_Escalavel a partir de atual.json, dos Contatos_Derivados e das
        // Mensagens_WhatsApp editáveis, sem gerar arquivo .md.
        const mes = url.searchParams.get('mes');
        if (mes && !MES_RE.test(mes)) {
          sendJson(res, 400, { erro: 'Parametro "mes" deve ser YYYY-MM.' });
          return;
        }
        sendJson(res, 200, listaDoMes({ mes }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/participacao') {
        const { mes, cultos, janelaMeses } = body;
        if (!mes || !MES_RE.test(mes)) {
          sendJson(res, 400, { erro: 'mes (YYYY-MM) obrigatorio.' });
          return;
        }
        const base = carregarContexto(mes);
        const cultosResolvidos = paraParticipacao(
          Array.isArray(cultos) ? cultos : [],
          base.cadastro,
        );
        const resumo = resumoParticipacao(base, cultosResolvidos, janelaMeses);
        sendJson(res, 200, resumo);
        return;
      }

      // --- Gestão de pessoas (CRUD por tela) ---

      if (req.method === 'GET' && url.pathname === '/api/pessoas') {
        sendJson(res, 200, listarPessoas());
        return;
      }

      // --- Migrações do cadastro ---

      if (req.method === 'GET' && url.pathname === '/api/migracoes') {
        sendJson(res, 200, listarMigracoes());
        return;
      }

      if (
        req.method === 'POST' &&
        /^\/api\/migracoes\/[^/]+\/aplicar$/.test(url.pathname)
      ) {
        const nome = decodeURIComponent(url.pathname.split('/')[3]);
        try {
          let arquivos;
          let mensagem;
          if (nome === 'contatos_para_pessoas') {
            ({ arquivos } = aplicarMigracaoContatosRoot(body.decisoes || {}));
            mensagem = 'Cadastro: migrar contatos para pessoas (editor de escala)';
          } else if (nome === 'grupos_escalaveis') {
            ({ arquivos } = aplicarMigracaoGruposRoot(body.grupos || null));
            mensagem = 'Cadastro: migrar grupos escaláveis (editor de escala)';
          } else if (nome === 'regras_por_nome') {
            ({ arquivos } = aplicarMigracaoRegrasPorNomeRoot());
            mensagem = 'Cadastro: migrar regras por nome (editor de escala)';
          } else {
            sendJson(res, 404, { erro: `Migração "${nome}" não disponível.` });
            return;
          }
          const resultadoGit = await commitArquivos(arquivos, mensagem);
          sendJson(res, 200, { ok: true, git: resultadoGit });
        } catch (err) {
          sendJson(res, 422, { erro: err.message });
        }
        return;
      }

      // Verificação do cadastro (sem gravar): avisos e telefone compartilhado.
      if (req.method === 'POST' && url.pathname === '/api/pessoas/verificar') {
        try {
          const resultado = verificarPessoa(body.dados || {}, body.id ?? null);
          sendJson(res, 200, resultado);
        } catch (err) {
          sendJson(res, 422, { erro: err.message });
        }
        return;
      }

      // Editor de vínculos (Task 7): PUT /api/pessoas/:id/vinculos
      if (
        req.method === 'PUT' &&
        /^\/api\/pessoas\/\d+\/vinculos$/.test(url.pathname)
      ) {
        const id = Number(url.pathname.split('/')[3]);
        try {
          const { pessoa, arquivos } = salvarVinculos(id, body || {});
          const resultadoGit = await commitArquivos(
            arquivos,
            `Cadastro: vínculos de ${pessoa.nome} (editor de escala)`,
          );
          sendJson(res, 200, { ok: true, pessoa, git: resultadoGit });
        } catch (err) {
          sendJson(res, 422, { erro: err.message });
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/pessoas') {
        try {
          const { pessoa, arquivos } = salvarPessoa(body.dados || {}, {
            id: null,
            confirmacaoTelefone: body.confirmacaoTelefone === true,
            confirmarAvisos: body.confirmarAvisos === true,
          });
          const resultadoGit = await commitArquivos(
            arquivos,
            `Cadastro: criar ${pessoa.nome} (editor de escala)`,
          );
          sendJson(res, 200, { ok: true, pessoa, git: resultadoGit });
        } catch (err) {
          sendJson(res, 422, { erro: err.message, avisos: err.avisos });
        }
        return;
      }

      // Motivos de bloqueio da exclusão: GET /api/pessoas/:id/motivos-exclusao
      if (
        req.method === 'GET' &&
        /^\/api\/pessoas\/\d+\/motivos-exclusao$/.test(url.pathname)
      ) {
        const id = Number(url.pathname.split('/')[3]);
        try {
          const motivos = motivosBloqueioExclusao(id);
          sendJson(res, 200, { motivos });
        } catch (err) {
          sendJson(res, 404, { erro: err.message });
        }
        return;
      }

      // Desativar pessoa: POST /api/pessoas/:id/desativar
      if (
        req.method === 'POST' &&
        /^\/api\/pessoas\/\d+\/desativar$/.test(url.pathname)
      ) {
        const id = Number(url.pathname.split('/')[3]);
        try {
          const { pessoa, arquivos } = desativarPessoa(id);
          const resultadoGit = await commitArquivos(
            arquivos,
            `Cadastro: desativar ${pessoa.nome} (editor de escala)`,
          );
          sendJson(res, 200, { ok: true, pessoa, git: resultadoGit });
        } catch (err) {
          sendJson(res, 422, { erro: err.message });
        }
        return;
      }

      if (
        req.method === 'PUT' &&
        /^\/api\/pessoas\/\d+$/.test(url.pathname)
      ) {
        const id = Number(url.pathname.split('/').pop());
        try {
          const { pessoa, arquivos } = salvarPessoa(body.dados || {}, {
            id,
            confirmacaoTelefone: body.confirmacaoTelefone === true,
            confirmarAvisos: body.confirmarAvisos === true,
          });
          const resultadoGit = await commitArquivos(
            arquivos,
            `Cadastro: atualizar ${pessoa.nome} (editor de escala)`,
          );
          sendJson(res, 200, { ok: true, pessoa, git: resultadoGit });
        } catch (err) {
          sendJson(res, 422, { erro: err.message, avisos: err.avisos });
        }
        return;
      }

      if (
        req.method === 'DELETE' &&
        /^\/api\/pessoas\/\d+$/.test(url.pathname)
      ) {
        const id = Number(url.pathname.split('/').pop());
        try {
          const motivos = motivosBloqueioExclusao(id);
          if (motivos.length > 0) {
            sendJson(res, 422, { erro: 'Exclusão bloqueada.', motivos });
            return;
          }
          const { pessoa, arquivos } = excluirPessoa(id);
          const resultadoGit = await commitArquivos(
            arquivos,
            `Cadastro: excluir ${pessoa.nome} (editor de escala)`,
          );
          sendJson(res, 200, { ok: true, pessoa, git: resultadoGit });
        } catch (err) {
          sendJson(res, 422, { erro: err.message });
        }
        return;
      }

      // --- Grupos escaláveis (Task 8) ---

      if (req.method === 'PUT' && /^\/api\/grupos\/[^/]+$/.test(url.pathname)) {
        const chave = decodeURIComponent(url.pathname.split('/')[3]);
        try {
          const { grupo, arquivos } = salvarGrupo(chave, body || {});
          const resultadoGit = await commitArquivos(
            arquivos,
            `Cadastro: salvar grupo ${grupo.nome_exibicao} (editor de escala)`,
          );
          sendJson(res, 200, { ok: true, grupo, git: resultadoGit });
        } catch (err) {
          sendJson(res, 422, { erro: err.message });
        }
        return;
      }

      if (req.method === 'DELETE' && /^\/api\/grupos\/[^/]+$/.test(url.pathname)) {
        const chave = decodeURIComponent(url.pathname.split('/')[3]);
        try {
          const { arquivos } = removerGrupo(chave);
          const resultadoGit = await commitArquivos(
            arquivos,
            `Cadastro: remover grupo ${chave} (editor de escala)`,
          );
          sendJson(res, 200, { ok: true, git: resultadoGit });
        } catch (err) {
          sendJson(res, 422, { erro: err.message });
        }
        return;
      }

      // --- Catálogo de regras e versionamento (Task 11 / Task 13) ---

      if (req.method === 'GET' && url.pathname === '/api/regras') {
        sendJson(res, 200, { regras: listarCatalogo(), catalogo: validarCatalogo() });
        return;
      }

      if (req.method === 'GET' && /^\/api\/regras\/[^/]+\/historico$/.test(url.pathname)) {
        const id = decodeURIComponent(url.pathname.split('/')[3]);
        sendJson(res, 200, { versoes: historicoRegra(id) });
        return;
      }

      if (req.method === 'PUT' && /^\/api\/regras\/[^/]+\/texto$/.test(url.pathname)) {
        const id = decodeURIComponent(url.pathname.split('/')[3]);
        try {
          const autor = await git.autor();
          const { versao, arquivos } = editarTexto(id, body.textos || {}, { autor });
          const resultadoGit = await commitArquivos(
            arquivos,
            `Regras: editar texto de ${id} (editor de escala)`,
          );
          sendJson(res, 200, { ok: true, versao, git: resultadoGit });
        } catch (err) {
          sendJson(res, 422, { erro: err.message });
        }
        return;
      }

      if (req.method === 'POST' && /^\/api\/regras\/[^/]+\/reverter$/.test(url.pathname)) {
        const id = decodeURIComponent(url.pathname.split('/')[3]);
        try {
          const autor = await git.autor();
          const { versao, arquivos } = reverter(id, Number(body.numero), { autor });
          const resultadoGit = await commitArquivos(
            arquivos,
            `Regras: reverter ${id} para a versão ${body.numero} (editor de escala)`,
          );
          sendJson(res, 200, { ok: true, versao, git: resultadoGit });
        } catch (err) {
          sendJson(res, 422, { erro: err.message });
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/texto-publico') {
        const tipo = body.tipo;
        const texto = body.texto == null ? '' : String(body.texto);
        let problemas = [];
        if (tipo === 'obs') problemas = problemasObs(texto);
        else if (tipo === 'nome') problemas = problemasNome(texto);
        else if (tipo === 'livre') problemas = problemasTextoLivre(texto);
        else {
          sendJson(res, 400, { erro: 'tipo deve ser obs, nome ou livre.' });
          return;
        }
        sendJson(res, 200, { problemas });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/parametros') {
        const { parametros, avisos } = carregarParametros(
          resolvePath(__dirname, '..', 'processos/regras/parametros.json'),
        );
        sendJson(res, 200, { parametros, avisos });
        return;
      }

      if (req.method === 'PUT' && url.pathname === '/api/parametros') {
        try {
          const autor = await git.autor();
          const { versao, arquivos } = salvarParametros(body.parametros || body, { autor });
          const resultadoGit = await commitArquivos(
            arquivos,
            'Regras: salvar parâmetros (editor de escala)',
          );
          sendJson(res, 200, { ok: true, versao, git: resultadoGit });
        } catch (err) {
          sendJson(res, 422, { erro: err.message, problemas: err.problemas });
        }
        return;
      }

      // --- Mensagens de WhatsApp editáveis (Task 33) ---

      if (req.method === 'GET' && url.pathname === '/api/mensagens-whatsapp') {
        const { mensagens, avisos } = carregarMensagens(
          resolvePath(__dirname, '..', 'processos/regras/mensagens-whatsapp.json'),
        );
        sendJson(res, 200, { mensagens, avisos });
        return;
      }

      if (req.method === 'PUT' && url.pathname === '/api/mensagens-whatsapp') {
        try {
          const autor = await git.autor();
          const { versao, arquivos } = salvarMensagens(body.mensagens || body, { autor });
          const resultadoGit = await commitArquivos(
            arquivos,
            'Regras: salvar mensagens de WhatsApp (editor de escala)',
          );
          sendJson(res, 200, { ok: true, versao, git: resultadoGit });
        } catch (err) {
          sendJson(res, 422, { erro: err.message, problemas: err.problemas });
        }
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/mensagens-whatsapp/historico') {
        sendJson(res, 200, { versoes: historicoRegra('mensagens-whatsapp') });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/mensagens-whatsapp/reverter') {
        try {
          const autor = await git.autor();
          const { versao, arquivos } = reverterMensagens(Number(body.numero), { autor });
          const resultadoGit = await commitArquivos(
            arquivos,
            `Regras: reverter mensagens de WhatsApp para a versão ${body.numero} (editor de escala)`,
          );
          sendJson(res, 200, { ok: true, versao, git: resultadoGit });
        } catch (err) {
          sendJson(res, 422, { erro: err.message });
        }
        return;
      }

      // --- Iniciar ou retomar o mês (Task 14) ---

      if (req.method === 'POST' && /^\/api\/mes\/[^/]+\/abrir$/.test(url.pathname)) {
        const mes = decodeURIComponent(url.pathname.split('/')[3]);
        if (!MES_RE.test(mes)) {
          sendJson(res, 400, { erro: 'mes (YYYY-MM) obrigatorio.' });
          return;
        }
        try {
          const resultado = abrirMes(mes);
          const resultadoGit = await commitArquivos(
            resultado.arquivos,
            `Inicia escala ${mes} (editor de escala)`,
          );
          sendJson(res, 200, { ...resultado, git: resultadoGit });
        } catch (err) {
          sendJson(res, 422, { erro: err.message });
        }
        return;
      }

      // --- Acionato (Task 15) ---

      if (/^\/api\/mes\/[^/]+\/acionato$/.test(url.pathname)) {
        const mes = decodeURIComponent(url.pathname.split('/')[3]);
        if (!MES_RE.test(mes)) {
          sendJson(res, 400, { erro: 'mes (YYYY-MM) obrigatorio.' });
          return;
        }
        if (req.method === 'GET') {
          sendJson(res, 200, lerAcionato(mes) || { mes, itens: [] });
          return;
        }
        if (req.method === 'PUT') {
          try {
            const { arquivos } = salvarAcionato(mes, body || {});
            const resultadoGit = await commitArquivos(
              arquivos,
              `Insumos: acionato de ${mes} (editor de escala)`,
            );
            sendJson(res, 200, { ok: true, git: resultadoGit });
          } catch (err) {
            sendJson(res, 422, { erro: err.message });
          }
          return;
        }
      }

      // --- Sonoplastia (Task 16) ---

      if (/^\/api\/mes\/[^/]+\/sonoplastia$/.test(url.pathname)) {
        const mes = decodeURIComponent(url.pathname.split('/')[3]);
        if (!MES_RE.test(mes)) {
          sendJson(res, 400, { erro: 'mes (YYYY-MM) obrigatorio.' });
          return;
        }
        if (req.method === 'GET') {
          sendJson(res, 200, lerSonoplastia(mes) || { mes, itens: [] });
          return;
        }
        if (req.method === 'PUT') {
          try {
            const { arquivos } = salvarSonoplastia(mes, body || {});
            const resultadoGit = await commitArquivos(
              arquivos,
              `Insumos: sonoplastia de ${mes} (editor de escala)`,
            );
            sendJson(res, 200, { ok: true, git: resultadoGit });
          } catch (err) {
            sendJson(res, 422, { erro: err.message });
          }
          return;
        }
      }

      // --- Importação da indisponibilidade (Task 17) ---

      if (
        req.method === 'POST' &&
        /^\/api\/mes\/[^/]+\/indisponibilidade\/analisar$/.test(url.pathname)
      ) {
        const mes = decodeURIComponent(url.pathname.split('/')[3]);
        if (!MES_RE.test(mes)) {
          sendJson(res, 400, { erro: 'mes (YYYY-MM) obrigatorio.' });
          return;
        }
        const enquete = body.enquete || {};
        const { erros, datasIgnoradas } = validarEnquete(enquete, mes);
        if (erros.length > 0) {
          sendJson(res, 422, { erro: 'Enquete inválida.', erros, datasIgnoradas });
          return;
        }
        const cadastro = carregarPessoas();
        const associacoes = analisarEnquete(enquete, cadastro);
        sendJson(res, 200, { erros, datasIgnoradas, associacoes });
        return;
      }

      if (
        req.method === 'POST' &&
        /^\/api\/mes\/[^/]+\/indisponibilidade\/gravar$/.test(url.pathname)
      ) {
        const mes = decodeURIComponent(url.pathname.split('/')[3]);
        if (!MES_RE.test(mes)) {
          sendJson(res, 400, { erro: 'mes (YYYY-MM) obrigatorio.' });
          return;
        }
        const enquete = body.enquete || {};
        const { erros } = validarEnquete(enquete, mes);
        if (erros.length > 0) {
          sendJson(res, 422, { erro: 'Enquete inválida.', erros });
          return;
        }
        try {
          const { relatorio, arquivos, apelidosNovos } = gravarImportacao(
            mes,
            enquete,
            body.decisoes || {},
          );
          // Commit 1: apelidos novos no cadastro (quando houver).
          let gitCadastro = { ok: true, semAlteracoes: true };
          const { arquivos: arqCadastro } = aplicarApelidosRoot(apelidosNovos);
          if (arqCadastro.length > 0) {
            gitCadastro = await commitArquivos(
              arqCadastro,
              `Cadastro: apelidos da enquete de ${mes} (editor de escala)`,
            );
          }
          // Commit 2: enquete, vinculada e snapshot do mês.
          const gitInsumos = await commitArquivos(
            arquivos,
            `Insumos: indisponibilidade de ${mes} (editor de escala)`,
          );
          sendJson(res, 200, {
            ok: true,
            relatorio,
            git: gitInsumos,
            gitCadastro,
          });
        } catch (err) {
          sendJson(res, 422, { erro: err.message });
        }
        return;
      }

      sendJson(res, 404, { erro: 'Rota nao encontrada.' });
    } catch (err) {
      sendJson(res, 500, { erro: err.message });
    }
  }

  /** Comita a lista de caminhos devolvida por uma operação e envia. */
  async function commitArquivos(arquivos, mensagem) {
    const lista = (arquivos || []).filter(Boolean);
    if (lista.length === 0) return { ok: true, semAlteracoes: true };
    const commit = await git.commitSeletivo(lista, mensagem);
    if (!commit.ok || commit.semAlteracoes) return commit;
    const envio = await git.enviar();
    return { ...commit, ...envio };
  }

  async function serveStatic(req, res, url) {
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    // Impedir path traversal.
    const safePath = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');
    const filePath = resolve(PUBLIC_DIR, `.${safePath}`);
    if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Nao encontrado');
      return;
    }
    try {
      const data = await readFile(filePath);
      res.writeHead(200, {
        'content-type': MIME[extname(filePath)] || 'application/octet-stream',
      });
      res.end(data);
    } catch {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Erro ao ler arquivo');
    }
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${porta}`);

    // Toda rota passa pela validação de segurança (Host/Origin/content-type).
    const validacao = validarRequisicao(req, porta);
    if (!validacao.ok) {
      sendJson(res, validacao.status, { erro: validacao.erro });
      // Drena o corpo para não deixar a conexão pendurada.
      req.resume();
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      handleApi(req, res, url);
    } else {
      serveStatic(req, res, url);
    }
  });

  return server;
}

/**
 * Calcula o comando para abrir o navegador por plataforma, ou null quando a
 * abertura está desligada por MONTADOR_SEM_NAVEGADOR=1.
 *
 * @returns {{ comando: string, args: string[] } | null}
 */
export function comandoNavegador(endereco, { env = process.env, plataforma = process.platform } = {}) {
  if (env.MONTADOR_SEM_NAVEGADOR === '1') return null;
  if (plataforma === 'win32') {
    return { comando: 'cmd', args: ['/c', 'start', '', endereco] };
  }
  const abrir = plataforma === 'darwin' ? 'open' : 'xdg-open';
  return { comando: abrir, args: [endereco] };
}

/** Abre o navegador no endereço do servidor (salvo MONTADOR_SEM_NAVEGADOR=1). */
function abrirNavegador(endereco) {
  const cmd = comandoNavegador(endereco);
  if (!cmd) return;
  import('node:child_process').then(({ execFile }) => {
    execFile(cmd.comando, cmd.args, () => {});
  });
}

/** Sincroniza na inicialização e trata código alterado (RF 2.13/2.14). */
async function sincronizarInicio(git) {
  if (process.env.MONTADOR_SEM_PULL === '1') return;
  const resultado = await git.pullRebase();
  if (resultado && resultado.codigoAlterado) {
    if (process.env.MONTADOR_NA_CASCA === '1') {
      console.error('\n  Codigo atualizado pelo pull. Reiniciando o editor...\n');
      process.exit(75);
    } else {
      console.warn(
        '\n  Codigo em montador/ ou scripts/ mudou no pull. Reinicie o servidor (Ctrl+C e npm run montar).\n',
      );
    }
  }
}

// Só executa o servidor quando o arquivo é chamado diretamente.
const executadoDireto =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (executadoDireto) {
  const porta = PORT_PADRAO;
  const git = criarGit();
  const server = criarServidor({ porta, git });
  server.listen(porta, '127.0.0.1', async () => {
    const endereco = `http://127.0.0.1:${porta}/`;
    console.log(`\n  Montador de Escala rodando em ${endereco}`);
    console.log('  Abra o endereco acima no navegador. Para parar: Ctrl+C.\n');
    abrirNavegador(endereco);
    await sincronizarInicio(git);
  });
}
