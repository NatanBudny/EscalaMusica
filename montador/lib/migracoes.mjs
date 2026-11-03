// Migrações únicas do cadastro, marcadas em pessoas.json.migracoes.
//
// Nesta etapa (Task 4) só a migração do contatos.json no caminho SEM grupos:
// nenhuma entrada manual do contatos.json atual se perde quando ele passa a ser
// derivado de pessoas.json. O gate de grupos (entradas coberto_por_grupo e o
// bloqueio até a migração de grupos rodar) é completado na Task 8.
//
// Feature: melhoras-domingao (B. Cadastro) — Property 4; Requisitos 3.5 a 3.10.

import { derivarContatos } from '../../scripts/lib/contatos.js';
import { problemasNome } from '../../scripts/lib/texto-publico.js';
import normalizar from '../../scripts/lib/normalizar.js';

/** Só os dígitos de um telefone ou de um link wa.me. */
function digitos(valor) {
  return String(valor || '').replace(/\D/g, '');
}

/** Dígitos de uma entrada do contatos.json (telefone no formato wa.me). */
function digitosEntrada(entrada) {
  return digitos(entrada && entrada.telefone);
}

/** Lista as pessoas cujo telefone (dígitos) é igual ao informado. */
function pessoasComTelefone(pessoas, tel) {
  if (!tel) return [];
  return pessoas.filter((p) => digitos(p.telefone) === tel);
}

/**
 * Compara o contatos.json atual com o gerado a partir de pessoas.json e
 * classifica cada divergência.
 *
 * @param {Record<string, {telefone:string, apelidos:string[]}>} contatosAtual
 * @param {{ pessoas: object[], grupos?: object }} pessoasArquivo
 * @returns {Array<{
 *   chave: string,
 *   tipo: 'so_no_contatos'|'difere'|'so_no_gerado',
 *   proposta: object,
 *   pendencia?: { motivo:'telefone_compartilhado'|'caracteres', pessoas?: object[], opcoes: object[] }
 * }>}
 */
export function diferencasContatos(contatosAtual, pessoasArquivo) {
  const pessoas = pessoasArquivo.pessoas || [];
  const grupos = pessoasArquivo.grupos || {};
  const gerado = derivarContatos(pessoas, grupos);
  const atual = contatosAtual || {};

  // nome_exibicao de cada grupo escalável (para marcar coberto_por_grupo).
  const nomesExibicaoGrupo = new Set();
  for (const def of Object.values(grupos)) {
    if (def && def.escalavel === true && def.nome_exibicao) {
      nomesExibicaoGrupo.add(def.nome_exibicao);
    }
  }

  const diferencas = [];

  for (const [chave, entrada] of Object.entries(atual)) {
    const tel = digitosEntrada(entrada);
    const apelidos = Array.isArray(entrada.apelidos) ? entrada.apelidos : [];

    // Entrada cuja chave é o nome_exibicao de um Grupo_Escalavel: coberta pelo
    // grupo, sem virar pessoa nem apelido.
    if (nomesExibicaoGrupo.has(chave)) {
      diferencas.push({
        chave,
        tipo: 'coberto_por_grupo',
        proposta: { telefone: tel, apelidos },
      });
      continue;
    }

    if (gerado[chave]) {
      // A chave já existe no gerado. Verifica se telefone/apelidos conferem.
      const g = gerado[chave];
      const mesmoTel = digitosEntrada(g) === tel;
      const faltamApelidos = apelidos.filter((a) => !(g.apelidos || []).includes(a));
      if (mesmoTel && faltamApelidos.length === 0) continue; // idêntico

      diferencas.push({
        chave,
        tipo: 'difere',
        proposta: { telefone: tel, apelidos: faltamApelidos },
      });
      continue;
    }

    // Entrada só existe no contatos.json atual.
    const comMesmoTel = pessoasComTelefone(pessoas, tel);

    let pendencia;
    if (comMesmoTel.length >= 1) {
      // Telefone de uma ou mais pessoas → decisão pendente.
      pendencia = {
        motivo: 'telefone_compartilhado',
        pessoas: comMesmoTel.map((p) => ({ id: p.id, nome: p.nome })),
        opcoes: [
          ...comMesmoTel.map((p) => ({
            tipo: 'apelido_de',
            pessoaId: p.id,
            rotulo: `apelido de ${p.nome}`,
          })),
          { tipo: 'pessoa_nova', rotulo: 'pessoa nova inativa com o mesmo telefone' },
        ],
      };
    } else if (problemasNome(chave).length > 0) {
      // Sem pessoa de mesmo telefone e nome com caractere inválido.
      pendencia = {
        motivo: 'caracteres',
        opcoes: [
          { tipo: 'renomear', rotulo: 'renomear' },
          { tipo: 'remover', rotulo: 'remover' },
        ],
      };
    }

    // Também pendência de caracteres quando o nome (chave) tem problema mesmo
    // com pessoa de mesmo telefone? O design trata caracteres separadamente;
    // aqui a pendência de telefone tem prioridade na entrada, e a de caracteres
    // é tratada ao criar/renomear. Mantemos a pendência de telefone acima.

    diferencas.push({
      chave,
      tipo: 'so_no_contatos',
      proposta: {
        telefone: tel,
        apelidos,
        // Sem pendência: vira pessoa nova inativa (telefone + apelidos).
        viraPessoaNova: !pendencia,
      },
      ...(pendencia ? { pendencia } : {}),
    });
  }

  return diferencas;
}

