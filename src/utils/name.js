export const SCHEDULE_FIELDS = [
  'REGENTE LOUVOR', 'EQUIPE LOUVOR', 'PREGADOR',
  'MENSAGEM MUSICAL', 'AUDIOVISUAL', 'ANCIÃO', 'SUPORTE',
];

export const SEARCH_FIELDS = [
  ...SCHEDULE_FIELDS,
  'DATA', 'DIA SEMANA', 'ACOMP', 'TEMA CULTO', 'OBS',
];

/** Removes diacritics, uppercases, and trims a name string. */
export function normalizarNome(n) {
  return n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
}

/**
 * Returns true if `nome` appears in any schedule field of `registro`.
 * Handles comma-separated team lists.
 */
export function estaEscalado(registro, nome) {
  if (!nome) return false;
  const n = normalizarNome(nome);
  return SCHEDULE_FIELDS.some((c) => {
    const v = registro[c] || '';
    return v.includes(',')
      ? v.split(',').map((x) => normalizarNome(x.trim())).includes(n)
      : normalizarNome(v) === n;
  });
}

/** Filters `dados` by `termo` across all searchable fields. */
export function buscarPorNome(dados, termo) {
  if (!termo) return dados;
  const t = normalizarNome(termo);
  return dados.filter((r) =>
    SEARCH_FIELDS.some((c) => {
      const v = (r[c] || '').toString();
      return v.includes(',')
        ? v.split(',').map((x) => normalizarNome(x.trim())).some((x) => x.includes(t))
        : normalizarNome(v).includes(t);
    }),
  );
}
