// Testes das mensagens de WhatsApp editáveis (Task 33).
//  - 33.2 unitários: preencherMensagem (nome, funções, data), validações e
//    carregamento com arquivo ausente.
//  - 33.1 Property 12 (parte das mensagens): histórico só por acréscimo e
//    reversão fiel, via salvarMensagens/reverterMensagens.

import fc from 'fast-check';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  existsSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MENSAGENS_PADRAO,
  PLACEHOLDERS,
  carregarMensagens,
  validarMensagens,
  preencherMensagem,
} from '../../scripts/lib/mensagens-whatsapp.js';
import {
  salvarMensagens,
  reverterMensagens,
  historico,
} from '../../montador/lib/regras-catalogo.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

/** Arquivos mínimos para o histórico em raiz temporária. */
const ARQUIVOS = [
  'processos/regras/mensagens-whatsapp.json',
  'processos/regras/historico-versoes.json',
];

function raizTemporaria() {
  const base = mkdtempSync(resolve(tmpdir(), 'escala-mensagens-'));
  mkdirSync(resolve(base, 'processos/regras'), { recursive: true });
  for (const rel of ARQUIVOS) {
    const origem = resolve(ROOT, rel);
    if (existsSync(origem)) copyFileSync(origem, resolve(base, rel));
  }
  // Garante um histórico vazio na raiz temporária.
  writeFileSync(
    resolve(base, 'processos/regras/historico-versoes.json'),
    `${JSON.stringify({ versoes: [] }, null, 2)}\n`,
    'utf8',
  );
  return base;
}

// ───────────────────────────────────────────────────────────────────────────
// 33.2 Unitários — preencherMensagem
// ───────────────────────────────────────────────────────────────────────────

