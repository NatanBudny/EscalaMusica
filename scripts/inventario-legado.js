#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_FILES = ['atual.json', 'contatos.json', 'pessoas.json'];
const RECURSIVE_ROOTS = ['old', 'escalas', 'docs/regras', 'processos/regras', 'scripts'];
const EXTRA_FILES = [
  'docs/resumo.md',
  'cancelamentos.md',
  'processos/publicacoes.md',
  '.github/workflows/static.yml',
];

const KNOWN_DIVERGENCES = [
  {
    id: 'calendario-acionato-incompleto',
    sources: ['scripts/ciclo/iniciar-mes.js', 'escalas/**/insumos/acionato.json'],
    summary: 'O acionato legado pode representar somente sábados, enquanto o ciclo novo exige quartas, sábados e domingos.',
    status: 'pendente-decisao',
  },
  {
    id: 'formatos-insumos-divergentes',
    sources: ['escalas/**/insumos/**'],
    summary: 'Os insumos de acionado, sonoplastia e indisponibilidade usam estruturas e campos não uniformes entre períodos.',
    status: 'pendente-decisao',
  },
  {
    id: 'identidade-fuzzy-ambigua',
    sources: ['scripts/ciclo/vincular-indisponibilidade.js', 'escalas/**/insumos/*indisponibilidade*'],
    summary: 'A vinculação legada aceita correspondência aproximada automática e pode associar uma referência à pessoa errada.',
    status: 'pendente-decisao',
  },
  {
    id: 'campos-indisponibilidade-incompativeis',
    sources: ['scripts/ciclo/vincular-indisponibilidade.js', 'scripts/validacao/validar-rascunho.js'],
    summary: 'O vinculador e o validador legados usam nomes de propriedades diferentes para indisponibilidades.',
    status: 'pendente-decisao',
  },
  {
    id: 'fontes-regras-divergentes',
    sources: ['docs/resumo.md', 'docs/regras/**', 'processos/regras/**', 'pessoas.json'],
    summary: 'Regras, preferências, cadastros auxiliares e snapshots aparecem em fontes múltiplas sem precedência aprovada.',
    status: 'pendente-decisao',
  },
  {
    id: 'cadastro-mistura-pessoas-departamentos',
    sources: ['pessoas.json', 'contatos.json'],
    summary: 'O cadastro legado mistura pessoas e entidades departamentais e contém aliases e telefones em formatos diferentes.',
    status: 'pendente-decisao',
  },
  {
    id: 'publicacao-nao-atomica',
    sources: ['scripts/publicacao/**', '.github/workflows/static.yml'],
    summary: 'O fechamento e a publicação legados alteram arquivos antes da confirmação integral do site e o workflow publica a raiz inteira.',
    status: 'pendente-decisao',
  },
];

