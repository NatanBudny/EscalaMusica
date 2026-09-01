#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, copyFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

function parseArgs(argv) {
  const args = {
    rascunho: '',
    acionato: '',
    sonoplastia: ''
  };

  for (const arg of argv) {
    if (arg.startsWith('--rascunho=')) args.rascunho = arg.slice('--rascunho='.length);
    if (arg.startsWith('--acionato=')) args.acionato = arg.slice('--acionato='.length);
    if (arg.startsWith('--sonoplastia=')) args.sonoplastia = arg.slice('--sonoplastia='.length);
  }

  return args;
}

function collectRascunhos(dir) {
  const out = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      out.push(...collectRascunhos(full));
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase() === 'rascunho.md') {
      out.push(full);
    }
  }

  return out;
}

function resolveRascunhoPath(argPath) {
  if (argPath) return resolve(ROOT, argPath);

  const escalasDir = resolve(ROOT, 'escalas');
  if (!existsSync(escalasDir)) {
    throw new Error('Pasta escalas/ nao encontrada. Informe --rascunho.');
  }

  const files = collectRascunhos(escalasDir)
    .map((filePath) => ({ filePath, mtime: statSync(filePath).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) {
    throw new Error('Nenhum rascunho.md encontrado em escalas/.');
  }

  if (files.length > 1) {
    const exemplos = files
      .slice(0, 5)
      .map((item) => item.filePath.replace(`${ROOT}\\`, '').replaceAll('\\', '/'))
      .join(', ');
    throw new Error(
      `Foram encontrados multiplos rascunhos. Informe --rascunho para evitar publicacao no mes errado. Exemplos: ${exemplos}`
    );
  }

  return files[0].filePath;
}

function parseAnoMesFromPath(pathRascunho) {
  const normalized = pathRascunho.replaceAll('\\', '/');
  const match = normalized.match(/\/escalas\/(\d{4})\/(\d{2})\/rascunho\.md$/i);
  if (!match) {
    throw new Error('Nao foi possivel inferir ano/mes a partir do caminho do rascunho.');
  }

  return { ano: match[1], mes: match[2] };
}

/**
 * Deriva o acompanhamento (BANDA/PB) a partir do dia da semana, já que o
 * rascunho gerado pelo solver não tem coluna ACOMP.
 * Convenção: quarta = PB; sábado/domingo = BANDA. Ajustes pontuais (ex: um
 * sábado em PB) devem ser feitos diretamente no atual.json após publicar (RF018).
 */
function acompPorDia(dia) {
  return String(dia || '').toLowerCase().startsWith('quarta') ? 'PB' : 'BANDA';
}

/**
 * Faz o parse do rascunho.md no formato canônico gerado por solver-output.js:
 * | DATA | DIA SEMANA | ANCIÃO | PREGADOR | AUDIOVISUAL | REGENTE LOUVOR | EQUIPE LOUVOR | MENSAGEM MUSICAL | OBS |
 * (também aceita o formato legado que tinha ACOMP na coluna 5)
 */
function parseRows(mdContent) {
  return mdContent
    .split(/\r?\n/)
    .filter((line) => /^\|\s\d{2}\/\d{2}\/\d{4}\s\|/i.test(line))
    .map((line) => line.split('|').map((part) => part.trim()))
    .map((parts) => {
      const dia = (parts[2] || '').toLowerCase();
      const col5EhAcomp = /^(BANDA|PB)$/i.test(parts[5] || '');

      // Formato legado: col5 = ACOMP (BANDA/PB), col9 = AUDIOVISUAL/sonoplastia
      if (col5EhAcomp) {
        return {
          data: parts[1] || '',
          dia,
          anciao: parts[3] || '',
          pregador: parts[4] || '',
          acomp: (parts[5] || '').toUpperCase(),
          regente: parts[6] || '',
          equipe: parts[7] || '',
          mensagem: parts[8] || '',
          audiovisual: parts[9] || '',
          louvoresEs: '',
          obs: parts[10] || ''
        };
      }

      // Formato canônico atual (solver-output): col5 = AUDIOVISUAL, sem ACOMP.
      // DATA(1) DIA(2) ANCIÃO(3) PREGADOR(4) AUDIOVISUAL(5) REGENTE(6) EQUIPE(7) MM(8) OBS(9)
      return {
        data: parts[1] || '',
        dia,
        anciao: parts[3] || '',
        pregador: parts[4] || '',
        audiovisual: parts[5] || '',
        regente: parts[6] || '',
        equipe: parts[7] || '',
        mensagem: parts[8] || '',
        acomp: acompPorDia(dia),
        louvoresEs: '',
        obs: parts[9] || ''
      };
    });
}

function toRowFromRascunho(row) {
  return {
    DATA: row.data,
    'DIA SEMANA': row.dia,
    ACOMP: row.acomp,
    'REGENTE LOUVOR': row.regente,
    'EQUIPE LOUVOR': row.equipe,
    'MENSAGEM MUSICAL': row.mensagem,
    'LOUVORES ES': row.louvoresEs || '',
    'LOUVORES CULTO': '',
    'TEMA CULTO': '',
    AUDIOVISUAL: row.audiovisual,
    'ANCIÃO': row.anciao,
    PREGADOR: row.pregador,
    SUPORTE: '',
    OBS: row.obs
  };
}

function toIsoDate(brDate) {
  const [dd, mm, yyyy] = String(brDate || '').split('/');
  if (!dd || !mm || !yyyy) return '';
  return `${yyyy}-${mm}-${dd}`;
}

function toBrDate(isoDate) {
  const [yyyy, mm, dd] = String(isoDate || '').split('-');
  if (!dd || !mm || !yyyy) return '';
  return `${dd}/${mm}/${yyyy}`;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function readJsonIfExists(pathJson) {
  if (!existsSync(pathJson)) return null;
  return JSON.parse(readFileSync(pathJson, 'utf8'));
}

function buildAudioMap(sonoplastiaJson) {
  const map = new Map();
  for (const item of sonoplastiaJson?.itens || []) {
    const names = Array.isArray(item?.sonoplastia) ? item.sonoplastia : [];
    map.set(String(item?.data || ''), names.join(', '));
  }
  return map;
}

function addMissingQuartas(rows, acionatoJson, audioMap) {
  const existing = new Set(rows.map((row) => toIsoDate(row.DATA)));

  for (const item of acionatoJson?.itens || []) {
    const isoDate = String(item?.data || '');
    const dia = normalizeText(item?.dia || '');
    if (!isoDate || !dia.startsWith('quarta')) continue;
    if (existing.has(isoDate)) continue;

    // AV da quarta: preferir sonoplastia.json (audioMap); senão, o campo
    // audiovisual do próprio acionato.json (que é onde guardamos hoje).
    const audiovisual = audioMap.get(isoDate) || String(item?.audiovisual || '');

    rows.push({
      DATA: toBrDate(isoDate),
      'DIA SEMANA': 'quarta-feira',
      ACOMP: 'PB',
      'REGENTE LOUVOR': '',
      'EQUIPE LOUVOR': '',
      'MENSAGEM MUSICAL': '',
      'LOUVORES ES': '',
      'LOUVORES CULTO': '',
      'TEMA CULTO': '',
      AUDIOVISUAL: audiovisual,
      'ANCIÃO': String(item?.anciao || ''),
      PREGADOR: String(item?.pregador || ''),
      SUPORTE: '',
      OBS: String(item?.observacoes || '')
    });
  }
}

/**
 * OBS vindo da escala externa (acionato) é público por definição (RF016).
 * Prefixa com "PUBLICAR:" se ainda não tiver, para passar em validar:obs.
 * OBS já iniciado com PUBLICAR: e OBS vazio são mantidos como estão.
 */
function formatarObsPublico(obs) {
  const texto = String(obs || '').trim();
  if (!texto) return '';
  if (/^PUBLICAR\s*:/i.test(texto)) return texto;
  return `PUBLICAR: ${texto}`;
}

/**
 * Mescla o OBS do acionato nas linhas já existentes (sábados/domingos do
 * rascunho não trazem OBS, mas o acionato pode ter — ex: "MANÁ"). Só preenche
 * quando a linha está sem OBS, para não sobrescrever observação já definida.
 */
function mergeObsAcionato(rows, acionatoJson) {
  const obsPorData = new Map();
  for (const item of acionatoJson?.itens || []) {
    const iso = String(item?.data || '');
    if (iso && item?.observacoes) obsPorData.set(iso, String(item.observacoes));
  }
  for (const row of rows) {
    const iso = toIsoDate(row.DATA);
    if (!row.OBS && obsPorData.has(iso)) row.OBS = obsPorData.get(iso);
    row.OBS = formatarObsPublico(row.OBS);
  }
}

function compareBrDates(a, b) {
  return toIsoDate(a).localeCompare(toIsoDate(b));
}

function inferAnoMesAtual(atualRows) {
  for (const item of atualRows) {
    const match = String(item?.DATA || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) continue;
    return { mes: match[2], ano: match[3] };
  }

  throw new Error('Nao foi possivel inferir ano/mes do atual.json para backup.');
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  const rascunhoPath = resolveRascunhoPath(args.rascunho);
  const { ano, mes } = parseAnoMesFromPath(rascunhoPath);

  const mmDir = resolve(ROOT, 'escalas', ano, mes);
  const acionatoPath = args.acionato
    ? resolve(ROOT, args.acionato)
    : resolve(mmDir, 'insumos', 'acionato.json');
  const sonoplastiaPath = args.sonoplastia
    ? resolve(ROOT, args.sonoplastia)
    : resolve(mmDir, 'insumos', 'sonoplastia.json');

  const rascunhoRaw = readFileSync(rascunhoPath, 'utf8');
  const parsedRows = parseRows(rascunhoRaw);
  if (parsedRows.length === 0) {
    throw new Error('Nenhuma linha de tabela valida foi encontrada no rascunho.');
  }

  const rows = parsedRows.map(toRowFromRascunho);

  const acionatoJson = readJsonIfExists(acionatoPath);
  const sonoplastiaJson = readJsonIfExists(sonoplastiaPath);
  const audioMap = buildAudioMap(sonoplastiaJson);

  if (acionatoJson) {
    addMissingQuartas(rows, acionatoJson, audioMap);
    mergeObsAcionato(rows, acionatoJson);
  }

  rows.sort((a, b) => compareBrDates(a.DATA, b.DATA));

  const atualPath = resolve(ROOT, 'atual.json');
  const atualRows = JSON.parse(readFileSync(atualPath, 'utf8'));
  const anoMesAtual = inferAnoMesAtual(atualRows);

  const backupDir = resolve(ROOT, 'old', anoMesAtual.ano);
  const backupPath = resolve(backupDir, `${anoMesAtual.mes}${anoMesAtual.ano}.json`);
  if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });
  if (!existsSync(backupPath)) {
    copyFileSync(atualPath, backupPath);
  }

  writeFileSync(atualPath, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');

  console.log(`Rascunho promovido: ${rascunhoPath.replace(`${ROOT}\\`, '').replaceAll('\\', '/')}`);
  console.log(`Escala publicada em atual.json com ${rows.length} cultos.`);
  console.log(`Backup atual anterior em: ${backupPath.replace(`${ROOT}\\`, '').replaceAll('\\', '/')}`);
  if (!acionatoJson) {
    console.log('Aviso: acionato.json nao encontrado, nenhuma quarta adicional foi incluida.');
  }
}

try {
  run();
} catch (error) {
  console.error(`ERRO: ${error.message}`);
  process.exit(1);
}
