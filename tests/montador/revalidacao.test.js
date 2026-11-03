// Testes da revalidação completa antes do envio (Task 29).
//
// Cobre as travas e os avisos de montador/lib/revalidacao.mjs:
//  - pessoa escalada sem telefone gera erro;
//  - culto departamental não gera erro de telefone;
//  - Grupo_Escalavel passa pelo telefone do responsável;
//  - grupo com responsável sem telefone gera erro;
//  - OBS com "pendente" ou "<" gera erro;
//  - votante da enquete pendente gera aviso;
//  - revalidarParaEnvio junta validarEscala + travas + obs + catálogo.
//
// Feature: melhoras-domingao (F. Envio) — Task 29; Requisitos 6.16, 21.1-21.5.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  travaTelefone,
  verificarObs,
  revalidarParaEnvio,
  revalidarCatalogo,
} from '../../montador/lib/revalidacao.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
// root sem atual.json para gerarLinhasAtual não mesclar dados do disco.
const ROOT_VAZIO = resolve(__dirname, '../fixtures/__inexistente__');

/** Cadastro mínimo controlado. */
function cadastroDe(pessoas) {
  const porId = new Map();
  const porNome = new Map();
  for (const p of pessoas) {
    porId.set(p.id, p);
    porNome.set(String(p.nome).toUpperCase().trim(), p);
    for (const a of p.aliases || []) porNome.set(String(a).toUpperCase().trim(), p);
  }
  return { pessoas, porId, porNome, grupos: new Map() };
}

const PESSOAS = [
  { id: 1, nome: 'ANA', aliases: [], telefone: '5543999990001', ativo: true, genero: 'F', habilitacoes: { regente: true, equipe_louvor: true, mensagem_musical: true } },
  { id: 2, nome: 'MANU C.', aliases: [], telefone: '', ativo: true, genero: 'F', habilitacoes: { equipe_louvor: true } },
  { id: 3, nome: 'NILSINHO', aliases: [], telefone: '5543999990003', ativo: true, genero: 'M', habilitacoes: { mensagem_musical: true } },
  { id: 4, nome: 'SEM FONE', aliases: [], telefone: '', ativo: true, genero: 'M', habilitacoes: { mensagem_musical: true } },
];

function baseDe(grupos = new Map()) {
  const cadastro = cadastroDe(PESSOAS);
  return {
    root: ROOT_VAZIO,
    cadastro,
    grupos,
    indisponibilidade: { datas: [], indisponiveis_mes_inteiro: { ids: [] } },
    historico: new Map(),
    mesAlvo: '2099-01',
  };
}

const grupoNilsinho = new Map([
  ['familia_nilsinho', { chave: 'familia_nilsinho', nome_exibicao: 'FAMILIA NILSINHO', responsavel_id: 3, membros_ids: [3], modo: 'funcao', funcoes: ['mm'] }],
]);
const grupoSemFone = new Map([
  ['grupo_sem_fone', { chave: 'grupo_sem_fone', nome_exibicao: 'GRUPO SEM FONE', responsavel_id: 4, membros_ids: [4], modo: 'funcao', funcoes: ['mm'] }],
]);

