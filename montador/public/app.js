// Interface do Montador de Escala. Conversa com a API (server.mjs) que
// reaproveita as regras do projeto. Nenhuma regra e reimplementada aqui: a
// elegibilidade por celula, a sugestao e a validacao vem do servidor.

import { filtrarPessoas, datasVisiveis } from './modulos/filtro.js';
import { chaveRascunho, serializarRascunho, desserializarRascunho, assinatura } from './modulos/rascunho.js';
import { calcularProgresso } from './modulos/progresso.js';
import { chaveEnviados, marcarEnviado, separar } from './modulos/enviados.js';

const estado = {
  mes: null,
  // CultoMontagem por ID: { data, dia_semana, tipo, slots, modelo_louvor,
  // extraordinario, anciao, pregador, audiovisual, suporte, sonoplastiaIds,
  // obs, acomp, regente:id|null, equipe:[id], mm:{slot:ocupante}, assumidoPor,
  // excedentes:[] }
  cultos: [],
  pessoasPorId: new Map(),
  gruposPorChave: {},
  seletorAlvo: null, // { idx, def }
  // Avisos das atribuições escolhidas "com aviso", por culto: Map<data, Map<chaveOcupante, textos[]>>.
  // Mantém o aviso visível no card mesmo antes de uma revalidação (RF 16.11).
  avisosEscolha: new Map(),
  filtro: { dias: new Set(), data: null, extraordinarios: false },
  // Ocupantes do rascunho recuperado que não existem no cadastro atual
  // (RF 19.4): chaves canônicas de ocupante marcadas "fora do cadastro".
  foraDoCadastro: new Set(),
  // Revalidação antes do envio (Task 29): último resultado e ciências marcadas
  // (ids de aviso). O botão "Enviar" só habilita sem erros e com todas as
  // ciências (RF 21.6, 21.7).
  ultimaRevalidacao: null,
  ciencias: new Set(),
  // Exceções confirmadas pelo diretor: ids de bloqueio de regra que ele decidiu
  // violar de propósito (ex.: pessoa só de sábado num domingo). Sobrevivem a
  // mudanças na escala; quando o bloqueio some, a exceção some junto.
  excecoes: new Set(),
};

/** Chave do localStorage das exceções confirmadas do mês. */
function chaveExcecoes(mes) {
  return `${chaveRascunho(mes)}:excecoes`;
}

/** Lê as exceções confirmadas do mês (Set de ids). */
function lerExcecoes(mes) {
  try {
    const texto = localStorage.getItem(chaveExcecoes(mes));
    const lista = texto ? JSON.parse(texto) : [];
    return new Set(Array.isArray(lista) ? lista : []);
  } catch {
    return new Set();
  }
}

/** Grava as exceções confirmadas do mês. */
function salvarExcecoes() {
  if (!estado.mes) return;
  try {
    localStorage.setItem(chaveExcecoes(estado.mes), JSON.stringify([...estado.excecoes]));
  } catch {
    /* sem storage: as exceções valem só nesta sessão */
  }
}

/** Erros que ainda impedem o envio (sem exceção confirmada). */
function errosPendentes(erros, excecoes) {
  return (erros || []).filter((e) => !(e && e.excecionavel === true && excecoes.has(e.id)));
}

// ---------------------------------------------------------------------------
// Rascunho automático por ID no localStorage (Task 24 / RF 19)
// ---------------------------------------------------------------------------

/**
 * Salva o Rascunho do mês no localStorage, com pessoas e grupos por ID, acomp,
 * obs, assumidoPor e excedentes (serializarRascunho). Chamada a cada mudança:
 * atribuição, Banda/PB e OBS (RF 19.1). Silenciosa em caso de erro de storage.
 */
function salvarRascunho() {
  if (!estado.mes) return;
  try {
    const texto = serializarRascunho(estado.mes, estado.cultos);
    localStorage.setItem(chaveRascunho(estado.mes), texto);
  } catch {
    /* localStorage indisponível (modo privado / cota): não bloqueia a edição */
  }
  // Toda mudança (atribuição, Banda/PB, OBS) passa por aqui: recalcula o
  // progresso e o indicador "não sincronizado" (RF 19.8, 20.1-20.3).
  atualizarProgressoEIndicador();
  // Qualquer mudança invalida a última revalidação de envio: é preciso
  // revalidar de novo antes de enviar (RF 21.6, 21.7).
  invalidarRevalidacao();
}

/**
 * Descarta o último resultado da revalidação e as ciências, esconde o painel e
 * desabilita o botão "Enviar". Chamado a cada mudança na escala.
 */
function invalidarRevalidacao() {
  estado.ultimaRevalidacao = null;
  estado.ciencias = new Set();
  const painel = el('painelRevalidacao');
  if (painel) {
    painel.hidden = true;
    painel.innerHTML = '';
  }
  atualizarBotaoEnviar();
}

// ---------------------------------------------------------------------------
// Progresso visual e indicador "não sincronizado" (Task 25 / RF 19.8, 20)
// ---------------------------------------------------------------------------

/**
 * Monta a escala publicada (atual.json por ID) como CultoMontagem casados por
 * data com os cultos secos da API, para comparar a assinatura com o estado
 * atual. Sem publicada, devolve [] (toda atribuição acende o indicador).
 */
function cultosDaPublicada() {
  const publicadaPorData = new Map((estado.publicada || []).map((c) => [c.data, c]));
  return (estado.dadosCultos || []).map((c) => {
    const base = cultoVazioDaApi(c);
    const pub = publicadaPorData.get(c.data);
    if (!pub) return base;
    return {
      ...base,
      acomp: pub.acomp || base.acomp,
      obs: pub.obs != null ? pub.obs : base.obs,
      regente: pub.regente ?? null,
      equipe: Array.isArray(pub.equipe) ? pub.equipe.slice() : [],
      mm: pub.mm ? { ...pub.mm } : {},
      assumidoPor: pub.assumidoPor || null,
      excedentes: Array.isArray(pub.excedentes) ? pub.excedentes.slice() : [],
    };
  });
}

/**
 * Recalcula a barra de progresso, os contadores e o indicador "não
 * sincronizado" a partir de `estado.cultos` e `estado.publicada`. Esmaece os
 * cards completos. Idempotente; só mexe no DOM, nunca na escala.
 */
function atualizarProgressoEIndicador() {
  const barra = el('barraProgresso');
  if (!barra) return;
  if (!estado.mes || !estado.cultos || estado.cultos.length === 0) {
    barra.hidden = true;
    return;
  }
  barra.hidden = false;

  const prog = calcularProgresso(estado.cultos, { tamanhoEquipe: 5 });
  const pct = prog.total > 0 ? Math.round((prog.preenchidas / prog.total) * 100) : 0;
  const preenchida = el('progressoBarra');
  if (preenchida) preenchida.style.width = `${pct}%`;
  const contador = el('progressoContador');
  if (contador) {
    contador.textContent = `${prog.preenchidas} de ${prog.total} funções`;
    if (prog.total > 0 && prog.preenchidas >= prog.total) contador.classList.add('completo');
    else contador.classList.remove('completo');
  }

  // Esmaece os cards de culto completos (RF 20.3).
  const grade = el('gradeMontagem');
  if (grade) {
    for (const card of grade.querySelectorAll('.culto-card')) {
      if (prog.completos.has(card.dataset.data)) card.classList.add('completo');
      else card.classList.remove('completo');
    }
  }

  // Indicador "não sincronizado": acende se e somente se a assinatura do estado
  // difere da assinatura da escala publicada (RF 19.8). Sem publicada, a base é
  // a escala vazia, então qualquer atribuição já acende o indicador.
  const indicador = el('indicadorSync');
  if (indicador) {
    indicador.hidden = assinatura(estado.cultos) === assinatura(cultosDaPublicada());
  }
}

/** Lê o texto do Rascunho de um mês no localStorage (ou null). */
function lerRascunho(mes) {
  try {
    return localStorage.getItem(chaveRascunho(mes));
  } catch {
    return null;
  }
}

/** Apaga o Rascunho de um mês do localStorage. */
function apagarRascunho(mes) {
  try {
    localStorage.removeItem(chaveRascunho(mes));
    localStorage.removeItem(chaveExcecoes(mes));
    if (estado.mes === mes) estado.excecoes = new Set();
  } catch {
    /* sem storage: nada a apagar */
  }
}

/** Chave estável de um ocupante (ID de pessoa ou 'grupo:<chave>'). */
function chaveOcupante(ocupante) {
  return String(ocupante);
}

/** Registra os avisos de uma escolha "com aviso" para um culto (RF 16.11). */
function registrarAvisosEscolha(data, ocupante, avisos) {
  if (!Array.isArray(avisos) || avisos.length === 0) {
    limparAvisosEscolha(data, ocupante);
    return;
  }
  let porCulto = estado.avisosEscolha.get(data);
  if (!porCulto) {
    porCulto = new Map();
    estado.avisosEscolha.set(data, porCulto);
  }
  porCulto.set(chaveOcupante(ocupante), avisos.slice());
}

/** Remove os avisos registrados de um ocupante num culto. */
function limparAvisosEscolha(data, ocupante) {
  const porCulto = estado.avisosEscolha.get(data);
  if (!porCulto) return;
  porCulto.delete(chaveOcupante(ocupante));
  if (porCulto.size === 0) estado.avisosEscolha.delete(data);
}

const el = (id) => document.getElementById(id);

const DIAS_LABEL = {
  'quarta-feira': 'Quarta-feira',
  sabado: 'Sábado',
  domingo: 'Domingo',
  'sexta-feira': 'Sexta-feira',
  'segunda-feira': 'Segunda-feira',
  'terca-feira': 'Terça-feira',
  'quinta-feira': 'Quinta-feira',
};

/** Nome de um ocupante (ID de pessoa ou 'grupo:<chave>') para exibição. */
function nomeOcupante(ocupante) {
  if (ocupante == null || ocupante === '') return '';
  if (typeof ocupante === 'string' && ocupante.startsWith('grupo:')) {
    const g = estado.gruposPorChave[ocupante.slice('grupo:'.length)];
    return g ? g.nome_exibicao : ocupante;
  }
  const p = estado.pessoasPorId.get(ocupante);
  return p ? p.nome : String(ocupante);
}

/** Diz se um ocupante não existe no cadastro atual (pessoa ou grupo). */
function ocupanteForaDoCadastro(ocupante) {
  if (ocupante == null || ocupante === '') return false;
  if (typeof ocupante === 'string' && ocupante.startsWith('grupo:')) {
    return !estado.gruposPorChave[ocupante.slice('grupo:'.length)];
  }
  return !estado.pessoasPorId.has(ocupante);
}

function mostrarOverlay(texto) {
  el('overlayTexto').textContent = texto || 'Carregando...';
  el('overlay').hidden = false;
}
function esconderOverlay() {
  el('overlay').hidden = true;
}

function setStatus(texto, tipo) {
  const badge = el('statusBadge');
  badge.textContent = texto || '';
  badge.className = 'status-badge' + (tipo ? ` ${tipo}` : '');
}

async function api(caminho, opcoes) {
  const resp = await fetch(caminho, opcoes);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error(data.erro || `Erro ${resp.status}`);
    err.payload = data;
    throw err;
  }
  return data;
}

function brData(iso) {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

const SLOT_LABEL = {
  regente: 'Regente',
  equipe: 'Equipe de louvor (5)',
  mm_es: 'Mensagem musical — ES',
  mm_culto: 'Mensagem musical — Culto',
  mm_domingo: 'Mensagem musical',
};

/** Definições de linha (slots) de um culto, a partir de culto.slots da API. */
function definicoesDoCulto(culto) {
  const slots = Array.isArray(culto.slots) ? culto.slots : [];
  return slots.map((slot) => {
    if (slot === 'equipe') {
      return { slot, label: SLOT_LABEL[slot] || slot, campo: 'equipe', max: 5 };
    }
    if (slot === 'regente') {
      return { slot, label: SLOT_LABEL[slot] || slot, campo: 'regente', unico: true };
    }
    // mm_*
    return { slot, label: SLOT_LABEL[slot] || slot, campo: 'mm', slotMm: slot, unico: true };
  });
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function render() {
  const grade = el('gradeMontagem');
  grade.innerHTML = '';
  const visiveis = datasVisiveis(estado.cultos, estado.filtro);
  estado.cultos.forEach((culto, idx) => {
    const card = renderCulto(culto, idx);
    if (!visiveis.has(culto.data)) card.hidden = true; // oculta sem tirar do estado
    grade.appendChild(card);
  });
  // Cards recriados: reaplica o esmaecido dos completos e atualiza a barra e o
  // indicador (filtrar não altera a escala, só o que é mostrado).
  atualizarProgressoEIndicador();
}

// Timers de debounce da validação de OBS por elemento de problemas.
const obsDebounce = new WeakMap();

/**
 * Valida a Observação pública de um card contra os termos proibidos e "<"/">"
 * (RF 15.9), chamando POST /api/texto-publico. Debounce de 300 ms por padrão;
 * `imediato` dispara sem atraso (ex.: valor inicial). Os problemas aparecem no
 * próprio card; sem problemas, a área fica oculta.
 *
 * @param {string} texto
 * @param {HTMLElement} alvo - div de problemas do card
 * @param {{ imediato?: boolean }} [opts]
 */
function validarObsCard(texto, alvo, { imediato = false } = {}) {
  const anterior = obsDebounce.get(alvo);
  if (anterior) clearTimeout(anterior);

  const executar = async () => {
    try {
      const { problemas } = await api('/api/texto-publico', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tipo: 'obs', texto }),
      });
      if ((problemas || []).length === 0) {
        alvo.hidden = true;
        alvo.innerHTML = '';
        return;
      }
      alvo.hidden = false;
      alvo.innerHTML = problemas
        .map((p) => `<span class="culto-obs-problema">⚠️ ${p}</span>`)
        .join('');
    } catch {
      // Falha de rede não deve travar a edição; a revalidação final cobre o caso.
      alvo.hidden = true;
      alvo.innerHTML = '';
    }
  };

  if (imediato) {
    // Texto vazio não precisa ir ao servidor: sem problema.
    if (!texto) {
      alvo.hidden = true;
      alvo.innerHTML = '';
      return;
    }
    executar();
    return;
  }
  obsDebounce.set(alvo, setTimeout(executar, 300));
}

function renderCulto(culto, idx) {
  const card = document.createElement('div');
  const ehSabado = (culto.modelo_louvor || culto.dia_semana) === 'sabado';
  card.className =
    'culto-card' + (culto.tipo === 'quarta' || culto.tipo === 'sem_louvor' ? ' quarta' : '') + (ehSabado ? ' sabado' : '');
  card.dataset.data = culto.data;

  const head = document.createElement('div');
  head.className = 'culto-head';
  const extra = culto.extraordinario ? ' <span class="badge-extra">extraordinário</span>' : '';
  head.innerHTML = `
    <div>
      <div class="culto-dia">${DIAS_LABEL[culto.dia_semana] || culto.dia_semana}${extra}</div>
      <div class="culto-data">${brData(culto.data)}</div>
    </div>
    <div class="culto-externo">
      ${culto.anciao ? `Ancião: <b>${culto.anciao}</b>` : ''}
      ${culto.pregador ? ` &nbsp;·&nbsp; Pregador: <b>${culto.pregador}</b>` : ''}
    </div>`;
  card.appendChild(head);

  // Linha de sonoplastia (somente leitura).
  const son = document.createElement('div');
  son.className = 'culto-sonoplastia';
  son.innerHTML = `Sonoplasta: <b>${culto.audiovisual || '-'}</b> &nbsp;·&nbsp; Suporte: <b>${culto.suporte || '-'}</b>`;
  card.appendChild(son);

  if (culto.tipo !== 'louvor') {
    const p = document.createElement('p');
    p.className = 'vazio';
    p.textContent =
      culto.tipo === 'departamental'
        ? `Louvor pelo departamento: ${culto.pregador}.`
        : 'Este culto não tem escala própria de louvor.';
    card.appendChild(p);
    return card;
  }

  // Seletor Banda/PB.
  const acompRow = document.createElement('div');
  acompRow.className = 'culto-acomp';
  acompRow.innerHTML = '<span class="culto-acomp-label">Acompanhamento:</span>';
  const sel = document.createElement('select');
  sel.className = 'acomp-select';
  for (const opt of ['BANDA', 'PB']) {
    const o = document.createElement('option');
    o.value = opt;
    o.textContent = opt;
    if ((culto.acomp || '') === opt) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => {
    estado.cultos[idx].acomp = sel.value;
    salvarRascunho();
  });
  acompRow.appendChild(sel);
  card.appendChild(acompRow);

  // Observação pública do culto (pré-preenchida com o acionato).
  const obsRow = document.createElement('div');
  obsRow.className = 'culto-obs';
  const obsLabel = document.createElement('label');
  obsLabel.className = 'culto-obs-label';
  obsLabel.textContent = 'Observação';
  const obsInput = document.createElement('textarea');
  obsInput.className = 'culto-obs-input';
  obsInput.rows = 2;
  obsInput.placeholder = PLACEHOLDER_OBS;
  obsInput.value = culto.obs || '';
  // Área de problemas da OBS (texto público): validação na hora pela rota
  // /api/texto-publico com atraso de 300 ms (RF 15.9).
  const obsProblemas = document.createElement('div');
  obsProblemas.className = 'culto-obs-problemas';
  obsProblemas.hidden = true;
  obsInput.addEventListener('input', () => {
    estado.cultos[idx].obs = obsInput.value;
    salvarRascunho();
    validarObsCard(obsInput.value, obsProblemas);
  });
  obsRow.appendChild(obsLabel);
  obsRow.appendChild(obsInput);
  obsRow.appendChild(obsProblemas);
  card.appendChild(obsRow);
  // Valida o valor inicial (vindo do acionato/rascunho) sem atraso.
  validarObsCard(culto.obs || '', obsProblemas, { imediato: true });

  if (culto.assumidoPor) {
    // Um Grupo_Escalavel (modo culto_inteiro) assumiu o culto: no lugar de
    // regente, equipe e MM, mostramos o grupo e a ação de desfazer (RF 6.13).
    card.appendChild(renderCultoAssumido(culto, idx));
  } else {
    const linhas = document.createElement('div');
    linhas.className = 'linhas';
    for (const def of definicoesDoCulto(culto)) {
      linhas.appendChild(renderLinha(culto, idx, def));
    }
    card.appendChild(linhas);

    // "Grupo assume o culto": só quando há Grupo_Escalavel culto_inteiro (RF 6.13).
    const assumiveis = gruposCultoInteiro();
    if (assumiveis.length > 0) {
      card.appendChild(renderAssumirCulto(culto, idx, assumiveis));
    }
  }

  // Excedentes: nomes lidos de atual.json além das vagas do modelo (RF 29.9).
  // Cada um pode ser removido ou movido para uma vaga livre do culto.
  if ((culto.excedentes || []).length > 0) {
    card.appendChild(renderExcedentes(culto, idx));
  }

  // Avisos deste culto: da última validação e das escolhas "com aviso"
  // aplicadas no card (estas aparecem na hora, sem precisar revalidar — RF 16.11).
  const textosAviso = [];
  const vistos = new Set();
  const adicionar = (texto) => {
    const t = (texto || '').trim();
    if (!t || vistos.has(t)) return;
    vistos.add(t);
    textosAviso.push(t);
  };
  (estado.ultimaValidacao?.avisos || [])
    .filter((m) => m && m.data === culto.data)
    .forEach((m) => adicionar(m.texto));
  const avisosEscolhaCulto = estado.avisosEscolha.get(culto.data);
  if (avisosEscolhaCulto) {
    for (const textos of avisosEscolhaCulto.values()) {
      (textos || []).forEach(adicionar);
    }
  }
  for (const texto of textosAviso) {
    const div = document.createElement('div');
    div.className = 'culto-aviso';
    div.innerHTML = `<span>⚠️</span><span>${texto}</span>`;
    card.appendChild(div);
  }

  return card;
}

/** Ocupantes atuais de uma linha (array de ocupantes id/'grupo:<chave>'). */
function ocupantesDaLinha(culto, def) {
  if (def.campo === 'regente') return culto.regente != null && culto.regente !== '' ? [culto.regente] : [];
  if (def.campo === 'equipe') return culto.equipe || [];
  if (def.campo === 'mm') {
    const oc = (culto.mm || {})[def.slotMm];
    return oc != null && oc !== '' ? [oc] : [];
  }
  return [];
}

function renderLinha(culto, idx, def) {
  const linha = document.createElement('div');
  const classe = def.campo === 'regente' ? 'regente' : def.campo === 'equipe' ? 'equipe' : 'mm';
  linha.className = `linha ${classe}`;

  const label = document.createElement('div');
  label.className = 'linha-label';
  label.textContent = def.label;
  linha.appendChild(label);

  const chips = document.createElement('div');
  chips.className = 'chips';

  const valores = ocupantesDaLinha(culto, def);
  for (const ocupante of valores) {
    const chip = document.createElement('span');
    const fora = ocupanteForaDoCadastro(ocupante);
    chip.className = 'chip' + (fora ? ' fora-cadastro' : '');
    // Clique no nome abre substitutos; o × remove.
    const marcaFora = fora ? '<span class="chip-fora" title="Esta atribuição não existe no cadastro atual">fora do cadastro</span>' : '';
    chip.innerHTML = `<span class="chip-nome">${nomeOcupante(ocupante)}</span>${marcaFora}<button class="remover" title="Remover">&times;</button>`;
    chip.querySelector('.remover').addEventListener('click', (e) => {
      e.stopPropagation();
      removerOcupante(idx, def, ocupante);
    });
    chip.querySelector('.chip-nome').addEventListener('click', () => abrirSeletor(idx, def, ocupante));
    chips.appendChild(chip);
  }

  const cheia = def.unico ? valores.length >= 1 : valores.length >= (def.max || 99);
  if (cheia) linha.classList.add('cheia');

  const add = document.createElement('button');
  add.className = 'btn-add';
  add.textContent = def.unico ? '+ escolher' : '+ adicionar';
  add.addEventListener('click', () => abrirSeletor(idx, def, null));
  chips.appendChild(add);

  linha.appendChild(chips);
  return linha;
}

/** Rótulo do campo de origem de um excedente (REGENTE LOUVOR etc.). */
const EXCEDENTE_CAMPO_LABEL = {
  'REGENTE LOUVOR': 'Regente',
  'EQUIPE LOUVOR': 'Equipe',
  'MENSAGEM MUSICAL': 'Mensagem musical',
};

/**
 * Lista os nomes excedentes de um culto (mais nomes do que vagas no modelo),
 * com ação "remover" e "mover para vaga" (RF 29.9). O excedente nunca é
 * descartado em silêncio: ele fica visível até o usuário resolvê-lo.
 */
function renderExcedentes(culto, idx) {
  const bloco = document.createElement('div');
  bloco.className = 'culto-excedentes';
  const titulo = document.createElement('div');
  titulo.className = 'culto-excedentes-titulo';
  titulo.innerHTML = '⚠️ Nomes além das vagas (resolva antes de publicar):';
  bloco.appendChild(titulo);

  (culto.excedentes || []).forEach((exc, i) => {
    const linha = document.createElement('div');
    linha.className = 'excedente-linha';
    const nome = exc.nome != null ? exc.nome : nomeOcupante(exc.ocupante);
    const campo = EXCEDENTE_CAMPO_LABEL[exc.campo] || exc.campo || '';
    const fora = exc.ocupante != null && ocupanteForaDoCadastro(exc.ocupante);
    const marcaFora = fora ? ' <span class="chip-fora">fora do cadastro</span>' : '';
    linha.innerHTML = `<span class="excedente-nome">${nome}</span>`
      + `<span class="excedente-origem">${campo}${marcaFora}</span>`;

    const vagas = vagasLivresDoCulto(culto);
    const sel = document.createElement('select');
    sel.className = 'campo-input excedente-mover';
    const vazia = document.createElement('option');
    vazia.value = '';
    vazia.textContent = 'mover para vaga…';
    sel.appendChild(vazia);
    for (const v of vagas) {
      const o = document.createElement('option');
      o.value = v.slot;
      o.textContent = v.label;
      sel.appendChild(o);
    }
    sel.disabled = exc.ocupante == null || vagas.length === 0;
    sel.addEventListener('change', () => {
      if (sel.value) moverExcedenteParaVaga(idx, i, sel.value);
    });
    linha.appendChild(sel);

    const btnRemover = document.createElement('button');
    btnRemover.className = 'control-btn danger-link';
    btnRemover.textContent = 'remover';
    btnRemover.addEventListener('click', () => removerExcedente(idx, i));
    linha.appendChild(btnRemover);

    bloco.appendChild(linha);
  });
  return bloco;
}