/**
 * Lista as pendências de caracteres no cadastro (nomes e apelidos de pessoas
 * fora dos Caracteres_de_Nome). Essas também precisam de decisão.
 *
 * @returns {Array<{ chave: string, motivo: 'caracteres', escopo, pessoaId, opcoes }>}
 */
export function pendenciasCaracteresCadastro(pessoasArquivo) {
  const pessoas = pessoasArquivo.pessoas || [];
  const pendencias = [];
  for (const p of pessoas) {
    if (problemasNome(p.nome).length > 0) {
      pendencias.push({
        chave: p.nome,
        motivo: 'caracteres',
        escopo: 'nome',
        pessoaId: p.id,
        opcoes: [
          { tipo: 'renomear', rotulo: 'renomear' },
          { tipo: 'remover', rotulo: 'remover' },
        ],
      });
    }
    for (const alias of p.aliases || []) {
      if (problemasNome(alias).length > 0) {
        pendencias.push({
          chave: alias,
          motivo: 'caracteres',
          escopo: 'apelido',
          pessoaId: p.id,
          opcoes: [
            { tipo: 'renomear', rotulo: 'renomear' },
            { tipo: 'remover', rotulo: 'remover' },
          ],
        });
      }
    }
  }
  return pendencias;
}

/** Todas as decisões pendentes (entradas do contatos + caracteres no cadastro). */
function coletarPendencias(contatosAtual, pessoasArquivo) {
  const pendentes = [];
  for (const d of diferencasContatos(contatosAtual, pessoasArquivo)) {
    if (d.pendencia) pendentes.push({ chave: d.chave, ...d.pendencia });
  }
  for (const c of pendenciasCaracteresCadastro(pessoasArquivo)) {
    pendentes.push(c);
  }
  return pendentes;
}

/** Hoje em AAAA-MM-DD. */
function hojeISO(agora = new Date()) {
  return agora.toISOString().slice(0, 10);
}

/**
 * Aplica a migração do contatos.json, incorporando cada entrada que só existe
 * no contatos.json conforme a decisão registrada (ou como pessoa inativa, sem
 * decisão necessária, quando nenhuma pessoa tem o telefone).
 *
 * Lança se houver pendência sem decisão.
 *
 * @param {{ pessoas: object[], grupos?: object, migracoes?: object, proximo_id?: number }} pessoasArquivo
 * @param {Record<string, object>} contatosAtual
 * @param {Record<string, { tipo: string, pessoaId?: number, novoNome?: string }>} decisoes
 *        indexado pela chave da entrada (ou nome/apelido com problema de caractere)
 * @param {{ agora?: Date }} [opts]
 * @returns {{ pessoas, grupos, migracoes, proximo_id, ... }} novo pessoasArquivo
 */
