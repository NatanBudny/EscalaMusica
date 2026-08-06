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
 * Somente pessoas com telefone preenchido são incluídas.
 * Chaves ordenadas alfabeticamente para consistência.
 */

import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { carregarPessoas } from '../lib/cadastro.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

function gerarContatos() {
  const { pessoas } = carregarPessoas();

  const contatosObj = {};

  for (const pessoa of pessoas) {
    // Incluir somente pessoas com telefone preenchido
    if (!pessoa.telefone) continue;

    contatosObj[pessoa.nome] = {
      telefone: `https://wa.me/${pessoa.telefone}`,
      apelidos: pessoa.aliases || []
    };
  }

  // Ordenar chaves alfabeticamente para consistência
  const chavesOrdenadas = Object.keys(contatosObj).sort((a, b) =>
    a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })
  );

  const resultado = {};
  for (const chave of chavesOrdenadas) {
    resultado[chave] = contatosObj[chave];
  }

  const outPath = resolve(ROOT, 'contatos.json');
  writeFileSync(outPath, JSON.stringify(resultado, null, 2) + '\n', 'utf8');

  console.log(`contatos.json gerado com ${chavesOrdenadas.length} entradas.`);
  console.log(`Arquivo: ${outPath}`);
}

gerarContatos();