/** Vagas de slot ainda livres num culto (para mover um excedente). */
function vagasLivresDoCulto(culto) {
  const livres = [];
  for (const def of definicoesDoCulto(culto)) {
    const ocupados = ocupantesDaLinha(culto, def);
    if (def.campo === 'equipe') {
      if (ocupados.length < (def.max || 5)) livres.push({ slot: def.slot, label: def.label });
    } else if (ocupados.length === 0) {
      livres.push({ slot: def.slot, label: def.label });
    }
  }
  return livres;
}

/** Remove um excedente do culto (o usuário decidiu descartá-lo). */
function removerExcedente(idx, i) {
  const culto = estado.cultos[idx];
  culto.excedentes = (culto.excedentes || []).filter((_, j) => j !== i);
  render();
  salvarRascunho();
}

/** Move um excedente para uma vaga livre do culto, tirando-o da lista. */
function moverExcedenteParaVaga(idx, excIdx, slot) {
  const culto = estado.cultos[idx];
  const exc = (culto.excedentes || [])[excIdx];
  if (!exc || exc.ocupante == null) return;
  const def = definicoesDoCulto(culto).find((d) => d.slot === slot);
  if (!def) return;
  culto.excedentes = culto.excedentes.filter((_, j) => j !== excIdx);
  // Aplica o ocupante na vaga escolhida (reusa a lógica de atribuição).
  aplicarOcupante(idx, def, exc.ocupante, null, []);
}

// ---------------------------------------------------------------------------
// Grupo assume o culto (Grupo_Escalavel modo culto_inteiro) — RF 6.13
// ---------------------------------------------------------------------------

/** Grupos escaláveis do cadastro no modo culto_inteiro. */
function gruposCultoInteiro() {
  return Object.values(estado.gruposPorChave || {}).filter((g) => g && g.modo === 'culto_inteiro');
}

/**
 * Bloco mostrado quando um grupo assumiu o culto: nome do grupo no lugar de
 * regente, equipe e MM, e o botão "desfazer" (limpa `assumidoPor`).
 */
function renderCultoAssumido(culto, idx) {
  const bloco = document.createElement('div');
  bloco.className = 'culto-assumido';
  const nome = nomeOcupante(culto.assumidoPor);
  bloco.innerHTML = `<div class="culto-assumido-info">`
    + `<span class="culto-assumido-rotulo">Grupo assume o culto</span>`
    + `<span class="culto-assumido-nome">${nome}</span>`
    + `<span class="culto-assumido-sub">cobre regente, equipe e mensagem musical</span>`
    + `</div>`;
  const btn = document.createElement('button');
  btn.className = 'control-btn danger-link';
  btn.textContent = 'desfazer';
  btn.addEventListener('click', () => desfazerAssumir(idx));
  bloco.appendChild(btn);
  return bloco;
}

/**
 * Controle "Grupo assume o culto" (quando há grupo culto_inteiro). Com um só
 * grupo, um botão direto; com vários, um seletor.
 */
function renderAssumirCulto(culto, idx, grupos) {
  const bloco = document.createElement('div');
  bloco.className = 'culto-assumir';
  if (grupos.length === 1) {
    const g = grupos[0];
    const btn = document.createElement('button');
    btn.className = 'control-btn';
    btn.textContent = `Grupo assume o culto (${g.nome_exibicao})`;
    btn.addEventListener('click', () => assumirCulto(idx, g.chave));
    bloco.appendChild(btn);
  } else {
    const label = document.createElement('span');
    label.className = 'culto-assumir-label';
    label.textContent = 'Grupo assume o culto:';
    bloco.appendChild(label);
    const sel = document.createElement('select');
    sel.className = 'campo-input';
    const vazia = document.createElement('option');
    vazia.value = '';
    vazia.textContent = 'escolher grupo…';
    sel.appendChild(vazia);
    for (const g of grupos) {
      const o = document.createElement('option');
      o.value = g.chave;
      o.textContent = g.nome_exibicao;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => {
      if (sel.value) assumirCulto(idx, sel.value);
    });
    bloco.appendChild(sel);
  }
  return bloco;
}

/**
 * Faz um grupo culto_inteiro assumir o culto: grava `assumidoPor` e limpa as
 * atribuições individuais (regente, equipe, MM) para não conflitar.
 */
function assumirCulto(idx, chave) {
  const culto = estado.cultos[idx];
  // Limpa avisos de escolha dos ocupantes atuais antes de substituí-los.
  if (culto.regente != null && culto.regente !== '') limparAvisosEscolha(culto.data, culto.regente);
  (culto.equipe || []).forEach((o) => limparAvisosEscolha(culto.data, o));
  Object.values(culto.mm || {}).forEach((o) => {
    if (o != null && o !== '') limparAvisosEscolha(culto.data, o);
  });
  culto.regente = null;
  culto.equipe = [];
  culto.mm = {};
  culto.assumidoPor = `grupo:${chave}`;
  render();
  atualizarParticipacao();
  salvarRascunho();
}

/** Desfaz o "Grupo assume o culto": limpa `assumidoPor`. */
function desfazerAssumir(idx) {
  const culto = estado.cultos[idx];
  if (culto.assumidoPor) limparAvisosEscolha(culto.data, culto.assumidoPor);
  culto.assumidoPor = null;
  render();
  atualizarParticipacao();
  salvarRascunho();
}

// ---------------------------------------------------------------------------
// Edição de atribuições (por ID / 'grupo:<chave>')
// ---------------------------------------------------------------------------

function mesmoOcupante(a, b) {
  return String(a) === String(b);
}

function removerOcupante(idx, def, ocupante) {
  const culto = estado.cultos[idx];
  if (def.campo === 'regente') culto.regente = null;
  else if (def.campo === 'equipe') {
    culto.equipe = (culto.equipe || []).filter((o) => !mesmoOcupante(o, ocupante));
  } else if (def.campo === 'mm') {
    culto.mm = culto.mm || {};
    delete culto.mm[def.slotMm];
  }
  limparAvisosEscolha(culto.data, ocupante);
  render();
  atualizarParticipacao();
  salvarRascunho();
}

function aplicarOcupante(idx, def, ocupante, substituindo, avisos) {
  const culto = estado.cultos[idx];
  if (def.campo === 'regente') {
    if (culto.regente != null && culto.regente !== '') limparAvisosEscolha(culto.data, culto.regente);
    culto.regente = ocupante;
  } else if (def.campo === 'equipe') {
    culto.equipe = culto.equipe || [];
    if (substituindo != null) {
      limparAvisosEscolha(culto.data, substituindo);
      culto.equipe = culto.equipe.map((o) => (mesmoOcupante(o, substituindo) ? ocupante : o));
    } else if (!culto.equipe.some((o) => mesmoOcupante(o, ocupante)) && culto.equipe.length < (def.max || 5)) {
      culto.equipe.push(ocupante);
    }
  } else if (def.campo === 'mm') {
    culto.mm = culto.mm || {};
    const anterior = culto.mm[def.slotMm];
    if (anterior != null && anterior !== '') limparAvisosEscolha(culto.data, anterior);
    culto.mm[def.slotMm] = ocupante;
  }
  // Mantém o aviso da escolha "com aviso" visível no card (RF 16.11).
  registrarAvisosEscolha(culto.data, ocupante, avisos);
  render();
  atualizarParticipacao();
  salvarRascunho();
}

// ---------------------------------------------------------------------------
// Seletor de pessoa (candidatos elegíveis vindos do servidor)
// ---------------------------------------------------------------------------

/**
 * Abre o seletor. Se `substituindo` é um ocupante, busca substitutos (sem essa
 * pessoa); senão, busca candidatos para a função.
 */
async function abrirSeletor(idx, def, substituindo) {
  estado.seletorAlvo = { idx, def, substituindo: substituindo == null ? null : substituindo };
  estado.candidatosAtuais = null;
  estado.seletorCarregando = true;
  const culto = estado.cultos[idx];
  const sufixo = substituindo != null ? ` (substituir ${nomeOcupante(substituindo)})` : '';
  el('seletorTitulo').textContent = `${def.label} — ${brData(culto.data)}${sufixo}`;
  const busca = el('seletorBusca');
  busca.value = '';
  busca.disabled = true;
  el('seletorLista').innerHTML = '<li class="seletor-vazio">Carregando pessoas disponíveis...</li>';
  el('seletor').hidden = false;

  try {
    const rota = substituindo != null ? '/api/substitutos' : '/api/candidatos';
    const corpo = {
      mes: estado.mes,
      cultos: estado.cultos,
      data: culto.data,
      slot: def.slot,
    };
    if (substituindo != null && typeof substituindo === 'number') corpo.pessoaId = substituindo;
    if (substituindo != null && typeof substituindo === 'string') corpo.pessoaId = substituindo;
    const resposta = await api(rota, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    });
    if (
      !estado.seletorAlvo ||
      estado.seletorAlvo.idx !== idx ||
      estado.seletorAlvo.def !== def
    ) {
      return;
    }
    estado.candidatosAtuais = {
      elegiveis: resposta.elegiveis || [],
      elegiveisComAviso: resposta.elegiveisComAviso || [],
      naoElegiveis: resposta.naoElegiveis || [],
    };
    estado.seletorCarregando = false;
    busca.disabled = false;
    aplicarBusca();
    busca.focus();
  } catch (err) {
    estado.seletorCarregando = false;
    el('seletorLista').innerHTML = `<li class="seletor-vazio">Erro ao carregar: ${err.message}</li>`;
  }
}

/** Filtra os três grupos por termo de busca. */
function aplicarBusca() {
  if (estado.seletorCarregando || !estado.candidatosAtuais) return;
  const termo = el('seletorBusca').value.trim().toUpperCase();
  const filtra = (lista) =>
    termo ? (lista || []).filter((c) => (c.nome || '').toUpperCase().includes(termo)) : lista || [];
  renderCandidatos({
    elegiveis: filtra(estado.candidatosAtuais.elegiveis),
    elegiveisComAviso: filtra(estado.candidatosAtuais.elegiveisComAviso),
    naoElegiveis: filtra(estado.candidatosAtuais.naoElegiveis),
  });
}

function itemCandidato(c, { aviso } = {}) {
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.className = 'seletor-item';
  const rotuloTipo = c.tipo === 'grupo' ? ' · grupo' : '';
  const perfil = c.perfil_canto === 'participacao' ? 'participação' : c.perfil_canto || '';
  const meta = `${c.genero || ''}${perfil ? ' · ' + perfil : ''}${rotuloTipo}`;
  const porque = c.porque ? `<span class="seletor-porque">${c.porque}</span>` : '';
  let historico = '';
  if (c.tipo !== 'grupo' && typeof c.historicoCount === 'number') {
    const datas = (c.historicoDatas || []).length ? ` (${c.historicoDatas.join(', ')})` : '';
    const label = c.historicoCount === 0
      ? 'sem escalas recentes'
      : `${c.historicoCount}× recente${datas}`;
    historico = `<span class="seletor-historico">${label}</span>`;
  }
  const avisoTxt = aviso && c.avisos && c.avisos.length
    ? `<span class="seletor-aviso">⚠️ ${c.avisos.join(' · ')}</span>`
    : '';
  btn.innerHTML = `<span class="seletor-nome">${c.nome}${porque}${historico}${avisoTxt}</span><span class="meta">${meta}</span>`;
  btn.addEventListener('click', () => {
    const { idx, def, substituindo } = estado.seletorAlvo;
    const ocupante = c.tipo === 'grupo' ? `grupo:${c.chave}` : c.id;
    aplicarOcupante(idx, def, ocupante, substituindo, c.avisos || []);
    fecharSeletor();
  });
  li.appendChild(btn);
  return li;
}

function renderCandidatos(grupos) {
  const ul = el('seletorLista');
  ul.innerHTML = '';
  const elegiveis = grupos.elegiveis || [];
  const comAviso = grupos.elegiveisComAviso || [];
  const naoElegiveis = grupos.naoElegiveis || [];

  const totais = estado.candidatosAtuais || { elegiveis: [], elegiveisComAviso: [], naoElegiveis: [] };
  const contador = el('seletorContador');
  if (contador) {
    const t = totais.elegiveis.length + totais.elegiveisComAviso.length;
    contador.textContent = t > 0
      ? `${t} disponível(is). Use a busca só se quiser filtrar.`
      : 'Ninguém está livre para esta função nesta data.';
  }

  if (elegiveis.length === 0 && comAviso.length === 0 && naoElegiveis.length === 0) {
    ul.innerHTML = '<li class="seletor-vazio">Nenhuma pessoa corresponde à busca.</li>';
    return;
  }

  const secao = (titulo) => {
    const li = document.createElement('li');
    li.className = 'seletor-secao';
    li.textContent = titulo;
    ul.appendChild(li);
  };

  if (elegiveis.length) {
    secao('Elegíveis');
    for (const c of elegiveis) ul.appendChild(itemCandidato(c));
  }
  if (comAviso.length) {
    secao('Com aviso');
    for (const c of comAviso) ul.appendChild(itemCandidato(c, { aviso: true }));
  }
  if (naoElegiveis.length) {
    // Seção recolhível.
    const det = document.createElement('li');
    det.className = 'seletor-naoelegiveis';
    const detalhes = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = `Não elegíveis (${naoElegiveis.length})`;
    detalhes.appendChild(summary);
    const inner = document.createElement('ul');
    inner.className = 'seletor-lista-interna';
    for (const c of naoElegiveis) {
      const li = document.createElement('li');
      li.className = 'seletor-inelegivel';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'seletor-item seletor-item-excecao';
      btn.title = 'Escolher mesmo assim (exceção do diretor)';
      btn.innerHTML = `<span>${escaparHtml(c.nome)}</span><span class="seletor-motivo">${escaparHtml(c.motivoBloqueio || '')}</span><span class="seletor-excecao-acao">escolher como exceção</span>`;
      btn.addEventListener('click', () => escolherComoExcecao(c));
      li.appendChild(btn);
      inner.appendChild(li);
    }
    detalhes.appendChild(inner);
    det.appendChild(detalhes);
    ul.appendChild(det);
  }
}

function fecharSeletor() {
  el('seletor').hidden = true;
  estado.seletorAlvo = null;
}

// ---------------------------------------------------------------------------
// Cadastro rápido de convidado a partir do seletor (decisão de 05/11/2026)
// ---------------------------------------------------------------------------

// Alvo do seletor no momento em que o cadastro foi aberto e pessoas com
// telefone (para "usar o WhatsApp de ...").
const convidado = { alvo: null, pessoasComTelefone: [] };

/** Habilitações da pessoa nova conforme a função em que ela vai entrar. */
function habilitacoesParaSlot(slot) {
  const hab = {
    regente: slot === 'regente',
    equipe: slot === 'equipe',
    mensagem_musical: { es: false, culto: false, domingo: false },
    sonoplastia: false,
  };
  // Convidado de sábado costuma cantar nas duas mensagens (ES e culto).
  if (slot === 'mm_es' || slot === 'mm_culto') {
    hab.mensagem_musical.es = true;
    hab.mensagem_musical.culto = true;
  }
  if (slot === 'mm_domingo') hab.mensagem_musical.domingo = true;
  return hab;
}

async function abrirCadastroConvidado() {
  if (!estado.seletorAlvo) return;
  const { idx, def } = estado.seletorAlvo;
  const culto = estado.cultos[idx];
  convidado.alvo = { ...estado.seletorAlvo };
  el('convidadoFuncao').textContent = `Vai entrar em ${def.label} — ${brData(culto.data)}. Fica cadastrada só para esta função; dá para ajustar depois em Pessoas.`;
  el('cvNome').value = (el('seletorBusca').value || '').trim().toUpperCase();
  el('cvGenero').value = 'F';
  el('cvTelefone').value = '';
  el('cvContatoProprio').checked = true;
  el('cvErro').hidden = true;
  const sel = el('cvVia');
  sel.disabled = true;
  sel.innerHTML = '<option value="">Carregando...</option>';
  el('modalConvidado').hidden = false;
  el('cvNome').focus();
  try {
    const { pessoas } = await api('/api/pessoas');
    convidado.pessoasComTelefone = (pessoas || [])
      .filter((p) => soDigitos(p.telefone))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    sel.innerHTML =
      '<option value="">Escolha a pessoa</option>' +
      convidado.pessoasComTelefone.map((p) => `<option value="${p.id}">${escaparHtml(p.nome)}</option>`).join('');
  } catch (err) {
    sel.innerHTML = '<option value="">Não foi possível carregar as pessoas</option>';
  }
  atualizarContatoConvidado();
}

function fecharCadastroConvidado() {
  el('modalConvidado').hidden = true;
  convidado.alvo = null;
}

/** Habilita o telefone ou o "WhatsApp de ..." conforme a opção marcada. */
function atualizarContatoConvidado() {
  const via = el('cvContatoVia').checked;
  el('cvTelefone').disabled = via;
  el('cvVia').disabled = !via;
}

function erroConvidado(msg) {
  el('cvErro').textContent = msg;
  el('cvErro').hidden = false;
}

async function salvarConvidado() {
  if (!convidado.alvo) return;
  const { idx, def, substituindo } = convidado.alvo;
  el('cvErro').hidden = true;
  const nome = el('cvNome').value.trim();
  if (!nome) {
    erroConvidado('Informe o nome.');
    return;
  }
  const usaVia = el('cvContatoVia').checked;
  const viaId = usaVia && el('cvVia').value ? Number(el('cvVia').value) : null;
  const telefone = usaVia ? '' : soDigitos(el('cvTelefone').value);
  if (usaVia && !viaId) {
    erroConvidado('Escolha de quem é o WhatsApp.');
    return;
  }
  if (!usaVia && !telefone) {
    erroConvidado('Informe o telefone ou escolha "Usar o WhatsApp de uma pessoa já cadastrada".');
    return;
  }
  const via = viaId ? convidado.pessoasComTelefone.find((p) => p.id === viaId) : null;
  const hoje = new Date().toISOString().slice(0, 10);
  const dados = {
    nome,
    aliases: [],
    telefone,
    contato_via_id: viaId,
    genero: el('cvGenero').value,
    perfil_canto: 'participacao',
    ativo: true,
    habilitacoes: habilitacoesParaSlot(def.slot),
    dias_permitidos: null,
    limite_mensal: null,
    afastado: null,
    notas: `Cadastrada pela montagem em ${hoje}${via ? `. Contato via ${via.nome}` : ''}.`,
  };

  let verificacao;
  try {
    verificacao = await api('/api/pessoas/verificar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dados, id: null }),
    });
  } catch (err) {
    erroConvidado(err.message);
    return;
  }
  if (verificacao.erros && verificacao.erros.length > 0) {
    erroConvidado(verificacao.erros.join(' '));
    return;
  }
  let confirmarAvisos = false;
  if (verificacao.avisos && verificacao.avisos.length > 0) {
    if (!confirm(`Atenção:\n- ${verificacao.avisos.join('\n- ')}\n\nCadastrar mesmo assim?`)) return;
    confirmarAvisos = true;
  }
  let confirmacaoTelefone = false;
  if (!usaVia) {
    const ok = await confirmarWhatsApp(telefone, verificacao.telefoneCompartilhadoCom || []);
    if (!ok) return;
    confirmacaoTelefone = true;
  }

  mostrarOverlay('Cadastrando...');
  try {
    const resp = await api('/api/pessoas', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dados, confirmacaoTelefone, confirmarAvisos }),
    });
    const pessoa = resp.pessoa;
    estado.pessoasPorId.set(pessoa.id, { id: pessoa.id, nome: pessoa.nome, genero: pessoa.genero });
    fecharCadastroConvidado();
    aplicarOcupante(idx, def, pessoa.id, substituindo, []);
    fecharSeletor();
    setStatus(`${pessoa.nome} cadastrada e escalada.`, 'ok');
    await atualizarSync();
  } catch (err) {
    erroConvidado(err.message);
  } finally {
    esconderOverlay();
  }
}

/**
 * Escolhe uma pessoa (ou grupo) bloqueada por regra, depois de o diretor
 * confirmar que está violando a regra de propósito. Registra a exceção de cada
 * bloqueio com o mesmo id que a validação usa
 * (`chave|data|slot|ocupante`), para a revalidação de envio já trazê-la marcada.
 */
function escolherComoExcecao(c) {
  if (!estado.seletorAlvo) return;
  const { idx, def, substituindo } = estado.seletorAlvo;
  const culto = estado.cultos[idx];
  const motivos = (c.bloqueios || []).map((b) => b.texto);
  const texto =
    `${c.nome} não pode entrar aqui pelas regras:\n- ${motivos.join('\n- ') || c.motivoBloqueio || ''}\n\n` +
    'Você confirma que está violando esta regra de propósito (exceção do diretor)?\n' +
    'A exceção fica registrada no histórico do mês, fora da escala publicada.';
  if (!confirm(texto)) return;

  const ocupante = c.tipo === 'grupo' ? `grupo:${c.chave}` : c.id;
  for (const b of c.bloqueios || []) {
    estado.excecoes.add(`${b.chave}|${culto.data}|${def.slot}|${ocupante}`);
  }
  salvarExcecoes();
  const avisos = [...motivos.map((m) => `exceção confirmada: ${m}`), ...(c.avisos || [])];
  aplicarOcupante(idx, def, ocupante, substituindo, avisos);
  fecharSeletor();
}

// ---------------------------------------------------------------------------
// Ações: carregar mês, sugerir, validar, publicar
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Iniciar ou retomar o mês + checklist de insumos (Task 14)
// ---------------------------------------------------------------------------

const INSUMOS_CHECKLIST = [
  { chave: 'acionato', label: 'Acionato (ancião, pregador, observações)' },
  { chave: 'sonoplastia', label: 'Sonoplastia (sonoplasta e suporte por culto)' },
  { chave: 'enquete', label: 'Indisponibilidade (enquete dos cantores)' },
];

async function abrirMesEChecklist(mes) {
  mostrarOverlay('Abrindo o mês...');
  try {
    const resultado = await api(`/api/mes/${mes}/abrir`, { method: 'POST' });
    estado.mes = mes;
    el('tituloInsumos').textContent = formatarMesTitulo(mes);
    renderChecklistInsumos(resultado.insumos || {});
    el('telaMenu').hidden = true;
    el('telaInsumos').hidden = false;
    if (resultado.iniciadoAgora) {
      setStatus('Mês iniciado: acionato criado com o calendário completo.', 'ok');
    } else {
      setStatus('');
    }
  } catch (err) {
    alert('Não foi possível abrir o mês: ' + err.message);
  } finally {
    esconderOverlay();
  }
}

function renderChecklistInsumos(insumos) {
  const lista = el('checklistInsumos');
  if (!lista) return;
  lista.innerHTML = '';
  for (const item of INSUMOS_CHECKLIST) {
    const estadoItem = insumos[item.chave] === 'preenchido' ? 'preenchido' : 'pendente';
    const li = document.createElement('li');
    li.className = `checklist-item ${estadoItem}`;
    const marca = estadoItem === 'preenchido' ? '✓' : '○';
    const rotulo = estadoItem === 'preenchido' ? 'preenchido' : 'pendente';
    li.innerHTML = `<span class="checklist-marca">${marca}</span>`
      + `<span class="checklist-label">${item.label}</span>`
      + `<span class="checklist-estado">${rotulo}</span>`;
    lista.appendChild(li);
  }
}

// ---------------------------------------------------------------------------
// Tela de acionato e dia extraordinário (Task 15)
// ---------------------------------------------------------------------------

// Estado local da tela de acionato: lista de itens editáveis.
const acionato = { itens: [], departamentos: [] };

const MODELO_LABEL = {
  sabado: 'Como sábado',
  domingo: 'Como domingo',
  sem_louvor: 'Sem louvor',
};

const PLACEHOLDER_OBS = 'Este texto será publicado na escala online';

/** Dia da semana (pt-BR) de uma data ISO AAAA-MM-DD. */
function diaDaSemanaISO(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  const dow = new Date(a, m - 1, d).getDay();
  return ['domingo', 'segunda-feira', 'terca-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sabado'][dow];
}

async function abrirAcionato() {
  if (!estado.mes) return;
  mostrarOverlay('Carregando acionato...');
  try {
    const dados = await api(`/api/mes/${estado.mes}/acionato`);
    acionato.departamentos = Array.isArray(dados.departamentos) ? dados.departamentos : [];
    acionato.itens = (dados.itens || []).map((it) => ({
      data: it.data,
      dia: it.dia || diaDaSemanaISO(it.data),
      anciao: it.anciao || '',
      pregador: it.pregador || '',
      observacoes: it.observacoes || '',
      modelo_louvor: it.modelo_louvor || 'sem_louvor',
      extraordinario: it.extraordinario === true,
      louvor_departamento: it.louvor_departamento || '',
    }));
    acionato.itens.sort((a, b) => a.data.localeCompare(b.data));
    el('tituloAcionato').textContent = formatarMesTitulo(estado.mes);
    el('acionatoErro').hidden = true;
    el('acExtraErro').hidden = true;
    el('acExtraData').value = `${estado.mes}-01`;
    el('acExtraModelo').value = 'domingo';
    renderAcionato();
    el('telaInsumos').hidden = true;
    el('telaAcionato').hidden = false;
  } catch (err) {
    alert('Não foi possível carregar o acionato: ' + err.message);
  } finally {
    esconderOverlay();
  }
}

