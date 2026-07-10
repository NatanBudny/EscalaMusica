import { carregarCadastro, normalizar } from '../../scripts/controle-rotacao-utils.js';
import { writeFileSync, mkdirSync, rmSync, renameSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const PESSOAS_PATH = resolve(ROOT, 'pessoas.json');
const PESSOAS_BACKUP = resolve(ROOT, 'pessoas.json.bak');

describe('carregarCadastro – leitura de pessoas.json', () => {
  test('retorna cadastro, porNome e funcoes quando pessoas.json existe', () => {
    // pessoas.json exists in the repo, so this should work directly
    const resultado = carregarCadastro();

    expect(resultado).toHaveProperty('cadastro');
    expect(resultado).toHaveProperty('porNome');
    expect(resultado).toHaveProperty('funcoes');
    expect(resultado.cadastro).toHaveProperty('pessoas');
    expect(Array.isArray(resultado.cadastro.pessoas)).toBe(true);
    expect(resultado.porNome).toBeInstanceOf(Map);
    expect(resultado.funcoes).toBeInstanceOf(Map);
  });

  test('porNome mapeia nome canônico para si mesmo', () => {
    const { porNome } = carregarCadastro();

    // FABRICIO is a known pessoa in pessoas.json
    expect(porNome.get('FABRICIO')).toBe('FABRICIO');
  });

  test('porNome mapeia alias para nome canônico', () => {
    const { porNome } = carregarCadastro();

    // ALESSANDRA is an alias of ALESSANDRA DONADON
    expect(porNome.get('ALESSANDRA')).toBe('ALESSANDRA DONADON');
  });

  test('funcoes contém shape correto { ativo, regente, equipe, mm: { es, culto, dom } }', () => {
    const { funcoes } = carregarCadastro();

    // FABRICIO has all habilitacoes enabled
    const info = funcoes.get('FABRICIO');
    expect(info).toBeDefined();
    expect(info).toHaveProperty('ativo', true);
    expect(info).toHaveProperty('regente', true);
    expect(info).toHaveProperty('equipe', true);
    expect(info.mm).toEqual({ es: true, culto: true, dom: true });
  });

  test('funcoes mapeia mensagem_musical.domingo para mm.dom', () => {
    const { funcoes } = carregarCadastro();

    // ARIADNY has mensagem_musical all false
    const info = funcoes.get('ARIADNY');
    expect(info).toBeDefined();
    expect(info.mm).toEqual({ es: false, culto: false, dom: false });
  });

  test('pessoas inativas têm ativo=false em funcoes', () => {
    const { funcoes } = carregarCadastro();

    // ADELAIDE is ativo=false in pessoas.json
    const info = funcoes.get('ADELAIDE');
    expect(info).toBeDefined();
    expect(info.ativo).toBe(false);
  });
});

describe('carregarCadastro – fallback para funcoes-louvor.json', () => {
  let pessoasExiste;

  beforeAll(() => {
    pessoasExiste = existsSync(PESSOAS_PATH);
    if (pessoasExiste) {
      renameSync(PESSOAS_PATH, PESSOAS_BACKUP);
    }
  });

  afterAll(() => {
    if (pessoasExiste) {
      renameSync(PESSOAS_BACKUP, PESSOAS_PATH);
    }
  });

  test('retorna cadastro, porNome e funcoes usando fallback', () => {
    const resultado = carregarCadastro();

    expect(resultado).toHaveProperty('cadastro');
    expect(resultado).toHaveProperty('porNome');
    expect(resultado).toHaveProperty('funcoes');
    expect(resultado.porNome).toBeInstanceOf(Map);
    expect(resultado.funcoes).toBeInstanceOf(Map);
  });
});

describe('normalizar – não foi alterada', () => {
  test('normaliza acentos e maiúsculas', () => {
    expect(normalizar('Fabiola')).toBe('FABIOLA');
    expect(normalizar('Fabíola')).toBe('FABIOLA');
  });

  test('remove números e interrogações', () => {
    expect(normalizar('FABRICIO 1')).toBe('FABRICIO');
    expect(normalizar('TESTE?')).toBe('TESTE');
  });

  test('retorna string vazia para input vazio', () => {
    expect(normalizar('')).toBe('');
    expect(normalizar(null)).toBe('');
    expect(normalizar(undefined)).toBe('');
  });
});
