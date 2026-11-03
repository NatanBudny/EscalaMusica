#!/usr/bin/env node

/**
 * gerar-contatos.js
 *
 * Deriva `contatos.json` a partir de `pessoas.json`.
 * Mantém retrocompatibilidade com o frontend e `gerar-links-publicacao.js`.
 *
 * Formato de saída:
 * {
 *   "NOME": {
 *     "telefone": "https://wa.me/<digitos>",
 *     "apelidos": ["ALIAS1", "ALIAS2"]
 *   }
 * }
 *
 * Somente pessoas com telefone preenchido (e grupos escaláveis cujo responsável
 * tem telefone) são incluídas. A lógica de derivação vive em
 * `scripts/lib/contatos.js`, compartilhada com o editor de escala.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { derivarContatos } from '../lib/contatos.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

function gerarContatos() {
  const arquivo = JSON.parse(readFileSync(resolve(ROOT, 'pessoas.json'), 'utf8'));
  const resultado = derivarContatos(arquivo.pessoas, arquivo.grupos || {});

  const outPath = resolve(ROOT, 'contatos.json');
  writeFileSync(outPath, JSON.stringify(resultado, null, 2) + '\n', 'utf8');

  const total = Object.keys(resultado).length;
  console.log(`contatos.json gerado com ${total} entradas.`);
  console.log(`Arquivo: ${outPath}`);
}

gerarContatos();