describe('preencherMensagem', () => {
  test('{nome} vira formato título: "DANY KALLAS" → "Dany Kallas"', () => {
    expect(preencherMensagem('{nome}', { nome: 'DANY KALLAS' })).toBe('Dany Kallas');
  });

  test('{nome} preserva acento: "ANDRÉ" → "André"', () => {
    expect(preencherMensagem('{nome}', { nome: 'ANDRÉ' })).toBe('André');
  });

  test('{funções} com três funções usa vírgula e " e "', () => {
    const out = preencherMensagem('{funções}', {
      funcoes: ['REGENTE LOUVOR', 'EQUIPE LOUVOR', 'MENSAGEM MUSICAL'],
    });
    expect(out).toBe('*REGENTE LOUVOR*, *EQUIPE LOUVOR* e *MENSAGEM MUSICAL*');
  });

  test('{funções} com uma função não tem conectivo', () => {
    expect(preencherMensagem('{funções}', { funcoes: ['REGENTE LOUVOR'] })).toBe('*REGENTE LOUVOR*');
  });

  test('{data} simples e múltiplas', () => {
    expect(preencherMensagem('{data}', { datas: '23/08' })).toBe('23/08');
    expect(preencherMensagem('{data}', { datas: ['23/08', '30/08'] })).toBe('23/08 e 30/08');
  });

  test('{mes/ano} e {grupo}', () => {
    expect(preencherMensagem('{mes/ano}', { mesAno: 'agosto/2026' })).toBe('agosto/2026');
    expect(preencherMensagem('{grupo}', { grupo: 'FAMILIA NILSINHO' })).toBe('FAMILIA NILSINHO');
  });

  test('preenche o template pessoa padrão como em agosto/2026', () => {
    const out = preencherMensagem(MENSAGENS_PADRAO.templates.pessoa, {
      nome: 'DANY KALLAS',
      mesAno: 'agosto/2026',
      funcoes: ['REGENTE LOUVOR', 'EQUIPE LOUVOR'],
    });
    expect(out).toContain('Olá, Dany Kallas!');
    expect(out).toContain('escala de *agosto/2026*');
    expect(out).toContain('como *REGENTE LOUVOR* e *EQUIPE LOUVOR*.');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 33.2 Unitários — validarMensagens / carregarMensagens
// ───────────────────────────────────────────────────────────────────────────

describe('validarMensagens', () => {
  test('o conteúdo inicial é válido', () => {
    expect(validarMensagens(MENSAGENS_PADRAO)).toEqual([]);
  });

  test('template vazio é recusado indicando o nome', () => {
    const obj = JSON.parse(JSON.stringify(MENSAGENS_PADRAO));
    obj.templates.pessoa = '';
    const problemas = validarMensagens(obj);
    expect(problemas.some((p) => p.includes('pessoa'))).toBe(true);
  });

  test('placeholder fora da lista é recusado indicando o template', () => {
    const obj = JSON.parse(JSON.stringify(MENSAGENS_PADRAO));
    obj.templates.grupo = 'Olá {telefone}';
    const problemas = validarMensagens(obj);
    expect(problemas.some((p) => p.includes('grupo') && p.includes('{telefone}'))).toBe(true);
  });

  test('contato fixo sem nome é recusado', () => {
    const obj = JSON.parse(JSON.stringify(MENSAGENS_PADRAO));
    obj.fixos = [{ rotulo: 'sem nome' }];
    expect(validarMensagens(obj).length).toBeGreaterThan(0);
  });

  test('link do grupo inválido é recusado', () => {
    const obj = JSON.parse(JSON.stringify(MENSAGENS_PADRAO));
    obj.grupo_louvor = 'https://exemplo.com/abc';
    expect(validarMensagens(obj).length).toBeGreaterThan(0);
  });

  test('template obrigatório ausente é recusado', () => {
    const obj = { templates: { pessoa: 'x', grupo: 'y', fixo: 'z' } }; // falta culto_inteiro
    expect(validarMensagens(obj).some((p) => p.includes('culto_inteiro'))).toBe(true);
  });

  test('todos os placeholders conhecidos são aceitos', () => {
    const obj = JSON.parse(JSON.stringify(MENSAGENS_PADRAO));
    obj.templates.pessoa = PLACEHOLDERS.join(' ');
    expect(validarMensagens(obj)).toEqual([]);
  });
});

describe('carregarMensagens', () => {
  test('arquivo ausente devolve padrão + aviso', () => {
    const { mensagens, avisos } = carregarMensagens('/caminho/inexistente.json');
    expect(mensagens.templates.pessoa).toBe(MENSAGENS_PADRAO.templates.pessoa);
    expect(avisos.length).toBeGreaterThan(0);
  });

  test('arquivo inválido devolve padrão + aviso', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'escala-msg-bad-'));
    const caminho = resolve(dir, 'mensagens-whatsapp.json');
    writeFileSync(caminho, '{ nao e json', 'utf8');
    try {
      const { mensagens, avisos } = carregarMensagens(caminho);
      expect(mensagens.templates.fixo).toBe(MENSAGENS_PADRAO.templates.fixo);
      expect(avisos.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('o arquivo do repositório é válido (sem avisos)', () => {
    const { avisos } = carregarMensagens(resolve(ROOT, 'processos/regras/mensagens-whatsapp.json'));
    expect(avisos).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 33.1 Property 12 (parte das mensagens) — histórico só por acréscimo e reversão fiel
// ───────────────────────────────────────────────────────────────────────────

describe('Property 12: histórico das mensagens só por acréscimo e reversão fiel', () => {
  // Feature: melhoras-domingao, Property 12: Histórico somente por acréscimo e reversão fiel
  // Validates: Requirements 26.3

  /** Lê o conteúdo vigente do arquivo de mensagens na raiz. */
  function conteudoVigente(root) {
    return JSON.parse(
      readFileSync(resolve(root, 'processos/regras/mensagens-whatsapp.json'), 'utf8'),
    );
  }

  test('salvamentos/reversões só acrescentam; números consecutivos; reversão fiel', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.record({ tipo: fc.constant('salvar'), texto: fc.string({ minLength: 1, maxLength: 40 }) }),
            fc.record({ tipo: fc.constant('reverter'), alvoRel: fc.double({ min: 0, max: 0.999, noNaN: true }) }),
          ),
          { minLength: 1, maxLength: 8 },
        ),
        (acoes) => {
          const root = raizTemporaria();
          try {
            let anterior = [];

            for (const acao of acoes) {
              if (acao.tipo === 'salvar') {
                const texto = acao.texto.replace(/[{}]/g, '').trim() || 'x';
                const novo = JSON.parse(JSON.stringify(MENSAGENS_PADRAO));
                novo.templates.pessoa = `Olá, {nome}! ${texto}`;
                salvarMensagens(novo, { autor: 'T', root });
              } else {
                const versoes = historico('mensagens-whatsapp', { root });
                if (versoes.length === 0) continue;
                const idx = Math.min(versoes.length - 1, Math.floor(acao.alvoRel * versoes.length));
                const numeroAlvo = versoes[idx].numero;
                reverterMensagens(numeroAlvo, { autor: 'T', root });

                // Reversão fiel: o arquivo vigente = conteúdo da versão escolhida.
                expect(conteudoVigente(root)).toEqual(versoes[idx].conteudo);
              }

              const atual = historico('mensagens-whatsapp', { root });

              // Só por acréscimo: o histórico anterior é prefixo do atual.
              expect(atual.length).toBeGreaterThanOrEqual(anterior.length);
              for (let i = 0; i < anterior.length; i++) {
                expect(atual[i]).toEqual(anterior[i]);
              }

              // Números consecutivos por alvo a partir de 1.
              for (let i = 0; i < atual.length; i++) {
                expect(atual[i].numero).toBe(i + 1);
              }

              // O conteúdo vigente é o da última versão.
              if (atual.length > 0) {
                expect(conteudoVigente(root)).toEqual(atual[atual.length - 1].conteudo);
              }

              anterior = atual;
            }
          } finally {
            rmSync(root, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  test('salvamento recusa mensagens inválidas e não altera o histórico', () => {
    const root = raizTemporaria();
    try {
      const invalido = JSON.parse(JSON.stringify(MENSAGENS_PADRAO));
      invalido.templates.pessoa = '';
      expect(() => salvarMensagens(invalido, { autor: 'T', root })).toThrow();
      expect(historico('mensagens-whatsapp', { root })).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