function renderAcionato() {
  const corpo = el('corpoAcionato');
  corpo.innerHTML = '';
  acionato.itens.forEach((item, idx) => {
    const tr = document.createElement('tr');
    if (item.extraordinario) tr.className = 'acionato-extra-linha';

    const tdData = document.createElement('td');
    tdData.textContent = brData(item.data);
    tr.appendChild(tdData);

    const tdDia = document.createElement('td');
    tdDia.textContent = DIAS_LABEL[item.dia] || item.dia;
    tr.appendChild(tdDia);

    // Modelo: editável só para dias extraordinários; fixo (texto) para os demais.
    const tdModelo = document.createElement('td');
    if (item.extraordinario) {
      const sel = document.createElement('select');
      sel.className = 'campo-input acionato-modelo';
      for (const [val, label] of Object.entries(MODELO_LABEL)) {
        const op = document.createElement('option');
        op.value = val;
        op.textContent = label;
        if (val === item.modelo_louvor) op.selected = true;
        sel.appendChild(op);
      }
      sel.addEventListener('change', () => { item.modelo_louvor = sel.value; });
      tdModelo.appendChild(sel);
    } else {
      tdModelo.textContent = MODELO_LABEL[item.modelo_louvor] || item.modelo_louvor;
    }
    tr.appendChild(tdModelo);

    const tdAnciao = document.createElement('td');
    const inAnciao = document.createElement('input');
    inAnciao.type = 'text';
    inAnciao.className = 'campo-input';
    inAnciao.value = item.anciao;
    inAnciao.addEventListener('input', () => { item.anciao = inAnciao.value; });
    tdAnciao.appendChild(inAnciao);
    tr.appendChild(tdAnciao);

    const tdPregador = document.createElement('td');
    const inPregador = document.createElement('input');
    inPregador.type = 'text';
    inPregador.className = 'campo-input';
    inPregador.value = item.pregador;
    inPregador.addEventListener('input', () => { item.pregador = inPregador.value; });
    tdPregador.appendChild(inPregador);
    tr.appendChild(tdPregador);

    // Quem assume o louvor: copiar da escala do ancionato (05/11/2026).
    const tdLouvor = document.createElement('td');
    if (item.modelo_louvor === 'sem_louvor' || String(item.dia).startsWith('quarta')) {
      tdLouvor.textContent = '—';
    } else {
      const selDep = document.createElement('select');
      selDep.className = 'campo-input acionato-departamento';
      selDep.title = 'Copie da escala do ancionato quando um departamento assume o louvor';
      const opcoes = ['', ...(acionato.departamentos || [])];
      if (item.louvor_departamento && !opcoes.includes(item.louvor_departamento)) opcoes.push(item.louvor_departamento);
      for (const dep of opcoes) {
        const op = document.createElement('option');
        op.value = dep;
        op.textContent = dep || 'Nossa equipe';
        if (dep === (item.louvor_departamento || '')) op.selected = true;
        selDep.appendChild(op);
      }
      selDep.addEventListener('change', () => { item.louvor_departamento = selDep.value; });
      tdLouvor.appendChild(selDep);
    }
    tr.appendChild(tdLouvor);

    const tdObs = document.createElement('td');
    const inObs = document.createElement('textarea');
    inObs.className = 'campo-input acionato-obs';
    inObs.rows = 2;
    inObs.placeholder = PLACEHOLDER_OBS;
    inObs.value = item.observacoes;
    inObs.addEventListener('input', () => { item.observacoes = inObs.value; });
    tdObs.appendChild(inObs);
    tr.appendChild(tdObs);

    const tdAcao = document.createElement('td');
    if (item.extraordinario) {
      const btn = document.createElement('button');
      btn.className = 'control-btn danger-link';
      btn.textContent = 'Remover';
      btn.title = 'Remover dia extraordinário';
      btn.addEventListener('click', () => {
        acionato.itens.splice(idx, 1);
        renderAcionato();
      });
      tdAcao.appendChild(btn);
    }
    tr.appendChild(tdAcao);

    corpo.appendChild(tr);
  });
}

function incluirDiaExtraordinario() {
  const erroEl = el('acExtraErro');
  erroEl.hidden = true;
  const data = el('acExtraData').value;
  const modelo = el('acExtraModelo').value;
  if (!data) {
    erroEl.textContent = 'Escolha a data do dia extraordinário.';
    erroEl.hidden = false;
    return;
  }
  if (!data.startsWith(`${estado.mes}-`)) {
    erroEl.textContent = `A data precisa estar dentro de ${formatarMesTitulo(estado.mes)}.`;
    erroEl.hidden = false;
    return;
  }
  if (acionato.itens.some((it) => it.data === data)) {
    erroEl.textContent = 'Essa data já existe no acionato.';
    erroEl.hidden = false;
    return;
  }
  acionato.itens.push({
    data,
    dia: diaDaSemanaISO(data),
    anciao: '',
    pregador: '',
    observacoes: '',
    modelo_louvor: modelo,
    extraordinario: true,
    louvor_departamento: '',
  });
  acionato.itens.sort((a, b) => a.data.localeCompare(b.data));
  renderAcionato();
}

async function salvarAcionato() {
  const erroEl = el('acionatoErro');
  erroEl.hidden = true;
  mostrarOverlay('Salvando acionato...');
  try {
    await api(`/api/mes/${estado.mes}/acionato`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ itens: acionato.itens }),
    });
    setStatus('Acionato salvo e publicado.', 'ok');
    el('telaAcionato').hidden = true;
    // Volta ao checklist atualizando os insumos.
    await abrirMesEChecklist(estado.mes);
  } catch (err) {
    erroEl.textContent = err.message;
    erroEl.hidden = false;
  } finally {
    esconderOverlay();
  }
}

// ---------------------------------------------------------------------------
// Tela de sonoplastia (Task 16)
// ---------------------------------------------------------------------------

// Estado local da tela: itens por culto e pessoas habilitadas (sonoplastia).
// Cada posição (sonoplasta/suporte) é { id: number|null, texto: string }:
//   - id != null  → pessoa do cadastro (publicada com link);
//   - id == null, texto != '' → texto livre "fora do cadastro" (sem link);
//   - id == null, texto == '' → vazio.
const sonoplastia = { itens: [], pessoas: [] };

const OPCAO_LIVRE = '__livre__';
const OPCAO_CADASTRAR = '__cadastrar__';

async function abrirSonoplastia() {
  if (!estado.mes) return;
  mostrarOverlay('Carregando sonoplastia...');
  try {
    // Cultos do mês vêm do acionato (inclui quartas); valores salvos vêm do
    // insumo de sonoplastia; pessoas elegíveis vêm do cadastro.
    const [acionatoDados, sonoDados, pessoasDados] = await Promise.all([
      api(`/api/mes/${estado.mes}/acionato`),
      api(`/api/mes/${estado.mes}/sonoplastia`),
      api('/api/pessoas'),
    ]);

    sonoplastia.pessoas = (pessoasDados.pessoas || [])
      .filter((p) => p.ativo !== false && p.habilitacoes && p.habilitacoes.sonoplastia === true)
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

    // Mapa data → item salvo (sonoplastia: [sonoplasta, suporte], ids: [...]).
    const salvosPorData = new Map();
    for (const it of sonoDados.itens || []) {
      salvosPorData.set(it.data, it);
    }

    const cultos = (acionatoDados.itens || [])
      .slice()
      .sort((a, b) => a.data.localeCompare(b.data));

    sonoplastia.itens = cultos.map((culto) => {
      const salvo = salvosPorData.get(culto.data) || {};
      const nomes = Array.isArray(salvo.sonoplastia) ? salvo.sonoplastia : [];
      const ids = Array.isArray(salvo.ids) ? salvo.ids : [];
      return {
        data: culto.data,
        dia: culto.dia || diaDaSemanaISO(culto.data),
        sonoplasta: posicaoDe(nomes[0], ids[0]),
        suporte: posicaoDe(nomes[1], ids[1]),
        observacoes: salvo.observacoes || '',
      };
    });

    el('tituloSonoplastia').textContent = formatarMesTitulo(estado.mes);
    el('sonoplastiaErro').hidden = true;
    renderSonoplastia();
    el('telaInsumos').hidden = true;
    el('telaAcionato').hidden = true;
    el('telaSonoplastia').hidden = false;
  } catch (err) {
    alert('Não foi possível carregar a sonoplastia: ' + err.message);
  } finally {
    esconderOverlay();
  }
}

/** Monta uma posição { id, texto } a partir de um nome e um id salvos. */
function posicaoDe(nome, id) {
  if (nome == null || String(nome).trim() === '') return { id: null, texto: '' };
  if (id != null) return { id, texto: String(nome) };
  return { id: null, texto: String(nome) };
}

function renderSonoplastia() {
  const corpo = el('corpoSonoplastia');
  corpo.innerHTML = '';
  sonoplastia.itens.forEach((item) => {
    const tr = document.createElement('tr');

    const tdData = document.createElement('td');
    tdData.textContent = brData(item.data);
    tr.appendChild(tdData);

    const tdDia = document.createElement('td');
    tdDia.textContent = DIAS_LABEL[item.dia] || item.dia;
    tr.appendChild(tdDia);

    tr.appendChild(celulaPessoa(item, 'sonoplasta'));
    tr.appendChild(celulaPessoa(item, 'suporte'));

    const tdObs = document.createElement('td');
    const inObs = document.createElement('input');
    inObs.type = 'text';
    inObs.className = 'campo-input';
    inObs.value = item.observacoes;
    inObs.addEventListener('input', () => { item.observacoes = inObs.value; });
    tdObs.appendChild(inObs);
    tr.appendChild(tdObs);

    corpo.appendChild(tr);
  });
}

/**
 * Célula de escolha de pessoa (sonoplasta ou suporte). Mostra um <select> com
 * as pessoas habilitadas, "(fora do cadastro)" e "+ cadastrar pessoa"; quando
 * "fora do cadastro" está escolhido, revela um campo de texto livre.
 */
function celulaPessoa(item, campo) {
  const td = document.createElement('td');
  const pos = item[campo];

  const sel = document.createElement('select');
  sel.className = 'campo-input';

  const vazio = document.createElement('option');
  vazio.value = '';
  vazio.textContent = campo === 'suporte' ? '(sem suporte)' : '(escolher)';
  sel.appendChild(vazio);

  for (const p of sonoplastia.pessoas) {
    const op = document.createElement('option');
    op.value = String(p.id);
    op.textContent = p.nome;
    sel.appendChild(op);
  }

  const livre = document.createElement('option');
  livre.value = OPCAO_LIVRE;
  livre.textContent = 'Fora do cadastro (texto livre)';
  sel.appendChild(livre);

  const cadastrar = document.createElement('option');
  cadastrar.value = OPCAO_CADASTRAR;
  cadastrar.textContent = '+ Cadastrar pessoa…';
  sel.appendChild(cadastrar);

  // Campo de texto livre, visível só quando a posição é texto fora do cadastro.
  const inTexto = document.createElement('input');
  inTexto.type = 'text';
  inTexto.className = 'campo-input sono-texto-livre';
  inTexto.placeholder = 'Nome (fora do cadastro)';
  inTexto.value = pos.id == null ? pos.texto : '';
  inTexto.hidden = !(pos.id == null && pos.texto !== '');

  const marcaLivre = document.createElement('span');
  marcaLivre.className = 'sono-marca-livre';
  marcaLivre.textContent = 'fora do cadastro';
  marcaLivre.hidden = inTexto.hidden;

  // Valor inicial do select.
  if (pos.id != null && sonoplastia.pessoas.some((p) => p.id === pos.id)) {
    sel.value = String(pos.id);
  } else if (pos.id == null && pos.texto !== '') {
    sel.value = OPCAO_LIVRE;
  } else {
    sel.value = '';
  }

  sel.addEventListener('change', () => {
    const v = sel.value;
    if (v === OPCAO_CADASTRAR) {
      // Volta o select ao estado anterior e abre o cadastro.
      sel.value = pos.id != null ? String(pos.id) : (pos.texto !== '' ? OPCAO_LIVRE : '');
      cadastrarPessoaSonoplastia();
      return;
    }
    if (v === OPCAO_LIVRE) {
      pos.id = null;
      // mantém o texto já digitado, se houver
      inTexto.hidden = false;
      marcaLivre.hidden = false;
      inTexto.focus();
      return;
    }
    inTexto.hidden = true;
    marcaLivre.hidden = true;
    if (v === '') {
      pos.id = null;
      pos.texto = '';
    } else {
      const p = sonoplastia.pessoas.find((x) => x.id === Number(v));
      pos.id = Number(v);
      pos.texto = p ? p.nome : '';
    }
  });

  inTexto.addEventListener('input', () => {
    pos.id = null;
    pos.texto = inTexto.value;
  });

  td.appendChild(sel);
  td.appendChild(inTexto);
  td.appendChild(marcaLivre);
  return td;
}

/**
 * Atalho "cadastrar pessoa": abre o formulário com a habilitação de sonoplastia
 * marcada e, ao salvar, volta à tela de sonoplastia com a pessoa disponível.
 */
function cadastrarPessoaSonoplastia() {
  // Garante que a lista de pessoas/grupos esteja carregada para o formulário.
  const abrir = async () => {
    if (!gestao.pessoas || gestao.pessoas.length === 0) {
      try {
        const dados = await api('/api/pessoas');
        gestao.pessoas = dados.pessoas || [];
        gestao.grupos = dados.grupos || {};
      } catch { /* o formulário ainda funciona sem a lista de vínculos */ }
    }
    gestao.voltarParaSonoplastia = true;
    abrirFormPessoa(null);
    // Marca a habilitação de sonoplastia por padrão.
    el('pfSonoplastia').checked = true;
  };
  abrir();
}

/** Converte os itens da tela no formato gravado (sonoplastia + ids). */
function montarSonoplastiaParaSalvar() {
  return sonoplastia.itens
    .map((item) => {
      const nomes = [];
      const ids = [];
      for (const campo of ['sonoplasta', 'suporte']) {
        const pos = item[campo];
        const texto = pos.id != null ? pos.texto : (pos.texto || '').trim();
        if (campo === 'suporte' && !texto) continue; // suporte opcional
        nomes.push(texto);
        ids.push(pos.id != null ? pos.id : null);
      }
      return {
        data: item.data,
        dia: item.dia,
        sonoplastia: nomes,
        ids,
        observacoes: item.observacoes || '',
      };
    })
    // Só grava cultos com ao menos uma posição preenchida.
    .filter((it) => it.sonoplastia.some((n) => String(n || '').trim() !== ''));
}

async function salvarSonoplastiaUI() {
  const erroEl = el('sonoplastiaErro');
  erroEl.hidden = true;
  mostrarOverlay('Salvando sonoplastia...');
  try {
    await api(`/api/mes/${estado.mes}/sonoplastia`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ itens: montarSonoplastiaParaSalvar() }),
    });
    setStatus('Sonoplastia salva e publicada.', 'ok');
    el('telaSonoplastia').hidden = true;
    await abrirMesEChecklist(estado.mes);
  } catch (err) {
    erroEl.textContent = err.message;
    erroEl.hidden = false;
  } finally {
    esconderOverlay();
  }
}

// ---------------------------------------------------------------------------
// Importação da indisponibilidade (Task 17)
// ---------------------------------------------------------------------------

// Estado local da tela de importação da enquete.
const enquete = { dados: null, associacoes: [], decisoes: {} };

async function abrirEnquete() {
  if (!estado.mes) return;
  enquete.dados = null;
  enquete.associacoes = [];
  enquete.decisoes = {};
  el('tituloEnquete').textContent = formatarMesTitulo(estado.mes);
  el('arqEnquete').value = '';
  el('enqueteErro').hidden = true;
  el('enqueteIgnoradas').hidden = true;
  el('enqueteAnalise').hidden = true;
  el('enqueteRelatorio').hidden = true;
  el('listaEnquete').innerHTML = '';
  el('btnGravarEnquete').hidden = true;
  el('telaInsumos').hidden = true;
  el('telaEnquete').hidden = false;
  // Garante o mapa de pessoas para exibir nomes e preencher o seletor.
  if (!estado.pessoasPorId || estado.pessoasPorId.size === 0) {
    try {
      const dados = await api(`/api/dados?mes=${estado.mes}`);
      estado.pessoasPorId = new Map((dados.pessoas || []).map((p) => [p.id, p]));
    } catch {
      estado.pessoasPorId = estado.pessoasPorId || new Map();
    }
  }
}

/** Lê o arquivo anexado no navegador, converte para JSON e manda analisar. */
async function anexarEnquete(arquivo) {
  const erroEl = el('enqueteErro');
  erroEl.hidden = true;
  if (!arquivo) return;
  let obj;
  try {
    const texto = await arquivo.text();
    obj = JSON.parse(texto);
  } catch (err) {
    erroEl.textContent = 'Não foi possível ler o arquivo como JSON: ' + err.message;
    erroEl.hidden = false;
    return;
  }
  mostrarOverlay('Analisando a enquete...');
  try {
    const resp = await api(`/api/mes/${estado.mes}/indisponibilidade/analisar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enquete: obj }),
    });
    enquete.dados = obj;
    enquete.associacoes = resp.associacoes || [];
    enquete.decisoes = {};
    renderDatasIgnoradas(resp.datasIgnoradas || []);
    renderAnaliseEnquete();
    el('enqueteRelatorio').hidden = true;
    el('btnGravarEnquete').hidden = false;
  } catch (err) {
    const erros = (err.payload && err.payload.erros) || [];
    erroEl.innerHTML = [err.message, ...erros].join('<br>');
    erroEl.hidden = false;
    el('enqueteAnalise').hidden = true;
    el('btnGravarEnquete').hidden = true;
  } finally {
    esconderOverlay();
  }
}

function renderDatasIgnoradas(datas) {
  const aviso = el('enqueteIgnoradas');
  if (!datas.length) {
    aviso.hidden = true;
    return;
  }
  aviso.textContent = `Datas fora do mês (ignoradas): ${datas.map(brData).join(', ')}.`;
  aviso.hidden = false;
}

/** Lista de pessoas ativas para o seletor "escolher outra pessoa". */
function opcoesPessoasEnquete() {
  const lista = [...estado.pessoasPorId.values()].filter(Boolean);
  // Em contexto de insumos, pessoasPorId pode estar vazio; cai no cadastro via API.
  return lista.sort((a, b) => a.nome.localeCompare(b.nome));
}

function renderAnaliseEnquete() {
  const ul = el('listaEnquete');
  ul.innerHTML = '';
  for (const assoc of enquete.associacoes) {
    const li = document.createElement('li');
    li.className = `enquete-item enquete-${assoc.estado}`;

    const topo = document.createElement('div');
    topo.className = 'enquete-topo';
    const nome = document.createElement('span');
    nome.className = 'enquete-nome';
    nome.textContent = assoc.nomeEnquete;
    topo.appendChild(nome);

    const estadoTag = document.createElement('span');
    estadoTag.className = 'enquete-tag';
    if (assoc.estado === 'associado') {
      const p = estado.pessoasPorId.get(assoc.pessoaId);
      const porLabel = assoc.por === 'telefone' ? 'por telefone' : 'por nome';
      estadoTag.textContent = `→ ${p ? p.nome : 'ID ' + assoc.pessoaId} (${porLabel})`;
      estadoTag.classList.add('ok');
    } else {
      estadoTag.textContent = 'pendente';
      estadoTag.classList.add('pendente');
    }
    topo.appendChild(estadoTag);
    li.appendChild(topo);

    if (assoc.estado === 'pendente') {
      const acoes = document.createElement('div');
      acoes.className = 'enquete-acoes';

      // Opções sugeridas (confirmar).
      for (const op of assoc.opcoes || []) {
        const btn = document.createElement('button');
        btn.className = 'control-btn';
        const conf = op.confianca != null && op.confianca < 1
          ? ` (${Math.round(op.confianca * 100)}%)` : '';
        btn.textContent = `Confirmar ${op.nome}${conf}`;
        btn.addEventListener('click', () => {
          enquete.decisoes[assoc.nomeEnquete] = op.id;
          marcarDecidido(li, `→ ${op.nome} (você confirmou)`);
        });
        acoes.appendChild(btn);
      }

      // Escolher outra pessoa.
      const sel = document.createElement('select');
      sel.className = 'campo-input enquete-select';
      const vazio = document.createElement('option');
      vazio.value = '';
      vazio.textContent = 'Escolher outra pessoa...';
      sel.appendChild(vazio);
      for (const p of opcoesPessoasEnquete()) {
        const op = document.createElement('option');
        op.value = String(p.id);
        op.textContent = p.nome;
        sel.appendChild(op);
      }
      sel.addEventListener('change', () => {
        if (sel.value) {
          const p = estado.pessoasPorId.get(Number(sel.value));
          enquete.decisoes[assoc.nomeEnquete] = Number(sel.value);
          marcarDecidido(li, `→ ${p ? p.nome : sel.value} (você escolheu)`);
        }
      });
      acoes.appendChild(sel);

      // Ignorar.
      const btnIgnorar = document.createElement('button');
      btnIgnorar.className = 'control-btn danger-link';
      btnIgnorar.textContent = 'Ignorar';
      btnIgnorar.addEventListener('click', () => {
        enquete.decisoes[assoc.nomeEnquete] = 'ignorar';
        marcarDecidido(li, 'ignorado', true);
      });
      acoes.appendChild(btnIgnorar);

      li.appendChild(acoes);
    }

    ul.appendChild(li);
  }
  el('enqueteAnalise').hidden = enquete.associacoes.length === 0;
}

/** Marca um item pendente como decidido na interface. */
function marcarDecidido(li, texto, ignorado = false) {
  const tag = li.querySelector('.enquete-tag');
  if (tag) {
    tag.textContent = texto;
    tag.className = 'enquete-tag ' + (ignorado ? 'ignorado' : 'ok');
  }
  const acoes = li.querySelector('.enquete-acoes');
  if (acoes) acoes.remove();
  li.classList.remove('enquete-pendente');
  li.classList.add(ignorado ? 'enquete-ignorado' : 'enquete-associado');
}

async function gravarEnquete() {
  if (!enquete.dados) return;
  mostrarOverlay('Gravando a importação...');
  try {
    const resp = await api(`/api/mes/${estado.mes}/indisponibilidade/gravar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enquete: enquete.dados, decisoes: enquete.decisoes }),
    });
    renderRelatorioEnquete(resp.relatorio || {});
    setStatus('Indisponibilidade importada e publicada.', 'ok');
    el('btnGravarEnquete').hidden = true;
  } catch (err) {
    const erroEl = el('enqueteErro');
    erroEl.textContent = err.message;
    erroEl.hidden = false;
  } finally {
    esconderOverlay();
  }
}

function renderRelatorioEnquete(relatorio) {
  const div = el('enqueteRelatorio');
  const associados = relatorio.associados || [];
  const pendentes = relatorio.pendentes || [];
  const ignorados = relatorio.ignorados || [];
  const nomePessoa = (id) => {
    const p = estado.pessoasPorId.get(id);
    return p ? p.nome : `ID ${id}`;
  };
  const linhas = [];
  linhas.push(`<h3 class="menu-subtitle">Relatório</h3>`);
  linhas.push(`<p class="enquete-resumo">${associados.length} associado(s), ${pendentes.length} pendente(s), ${ignorados.length} data(s) ignorada(s).</p>`);
  if (associados.length) {
    linhas.push('<p><strong>Associados</strong></p><ul class="enquete-relatorio-lista">');
    for (const a of associados) {
      linhas.push(`<li>${a.nomeEnquete} → ${nomePessoa(a.pessoaId)} (${a.por})</li>`);
    }
    linhas.push('</ul>');
  }
  if (pendentes.length) {
    linhas.push('<p><strong>Ainda pendentes (não associados)</strong></p><ul class="enquete-relatorio-lista">');
    for (const p of pendentes) linhas.push(`<li>${p.nomeEnquete}</li>`);
    linhas.push('</ul>');
  }
  div.innerHTML = linhas.join('');
  div.hidden = false;
}

