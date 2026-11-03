// Testes da verificação automática do site (Task 32).
//
// Cobre montador/lib/verificacao-site.mjs:
//  - conteudoCoincide: igualdade estrutural de JSON (independente de ordem de
//    chaves e de espaços); JSON inválido → false (Property 33, parte comparação);
//  - conferirSite: pendente_envio, aguardando, publicado (+ tabela de louvor) e
//    erro_conferencia, com fetch e relógio falsos, buscando as duas URLs com
//    ?t= e cache: 'no-store' (RF 24.1-24.3, 24.5, 24.7, 24.8).
//
// Usa a fixture de agosto/2026 (atual.json e contatos.json reais publicados),
// cuja conferência de links não tem erro → estado 'publicado'.
//
// Feature: melhoras-domingao (F. Envio) — Task 32; Property 33;
// Requisitos 24.1, 24.2, 24.3, 24.5, 24.7, 24.8.

import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';

import {
  conteudoCoincide,
  conferirSite,
  URL_ATUAL,
  URL_CONTATOS,
} from '../../montador/lib/verificacao-site.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX = resolve(__dirname, '../fixtures/agosto-2026');

const atualLocal = readFileSync(resolve(FIX, 'atual.json'), 'utf8');
const contatosLocal = readFileSync(resolve(FIX, 'contatos.json'), 'utf8');

/** git falso com um número de commits pendentes fixo. */
function gitFalso(pendentes) {
  return { status: async () => ({ pendentes, ramo: 'main' }) };
}

/**
 * fetch falso: devolve, por URL base (sem a query ?t=), o texto configurado.
 * Registra as URLs e opções recebidas para asserções.
 */
function fetchFalso(porUrl, registro) {
  return async (url, opcoes) => {
    if (registro) registro.push({ url, opcoes });
    const base = String(url).split('?')[0];
    const texto = porUrl[base];
    if (texto == null) return { ok: false, text: async () => '' };
    return { ok: true, text: async () => texto };
  };
}