describe('travaTelefone', () => {
  test('pessoa escalada sem telefone gera erro', () => {
    const base = baseDe();
    const linhas = [{ DATA: '03/01/2099', 'REGENTE LOUVOR': 'ANA', 'EQUIPE LOUVOR': 'MANU C.', 'MENSAGEM MUSICAL': '', OBS: '' }];
    const erros = travaTelefone(linhas, base);
    expect(erros).toHaveLength(1);
    expect(erros[0].chave).toBe('sem_telefone');
    expect(erros[0].texto).toContain('MANU C.');
    expect(erros[0].nivel).toBe('bloqueio');
  });

  test('culto departamental não gera erro de telefone', () => {
    const base = baseDe();
    const linhas = [{ DATA: '04/01/2099', 'REGENTE LOUVOR': 'JOVENS', 'EQUIPE LOUVOR': 'JOVENS', 'MENSAGEM MUSICAL': 'JOVENS', OBS: '' }];
    expect(travaTelefone(linhas, base)).toHaveLength(0);
  });

  test('"-" e vazio não geram erro', () => {
    const base = baseDe();
    const linhas = [{ DATA: '05/01/2099', 'REGENTE LOUVOR': '-', 'EQUIPE LOUVOR': '', 'MENSAGEM MUSICAL': '-', OBS: '' }];
    expect(travaTelefone(linhas, base)).toHaveLength(0);
  });

  test('Grupo_Escalavel passa pelo telefone do responsável', () => {
    const base = baseDe(grupoNilsinho);
    const linhas = [{ DATA: '06/01/2099', 'REGENTE LOUVOR': 'ANA', 'EQUIPE LOUVOR': 'ANA', 'MENSAGEM MUSICAL': 'FAMILIA NILSINHO', OBS: '' }];
    expect(travaTelefone(linhas, base)).toHaveLength(0);
  });

  test('grupo com responsável sem telefone gera erro', () => {
    const base = baseDe(grupoSemFone);
    const linhas = [{ DATA: '07/01/2099', 'REGENTE LOUVOR': 'ANA', 'EQUIPE LOUVOR': 'ANA', 'MENSAGEM MUSICAL': 'GRUPO SEM FONE', OBS: '' }];
    const erros = travaTelefone(linhas, base);
    expect(erros).toHaveLength(1);
    expect(erros[0].texto).toContain('GRUPO SEM FONE');
    expect(erros[0].texto).toContain('responsável');
  });

  test('cada nome de campo com vírgula é avaliado separadamente', () => {
    const base = baseDe();
    // ANA tem telefone, MANU C. não: só MANU C. gera erro.
    const linhas = [{ DATA: '08/01/2099', 'REGENTE LOUVOR': 'ANA', 'EQUIPE LOUVOR': 'ANA, MANU C.', 'MENSAGEM MUSICAL': '', OBS: '' }];
    const erros = travaTelefone(linhas, base);
    expect(erros).toHaveLength(1);
    expect(erros[0].texto).toContain('MANU C.');
  });
});

describe('verificarObs', () => {
  test('OBS com "<" gera erro', () => {
    const erros = verificarObs([{ DATA: '03/01/2099', OBS: 'bom <b>' }]);
    expect(erros.some((e) => e.chave === 'obs')).toBe(true);
  });

  test('OBS com termo proibido ("pendente") gera erro', () => {
    const erros = verificarObs([{ DATA: '03/01/2099', OBS: 'escala pendente' }]);
    expect(erros.some((e) => e.chave === 'obs')).toBe(true);
  });

  test('OBS limpa não gera erro', () => {
    expect(verificarObs([{ DATA: '03/01/2099', OBS: 'Dia das Mães' }])).toHaveLength(0);
  });
});

describe('revalidarCatalogo', () => {
  test('o catálogo do repositório não tem erros', () => {
    const { erros } = revalidarCatalogo({ root: ROOT });
    expect(erros).toHaveLength(0);
  });
});

describe('revalidarParaEnvio', () => {
  test('junta erros de escala, trava de telefone e obs; devolve linhasAtual e contatos', () => {
    const base = baseDe(grupoNilsinho);
    const cultos = [
      {
        data: '2099-01-03',
        dia_semana: 'sabado',
        modelo_louvor: 'sabado',
        tipo: 'louvor',
        slots: ['regente', 'equipe', 'mm_es', 'mm_culto'],
        regente: 1,
        equipe: [2],
        mm: { mm_es: 'grupo:familia_nilsinho' },
        acomp: 'BANDA',
        obs: 'texto <ruim>',
        anciao: '',
        pregador: '',
        audiovisual: '',
        suporte: '',
      },
    ];
    const r = revalidarParaEnvio(base, cultos, { root: ROOT });
    expect(Array.isArray(r.linhasAtual)).toBe(true);
    expect(r.linhasAtual).toHaveLength(1);
    expect(r.contatos).toBeDefined();
    // MANU C. (id 2) sem telefone na equipe → erro de trava.
    expect(r.erros.some((e) => e.chave === 'sem_telefone')).toBe(true);
    // OBS com "<" → erro de obs.
    expect(r.erros.some((e) => e.chave === 'obs')).toBe(true);
    // FAMILIA NILSINHO (responsável com telefone) não gera erro de telefone no MM.
    expect(r.erros.filter((e) => e.chave === 'sem_telefone' && /FAMILIA NILSINHO/.test(e.texto))).toHaveLength(0);
  });
});
