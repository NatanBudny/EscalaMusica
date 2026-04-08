#!/usr/bin/env node
/**
 * validar-obs-publico.js
 * Garante que o campo OBS em atual.json contenha somente avisos publicos.
 *
 * Regras aplicadas:
 * 1) OBS vazio e permitido.
 * 2) OBS preenchido deve iniciar com "PUBLICAR:".
 * 3) OBS nao pode conter termos tipicos de anotacoes internas/sensiveis.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const pathAtual = resolve(ROOT, 'atual.json');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

const forbiddenPatterns = [
  /\bdesenvolvimento\b/i,
  /\binterno\b/i,
  /\bprivad[oa]\b/i,
  /\brascunho\b/i,
  /\bdraft\b/i,
  /\bpenden(te|cia)\b/i,
  /\bajuste\b/i,
  /\bsubstitui(cao|ção)\b/i,
  /\bwhats(app)?\b/i,
  /\btelefone\b/i,
  /\bcontato\b/i,
  /\be-?mail\b/i,
  /\bsenha\b/i,
  /\btoken\b/i,
  /\bcpf\b/i,
  /\brg\b/i,
  /\btodo\b/i,
  /\bobs\s*interna\b/i
];

let dados;
try {
  dados = JSON.parse(readFileSync(pathAtual, 'utf8'));
} catch (e) {
  console.error(`${RED}${BOLD}ERRO:${RESET} nao foi possivel ler/parsear atual.json`);
  console.error(`  ${e.message}`);
  process.exit(1);
}

if (!Array.isArray(dados)) {
  console.error(`${RED}${BOLD}ERRO:${RESET} atual.json deve ser um array de cultos.`);
  process.exit(1);
}

const erros = [];

for (const culto of dados) {
  const data = culto.DATA || '(sem DATA)';
  const obsRaw = culto.OBS;
  const obs = typeof obsRaw === 'string' ? obsRaw.trim() : '';

  if (!obs) continue;

  if (!/^PUBLICAR\s*:/i.test(obs)) {
    erros.push(`${data}: OBS preenchido sem prefixo obrigatorio "PUBLICAR:"`);
    continue;
  }

  const corpo = obs.replace(/^PUBLICAR\s*:/i, '').trim();
  if (!corpo) {
    erros.push(`${data}: OBS com prefixo "PUBLICAR:" mas sem mensagem publica.`);
    continue;
  }

  const pattern = forbiddenPatterns.find((rx) => rx.test(corpo));
  if (pattern) {
    erros.push(`${data}: OBS contem termo nao permitido para publicacao (${pattern}).`);
  }
}

console.log(`\n${BOLD}=== Validacao de OBS Publico ===${RESET}\n`);

if (erros.length > 0) {
  console.log(`${RED}${BOLD}Erros (${erros.length}):${RESET}`);
  for (const err of erros) {
    console.log(`  ${RED}x${RESET} ${err}`);
  }
  console.log(`\n${RED}${BOLD}Falhou.${RESET} Corrija o campo OBS no atual.json.`);
  console.log('Exemplo valido: PUBLICAR: Culto Jovem');
  process.exit(1);
}

console.log(`${GREEN}${BOLD}OK:${RESET} nenhum OBS indevido encontrado.`);
