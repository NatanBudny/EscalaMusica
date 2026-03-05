import { estaEscalado } from '../utils/name.js';
import { isPastDate } from '../utils/date.js';
import { buscarContato } from '../utils/contact.js';

/**
 * Generates a WhatsApp "find me a substitute" anchor string, or '' when
 * any guard condition is not met:
 *   - user must be logged in with a linked name
 *   - user must be scheduled in this record
 *   - the date must be in the future
 *   - a contact must exist for the conductor (regente) or the elder (ancião)
 */
export function gerarLinkSubstituto(contatosMap, usuarioAtual, registro) {
  if (!usuarioAtual?.nomeVinculado) return '';
  if (!estaEscalado(registro, usuarioAtual.nomeVinculado)) return '';
  if (isPastDate(registro.DATA)) return '';

  const regenteNome = (registro['REGENTE LOUVOR'] || '').split(',')[0].trim();
  const anciaoNome  = (registro['ANCIÃO']         || '').split(',')[0].trim();

  let contatoAlvo = buscarContato(contatosMap, regenteNome);
  let nomeAlvo    = regenteNome;

  if (!contatoAlvo?.telefone) {
    contatoAlvo = buscarContato(contatosMap, anciaoNome);
    nomeAlvo    = anciaoNome;
  }

  if (!contatoAlvo?.telefone) return '';

  const telefoneLimpo = contatoAlvo.telefone.replace(/\D/g, '');
  const msg  = `Olá ${nomeAlvo}, estou escalado para o dia ${registro.DATA} na equipe, mas tive um imprevisto e não poderei ir. Poderia me ajudar a encontrar um substituto?`;
  const link = `https://api.whatsapp.com/send?phone=${telefoneLimpo}&text=${encodeURIComponent(msg)}`;

  return `<a href="${link}" target="_blank" class="btn-substituto" title="Pedir substituição pelo WhatsApp">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
    Me substitua :(
  </a>`;
}
