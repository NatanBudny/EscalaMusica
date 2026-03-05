import { normalizarNome } from '../utils/name.js';

const ROLE_CHECKS = [
  {
    campo: 'PREGADOR',
    papel: 'PREGAR NA CENTRAL',
    descricao: '',
  },
  {
    campo: 'REGENTE LOUVOR',
    papel: 'REGÊNCIA NA CENTRAL',
    descricao:
      '📋 TAREFAS DO REGENTE:\\n- Definir músicas\\n- Confirmar equipe\\n- Comunicar banda\\n- Enviar músicas para sonoplastia\\n- Se preparar espiritualmente\\n- Conduzir equipe de louvor à adoração e não apresentação\\n- Definir data do ensaio',
  },
  {
    campo: 'EQUIPE LOUVOR',
    papel: 'CANTAR LOUVOR',
    descricao:
      '📋 TAREFAS DA EQUIPE:\\n- Perguntar ao regente as músicas\\n- Se preparar espiritualmente',
  },
  { campo: 'MENSAGEM MUSICAL', papel: 'MENSAGEM MUSICAL NA CENTRAL', descricao: '' },
  { campo: 'AUDIOVISUAL',      papel: 'FAZER A MÍDIA DO CULTO',      descricao: '' },
  { campo: 'SUPORTE',          papel: 'DAR SUPORTE NA CENTRAL',      descricao: '' },
  { campo: 'ANCIÃO',           papel: 'SOU ANCIÃO',                  descricao: '' },
];

/**
 * Inspects all 7 role fields to find which roles `nome` fills.
 * Returns the joined role title and a corresponding description for a calendar event.
 */
export function getDetalhesAgenda(registro, nome) {
  const n = normalizarNome(nome);
  const papeis = [];
  const descricoes = [];

  for (const { campo, papel, descricao } of ROLE_CHECKS) {
    const v = registro[campo] || '';
    const escalado = v.includes(',')
      ? v.split(',').map((x) => normalizarNome(x.trim())).includes(n)
      : normalizarNome(v) === n;
    if (escalado) {
      papeis.push(papel);
      if (descricao) descricoes.push(descricao);
    }
  }

  const papelFinal =
    papeis.length > 0 ? papeis.join(' E ') : 'ESCALA NA CENTRAL';
  let descricaoFinal =
    descricoes.join('\\n\\n') ||
    '📋 PREPARAÇÃO:\\n- Se preparar espiritualmente para o culto';
  if (registro['TEMA CULTO'])
    descricaoFinal += `\\n\\n📌 Tema do Culto: ${registro['TEMA CULTO']}`;

  return { papel: papelFinal, descricao: descricaoFinal };
}
