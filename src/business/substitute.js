import { estaEscalado, normalizarNome } from '../utils/name.js';
import { isPastDate } from '../utils/date.js';
import { buscarContato } from '../utils/contact.js';

/** "LUIZ ANTONIO" → "Luiz Antonio" */
function _capitalizar(nome) {
  return nome
    .toLowerCase()
    .split(' ')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

/** "11/03/2026" + "Quarta" → "11/03 (Quarta)" */
function _formatarData(dataStr, diaSemana) {
  const parts = (dataStr || '').split('/');
  const ddmm = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : dataStr;
  return diaSemana ? `${ddmm} (${diaSemana})` : ddmm;
}

/**
 * Resolves who should be notified and builds the role-specific message.
 * Returns { nomeAlvo, telefone, msg } or null.
 */
function _resolverAlvo(contatosMap, nomeVinculado, registro) {
  const n = normalizarNome(nomeVinculado);
  const _inclui = (campo) =>
    (registro[campo] || '').split(',').map((x) => normalizarNome(x.trim())).includes(n);
  const data = _formatarData(registro.DATA, registro['DIA SEMANA']);

  const _alvo = (nomeKey, msgFn) => {
    const c = buscarContato(contatosMap, nomeKey);
    if (!c?.telefone) return null;
    return { nomeAlvo: nomeKey, telefone: c.telefone, msg: msgFn(_capitalizar(nomeKey)) };
  };

  if (_inclui('REGENTE LOUVOR')) {
    return _alvo('NATAN', (dest) =>
      `Olá ${dest}, estava escalado como regente de louvor no culto do dia ${data}, mas tive um imprevisto e não poderei ir. Poderia me ajudar?`);
  }

  if (_inclui('EQUIPE LOUVOR')) {
    const regenteNome = (registro['REGENTE LOUVOR'] || '').split(',')[0].trim();
    if (regenteNome) {
      const c = buscarContato(contatosMap, regenteNome);
      if (c?.telefone) {
        const dest = _capitalizar(regenteNome);
        return {
          nomeAlvo: regenteNome,
          telefone: c.telefone,
          msg: `Olá ${dest}, estava escalado na equipe de louvor no culto do dia ${data}, mas tive um imprevisto e não poderei ir. Poderia me ajudar?`,
        };
      }
    }
    return null;
  }

  if (_inclui('MENSAGEM MUSICAL')) {
    return _alvo('NATAN', (dest) =>
      `Olá ${dest}, estava escalado para a mensagem musical no culto do dia ${data}, mas tive um imprevisto e não poderei ir. Poderia me ajudar?`);
  }

  if (_inclui('PREGADOR')) {
    const anciaoNome = (registro['ANCIÃO'] || '').split(',')[0].trim();
    if (anciaoNome) {
      const c = buscarContato(contatosMap, anciaoNome);
      if (c?.telefone) {
        const dest = _capitalizar(anciaoNome);
        return {
          nomeAlvo: anciaoNome,
          telefone: c.telefone,
          msg: `Olá ${dest}, estava escalado como pregador no culto do dia ${data}, mas tive um imprevisto e não poderei ir. Poderia me ajudar?`,
        };
      }
    }
    return null;
  }

  if (_inclui('ANCIÃO')) {
    return _alvo('YASSER', (dest) =>
      `Olá ${dest}, estava escalado como ancião de culto no dia ${data}, mas tive um imprevisto e não poderei ir. Poderia me ajudar?`);
  }

  if (_inclui('AUDIOVISUAL') || _inclui('SUPORTE')) {
    return _alvo('ALEX', (dest) =>
      `Olá ${dest}, estava escalado no audiovisual no culto do dia ${data}, mas tive um imprevisto e não poderei ir. Poderia me ajudar?`);
  }

  return null;
}

/**
 * Generates a WhatsApp "find me a substitute" anchor, or '' when any guard
 * condition is not met (not logged in, not scheduled, date is past, no contact).
 */
export function gerarLinkSubstituto(contatosMap, usuarioAtual, registro) {
  if (!usuarioAtual?.nomeVinculado) return '';
  if (!estaEscalado(registro, usuarioAtual.nomeVinculado)) return '';
  if (isPastDate(registro.DATA)) return '';

  const alvo = _resolverAlvo(contatosMap, usuarioAtual.nomeVinculado, registro);
  if (!alvo) return '';

  const telefoneLimpo = alvo.telefone.replace(/\D/g, '');
  const link = `https://api.whatsapp.com/send?phone=${telefoneLimpo}&text=${encodeURIComponent(alvo.msg)}`;

  return `<a href="${link}" target="_blank" class="btn-substituto" title="Pedir substituição pelo WhatsApp">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
    Me substitua :(
  </a>`;
}