async function carregarMes(mes) {
  mostrarOverlay('Carregando dados do mês...');
  try {
    const dados = await api(`/api/dados?mes=${mes}`);
    estado.mes = mes;
    estado.dadosCultos = dados.cultos; // cultos "secos" da API (tipo/slots/acionato)
    estado.publicada = dados.publicada || null; // atribuições do atual.json por ID
    estado.pessoasPorId = new Map(dados.pessoas.map((p) => [p.id, p]));
    estado.gruposPorChave = dados.grupos || {};
    estado.filtro = { dias: new Set(), data: null, extraordinarios: false };
    estado.foraDoCadastro = new Set();
    estado.excecoes = lerExcecoes(mes);
    el('tituloMes').textContent = formatarMesTitulo(mes);
    el('telaMenu').hidden = true;
    el('telaInsumos').hidden = true;
    el('telaMontagem').hidden = false;
    el('painelValidacao').hidden = true;
    // Envio só após uma revalidação sem erros e com todas as ciências (RF 21).
    invalidarRevalidacao();
    setStatus('');

    // Rascunho salvo? Pergunta recuperar / nova montagem (RF 19.2). Sem rascunho,
    // parte da Publicacao do mês ou vazio (RF 19.6).
    const rascunho = lerRascunho(mes);
    esconderOverlay();
    if (rascunho) {
      const recuperar = await perguntarRascunho();
      if (recuperar) {
        aplicarRascunho(rascunho);
        renderFiltrosDia();
        render();
        atualizarParticipacao();
        // Recuperar revalida a escala (RF 19.3).
        await validar();
        return;
      }
      // Nova montagem: apaga o rascunho e parte da publicada/vazio (RF 19.5).
      apagarRascunho(mes);
    }
    iniciarCultosDaPublicada();
    renderFiltrosDia();
    render();
    atualizarParticipacao();
  } catch (err) {
    esconderOverlay();
    alert('Não foi possível carregar o mês: ' + err.message);
  }
}

/** Culto "em branco" a partir dos dados secos da API. */
function cultoVazioDaApi(c) {
  return {
    ...c,
    regente: null,
    equipe: [],
    mm: {},
    assumidoPor: null,
    excedentes: [],
  };
}

/**
 * Inicia os cultos do estado a partir da Publicacao do mês (atual.json por ID),
 * quando existe, casando por data com os cultos da API; sem publicada, parte
 * vazio (RF 19.5, 19.6). Marca os ocupantes fora do cadastro (RF 19.4).
 */
function iniciarCultosDaPublicada() {
  estado.foraDoCadastro = new Set();
  const publicadaPorData = new Map(
    (estado.publicada || []).map((c) => [c.data, c]),
  );
  estado.cultos = (estado.dadosCultos || []).map((c) => {
    const base = cultoVazioDaApi(c);
    const pub = publicadaPorData.get(c.data);
    if (!pub) return base;
    const culto = {
      ...base,
      acomp: pub.acomp || base.acomp,
      obs: pub.obs != null ? pub.obs : base.obs,
      regente: pub.regente ?? null,
      equipe: Array.isArray(pub.equipe) ? pub.equipe.slice() : [],
      mm: pub.mm ? { ...pub.mm } : {},
      assumidoPor: pub.assumidoPor || null,
      excedentes: Array.isArray(pub.excedentes) ? pub.excedentes.slice() : [],
    };
    registrarForaDoCadastro(culto);
    return culto;
  });
}

/** Marca em estado.foraDoCadastro os ocupantes de um culto fora do cadastro. */
function registrarForaDoCadastro(culto) {
  const marcar = (oc) => {
    if (oc != null && ocupanteForaDoCadastro(oc)) estado.foraDoCadastro.add(chaveOcupante(oc));
  };
  marcar(culto.regente);
  (culto.equipe || []).forEach(marcar);
  Object.values(culto.mm || {}).forEach(marcar);
  if (culto.assumidoPor) marcar(culto.assumidoPor);
}

/**
 * Pergunta ao usuário se deseja recuperar o rascunho ou começar uma nova
 * montagem (RF 19.2). Resolve com `true` para recuperar, `false` para nova.
 */
function perguntarRascunho() {
  return new Promise((resolver) => {
    const modal = el('modalRascunho');
    modal.hidden = false;
    const limpar = () => {
      modal.hidden = true;
      el('btnRascunhoRecuperar').removeEventListener('click', recuperar);
      el('btnRascunhoNova').removeEventListener('click', nova);
    };
    const recuperar = () => { limpar(); resolver(true); };
    const nova = () => { limpar(); resolver(false); };
    el('btnRascunhoRecuperar').addEventListener('click', recuperar);
    el('btnRascunhoNova').addEventListener('click', nova);
  });
}

/**
 * Aplica o rascunho salvo ao estado: desserializa por ID (nomes atuais do
 * cadastro vêm de pessoasPorId), casa por data com os cultos secos da API para
 * manter tipo/slots/acionato, e marca os ocupantes fora do cadastro (RF 19.3,
 * 19.4).
 */
function aplicarRascunho(texto) {
  const gruposMap = new Map(Object.entries(estado.gruposPorChave || {}));
  const { cultos: cultosRascunho, foraDoCadastro } = desserializarRascunho(
    texto,
    estado.pessoasPorId,
    gruposMap,
  );
  const rascunhoPorData = new Map(cultosRascunho.map((c) => [c.data, c]));
  estado.foraDoCadastro = new Set(
    (foraDoCadastro || []).map((f) => chaveOcupante(f.id)),
  );
  estado.cultos = (estado.dadosCultos || []).map((c) => {
    const base = cultoVazioDaApi(c);
    const r = rascunhoPorData.get(c.data);
    if (!r) return base;
    return {
      ...base,
      acomp: r.acomp || base.acomp,
      obs: r.obs != null ? r.obs : base.obs,
      regente: r.regente ?? null,
      equipe: Array.isArray(r.equipe) ? r.equipe.filter((x) => x != null) : [],
      mm: r.mm ? { ...r.mm } : {},
      assumidoPor: r.assumidoPor || null,
      excedentes: Array.isArray(r.excedentes) ? r.excedentes.slice() : [],
    };
  });
}

// ---------------------------------------------------------------------------
// Filtro por dia na montagem (Task 19)
// ---------------------------------------------------------------------------

const CHIPS_DIA = [
  { chave: 'sabado', label: 'Sábados' },
  { chave: 'domingo', label: 'Domingos' },
  { chave: 'quarta', label: 'Quartas' },
];

function renderFiltrosDia() {
  const barra = el('filtrosDia');
  if (!barra) return;
  barra.innerHTML = '';

  for (const chip of CHIPS_DIA) {
    const btn = document.createElement('button');
    btn.className = 'chip-filtro' + (estado.filtro.dias.has(chip.chave) ? ' ativo' : '');
    btn.textContent = chip.label;
    btn.addEventListener('click', () => {
      if (estado.filtro.dias.has(chip.chave)) estado.filtro.dias.delete(chip.chave);
      else estado.filtro.dias.add(chip.chave);
      renderFiltrosDia();
      render();
    });
    barra.appendChild(btn);
  }

  // Chip extraordinários.
  const btnExtra = document.createElement('button');
  btnExtra.className = 'chip-filtro' + (estado.filtro.extraordinarios ? ' ativo' : '');
  btnExtra.textContent = 'Extraordinários';
  btnExtra.addEventListener('click', () => {
    estado.filtro.extraordinarios = !estado.filtro.extraordinarios;
    renderFiltrosDia();
    render();
  });
  barra.appendChild(btnExtra);

  // Seletor de data.
  const sel = document.createElement('select');
  sel.className = 'filtro-data-select';
  const vazia = document.createElement('option');
  vazia.value = '';
  vazia.textContent = 'Qualquer data';
  sel.appendChild(vazia);
  for (const c of estado.cultos) {
    const o = document.createElement('option');
    o.value = c.data;
    o.textContent = brData(c.data);
    if (estado.filtro.data === c.data) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => {
    estado.filtro.data = sel.value || null;
    render();
  });
  barra.appendChild(sel);

  // Botão limpar.
  const limpar = document.createElement('button');
  limpar.className = 'chip-filtro limpar';
  limpar.textContent = 'Limpar filtro';
  limpar.addEventListener('click', () => {
    estado.filtro = { dias: new Set(), data: null, extraordinarios: false };
    renderFiltrosDia();
    render();
  });
  barra.appendChild(limpar);
}

// ---------------------------------------------------------------------------
// Tooltip custom (rápido ao aparecer, instantâneo ao sumir)
// ---------------------------------------------------------------------------

let tipEl = null;
let tipDelay = null;

function montarTooltipRapido() {
  if (tipEl) return;
  tipEl = document.createElement('div');
  tipEl.className = 'tip-custom';
  tipEl.hidden = true;
  document.body.appendChild(tipEl);

  document.addEventListener('mouseover', (e) => {
    const alvo = e.target.closest('[data-tip]');
    if (!alvo) return;
    clearTimeout(tipDelay);
    tipDelay = setTimeout(() => {
      tipEl.textContent = alvo.dataset.tip;
      tipEl.hidden = false;
      posicionarTip(e);
    }, 60); // aparece bem rápido
  });

  document.addEventListener('mousemove', (e) => {
    if (!tipEl.hidden) posicionarTip(e);
  });

  document.addEventListener('mouseout', (e) => {
    const alvo = e.target.closest('[data-tip]');
    if (!alvo) return;
    clearTimeout(tipDelay);
    tipEl.hidden = true; // some instantâneo
  });

  document.addEventListener('scroll', () => { tipEl.hidden = true; }, true);
}

function posicionarTip(e) {
  const pad = 14;
  let x = e.clientX + pad;
  let y = e.clientY + pad;
  const r = tipEl.getBoundingClientRect();
  if (x + r.width > window.innerWidth) x = e.clientX - r.width - pad;
  if (y + r.height > window.innerHeight) y = e.clientY - r.height - pad;
  tipEl.style.left = `${Math.max(4, x)}px`;
  tipEl.style.top = `${Math.max(4, y)}px`;
}

// ---------------------------------------------------------------------------
// Painel lateral de participação recente
// ---------------------------------------------------------------------------

let participacaoTimer = null;

/** Recalcula o painel (com leve debounce para não pesar a cada clique). */
function atualizarParticipacao() {
  clearTimeout(participacaoTimer);
  participacaoTimer = setTimeout(async () => {
    try {
      const janelaMeses = Number(el('selMeses')?.value || 4);
      const resumo = await api('/api/participacao', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mes: estado.mes, cultos: estado.cultos, janelaMeses }),
      });
      renderParticipacao(resumo);
    } catch {
      /* painel é auxiliar; silencia erros */
    }
  }, 250);
}

const FAIXA_LABEL = {
  inativo: 'Inativos — sem escalas, lembre de incluir',
  pouco: 'Pouco ativos',
  ativo: 'Ativos',
  fora: 'Votaram indisponível / afastados',
};
const FAIXA_ORDEM = ['inativo', 'pouco', 'ativo', 'fora'];

function renderParticipacao(resumo) {
  const cont = el('participacaoLista');
  cont.innerHTML = '';
  const itens = resumo.itens || [];
  if (itens.length === 0) {
    cont.innerHTML = '<p class="vazio">Sem dados de participação.</p>';
    return;
  }

  const grupos = { inativo: [], pouco: [], ativo: [], fora: [] };
  for (const i of itens) (grupos[i.faixa] || grupos.fora).push(i);

  for (const faixa of FAIXA_ORDEM) {
    const lista = grupos[faixa];
    if (!lista || lista.length === 0) continue;
    const titulo = document.createElement('div');
    titulo.className = 'participacao-grupo-titulo';
    titulo.innerHTML = `<span class="pp-dot ${faixa}"></span>${FAIXA_LABEL[faixa]} (${lista.length})`;
    cont.appendChild(titulo);

    for (const p of lista) {
      const row = document.createElement('div');
      row.className = 'pp-item' + (faixa === 'inativo' ? ' inativo-row' : '');

      // Tooltip por tipo com as datas escaladas. Fica no proprio item E no nome
      // (o nome e onde o usuario naturalmente passa o mouse). Usamos um atributo
      // proprio para montar o tooltip de forma consistente em toda a linha.
      const t = p.datasPorTipo || { regencia: [], louvor: [], mensagem: [] };
      const partes = [];
      if (t.regencia.length) partes.push(`Regência: ${t.regencia.join(', ')}`);
      if (t.louvor.length) partes.push(`Louvor: ${t.louvor.join(', ')}`);
      if (t.mensagem.length) partes.push(`Mensagem: ${t.mensagem.join(', ')}`);
      const datasTxt = partes.length ? partes.join('\n') : 'Sem escalas no período considerado';
      const foraTxt = p.votouFora > 0 ? `\nVotou indisponível em ${p.votouFora} culto(s)` : '';
      const tooltip = `${p.nome}${p.ehRegente ? ' (regente)' : ''}\n${datasTxt}${foraTxt}`;
      row.dataset.tip = tooltip;

      let info;
      if (faixa === 'fora') {
        info = p.votouFora > 0 ? `votou fora ${p.votouFora}x` : 'sem disponibilidade';
      } else {
        info = `${p.participou} de ${p.disponivel}`;
      }
      const tagRegente = p.ehRegente ? '<span class="pp-regente" title="Pode reger">R</span>' : '';
      const alertaFora = faixa !== 'fora' && p.votouFora > 0
        ? `<span class="pp-badge-fora"> · fora ${p.votouFora}x</span>`
        : '';

      // Breakdown por tipo (R/L/M). Só mostra tipos usados quando a pessoa participou.
      const pt = p.porTipo || { regencia: 0, louvor: 0, mensagem: 0 };
      const tipos = [
        ['regencia', 'R', pt.regencia],
        ['louvor', 'L', pt.louvor],
        ['mensagem', 'M', pt.mensagem],
      ];
      // O tooltip (datas) fica tambem nos badges, para que passar o mouse em
      // qualquer parte da linha mostre as datas (o title do pai some quando o
      // mouse esta sobre um filho).
      const tiposHtml = faixa === 'fora'
        ? ''
        : `<div class="pp-tipos">${tipos
            .map(([cls, letra, n]) =>
              `<span class="pp-tipo ${cls}${n === 0 ? ' zero' : ''}"><b>${letra}</b> ${n}</span>`)
            .join('')}</div>`;

      const insightsHtml = (p.insights && p.insights.length)
        ? `<div class="pp-insights">${p.insights
            .map((i) => `<span class="pp-insight ${i.tipo}">${i.texto}</span>`)
            .join('')}</div>`
        : '';

      row.innerHTML = `
        <div class="pp-linha1">
          <span class="pp-dot ${faixa}"></span>
          <span class="pp-nome">${p.nome}${tagRegente}</span>
          <span class="pp-info">${info}${alertaFora}</span>
        </div>
        ${tiposHtml}
        ${insightsHtml}`;
      cont.appendChild(row);
    }
  }

  // Legenda.
  const legenda = document.createElement('div');
  legenda.className = 'legenda';
  legenda.innerHTML = `
    <span><span class="pp-dot ativo"></span>ativo</span>
    <span><span class="pp-dot pouco"></span>pouco ativo</span>
    <span><span class="pp-dot inativo"></span>inativo</span>
    <span><span class="pp-regente">R</span> regente</span>`;
  cont.appendChild(legenda);
}

function formatarMesTitulo(mes) {
  const [ano, m] = mes.split('-');
  const nomes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  return `${nomes[Number(m) - 1]} de ${ano}`;
}

/** Converte um nome para o ID da pessoa (ou null). */
function idPorNome(nome) {
  if (!nome) return null;
  const alvo = String(nome).toUpperCase().trim();
  for (const [id, p] of estado.pessoasPorId) {
    if ((p.nome || '').toUpperCase().trim() === alvo) return id;
  }
  return null;
}

/** Diz se um ocupante de slot está preenchido (ID de pessoa ou 'grupo:<chave>'). */
function ocupantePreenchido(valor) {
  return valor != null && valor !== '';
}

/** Verifica se há ao menos uma atribuição preenchida na escala em montagem. */
function temAtribuicao() {
  return estado.cultos.some((c) => {
    if (c.assumidoPor) return true;
    if (ocupantePreenchido(c.regente)) return true;
    if ((c.equipe || []).some(ocupantePreenchido)) return true;
    const mm = c.mm || {};
    return Object.values(mm).some(ocupantePreenchido);
  });
}

/**
 * Sugestão automática (Task 23 / RF 18). Sem nenhuma atribuição, aplica direto.
 * Com atribuição, pergunta: sobrescrever tudo, só preencher vazios ou cancelar.
 */
function sugerir() {
  if (!temAtribuicao()) {
    executarSugestao('tudo');
    return;
  }
  abrirModalSugestao();
}

function abrirModalSugestao() {
  el('modalSugestao').hidden = false;
}

function fecharModalSugestao() {
  el('modalSugestao').hidden = true;
}

/**
 * Executa a sugestão no modo escolhido.
 * - 'tudo': substitui todas as atribuições pela sugestão.
 * - 'vazios': envia as atribuições atuais como fixas e só preenche os vazios;
 *   preserva o que já estava (inclusive grupos e cultos assumidos) e revalida.
 */
async function executarSugestao(modo) {
  fecharModalSugestao();
  mostrarOverlay('Gerando sugestão automática...');
  try {
    const { sugestoes, validacao } = await api('/api/sugerir', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mes: estado.mes, cultos: estado.cultos, modo }),
    });
    const porData = new Map(sugestoes.map((s) => [s.data, s]));
    estado.cultos = estado.cultos.map((c) => {
      const s = porData.get(c.data);
      if (!s || s.tipo !== 'normal') return c;
      // Culto assumido por grupo: fica inteiro fora da sugestão.
      if (c.assumidoPor) return c;
      const slotsMm = (c.slots || []).filter((x) => x.startsWith('mm_'));
      const preservar = modo === 'vazios';

      // Regente: no modo 'vazios', mantém o que já estava escolhido à mão.
      const regente = preservar && ocupantePreenchido(c.regente)
        ? c.regente
        : idPorNome(s.regente);

      // Equipe: no modo 'vazios', mantém os atuais e acrescenta os sugeridos
      // que ainda não estão (sem duplicar), respeitando o tamanho do slot.
      let equipe;
      if (preservar) {
        const atuais = (c.equipe || []).filter(ocupantePreenchido);
        const chaves = new Set(atuais.map(chaveOcupante));
        const sugeridos = (s.equipe || [])
          .map(idPorNome)
          .filter((id) => id != null && !chaves.has(chaveOcupante(id)));
        equipe = atuais.concat(sugeridos);
      } else {
        equipe = (s.equipe || []).map(idPorNome).filter((x) => x != null);
      }

      // MM por slot: no modo 'vazios', só preenche os slots vazios.
      const mm = preservar ? { ...(c.mm || {}) } : {};
      const sugeridosMm = (s.mm || []).map(idPorNome);
      if (preservar) {
        let j = 0;
        for (const slot of slotsMm) {
          if (ocupantePreenchido(mm[slot])) continue;
          while (j < sugeridosMm.length && sugeridosMm[j] == null) j++;
          if (j < sugeridosMm.length) {
            mm[slot] = sugeridosMm[j];
            j++;
          }
        }
      } else {
        sugeridosMm.forEach((id, i) => {
          if (slotsMm[i]) mm[slotsMm[i]] = id;
        });
      }

      return { ...c, regente, equipe, mm };
    });
    render();
    atualizarParticipacao();
    salvarRascunho();
    // Em "só preencher vazios", revalida e exibe o resultado (RF 18.5).
    if (modo === 'vazios') {
      if (validacao) {
        estado.ultimaValidacao = validacao;
        mostrarValidacao(validacao);
      } else {
        await validar();
      }
    }
    setStatus('Sugestão aplicada. Ajuste o que quiser.', 'ok');
  } catch (err) {
    alert('Erro ao sugerir: ' + err.message);
  } finally {
    esconderOverlay();
  }
}

async function validar() {
  mostrarOverlay('Validando regras...');
  try {
    const resultado = await api('/api/validar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mes: estado.mes, cultos: estado.cultos }),
    });
    estado.ultimaValidacao = resultado;
    mostrarValidacao(resultado);
    render();
    return resultado;
  } catch (err) {
    alert('Erro ao validar: ' + err.message);
    return null;
  } finally {
    esconderOverlay();
  }
}

function mostrarValidacao({ erros, avisos }) {
  const painel = el('painelValidacao');
  painel.hidden = false;
  const semProblemas = erros.length === 0 && avisos.length === 0;
  painel.className = 'validacao ' + (erros.length > 0 ? 'erro' : 'ok');

  const texto = (m) => (typeof m === 'string' ? m : m.texto || '');
  let html = '';
  if (semProblemas) {
    html = '<h4>Validação</h4><ul><li class="aviso" style="color:var(--success)">Tudo certo! Nenhum problema encontrado.</li></ul>';
  } else {
    html = '<h4>Validação</h4><ul>';
    for (const e of erros) {
      const excecao = e && e.id && estado.excecoes.has(e.id) ? ' <small>(exceção confirmada pelo diretor)</small>' : '';
      html += `<li class="erro">⛔ ${texto(e)}${excecao}</li>`;
    }
    for (const a of avisos) html += `<li class="aviso">⚠️ ${texto(a)}</li>`;
    html += '</ul>';
  }
  painel.innerHTML = html;

  if (erros.length > 0) setStatus(`${erros.length} erro(s)`, 'erro');
  else if (avisos.length > 0) setStatus(`${avisos.length} aviso(s)`, '');
  else setStatus('Validação OK', 'ok');
}

// ---------------------------------------------------------------------------
// Revalidação completa antes do envio (Task 29 / RF 21)
// ---------------------------------------------------------------------------

/**
 * Pede a revalidação completa ao servidor e mostra o painel com erros e avisos
 * (cada aviso com caixa de ciência). Guarda o resultado em estado para gatear o
 * botão "Enviar".
 */
async function revalidarEnvio() {
  mostrarOverlay('Revalidando para o envio...');
  try {
    const resultado = await api('/api/revalidar-envio', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mes: estado.mes, cultos: estado.cultos }),
    });
    estado.ultimaRevalidacao = resultado;
    // Mantém só as ciências que ainda correspondem a um aviso atual.
    const idsAtuais = new Set((resultado.avisos || []).map((a) => a.id));
    estado.ciencias = new Set([...estado.ciencias].filter((id) => idsAtuais.has(id)));
    mostrarRevalidacao(resultado);
    return resultado;
  } catch (err) {
    alert('Erro ao revalidar: ' + err.message);
    return null;
  } finally {
    esconderOverlay();
  }
}

/**
 * Verdadeiro quando é seguro enviar: nenhum erro sem exceção confirmada e toda
 * ciência marcada.
 */
function podeEnviar() {
  const r = estado.ultimaRevalidacao;
  if (!r) return false;
  if (errosPendentes(r.erros, estado.excecoes).length > 0) return false;
  return (r.avisos || []).every((a) => estado.ciencias.has(a.id));
}

/** Exceções confirmadas que correspondem a erros da revalidação atual. */
function excecoesDaRevalidacao(r, excecoes) {
  return (r && r.erros ? r.erros : [])
    .filter((e) => e && e.excecionavel === true && excecoes.has(e.id))
    .map((e) => e.id);
}

/**
 * HTML da lista de erros de regra que o diretor pode liberar como exceção,
 * cada um com sua caixa de confirmação (`classe` distingue envio e ajuste).
 */
function htmlErrosExcecionaveis(erros, excecoes, classe, texto) {
  if (erros.length === 0) return '';
  let html =
    '<p class="revalidacao-sub">Regras violadas (impedem o envio, a não ser que o diretor confirme a exceção):</p><ul class="revalidacao-erros">';
  for (const e of erros) {
    const marcado = excecoes.has(e.id) ? ' checked' : '';
    html += `<li class="erro"><label><input type="checkbox" class="${classe}" data-erro="${encodeURIComponent(e.id)}"${marcado}> <span>⛔ ${escaparHtml(texto(e))} <small>— marque para confirmar que está violando esta regra de propósito</small></span></label></li>`;
  }
  return `${html}</ul>`;
}

/**
 * Desenha o painel de revalidação: lista de erros (culto, função, pessoa) e
 * avisos com caixa de ciência. Atualiza o estado do botão "Enviar".
 */
