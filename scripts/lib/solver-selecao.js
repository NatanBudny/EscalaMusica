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

/** Tamanho alvo da equipe de louvor */
const TAMANHO_EQUIPE = 5;

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
  const justificativas = [];
  const porId = contexto.pessoas.porId;
  const grupos = contexto.pessoas.grupos;

  // === FASE 1: REGENTE ===
  let regente = null;

  const candidatosRegente = pessoasAtivasParaSlot('regente', data, contexto);

  if (candidatosRegente.length === 0) {
    registrarAviso(justificativas, data, 'Nenhum regente disponível — culto PENDENTE');
  } else {
    const rankedRegentes = sortByScore(candidatosRegente, 'regente', data, contexto);
    regente = rankedRegentes[0];

    registrarEscolha(justificativas, data, 'REGENTE', regente, rankedRegentes);
    marcarEscalado(contexto, regente, data, 'regente');
  }

  // === FASE 2: EQUIPE LOUVOR (5 pessoas) ===
  const equipe = [];
  let homensNaEquipe = 0;

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

  if (dia_semana === 'sabado') {
    // Sábado: 2 MMs — primeiro mm_es, depois mm_culto (RF012)

    // MM ES (posição 1)
    const candidatosES = pessoasAtivasParaSlot('mm_es', data, contexto).filter(
      (p) => !idsComprometidos.has(p.id)
    );

    if (candidatosES.length > 0) {
      const rankedES = sortByScore(candidatosES, 'mm_es', data, contexto);
      const mmEs = rankedES[0];
      mm.push(mmEs);
      idsComprometidos.add(mmEs.id);
      marcarEscalado(contexto, mmEs, data, 'mm_es');
      registrarEscolha(justificativas, data, 'MM_ES', mmEs, rankedES);
    } else {
      registrarAviso(justificativas, data, 'Nenhum candidato disponível para MM ES (sábado)');
    }

    // MM CULTO (posição 2)
    const candidatosCulto = pessoasAtivasParaSlot('mm_culto', data, contexto).filter(
      (p) => !idsComprometidos.has(p.id)
    );

    if (candidatosCulto.length > 0) {
      const rankedCulto = sortByScore(candidatosCulto, 'mm_culto', data, contexto);
      const mmCulto = rankedCulto[0];
      mm.push(mmCulto);
      idsComprometidos.add(mmCulto.id);
      marcarEscalado(contexto, mmCulto, data, 'mm_culto');
      registrarEscolha(justificativas, data, 'MM_CULTO', mmCulto, rankedCulto);
    } else {
      registrarAviso(justificativas, data, 'Nenhum candidato disponível para MM Culto (sábado)');
    }
  } else if (dia_semana === 'domingo') {
    // Domingo: 1 MM (mm_domingo)
    const candidatosDom = pessoasAtivasParaSlot('mm_domingo', data, contexto).filter(
      (p) => !idsComprometidos.has(p.id)
    );

    if (candidatosDom.length > 0) {
      const rankedDom = sortByScore(candidatosDom, 'mm_domingo', data, contexto);
      const mmDom = rankedDom[0];
      mm.push(mmDom);
      idsComprometidos.add(mmDom.id);
      marcarEscalado(contexto, mmDom, data, 'mm_domingo');
      registrarEscolha(justificativas, data, 'MM_DOMINGO', mmDom, rankedDom);
    } else {
      registrarAviso(justificativas, data, 'Nenhum candidato disponível para MM Domingo');
    }
  }

  return { regente, equipe, mm, justificativas };
}
