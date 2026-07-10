import { carregarPessoas } from '../../scripts/lib/cadastro.js';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_VALIDO = resolve(__dirname, '../fixtures/pessoas-valido.json');

function criarTempDir() {
  const dir = resolve(tmpdir(), `cadastro-test-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function escreverFixture(dir, dados) {
  const caminho = resolve(dir, 'pessoas.json');
  writeFileSync(caminho, JSON.stringify(dados, null, 2), 'utf8');
  return caminho;
}

function fixtureBase() {
  return {
    versao: '1.0.0',
    proximo_id: 3,
    ultima_atualizacao: '2026-01-01',
    grupos: {},
    departamentos_contato: {},
    pessoas: [
      {
        id: 1,
        nome: 'FULANO',
        aliases: [],
        telefone: '5511999990001',
        genero: 'M',
        ativo: true,
        perfil_canto: 'base',
        notas: '',
        habilitacoes: {
          regente: false,
          equipe: true,
          mensagem_musical: { es: false, culto: false, domingo: false },
        },
        afastado: null,
        vinculos: [],
        dias_permitidos: null,
      },
      {
        id: 2,
        nome: 'CICLANA',
        aliases: ['CICLA'],
        telefone: '5511999990002',
        genero: 'F',
        ativo: true,
        perfil_canto: 'participacao',
        notas: '',
        habilitacoes: {
          regente: true,
          equipe: true,
          mensagem_musical: { es: true, culto: true, domingo: true },
        },
        afastado: null,
        vinculos: [],
        dias_permitidos: null,
      },
    ],
  };
}

// ─── Carregamento válido ─────────────────────────────────────────────────────

describe('carregarPessoas – carregamento válido', () => {
  test('carrega fixture válido e retorna estrutura correta', () => {
    const resultado = carregarPessoas(FIXTURE_VALIDO);

    expect(resultado.pessoas).toHaveLength(5);
    expect(resultado.porId).toBeInstanceOf(Map);
    expect(resultado.porNome).toBeInstanceOf(Map);
    expect(resultado.grupos).toBeInstanceOf(Map);
  });

  test('porId.size === pessoas.length', () => {
    const resultado = carregarPessoas(FIXTURE_VALIDO);
    expect(resultado.porId.size).toBe(resultado.pessoas.length);
  });

  test('porNome mapeia nomes canônicos e aliases', () => {
    const resultado = carregarPessoas(FIXTURE_VALIDO);

    // Nomes canônicos
    expect(resultado.porNome.get('ALICE')).toBeDefined();
    expect(resultado.porNome.get('BOB')).toBeDefined();
    expect(resultado.porNome.get('EDUARDO')).toBeDefined();

    // Aliases
    expect(resultado.porNome.get('ALI')).toBe(resultado.porNome.get('ALICE'));
    expect(resultado.porNome.get('ROBERTO')).toBe(resultado.porNome.get('BOB'));
    expect(resultado.porNome.get('EDU')).toBe(resultado.porNome.get('EDUARDO'));
    expect(resultado.porNome.get('DUDU')).toBe(resultado.porNome.get('EDUARDO'));
  });

  test('grupos são carregados corretamente', () => {
    const resultado = carregarPessoas(FIXTURE_VALIDO);
    expect(resultado.grupos.has('familia_silva')).toBe(true);
    expect(resultado.grupos.get('familia_silva').membros_ids).toEqual([3, 4]);
  });
});

// ─── Validação de IDs ────────────────────────────────────────────────────────

describe('carregarPessoas – validação de IDs', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = criarTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('lança erro para ID duplicado', () => {
    const dados = fixtureBase();
    dados.pessoas[1].id = 1; // Duplica o ID
    dados.proximo_id = 2;
    const caminho = escreverFixture(tempDir, dados);

    expect(() => carregarPessoas(caminho)).toThrow(/ID duplicado.*1/i);
  });

  test('lança erro para ID zero', () => {
    const dados = fixtureBase();
    dados.pessoas[0].id = 0;
    dados.proximo_id = 3;
    const caminho = escreverFixture(tempDir, dados);

    expect(() => carregarPessoas(caminho)).toThrow(/ID inválido/i);
  });

  test('lança erro para ID negativo', () => {
    const dados = fixtureBase();
    dados.pessoas[0].id = -5;
    dados.proximo_id = 3;
    const caminho = escreverFixture(tempDir, dados);

    expect(() => carregarPessoas(caminho)).toThrow(/ID inválido/i);
  });

  test('lança erro para ID não-inteiro', () => {
    const dados = fixtureBase();
    dados.pessoas[0].id = 1.5;
    dados.proximo_id = 3;
    const caminho = escreverFixture(tempDir, dados);

    expect(() => carregarPessoas(caminho)).toThrow(/ID inválido/i);
  });
});

// ─── Validação de nomes e aliases ────────────────────────────────────────────

describe('carregarPessoas – validação de nomes e aliases', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = criarTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('lança erro para nome duplicado', () => {
    const dados = fixtureBase();
    dados.pessoas[1].nome = 'FULANO'; // Duplica nome
    const caminho = escreverFixture(tempDir, dados);

    expect(() => carregarPessoas(caminho)).toThrow(/[Nn]ome duplicado.*FULANO/);
  });

  test('lança erro para alias que duplica outro nome', () => {
    const dados = fixtureBase();
    dados.pessoas[1].aliases = ['FULANO']; // Alias = nome de outra pessoa
    const caminho = escreverFixture(tempDir, dados);

    expect(() => carregarPessoas(caminho)).toThrow(/[Aa]lias duplicado.*FULANO/);
  });

  test('lança erro para alias que duplica outro alias', () => {
    const dados = fixtureBase();
    dados.pessoas[0].aliases = ['APELIDO'];
    dados.pessoas[1].aliases = ['APELIDO']; // Duplica
    const caminho = escreverFixture(tempDir, dados);

    expect(() => carregarPessoas(caminho)).toThrow(/[Aa]lias duplicado.*APELIDO/);
  });

  test('lança erro para nome não-UPPER', () => {
    const dados = fixtureBase();
    dados.pessoas[0].nome = 'Fulano';
    const caminho = escreverFixture(tempDir, dados);

    expect(() => carregarPessoas(caminho)).toThrow(/UPPER/i);
  });
});

// ─── Validação de vínculos ───────────────────────────────────────────────────

describe('carregarPessoas – validação de vínculos', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = criarTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('lança erro para sempre_junto referenciando ID inexistente', () => {
    const dados = fixtureBase();
    dados.pessoas[0].vinculos = [{ tipo: 'sempre_junto', com_id: 999 }];
    const caminho = escreverFixture(tempDir, dados);

    expect(() => carregarPessoas(caminho)).toThrow(/ID inexistente.*999/);
  });

  test('lança erro para sempre_junto assimétrico (P8)', () => {
    const dados = fixtureBase();
    // FULANO (1) → CICLANA (2), mas CICLANA não tem vínculo recíproco
    dados.pessoas[0].vinculos = [{ tipo: 'sempre_junto', com_id: 2 }];
    dados.pessoas[1].vinculos = []; // Sem reciprocidade
    const caminho = escreverFixture(tempDir, dados);

    expect(() => carregarPessoas(caminho)).toThrow(/assimétrico|P8/i);
  });

  test('valida sempre_junto simétrico sem erro', () => {
    const dados = fixtureBase();
    dados.pessoas[0].vinculos = [{ tipo: 'sempre_junto', com_id: 2 }];
    dados.pessoas[1].vinculos = [{ tipo: 'sempre_junto', com_id: 1 }];
    const caminho = escreverFixture(tempDir, dados);

    expect(() => carregarPessoas(caminho)).not.toThrow();
  });

  test('lança erro para familia_requerida referenciando grupo inexistente', () => {
    const dados = fixtureBase();
    dados.pessoas[0].vinculos = [{ tipo: 'familia_requerida', grupo: 'familia_xyz' }];
    const caminho = escreverFixture(tempDir, dados);

    expect(() => carregarPessoas(caminho)).toThrow(/grupo inexistente.*familia_xyz/);
  });

  test('valida familia_requerida com grupo existente sem erro', () => {
    const dados = fixtureBase();
    dados.grupos = { familia_teste: { membros_ids: [1, 2] } };
    dados.pessoas[0].vinculos = [{ tipo: 'familia_requerida', grupo: 'familia_teste' }];
    const caminho = escreverFixture(tempDir, dados);

    expect(() => carregarPessoas(caminho)).not.toThrow();
  });
});

// ─── Validação de grupos ─────────────────────────────────────────────────────

describe('carregarPessoas – validação de grupos', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = criarTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('lança erro para grupo com membro_id inexistente', () => {
    const dados = fixtureBase();
    dados.grupos = { familia_fantasma: { membros_ids: [1, 999] } };
    const caminho = escreverFixture(tempDir, dados);

    expect(() => carregarPessoas(caminho)).toThrow(/Grupo.*familia_fantasma.*999.*não existe/);
  });

  test('valida grupo com todos membros existentes sem erro', () => {
    const dados = fixtureBase();
    dados.grupos = { familia_ok: { membros_ids: [1, 2] } };
    const caminho = escreverFixture(tempDir, dados);

    expect(() => carregarPessoas(caminho)).not.toThrow();
  });
});

// ─── Validação de proximo_id (P2) ────────────────────────────────────────────

describe('carregarPessoas – validação de proximo_id (P2)', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = criarTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('lança erro quando proximo_id != max(ids) + 1', () => {
    const dados = fixtureBase();
    dados.proximo_id = 10; // Deveria ser 3
    const caminho = escreverFixture(tempDir, dados);

    expect(() => carregarPessoas(caminho)).toThrow(/proximo_id.*inválido.*P2/i);
  });

  test('aceita proximo_id correto', () => {
    const dados = fixtureBase();
    dados.proximo_id = 3; // max(1, 2) + 1 = 3
    const caminho = escreverFixture(tempDir, dados);

    expect(() => carregarPessoas(caminho)).not.toThrow();
  });
});

// ─── Erros de arquivo ────────────────────────────────────────────────────────

describe('carregarPessoas – erros de arquivo', () => {
  test('lança erro para arquivo inexistente', () => {
    expect(() => carregarPessoas('/caminho/inexistente/pessoas.json')).toThrow(
      /Não foi possível ler/
    );
  });

  test('lança erro para JSON inválido', () => {
    const tempDir = criarTempDir();
    const caminho = resolve(tempDir, 'pessoas.json');
    writeFileSync(caminho, '{ invalido json [[[', 'utf8');

    expect(() => carregarPessoas(caminho)).toThrow(/JSON inválido/);
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('lança erro quando campo pessoas não é array', () => {
    const tempDir = criarTempDir();
    const caminho = resolve(tempDir, 'pessoas.json');
    writeFileSync(caminho, JSON.stringify({ proximo_id: 1, pessoas: 'nao_array' }), 'utf8');

    expect(() => carregarPessoas(caminho)).toThrow(/deve ser um array/);
    rmSync(tempDir, { recursive: true, force: true });
  });
});
