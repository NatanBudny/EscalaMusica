#!/usr/bin/env node

/**
 * iniciar-mes.js
 *
 * Inicializa a estrutura de pastas para um novo mês de escala.
 * Cria diretórios insumos/ e arquivo/, e gera template vazio do acionato.
 *
 * Uso:
 *   node scripts/iniciar-mes.js --mes=YYYY-MM
 *
 * Exit codes:
 *   0 = sucesso
 *   1 = erro fatal
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

// --- CLI argument parsing ---

function parseArgs(argv) {
  const args = {};
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--')) {
      const [key, ...rest] = arg.slice(2).split('=');
      const value = rest.length > 0 ? rest.join('=') : true;
      args[key] = value;
    }
  }
  return args;
}

const args = parseArgs(process.argv);

if (!args.mes) {
  console.error('Erro: --mes é obrigatório. Uso: node scripts/iniciar-mes.js --mes=YYYY-MM');
  process.exit(1);
}

const mesMatch = String(args.mes).match(/^(\d{4})-(\d{2})$/);
if (!mesMatch) {
  console.error('Erro: --mes deve estar no formato YYYY-MM (ex: 2026-08)');
  process.exit(1);
}

const [, ano, mes] = mesMatch;

// --- Utilidades ---

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function getMesNome(mesNum) {
  const meses = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
  ];
  return meses[mesNum - 1] || `Mês ${mesNum}`;
}

function getDiaSemana(dataISO) {
  const dias = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  const date = new Date(dataISO + 'T12:00:00Z');
  return dias[date.getUTCDay()];
}

/**
 * Gera lista de sábados do mês para o template inicial do acionato.
 */
function gerarSabadosDoMes(ano, mes) {
  const sabados = [];
  const anoNum = parseInt(ano);
  const mesNum = parseInt(mes);
  const ultimoDia = new Date(anoNum, mesNum, 0).getDate();

  for (let dia = 1; dia <= ultimoDia; dia++) {
    const data = new Date(anoNum, mesNum - 1, dia);
    if (data.getDay() === 6) { // Sábado
      const dataISO = `${ano}-${mes}-${String(dia).padStart(2, '0')}`;
      sabados.push({
        data: dataISO,
        dia: getDiaSemana(dataISO),
        anciao: '',
        pregador: '',
        audiovisual: '',
        observacoes: '',
      });
    }
  }

  return sabados;
}

// --- Main ---

function main() {
  const mesNome = getMesNome(parseInt(mes));
  const baseDir = resolve(ROOT, `escalas/${ano}/${mes}`);
  const insumosDir = resolve(baseDir, 'insumos');
  const arquivoDir = resolve(baseDir, 'arquivo');
  const acionatoPath = resolve(insumosDir, 'acionato.json');

  console.log(`\n📅 Inicializando mês: ${mesNome} ${ano} (${ano}-${mes})`);
  console.log('─'.repeat(50));

  // Verificar se já existe
  if (existsSync(baseDir)) {
    console.warn(`⚠️  Diretório já existe: escalas/${ano}/${mes}/`);
    console.warn('   Continuando sem sobrescrever arquivos existentes.\n');
  }

  // Criar diretórios
  mkdirSync(insumosDir, { recursive: true });
  console.log(`  ✓ Criado: escalas/${ano}/${mes}/insumos/`);

  mkdirSync(arquivoDir, { recursive: true });
  console.log(`  ✓ Criado: escalas/${ano}/${mes}/arquivo/`);

  // Gerar template do acionato (apenas se não existir)
  if (!existsSync(acionatoPath)) {
    const sabados = gerarSabadosDoMes(ano, mes);
    const acionato = {
      contexto: `Acionato - ${mesNome} ${ano}`,
      gerado_em: `${ano}-${mes}-01`,
      itens: sabados.length > 0 ? sabados : [
        {
          data: `${ano}-${mes}-01`,
          dia: getDiaSemana(`${ano}-${mes}-01`),
          anciao: '',
          pregador: '',
          audiovisual: '',
          observacoes: '',
        },
      ],
    };

    writeFileSync(acionatoPath, JSON.stringify(acionato, null, 2) + '\n', 'utf8');
    console.log(`  ✓ Criado: escalas/${ano}/${mes}/insumos/acionato.json (${acionato.itens.length} sábado(s))`);
  } else {
    console.log(`  ⏭️  Já existe: escalas/${ano}/${mes}/insumos/acionato.json (não sobrescrito)`);
  }

  // Checklist de próximos passos
  console.log('\n─'.repeat(50));
  console.log('📋 Próximos passos:\n');
  console.log(`  1. [ ] Preencher acionato.json com datas de culto, anciãos e pregadores`);
  console.log(`         → escalas/${ano}/${mes}/insumos/acionato.json`);
  console.log(`  2. [ ] Coletar indisponibilidade dos cantores (enquete WhatsApp)`);
  console.log(`         → Salvar em escalas/${ano}/${mes}/insumos/indisponibilidade-cantores.json`);
  console.log(`  3. [ ] Executar ciclo mensal:`);
  console.log(`         → npm run ciclo:mensal -- --mes=${ano}-${mes}`);
  console.log(`  4. [ ] Revisar rascunho gerado`);
  console.log(`         → escalas/${ano}/${mes}/rascunho.md`);
  console.log(`  5. [ ] Publicar escala final:`);
  console.log(`         → npm run ciclo:mensal -- --mes=${ano}-${mes} --publicar`);
  console.log('');
}

main();