function mostrarRevalidacao(resultado) {
  const painel = el('painelRevalidacao');
  if (!painel) return;
  const { erros = [], avisos = [] } = resultado || {};
  painel.hidden = false;
  painel.className = 'revalidacao ' + (erros.length > 0 ? 'erro' : avisos.length > 0 ? 'aviso' : 'ok');

  const texto = (m) => (typeof m === 'string' ? m : m.texto || '');
  const ehConferencia = (e) => typeof e === 'object' && e && typeof e.chave === 'string' && e.chave.startsWith('conferencia_');
  let html = '<h4>Revalidação para envio</h4>';

  if (erros.length === 0 && avisos.length === 0) {
    html += '<p class="revalidacao-ok">Tudo certo! Pode enviar.</p>';
  } else {
    // Erros da conferência de links primeiro, com culto, campo, nome e número
    // que o link abre (Task 30 / RF 22.8).
    const errosConferencia = erros.filter(ehConferencia);
    const errosOutros = erros.filter((e) => !ehConferencia(e));
    if (errosConferencia.length > 0) {
      html += '<p class="revalidacao-sub">Conferência dos links (impedem o envio):</p><ul class="revalidacao-erros">';
      for (const e of errosConferencia) {
        const detalhe = [e.data, e.slot, e.nome].filter(Boolean).join(' · ');
        const num = e.numero ? ` → abre ${e.numero}` : '';
        html += `<li class="erro">🔗 ${texto(e)}${detalhe && !texto(e).includes(String(e.nome)) ? ` <small>(${detalhe}${num})</small>` : ''}</li>`;
      }
      html += '</ul>';
    }
    const errosFixos = errosOutros.filter((e) => e.excecionavel !== true);
    const errosRegra = errosOutros.filter((e) => e.excecionavel === true);
    if (errosFixos.length > 0) {
      html += '<p class="revalidacao-sub">Erros (impedem o envio; precisam ser corrigidos):</p><ul class="revalidacao-erros">';
      for (const e of errosFixos) html += `<li class="erro">⛔ ${texto(e)}</li>`;
      html += '</ul>';
    }
    html += htmlErrosExcecionaveis(errosRegra, estado.excecoes, 'excecao-check', texto);
    if (avisos.length > 0) {
      html += '<p class="revalidacao-sub">Avisos (marque ciência de cada um):</p><ul class="revalidacao-avisos">';
      for (const a of avisos) {
        const id = a.id || texto(a);
        const marcado = estado.ciencias.has(id) ? ' checked' : '';
        const idEsc = encodeURIComponent(id);
        html += `<li class="aviso"><label><input type="checkbox" class="ciencia-check" data-aviso="${idEsc}"${marcado}> <span>⚠️ ${texto(a)}</span></label></li>`;
      }
      html += '</ul>';
    }
  }
  painel.innerHTML = html;

  painel.querySelectorAll('.excecao-check').forEach((cb) => {
    cb.addEventListener('change', () => {
      const id = decodeURIComponent(cb.dataset.erro);
      if (cb.checked) estado.excecoes.add(id);
      else estado.excecoes.delete(id);
      salvarExcecoes();
      atualizarBotaoEnviar();
    });
  });

  painel.querySelectorAll('.ciencia-check').forEach((cb) => {
    cb.addEventListener('change', () => {
      const id = decodeURIComponent(cb.dataset.aviso);
      if (cb.checked) estado.ciencias.add(id);
      else estado.ciencias.delete(id);
      atualizarBotaoEnviar();
    });
  });

  atualizarBotaoEnviar();
}

/** Habilita/desabilita o botão "Enviar" conforme podeEnviar(). */
function atualizarBotaoEnviar() {
  const btn = el('btnPublicar');
  if (!btn) return;
  btn.disabled = !podeEnviar();
}

async function publicar() {
  const resultado = await revalidarEnvio();
  if (!resultado) return;
  if (!podeEnviar()) {
    const pendentes = errosPendentes(resultado.erros, estado.excecoes);
    if (pendentes.some((e) => e.excecionavel !== true)) {
      alert('Há erros que impedem a publicação. Corrija os itens em vermelho e tente de novo.');
    } else if (pendentes.length > 0) {
      alert('Há regras violadas. Corrija ou marque a confirmação de exceção de cada uma antes de enviar.');
    } else {
      alert('Marque a ciência de cada aviso antes de enviar.');
    }
    return;
  }
  const textoAviso = (m) => (typeof m === 'string' ? m : m.texto || '');
  const avisoTxt =
    (resultado.avisos || []).length > 0
      ? `\n\nAvisos (com ciência):\n- ${resultado.avisos.map(textoAviso).join('\n- ')}`
      : '';
  const excecoesEnvio = excecoesDaRevalidacao(resultado, estado.excecoes);
  const excecaoTxt = excecoesEnvio.length > 0
    ? `\n\nExceções confirmadas pelo diretor:\n- ${resultado.erros.filter((e) => excecoesEnvio.includes(e.id)).map(textoAviso).join('\n- ')}`
    : '';
  if (!confirm(`Publicar a escala de ${formatarMesTitulo(estado.mes)} no site?${avisoTxt}${excecaoTxt}\n\nIsto grava o atual.json e publica no GitHub.`)) {
    return;
  }

  mostrarOverlay('Fechando e publicando no site...');
  try {
    // Fechamento completo em processo: o servidor revalida, grava os arquivos,
    // atualiza os controles, limpa os insumos, comita só o necessário e envia.
    // Envia o estado por ID (CultoMontagem) e as ciências marcadas.
    const relatorio = await api('/api/fechar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mes: estado.mes,
        cultos: estado.cultos,
        ciencias: [...estado.ciencias],
        excecoes: excecoesEnvio,
      }),
    });
    mostrarRelatorioFechamento(relatorio);
    setStatus('Publicado', 'ok');
  } catch (err) {
    const payload = err.payload || {};
    let extra = '';
    if (Array.isArray(payload.erros) && payload.erros.length) {
      extra = '\n- ' + payload.erros.map((e) => (typeof e === 'string' ? e : e.texto || '')).join('\n- ');
    } else if (Array.isArray(payload.avisosSemCiencia) && payload.avisosSemCiencia.length) {
      extra = '\n- ' + payload.avisosSemCiencia.map((e) => (typeof e === 'string' ? e : e.texto || '')).join('\n- ');
    } else if (Array.isArray(payload.conflitos) && payload.conflitos.length) {
      extra = '\nConflito em: ' + payload.conflitos.join(', ');
    }
    alert('Erro ao fechar: ' + err.message + extra);
  } finally {
    esconderOverlay();
  }
}

/**
 * Mostra o relatório do fechamento e inicia a verificação automática do site
 * (Task 32). Com conflito de sincronização, só informa. Nos demais casos abre
 * a tela de verificação, que consulta o site até os arquivos coincidirem — sem
 * espera fixa de tempo.
 */
function mostrarRelatorioFechamento(relatorio) {
  const r = relatorio || {};
  const cabecalho = `Escala de ${formatarMesTitulo(estado.mes)} fechada! ${r.cultos || 0} cultos no atual.json.`;
  if (r.push === 'conflito') {
    alert(`${cabecalho}\n\nHouve um conflito de sincronização. Nada foi perdido; peça ajuda para juntar as alterações.`);
    return;
  }
  setStatus(cabecalho, 'ok');
  abrirVerificacaoSite();
}

// ---------------------------------------------------------------------------
// Verificação automática do site (Task 32 / RF 24)
// ---------------------------------------------------------------------------

// Estado da verificação: timer da consulta periódica e marca de tempo do início
// (para oferecer "continuar verificando" após 10 minutos).
const verificacao = { timer: null, inicio: 0, ativo: false };

const VERIF_INTERVALO_MS = 15000; // consulta a cada 15 s (RF 24.1)
const VERIF_LIMITE_MS = 10 * 60 * 1000; // 10 min até oferecer continuar (RF 24.4)

/** Abre o modal de verificação e começa a consultar o site. */
function abrirVerificacaoSite() {
  const modal = el('modalVerificacao');
  if (!modal) return;
  verificacao.inicio = Date.now();
  verificacao.ativo = true;
  el('verifEstado').textContent = 'Aguardando publicação...';
  el('verifTabelaWrap').hidden = true;
  el('verifTabelaCorpo').innerHTML = '';
  el('verifErros').hidden = true;
  el('verifErros').innerHTML = '';
  el('btnViEscala').disabled = true;
  el('btnContinuarVerificando').hidden = true;
  el('btnTentarEnvioVerif').hidden = true;
  modal.hidden = false;
  consultarSite();
}

/** Para a consulta periódica (sem fechar o modal). */
function pararVerificacao() {
  verificacao.ativo = false;
  if (verificacao.timer) {
    clearTimeout(verificacao.timer);
    verificacao.timer = null;
  }
}

/** Fecha o modal de verificação e encerra a consulta. */
function fecharVerificacao() {
  pararVerificacao();
  el('modalVerificacao').hidden = true;
}

/** Agenda a próxima consulta em 15 s, respeitando o limite de 10 min. */
function agendarProximaConsulta() {
  if (!verificacao.ativo) return;
  if (Date.now() - verificacao.inicio >= VERIF_LIMITE_MS) {
    // Passou de 10 min sem coincidir: avisa e oferece continuar (RF 24.4).
    pararVerificacao();
    el('verifEstado').textContent =
      'O site ainda não atualizou no tempo esperado. Você pode continuar verificando.';
    el('btnContinuarVerificando').hidden = false;
    return;
  }
  verificacao.timer = setTimeout(consultarSite, VERIF_INTERVALO_MS);
}

/**
 * Consulta POST /api/verificar-site e atualiza a tela conforme o estado:
 *  - pendente_envio: "tentar de novo" (reenvia os commits locais);
 *  - aguardando / erro_rede: continua consultando;
 *  - publicado: mostra a tabela e habilita "vi a escala atualizada";
 *  - erro_conferencia: lista os erros e mantém o botão desabilitado.
 */
async function consultarSite() {
  if (!verificacao.ativo) return;
  let resposta;
  try {
    resposta = await api('/api/verificar-site', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
  } catch {
    // Falha de rede: segue tentando até o limite.
    el('verifEstado').textContent = 'Não consegui consultar o site agora. Tentando de novo...';
    agendarProximaConsulta();
    return;
  }
  aplicarEstadoVerificacao(resposta || {});
}

/** Aplica um resultado de verificação à tela. */
function aplicarEstadoVerificacao(resposta) {
  const estadoVerif = resposta.estado;
  const urlEscala = resposta.url || 'https://natanbudny.github.io/EscalaMusica/';
  const estadoEl = el('verifEstado');
  const tabelaWrap = el('verifTabelaWrap');
  const errosEl = el('verifErros');
  const btnVi = el('btnViEscala');
  const btnContinuar = el('btnContinuarVerificando');
  const btnTentarEnvio = el('btnTentarEnvioVerif');

  tabelaWrap.hidden = true;
  errosEl.hidden = true;
  btnVi.disabled = true;
  btnContinuar.hidden = true;
  btnTentarEnvio.hidden = true;

  if (estadoVerif === 'pendente_envio') {
    pararVerificacao();
    estadoEl.textContent = 'Envio pendente: o push ao GitHub ainda não concluiu.';
    btnTentarEnvio.hidden = false;
    return;
  }

  if (estadoVerif === 'publicado') {
    pararVerificacao();
    estadoEl.textContent = 'A escala já está publicada no site. Confira os links abaixo.';
    preencherTabelaVerificacao(resposta.tabela || []);
    tabelaWrap.hidden = false;
    btnVi.disabled = false;
    btnVi.dataset.url = urlEscala;
    return;
  }

  if (estadoVerif === 'erro_conferencia') {
    pararVerificacao();
    estadoEl.textContent = 'O site atualizou, mas a conferência dos links encontrou problemas. Corrija e publique de novo.';
    preencherErrosVerificacao(resposta.erros || []);
    errosEl.hidden = false;
    return;
  }

  // aguardando / erro_rede: continua consultando.
  estadoEl.textContent = 'Aguardando publicação... (o GitHub Pages leva alguns instantes)';
  agendarProximaConsulta();
}

/** Monta a tabela "nome na escala → número que o link abre". */
function preencherTabelaVerificacao(tabela) {
  const corpo = el('verifTabelaCorpo');
  corpo.innerHTML = '';
  for (const item of tabela) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td>${item.data || ''}</td>` +
      `<td>${item.campo || ''}</td>` +
      `<td>${item.nome || ''}</td>` +
      `<td>${item.numero || '—'}</td>`;
    corpo.appendChild(tr);
  }
  if (tabela.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="4">Nenhum participante de louvor nesta escala.</td>';
    corpo.appendChild(tr);
  }
}

/** Lista os erros da conferência remota. */
function preencherErrosVerificacao(erros) {
  const ul = el('verifErros');
  ul.innerHTML = '';
  for (const e of erros) {
    const li = document.createElement('li');
    li.className = 'erro';
    li.textContent = '⛔ ' + (typeof e === 'string' ? e : e.texto || '');
    ul.appendChild(li);
  }
}

// ---------------------------------------------------------------------------
// Tela de WhatsApp (Task 35 / RF 25)
// ---------------------------------------------------------------------------

// Estado da tela de WhatsApp: envios do mês (GET /api/whatsapp) e as chaves já
// enviadas (Set), persistidas por mês no localStorage.
const whatsapp = { envios: [], enviados: new Set(), urlEscala: '', mesAno: '' };

/** Lê as chaves enviadas do mês do localStorage (Set). */
function lerEnviados(mes) {
  try {
    const bruto = localStorage.getItem(chaveEnviados(mes));
    if (!bruto) return new Set();
    const arr = JSON.parse(bruto);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

/** Grava as chaves enviadas do mês no localStorage. */
function salvarEnviados(mes, enviados) {
  try {
    localStorage.setItem(chaveEnviados(mes), JSON.stringify([...enviados]));
  } catch {
    // localStorage pode falhar (modo privado); segue sem persistir.
  }
}

/**
 * Abre a tela de WhatsApp do mês: busca os envios no servidor, carrega os
 * enviados do localStorage e desenha as listas (RF 25.1-25.7).
 */
async function abrirTelaWhatsapp(urlEscala) {
  whatsapp.urlEscala = urlEscala || 'https://natanbudny.github.io/EscalaMusica/';
  whatsapp.enviados = lerEnviados(estado.mes);
  mostrarOverlay('Montando as mensagens de WhatsApp...');
  let resposta;
  try {
    const query = estado.mes ? `?mes=${encodeURIComponent(estado.mes)}` : '';
    resposta = await api(`/api/whatsapp${query}`);
  } catch (err) {
    esconderOverlay();
    alert('Não consegui montar as mensagens de WhatsApp: ' + err.message);
    return;
  } finally {
    esconderOverlay();
  }
  whatsapp.envios = (resposta && resposta.envios) || [];
  whatsapp.mesAno = (resposta && resposta.mesAno) || '';
  const titulo = el('whatsTitulo');
  if (titulo && resposta && resposta.mesAno) {
    titulo.textContent = `Mensagens de WhatsApp — ${resposta.mesAno}`;
  }
  const avisosEl = el('whatsAvisos');
  const avisos = (resposta && resposta.avisos) || [];
  if (avisos.length) {
    avisosEl.textContent = avisos.join(' · ');
    avisosEl.hidden = false;
  } else {
    avisosEl.hidden = true;
  }
  // Seção "Enviados" começa recolhida.
  el('whatsEnviados').hidden = true;
  el('btnWhatsEnviados').setAttribute('aria-expanded', 'false');
  renderWhatsapp();
  el('modalWhatsapp').hidden = false;
}

/** Fecha a tela de WhatsApp. */
function fecharTelaWhatsapp() {
  el('modalWhatsapp').hidden = true;
}

/**
 * Conclui o mês (Task 36 / RF 27.1): fecha a tela de WhatsApp, apaga o Rascunho
 * do mês do localStorage (RF 19.7) e exibe a animação de conclusão com o link da
 * Escala_Online já verificada.
 */
function concluirMes() {
  fecharTelaWhatsapp();
  // RF 19.7: a tela de conclusão apaga o Rascunho do mês.
  if (estado.mes) apagarRascunho(estado.mes);

  const titulo = el('conclusaoTitulo');
  const mesAno = whatsapp.mesAno || '';
  titulo.textContent = mesAno
    ? `Escala de ${mesAno} concluída, te vejo na próxima`
    : 'Escala concluída, te vejo na próxima';

  const link = el('conclusaoLink');
  const url = whatsapp.urlEscala || 'https://natanbudny.github.io/EscalaMusica/';
  link.href = url;

  el('modalConclusao').hidden = false;
}

/** Fecha a tela de conclusão. */
function fecharConclusao() {
  el('modalConclusao').hidden = true;
}

/** Alterna a visibilidade da seção "Enviados". */
function alternarEnviados() {
  const lista = el('whatsEnviados');
  const botao = el('btnWhatsEnviados');
  const aberto = lista.hidden;
  lista.hidden = !aberto;
  botao.setAttribute('aria-expanded', aberto ? 'true' : 'false');
}

/** Texto curto que descreve o tipo/rótulo de um envio. */
function rotuloEnvio(envio) {
  if (envio.tipo === 'fixo') return envio.rotulo || 'Contato fixo';
  if (envio.tipo === 'convite') return 'Convite do grupo';
  if (envio.tipo === 'grupo') return 'Grupo';
  const funcoes = (envio.funcoes || []).join(', ');
  return funcoes || 'Participante';
}

/** Cria o <li> de um envio, com o botão de ação (abrir ou reenviar). */
function itemEnvio(envio, enviado) {
  const li = document.createElement('li');
  li.className = 'whats-item' + (enviado ? ' whats-item-enviado' : '');

  const info = document.createElement('div');
  info.className = 'whats-item-info';
  const nome = document.createElement('span');
  nome.className = 'whats-item-nome';
  nome.textContent = envio.nome || envio.chave;
  const rotulo = document.createElement('span');
  rotulo.className = 'whats-item-rotulo';
  rotulo.textContent = rotuloEnvio(envio);
  info.appendChild(nome);
  info.appendChild(rotulo);

  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = enviado ? 'control-btn' : 'primary-btn';
  botao.textContent = enviado ? 'Reenviar' : 'Abrir WhatsApp';
  botao.addEventListener('click', () => enviarContato(envio));

  li.appendChild(info);
  li.appendChild(botao);
  return li;
}

/**
 * Abre o link do contato e marca como enviado (RF 25.5). Reenviar mantém o
 * contato em "Enviados" (RF 25.6). O estado por mês fica no localStorage.
 */
function enviarContato(envio) {
  if (envio.link) window.open(envio.link, '_blank', 'noopener');
  whatsapp.enviados = marcarEnviado(whatsapp.enviados, envio.chave);
  salvarEnviados(estado.mes, whatsapp.enviados);
  renderWhatsapp();
}

/** Redesenha as listas de pendentes e enviados. */
function renderWhatsapp() {
  const { pendentes, enviados } = separar(whatsapp.envios, whatsapp.enviados);

  const ulPend = el('whatsPendentes');
  ulPend.innerHTML = '';
  for (const envio of pendentes) ulPend.appendChild(itemEnvio(envio, false));
  el('whatsPendentesContador').textContent = String(pendentes.length);
  el('whatsPendentesVazio').hidden = pendentes.length > 0;

  const ulEnv = el('whatsEnviados');
  ulEnv.innerHTML = '';
  for (const envio of enviados) ulEnv.appendChild(itemEnvio(envio, true));
  el('whatsEnviadosContador').textContent = String(enviados.length);
}

// ---------------------------------------------------------------------------
// Ligações de UI
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Gestão de pessoas (CRUD por tela)
// ---------------------------------------------------------------------------

const gestao = {
  pessoas: [],
  grupos: {},
  ultimaVez: {},
  editandoId: null,
  // Estado da confirmação de salvamento pendente (telefone/avisos).
  pendenteSalvar: null,
};

async function abrirGestao() {
  el('telaMenu').hidden = true;
  el('telaPessoas').hidden = false;
  await carregarListaPessoas();
  await atualizarSync();
  await carregarMigracoes();
}

async function carregarListaPessoas() {
  mostrarOverlay('Carregando pessoas...');
  try {
    const dados = await api('/api/pessoas');
    gestao.pessoas = dados.pessoas;
    gestao.grupos = dados.grupos || {};
    gestao.ultimaVez = dados.ultimaVez || {};
    gestao.migracoesPendentes = dados.migracoesPendentes || [];
    renderListaPessoas();
  } catch (err) {
    alert('Erro ao carregar pessoas: ' + err.message);
  } finally {
    esconderOverlay();
  }
}

/** Lê os filtros avançados ativos do painel. */
function lerFiltros() {
  const funcoes = [...document.querySelectorAll('.f-funcao:checked')].map((c) => c.value);
  const dias = [...document.querySelectorAll('.f-dia:checked')].map((c) => c.value);
  const situacao = el('fSituacao').value || null;
  const afastadoSel = el('fAfastado').value;
  const afastado = afastadoSel === 'sim' ? true : afastadoSel === 'nao' ? false : null;
  const perfil = el('fPerfil').value || null;
  return { funcoes, dias, situacao, afastado, perfil };
}

// ---------------------------------------------------------------------------
// Indicador "não sincronizado" (Task 5)
// ---------------------------------------------------------------------------

/** Consulta o estado da sincronização e atualiza o indicador. */
async function atualizarSync() {
  try {
    const { pendentes } = await api('/api/sync/status');
    mostrarSync(pendentes);
  } catch {
    /* indicador é auxiliar; silencia erros */
  }
}

function mostrarSync(pendentes) {
  const ind = el('syncIndicador');
  if (!ind) return;
  if (pendentes > 0) {
    el('syncTexto').textContent = `não sincronizado (${pendentes})`;
    ind.hidden = false;
  } else {
    ind.hidden = true;
  }
}

/** Reenvia os commits pendentes (botão "tentar de novo"). */
async function tentarDeNovoSync() {
  mostrarOverlay('Reenviando ao GitHub...');
  try {
    const r = await api('/api/sync/tentar-de-novo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    if (r.push === 'conflito') {
      const lista = (r.conflitos || []).join(', ');
      alert(
        `Alterações feitas em outro computador conflitam com: ${lista}.\n` +
          'Nada foi perdido; peça ajuda para juntar as versões.',
      );
    }
  } catch (err) {
    alert('Não foi possível reenviar: ' + err.message);
  } finally {
    esconderOverlay();
    await atualizarSync();
  }
}

// ---------------------------------------------------------------------------
// Migrações pendentes do cadastro (Task 4)
// ---------------------------------------------------------------------------

const migracao = { diferencas: [], pendenciasCaracteres: [], decisoes: {} };

async function carregarMigracoes() {
  const cont = el('migracoesPendentes');
  if (!cont) return;
  cont.innerHTML = '';
  try {
    const dados = await api('/api/migracoes');
    migracao.pendentes = dados.pendentes || [];
    migracao.diferencas = dados.diferencas || [];
    migracao.pendenciasCaracteres = dados.pendenciasCaracteres || [];
    migracao.propostaGrupos = dados.propostaGrupos || [];
    migracao.decisoes = {};
    if (migracao.pendentes.length === 0) return;
    renderMigracoes();
  } catch {
    /* sem migração disponível */
  }
}

/** Itens que exigem decisão do usuário. */
function pendenciasDaMigracao() {
  const pend = [];
  for (const d of migracao.diferencas) {
    if (d.pendencia) pend.push({ chave: d.chave, ...d.pendencia });
  }
  for (const c of migracao.pendenciasCaracteres) pend.push(c);
  return pend;
}

function renderMigracoes() {
  const cont = el('migracoesPendentes');
  cont.innerHTML = '';

  const pendentes = migracao.pendentes || [];

  // Ordem na tela: grupos → contatos → regras por nome.
  if (pendentes.includes('grupos_escalaveis')) {
    cont.appendChild(renderMigracaoGrupos());
  }
  if (pendentes.includes('contatos_para_pessoas')) {
    cont.appendChild(renderMigracaoContatos());
  }
  if (pendentes.includes('regras_por_nome')) {
    cont.appendChild(renderMigracaoRegras());
  }

  atualizarBotaoMigracao();
}

/** Caixa da migração de grupos (FAMILIA NILSINHO e MIN. JOVEM). */
function renderMigracaoGrupos() {
  const box = document.createElement('div');
  box.className = 'migracao-box';
  box.innerHTML =
    '<h3 class="migracao-titulo">Migração de grupos escaláveis</h3>' +
    '<p class="migracao-sub">Cadastre família e ministério como grupos. ' +
    'Aplique esta migração antes da de contatos.</p>';

  const lista = document.createElement('div');
  lista.className = 'migracao-lista';
  for (const g of migracao.propostaGrupos || []) {
    const membros = (g.membros_ids || [])
      .map((id) => (gestao.pessoas.find((p) => p.id === id) || {}).nome || `#${id}`)
      .join(', ');
    const item = document.createElement('div');
    item.className = 'migracao-item ok';
    item.innerHTML = `<b>${g.nome_exibicao}</b> — membros: ${membros} · responsável: ${
      (gestao.pessoas.find((p) => p.id === g.responsavel_id) || {}).nome || '?'
    } · modo ${g.modo}`;
    lista.appendChild(item);
  }
  box.appendChild(lista);

  const acoes = document.createElement('div');
  acoes.className = 'migracao-acoes';
  const btn = document.createElement('button');
  btn.className = 'primary-btn';
  btn.textContent = 'Aplicar migração de grupos';
  btn.addEventListener('click', () => aplicarMigracaoNomeada('grupos_escalaveis', {}));
  acoes.appendChild(btn);
  box.appendChild(acoes);
  return box;
}

