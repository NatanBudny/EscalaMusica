/**
 * Módulo de formatação de saída do solver.
 * Gera rascunho.md e rascunho-justificativa.md.
 *
 * O rascunho.md segue formato tabular compatível com validar-rascunho.js:
 * | DATA | DIA SEMANA | ANCIÃO | PREGADOR | AUDIOVISUAL | REGENTE LOUVOR | EQUIPE LOUVOR | MENSAGEM MUSICAL | OBS |
 */

/**
 * Converte data ISO (YYYY-MM-DD) para formato brasileiro DD/MM/YYYY.
 */
function formatarDataBR(dataISO) {
  const [ano, mes, dia] = dataISO.split('-');
  return `${dia}/${mes}/${ano}`;
}

/**
 * Capitaliza e adiciona acentos ao dia da semana para exibição.
 */
function capitalizarDia(dia) {
  if (!dia) return '';
  const mapa = {
    'domingo': 'Domingo',
    'segunda': 'Segunda',
    'terca': 'Terça',
    'quarta': 'Quarta',
    'quarta-feira': 'Quarta-feira',
    'quinta': 'Quinta',
    'sexta': 'Sexta',
    'sabado': 'Sábado',
  };
  return mapa[dia] || dia.charAt(0).toUpperCase() + dia.slice(1);
}

/**
 * Retorna nome do mês em português a partir do número.
 */
function nomeMes(mesNum) {
  const meses = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
  ];
  return meses[parseInt(mesNum, 10) - 1] || `Mês ${mesNum}`;
}

/**
 * Formata sugestões em markdown tabular compatível com validar-rascunho.js.
 * @param {object[]} sugestoes - Array de SugestaoCulto
 * @returns {string} Conteúdo markdown do rascunho
 */
export function formatarRascunhoMd(sugestoes) {
  if (!sugestoes || sugestoes.length === 0) {
    return 'Nenhuma sugestão gerada\n';
  }

  // Extrair mês/ano do primeiro culto
  const primeiraData = sugestoes[0].data; // YYYY-MM-DD
  const [ano, mes] = primeiraData.split('-');
  const titulo = `# Rascunho - Escala ${nomeMes(mes)} ${ano}`;

  const linhas = [titulo, ''];

  // Header da tabela
  linhas.push('| DATA | DIA SEMANA | ANCIÃO | PREGADOR | AUDIOVISUAL | REGENTE LOUVOR | EQUIPE LOUVOR | MENSAGEM MUSICAL | OBS |');
  linhas.push('|------|------------|--------|----------|-------------|----------------|---------------|------------------|-----|');

  for (const sug of sugestoes) {
    const dataBR = formatarDataBR(sug.data);
    const diaSemana = capitalizarDia(sug.dia_semana);
    const anciao = sug.anciao || '';
    const pregador = sug.pregador || '';
    const audiovisual = sug.audiovisual || '';
    let regente = '';
    let equipe = '';
    let mm = '';
    let obs = sug.obs || '';

    if (sug.tipo === 'quarta') {
      // Quarta-feira: sem louvor (campos vazios)
      regente = '';
      equipe = '';
      mm = '';
    } else if (sug.tipo === 'departamental') {
      // Departamental: preencher com nome do departamento (RF015)
      regente = sug.departamento;
      equipe = sug.departamento;
      mm = sug.departamento;
    } else {
      // Culto normal
      regente = sug.regente ? sug.regente.nome : '-';
      equipe = sug.equipe && sug.equipe.length > 0
        ? sug.equipe.map((p) => p.nome).join(', ')
        : '-';
      mm = sug.mm && sug.mm.length > 0
        ? sug.mm.map((p) => p.nome).join(', ')
        : '-';
    }

    linhas.push(`| ${dataBR} | ${diaSemana} | ${anciao} | ${pregador} | ${audiovisual} | ${regente} | ${equipe} | ${mm} | ${obs} |`);
  }

  linhas.push('');
  return linhas.join('\n');
}

/**
 * Mapeia slot da justificativa para nome legível de seção MM.
 */
function slotParaNomeMM(slot) {
  switch (slot) {
    case 'MM_ES': return 'MM ES';
    case 'MM_CULTO': return 'MM Culto';
    case 'MM_DOMINGO': return 'MM Domingo';
    default: return slot;
  }
}

