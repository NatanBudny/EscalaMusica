import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildLegacyInventory, canonicalJson, writeInventory } from '../../scripts/inventario-legado.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'inventario-legado-'));
  const files = {
    'atual.json': '[{"DATA":"01/01/2026"}]\n',
    'contatos.json': '{"ANA":{"telefone":"https://wa.me/5511999999999","apelidos":[]}}\n',
    'pessoas.json': '{"pessoas":[]}\n',
    'old/2025/06-2025.csv': 'DATA;REGENTE\n01/06/2025;ANA\n',
    'escalas/2026/06/controle-regentes.json': '{"ANA":1}\n',
    'docs/regras/REGRAS.md': '# Regras\n',
    'processos/regras/fundamentais.json': '[]\n',
    'scripts/ciclo/exemplo.js': 'export const exemplo = true;\n',
    '.github/workflows/static.yml': 'name: Pages\n',
  };
  await Promise.all(Object.entries(files).map(async ([path, content]) => {
    const destination = join(root, path);
    await mkdir(join(destination, '..'), { recursive: true });
    await writeFile(destination, content);
  }));
  return { root, files };
}

describe('inventário reproduzível do legado', () => {
  let root;
  let sourceFiles;

  beforeEach(async () => {
    ({ root, files: sourceFiles } = await fixture());
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('cataloga caminho, tipo, tamanho, SHA-256, formato e classificação', async () => {
    const manifest = await buildLegacyInventory(root);
    const current = manifest.files.find((file) => file.path === 'atual.json');
    const control = manifest.files.find((file) => file.path.endsWith('controle-regentes.json'));

    expect(manifest.files).toHaveLength(Object.keys(sourceFiles).length);
    expect(current).toMatchObject({
      type: 'dados-raiz',
      bytes: Buffer.byteLength(sourceFiles['atual.json']),
      format: 'json-array',
      mediaType: 'application/json',
      formatValid: true,
      classification: 'publico',
    });
    expect(current.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(control).toMatchObject({ type: 'controle', classification: 'privado' });
    expect(manifest.knownDivergences.map(({ id }) => id)).toContain('fontes-regras-divergentes');
  });

  test('duas execuções sobre a mesma árvore produzem os mesmos bytes canônicos', async () => {
    const first = await writeInventory(root, 'migration/source-manifest.json');
    const firstBytes = await readFile(first.destination, 'utf8');
    const second = await writeInventory(root, 'migration/source-manifest.json');
    const secondBytes = await readFile(second.destination, 'utf8');

    expect(secondBytes).toBe(firstBytes);
    expect(secondBytes).toBe(canonicalJson(second.manifest));
    expect(second.manifest.files.some(({ path }) => path.startsWith('migration/'))).toBe(false);
  });

  test('a geração não altera nenhum arquivo inventariado', async () => {
    const before = await buildLegacyInventory(root);
    await writeInventory(root, 'migration/source-manifest.json');
    const after = await buildLegacyInventory(root);

    expect(after.files).toEqual(before.files);
  });

  test('registra raiz esperada ausente sem falhar ou inventar conteúdo', async () => {
    await rm(join(root, 'pessoas.json'));
    const manifest = await buildLegacyInventory(root);

    expect(manifest.scope.missingRoots).toContain('pessoas.json');
    expect(manifest.files.some(({ path }) => path === 'pessoas.json')).toBe(false);
  });
});
