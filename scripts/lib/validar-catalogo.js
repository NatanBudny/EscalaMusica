/**
 * validar-catalogo.js
 *
 * Checagens de integridade das regras do projeto, reusadas por:
 *  - scripts/validacao/validar-regras.js (CLI, mesma saída de antes);
 *  - montador/lib/regras-catalogo.mjs (tela de regras e revalidação de envio).
 *
 * Expõe duas camadas:
 *
 *  1) validarSnapshotEMd(ROOT): as checagens históricas MD ↔ snapshot JSON que
 *     o validar-regras.js já fazia. Devolve { erros, avisos, contagens }.
 *
 *  2) validarCatalogoCanonico(ROOT): integridade dos arquivos canônicos
 *     (fundamentais.json, preferencias.json, restricoes-pessoais.json,
 *     papeis.json, glossario.json): JSON válido, id e descricao presentes,
 *     IDs únicos. Devolve { erros, avisos }.
 *
 *  3) validarCatalogo(ROOT): junta as duas (erros/avisos concatenados).
 *
 * Feature: melhoras-domingao (C. Regras) — Requisitos 9.1, 21.4.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Lê e faz JSON.parse; lança com mensagem de caminho se falhar. */
function lerJSON(caminho) {
  const raw = readFileSync(caminho, 'utf8');
  return JSON.parse(raw);
}

/** Arquivos canônicos por categoria. */
export const ARQUIVOS_CATALOGO = {
  fundamentais: 'processos/regras/fundamentais.json',
  preferencias: 'processos/regras/preferencias.json',
  restricoes_pessoais: 'processos/regras/restricoes-pessoais.json',
  papeis: 'processos/regras/papeis.json',
  glossario: 'processos/regras/glossario.json',
};

/** Acha duplicados numa lista. */
function duplicados(arr) {
  return [...new Set(arr.filter((v, i) => arr.indexOf(v) !== i))];
}

/**
 * Integridade dos cinco arquivos canônicos de regras.
 * - cada arquivo é JSON válido;
 * - regras de fundamentais/preferencias têm `id` e `descricao`;
 * - restrições pessoais têm `id` e `descricao` em cada item;
 * - IDs únicos em fundamentais, preferencias e restrições pessoais.
 *
 * @param {string} ROOT raiz do repositório
 * @returns {{ erros: string[], avisos: string[] }}
 */