/**
 * Gera markdown de justificativa explicando cada escolha do solver.
 * @param {object[]} sugestoes - Array de SugestaoCulto
 * @param {object} contexto - Contexto final do solver
 * @returns {string} Conteúdo markdown da justificativa
 */
export function gerarJustificativa(sugestoes, contexto) {
  if (!sugestoes || sugestoes.length === 0) {
    return 'Nenhuma sugestão gerada\n';
  }

  // Extrair mês/ano do primeiro culto
  const primeiraData = sugestoes[0].data;
  const [ano, mes] = primeiraData.split('-');
  const titulo = `# Justificativa - Escala ${nomeMes(mes)} ${ano}`;

  const linhas = [titulo, ''];

  for (const sug of sugestoes) {
    const justificativas = sug.justificativas || [];

    // Pular cultos sem justificativas (quartas-feiras, departamentais sem justificativas)
    if (justificativas.length === 0) continue;

    const dataBR = formatarDataBR(sug.data);
    const diaSemana = capitalizarDia(sug.dia_semana);

    linhas.push(`## ${dataBR} (${diaSemana})`);
    linhas.push('');

    // Agrupar justificativas por tipo/slot
    const escolhasRegente = justificativas.filter((j) => j.tipo === 'escolha' && j.slot === 'REGENTE');
    const escolhasEquipe = justificativas.filter((j) => j.tipo === 'escolha' && j.slot === 'EQUIPE');
    const escolhasMM = justificativas.filter((j) => j.tipo === 'escolha' && j.slot.startsWith('MM'));
    const exclusoes = justificativas.filter((j) => j.tipo === 'exclusao');
    const avisos = justificativas.filter((j) => j.tipo === 'aviso');

    // Regente
    if (escolhasRegente.length > 0) {
      const reg = escolhasRegente[0];
      const nome = reg.pessoa ? reg.pessoa.nome : '?';
      linhas.push(`### Regente: ${nome}`);
      linhas.push('');
      linhas.push(`- ${nome}: ${reg.motivo}`);
      if (reg.candidatos_avaliados && reg.candidatos_avaliados.length > 1) {
        linhas.push(`- Candidatos avaliados: ${reg.candidatos_avaliados.join(', ')}`);
      }
      linhas.push('');
    }

    // Equipe
    if (escolhasEquipe.length > 0) {
      const nomesEquipe = escolhasEquipe.map((j) => j.pessoa ? j.pessoa.nome : '?');
      linhas.push(`### Equipe: ${nomesEquipe.join(', ')}`);
      linhas.push('');
      for (const j of escolhasEquipe) {
        const nome = j.pessoa ? j.pessoa.nome : '?';
        linhas.push(`- ${nome}: ${j.motivo}`);
        if (j.candidatos_avaliados && j.candidatos_avaliados.length > 1) {
          linhas.push(`  - Candidatos avaliados: ${j.candidatos_avaliados.join(', ')}`);
        }
      }
      linhas.push('');
    }

    // MM (pode ser MM_ES, MM_CULTO, MM_DOMINGO)
    for (const j of escolhasMM) {
      const nome = j.pessoa ? j.pessoa.nome : '?';
      const slotNome = slotParaNomeMM(j.slot);
      linhas.push(`### ${slotNome}: ${nome}`);
      linhas.push('');
      linhas.push(`- ${nome}: ${j.motivo}`);
      if (j.candidatos_avaliados && j.candidatos_avaliados.length > 1) {
        linhas.push(`  - Candidatos avaliados: ${j.candidatos_avaliados.join(', ')}`);
      }
      linhas.push('');
    }

    // Exclusões
    if (exclusoes.length > 0) {
      linhas.push('### Exclusões:');
      linhas.push('');
      for (const j of exclusoes) {
        const nome = j.pessoa ? j.pessoa.nome : '?';
        linhas.push(`- ${nome}: ${j.motivo}`);
      }
      linhas.push('');
    }

    // Avisos
    if (avisos.length > 0) {
      linhas.push('### Avisos:');
      linhas.push('');
      for (const j of avisos) {
        linhas.push(`- ${j.mensagem}`);
      }
      linhas.push('');
    }
  }

  return linhas.join('\n');
}