function toPosix(path) {
  return path.split(sep).join('/');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function collectFiles(root, relativePath) {
  const absolutePath = resolve(root, relativePath);
  if (!(await pathExists(absolutePath))) return [];
  const metadata = await lstat(absolutePath);
  if (metadata.isSymbolicLink()) {
    throw new Error(`Link simbólico não é aceito no inventário: ${relativePath}`);
  }
  if (metadata.isFile()) return [toPosix(relativePath)];
  if (!metadata.isDirectory()) return [];

  const names = (await readdir(absolutePath)).sort((a, b) => a.localeCompare(b, 'en'));
  const nested = await Promise.all(names.map((name) => collectFiles(root, `${relativePath}/${name}`)));
  return nested.flat();
}

function classify(path) {
  if (path === 'atual.json' || path === 'contatos.json') {
    return { classification: 'publico', rationale: 'Contrato público vigente consumido pelo visualizador estático.' };
  }
  if (path === '.github/workflows/static.yml') {
    return { classification: 'publico', rationale: 'Configuração versionada do processo público atual do GitHub Pages.' };
  }
  return { classification: 'privado', rationale: 'Fonte operacional, histórica, administrativa ou de regras; não integrar o artefato público.' };
}

function category(path) {
  if (ROOT_FILES.includes(path)) return 'dados-raiz';
  if (path.startsWith('old/')) return 'historico';
  if (path.startsWith('escalas/')) return path.includes('/controle-') ? 'controle' : 'ciclo-mensal';
  if (path.startsWith('docs/regras/') || path.startsWith('processos/regras/') || path === 'docs/resumo.md') return 'fonte-de-regras';
  if (path.startsWith('scripts/')) return 'script';
  if (path.startsWith('.github/workflows/')) return 'workflow-pages';
  return 'controle';
}

function detectFormat(path, bytes) {
  const extension = extname(path).toLowerCase();
  const text = bytes.toString('utf8');
  if (extension === '.json') {
    try {
      const value = JSON.parse(text);
      return {
        format: Array.isArray(value) ? 'json-array' : value === null ? 'json-null' : typeof value === 'object' ? 'json-object' : 'json-scalar',
        mediaType: 'application/json',
        valid: true,
      };
    } catch {
      return { format: 'json-invalido', mediaType: 'application/json', valid: false };
    }
  }
  if (extension === '.csv') {
    const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
    const delimiter = firstLine.includes(';') ? ';' : ',';
    return { format: `csv-delimitador-${delimiter === ';' ? 'ponto-e-virgula' : 'virgula'}`, mediaType: 'text/csv', valid: true };
  }
  const formats = {
    '.md': ['markdown', 'text/markdown'],
    '.js': ['javascript-esm', 'text/javascript'],
    '.mjs': ['javascript-esm', 'text/javascript'],
    '.py': ['python', 'text/x-python'],
    '.sh': ['shell', 'text/x-shellscript'],
    '.yml': ['yaml', 'application/yaml'],
    '.yaml': ['yaml', 'application/yaml'],
  };
  const [format, mediaType] = formats[extension] ?? ['binario-ou-desconhecido', 'application/octet-stream'];
  return { format, mediaType, valid: true };
}

export async function buildLegacyInventory(root) {
  const selected = [...ROOT_FILES, ...RECURSIVE_ROOTS, ...EXTRA_FILES];
  const paths = [...new Set((await Promise.all(selected.map((path) => collectFiles(root, path)))).flat())]
    .sort((a, b) => a.localeCompare(b, 'en'));

  const files = await Promise.all(paths.map(async (path) => {
    const bytes = await readFile(resolve(root, path));
    const detected = detectFormat(path, bytes);
    return {
      path,
      type: category(path),
      bytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      format: detected.format,
      mediaType: detected.mediaType,
      formatValid: detected.valid,
      ...classify(path),
    };
  }));

  const formatCounts = new Map();
  for (const file of files) formatCounts.set(file.format, (formatCounts.get(file.format) ?? 0) + 1);

  return {
    schemaVersion: '1.0.0',
    algorithm: 'sha256',
    canonicalization: 'UTF-8, LF final, object keys sorted recursively; arrays preserve declared order',
    scope: {
      roots: [...ROOT_FILES, ...RECURSIVE_ROOTS, ...EXTRA_FILES].sort((a, b) => a.localeCompare(b, 'en')),
      missingRoots: selected.filter((path) => !paths.some((file) => file === path || file.startsWith(`${path}/`))).sort((a, b) => a.localeCompare(b, 'en')),
    },
    formatsFound: [...formatCounts.entries()].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([format, count]) => ({ format, count })),
    knownDivergences: KNOWN_DIVERGENCES,
    files,
  };
}

export async function writeInventory(root, outputPath) {
  const manifest = await buildLegacyInventory(root);
  const content = canonicalJson(manifest);
  const destination = resolve(root, outputPath);
  const temporary = `${destination}.tmp`;
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, destination);
  return { manifest, content, destination };
}

async function main() {
  const scriptPath = fileURLToPath(import.meta.url);
  const defaultRoot = resolve(dirname(scriptPath), '..');
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf('--root');
  const outputIndex = args.indexOf('--output');
  const root = rootIndex >= 0 ? resolve(args[rootIndex + 1]) : defaultRoot;
  const output = outputIndex >= 0 ? args[outputIndex + 1] : 'migration/source-manifest.json';
  const stdoutOnly = args.includes('--stdout');
  const manifest = await buildLegacyInventory(root);
  if (stdoutOnly) {
    process.stdout.write(canonicalJson(manifest));
    return;
  }
  const { destination } = await writeInventory(root, output);
  process.stdout.write(`Manifesto canônico criado em ${toPosix(relative(root, destination))} com ${manifest.files.length} arquivos.\n`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch(async (error) => {
    const temporaryArgument = process.argv[process.argv.indexOf('--output') + 1];
    if (temporaryArgument) await unlink(`${resolve(temporaryArgument)}.tmp`).catch(() => {});
    process.stderr.write(`Falha ao criar inventário: ${error.message}\n`);
    process.exitCode = 1;
  });
}
