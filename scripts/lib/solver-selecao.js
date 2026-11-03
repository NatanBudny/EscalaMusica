/**
 * Módulo de seleção por culto do solver.
 * Gera sugestão completa: regente + equipe (5) + mensagem musical.
 *
 * Fase 1: Selecionar regente (menor score)
 * Fase 2: Preencher equipe respeitando vínculos sempre_junto e familia_requerida
 * Fase 3: Preencher MM conforme dia (2 sábado / 1 domingo)
 *
 * Registra justificativa para cada escolha e exclusão.
 * Valida RF001 (mín 1 homem na equipe).
 */

import { pessoasAtivasParaSlot } from './solver-filtros.js';
import { sortByScore } from './solver-score.js';
import { PARAMETROS_PADRAO, valorRegra } from './parametros.js';

/** Tamanho padrão alvo da equipe de louvor (= parametros.equipe.tamanho). */
const TAMANHO_EQUIPE_PADRAO = PARAMETROS_PADRAO.equipe.tamanho;

/** Parâmetros efetivos do contexto, com fallback nos padrões. */
function parametrosDe(contexto) {
  return (contexto && contexto.parametros) || PARAMETROS_PADRAO;
}

/** Tamanho da equipe segundo os parâmetros (fallback no padrão). */
function tamanhoEquipeDe(contexto) {
  const par = parametrosDe(contexto);
  return (par.equipe && par.equipe.tamanho) || TAMANHO_EQUIPE_PADRAO;
}

/** Quantidade de MM no sábado segundo os parâmetros (fallback 2). */
function quantidadeMmSabado(contexto) {
  const par = parametrosDe(contexto);
  const q = valorRegra(par, 'mm_sabado', 'quantidade', 2);
  return q != null ? q : 2;
}

/** Resolve um valor de atribuição fixa (id numérico ou nome) para um id de pessoa. */
function resolverIdAtribuicao(valor, contexto) {
  if (valor == null || valor === '') return null;
  if (typeof valor === 'number') return valor;
  // Strings de grupo ('grupo:<chave>') não são escaláveis pelo solver.
  if (typeof valor === 'string' && valor.startsWith('grupo:')) return null;
  const pessoa = contexto.pessoas.porNome.get(String(valor).toUpperCase().trim());
  return pessoa ? pessoa.id : null;
}

/**
 * Marca uma pessoa como escalada no contexto acumulado.
 * Atualiza escaladosPorCulto e escaladosNesteMes.
 * @param {object} contexto - Estado acumulado do solver
 * @param {object} pessoa - Pessoa a marcar
 * @param {string} data - ISO date do culto
 * @param {string} slot - Slot em que foi escalada
 */
function marcarEscalado(contexto, pessoa, data, slot) {
  // escaladosPorCulto: Map<data, Set<id>>
  if (!contexto.escaladosPorCulto) {
    contexto.escaladosPorCulto = new Map();
  }
  if (!contexto.escaladosPorCulto.has(data)) {
    contexto.escaladosPorCulto.set(data, new Set());
  }
  contexto.escaladosPorCulto.get(data).add(pessoa.id);

  // escaladosNesteMes: Map<id, { slots: Set<string>, count: number }>
  if (!contexto.escaladosNesteMes) {
    contexto.escaladosNesteMes = new Map();
  }
  if (!contexto.escaladosNesteMes.has(pessoa.id)) {
    contexto.escaladosNesteMes.set(pessoa.id, { slots: new Set(), count: 0 });
  }
  const entry = contexto.escaladosNesteMes.get(pessoa.id);
  entry.slots.add(slot);
  entry.count += 1;

  // papeisPorCulto: Map<data, Map<id, Set<slot>>> — alimenta o filtro 8 por papel.
  if (!contexto.papeisPorCulto) {
    contexto.papeisPorCulto = new Map();
  }
  if (!contexto.papeisPorCulto.has(data)) {
    contexto.papeisPorCulto.set(data, new Map());
  }
  const papeisCulto = contexto.papeisPorCulto.get(data);
  if (!papeisCulto.has(pessoa.id)) papeisCulto.set(pessoa.id, new Set());
  papeisCulto.get(pessoa.id).add(slot);
}

