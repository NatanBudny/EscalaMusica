import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const PERIODOS = [
  { rotulo: 'JAN', arquivo: 'old/2026/01-2026.json' },
  { rotulo: 'FEV', arquivo: 'old/2026/02-2026.json' },
  { rotulo: 'MAR', arquivo: 'old/2026/032026.json' },
  { rotulo: 'ABR', arquivo: 'atual.json' },
];

const IGNORAR = new Set([
  '',
  '-',
  'NAO',
  'INDEFINIDO',
  'PG - DEFINIDO NA HORA',
  'PG- DEFINIDO NA HORA',
  'JOVENS',
  'AVENTUREIROS',
]);

export function normalizar(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[0-9]/g, '')
    .replace(/[?]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function criarZeros(chaves) {
  return Object.fromEntries(chaves.map((chave) => [chave, 0]));
}

export function carregarCadastro() {
  const caminhoNovo = resolve(ROOT, 'processos/regras/cadastros/funcoes-louvor.json');
  const caminhoLegado = resolve(ROOT, 'docs/regras/cadastro-funcoes-louvor.json');
  const caminho = existsSync(caminhoNovo) ? caminhoNovo : caminhoLegado;
  const cadastro = JSON.parse(readFileSync(caminho, 'utf8'));
  const porNome = new Map();
  const funcoes = new Map();

  for (const item of cadastro.pessoas || []) {
    const canonico = normalizar(item.nome);
    if (!canonico) continue;

    porNome.set(canonico, canonico);
    for (const alias of item.aliases || []) {
      porNome.set(normalizar(alias), canonico);
    }

    funcoes.set(canonico, {
      ativo: item.ativo !== false,
      regente: !!item?.funcoes?.regente,
      equipe: !!item?.funcoes?.equipe,
      mm: {
        es: !!item?.funcoes?.mm?.es,
        culto: !!item?.funcoes?.mm?.culto,
        dom: !!item?.funcoes?.mm?.dom,
      },
    });
  }

  return { cadastro, porNome, funcoes };
}

function extrairPartes(campo) {
  const bruto = String(campo || '').trim();
  if (!bruto) return [];

  return bruto
    .split(',')
    .map((parte) => parte.trim())
    .filter(Boolean)
    .flatMap((parte) => (parte.includes(' E ') ? parte.split(/\s+E\s+/) : [parte]))
    .map((nome) => normalizar(nome))
    .filter((nome) => nome && !IGNORAR.has(nome));
}

function resolverNome(nome, porNome, naoMapeados, campo, linha) {
  const canonico = porNome.get(nome);
  if (canonico) return canonico;

  naoMapeados.set(`${campo}:${nome}`, {
    campo,
    nome,
    data: linha.DATA || '',
  });
  return null;
}

function carregarPeriodos() {
  return PERIODOS.map((periodo) => ({
    ...periodo,
    dados: JSON.parse(readFileSync(resolve(ROOT, periodo.arquivo), 'utf8')),
  }));
}

function montarContagemBase(nomesCadastro, chaves) {
  return Object.fromEntries(
    nomesCadastro.map((nome) => [
      nome,
      Object.fromEntries(PERIODOS.map((periodo) => [periodo.rotulo, criarZeros(chaves)])),
    ])
  );
}

function montarTotais(porMes, chaves) {
  const totais = criarZeros([...chaves, 'TOTAL']);
  for (const mes of Object.values(porMes)) {
    for (const chave of chaves) {
      totais[chave] += mes[chave];
      totais.TOTAL += mes[chave];
    }
  }
  return totais;
}

function escreverResultado(saidaRelativa, resultado) {
  writeFileSync(resolve(ROOT, saidaRelativa), `${JSON.stringify(resultado, null, 2)}\n`, 'utf8');
}

export function imprimirResumo(titulo, ranking, colunas) {
  const col = (valor) => String(valor).padStart(5);
  const cabecalho = 'Nome'.padEnd(20) + colunas.map((coluna) => ` ${col(coluna)}`).join('');

  console.log(`${titulo} atualizado.\n`);
  console.log(cabecalho);
  console.log('-'.repeat(cabecalho.length));

  for (const item of ranking) {
    console.log(
      item.nome.padEnd(20) + colunas.map((coluna) => ` ${col(item[coluna])}`).join('')
    );
  }
}

export function gerarControleMensagemMusical() {
  const chaves = ['ES', 'CULTO', 'DOMINGO'];
  const { cadastro, porNome, funcoes } = carregarCadastro();
  const nomesCadastro = (cadastro.pessoas || []).map((p) => normalizar(p.nome)).filter(Boolean);
  const contagem = montarContagemBase(nomesCadastro, chaves);
  const naoMapeados = new Map();

  for (const periodo of carregarPeriodos()) {
    for (const linha of periodo.dados) {
      const dia = normalizar(linha['DIA SEMANA']);
      if (dia === 'QUARTA-FEIRA') continue;

      const nomes = extrairPartes(linha['MENSAGEM MUSICAL']);
      nomes.forEach((nome, indice) => {
        const canonico = resolverNome(nome, porNome, naoMapeados, 'MENSAGEM MUSICAL', linha);
        if (!canonico) return;

        let chave;
        if (dia === 'SABADO' && nomes.length >= 2) {
          chave = indice === 0 ? 'ES' : 'CULTO';
        } else if (dia === 'DOMINGO') {
          chave = 'DOMINGO';
        } else {
          chave = 'CULTO';
        }

        contagem[canonico][periodo.rotulo][chave] += 1;
      });
    }
  }

  const ranking = Object.entries(contagem)
    .map(([nome, por_mes]) => {
      const info = funcoes.get(nome) || {
        ativo: true,
        regente: false,
        equipe: false,
        mm: { es: true, culto: true, dom: true },
      };
      return {
        nome,
        ativo: info.ativo,
        pode_mm_es: info.mm.es,
        pode_mm_culto: info.mm.culto,
        pode_mm_dom: info.mm.dom,
        ...montarTotais(por_mes, chaves),
        por_mes,
      };
    })
    .filter((pessoa) => pessoa.ativo && (pessoa.pode_mm_es || pessoa.pode_mm_culto || pessoa.pode_mm_dom))
    .sort((a, b) =>
      a.TOTAL !== b.TOTAL
        ? a.TOTAL - b.TOTAL
        : a.CULTO !== b.CULTO
        ? a.CULTO - b.CULTO
        : a.nome.localeCompare(b.nome)
    );

  const resultado = {
    gerado_em: new Date().toISOString(),
    periodo: '2026-01 a 2026-04',
    tipo_controle: 'mensagem_musical',
    legenda: {
      ES: 'Mensagem Musical da Escola Sabatina (sabado manha, 1a posicao quando ha 2 no sabado).',
      CULTO: 'Mensagem Musical do culto principal (sabado, 2a posicao ou unica; ou outros dias nao-domingo).',
      DOMINGO: 'Mensagem Musical do culto de domingo.',
    },
    criterio_sugestao:
      'Slot ES: menor ES primeiro. Slot CULTO: menor CULTO primeiro. Slot DOM: menor DOMINGO primeiro. Disponibilidade real prevalece sobre tudo.',
    observacao:
      'O ranking considera apenas pessoas ativas e habilitadas no cadastro oficial de funcoes do louvor.',
    fonte: PERIODOS.map((periodo) => periodo.arquivo),
    nomes_nao_mapeados: [...naoMapeados.values()],
    ranking_menor_para_maior: ranking,
  };

  const saida = 'escalas/2026/05/controle-mensagem-musical.json';
  escreverResultado(saida, resultado);
  return { saida, ranking };
}

export function gerarControleRegentes() {
  const chaves = ['REGENCIAS'];
  const { cadastro, porNome, funcoes } = carregarCadastro();
  const nomesCadastro = (cadastro.pessoas || []).map((p) => normalizar(p.nome)).filter(Boolean);
  const contagem = montarContagemBase(nomesCadastro, chaves);
  const naoMapeados = new Map();

  for (const periodo of carregarPeriodos()) {
    for (const linha of periodo.dados) {
      const nomeBruto = normalizar(linha['REGENTE LOUVOR']);
      if (!nomeBruto || IGNORAR.has(nomeBruto)) continue;

      const canonico = resolverNome(nomeBruto, porNome, naoMapeados, 'REGENTE LOUVOR', linha);
      if (!canonico) continue;

      contagem[canonico][periodo.rotulo].REGENCIAS += 1;
    }
  }

  const ranking = Object.entries(contagem)
    .map(([nome, por_mes]) => {
      const info = funcoes.get(nome) || {
        ativo: true,
        regente: true,
        equipe: false,
        mm: { es: false, culto: false, dom: false },
      };
      return {
        nome,
        ativo: info.ativo,
        pode_regencia: info.regente,
        ...montarTotais(por_mes, chaves),
        por_mes,
      };
    })
    .filter((pessoa) => pessoa.ativo && pessoa.pode_regencia)
    .sort((a, b) => (a.TOTAL !== b.TOTAL ? a.TOTAL - b.TOTAL : a.nome.localeCompare(b.nome)));

  const resultado = {
    gerado_em: new Date().toISOString(),
    periodo: '2026-01 a 2026-04',
    tipo_controle: 'regentes',
    legenda: {
      REGENCIAS: 'Quantidade de vezes em que a pessoa apareceu como REGENTE LOUVOR.',
    },
    criterio_sugestao:
      'Priorizar menor quantidade total de regencias, respeitando disponibilidade real e as regras vigentes.',
    observacao:
      'O ranking considera apenas pessoas ativas e habilitadas para regencia no cadastro oficial de funcoes do louvor.',
    fonte: PERIODOS.map((periodo) => periodo.arquivo),
    nomes_nao_mapeados: [...naoMapeados.values()],
    ranking_menor_para_maior: ranking,
  };

  const saida = 'escalas/2026/05/controle-regentes.json';
  escreverResultado(saida, resultado);
  return { saida, ranking };
}

export function gerarControleEquipeLouvor() {
  const chaves = ['ESCALAS_EQUIPE'];
  const { cadastro, porNome, funcoes } = carregarCadastro();
  const nomesCadastro = (cadastro.pessoas || []).map((p) => normalizar(p.nome)).filter(Boolean);
  const contagem = montarContagemBase(nomesCadastro, chaves);
  const naoMapeados = new Map();

  for (const periodo of carregarPeriodos()) {
    for (const linha of periodo.dados) {
      const nomes = extrairPartes(linha['EQUIPE LOUVOR']);

      for (const nome of nomes) {
        const canonico = resolverNome(nome, porNome, naoMapeados, 'EQUIPE LOUVOR', linha);
        if (!canonico) continue;

        contagem[canonico][periodo.rotulo].ESCALAS_EQUIPE += 1;
      }
    }
  }

  const ranking = Object.entries(contagem)
    .map(([nome, por_mes]) => {
      const info = funcoes.get(nome) || {
        ativo: true,
        regente: false,
        equipe: true,
        mm: { es: false, culto: false, dom: false },
      };
      return {
        nome,
        ativo: info.ativo,
        pode_equipe: info.equipe,
        ...montarTotais(por_mes, chaves),
        por_mes,
      };
    })
    .filter((pessoa) => pessoa.ativo && pessoa.pode_equipe)
    .sort((a, b) => (a.TOTAL !== b.TOTAL ? a.TOTAL - b.TOTAL : a.nome.localeCompare(b.nome)));

  const resultado = {
    gerado_em: new Date().toISOString(),
    periodo: '2026-01 a 2026-04',
    tipo_controle: 'equipe_louvor',
    legenda: {
      ESCALAS_EQUIPE: 'Quantidade de vezes em que a pessoa apareceu em EQUIPE LOUVOR.',
    },
    criterio_sugestao:
      'Priorizar menor quantidade total de escalas em equipe de louvor, respeitando disponibilidade real e as regras vigentes.',
    observacao:
      'O ranking considera apenas pessoas ativas e habilitadas para equipe no cadastro oficial de funcoes do louvor.',
    fonte: PERIODOS.map((periodo) => periodo.arquivo),
    nomes_nao_mapeados: [...naoMapeados.values()],
    ranking_menor_para_maior: ranking,
  };

  const saida = 'escalas/2026/05/controle-equipe-louvor.json';
  escreverResultado(saida, resultado);
  return { saida, ranking };
}