export function validarCatalogoCanonico(ROOT) {
  const erros = [];
  const avisos = [];

  const dados = {};
  for (const [categoria, rel] of Object.entries(ARQUIVOS_CATALOGO)) {
    const caminho = resolve(ROOT, rel);
    if (!existsSync(caminho)) {
      erros.push(`Catálogo: arquivo ausente: ${rel}`);
      continue;
    }
    try {
      dados[categoria] = lerJSON(caminho);
    } catch (e) {
      erros.push(`Catálogo: JSON inválido em ${rel}: ${e.message}`);
    }
  }

  // fundamentais.json: array de { id, descricao }
  if (Array.isArray(dados.fundamentais)) {
    const ids = [];
    for (const regra of dados.fundamentais) {
      if (!regra || !regra.id) {
        erros.push(`fundamentais.json: regra sem "id": ${JSON.stringify(regra).slice(0, 60)}`);
        continue;
      }
      ids.push(regra.id);
      if (!regra.descricao) erros.push(`fundamentais.json: ${regra.id} sem "descricao".`);
    }
    const dup = duplicados(ids);
    if (dup.length) erros.push(`fundamentais.json: IDs duplicados: ${dup.join(', ')}`);
  } else if (dados.fundamentais !== undefined) {
    erros.push('fundamentais.json: esperado um array de regras.');
  }

  // preferencias.json: array de { id, descricao }
  if (Array.isArray(dados.preferencias)) {
    const ids = [];
    for (const regra of dados.preferencias) {
      if (!regra || !regra.id) {
        erros.push(`preferencias.json: regra sem "id": ${JSON.stringify(regra).slice(0, 60)}`);
        continue;
      }
      ids.push(regra.id);
      if (!regra.descricao) erros.push(`preferencias.json: ${regra.id} sem "descricao".`);
    }
    const dup = duplicados(ids);
    if (dup.length) erros.push(`preferencias.json: IDs duplicados: ${dup.join(', ')}`);
  } else if (dados.preferencias !== undefined) {
    erros.push('preferencias.json: esperado um array de regras.');
  }

  // restricoes-pessoais.json: objeto nome → array de { id, descricao }
  if (dados.restricoes_pessoais && typeof dados.restricoes_pessoais === 'object') {
    const ids = [];
    for (const [nome, arr] of Object.entries(dados.restricoes_pessoais)) {
      const lista = Array.isArray(arr) ? arr : [arr];
      for (const regra of lista) {
        if (!regra || !regra.id) {
          erros.push(`restricoes-pessoais.json: ${nome} tem item sem "id".`);
          continue;
        }
        ids.push(regra.id);
        if (!regra.descricao) erros.push(`restricoes-pessoais.json: ${regra.id} sem "descricao".`);
      }
    }
    const dup = duplicados(ids);
    if (dup.length) erros.push(`restricoes-pessoais.json: IDs duplicados: ${dup.join(', ')}`);
  }

  // papeis.json e glossario.json: objetos não vazios.
  if (dados.papeis !== undefined && (typeof dados.papeis !== 'object' || Array.isArray(dados.papeis))) {
    erros.push('papeis.json: esperado um objeto id → papel.');
  }
  if (
    dados.glossario !== undefined &&
    (typeof dados.glossario !== 'object' || Array.isArray(dados.glossario))
  ) {
    erros.push('glossario.json: esperado um objeto termo → texto.');
  }

  return { erros, avisos };
}

/**
 * Checagens históricas MD ↔ snapshot JSON (as mesmas do validar-regras.js).
 * Não imprime nada; devolve as listas e as contagens de RF/PE/RP.
 *
 * @param {string} ROOT raiz do repositório
 * @returns {{ erros: string[], avisos: string[], contagens: { rf: number, pe: number, rp: number } }}
 */
