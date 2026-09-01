/**
 * auditor-escala.js
 *
 * Auditor determinístico do rascunho mensal. Concentra num único lugar TODAS as
 * checagens de regra que antes eram feitas de forma ad-hoc. Zero IA: recebe os
 * dados e devolve listas de erros (violações obrigatórias) e avisos (preferências).
 *
 * Regras cobertas:
 *  - RF001  equipe com >= 1 homem
 *  - RF002  audiovisual não acumula regente/equipe (resolve identidade nome↔alias)
 *  - RF004  ancião/pregador/AV externos não conflitam com louvor no mesmo dia
 *  - RF013  não cantar em cultos consecutivos (<= 2 dias) entre equipe/MM
 *  - RF014  não fazer mais de uma MENSAGEM MUSICAL no mês
 *  - RP003/4/5  casais (Jessica↔Joas, Jesse↔Jessie, Yasser↔Lidiane) sempre juntos
 *  - RP006  Juliana Alves só sábado
 *  - RP007  Ariadny não domingo
 *  - RP017  Catherine não domingo
 *  - Nilson  Mirella/Marcela no louvor exigem Nilson no dia
 *  - RP009/RP011  Manu C. só com Silvana; Manu S. só com Jessica ou Joas
 *  - PE001  (aviso) ideal 2+ homens
 *  - PE009  (aviso) perfil incentivo escalado > 1x no mês
 *  - resumo.md  (aviso) Luiz da Silva + Ariadny não juntos
 *  - disponibilidade  ninguém escalado indisponível (data ou mês inteiro)
 *  - habilitação  regente/MM conforme cadastro; equipe com 5; papéis não duplicados
 *
 * Departamentos (RF010/RF015) são ignorados na checagem individual.
 */

const MM_TEXTO = new Set(['CORAL INFANTIL', 'DESBRAVADORES', 'JOVENS', 'AVENTUREIROS', 'DORCAS', 'DILSON CASTRO']);
const DEPARTAMENTOS = new Set(['JOVENS', 'AVENTUREIROS', 'DESBRAVADORES', 'DORCAS', 'M. MULHER', 'QUARTETO', 'MELHOR IDADE']);

function norm(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}
function split(raw) {
  return !raw ? [] : raw.split(',').map((s) => s.trim()).filter(Boolean);
}
function toIso(br) { const [d, m, a] = (br || '').split('/'); return a ? `${a}-${m}-${d}` : ''; }
function diasEntre(a, b) { return Math.abs((new Date(b) - new Date(a)) / 86400000); }

/**
 * @param {object} opts
 * @param {object[]} opts.pessoas - cadastro.pessoas
 * @param {object} opts.indisponibilidade - JSON vinculado
 * @param {object[]} opts.cultos - [{data, iso, dia, anciao, pregador, av, reg, equipe:[], mm:[]}]
 * @returns {{ erros: string[], avisos: string[], icr: object[] }}
 */