export function aplicarMigracaoContatos(pessoasArquivo, contatosAtual, decisoes = {}, opts = {}) {
  // Cópia profunda para não mutar a entrada.
  const arquivo = JSON.parse(JSON.stringify(pessoasArquivo));
  arquivo.pessoas = arquivo.pessoas || [];
  arquivo.grupos = arquivo.grupos || {};
  arquivo.migracoes = arquivo.migracoes || {};

  // Gate de grupos: a migração de contatos só roda depois da de grupos, para
  // que entradas cobertas por grupo (coberto_por_grupo) já estejam filtradas.
  if (!arquivo.migracoes.grupos_escalaveis && precisaMigracaoGrupos(arquivo, contatosAtual)) {
    throw new Error(
      'Aplique a migração de grupos antes da migração de contatos.',
    );
  }

  const pendencias = coletarPendencias(contatosAtual, arquivo);
  const semDecisao = pendencias.filter((p) => !decisoes[p.chave]);
  if (semDecisao.length > 0) {
    throw new Error(
      `Migração de contatos tem pendências sem decisão: ${semDecisao
        .map((p) => p.chave)
        .join(', ')}.`,
    );
  }

  const diferencas = diferencasContatos(contatosAtual, arquivo);

  let proximoId = Math.max(0, ...arquivo.pessoas.map((p) => p.id)) + 1;

  function novaPessoaInativa(nome, telefone, apelidos) {
    const pessoa = {
      id: proximoId,
      nome,
      aliases: Array.isArray(apelidos) ? [...apelidos] : [],
      telefone: digitos(telefone),
      genero: 'F',
      ativo: false,
      perfil_canto: null,
      notas: '',
      habilitacoes: {
        regente: false,
        equipe: false,
        mensagem_musical: { es: false, culto: false, domingo: false },
      },
      afastado: null,
      vinculos: [],
      dias_permitidos: null,
    };
    proximoId += 1;
    arquivo.pessoas.push(pessoa);
    return pessoa;
  }

  // 1) Entradas só no contatos.json.
  for (const d of diferencas) {
    if (d.tipo === 'difere') {
      // Acrescenta os apelidos que faltam à pessoa existente (chave = nome).
      const pessoa = arquivo.pessoas.find((p) => p.nome === d.chave);
      if (pessoa) {
        pessoa.aliases = [...new Set([...(pessoa.aliases || []), ...d.proposta.apelidos])];
      }
      continue;
    }
    if (d.tipo !== 'so_no_contatos') continue;

    const decisao = decisoes[d.chave];
    if (d.pendencia && d.pendencia.motivo === 'telefone_compartilhado') {
      if (decisao.tipo === 'apelido_de') {
        const alvo = arquivo.pessoas.find((p) => p.id === decisao.pessoaId);
        if (!alvo) throw new Error(`Pessoa ${decisao.pessoaId} não existe para "${d.chave}".`);
        alvo.aliases = [...new Set([...(alvo.aliases || []), d.chave])];
      } else if (decisao.tipo === 'pessoa_nova') {
        novaPessoaInativa(d.chave, d.proposta.telefone, d.proposta.apelidos);
      } else {
        throw new Error(`Decisão inválida para "${d.chave}": ${decisao.tipo}.`);
      }
    } else if (d.pendencia && d.pendencia.motivo === 'caracteres') {
      // Entrada sem pessoa de mesmo telefone e com caractere inválido.
      if (decisao.tipo === 'remover') {
        // Nada a incorporar.
      } else if (decisao.tipo === 'renomear') {
        const novoNome = decisao.novoNome;
        if (problemasNome(novoNome).length > 0) {
          throw new Error(`Novo nome inválido para "${d.chave}": "${novoNome}".`);
        }
        novaPessoaInativa(novoNome, d.proposta.telefone, d.proposta.apelidos);
      } else {
        throw new Error(`Decisão inválida para "${d.chave}": ${decisao.tipo}.`);
      }
    } else {
      // Sem pendência: pessoa nova inativa com telefone e apelidos.
      novaPessoaInativa(d.chave, d.proposta.telefone, d.proposta.apelidos);
    }
  }

  // 2) Pendências de caracteres no cadastro (nomes e apelidos existentes).
  for (const c of pendenciasCaracteresCadastro(pessoasArquivo)) {
    const decisao = decisoes[c.chave];
    const pessoa = arquivo.pessoas.find((p) => p.id === c.pessoaId);
    if (!pessoa) continue;
    if (c.escopo === 'nome') {
      if (decisao.tipo === 'renomear') {
        if (problemasNome(decisao.novoNome).length > 0) {
          throw new Error(`Novo nome inválido para "${c.chave}": "${decisao.novoNome}".`);
        }
        pessoa.nome = decisao.novoNome;
      } else if (decisao.tipo === 'remover') {
        // Não é possível "remover" o nome de uma pessoa; o design oferece
        // renomear ou remover a entrada. Para o nome, remover = renomear para
        // uma forma sem o caractere é a única ação segura; recusamos remover.
        throw new Error(`O nome "${c.chave}" não pode ser removido; renomeie.`);
      }
    } else if (c.escopo === 'apelido') {
      if (decisao.tipo === 'remover') {
        pessoa.aliases = (pessoa.aliases || []).filter((a) => a !== c.chave);
      } else if (decisao.tipo === 'renomear') {
        if (problemasNome(decisao.novoNome).length > 0) {
          throw new Error(`Novo apelido inválido para "${c.chave}": "${decisao.novoNome}".`);
        }
        pessoa.aliases = (pessoa.aliases || []).map((a) => (a === c.chave ? decisao.novoNome : a));
      }
    }
  }

  arquivo.proximo_id = Math.max(0, ...arquivo.pessoas.map((p) => p.id)) + 1;
  arquivo.migracoes = arquivo.migracoes || {};
  arquivo.migracoes.contatos_para_pessoas = hojeISO(opts.agora);

  return arquivo;
}