/** Caixa da migração de contatos (com pendências). */
function renderMigracaoContatos() {
  const box = document.createElement('div');
  box.className = 'migracao-box';
  box.innerHTML =
    '<h3 class="migracao-titulo">Migração do contatos.json</h3>' +
    '<p class="migracao-sub">O contatos.json passa a ser derivado do cadastro. ' +
    'Decida cada entrada antiga antes de aplicar; nada é perdido.</p>';

  const lista = document.createElement('div');
  lista.className = 'migracao-lista';

  const pendencias = pendenciasDaMigracao();

  // Entradas só no contatos sem pendência (viram pessoa nova automaticamente).
  for (const d of migracao.diferencas) {
    if (d.pendencia || d.tipo !== 'so_no_contatos') continue;
    const item = document.createElement('div');
    item.className = 'migracao-item ok';
    item.innerHTML = `<b>${d.chave}</b> — vira pessoa inativa nova (telefone preservado).`;
    lista.appendChild(item);
  }

  for (const p of pendencias) {
    lista.appendChild(renderPendenciaMigracao(p));
  }

  box.appendChild(lista);

  const acoes = document.createElement('div');
  acoes.className = 'migracao-acoes';
  const btn = document.createElement('button');
  btn.id = 'btnAplicarMigracao';
  btn.className = 'primary-btn';
  btn.textContent = 'Aplicar migração';
  // Desabilitado enquanto a migração de grupos estiver pendente.
  if ((migracao.pendentes || []).includes('grupos_escalaveis')) {
    btn.disabled = true;
    btn.title = 'Aplique a migração de grupos antes.';
  }
  btn.addEventListener('click', aplicarMigracao);
  acoes.appendChild(btn);
  box.appendChild(acoes);
  return box;
}

/** Caixa da migração das regras por nome. */
function renderMigracaoRegras() {
  const box = document.createElement('div');
  box.className = 'migracao-box';
  box.innerHTML =
    '<h3 class="migracao-titulo">Migração das regras por nome</h3>' +
    '<p class="migracao-sub">Traz para o cadastro as regras que hoje estão fixas por nome ' +
    '(dias de ARIADNY/CATHERINE e dependências de MANU, MIRELLA e MARCELA).</p>';
  const acoes = document.createElement('div');
  acoes.className = 'migracao-acoes';
  const btn = document.createElement('button');
  btn.className = 'primary-btn';
  btn.textContent = 'Aplicar regras por nome';
  btn.addEventListener('click', () => aplicarMigracaoNomeada('regras_por_nome', {}));
  acoes.appendChild(btn);
  box.appendChild(acoes);
  return box;
}

/** Aplica uma migração nomeada (grupos ou regras) e recarrega. */
async function aplicarMigracaoNomeada(nome, corpo) {
  mostrarOverlay('Aplicando migração...');
  try {
    await api(`/api/migracoes/${nome}/aplicar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo || {}),
    });
    await carregarListaPessoas();
    await carregarMigracoes();
    await atualizarSync();
  } catch (err) {
    alert('Erro ao aplicar migração: ' + err.message);
  } finally {
    esconderOverlay();
  }
}

function renderPendenciaMigracao(p) {
  const item = document.createElement('div');
  item.className = 'migracao-item pendente';

  const titulo = document.createElement('div');
  titulo.className = 'migracao-item-titulo';
  const motivo =
    p.motivo === 'telefone_compartilhado'
      ? `telefone de ${(p.pessoas || []).map((x) => x.nome).join(', ')}`
      : 'caractere não permitido';
  titulo.innerHTML = `<b>${p.chave}</b> <span class="migracao-motivo">(${motivo})</span>`;
  item.appendChild(titulo);

  for (const opc of p.opcoes) {
    const id = `mig_${p.chave}_${opc.tipo}_${opc.pessoaId || ''}`;
    const linha = document.createElement('label');
    linha.className = 'migracao-opcao';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = `mig_${p.chave}`;
    radio.id = id;
    radio.addEventListener('change', () => {
      migracao.decisoes[p.chave] = montarDecisao(p, opc, item);
      atualizarBotaoMigracao();
    });
    linha.appendChild(radio);
    linha.appendChild(document.createTextNode(` ${opc.rotulo}`));

    // Campo de texto para renomear.
    if (opc.tipo === 'renomear') {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'campo-input migracao-novonome';
      input.placeholder = 'novo nome (sem vírgula nem dígitos)';
      input.dataset.para = p.chave;
      input.addEventListener('input', () => {
        if (migracao.decisoes[p.chave] && migracao.decisoes[p.chave].tipo === 'renomear') {
          migracao.decisoes[p.chave].novoNome = input.value.trim();
          atualizarBotaoMigracao();
        }
      });
      linha.appendChild(input);
    }
    item.appendChild(linha);
  }
  return item;
}

function montarDecisao(p, opc, itemEl) {
  if (opc.tipo === 'apelido_de') return { tipo: 'apelido_de', pessoaId: opc.pessoaId };
  if (opc.tipo === 'pessoa_nova') return { tipo: 'pessoa_nova' };
  if (opc.tipo === 'remover') return { tipo: 'remover' };
  if (opc.tipo === 'renomear') {
    const input = itemEl.querySelector('.migracao-novonome');
    return { tipo: 'renomear', novoNome: (input && input.value.trim()) || '' };
  }
  return { tipo: opc.tipo };
}

/** O botão "Aplicar" fica habilitado só quando toda pendência tem decisão. */
function atualizarBotaoMigracao() {
  const btn = el('btnAplicarMigracao');
  if (!btn) return;
  const pendencias = pendenciasDaMigracao();
  const completa = pendencias.every((p) => {
    const d = migracao.decisoes[p.chave];
    if (!d) return false;
    if (d.tipo === 'renomear') return d.novoNome && d.novoNome.length > 0;
    return true;
  });
  btn.disabled = !completa;
}

async function aplicarMigracao() {
  mostrarOverlay('Aplicando migração...');
  try {
    await api('/api/migracoes/contatos_para_pessoas/aplicar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decisoes: migracao.decisoes }),
    });
    await carregarListaPessoas();
    await carregarMigracoes();
    await atualizarSync();
  } catch (err) {
    alert('Erro ao aplicar migração: ' + err.message);
  } finally {
    esconderOverlay();
  }
}

function renderListaPessoas() {
  const busca = el('buscaPessoas').value || '';
  const lista = el('listaPessoas');
  lista.innerHTML = '';
  const filtradas = filtrarPessoas(gestao.pessoas, busca, lerFiltros()).sort((a, b) =>
    a.nome.localeCompare(b.nome, 'pt-BR'),
  );

  // Contador de resultados.
  const contador = el('contadorPessoas');
  if (contador) contador.textContent = `${filtradas.length} pessoa(s)`;

  if (filtradas.length === 0) {
    lista.innerHTML = '<p class="vazio">Nenhuma pessoa encontrada.</p>';
    return;
  }

  for (const p of filtradas) {
    const row = document.createElement('div');
    row.className = 'pessoa-row' + (p.ativo ? '' : ' inativa');
    const tags = [];
    if (!p.ativo) tags.push('<span class="tag inativo">Inativo</span>');
    if (p.habilitacoes?.regente) tags.push('<span class="tag on">Regente</span>');
    if (p.habilitacoes?.equipe) tags.push('<span class="tag on">Equipe</span>');
    const mm = p.habilitacoes?.mensagem_musical || {};
    if (mm.es || mm.culto || mm.domingo) tags.push('<span class="tag on">Msg. Musical</span>');
    if (p.habilitacoes?.sonoplastia) tags.push('<span class="tag on">Sonoplastia</span>');
    if (p.dias_permitidos && p.dias_permitidos.length) {
      tags.push(`<span class="tag">só ${p.dias_permitidos.join('/')}</span>`);
    }
    if (p.afastado?.ativo) tags.push('<span class="tag inativo">Afastada</span>');
    const apelidos = (p.aliases || []).length ? ` (${p.aliases.join(', ')})` : '';
    const ultima = gestao.ultimaVez[p.id];
    const ultimaTxt = ultima ? brData(ultima) : 'nunca';
    row.innerHTML = `
      <span class="pessoa-nome">${p.nome}<span style="font-weight:500;color:var(--text-muted)">${apelidos}</span></span>
      <span class="pessoa-ultima" title="Última vez escalada">última vez: ${ultimaTxt}</span>
      <span class="pessoa-spacer"></span>
      <span class="pessoa-tags">${tags.join('')}</span>`;
    row.addEventListener('click', () => abrirFormPessoa(p));
    lista.appendChild(row);
  }
}

function abrirFormPessoa(pessoa) {
  gestao.editandoId = pessoa ? pessoa.id : null;
  gestao.telefoneOriginal = pessoa ? (pessoa.telefone || '') : '';
  el('modalPessoaTitulo').textContent = pessoa ? 'Editar pessoa' : 'Nova pessoa';
  el('btnDesativarPessoa').hidden = !pessoa;
  el('btnExcluirPessoa').hidden = !pessoa;
  el('pfErro').hidden = true;

  // Exclusão definitiva: desabilitar com o motivo quando bloqueada (Task 10).
  const btnExcluir = el('btnExcluirPessoa');
  btnExcluir.disabled = false;
  btnExcluir.title = '';
  if (pessoa) atualizarBloqueioExclusao(pessoa.id);

  const p = pessoa || {};
  const hab = p.habilitacoes || {};
  const mm = hab.mensagem_musical || {};
  el('pfNome').value = p.nome || '';
  el('pfAliases').value = (p.aliases || []).join(', ');
  el('pfTelefone').value = p.telefone || '';
  popularContatoVia(p);
  el('pfGenero').value = p.genero || 'F';
  el('pfPerfil').value = p.perfil_canto == null ? '' : p.perfil_canto;
  el('pfAtivo').value = p.ativo === false ? 'false' : 'true';
  el('pfRegente').checked = hab.regente === true;
  el('pfEquipe').checked = hab.equipe === true;
  el('pfMmEs').checked = mm.es === true;
  el('pfMmCulto').checked = mm.culto === true;
  el('pfMmDomingo').checked = mm.domingo === true;
  el('pfSonoplastia').checked = hab.sonoplastia === true;
  const dias = p.dias_permitidos || [];
  el('pfDiaSabado').checked = dias.includes('sabado');
  el('pfDiaDomingo').checked = dias.includes('domingo');
  el('pfLimiteMensal').value = p.limite_mensal == null ? '' : String(p.limite_mensal);
  el('pfAfastado').checked = !!(p.afastado && p.afastado.ativo);
  el('pfAfastadoAte').value = (p.afastado && p.afastado.ate) || '';
  el('pfAfastadoMotivo').value = (p.afastado && p.afastado.motivo) || '';
  el('pfNotas').value = p.notas || '';

  popularVinculos(p);

  el('modalPessoa').hidden = false;
}

/** Preenche os selects de vínculos com as pessoas e grupos do cadastro. */
function popularVinculos(p) {
  const vinculos = p.vinculos || [];
  const sempreJunto = vinculos.filter((v) => v.tipo === 'sempre_junto').map((v) => v.com_id);
  const familia = (vinculos.find((v) => v.tipo === 'familia_requerida') || {}).grupo || '';
  const precisaDe = (vinculos.find((v) => v.tipo === 'precisa_de') || {}).com_ids || [];

  const outras = gestao.pessoas
    .filter((x) => x.id !== p.id)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  const opcoesPessoas = (selecionados) =>
    outras
      .map(
        (x) =>
          `<option value="${x.id}"${selecionados.includes(x.id) ? ' selected' : ''}>${x.nome}</option>`,
      )
      .join('');

  el('pfSempreJunto').innerHTML = opcoesPessoas(sempreJunto);
  el('pfPrecisaDe').innerHTML = opcoesPessoas(precisaDe);

  const grupos = Object.entries(gestao.grupos || {});
  el('pfFamilia').innerHTML =
    '<option value="">(nenhuma)</option>' +
    grupos
      .map(
        ([chave, def]) =>
          `<option value="${chave}"${chave === familia ? ' selected' : ''}>${def.nome_exibicao || chave}</option>`,
      )
      .join('');
}

/**
 * Preenche "WhatsApp de quem?" com as pessoas que têm telefone. Escolher uma
 * pessoa trava o campo telefone: o número passa a ser o dela.
 */
function popularContatoVia(p) {
  const sel = el('pfContatoVia');
  if (!sel) return;
  const comTelefone = gestao.pessoas
    .filter((x) => x.id !== p.id && soDigitos(x.telefone))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  sel.innerHTML =
    '<option value="">Telefone próprio</option>' +
    comTelefone
      .map((x) => `<option value="${x.id}"${x.id === p.contato_via_id ? ' selected' : ''}>WhatsApp de ${escaparHtml(x.nome)}</option>`)
      .join('');
  sel.onchange = atualizarCampoTelefoneVia;
  atualizarCampoTelefoneVia();
}

/** Trava/destrava o telefone conforme "WhatsApp de quem?". */
function atualizarCampoTelefoneVia() {
  const sel = el('pfContatoVia');
  const tel = el('pfTelefone');
  if (!sel || !tel) return;
  const viaId = sel.value ? Number(sel.value) : null;
  if (viaId) {
    const via = gestao.pessoas.find((x) => x.id === viaId);
    tel.value = via ? via.telefone || '' : '';
    tel.disabled = true;
  } else {
    tel.disabled = false;
  }
}

/** Coleta os vínculos escolhidos no formulário. */
function coletarVinculos() {
  const sempreJunto = [...el('pfSempreJunto').selectedOptions].map((o) => Number(o.value));
  const precisaDe = [...el('pfPrecisaDe').selectedOptions].map((o) => Number(o.value));
  const familiaRequerida = el('pfFamilia').value || null;
  return { sempreJunto, precisaDe, familiaRequerida };
}

function fecharFormPessoa() {
  el('modalPessoa').hidden = true;
  gestao.editandoId = null;
  gestao.voltarParaSonoplastia = false;
}

function coletarFormPessoa() {
  const dias = [];
  if (el('pfDiaSabado').checked) dias.push('sabado');
  if (el('pfDiaDomingo').checked) dias.push('domingo');
  return {
    nome: el('pfNome').value,
    aliases: el('pfAliases').value.split(',').map((s) => s.trim()).filter(Boolean),
    telefone: el('pfTelefone').value,
    contato_via_id: el('pfContatoVia') && el('pfContatoVia').value ? Number(el('pfContatoVia').value) : null,
    genero: el('pfGenero').value,
    perfil_canto: el('pfPerfil').value || null,
    ativo: el('pfAtivo').value === 'true',
    habilitacoes: {
      regente: el('pfRegente').checked,
      equipe: el('pfEquipe').checked,
      mensagem_musical: {
        es: el('pfMmEs').checked,
        culto: el('pfMmCulto').checked,
        domingo: el('pfMmDomingo').checked,
      },
      sonoplastia: el('pfSonoplastia').checked,
    },
    dias_permitidos: dias.length ? dias : null,
    limite_mensal: el('pfLimiteMensal').value.trim() === '' ? null : Number(el('pfLimiteMensal').value),
    afastado: el('pfAfastado').checked
      ? { ativo: true, ate: el('pfAfastadoAte').value || null, motivo: el('pfAfastadoMotivo').value || '' }
      : null,
    notas: el('pfNotas').value,
  };
}

/** Só os dígitos de um telefone. */
function soDigitos(t) {
  return String(t || '').replace(/\D/g, '');
}

async function salvarPessoa() {
  const dados = coletarFormPessoa();
  if (!dados.nome.trim()) {
    mostrarErroPessoa('Informe o nome.');
    return;
  }
  el('pfErro').hidden = true;

  // 1) Verifica (sem gravar): erros, avisos e telefone compartilhado.
  let verificacao;
  try {
    verificacao = await api('/api/pessoas/verificar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dados, id: gestao.editandoId }),
    });
  } catch (err) {
    mostrarErroPessoa(err.message);
    return;
  }

  if (verificacao.erros && verificacao.erros.length > 0) {
    mostrarErroPessoa(verificacao.erros.join(' '));
    return;
  }

  // 2) Avisos de duplicidade: pedir confirmação.
  let confirmarAvisos = false;
  if (verificacao.avisos && verificacao.avisos.length > 0) {
    if (!confirm(`Atenção:\n- ${verificacao.avisos.join('\n- ')}\n\nSalvar mesmo assim?`)) {
      return;
    }
    confirmarAvisos = true;
  }

  // 3) Telefone novo/alterado: abrir WhatsApp e confirmar.
  // (Contato via outra pessoa: o número já foi confirmado no cadastro dela.)
  const telNovo = soDigitos(dados.telefone);
  const telAntigo = soDigitos(gestao.telefoneOriginal);
  if (!dados.contato_via_id && telNovo && telNovo !== telAntigo) {
    const ok = await confirmarWhatsApp(telNovo, verificacao.telefoneCompartilhadoCom || []);
    if (!ok) return; // "não": volta ao formulário sem salvar
    await gravarPessoa(dados, { confirmacaoTelefone: true, confirmarAvisos });
    return;
  }

  await gravarPessoa(dados, { confirmacaoTelefone: false, confirmarAvisos });
}

/**
 * Abre https://wa.me/<numero> e pergunta se abriu a pessoa certa.
 * @returns {Promise<boolean>} true = sim, salva; false = não, volta
 */
function confirmarWhatsApp(numero, compartilhadoCom) {
  window.open(`https://wa.me/${numero}`, '_blank', 'noopener');
  return new Promise((resolver) => {
    const modal = el('modalConfirmaZap');
    el('confirmaZapTexto').textContent =
      `Abrimos o WhatsApp do número ${numero}. Abriu a conversa da pessoa certa?`;
    const comp = el('confirmaZapCompartilhado');
    if (compartilhadoCom.length > 0) {
      comp.textContent = `Este número também é usado por ${compartilhadoCom.join(', ')}.`;
      comp.hidden = false;
    } else {
      comp.hidden = true;
    }
    modal.hidden = false;

    const limpar = () => {
      modal.hidden = true;
      el('btnZapSim').removeEventListener('click', sim);
      el('btnZapNao').removeEventListener('click', nao);
    };
    const sim = () => { limpar(); resolver(true); };
    const nao = () => { limpar(); resolver(false); };
    el('btnZapSim').addEventListener('click', sim);
    el('btnZapNao').addEventListener('click', nao);
  });
}

/** Grava a pessoa (POST/PUT) e, em seguida, os vínculos. */
async function gravarPessoa(dados, { confirmacaoTelefone, confirmarAvisos }) {
  mostrarOverlay('Salvando...');
  try {
    const corpo = JSON.stringify({ dados, confirmacaoTelefone, confirmarAvisos });
    let resp;
    if (gestao.editandoId) {
      resp = await api(`/api/pessoas/${gestao.editandoId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: corpo,
      });
    } else {
      resp = await api('/api/pessoas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: corpo,
      });
    }

    // Grava os vínculos da pessoa (agora que ela tem um id).
    const pessoaId = gestao.editandoId || (resp.pessoa && resp.pessoa.id);
    if (pessoaId) {
      await api(`/api/pessoas/${pessoaId}/vinculos`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(coletarVinculos()),
      });
    }

    const voltarSono = gestao.voltarParaSonoplastia === true;
    fecharFormPessoa();
    if (voltarSono) {
      // Atalho "cadastrar pessoa" da tela de sonoplastia: recarrega a tela.
      esconderOverlay();
      await atualizarSync();
      await abrirSonoplastia();
      return;
    }
    await carregarListaPessoas();
    await atualizarSync();
  } catch (err) {
    esconderOverlay();
    mostrarErroPessoa(err.message);
    return;
  }
  esconderOverlay();
}

function mostrarErroPessoa(msg) {
  const e = el('pfErro');
  e.textContent = msg;
  e.hidden = false;
}

async function desativarPessoaAtual() {
  if (!gestao.editandoId) return;
  const pessoa = gestao.pessoas.find((p) => p.id === gestao.editandoId);
  const nome = pessoa ? pessoa.nome : 'esta pessoa';
  if (!confirm(`Desativar ${nome}?\n\nEla some da escala, mas o histórico é preservado.`)) return;
  mostrarOverlay('Desativando...');
  try {
    await api(`/api/pessoas/${gestao.editandoId}/desativar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    fecharFormPessoa();
    await carregarListaPessoas();
    await atualizarSync();
  } catch (err) {
    esconderOverlay();
    mostrarErroPessoa(err.message);
    return;
  }
  esconderOverlay();
}

async function excluirPessoaAtual() {
  if (!gestao.editandoId) return;
  if (el('btnExcluirPessoa').disabled) return;
  const pessoa = gestao.pessoas.find((p) => p.id === gestao.editandoId);
  const nome = pessoa ? pessoa.nome : 'esta pessoa';
  if (!confirm(`Excluir DEFINITIVAMENTE ${nome}?\n\nIsso remove a pessoa do cadastro. Só é possível se ela não tiver vínculos, grupos nem histórico.`)) {
    return;
  }
  mostrarOverlay('Excluindo...');
  try {
    await api(`/api/pessoas/${gestao.editandoId}`, { method: 'DELETE' });
    fecharFormPessoa();
    await carregarListaPessoas();
    await atualizarSync();
  } catch (err) {
    esconderOverlay();
    const motivos = err.payload && err.payload.motivos ? '\n- ' + err.payload.motivos.join('\n- ') : '';
    mostrarErroPessoa(err.message + motivos);
    return;
  }
  esconderOverlay();
}

/**
 * Consulta os motivos que bloqueiam a exclusão definitiva e, quando houver,
 * desabilita o botão "Excluir definitivamente" mostrando o motivo no tooltip.
 */
async function atualizarBloqueioExclusao(id) {
  const btn = el('btnExcluirPessoa');
  try {
    const { motivos } = await api(`/api/pessoas/${id}/motivos-exclusao`);
    // Ignora respostas de uma pessoa diferente (troca de formulário rápida).
    if (gestao.editandoId !== id) return;
    if (motivos && motivos.length > 0) {
      btn.disabled = true;
      btn.title = 'Não é possível excluir: ' + motivos.join(' ');
    } else {
      btn.disabled = false;
      btn.title = '';
    }
  } catch {
    // Em caso de erro, mantém o botão habilitado: a API ainda bloqueia no DELETE.
    btn.disabled = false;
    btn.title = '';
  }
}

// ---------------------------------------------------------------------------
// Grupos escaláveis (Task 8)
// ---------------------------------------------------------------------------

const grupoEstado = { editandoChave: null };

async function abrirGrupos() {
  el('telaPessoas').hidden = true;
  el('telaGrupos').hidden = false;
  // Garante dados de pessoas carregados para os selects.
  if (!gestao.pessoas.length) await carregarListaPessoas();
  else await recarregarGrupos();
  renderListaGrupos();
}

async function recarregarGrupos() {
  const dados = await api('/api/pessoas');
  gestao.pessoas = dados.pessoas;
  gestao.grupos = dados.grupos || {};
}

/** Só os grupos escaláveis (escalavel === true). */
function gruposEscalaveisUI() {
  return Object.entries(gestao.grupos || {}).filter(([, def]) => def && def.escalavel === true);
}

function renderListaGrupos() {
  const lista = el('listaGrupos');
  lista.innerHTML = '';
  const grupos = gruposEscalaveisUI();
  if (grupos.length === 0) {
    lista.innerHTML = '<p class="vazio">Nenhum grupo escalável cadastrado.</p>';
    return;
  }
  for (const [chave, def] of grupos) {
    const resp = gestao.pessoas.find((p) => p.id === def.responsavel_id);
    const row = document.createElement('div');
    row.className = 'pessoa-row';
    const membros = (def.membros_ids || [])
      .map((id) => (gestao.pessoas.find((p) => p.id === id) || {}).nome || `#${id}`)
      .join(', ');
    row.innerHTML = `
      <span class="pessoa-nome">${def.nome_exibicao || chave}</span>
      <span class="pessoa-ultima">resp.: ${resp ? resp.nome : '?'} · ${def.modo || 'funcao'}</span>
      <span class="pessoa-spacer"></span>
      <span class="pessoa-tags"><span class="tag">${membros}</span></span>`;
    row.addEventListener('click', () => abrirFormGrupo(chave, def));
    lista.appendChild(row);
  }
}

function abrirFormGrupo(chave, def) {
  grupoEstado.editandoChave = chave || null;
  el('modalGrupoTitulo').textContent = chave ? 'Editar grupo' : 'Novo grupo';
  el('btnRemoverGrupo').hidden = !chave;
  el('gfErro').hidden = true;

  const d = def || {};
  el('gfNome').value = d.nome_exibicao || '';
  el('gfChave').value = chave || '';
  el('gfChave').disabled = !!chave;
  el('gfModo').value = d.modo || 'funcao';
  el('gfMensagem').value = d.mensagem || '';

  const ordenadas = [...gestao.pessoas].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const membros = d.membros_ids || [];
  el('gfMembros').innerHTML = ordenadas
    .map((p) => `<option value="${p.id}"${membros.includes(p.id) ? ' selected' : ''}>${p.nome}</option>`)
    .join('');
  el('gfResponsavel').innerHTML = ordenadas
    .map((p) => `<option value="${p.id}"${p.id === d.responsavel_id ? ' selected' : ''}>${p.nome}</option>`)
    .join('');

  const funcoes = d.funcoes || ['mm'];
  for (const c of document.querySelectorAll('.gf-funcao')) {
    c.checked = funcoes.includes(c.value);
  }

  el('modalGrupo').hidden = false;
}

function fecharFormGrupo() {
  el('modalGrupo').hidden = true;
  grupoEstado.editandoChave = null;
}

async function salvarGrupoUI() {
  const chaveDigitada = (el('gfChave').value || '').trim();
  const chave = grupoEstado.editandoChave || chaveDigitada;
  if (!chave) {
    el('gfErro').textContent = 'Informe a chave interna do grupo.';
    el('gfErro').hidden = false;
    return;
  }
  const dados = {
    nome_exibicao: el('gfNome').value.trim(),
    membros_ids: [...el('gfMembros').selectedOptions].map((o) => Number(o.value)),
    responsavel_id: Number(el('gfResponsavel').value),
    modo: el('gfModo').value,
    funcoes: [...document.querySelectorAll('.gf-funcao:checked')].map((c) => c.value),
    mensagem: el('gfMensagem').value.trim() || null,
  };
  mostrarOverlay('Salvando grupo...');
  try {
    await api(`/api/grupos/${encodeURIComponent(chave)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(dados),
    });
    fecharFormGrupo();
    await recarregarGrupos();
    renderListaGrupos();
    await atualizarSync();
  } catch (err) {
    esconderOverlay();
    el('gfErro').textContent = err.message;
    el('gfErro').hidden = false;
    return;
  }
  esconderOverlay();
}

async function removerGrupoUI() {
  if (!grupoEstado.editandoChave) return;
  if (!confirm('Remover este grupo? (Não exclui as pessoas.)')) return;
  mostrarOverlay('Removendo grupo...');
  try {
    await api(`/api/grupos/${encodeURIComponent(grupoEstado.editandoChave)}`, { method: 'DELETE' });
    fecharFormGrupo();
    await recarregarGrupos();
    renderListaGrupos();
    await atualizarSync();
  } catch (err) {
    esconderOverlay();
    el('gfErro').textContent = err.message;
    el('gfErro').hidden = false;
    return;
  }
  esconderOverlay();
}

// ---------------------------------------------------------------------------
// Tela de regras e parâmetros (Task 13)
// ---------------------------------------------------------------------------

const regrasEstado = { catalogo: [], parametros: null };

const CATEGORIA_LABEL = {
  fundamentais: 'Regras fundamentais',
  preferencias: 'Preferências',
  restricoes_pessoais: 'Restrições pessoais',
  papeis: 'Papéis',
  glossario: 'Glossário',
};

const PESO_LABEL = {
  contadorRotacao: 'Contador de rotação',
  penalConsecutivo: 'Penalidade consecutivo',
  penalMesmoMes: 'Penalidade mesmo mês',
  bonusGrupoRegente: 'Bônus grupo do regente',
  penalPerfilParticipacao: 'Penalidade perfil participação',
  penalRepeticaoRegente: 'Penalidade repetição de regente',
  diasDesdeUltima: 'Dias desde a última',
};

/** Nome em português de cada regra de parametros.json (editor de níveis). */
const REGRA_PARAM_LABEL = {
  indisponibilidade: 'Escalar quem votou que não pode (enquete)',
  conflito_sonoplastia: 'Pessoa na sonoplastia do mesmo culto',
  conflito_regencia: 'Regente em outra função do mesmo culto',
  repeticao_no_culto: 'Mesma pessoa em duas funções do culto',
  conflito_pregador: 'Pregador do culto cantando no louvor',
  equipe_e_mm_mesmo_culto: 'Equipe e mensagem musical no mesmo culto',
  minimo_homens: 'Equipe sem o mínimo de homens',
  mm_por_mes: 'Mais mensagens musicais no mês que o máximo',
  consecutivo: 'Cantou no culto anterior',
  equipe_incompleta: 'Equipe incompleta',
  regente_vazio: 'Culto sem regente',
  mm_vazia: 'Mensagem musical vazia',
  vinculo: 'Casal, família ou "precisa de" sem a outra pessoa no culto',
  limite_mensal: 'Passou do limite de escalas no mês (cadastro da pessoa)',
};

function escaparHtml(texto) {
  return String(texto == null ? '' : texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function abrirRegras() {
  el('telaMenu').hidden = true;
  el('telaRegras').hidden = false;
  mostrarOverlay('Carregando regras...');
  try {
    const dados = await api('/api/regras');
    regrasEstado.catalogo = dados.regras || [];
    const paramResp = await api('/api/parametros');
    regrasEstado.parametros = paramResp.parametros;
    mostrarAvisoParametros(paramResp.avisos || []);
    preencherEditorParametros(paramResp.parametros);
    await carregarMensagensUI();
    renderListaRegras();
  } catch (err) {
    alert('Erro ao carregar regras: ' + err.message);
  } finally {
    esconderOverlay();
  }
}

function mostrarAvisoParametros(avisos) {
  const box = el('regrasAvisoParametros');
  if (!box) return;
  if (avisos && avisos.length) {
    box.innerHTML = `<strong>Atenção:</strong> ${avisos.map(escaparHtml).join(' ')}`;
    box.hidden = false;
  } else {
    box.hidden = true;
  }
}

function preencherEditorParametros(p) {
  el('paramEquipeTamanho').value = (p.equipe && p.equipe.tamanho) || 5;
  el('paramJanelaMeses').value = (p.historico && p.historico.janela_meses) || 4;
  el('paramMmSabado').value =
    (p.regras && p.regras.mm_sabado && p.regras.mm_sabado.valores && p.regras.mm_sabado.valores.quantidade) || 2;
  el('paramMinHomens').value =
    (p.regras && p.regras.minimo_homens && p.regras.minimo_homens.valores && p.regras.minimo_homens.valores.minimo) || 1;

  // Nível de cada regra (bloqueio/aviso) e se está ligada. Regras sem nível
  // (ex.: mm_sabado, que só tem valores) ficam fora desta tabela.
  const niveisBox = el('regrasNiveis');
  if (niveisBox) {
    niveisBox.innerHTML = '';
    for (const [chave, def] of Object.entries((p && p.regras) || {})) {
      if (!def || !def.nivel) continue;
      const refs = (def.refs || []).length ? ` <small>(${escaparHtml(def.refs.join(', '))})</small>` : '';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escaparHtml(REGRA_PARAM_LABEL[chave] || chave)}${refs}</td>
        <td><input type="checkbox" class="param-ativa" data-regra="${escaparHtml(chave)}"${def.ativa === true ? ' checked' : ''} /></td>
        <td>
          <select class="campo-input param-nivel" data-regra="${escaparHtml(chave)}">
            <option value="bloqueio"${def.nivel === 'bloqueio' ? ' selected' : ''}>Bloqueio</option>
            <option value="aviso"${def.nivel === 'aviso' ? ' selected' : ''}>Aviso</option>
          </select>
        </td>`;
      niveisBox.appendChild(tr);
    }
  }

  const pesosBox = el('regrasPesos');
  pesosBox.innerHTML = '';
  const pesos = (p.score && p.score.pesos) || {};
  for (const [chave, valor] of Object.entries(pesos)) {
    const campo = document.createElement('div');
    campo.className = 'form-campo';
    campo.innerHTML = `
      <label class="campo-label">${escaparHtml(PESO_LABEL[chave] || chave)}</label>
      <input type="number" step="0.1" class="campo-input param-peso" data-peso="${escaparHtml(chave)}" value="${valor}" />`;
    pesosBox.appendChild(campo);
  }
}

function renderListaRegras() {
  const lista = el('listaRegras');
  lista.innerHTML = '';
  const busca = (el('buscaRegras').value || '').trim().toLowerCase();

  const filtradas = regrasEstado.catalogo.filter((e) => {
    if (!busca) return true;
    const alvo = `${e.id} ${Object.values(e.textos || {}).join(' ')}`.toLowerCase();
    return alvo.includes(busca);
  });

  const porCategoria = new Map();
  for (const e of filtradas) {
    if (!porCategoria.has(e.categoria)) porCategoria.set(e.categoria, []);
    porCategoria.get(e.categoria).push(e);
  }

  if (filtradas.length === 0) {
    lista.innerHTML = '<p class="vazio">Nenhuma regra encontrada.</p>';
    return;
  }

  for (const [categoria, entradas] of porCategoria) {
    const secao = document.createElement('div');
    secao.className = 'regras-categoria';
    secao.innerHTML = `<h3 class="regras-categoria-titulo">${escaparHtml(CATEGORIA_LABEL[categoria] || categoria)}</h3>`;
    for (const entrada of entradas) secao.appendChild(cardRegra(entrada));
    lista.appendChild(secao);
  }
}

function cardRegra(entrada) {
  const card = document.createElement('div');
  card.className = 'regra-card';

  const campos = Object.entries(entrada.textos || {});
  const camposHtml = campos
    .map(
      ([campo, valor]) => `
      <label class="campo-label">${escaparHtml(campo)}</label>
      <textarea class="campo-input regra-texto" data-campo="${escaparHtml(campo)}" rows="2">${escaparHtml(valor)}</textarea>`,
    )
    .join('');

  const paramsHtml =
    entrada.parametros && entrada.parametros.length
      ? `<div class="regra-params">${entrada.parametros
          .map((chave) => cardRegraParam(chave))
          .join('')}</div>`
      : '';

  card.innerHTML = `
    <div class="regra-cabecalho">
      <span class="regra-id">${escaparHtml(entrada.id)}</span>
      ${entrada.pessoa ? `<span class="regra-pessoa">${escaparHtml(entrada.pessoa)}</span>` : ''}
      <span class="toolbar-spacer"></span>
      <button class="control-btn regra-historico" type="button">Histórico</button>
      <button class="primary-btn regra-salvar" type="button">Salvar</button>
    </div>
    ${camposHtml || '<p class="campo-hint">Sem texto editável.</p>'}
    ${paramsHtml}
    <p class="regra-erro form-erro" hidden></p>`;

  if (campos.length) {
    card.querySelector('.regra-salvar').addEventListener('click', () => salvarRegra(entrada, card));
  } else {
    card.querySelector('.regra-salvar').remove();
  }
  card.querySelector('.regra-historico').addEventListener('click', () => abrirHistoricoRegra(entrada.id));
  return card;
}

/** Mostra um parâmetro que referencia a regra (ativa, nível, valores). */
function cardRegraParam(chave) {
  const p = regrasEstado.parametros;
  const def = (p && p.regras && p.regras[chave]) || {};
  const ativa = def.ativa === true ? 'ativa' : 'inativa';
  const nivel = def.nivel ? `· ${def.nivel}` : '';
  const valores = def.valores ? `· ${JSON.stringify(def.valores)}` : '';
  return `<span class="regra-param-chip">${escaparHtml(chave)}: ${ativa} ${nivel} ${valores}</span>`;
}

async function salvarRegra(entrada, card) {
  const textos = {};
  for (const ta of card.querySelectorAll('.regra-texto')) {
    textos[ta.dataset.campo] = ta.value;
  }
  const erroEl = card.querySelector('.regra-erro');
  erroEl.hidden = true;
  mostrarOverlay('Salvando regra...');
  try {
    await api(`/api/regras/${encodeURIComponent(entrada.id)}/texto`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ textos }),
    });
    await abrirRegras();
  } catch (err) {
    esconderOverlay();
    erroEl.textContent = err.message;
    erroEl.hidden = false;
  }
}

async function abrirHistoricoRegra(id) {
  mostrarOverlay('Carregando histórico...');
  try {
    const { versoes } = await api(`/api/regras/${encodeURIComponent(id)}/historico`);
    el('modalHistoricoTitulo').textContent = `Histórico de ${id}`;
    const lista = el('historicoLista');
    lista.innerHTML = '';
    if (!versoes.length) {
      lista.innerHTML = '<p class="vazio">Sem versões ainda. A primeira edição grava o texto original.</p>';
    }
    for (const v of versoes) {
      const item = document.createElement('div');
      item.className = 'historico-item';
      const data = (v.criado_em || '').slice(0, 10);
      const textoResumo = Object.values(v.textos || {}).join(' · ');
      item.innerHTML = `
        <div class="historico-cabecalho">
          <span class="historico-num">v${v.numero}</span>
          <span class="historico-meta">${escaparHtml(data)} · ${escaparHtml(v.autor || '')} · ${escaparHtml(v.origem || '')}</span>
          <span class="toolbar-spacer"></span>
          <button class="control-btn historico-reverter" data-num="${v.numero}" type="button">Reverter</button>
        </div>
        <p class="historico-texto">${escaparHtml(textoResumo)}</p>`;
      item.querySelector('.historico-reverter').addEventListener('click', () => reverterRegra(id, v.numero));
      lista.appendChild(item);
    }
    el('modalHistorico').hidden = false;
  } catch (err) {
    alert('Erro ao carregar histórico: ' + err.message);
  } finally {
    esconderOverlay();
  }
}

async function reverterRegra(id, numero) {
  mostrarOverlay('Revertendo...');
  try {
    await api(`/api/regras/${encodeURIComponent(id)}/reverter`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ numero }),
    });
    el('modalHistorico').hidden = true;
    await abrirRegras();
  } catch (err) {
    esconderOverlay();
    alert('Erro ao reverter: ' + err.message);
  }
}