export function auditarEscala({ pessoas, indisponibilidade, cultos }) {
  const porNome = new Map();
  for (const p of pessoas) {
    porNome.set(norm(p.nome), p);
    for (const a of (p.aliases || [])) porNome.set(norm(a), p);
  }
  const resolve = (nome) => {
    if (!nome) return null;
    const n = norm(nome);
    if (porNome.has(n)) return porNome.get(n);
    const primeiro = n.split(' ')[0];
    const cand = pessoas.filter(
      (p) => norm(p.nome).split(' ')[0] === primeiro || (p.aliases || []).some((a) => norm(a).split(' ')[0] === primeiro)
    );
    return cand.length === 1 ? cand[0] : null;
  };

  const mi = new Set(((indisponibilidade.indisponiveis_mes_inteiro?.nomes) || []).map(norm));
  const ipd = {};
  for (const d of (indisponibilidade.datas || [])) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(d.data_referencia)) {
      ipd[d.data_referencia] = new Set((d.indisponiveis_nomes || []).map(norm));
    }
  }
  const indispNoDia = (iso) => new Set([...(ipd[iso] || []), ...mi]);

  const gen = (n) => resolve(n)?.genero || '?';
  const habReg = (n) => !!resolve(n)?.habilitacoes?.regente;
  const habMM = (n, dia) => {
    const p = resolve(n); if (!p) return true;
    const mm = p.habilitacoes?.mensagem_musical || {};
    return dia === 'domingo' ? !!mm.domingo : !!(mm.es || mm.culto);
  };
  const ehDepto = (v) => DEPARTAMENTOS.has(norm(v));

  const erros = [];
  const avisos = [];
  const proprios = cultos.filter((c) => !ehDepto(c.reg));

  for (const c of proprios) {
    // composição
    if (c.equipe.length !== 5) erros.push(`${c.data}: EQUIPE LOUVOR tem ${c.equipe.length} (esperado 5)`);
    const homens = c.equipe.filter((n) => gen(n) === 'M').length;
    if (homens < 1) erros.push(`${c.data}: RF001 — equipe sem nenhum homem`);
    else if (homens < 2) avisos.push(`${c.data}: PE001 — apenas ${homens} homem na equipe (ideal 2)`);
    // regente habilitado
    if (!habReg(c.reg)) erros.push(`${c.data}: regente ${c.reg} não é habilitado a reger`);
    // MM habilitado + papéis duplicados
    for (const n of c.mm) {
      if (MM_TEXTO.has(norm(n))) continue;
      if (!habMM(n, c.dia)) erros.push(`${c.data}: MM ${n} não habilitado para ${c.dia}`);
      if (c.equipe.includes(n) || c.reg === n) erros.push(`${c.data}: ${n} em dois papéis no mesmo culto`);
    }
    // equipe sem duplicados
    if (new Set(c.equipe).size !== c.equipe.length) erros.push(`${c.data}: nome repetido na equipe`);

    const noDia = [c.reg, ...c.equipe, ...c.mm];

    // disponibilidade
    const ind = indispNoDia(c.iso);
    for (const n of noDia) {
      if (MM_TEXTO.has(norm(n))) continue;
      const p = resolve(n);
      if (p && ind.has(norm(p.nome))) erros.push(`${c.data}: ${n} está INDISPONÍVEL neste dia`);
      if (p && (!p.ativo || p.afastado)) erros.push(`${c.data}: ${n} está inativo/afastado`);
    }

    // dias específicos
    if (noDia.some((n) => norm(n) === 'CATHERINE') && c.dia === 'domingo') erros.push(`${c.data}: RP017 — Catherine não canta domingo`);
    if (noDia.some((n) => norm(n) === 'ARIADNY') && c.dia === 'domingo') erros.push(`${c.data}: RP007 — Ariadny não canta domingo`);
    if (noDia.some((n) => norm(n) === 'ANISSA') && c.dia !== 'sabado') erros.push(`${c.data}: Anissa só canta sábado`);
    if (noDia.some((n) => norm(n) === 'JULIANA ALVES') && c.dia !== 'sabado') erros.push(`${c.data}: RP006 — Juliana Alves só sábado`);

    // casais
    const setDia = new Set(noDia.map(norm));
    const casal = (a, b, id) => { if (setDia.has(a) && !setDia.has(b)) erros.push(`${c.data}: ${id} — ${a} sem ${b}`); };
    casal('YASSER', 'LIDIANE', 'RP005'); casal('LIDIANE', 'YASSER', 'RP005');
    casal('JESSE', 'JESSIE', 'RP004'); casal('JESSIE', 'JESSE', 'RP004');
    casal('JESSICA', 'JOAS', 'RP003'); casal('JOAS', 'JESSICA', 'RP003');

    // Nilson (louvor) + Manu
    const eqReg = new Set([c.reg, ...c.equipe].map(norm));
    for (const x of ['MIRELLA', 'MARCELA']) if (eqReg.has(x) && !eqReg.has('NILSINHO') && !eqReg.has('NILSON')) erros.push(`${c.data}: ${x} no louvor sem NILSON`);
    if (eqReg.has('MANU C.') && !eqReg.has('SILVANA')) erros.push(`${c.data}: RP009 — Manu C. sem Silvana`);
    if (eqReg.has('MANU S.') && !eqReg.has('JESSICA') && !eqReg.has('JOAS')) erros.push(`${c.data}: RP011 — Manu S. sem Jessica/Joas`);

    // Luiz da Silva + Ariadny juntos (resumo.md)
    if (setDia.has('LUIZ DA SILVA') && setDia.has('ARIADNY')) avisos.push(`${c.data}: Luiz da Silva e Ariadny juntos (resumo.md pede separar)`);
  }

  // RF004/RF002 — externos vs louvor (todos os cultos, com identidade)
  for (const c of cultos) {
    const louvorNomes = [c.reg, ...c.equipe, ...c.mm].filter((n) => !MM_TEXTO.has(norm(n)));
    const louvorP = louvorNomes.map(resolve).filter(Boolean);
    for (const [rotulo, ext] of [['PREGADOR', c.pregador], ['AUDIOVISUAL', c.av], ['ANCIÃO', c.anciao]]) {
      if (!ext || ext === '-') continue;
      const pe = resolve(ext); if (!pe) continue;
      for (const pl of louvorP) {
        if (pl.id === pe.id) {
          if (rotulo === 'ANCIÃO') { /* RF004-A: ancião pode acumular */ }
          else erros.push(`${c.data}: ${rotulo === 'AUDIOVISUAL' ? 'RF002' : 'RF004'} — ${rotulo} "${ext}" também no louvor`);
        }
      }
    }
  }

  // RF014 — MM repetida no mês
  const mmCount = new Map();
  for (const c of proprios) for (const n of c.mm) { if (!MM_TEXTO.has(norm(n))) mmCount.set(norm(n), (mmCount.get(norm(n)) || 0) + 1); }
  for (const [n, q] of mmCount) if (q > 1) erros.push(`RF014 — ${n} faz ${q} mensagens musicais no mês (máx 1)`);

  // RF013 — consecutivos (<= 2 dias)
  for (let i = 1; i < proprios.length; i++) {
    if (diasEntre(proprios[i - 1].iso, proprios[i].iso) > 2) continue;
    const prev = new Set([...proprios[i - 1].equipe, ...proprios[i - 1].mm].filter((n) => !MM_TEXTO.has(norm(n))).map(norm));
    for (const n of [...proprios[i].equipe, ...proprios[i].mm].filter((x) => !MM_TEXTO.has(norm(x))))
      if (prev.has(norm(n))) erros.push(`RF013 — ${n} canta em ${proprios[i - 1].data} e ${proprios[i].data} (consecutivos)`);
  }

  // incentivo (PE009) e ICR
  const apar = new Map();
  for (const c of proprios) for (const n of [c.reg, ...c.equipe, ...c.mm]) { if (MM_TEXTO.has(norm(n))) continue; apar.set(norm(n), (apar.get(norm(n)) || 0) + 1); }
  for (const p of pessoas) if (p.incentivo?.ativo && (apar.get(norm(p.nome)) || 0) > 1) avisos.push(`PE009 — ${p.nome} (incentivo) escalado ${apar.get(norm(p.nome))}x (ideal ~1)`);

  // ICR por pessoa escalável
  const totalCultos = proprios.length;
  const universo = pessoas.filter((p) => p.ativo && (p.habilitacoes?.equipe || p.habilitacoes?.regente));
  const icr = universo.map((p) => {
    const esc = apar.get(norm(p.nome)) || 0;
    let disp = 0;
    if (!mi.has(norm(p.nome))) for (const c of proprios) if (!indispNoDia(c.iso).has(norm(p.nome))) disp++;
    return { nome: p.nome, esc, disp, icr: esc / 3, incentivo: !!p.incentivo?.ativo };
  }).sort((a, b) => b.icr - a.icr || a.nome.localeCompare(b.nome));

  return { erros, avisos, icr, totalCultos };
}

/**
 * Faz o parse de um rascunho.md em objetos de culto.
 */
export function parseRascunho(md) {
  return md.split(/\r?\n/)
    .filter((l) => /^\|\s*\d{2}\/\d{2}\/\d{4}\s*\|/.test(l))
    .map((l) => {
      const c = l.split('|').map((x) => x.trim());
      return {
        data: c[1], iso: toIso(c[1]), dia: norm(c[2]).toLowerCase(),
        anciao: c[3], pregador: c[4], av: c[5],
        reg: c[6], equipe: split(c[7]), mm: split(c[8]),
      };
    });
}