// ---------------------------------------------------------------------------
// Task 8: migração de grupos escaláveis (FAMILIA NILSINHO e MIN. JOVEM)
// ---------------------------------------------------------------------------

/** Grupos iniciais propostos pela migração (membros editáveis pelo usuário). */
const GRUPOS_INICIAIS = {
  familia_nilsinho: {
    escalavel: true,
    nome_exibicao: 'FAMILIA NILSINHO',
    membros_ids: [53, 32, 50, 45], // NILSINHO, JULIANA ALVES, MIRELLA, MARCELA
    responsavel_id: 53,
    modo: 'funcao',
    funcoes: ['mm'],
  },
  min_jovem: {
    escalavel: true,
    nome_exibicao: 'MIN. JOVEM',
    membros_ids: [21], // FABRICIO (o usuário completa os membros)
    responsavel_id: 21,
    modo: 'culto_inteiro',
    mensagem: null,
  },
};

/**
 * Proposta dos grupos iniciais, com os membros editáveis antes de aplicar.
 * @returns {Array<{ chave, nome_exibicao, membros_ids, responsavel_id, modo, funcoes, mensagem }>}
 */
export function propostaGrupos() {
  return Object.entries(GRUPOS_INICIAIS).map(([chave, def]) => ({ chave, ...def }));
}

/**
 * Aplica a migração de grupos: grava os grupos escaláveis confirmados e marca
 * migracoes.grupos_escalaveis. Idempotente.
 *
 * @param {object} pessoasArquivo
 * @param {Record<string, object>} [grupos] - grupos confirmados (chave → def),
 *        padrão GRUPOS_INICIAIS. Cada def aceita membros_ids editados.
 * @param {{ agora?: Date }} [opts]
 * @returns {object} novo pessoasArquivo
 */