async function salvarParametrosUI() {
  const p = JSON.parse(JSON.stringify(regrasEstado.parametros));
  p.equipe = p.equipe || {};
  p.equipe.tamanho = Number(el('paramEquipeTamanho').value);
  p.historico = p.historico || {};
  p.historico.janela_meses = Number(el('paramJanelaMeses').value);
  if (p.regras && p.regras.mm_sabado) {
    p.regras.mm_sabado.valores = { ...(p.regras.mm_sabado.valores || {}), quantidade: Number(el('paramMmSabado').value) };
  }
  if (p.regras && p.regras.minimo_homens) {
    p.regras.minimo_homens.valores = { ...(p.regras.minimo_homens.valores || {}), minimo: Number(el('paramMinHomens').value) };
  }
  for (const cb of document.querySelectorAll('.param-ativa')) {
    const def = p.regras && p.regras[cb.dataset.regra];
    if (def) def.ativa = cb.checked;
  }
  for (const sel of document.querySelectorAll('.param-nivel')) {
    const def = p.regras && p.regras[sel.dataset.regra];
    if (def) def.nivel = sel.value;
  }
  p.score = p.score || {};
  p.score.pesos = { ...(p.score.pesos || {}) };
  for (const input of document.querySelectorAll('.param-peso')) {
    p.score.pesos[input.dataset.peso] = Number(input.value);
  }

  mostrarOverlay('Salvando parâmetros...');
  try {
    await api('/api/parametros', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parametros: p }),
    });
    await abrirRegras();
  } catch (err) {
    esconderOverlay();
    alert('Erro ao salvar parâmetros: ' + (err.message || '') + (err.payload && err.payload.problemas ? '\n- ' + err.payload.problemas.join('\n- ') : ''));
  }
}

// ---------------------------------------------------------------------------
// Mensagens de WhatsApp editáveis (Task 33)
// ---------------------------------------------------------------------------

const mensagensEstado = { mensagens: null };

/** Carrega e preenche o card de mensagens (chamado dentro de abrirRegras). */
async function carregarMensagensUI() {
  try {
    const resp = await api('/api/mensagens-whatsapp');
    mensagensEstado.mensagens = resp.mensagens;
    preencherMensagensUI(resp.mensagens, resp.avisos || []);
  } catch (err) {
    const box = el('mensagensAviso');
    if (box) {
      box.innerHTML = `<strong>Atenção:</strong> ${escaparHtml(err.message)}`;
      box.hidden = false;
    }
  }
}

function preencherMensagensUI(m, avisos) {
  const box = el('mensagensAviso');
  if (box) {
    if (avisos && avisos.length) {
      box.innerHTML = `<strong>Atenção:</strong> ${avisos.map(escaparHtml).join(' ')}`;
      box.hidden = false;
    } else {
      box.hidden = true;
    }
  }
  const t = (m && m.templates) || {};
  el('msgTemplatePessoa').value = t.pessoa || '';
  el('msgTemplateGrupo').value = t.grupo || '';
  el('msgTemplateCultoInteiro').value = t.culto_inteiro || '';
  el('msgTemplateFixo').value = t.fixo || '';
  el('msgGrupoLouvor').value = (m && m.grupo_louvor) || '';
  renderMsgFixos((m && m.fixos) || []);
  atualizarPreviaMensagem();
}

function renderMsgFixos(fixos) {
  const cont = el('msgFixos');
  cont.innerHTML = '';
  for (const f of fixos) cont.appendChild(linhaMsgFixo(f.nome || '', f.rotulo || ''));
}

function linhaMsgFixo(nome, rotulo) {
  const linha = document.createElement('div');
  linha.className = 'msg-fixo-linha';
  linha.innerHTML = `
    <input type="text" class="campo-input msg-fixo-nome" placeholder="NOME" value="${escaparHtml(nome)}" />
    <input type="text" class="campo-input msg-fixo-rotulo" placeholder="Rótulo (opcional)" value="${escaparHtml(rotulo)}" />
    <button class="control-btn msg-fixo-remover" type="button" title="Remover">&times;</button>`;
  linha.querySelector('.msg-fixo-remover').addEventListener('click', () => linha.remove());
  return linha;
}

/** Lê o card e monta o objeto de mensagens. */
function lerMensagensUI() {
  const fixos = [];
  for (const linha of el('msgFixos').querySelectorAll('.msg-fixo-linha')) {
    const nome = linha.querySelector('.msg-fixo-nome').value.trim();
    const rotulo = linha.querySelector('.msg-fixo-rotulo').value.trim();
    if (nome) fixos.push(rotulo ? { nome, rotulo } : { nome });
  }
  return {
    versao: (mensagensEstado.mensagens && mensagensEstado.mensagens.versao) || 1,
    templates: {
      pessoa: el('msgTemplatePessoa').value,
      grupo: el('msgTemplateGrupo').value,
      culto_inteiro: el('msgTemplateCultoInteiro').value,
      fixo: el('msgTemplateFixo').value,
    },
    fixos,
    grupo_louvor: el('msgGrupoLouvor').value.trim(),
  };
}

/** Prévia com um exemplo (preenche o template "pessoa" no cliente). */
function atualizarPreviaMensagem() {
  const template = el('msgTemplatePessoa').value || '';
  const exemplo = template
    .replaceAll('{nome}', 'Dany Kallas')
    .replaceAll('{mes/ano}', 'agosto/2026')
    .replaceAll('{funções}', '*REGENTE LOUVOR* e *EQUIPE LOUVOR*')
    .replaceAll('{data}', '23/08')
    .replaceAll('{grupo}', 'FAMILIA NILSINHO');
  el('msgPrevia').textContent = exemplo;
}

async function abrirHistoricoMensagens() {
  mostrarOverlay('Carregando histórico...');
  try {
    const { versoes } = await api('/api/mensagens-whatsapp/historico');
    el('modalHistoricoTitulo').textContent = 'Histórico das mensagens de WhatsApp';
    const lista = el('historicoLista');
    lista.innerHTML = '';
    if (!versoes.length) {
      lista.innerHTML = '<p class="vazio">Sem versões ainda. A primeira edição grava a versão 1.</p>';
    }
    for (const v of versoes) {
      const item = document.createElement('div');
      item.className = 'historico-item';
      const data = (v.criado_em || '').slice(0, 10);
      const resumo = (v.conteudo && v.conteudo.templates && v.conteudo.templates.pessoa) || '';
      item.innerHTML = `
        <div class="historico-cabecalho">
          <span class="historico-num">v${v.numero}</span>
          <span class="historico-meta">${escaparHtml(data)} · ${escaparHtml(v.autor || '')} · ${escaparHtml(v.origem || '')}</span>
          <span class="toolbar-spacer"></span>
          <button class="control-btn historico-reverter" data-num="${v.numero}" type="button">Reverter</button>
        </div>
        <p class="historico-texto">${escaparHtml(resumo)}</p>`;
      item.querySelector('.historico-reverter').addEventListener('click', () => reverterMensagensUI(v.numero));
      lista.appendChild(item);
    }
    el('modalHistorico').hidden = false;
  } catch (err) {
    alert('Erro ao carregar histórico: ' + err.message);
  } finally {
    esconderOverlay();
  }
}

async function reverterMensagensUI(numero) {
  mostrarOverlay('Revertendo...');
  try {
    await api('/api/mensagens-whatsapp/reverter', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ numero }),
    });
    el('modalHistorico').hidden = true;
    await abrirRegras();
  } catch (err) {
    esconderOverlay();
    alert('Erro ao reverter: ' + err.message);
  }
}

async function salvarMensagensUI() {
  const erroEl = el('msgErro');
  erroEl.hidden = true;
  const mensagens = lerMensagensUI();
  mostrarOverlay('Salvando mensagens...');
  try {
    await api('/api/mensagens-whatsapp', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mensagens }),
    });
    await abrirRegras();
  } catch (err) {
    esconderOverlay();
    const problemas = err.payload && err.payload.problemas ? '\n- ' + err.payload.problemas.join('\n- ') : '';
    erroEl.textContent = (err.message || 'Erro ao salvar') + problemas;
    erroEl.hidden = false;
  }
}

// ---------------------------------------------------------------------------
// Ajustar escala publicada (Task 37 / RF 28)
// ---------------------------------------------------------------------------

// Estado da tela de ajuste: mês publicado, linhas cruas de atual.json, cultos
// por ID (de /api/dados), pessoas e grupos para o seletor, culto e campo
// escolhidos, ocupantes em edição, última prévia e ciências marcadas.
const ajuste = {
  mes: null,
  linhas: [],
  cultos: [], // CultoMontagem por ID (de /api/dados.publicada)
  pessoas: [], // { id, nome } ativos
  grupos: {}, // chave -> { chave, nome_exibicao, ... }
  dataIso: null, // culto escolhido (AAAA-MM-DD)
  campo: 'REGENTE LOUVOR',
  ocupantes: [], // lista de ocupantes (id | 'grupo:<chave>') em edição
  previa: null, // { erros, avisos, conferencia }
  ciencias: new Set(),
  excecoes: new Set(), // ids de bloqueio de regra liberados pelo diretor
};

const AJUSTE_CAMPOS_NOME = new Set(['REGENTE LOUVOR', 'EQUIPE LOUVOR', 'MENSAGEM MUSICAL']);

