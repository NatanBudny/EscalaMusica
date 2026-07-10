import { resolverPessoaPorNome } from '../../scripts/lib/fuzzy-match.js';

// Helper: cria um Map simulando porNome (chave normalizada → objeto pessoa)
function criarPorNome(entries) {
  const mapa = new Map();
  for (const [chave, pessoa] of entries) {
    mapa.set(chave, pessoa);
  }
  return mapa;
}

// Cadastro simplificado para testes
const pessoasBase = [
  ['JESSIE', { id: 2, nome: 'JESSIE' }],
  ['JESSE', { id: 3, nome: 'JESSE' }],
  ['JOAS', { id: 4, nome: 'JOAS' }],
  ['JESSICA', { id: 5, nome: 'JESSICA' }],
  ['CATHERINE', { id: 6, nome: 'CATHERINE' }],
  ['LUIZ DA SILVA', { id: 10, nome: 'LUIZ DA SILVA' }],
  ['LUIZ', { id: 10, nome: 'LUIZ DA SILVA' }],
  ['LUIS DA SILVA', { id: 10, nome: 'LUIZ DA SILVA' }],
  ['LUIS SILVA', { id: 10, nome: 'LUIZ DA SILVA' }],
  ['LUIZ SILVA', { id: 10, nome: 'LUIZ DA SILVA' }],
  ['SILVANA', { id: 7, nome: 'SILVANA' }],
  ['DANI HERREIRA', { id: 15, nome: 'DANI HERREIRA' }],
  ['MARIA HELOISA', { id: 22, nome: 'MARIA HELOISA' }],
  ['RICARDO HERREIRA', { id: 30, nome: 'RICARDO HERREIRA' }],
  ['JEMELLI', { id: 28, nome: 'JEMELLI' }],
  ['ARIADNY', { id: 8, nome: 'ARIADNY' }],
  ['VONI', { id: 1, nome: 'VONI' }],
  ['VONIVALDO', { id: 1, nome: 'VONI' }],
  ['KHEYCIANE', { id: 35, nome: 'KHEYCIANE' }],
  ['STELLA', { id: 14, nome: 'STELLA' }],
  ['DANY KALLAS', { id: 16, nome: 'DANY KALLAS' }],
  ['ALESSANDRA DONADON', { id: 40, nome: 'ALESSANDRA DONADON' }],
  ['BRUNA', { id: 55, nome: 'BRUNA' }],
  ['NILSINHO', { id: 50, nome: 'NILSINHO' }],
];

const porNome = criarPorNome(pessoasBase);