export function aplicarMigracaoGrupos(pessoasArquivo, grupos = null, opts = {}) {
  const arquivo = JSON.parse(JSON.stringify(pessoasArquivo));
  arquivo.grupos = arquivo.grupos || {};
  arquivo.migracoes = arquivo.migracoes || {};

  const fonte = grupos || GRUPOS_INICIAIS;
  for (const [chave, def] of Object.entries(fonte)) {
    const base = GRUPOS_INICIAIS[chave] || {};
    arquivo.grupos[chave] = {
      ...(arquivo.grupos[chave] || {}),
      escalavel: true,
      nome_exibicao: def.nome_exibicao != null ? def.nome_exibicao : base.nome_exibicao,
      membros_ids: Array.isArray(def.membros_ids) ? def.membros_ids : base.membros_ids,
      responsavel_id: def.responsavel_id != null ? def.responsavel_id : base.responsavel_id,
      modo: def.modo != null ? def.modo : base.modo || 'funcao',
      ...(def.funcoes != null || base.funcoes != null
        ? { funcoes: def.funcoes != null ? def.funcoes : base.funcoes }
        : {}),
      ...(def.mensagem !== undefined || base.mensagem !== undefined
        ? { mensagem: def.mensagem !== undefined ? def.mensagem : base.mensagem }
        : {}),
    };
  }

  arquivo.migracoes.grupos_escalaveis = hojeISO(opts.agora);
  return arquivo;
}

/**
 * Indica se a migração de contatos ainda precisa que a de grupos rode antes,
 * isto é, há entradas no contatos.json que seriam cobertas por um dos grupos
 * iniciais (pelo nome_exibicao) mas o grupo ainda não existe.
 */