/**
 * Registra uma escolha na lista de justificativas.
 * @param {object[]} justificativas - Array de justificativas do culto
 * @param {string} data - ISO date
 * @param {string} slot - Slot (REGENTE, EQUIPE, MM)
 * @param {object} escolhido - Pessoa escolhida
 * @param {object[]} candidatos - Lista ranqueada de candidatos avaliados
 * @param {string} [motivo] - Motivo adicional (ex: vínculo)
 */
function registrarEscolha(justificativas, data, slot, escolhido, candidatos, motivo) {
  justificativas.push({
    tipo: 'escolha',
    data,
    slot,
    pessoa: escolhido,
    motivo: motivo || `menor score entre ${candidatos.length} candidato(s)`,
    candidatos_avaliados: candidatos.slice(0, 5).map((p) => p.nome),
  });
}

/**
 * Registra uma exclusão com motivo na justificativa.
 * @param {object[]} justificativas - Array de justificativas
 * @param {string} data - ISO date
 * @param {object} pessoa - Pessoa excluída
 * @param {string} motivo - Motivo da exclusão
 */
function registrarExclusao(justificativas, data, pessoa, motivo) {
  justificativas.push({
    tipo: 'exclusao',
    data,
    pessoa,
    motivo,
  });
}

/**
 * Registra um aviso na justificativa (ex: RF001 não atendida).
 * @param {object[]} justificativas - Array de justificativas
 * @param {string} data - ISO date
 * @param {string} mensagem - Mensagem de aviso
 */
function registrarAviso(justificativas, data, mensagem) {
  justificativas.push({
    tipo: 'aviso',
    data,
    mensagem,
  });
}

/**
 * Verifica se uma pessoa tem vínculo sempre_junto e retorna o parceiro.
 * @param {object} pessoa - Pessoa a verificar
 * @param {Map<number, object>} porId - Mapa de pessoas por ID
 * @returns {object|null} Pessoa parceira ou null
 */
function obterParceiroSempreJunto(pessoa, porId) {
  if (!pessoa.vinculos || pessoa.vinculos.length === 0) return null;
  const vinculo = pessoa.vinculos.find((v) => v.tipo === 'sempre_junto');
  if (!vinculo) return null;
  return porId.get(vinculo.com_id) || null;
}

/**
 * Verifica se uma pessoa tem vínculo familia_requerida e retorna o nome do grupo.
 * @param {object} pessoa - Pessoa a verificar
 * @returns {string|null} Nome do grupo requerido ou null
 */
function obterGrupoFamiliaRequerida(pessoa) {
  if (!pessoa.vinculos || pessoa.vinculos.length === 0) return null;
  const vinculo = pessoa.vinculos.find((v) => v.tipo === 'familia_requerida');
  if (!vinculo) return null;
  return vinculo.grupo;
}

/**
 * Verifica se ao menos um membro do grupo está presente na equipe ou é o regente.
 * @param {number[]} membrosIds - IDs dos membros do grupo
 * @param {object[]} equipe - Membros já na equipe
 * @param {object|null} regente - Regente escalado
 * @returns {boolean}
 */
function grupoRepresentadoNaEquipe(membrosIds, equipe, regente) {
  const idsPresentes = new Set(equipe.map((p) => p.id));
  if (regente) idsPresentes.add(regente.id);

  for (const membroId of membrosIds) {
    if (idsPresentes.has(membroId)) return true;
  }
  return false;
}

/**
 * Gera sugestão completa para um culto (regente + equipe + MM).
 * Aplica seleção sequencial: regente primeiro, depois equipe, depois MM.
 *
 * @param {object} culto - { data, dia_semana, externoss? }
 * @param {object} contexto - Estado acumulado do solver
 * @param {object} contexto.pessoas - Resultado de carregarPessoas()
 * @param {object} contexto.indisponibilidade - JSON vinculado
 * @param {Map} contexto.historico - Map<id, HistoricoPessoa>
 * @param {Map} contexto.escaladosNesteMes - Map<id, { slots, count }>
 * @param {Map} contexto.escaladosPorCulto - Map<data, Set<id>>
 * @returns {{ regente: object|null, equipe: object[], mm: object[], justificativas: object[] }}
 */