export function validarSnapshotEMd(ROOT) {
  const erros = [];
  const avisos = [];

  // 1. Carrega o snapshot JSON (novo ou legado).
  let json;
  const jsonNovo = resolve(ROOT, 'processos/regras/regras.snapshot.json');
  const jsonLegado = resolve(ROOT, 'docs/regras/regras.json');
  const jsonPath = existsSync(jsonNovo) ? jsonNovo : jsonLegado;
  try {
    json = lerJSON(jsonPath);
  } catch (e) {
    erros.push(`regras.json inválido ou não encontrado: ${e.message}`);
    return { erros, avisos, contagens: { rf: 0, pe: 0, rp: 0 } };
  }

  // 2. Carrega REGRAS.md (novo ou legado).
  let md;
  const mdNovo = resolve(ROOT, 'processos/regras/REGRAS.md');
  const mdLegado = resolve(ROOT, 'docs/regras/REGRAS.md');
  const mdPath = existsSync(mdNovo) ? mdNovo : mdLegado;
  try {
    md = readFileSync(mdPath, 'utf8');
  } catch {
    erros.push('REGRAS.md não encontrado');
    return { erros, avisos, contagens: { rf: 0, pe: 0, rp: 0 } };
  }

  // 3. Seções obrigatórias no JSON.
  const secoesObrigatorias = [
    'versao',
    'papeis',
    'regras_fundamentais',
    'preferencias',
    'restricoes_pessoais',
    'glossario',
  ];
  for (const secao of secoesObrigatorias) {
    if (!(secao in json)) erros.push(`JSON: seção obrigatória ausente: "${secao}"`);
  }

  // 4. Seções obrigatórias no MD.
  const secoesMd = [
    '## RF — Regras Fundamentais',
    '## RP — Restrições Pessoais',
    '## PE — Preferências de Escala',
    '## TI — Time e Papéis',
    '## Glossário',
  ];
  for (const secao of secoesMd) {
    if (!md.includes(secao)) erros.push(`REGRAS.md: seção obrigatória ausente: "${secao}"`);
  }

  // 5. Extrai IDs do MD.
  const idsRfMd = [...md.matchAll(/\*\*(RF\d+)\*\*/g)].map((m) => m[1]);
  const idsPeMd = [...md.matchAll(/\*\*(PE\d+)\*\*/g)].map((m) => m[1]);
  const idsRpMd = [...md.matchAll(/\*\*(RP\d+)\b/g)].map((m) => m[1]);

  // 6. Extrai IDs do JSON.
  const idsRfJson = (json.regras_fundamentais || []).map((r) => r.id);
  const idsPeJson = (json.preferencias || []).map((r) => r.id);
  const idsRpJson = Object.values(json.restricoes_pessoais || {}).flatMap((arr) =>
    (Array.isArray(arr) ? arr : [arr]).map((r) => r.id).filter(Boolean),
  );

  // 7. Sincronização MD ↔ JSON.
  for (const id of idsRfMd) {
    if (!idsRfJson.includes(id)) erros.push(`${id} está no REGRAS.md mas não no JSON (regras_fundamentais)`);
  }
  for (const id of idsRfJson) {
    if (!idsRfMd.includes(id)) erros.push(`${id} está no JSON mas não no REGRAS.md`);
  }
  for (const id of idsPeMd) {
    if (!idsPeJson.includes(id)) erros.push(`${id} está no REGRAS.md mas não no JSON (preferencias)`);
  }
  for (const id of idsPeJson) {
    if (!idsPeMd.includes(id)) erros.push(`${id} está no JSON mas não no REGRAS.md`);
  }
  for (const id of idsRpMd) {
    if (!idsRpJson.includes(id)) erros.push(`${id} está no REGRAS.md mas não no JSON (restricoes_pessoais)`);
  }
  for (const id of idsRpJson) {
    if (!idsRpMd.includes(id)) erros.push(`${id} está no JSON mas não no REGRAS.md`);
  }

  // 8. Campos obrigatórios em cada regra.
  for (const regra of [...(json.regras_fundamentais || []), ...(json.preferencias || [])]) {
    if (!regra.id) erros.push(`Regra sem campo "id": ${JSON.stringify(regra).slice(0, 60)}`);
    if (!regra.descricao) erros.push(`Regra ${regra.id} sem campo "descricao"`);
  }

  // 9. IDs duplicados.
  const dupRf = duplicados(idsRfJson);
  const dupPe = duplicados(idsPeJson);
  if (dupRf.length) erros.push(`IDs duplicados em regras_fundamentais: ${dupRf.join(', ')}`);
  if (dupPe.length) erros.push(`IDs duplicados em preferencias: ${dupPe.join(', ')}`);

  // 10. Avisos.
  if (!json.ultima_atualizacao) {
    avisos.push('"ultima_atualizacao" está vazia no JSON — atualize com a data da última modificação');
  }
  if ((json.regras_fundamentais || []).length === 0) {
    avisos.push('Nenhuma RF registrada ainda no JSON');
  }
  if (!json.glossario || Object.keys(json.glossario).length < 5) {
    avisos.push('Glossário com menos de 5 termos — pode estar incompleto');
  }
  if (!md.includes('## Glossário')) {
    avisos.push('REGRAS.md pode estar sem o cabeçalho "## Glossário"');
  }

  return {
    erros,
    avisos,
    contagens: { rf: idsRfJson.length, pe: idsPeJson.length, rp: idsRpJson.length },
  };
}

/**
 * Validação completa: snapshot/MD + integridade dos canônicos.
 * @param {string} ROOT
 * @returns {{ erros: string[], avisos: string[], contagens: object }}
 */
export function validarCatalogo(ROOT) {
  const snap = validarSnapshotEMd(ROOT);
  const canon = validarCatalogoCanonico(ROOT);
  return {
    erros: [...snap.erros, ...canon.erros],
    avisos: [...snap.avisos, ...canon.avisos],
    contagens: snap.contagens,
  };
}