/** "DD/MM/AAAA" → "AAAA-MM-DD" (ou null). */
function ajusteDataIso(dataBR) {
  const m = String(dataBR || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** Nome de um ocupante para exibição na tela de ajuste (pessoa ou grupo). */
function ajusteNomeOcupante(ocupante) {
  if (ocupante == null || ocupante === '') return '';
  if (typeof ocupante === 'object') {
    // Vindo de cultosDeAtual quando o nome não está no cadastro.
    return ocupante.foraDoCadastro || '';
  }
  if (typeof ocupante === 'string' && ocupante.startsWith('grupo:')) {
    const g = ajuste.grupos[ocupante.slice('grupo:'.length)];
    return g ? g.nome_exibicao : ocupante;
  }
  const p = ajuste.pessoas.find((x) => x.id === ocupante);
  return p ? p.nome : String(ocupante);
}

/** Abre a tela de ajuste: lista os cultos de atual.json e carrega o cadastro. */
async function abrirAjustePublicada() {
  el('telaMenu').hidden = true;
  el('telaAjuste').hidden = false;
  el('ajusteVazio').hidden = true;
  el('ajusteLayout').hidden = true;
  el('ajusteEditor').hidden = true;
  mostrarOverlay('Carregando escala publicada...');
  try {
    const { mes, linhas } = await api('/api/publicada');
    ajuste.mes = mes;
    ajuste.linhas = Array.isArray(linhas) ? linhas : [];
    ajuste.cultos = [];
    ajuste.pessoas = [];
    ajuste.grupos = {};
    ajuste.dataIso = null;
    ajuste.previa = null;
    ajuste.ciencias = new Set();
  ajuste.excecoes = new Set();

    if (!mes || ajuste.linhas.length === 0) {
      el('ajusteVazio').hidden = false;
      return;
    }

    // Cadastro (pessoas ativas e grupos) e cultos por ID para pré-preencher os
    // campos de nome com os ocupantes atuais.
    const dados = await api(`/api/dados?mes=${encodeURIComponent(mes)}`);
    ajuste.pessoas = (dados.pessoas || []).slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
    ajuste.grupos = dados.grupos || {};
    ajuste.cultos = Array.isArray(dados.publicada) ? dados.publicada : [];

    renderAjusteListaCultos();
    el('ajusteLayout').hidden = false;
  } catch (err) {
    alert('Erro ao carregar a escala publicada: ' + err.message);
  } finally {
    esconderOverlay();
  }
}

/** Lista os cultos de louvor de atual.json (os únicos com campos editáveis). */
function renderAjusteListaCultos() {
  const lista = el('ajusteListaCultos');
  lista.innerHTML = '';
  for (const linha of ajuste.linhas) {
    const iso = ajusteDataIso(linha.DATA);
    if (!iso) continue;
    const li = document.createElement('li');
    li.className = 'ajuste-culto-item' + (ajuste.dataIso === iso ? ' ativo' : '');
    const dia = linha['DIA SEMANA'] || '';
    li.innerHTML = `<span class="ajuste-culto-data">${escaparHtml(linha.DATA)}</span>
      <span class="ajuste-culto-dia">${escaparHtml(dia)}</span>`;
    li.addEventListener('click', () => selecionarCultoAjuste(iso));
    lista.appendChild(li);
  }
}

/** Seleciona um culto para ajustar e mostra o editor de campo. */
function selecionarCultoAjuste(iso) {
  ajuste.dataIso = iso;
  ajuste.previa = null;
  ajuste.ciencias = new Set();
  ajuste.excecoes = new Set();
  el('ajustePainelRevalidacao').hidden = true;
  el('ajustePainelRevalidacao').innerHTML = '';
  renderAjusteListaCultos();

  const linha = ajuste.linhas.find((l) => ajusteDataIso(l.DATA) === iso);
  const dia = linha ? linha['DIA SEMANA'] : '';
  el('ajusteEditorTitulo').textContent = `${linha ? linha.DATA : ''} · ${dia}`;
  el('ajusteEditor').hidden = false;

  // Volta ao primeiro campo sempre que troca de culto.
  el('ajusteCampo').value = 'REGENTE LOUVOR';
  ajuste.campo = 'REGENTE LOUVOR';
  carregarCampoAjuste();
}

/** CultoMontagem por ID do culto escolhido (de /api/dados), ou null. */
function cultoAjusteAtual() {
  return ajuste.cultos.find((c) => c.data === ajuste.dataIso) || null;
}

/** Preenche o editor conforme o campo escolhido, lendo o valor atual. */
function carregarCampoAjuste() {
  const campo = ajuste.campo;
  const linha = ajuste.linhas.find((l) => ajusteDataIso(l.DATA) === ajuste.dataIso);
  const culto = cultoAjusteAtual();

  // Alterna os três editores.
  el('ajusteCampoNome').hidden = !AJUSTE_CAMPOS_NOME.has(campo);
  el('ajusteCampoObs').hidden = campo !== 'OBS';
  el('ajusteCampoAcomp').hidden = campo !== 'ACOMP';

  // Zera a prévia (trocou de campo): precisa prever de novo antes de salvar.
  ajuste.previa = null;
  ajuste.ciencias = new Set();
  ajuste.excecoes = new Set();
  el('ajustePainelRevalidacao').hidden = true;
  el('ajustePainelRevalidacao').innerHTML = '';
  atualizarBotaoSalvarAjuste();

  if (AJUSTE_CAMPOS_NOME.has(campo)) {
    ajuste.ocupantes = ocupantesAtuaisDoCampo(culto, campo);
    renderAjusteSeletorOcupante();
    renderAjusteOcupantes();
    return;
  }
  if (campo === 'OBS') {
    const obs = linha ? linha.OBS || '' : '';
    el('ajusteObs').value = obs;
    validarObsCard(obs, el('ajusteObsProblemas'), { imediato: true });
    return;
  }
  if (campo === 'ACOMP') {
    el('ajusteAcomp').value = (linha && linha.ACOMP) || 'PB';
    return;
  }
}

/** Ocupantes atuais (ids / 'grupo:<chave>') de um campo de nome do culto. */
function ocupantesAtuaisDoCampo(culto, campo) {
  if (!culto) return [];
  if (campo === 'REGENTE LOUVOR') {
    return culto.regente != null && culto.regente !== '' ? [culto.regente] : [];
  }
  if (campo === 'EQUIPE LOUVOR') {
    return Array.isArray(culto.equipe) ? culto.equipe.slice() : [];
  }
  // MENSAGEM MUSICAL: sábado tem mm_es + mm_culto; domingo tem mm_domingo.
  const mm = culto.mm || {};
  const modelo = culto.modelo_louvor || '';
  if (modelo === 'sabado') {
    return [mm.mm_es, mm.mm_culto].filter((o) => o != null && o !== '');
  }
  return [mm.mm_domingo].filter((o) => o != null && o !== '');
}

/** Opções do seletor de ocupante: pessoas ativas e grupos escaláveis. */
function renderAjusteSeletorOcupante() {
  const sel = el('ajusteSeletorOcupante');
  sel.innerHTML = '';
  const optVazio = document.createElement('option');
  optVazio.value = '';
  optVazio.textContent = '— escolher pessoa ou grupo —';
  sel.appendChild(optVazio);

  const grpPessoas = document.createElement('optgroup');
  grpPessoas.label = 'Pessoas';
  for (const p of ajuste.pessoas) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.nome;
    grpPessoas.appendChild(o);
  }
  sel.appendChild(grpPessoas);

  const chaves = Object.keys(ajuste.grupos);
  if (chaves.length) {
    const grpGrupos = document.createElement('optgroup');
    grpGrupos.label = 'Grupos escaláveis';
    for (const chave of chaves) {
      const o = document.createElement('option');
      o.value = `grupo:${chave}`;
      o.textContent = ajuste.grupos[chave].nome_exibicao;
      grpGrupos.appendChild(o);
    }
    sel.appendChild(grpGrupos);
  }
}

/** Desenha a lista de ocupantes em edição, com botão para remover cada um. */
function renderAjusteOcupantes() {
  const box = el('ajusteOcupantes');
  box.innerHTML = '';
  if (ajuste.ocupantes.length === 0) {
    const vazio = document.createElement('p');
    vazio.className = 'vazio';
    vazio.textContent = 'Nenhum nome. Adicione pelo seletor abaixo.';
    box.appendChild(vazio);
    return;
  }
  ajuste.ocupantes.forEach((oc, i) => {
    const chip = document.createElement('div');
    chip.className = 'ajuste-ocupante-chip';
    const nome = ajusteNomeOcupante(oc) || '(fora do cadastro)';
    chip.innerHTML = `<span class="ajuste-ocupante-nome">${escaparHtml(nome)}</span>`;
    const rem = document.createElement('button');
    rem.className = 'ajuste-ocupante-remover';
    rem.type = 'button';
    rem.textContent = '×';
    rem.title = 'Remover';
    rem.addEventListener('click', () => {
      ajuste.ocupantes.splice(i, 1);
      ajuste.previa = null;
      atualizarBotaoSalvarAjuste();
      renderAjusteOcupantes();
    });
    chip.appendChild(rem);
    box.appendChild(chip);
  });
}

/** Adiciona o ocupante escolhido no seletor à lista em edição. */
function adicionarOcupanteAjuste() {
  const sel = el('ajusteSeletorOcupante');
  const valor = sel.value;
  if (!valor) return;
  // Regente e MM-domingo têm uma vaga; MM-sábado duas; equipe várias.
  const culto = cultoAjusteAtual();
  const modelo = (culto && culto.modelo_louvor) || '';
  let max = Infinity;
  if (ajuste.campo === 'REGENTE LOUVOR') max = 1;
  else if (ajuste.campo === 'MENSAGEM MUSICAL') max = modelo === 'sabado' ? 2 : 1;
  if (ajuste.ocupantes.length >= max) ajuste.ocupantes = ajuste.ocupantes.slice(0, max - 1);
  // Converte id de pessoa (string numérica) de volta a número quando for o caso.
  const existentes = ajuste.pessoas.map((p) => p.id);
  let ocupante = valor;
  if (!valor.startsWith('grupo:')) {
    const match = existentes.find((id) => String(id) === valor);
    if (match !== undefined) ocupante = match;
  }
  ajuste.ocupantes.push(ocupante);
  sel.value = '';
  ajuste.previa = null;
  atualizarBotaoSalvarAjuste();
  renderAjusteOcupantes();
}

/** Monta o valor do ajuste conforme o campo (lista de ocupantes ou texto). */
function valorDoAjuste() {
  if (AJUSTE_CAMPOS_NOME.has(ajuste.campo)) return ajuste.ocupantes.slice();
  if (ajuste.campo === 'OBS') return el('ajusteObs').value;
  return el('ajusteAcomp').value; // ACOMP
}

/** Pede a prévia da revalidação do ajuste (sem gravar) e mostra o painel. */
async function previaAjuste() {
  if (!ajuste.dataIso) return;
  mostrarOverlay('Revalidando o ajuste...');
  try {
    const resultado = await api('/api/publicada/previa', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: ajuste.dataIso, campo: ajuste.campo, valor: valorDoAjuste() }),
    });
    ajuste.previa = resultado;
    const idsAtuais = new Set((resultado.avisos || []).map((a) => a.id));
    ajuste.ciencias = new Set([...ajuste.ciencias].filter((id) => idsAtuais.has(id)));
    const errosAtuais = new Set((resultado.erros || []).map((e) => e.id));
    ajuste.excecoes = new Set([...ajuste.excecoes].filter((id) => errosAtuais.has(id)));
    mostrarRevalidacaoAjuste(resultado);
  } catch (err) {
    alert('Erro ao revalidar o ajuste: ' + err.message);
  } finally {
    esconderOverlay();
  }
}

/** Reaproveita a aparência do painel de revalidação para o ajuste. */
function mostrarRevalidacaoAjuste(resultado) {
  const painel = el('ajustePainelRevalidacao');
  const { erros = [], avisos = [] } = resultado || {};
  painel.hidden = false;
  painel.className = 'revalidacao ' + (erros.length > 0 ? 'erro' : avisos.length > 0 ? 'aviso' : 'ok');

  const texto = (m) => (typeof m === 'string' ? m : m.texto || '');
  const ehConferencia = (e) =>
    typeof e === 'object' && e && typeof e.chave === 'string' && e.chave.startsWith('conferencia_');
  let html = '<h4>Revalidação do ajuste</h4>';

  if (erros.length === 0 && avisos.length === 0) {
    html += '<p class="revalidacao-ok">Tudo certo! Pode salvar.</p>';
  } else {
    const errosConferencia = erros.filter(ehConferencia);
    const errosOutros = erros.filter((e) => !ehConferencia(e));
    if (errosConferencia.length > 0) {
      html += '<p class="revalidacao-sub">Conferência dos links (impedem o ajuste):</p><ul class="revalidacao-erros">';
      for (const e of errosConferencia) {
        const detalhe = [e.data, e.slot, e.nome].filter(Boolean).join(' · ');
        const num = e.numero ? ` → abre ${e.numero}` : '';
        html += `<li class="erro">🔗 ${texto(e)}${detalhe && !texto(e).includes(String(e.nome)) ? ` <small>(${detalhe}${num})</small>` : ''}</li>`;
      }
      html += '</ul>';
    }
    const errosFixos = errosOutros.filter((e) => e.excecionavel !== true);
    const errosRegra = errosOutros.filter((e) => e.excecionavel === true);
    if (errosFixos.length > 0) {
      html += '<p class="revalidacao-sub">Erros (impedem o ajuste; precisam ser corrigidos):</p><ul class="revalidacao-erros">';
      for (const e of errosFixos) html += `<li class="erro">⛔ ${texto(e)}</li>`;
      html += '</ul>';
    }
    html += htmlErrosExcecionaveis(errosRegra, ajuste.excecoes, 'excecao-ajuste', texto);
    if (avisos.length > 0) {
      html += '<p class="revalidacao-sub">Avisos (marque ciência de cada um):</p><ul class="revalidacao-avisos">';
      for (const a of avisos) {
        const id = a.id || texto(a);
        const marcado = ajuste.ciencias.has(id) ? ' checked' : '';
        const idEsc = encodeURIComponent(id);
        html += `<li class="aviso"><label><input type="checkbox" class="ciencia-ajuste" data-aviso="${idEsc}"${marcado}> <span>⚠️ ${texto(a)}</span></label></li>`;
      }
      html += '</ul>';
    }
  }
  painel.innerHTML = html;

  painel.querySelectorAll('.excecao-ajuste').forEach((cb) => {
    cb.addEventListener('change', () => {
      const id = decodeURIComponent(cb.dataset.erro);
      if (cb.checked) ajuste.excecoes.add(id);
      else ajuste.excecoes.delete(id);
      atualizarBotaoSalvarAjuste();
    });
  });

  painel.querySelectorAll('.ciencia-ajuste').forEach((cb) => {
    cb.addEventListener('change', () => {
      const id = decodeURIComponent(cb.dataset.aviso);
      if (cb.checked) ajuste.ciencias.add(id);
      else ajuste.ciencias.delete(id);
      atualizarBotaoSalvarAjuste();
    });
  });

  atualizarBotaoSalvarAjuste();
}

/** Verdadeiro quando é seguro salvar: há prévia, zero erros e toda ciência. */
function podeSalvarAjuste() {
  const r = ajuste.previa;
  if (!r) return false;
  if (errosPendentes(r.erros, ajuste.excecoes).length > 0) return false;
  return (r.avisos || []).every((a) => ajuste.ciencias.has(a.id));
}

function atualizarBotaoSalvarAjuste() {
  const btn = el('btnAjusteSalvar');
  if (btn) btn.disabled = !podeSalvarAjuste();
}

/** Salva o ajuste: PUT /api/publicada, depois abre a verificação do site. */
async function salvarAjuste() {
  if (!podeSalvarAjuste()) {
    if (!ajuste.previa) alert('Clique em "Prévia" antes de salvar.');
    else if (errosPendentes(ajuste.previa.erros, ajuste.excecoes).length > 0) {
      alert('Corrija os erros em vermelho ou confirme a exceção de cada regra violada antes de salvar.');
    }
    else alert('Marque a ciência de cada aviso antes de salvar.');
    return;
  }
  mostrarOverlay('Salvando o ajuste e publicando...');
  try {
    await api('/api/publicada', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        data: ajuste.dataIso,
        campo: ajuste.campo,
        valor: valorDoAjuste(),
        ciencias: [...ajuste.ciencias],
        excecoes: excecoesDaRevalidacao(ajuste.previa, ajuste.excecoes),
      }),
    });
    setStatus('Ajuste publicado', 'ok');
    // Estado do mês para a verificação do site reaproveitar o fluxo existente.
    estado.mes = ajuste.mes;
    el('telaAjuste').hidden = true;
    el('telaMenu').hidden = false;
    // Conclui sem a tela de WhatsApp: vai direto para a verificação do site.
    abrirVerificacaoSite();
  } catch (err) {
    const payload = err.payload || {};
    let extra = '';
    if (Array.isArray(payload.erros) && payload.erros.length) {
      extra = '\n- ' + payload.erros.map((e) => (typeof e === 'string' ? e : e.texto || '')).join('\n- ');
    } else if (Array.isArray(payload.avisosSemCiencia) && payload.avisosSemCiencia.length) {
      extra = '\n- ' + payload.avisosSemCiencia.map((e) => (typeof e === 'string' ? e : e.texto || '')).join('\n- ');
    } else if (Array.isArray(payload.conflitos) && payload.conflitos.length) {
      extra = '\nConflito em: ' + payload.conflitos.join(', ');
    }
    alert('Erro ao salvar o ajuste: ' + err.message + extra);
  } finally {
    esconderOverlay();
  }
}

function init() {
  montarTooltipRapido();

  // Mês padrão: próximo mês.
  const agora = new Date();
  const prox = new Date(agora.getFullYear(), agora.getMonth() + 1, 1);
  el('inputMes').value = `${prox.getFullYear()}-${String(prox.getMonth() + 1).padStart(2, '0')}`;

  el('btnMontar').addEventListener('click', () => {
    const mes = el('inputMes').value;
    if (!mes) {
      alert('Escolha o mês.');
      return;
    }
    abrirMesEChecklist(mes);
  });

  el('btnVoltarInsumos').addEventListener('click', () => {
    el('telaInsumos').hidden = true;
    el('telaMenu').hidden = false;
    setStatus('');
  });

  el('btnIrMontagem').addEventListener('click', () => {
    if (estado.mes) carregarMes(estado.mes);
  });

  // Tela de acionato (Task 15).
  el('btnEditarAcionato').addEventListener('click', abrirAcionato);
  el('btnVoltarAcionato').addEventListener('click', () => {
    el('telaAcionato').hidden = true;
    el('telaInsumos').hidden = false;
    setStatus('');
  });
  el('btnIncluirExtra').addEventListener('click', incluirDiaExtraordinario);
  el('btnSalvarAcionato').addEventListener('click', salvarAcionato);

  // Tela de sonoplastia (Task 16).
  el('btnEditarSonoplastia').addEventListener('click', abrirSonoplastia);
  el('btnVoltarSonoplastia').addEventListener('click', () => {
    el('telaSonoplastia').hidden = true;
    el('telaInsumos').hidden = false;
    setStatus('');
  });
  el('btnSalvarSonoplastia').addEventListener('click', salvarSonoplastiaUI);

  // Tela de importação da indisponibilidade (Task 17).
  el('btnImportarEnquete').addEventListener('click', abrirEnquete);
  el('btnVoltarEnquete').addEventListener('click', () => {
    el('telaEnquete').hidden = true;
    el('telaInsumos').hidden = false;
    setStatus('');
  });
  el('arqEnquete').addEventListener('change', (ev) => {
    const arquivo = ev.target.files && ev.target.files[0];
    anexarEnquete(arquivo);
  });
  el('btnGravarEnquete').addEventListener('click', gravarEnquete);

  el('btnVoltar').addEventListener('click', () => {
    el('telaMontagem').hidden = true;
    el('telaMenu').hidden = false;
    setStatus('');
  });

  el('btnSugerir').addEventListener('click', sugerir);
  el('btnSugerirVazios').addEventListener('click', () => executarSugestao('vazios'));
  el('btnSugerirTudo').addEventListener('click', () => executarSugestao('tudo'));
  document.querySelectorAll('[data-fechar-sugestao]').forEach((f) => {
    f.addEventListener('click', fecharModalSugestao);
  });
  el('btnValidar').addEventListener('click', validar);
  el('btnRevalidar').addEventListener('click', revalidarEnvio);
  el('btnPublicar').addEventListener('click', publicar);
  el('selMeses').addEventListener('change', atualizarParticipacao);

  // Verificação automática do site (Task 32).
  el('btnContinuarVerificando').addEventListener('click', () => {
    verificacao.inicio = Date.now();
    verificacao.ativo = true;
    el('btnContinuarVerificando').hidden = true;
    el('verifEstado').textContent = 'Aguardando publicação...';
    consultarSite();
  });
  el('btnTentarEnvioVerif').addEventListener('click', async () => {
    await tentarDeNovoSync();
    // Após reenviar, recomeça a verificação do site.
    verificacao.inicio = Date.now();
    verificacao.ativo = true;
    consultarSite();
  });
  el('btnViEscala').addEventListener('click', () => {
    const url = el('btnViEscala').dataset.url || 'https://natanbudny.github.io/EscalaMusica/';
    fecharVerificacao();
    // "Vi a escala atualizada" abre a tela de WhatsApp do mês (RF 25.1).
    abrirTelaWhatsapp(url);
  });
  el('btnFecharVerificacao').addEventListener('click', fecharVerificacao);

  // Tela de WhatsApp (Task 35).
  el('btnWhatsEnviados').addEventListener('click', alternarEnviados);
  el('btnFecharWhatsapp').addEventListener('click', fecharTelaWhatsapp);
  el('btnConcluirWhats').addEventListener('click', concluirMes);

  // Tela de conclusão (Task 36).
  el('btnFecharConclusao').addEventListener('click', fecharConclusao);

  // Gestão de pessoas.
  el('btnGerenciar').addEventListener('click', abrirGestao);
  el('btnVoltarPessoas').addEventListener('click', () => {
    el('telaPessoas').hidden = true;
    el('telaMenu').hidden = false;
  });
  el('buscaPessoas').addEventListener('input', renderListaPessoas);
  el('btnTentarDeNovo').addEventListener('click', tentarDeNovoSync);
  el('btnNovaPessoa').addEventListener('click', () => abrirFormPessoa(null));
  el('btnSalvarPessoa').addEventListener('click', salvarPessoa);
  el('btnDesativarPessoa').addEventListener('click', desativarPessoaAtual);
  el('btnExcluirPessoa').addEventListener('click', excluirPessoaAtual);
  for (const fechar of document.querySelectorAll('[data-fechar-pessoa]')) {
    fechar.addEventListener('click', fecharFormPessoa);
  }

  // Filtros avançados.
  el('btnFiltros').addEventListener('click', () => {
    const p = el('painelFiltros');
    p.hidden = !p.hidden;
  });
  el('btnLimparFiltros').addEventListener('click', () => {
    for (const c of document.querySelectorAll('.f-funcao, .f-dia')) c.checked = false;
    el('fSituacao').value = '';
    el('fAfastado').value = '';
    el('fPerfil').value = '';
    renderListaPessoas();
  });
  for (const c of document.querySelectorAll('.f-funcao, .f-dia')) {
    c.addEventListener('change', renderListaPessoas);
  }
  el('fSituacao').addEventListener('change', renderListaPessoas);
  el('fAfastado').addEventListener('change', renderListaPessoas);
  el('fPerfil').addEventListener('change', renderListaPessoas);

  // Grupos escaláveis.
  el('btnGrupos').addEventListener('click', abrirGrupos);
  el('btnVoltarGrupos').addEventListener('click', () => {
    el('telaGrupos').hidden = true;
    el('telaPessoas').hidden = false;
    renderListaPessoas();
  });
  el('btnNovoGrupo').addEventListener('click', () => abrirFormGrupo(null, null));
  el('btnSalvarGrupo').addEventListener('click', salvarGrupoUI);
  el('btnRemoverGrupo').addEventListener('click', removerGrupoUI);
  for (const fechar of document.querySelectorAll('[data-fechar-grupo]')) {
    fechar.addEventListener('click', fecharFormGrupo);
  }

  // Tela de regras (Task 13).
  el('btnRegras').addEventListener('click', abrirRegras);
  el('btnVoltarRegras').addEventListener('click', () => {
    el('telaRegras').hidden = true;
    el('telaMenu').hidden = false;
  });
  el('buscaRegras').addEventListener('input', renderListaRegras);
  el('btnSalvarParametros').addEventListener('click', salvarParametrosUI);

  // Tela de ajustar escala publicada (Task 37).
  el('btnAjustarPublicada').addEventListener('click', abrirAjustePublicada);
  el('btnVoltarAjuste').addEventListener('click', () => {
    el('telaAjuste').hidden = true;
    el('telaMenu').hidden = false;
    setStatus('');
  });
  el('ajusteCampo').addEventListener('change', () => {
    ajuste.campo = el('ajusteCampo').value;
    carregarCampoAjuste();
  });
  el('btnAjusteAddOcupante').addEventListener('click', adicionarOcupanteAjuste);
  el('ajusteObs').addEventListener('input', () => {
    ajuste.previa = null;
    atualizarBotaoSalvarAjuste();
    validarObsCard(el('ajusteObs').value, el('ajusteObsProblemas'));
  });
  el('ajusteAcomp').addEventListener('change', () => {
    ajuste.previa = null;
    atualizarBotaoSalvarAjuste();
  });
  el('btnAjustePrevia').addEventListener('click', previaAjuste);
  el('btnAjusteSalvar').addEventListener('click', salvarAjuste);

  // Mensagens de WhatsApp (Task 33).
  el('btnSalvarMensagens').addEventListener('click', salvarMensagensUI);
  el('btnMsgHistorico').addEventListener('click', abrirHistoricoMensagens);
  el('btnMsgAddFixo').addEventListener('click', () => {
    el('msgFixos').appendChild(linhaMsgFixo('', ''));
  });
  el('msgTemplatePessoa').addEventListener('input', atualizarPreviaMensagem);
  for (const fechar of document.querySelectorAll('[data-fechar-historico]')) {
    fechar.addEventListener('click', () => {
      el('modalHistorico').hidden = true;
    });
  }

  // Seletor: fechar e buscar.
  for (const fechar of document.querySelectorAll('[data-fechar]')) {
    fechar.addEventListener('click', fecharSeletor);
  }
  el('seletorBusca').addEventListener('input', aplicarBusca);

  // Cadastro rápido de convidado (contato obrigatório).
  el('btnCadastrarConvidado').addEventListener('click', abrirCadastroConvidado);
  el('btnSalvarConvidado').addEventListener('click', salvarConvidado);
  el('cvContatoProprio').addEventListener('change', atualizarContatoConvidado);
  el('cvContatoVia').addEventListener('change', atualizarContatoConvidado);
  for (const fechar of document.querySelectorAll('[data-fechar-convidado]')) {
    fechar.addEventListener('click', fecharCadastroConvidado);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!el('modalConvidado').hidden) fecharCadastroConvidado();
    else fecharSeletor();
  });
}

init();