export function sugerirCulto(culto, contexto) {
  const { data, dia_semana } = culto;
  // O modelo de louvor determina as funções; na ausência, usa o dia da semana.
  const modeloLouvor = culto.modelo_louvor || dia_semana;
  const TAMANHO_EQUIPE = tamanhoEquipeDe(contexto);
  const justificativas = [];
  const porId = contexto.pessoas.porId;
  const grupos = contexto.pessoas.grupos;

  // Fixos já escolhidos à mão para este culto (modo "só preencher vazios").
  const fixos = culto.fixos || null;
  const idFixo = (valor) => resolverIdAtribuicao(valor, contexto);

  // === FASE 1: REGENTE ===
  let regente = null;

  // Regente fixo: não sugere, só o marca no contexto.
  const regenteFixoId = fixos ? idFixo(fixos.regente) : null;
  if (regenteFixoId != null) {
    regente = porId.get(regenteFixoId) || null;
    if (regente) marcarEscalado(contexto, regente, data, 'regente');
  }

  if (!regente) {
    const candidatosRegente = pessoasAtivasParaSlot('regente', data, contexto);

    if (candidatosRegente.length === 0) {
      registrarAviso(justificativas, data, 'Nenhum regente disponível — culto PENDENTE');
    } else {
      const rankedRegentes = sortByScore(candidatosRegente, 'regente', data, contexto);
      regente = rankedRegentes[0];

      registrarEscolha(justificativas, data, 'REGENTE', regente, rankedRegentes);
      marcarEscalado(contexto, regente, data, 'regente');
    }
  }

  // === FASE 2: EQUIPE LOUVOR (5 pessoas) ===
  const equipe = [];
  let homensNaEquipe = 0;

  // Equipe fixa (modo "só preencher vazios"): marca os já escolhidos e só
  // preenche o que falta até o tamanho alvo.
  if (fixos && Array.isArray(fixos.equipe)) {
    for (const valor of fixos.equipe) {
      const id = idFixo(valor);
      if (id == null) continue;
      const pessoa = porId.get(id);
      if (!pessoa || equipe.some((p) => p.id === pessoa.id)) continue;
      equipe.push(pessoa);
      if (pessoa.genero === 'M') homensNaEquipe += 1;
      marcarEscalado(contexto, pessoa, data, 'equipe');
    }
  }

  // Contar regente masculino para RF001 (regente é parte da formação mas reportado separado)
  // RF001 diz "mínimo 1 homem na equipe", equipe é separada do regente

  // Primeiro: inserir par obrigatório do regente (vínculo sempre_junto)
  if (regente) {
    const parceiroRegente = obterParceiroSempreJunto(regente, porId);
    if (parceiroRegente) {
      // Verificar se o parceiro está elegível para equipe
      const candidatosEquipeFull = pessoasAtivasParaSlot('equipe', data, contexto);
      const parceiroElegivel = candidatosEquipeFull.some((p) => p.id === parceiroRegente.id);

      if (parceiroElegivel) {
        equipe.push(parceiroRegente);
        if (parceiroRegente.genero === 'M') homensNaEquipe += 1;
        marcarEscalado(contexto, parceiroRegente, data, 'equipe');
        registrarEscolha(
          justificativas,
          data,
          'EQUIPE',
          parceiroRegente,
          [parceiroRegente],
          `vínculo sempre_junto com regente ${regente.nome}`
        );
      } else {
        registrarExclusao(
          justificativas,
          data,
          parceiroRegente,
          `parceiro(a) do regente ${regente.nome} (sempre_junto) indisponível ou inelegível para equipe`
        );
      }
    }
  }

  // Preencher restante da equipe
  const candidatosEquipe = pessoasAtivasParaSlot('equipe', data, contexto).filter(
    (p) => !equipe.some((e) => e.id === p.id) && (!regente || p.id !== regente.id)
  );
  const rankedEquipe = sortByScore(candidatosEquipe, 'equipe', data, contexto);

  // Set para rastrear IDs já na equipe (para lookup rápido)
  const idsNaEquipe = new Set(equipe.map((p) => p.id));
  if (regente) idsNaEquipe.add(regente.id);

  let i = 0;
  while (equipe.length < TAMANHO_EQUIPE && i < rankedEquipe.length) {
    const candidato = rankedEquipe[i];
    i++;

    // Pular se já adicionado (pode ter sido inserido como parceiro)
    if (idsNaEquipe.has(candidato.id)) continue;

    // Verificar vínculo familia_requerida
    const grupoRequerido = obterGrupoFamiliaRequerida(candidato);
    if (grupoRequerido) {
      const grupoDef = grupos.get(grupoRequerido);
      if (grupoDef) {
        const familiaPresente = grupoRepresentadoNaEquipe(
          grupoDef.membros_ids,
          equipe,
          regente
        );
        if (!familiaPresente) {
          registrarExclusao(
            justificativas,
            data,
            candidato,
            `familia_requerida não satisfeito — nenhum membro do grupo '${grupoRequerido}' na equipe`
          );
          continue;
        }
      } else {
        // Grupo não encontrado — relaxar restrição, registrar aviso
        registrarAviso(
          justificativas,
          data,
          `Grupo '${grupoRequerido}' referenciado por ${candidato.nome} não encontrado — restrição relaxada`
        );
      }
    }

    // Verificar vínculo sempre_junto
    const parceiro = obterParceiroSempreJunto(candidato, porId);
    if (parceiro) {
      // Se o parceiro já está na equipe ou é o regente, pode adicionar normalmente
      if (idsNaEquipe.has(parceiro.id)) {
        // Parceiro já está — adicionar candidato normalmente
        equipe.push(candidato);
        idsNaEquipe.add(candidato.id);
        if (candidato.genero === 'M') homensNaEquipe += 1;
        marcarEscalado(contexto, candidato, data, 'equipe');
        registrarEscolha(justificativas, data, 'EQUIPE', candidato, rankedEquipe);
        continue;
      }

      // Parceiro NÃO está na equipe — precisamos adicionar ambos
      // Verificar se há vaga para o par
      if (equipe.length + 2 > TAMANHO_EQUIPE) {
        registrarExclusao(
          justificativas,
          data,
          candidato,
          `sempre_junto sem vaga para par (${candidato.nome}↔${parceiro.nome}) — restam ${TAMANHO_EQUIPE - equipe.length} vaga(s)`
        );
        continue;
      }

      // Verificar se parceiro está elegível
      const parceiroElegivel = candidatosEquipe.some((p) => p.id === parceiro.id);
      if (!parceiroElegivel) {
        registrarExclusao(
          justificativas,
          data,
          candidato,
          `${candidato.nome} excluído — parceiro(a) ${parceiro.nome} indisponível (vínculo sempre_junto)`
        );
        continue;
      }

      // Verificar familia_requerida do parceiro também
      const grupoRequeridoParceiro = obterGrupoFamiliaRequerida(parceiro);
      if (grupoRequeridoParceiro) {
        const grupoDefParceiro = grupos.get(grupoRequeridoParceiro);
        if (grupoDefParceiro) {
          const familiaPresenteParceiro = grupoRepresentadoNaEquipe(
            grupoDefParceiro.membros_ids,
            equipe,
            regente
          );
          if (!familiaPresenteParceiro) {
            registrarExclusao(
              justificativas,
              data,
              candidato,
              `sempre_junto com ${parceiro.nome}, mas ${parceiro.nome} requer grupo '${grupoRequeridoParceiro}' não representado`
            );
            continue;
          }
        }
      }

      // Adicionar ambos
      equipe.push(candidato);
      equipe.push(parceiro);
      idsNaEquipe.add(candidato.id);
      idsNaEquipe.add(parceiro.id);
      if (candidato.genero === 'M') homensNaEquipe += 1;
      if (parceiro.genero === 'M') homensNaEquipe += 1;
      marcarEscalado(contexto, candidato, data, 'equipe');
      marcarEscalado(contexto, parceiro, data, 'equipe');
      registrarEscolha(
        justificativas,
        data,
        'EQUIPE',
        candidato,
        rankedEquipe,
        `par sempre_junto (${candidato.nome}↔${parceiro.nome})`
      );
      continue;
    }

    // Sem vínculo especial — adicionar normalmente
    equipe.push(candidato);
    idsNaEquipe.add(candidato.id);
    if (candidato.genero === 'M') homensNaEquipe += 1;
    marcarEscalado(contexto, candidato, data, 'equipe');
    registrarEscolha(justificativas, data, 'EQUIPE', candidato, rankedEquipe);
  }

  // Validar RF001: mínimo 1 homem na equipe
  if (homensNaEquipe === 0) {
    registrarAviso(justificativas, data, 'RF001: equipe sem homem — impossível atender com candidatos disponíveis');
  }

  // Pool insuficiente?
  if (equipe.length < TAMANHO_EQUIPE) {
    registrarAviso(
      justificativas,
      data,
      `AVISO: apenas ${equipe.length}/${TAMANHO_EQUIPE} membros disponíveis para equipe`
    );
  }

  // === FASE 3: MENSAGEM MUSICAL ===
  const mm = [];

  // IDs já comprometidos neste culto (equipe + regente)
  const idsComprometidos = new Set(equipe.map((p) => p.id));
  if (regente) idsComprometidos.add(regente.id);

  // Valor fixo de uma MM de slot (para modo "só preencher vazios").
  const mmFixoId = (slot) => {
    if (!fixos || !fixos.mm) return null;
    const v = Array.isArray(fixos.mm) ? undefined : fixos.mm[slot];
    return v !== undefined ? idFixo(v) : null;
  };

  // Preenche um slot de MM: usa o fixo quando houver, senão escolhe por score.
  const preencherMm = (slot, avisoVazio) => {
    const fixoId = mmFixoId(slot);
    if (fixoId != null) {
      const pessoa = porId.get(fixoId);
      if (pessoa && !idsComprometidos.has(pessoa.id)) {
        mm.push(pessoa);
        idsComprometidos.add(pessoa.id);
        marcarEscalado(contexto, pessoa, data, slot);
        return;
      }
    }
    const candidatos = pessoasAtivasParaSlot(slot, data, contexto).filter(
      (p) => !idsComprometidos.has(p.id),
    );
    if (candidatos.length > 0) {
      const ranked = sortByScore(candidatos, slot, data, contexto);
      const escolhido = ranked[0];
      mm.push(escolhido);
      idsComprometidos.add(escolhido.id);
      marcarEscalado(contexto, escolhido, data, slot);
      registrarEscolha(justificativas, data, slot.toUpperCase(), escolhido, ranked);
    } else {
      registrarAviso(justificativas, data, avisoVazio);
    }
  };

  if (modeloLouvor === 'sabado') {
    // Modelo sábado: N MMs (padrão 2) — primeiro mm_es, depois mm_culto (RF012).
    const qtd = quantidadeMmSabado(contexto);
    if (qtd >= 2) {
      preencherMm('mm_es', 'Nenhum candidato disponível para MM ES (sábado)');
      preencherMm('mm_culto', 'Nenhum candidato disponível para MM Culto (sábado)');
    } else if (qtd === 1) {
      preencherMm('mm_culto', 'Nenhum candidato disponível para MM Culto (sábado)');
    }
  } else if (modeloLouvor === 'domingo') {
    // Modelo domingo: 1 MM (mm_domingo).
    preencherMm('mm_domingo', 'Nenhum candidato disponível para MM Domingo');
  }

  return { regente, equipe, mm, justificativas };
}