function precisaMigracaoGrupos(pessoasArquivo, contatosAtual) {
  const grupos = pessoasArquivo.grupos || {};
  const jaTem = new Set();
  for (const def of Object.values(grupos)) {
    if (def && def.escalavel === true && def.nome_exibicao) jaTem.add(def.nome_exibicao);
  }
  const atual = contatosAtual || {};
  for (const def of Object.values(GRUPOS_INICIAIS)) {
    if (atual[def.nome_exibicao] && !jaTem.has(def.nome_exibicao)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Task 7: migração das regras por nome (html-revisao/index.html → cadastro)
// ---------------------------------------------------------------------------

/**
 * Aplica as regras que hoje estão fixas por nome ao cadastro. Idempotente.
 * - ARIADNY e CATHERINE: dias_permitidos ["sabado"];
 * - MANU C.: precisa_de SILVANA;
 * - MANU S.: precisa_de JESSICA ou JOAS;
 * - MIRELLA e MARCELA: precisa_de NILSINHO.
 * Marca migracoes.regras_por_nome.
 *
 * @param {object} pessoasArquivo
 * @param {{ agora?: Date }} [opts]
 * @returns {object} novo pessoasArquivo
 */
export function migrarRegrasPorNome(pessoasArquivo, opts = {}) {
  const arquivo = JSON.parse(JSON.stringify(pessoasArquivo));
  arquivo.pessoas = arquivo.pessoas || [];
  arquivo.migracoes = arquivo.migracoes || {};

  const porNome = new Map();
  for (const p of arquivo.pessoas) porNome.set(p.nome, p);

  function idDe(nome) {
    const p = porNome.get(nome);
    return p ? p.id : null;
  }

  function garantirDiaSabado(nome) {
    const p = porNome.get(nome);
    if (!p) return;
    const dias = Array.isArray(p.dias_permitidos) ? p.dias_permitidos : [];
    if (!dias.includes('sabado')) {
      p.dias_permitidos = ['sabado'];
    } else if (!Array.isArray(p.dias_permitidos)) {
      p.dias_permitidos = ['sabado'];
    }
  }

  function garantirPrecisaDe(nome, idsAlvo) {
    const p = porNome.get(nome);
    if (!p) return;
    const ids = idsAlvo.filter((x) => x != null);
    if (ids.length === 0) return;
    p.vinculos = Array.isArray(p.vinculos) ? p.vinculos : [];
    const existente = p.vinculos.find((v) => v.tipo === 'precisa_de');
    if (existente) {
      // Idempotente: só adiciona os que faltam.
      const set = new Set(existente.com_ids || []);
      for (const id of ids) set.add(id);
      existente.com_ids = [...set];
    } else {
      p.vinculos.push({ tipo: 'precisa_de', com_ids: ids });
    }
  }

  garantirDiaSabado('ARIADNY');
  garantirDiaSabado('CATHERINE');
  garantirPrecisaDe('MANU C.', [idDe('SILVANA')]);
  garantirPrecisaDe('MANU S.', [idDe('JESSICA'), idDe('JOAS')]);
  garantirPrecisaDe('MIRELLA', [idDe('NILSINHO')]);
  garantirPrecisaDe('MARCELA', [idDe('NILSINHO')]);

  arquivo.migracoes.regras_por_nome = hojeISO(opts.agora);
  return arquivo;
}

/**
 * Indica se a migração das regras por nome ainda tem efeito a aplicar (isto é,
 * aplicá-la mudaria o cadastro). Serve para surfacá-la como pendente até ser
 * marcada em migracoes.regras_por_nome.
 */
function precisaMigracaoRegras(pessoasArquivo) {
  const migracoes = (pessoasArquivo && pessoasArquivo.migracoes) || {};
  if (migracoes.regras_por_nome) return false;
  const depois = migrarRegrasPorNome(pessoasArquivo);
  const antes = pessoasArquivo.pessoas || [];
  const porNomeDepois = new Map();
  for (const p of depois.pessoas) porNomeDepois.set(p.nome, p);

  // Compara dias_permitidos e precisa_de das pessoas afetadas.
  for (const p of antes) {
    const d = porNomeDepois.get(p.nome);
    if (!d) continue;
    const diasAntes = JSON.stringify(p.dias_permitidos || null);
    const diasDepois = JSON.stringify(d.dias_permitidos || null);
    if (diasAntes !== diasDepois) return true;
    const pdAntes = (p.vinculos || []).find((v) => v.tipo === 'precisa_de');
    const pdDepois = (d.vinculos || []).find((v) => v.tipo === 'precisa_de');
    const a = pdAntes ? [...(pdAntes.com_ids || [])].sort() : [];
    const b = pdDepois ? [...(pdDepois.com_ids || [])].sort() : [];
    if (JSON.stringify(a) !== JSON.stringify(b)) return true;
  }
  return false;
}

/** Nome das migrações ainda pendentes (não registradas em migracoes). */
export function migracoesPendentes(pessoasArquivo, contatosAtual) {
  const migracoes = (pessoasArquivo && pessoasArquivo.migracoes) || {};
  const pendentes = [];

  // Grupos: pendente se há entrada do contatos coberta por um grupo inicial
  // e a migração ainda não foi marcada.
  if (!migracoes.grupos_escalaveis && precisaMigracaoGrupos(pessoasArquivo, contatosAtual || {})) {
    pendentes.push('grupos_escalaveis');
  }

  if (!migracoes.contatos_para_pessoas) {
    // Só é pendência se houver alguma diferença real.
    const diffs = diferencasContatos(contatosAtual || {}, pessoasArquivo).filter(
      (d) => d.tipo !== 'coberto_por_grupo',
    );
    const temCaracteres = pendenciasCaracteresCadastro(pessoasArquivo).length > 0;
    if (diffs.length > 0 || temCaracteres) pendentes.push('contatos_para_pessoas');
  }

  // Regras por nome: pendente enquanto não marcada e ainda houver efeito a
  // aplicar (dias_permitidos de sábado e precisa_de das pessoas conhecidas).
  if (precisaMigracaoRegras(pessoasArquivo)) {
    pendentes.push('regras_por_nome');
  }

  return pendentes;
}

export { normalizar };
