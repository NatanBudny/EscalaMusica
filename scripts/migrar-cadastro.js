/**
 * migrar-cadastro.js — Script one-shot de migração
 *
 * Consolida funcoes-louvor.json + contatos.json + regras.snapshot.json
 * em um único arquivo pessoas.json (fonte única de verdade).
 *
 * Uso: node scripts/migrar-cadastro.js
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// === Caminhos dos arquivos fonte ===
const CAMINHO_FUNCOES = resolve(ROOT, 'processos/regras/cadastros/funcoes-louvor.json');
const CAMINHO_CONTATOS = resolve(ROOT, 'contatos.json');
const CAMINHO_REGRAS = resolve(ROOT, 'processos/regras/regras.snapshot.json');
const CAMINHO_SAIDA = resolve(ROOT, 'pessoas.json');

// === Mapa de gênero hardcoded (nomes brasileiros) ===
const GENERO_M = new Set([
  'ALEX', 'ANDRE', 'BERNARDO', 'CLEVERSON', 'DIEGO', 'ENOQUE', 'FABRICIO',
  'GABRIEL P.', 'HENRIQUE', 'IGOR DUARTE', 'JESSE', 'JOAS', 'JUNIOR',
  'JUNIOR FERREIRA', 'LUAN', 'LUIZ ANTONIO', 'LUIZ DA SILVA', 'MARCOS',
  'MARCOS GALUCH', 'MARAIR', 'NATAN', 'NILSINHO', 'PR. HOFNI',
  'RICARDO HERREIRA', 'ROBERTO KOCH', 'RONI', 'SAMUEL', 'VANDERLEY',
  'VONI', 'YASSER', 'ZAILSON',
]);

const GENERO_F = new Set([
  'ADELAIDE', 'ALESSANDRA DONADON', 'ANISSA', 'ARIADNY', 'BANDA', 'BETE',
  'BRUNA', 'CARLA RIBEIRO', 'CATHERINE', 'DANI HERREIRA', 'DANY KALLAS',
  'DULCINEIA', 'EMILY', 'FABIOLA', 'GIOVANA', 'HELOISE', 'JEMELLI',
  'JESSICA', 'JESSIE', 'JULIANA ALVES', 'KHEYCIANE', 'LAURA GESSNER',
  'LIDIANE', 'M. MULHER', 'MANU C.', 'MANU S.', 'MARCELA', 'MARIA F.',
  'MARIA HELOISA', 'MIRELLA', 'MIRIAN', 'RAISSA', 'ROSANA', 'SILVANA',
  'SIRLENE', 'STELLA', 'SUELLEN', 'DA SILVA',
]);

// === Entradas a pular na migração (não são pessoas reais) ===
const SKIP_ENTRIES = new Set(['DA SILVA']);

// === Entradas que são departamentos/grupos (marcar inactive) ===
const DEPARTAMENTOS = new Set(['M. MULHER', 'BANDA']);

// === Helpers ===

function normalizar(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

function extrairDigitos(url) {
  if (!url) return null;
  const digits = url.replace(/\D/g, '');
  return digits || null;
}

function determinarGenero(nome) {
  if (GENERO_M.has(nome)) return 'M';
  if (GENERO_F.has(nome)) return 'F';
  return 'F'; // fallback
}

// === Carregamento dos fontes ===

function carregarFuncoes() {
  const raw = readFileSync(CAMINHO_FUNCOES, 'utf8');
  return JSON.parse(raw);
}

function carregarContatos() {
  const raw = readFileSync(CAMINHO_CONTATOS, 'utf8');
  return JSON.parse(raw);
}

function carregarRegras() {
  const raw = readFileSync(CAMINHO_REGRAS, 'utf8');
  return JSON.parse(raw);
}

// === Construção do índice de contatos (nome/alias → telefone) ===

function construirIndiceContatos(contatos) {
  const indice = new Map(); // normalized name → phone digits

  for (const [nome, dados] of Object.entries(contatos)) {
    const telefone = extrairDigitos(dados.telefone);
    const nomeNorm = normalizar(nome);
    indice.set(nomeNorm, telefone);

    for (const apelido of dados.apelidos || []) {
      const apelidoNorm = normalizar(apelido);
      if (apelidoNorm && !indice.has(apelidoNorm)) {
        indice.set(apelidoNorm, telefone);
      }
    }
  }

  return indice;
}

// === Resolução de telefone para uma pessoa ===

function resolverTelefone(nome, aliases, indiceContatos) {
  // Tentar pelo nome canônico
  const nomeNorm = normalizar(nome);
  if (indiceContatos.has(nomeNorm)) {
    return indiceContatos.get(nomeNorm);
  }

  // Tentar por aliases
  for (const alias of aliases) {
    const aliasNorm = normalizar(alias);
    if (indiceContatos.has(aliasNorm)) {
      return indiceContatos.get(aliasNorm);
    }
  }

  return null;
}

// === Migração de restrições pessoais ===

function migrarRestricoesPessoais(regras) {
  const rps = regras.restricoes_pessoais || {};
  const resultado = new Map(); // nome → { afastado, vinculos, dias_permitidos }

  // RP003: JESSICA → sempre_junto com JOAS
  // RP004: JESSE → sempre_junto com JESSIE
  // RP005: YASSER → sempre_junto com LIDIANE
  // (bidirectional — we register both sides)

  const casais = [
    ['JESSICA', 'JOAS'],
    ['JESSE', 'JESSIE'],
    ['YASSER', 'LIDIANE'],
  ];

  for (const [a, b] of casais) {
    if (!resultado.has(a)) resultado.set(a, { vinculos: [], afastado: null, dias_permitidos: null });
    if (!resultado.has(b)) resultado.set(b, { vinculos: [], afastado: null, dias_permitidos: null });
    resultado.get(a).vinculos.push({ tipo: 'sempre_junto', com: b });
    resultado.get(b).vinculos.push({ tipo: 'sempre_junto', com: a });
  }

  // RP006: JULIANA ALVES → dias_permitidos: ["sabado"]
  if (!resultado.has('JULIANA ALVES')) resultado.set('JULIANA ALVES', { vinculos: [], afastado: null, dias_permitidos: null });
  resultado.get('JULIANA ALVES').dias_permitidos = ['sabado'];

  // RP012: CATHERINE → dias_permitidos: ["sabado"]
  if (!resultado.has('CATHERINE')) resultado.set('CATHERINE', { vinculos: [], afastado: null, dias_permitidos: null });
  resultado.get('CATHERINE').dias_permitidos = ['sabado'];

  // RP009: LUIZ DA SILVA → familia_requerida grupo familia_silva
  if (!resultado.has('LUIZ DA SILVA')) resultado.set('LUIZ DA SILVA', { vinculos: [], afastado: null, dias_permitidos: null });
  resultado.get('LUIZ DA SILVA').vinculos.push({ tipo: 'familia_requerida', grupo: 'familia_silva' });

  // RP016: BETE → familia_requerida grupo familia_silva
  if (!resultado.has('BETE')) resultado.set('BETE', { vinculos: [], afastado: null, dias_permitidos: null });
  resultado.get('BETE').vinculos.push({ tipo: 'familia_requerida', grupo: 'familia_silva' });

  // RP008: JUNIOR → afastado até 2026-07-31
  if (!resultado.has('JUNIOR')) resultado.set('JUNIOR', { vinculos: [], afastado: null, dias_permitidos: null });
  resultado.get('JUNIOR').afastado = { ativo: true, ate: '2026-07-31', motivo: 'solicitacao pessoal (60 dias a partir de 01/06/2026)' };

  // RP011: FABIOLA → afastada até 2026-09-28
  if (!resultado.has('FABIOLA')) resultado.set('FABIOLA', { vinculos: [], afastado: null, dias_permitidos: null });
  resultado.get('FABIOLA').afastado = { ativo: true, ate: '2026-09-28', motivo: 'licenca maternidade (120 dias a partir de 01/06/2026)' };

  // RP013: LAURA GESSNER → afastada até 2026-07-31
  if (!resultado.has('LAURA GESSNER')) resultado.set('LAURA GESSNER', { vinculos: [], afastado: null, dias_permitidos: null });
  resultado.get('LAURA GESSNER').afastado = { ativo: true, ate: '2026-07-31', motivo: 'compromissos de trabalho (60 dias a partir de 01/06/2026)' };

  // RP014: IGOR DUARTE → afastado até 2026-09-28
  if (!resultado.has('IGOR DUARTE')) resultado.set('IGOR DUARTE', { vinculos: [], afastado: null, dias_permitidos: null });
  resultado.get('IGOR DUARTE').afastado = { ativo: true, ate: '2026-09-28', motivo: 'licenca paternidade (120 dias a partir de 01/06/2026)' };

  // RP017: BRUNA → afastada indefinidamente
  if (!resultado.has('BRUNA')) resultado.set('BRUNA', { vinculos: [], afastado: null, dias_permitidos: null });
  resultado.get('BRUNA').afastado = { ativo: true, ate: null, motivo: 'solicitacao pessoal' };

  return resultado;
}

// === Migração principal ===

function migrar() {
  console.log('=== MIGRAÇÃO DE CADASTRO ===\n');
  console.log('Carregando fontes...');

  const funcoes = carregarFuncoes();
  const contatos = carregarContatos();
  const regras = carregarRegras();

  console.log(`  - funcoes-louvor.json: ${funcoes.pessoas.length} entradas`);
  console.log(`  - contatos.json: ${Object.keys(contatos).length} entradas`);
  console.log(`  - regras.snapshot.json: ${Object.keys(regras.restricoes_pessoais || {}).length} restrições pessoais`);

  // Construir índice de contatos
  const indiceContatos = construirIndiceContatos(contatos);

  // Migrar restrições pessoais
  const restricoes = migrarRestricoesPessoais(regras);

  // Filtrar e ordenar pessoas
  const pessoasFonte = funcoes.pessoas
    .filter(p => !SKIP_ENTRIES.has(p.nome))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  console.log(`\nPessoas a migrar: ${pessoasFonte.length} (excluindo alias DA SILVA)`);

  // Mapa temporário nome → id (para resolver vínculos depois)
  const nomeParaId = new Map();
  const pessoas = [];
  let nextId = 1;

  // Primeira passada: criar registros com IDs
  for (const fonte of pessoasFonte) {
    const id = nextId++;
    nomeParaId.set(fonte.nome, id);
    pessoas.push({ id, fonte });
  }

  // Segunda passada: montar objetos completos
  const pessoasFinal = [];
  const relatorio = {
    telefones_encontrados: 0,
    telefones_nao_encontrados: [],
    vinculos_migrados: 0,
    afastamentos_migrados: 0,
    dias_permitidos_migrados: 0,
  };

  // Coletar todos nomes canônicos para filtrar aliases conflitantes
  const nomesCanonicos = new Set(pessoas.map(({ fonte }) => fonte.nome));

  for (const { id, fonte } of pessoas) {
    const nome = fonte.nome;
    // Filtrar aliases que colidem com nomes canônicos de outras pessoas
    const aliases = (fonte.aliases || []).filter(alias => !nomesCanonicos.has(alias));
    const telefone = resolverTelefone(nome, fonte.aliases || [], indiceContatos);

    if (telefone) {
      relatorio.telefones_encontrados++;
    } else {
      relatorio.telefones_nao_encontrados.push(nome);
    }

    // Resolver restrições pessoais
    const rp = restricoes.get(nome);
    let afastado = rp?.afastado || null;
    let dias_permitidos = rp?.dias_permitidos || null;
    let vinculos = [];

    if (rp?.vinculos?.length) {
      for (const v of rp.vinculos) {
        if (v.tipo === 'sempre_junto') {
          const comId = nomeParaId.get(v.com);
          if (comId) {
            vinculos.push({ tipo: 'sempre_junto', com_id: comId });
            relatorio.vinculos_migrados++;
          }
        } else if (v.tipo === 'familia_requerida') {
          vinculos.push({ tipo: 'familia_requerida', grupo: v.grupo });
          relatorio.vinculos_migrados++;
        }
      }
    }

    if (afastado) relatorio.afastamentos_migrados++;
    if (dias_permitidos) relatorio.dias_permitidos_migrados++;

    // Determinar se é departamento (não-pessoa)
    const isDepartamento = DEPARTAMENTOS.has(nome);

    // Determinar ativo
    const ativo = isDepartamento ? false : (fonte.ativo !== false);

    const pessoa = {
      id,
      nome,
      aliases,
      telefone: telefone || null,
      genero: determinarGenero(nome),
      ativo,
      perfil_canto: fonte.perfil_canto || null,
      notas: fonte.notas || '',
      habilitacoes: {
        regente: !!fonte.funcoes?.regente,
        equipe: !!fonte.funcoes?.equipe,
        mensagem_musical: {
          es: !!fonte.funcoes?.mm?.es,
          culto: !!fonte.funcoes?.mm?.culto,
          domingo: !!fonte.funcoes?.mm?.dom,
        },
      },
      afastado,
      vinculos,
      dias_permitidos,
    };

    pessoasFinal.push(pessoa);
  }

  // Construir grupos
  const grupoFamiliaSilva = {
    membros_ids: [
      nomeParaId.get('JESSIE'),
      nomeParaId.get('JESSE'),
      nomeParaId.get('JOAS'),
      nomeParaId.get('JESSICA'),
    ].filter(Boolean),
  };

  // Construir departamentos_contato
  const departamentos_contato = {
    AVENTUREIROS: {
      representante_id: nomeParaId.get('JESSIE') || null,
      nota: 'JESSIE é contato do departamento',
    },
    JOVENS: {
      representante_id: nomeParaId.get('FABRICIO') || null,
      nota: 'FABRICIO é contato do departamento (via alias JOVENS em contatos.json)',
    },
  };

  // Montar saída final
  const saida = {
    versao: '1.0.0',
    proximo_id: nextId,
    ultima_atualizacao: new Date().toISOString().split('T')[0],
    grupos: {
      familia_silva: grupoFamiliaSilva,
    },
    departamentos_contato,
    pessoas: pessoasFinal,
  };

  // Escrever arquivo
  writeFileSync(CAMINHO_SAIDA, JSON.stringify(saida, null, 2) + '\n', 'utf8');

  // Imprimir relatório
  console.log('\n=== RELATÓRIO DE MIGRAÇÃO ===\n');
  console.log(`Pessoas migradas: ${pessoasFinal.length}`);
  console.log(`Próximo ID: ${nextId}`);
  console.log(`Telefones resolvidos: ${relatorio.telefones_encontrados}/${pessoasFinal.length}`);

  if (relatorio.telefones_nao_encontrados.length > 0) {
    console.log(`Telefones NÃO encontrados (${relatorio.telefones_nao_encontrados.length}):`);
    for (const nome of relatorio.telefones_nao_encontrados) {
      console.log(`  - ${nome}`);
    }
  }

  console.log(`\nVínculos migrados: ${relatorio.vinculos_migrados}`);
  console.log(`Afastamentos migrados: ${relatorio.afastamentos_migrados}`);
  console.log(`Dias permitidos migrados: ${relatorio.dias_permitidos_migrados}`);

  console.log(`\nGrupos criados:`);
  console.log(`  - familia_silva: membros = [${grupoFamiliaSilva.membros_ids.join(', ')}]`);

  console.log(`\nDepartamentos de contato:`);
  for (const [dept, info] of Object.entries(departamentos_contato)) {
    console.log(`  - ${dept}: representante_id=${info.representante_id} (${info.nota})`);
  }

  console.log(`\nArquivo gerado: ${CAMINHO_SAIDA}`);
  console.log('\n=== MIGRAÇÃO CONCLUÍDA ===');
}

// === Execução ===
migrar();