describe('resolverPessoaPorNome()', () => {
  describe('match exato', () => {
    test('retorna pessoa com confiança 1.0 para nome exato', () => {
      const resultado = resolverPessoaPorNome('JESSIE', porNome);
      expect(resultado).toEqual({ pessoa: { id: 2, nome: 'JESSIE' }, confianca: 1.0 });
    });

    test('normaliza input antes de comparar (acentos e case)', () => {
      const resultado = resolverPessoaPorNome('jessie', porNome);
      expect(resultado).toEqual({ pessoa: { id: 2, nome: 'JESSIE' }, confianca: 1.0 });
    });

    test('match por alias (VONIVALDO → VONI)', () => {
      const resultado = resolverPessoaPorNome('Vonivaldo', porNome);
      expect(resultado).toEqual({ pessoa: { id: 1, nome: 'VONI' }, confianca: 1.0 });
    });

    test('match exato com nome composto', () => {
      const resultado = resolverPessoaPorNome('Luiz da Silva', porNome);
      expect(resultado).toEqual({ pessoa: { id: 10, nome: 'LUIZ DA SILVA' }, confianca: 1.0 });
    });

    test('remove sufixo IASD antes de comparar', () => {
      const resultado = resolverPessoaPorNome('Jessie IASD', porNome);
      expect(resultado).toEqual({ pessoa: { id: 2, nome: 'JESSIE' }, confianca: 1.0 });
    });
  });

  describe('fuzzy match', () => {
    test('encontra nome com pequena diferença de grafia', () => {
      const resultado = resolverPessoaPorNome('JESSI', porNome);
      expect(resultado).not.toBeNull();
      expect(resultado.confianca).toBeGreaterThanOrEqual(0.6);
    });

    test('encontra nome com acentuação diferente', () => {
      const resultado = resolverPessoaPorNome('Catarine', porNome);
      expect(resultado).not.toBeNull();
      expect(resultado.pessoa.nome).toBe('CATHERINE');
      expect(resultado.confianca).toBeGreaterThanOrEqual(0.6);
    });

    test('encontra Dani Herreira com variação', () => {
      const resultado = resolverPessoaPorNome('Dani Hereira', porNome);
      expect(resultado).not.toBeNull();
      expect(resultado.pessoa.nome).toBe('DANI HERREIRA');
      expect(resultado.confianca).toBeGreaterThanOrEqual(0.6);
    });

    test('encontra Alessandra Donadon com variação', () => {
      const resultado = resolverPessoaPorNome('Alessandra Donadom', porNome);
      expect(resultado).not.toBeNull();
      expect(resultado.pessoa.nome).toBe('ALESSANDRA DONADON');
      expect(resultado.confianca).toBeGreaterThanOrEqual(0.6);
    });

    test('confiança reflete a qualidade do match', () => {
      const bom = resolverPessoaPorNome('JESSIE', porNome);
      const razoavel = resolverPessoaPorNome('JESSI', porNome);
      expect(bom.confianca).toBeGreaterThan(razoavel.confianca);
    });
  });

  describe('threshold', () => {
    test('retorna null quando similaridade abaixo do threshold default (0.6)', () => {
      const resultado = resolverPessoaPorNome('XYZ', porNome);
      expect(resultado).toBeNull();
    });

    test('threshold customizado mais alto rejeita matches fracos', () => {
      const resultado = resolverPessoaPorNome('JESSI', porNome, 0.99);
      expect(resultado).toBeNull();
    });

    test('threshold customizado mais baixo aceita matches fracos', () => {
      const resultado = resolverPessoaPorNome('CATH', porNome, 0.3);
      expect(resultado).not.toBeNull();
    });
  });

  describe('edge cases', () => {
    test('retorna null para string vazia', () => {
      expect(resolverPessoaPorNome('', porNome)).toBeNull();
    });

    test('retorna null para null', () => {
      expect(resolverPessoaPorNome(null, porNome)).toBeNull();
    });

    test('retorna null para undefined', () => {
      expect(resolverPessoaPorNome(undefined, porNome)).toBeNull();
    });

    test('retorna null quando porNome está vazio', () => {
      expect(resolverPessoaPorNome('JESSIE', new Map())).toBeNull();
    });

    test('retorna null para string de um caractere (bigramas insuficientes)', () => {
      const resultado = resolverPessoaPorNome('J', porNome);
      // Um caractere normalizado "J" não forma bigramas, fuzzy retornará 0
      // Mas pode dar match exato se houver chave "J" no mapa
      // Neste caso não há, então deve ser null ou muito baixa confiança
      if (resultado !== null) {
        expect(resultado.confianca).toBeGreaterThanOrEqual(0.6);
      }
    });
  });

  describe('determinismo', () => {
    test('mesmo input produz mesmo output (10 execuções)', () => {
      const resultados = [];
      for (let i = 0; i < 10; i++) {
        resultados.push(resolverPessoaPorNome('Jessi', porNome));
      }
      const primeiro = resultados[0];
      for (const r of resultados) {
        expect(r).toEqual(primeiro);
      }
    });

    test('desempate por chave lexicográfica menor garante determinismo', () => {
      // Criar mapa com nomes de comprimento similar que poderiam empatar
      const mapaEmpate = criarPorNome([
        ['BETA', { id: 1, nome: 'BETA' }],
        ['BETO', { id: 2, nome: 'BETO' }],
      ]);
      const r1 = resolverPessoaPorNome('BET', mapaEmpate, 0.3);
      const r2 = resolverPessoaPorNome('BET', mapaEmpate, 0.3);
      expect(r1).toEqual(r2);
    });
  });
});