describe('conteudoCoincide', () => {
  test('JSON estruturalmente igual (ordem de chaves diferente) coincide', () => {
    expect(conteudoCoincide('{"a":1,"b":2}', '{"b":2,"a":1}')).toBe(true);
  });

  test('JSON igual com espaços/indentação diferentes coincide', () => {
    expect(conteudoCoincide('[{"x":1}]', '[\n  { "x": 1 }\n]')).toBe(true);
  });

  test('conteúdo diferente não coincide', () => {
    expect(conteudoCoincide('{"a":1}', '{"a":2}')).toBe(false);
  });

  test('JSON inválido em qualquer lado → false', () => {
    expect(conteudoCoincide('{nao json', '{"a":1}')).toBe(false);
    expect(conteudoCoincide('{"a":1}', 'nao json')).toBe(false);
  });

  // Feature: melhoras-domingao, Property 33: Verificação do site (parte comparação)
  test('reflexivo e sensível só à estrutura', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (valor) => {
        const texto = JSON.stringify(valor);
        // Igual a si mesmo.
        expect(conteudoCoincide(texto, texto)).toBe(true);
        // Reserializado com indentação ainda coincide (só estrutura importa).
        const reindentado = JSON.stringify(valor, null, 2);
        expect(conteudoCoincide(reindentado, texto)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

describe('conferirSite', () => {
  test('pendente_envio quando há commit por enviar (não consulta o site)', async () => {
    let consultou = false;
    const fetchFn = async () => {
      consultou = true;
      return { ok: true, text: async () => '' };
    };
    const r = await conferirSite({ root: FIX, git: gitFalso(1), fetch: fetchFn });
    expect(r.estado).toBe('pendente_envio');
    expect(consultou).toBe(false);
  });

  test('aguardando quando só o atual.json remoto coincide', async () => {
    const fetchFn = fetchFalso({
      [URL_ATUAL]: atualLocal,
      [URL_CONTATOS]: '[]', // contatos diferente
    });
    const r = await conferirSite({ root: FIX, git: gitFalso(0), fetch: fetchFn });
    expect(r.estado).toBe('aguardando');
  });

  test('publicado quando os dois coincidem e a conferência não tem erro', async () => {
    // Root temporário com um atual.json/contatos.json internamente consistentes:
    // uma pessoa com telefone escalada como regente/equipe/MM, cujo link abre o
    // número dela mesma → conferência sem erro → publicado com tabela de louvor.
    const tmp = mkdtempSync(resolve(tmpdir(), 'verif-site-ok-'));
    const pessoas = {
      proximo_id: 2,
      pessoas: [
        {
          id: 1,
          nome: 'ANA MARIA',
          telefone: '5543999990001',
          ativo: true,
          genero: 'F',
          habilitacoes: { regente: true, equipe: true, mensagem_musical: { es: true, culto: true, domingo: true } },
        },
      ],
      grupos: {},
    };
    const atualOk = [
      {
        DATA: '08/08/2026',
        'DIA SEMANA': 'sábado',
        ACOMP: 'BANDA',
        'REGENTE LOUVOR': 'ANA MARIA',
        'EQUIPE LOUVOR': 'ANA MARIA',
        'MENSAGEM MUSICAL': 'ANA MARIA',
        'LOUVORES ES': '',
        'LOUVORES CULTO': '',
        'TEMA CULTO': '',
        AUDIOVISUAL: '',
        'ANCIÃO': '',
        PREGADOR: '',
        SUPORTE: '-',
        OBS: '',
      },
    ];
    const contatosOk = { 'ANA MARIA': { telefone: '5543999990001' } };
    writeFileSync(resolve(tmp, 'pessoas.json'), `${JSON.stringify(pessoas, null, 2)}\n`, 'utf8');
    const atualTexto = `${JSON.stringify(atualOk, null, 2)}\n`;
    const contatosTexto = `${JSON.stringify(contatosOk, null, 2)}\n`;
    writeFileSync(resolve(tmp, 'atual.json'), atualTexto, 'utf8');
    writeFileSync(resolve(tmp, 'contatos.json'), contatosTexto, 'utf8');

    const registro = [];
    const fetchFn = fetchFalso(
      { [URL_ATUAL]: atualTexto, [URL_CONTATOS]: contatosTexto },
      registro,
    );
    const r = await conferirSite({
      root: tmp,
      git: gitFalso(0),
      fetch: fetchFn,
      agora: () => 123456,
    });
    expect(r.estado).toBe('publicado');
    // A tabela só traz campos de louvor (REGENTE/EQUIPE/MENSAGEM MUSICAL).
    expect(Array.isArray(r.tabela)).toBe(true);
    const campos = new Set(r.tabela.map((t) => t.campo));
    for (const c of campos) {
      expect(['REGENTE LOUVOR', 'EQUIPE LOUVOR', 'MENSAGEM MUSICAL']).toContain(c);
    }
    expect(r.tabela.length).toBeGreaterThan(0);
    // As duas URLs foram buscadas com ?t= e cache: 'no-store'.
    expect(registro).toHaveLength(2);
    for (const chamada of registro) {
      expect(String(chamada.url)).toContain('?t=123456');
      expect(chamada.opcoes).toEqual({ cache: 'no-store' });
    }
    const buscadas = registro.map((c) => String(c.url).split('?')[0]);
    expect(buscadas).toContain(URL_ATUAL);
    expect(buscadas).toContain(URL_CONTATOS);

    rmSync(tmp, { recursive: true, force: true });
  });

  test('erro_conferencia quando coincidem mas a conferência remota tem erro', async () => {
    // Monta um root temporário copiando a fixture, mas com um nome escalado
    // cujo contato abre um número diferente do da pessoa (link errado). Como o
    // remoto é idêntico ao local desse root, os dois coincidem e a conferência
    // sobre o remoto acha o erro → erro_conferencia.
    const tmp = mkdtempSync(resolve(tmpdir(), 'verif-site-'));
    cpSync(FIX, tmp, { recursive: true });

    const contatos = JSON.parse(contatosLocal);
    const chaveAlvo = Object.keys(contatos).find((k) => k.toUpperCase() === 'ANDRE');
    expect(chaveAlvo).toBeTruthy();
    contatos[chaveAlvo] = { ...contatos[chaveAlvo], telefone: '5500000000000' };
    const contatosQuebrado = `${JSON.stringify(contatos, null, 2)}\n`;
    writeFileSync(resolve(tmp, 'contatos.json'), contatosQuebrado, 'utf8');

    const fetchFn = fetchFalso({
      [URL_ATUAL]: atualLocal,
      [URL_CONTATOS]: contatosQuebrado,
    });
    const r = await conferirSite({ root: tmp, git: gitFalso(0), fetch: fetchFn });
    expect(r.estado).toBe('erro_conferencia');
    expect(Array.isArray(r.erros)).toBe(true);
    expect(r.erros.length).toBeGreaterThan(0);

    rmSync(tmp, { recursive: true, force: true });
  });

  test('erro_rede quando a busca do site falha', async () => {
    const fetchFn = async () => ({ ok: false, text: async () => '' });
    const r = await conferirSite({ root: FIX, git: gitFalso(0), fetch: fetchFn });
    expect(r.estado).toBe('erro_rede');
  });
});
