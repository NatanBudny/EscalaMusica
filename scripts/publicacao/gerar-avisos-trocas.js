#!/usr/bin/env node
/**
 * gerar-avisos-trocas.js
 *
 * Gera mensagens de WhatsApp (com link wa.me) para avisar as pessoas afetadas
 * por trocas feitas na escala já publicada. Lê um JSON de trocas e resolve o
 * telefone via contatos.json / pessoas.json.
 *
 * Uso:
 *   node scripts/publicacao/gerar-avisos-trocas.js --trocas=escalas/2026/09/avisos-trocas.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const arg = (n) => { const p = args.find((a) => a.startsWith(`--${n}=`)); return p ? p.split('=').slice(1).join('=') : null; };
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
const normTel = (s) => String(s || '').replace(/\D/g, '');

const trocasPath = arg('trocas') || 'escalas/2026/09/avisos-trocas.json';
const cfg = JSON.parse(readFileSync(resolve(ROOT, trocasPath), 'utf8'));
const cad = JSON.parse(readFileSync(resolve(ROOT, 'pessoas.json'), 'utf8')).pessoas;

// telefone por nome/alias
const telPorNome = new Map();
for (const p of cad) { const t = normTel(p.telefone); if (t) { telPorNome.set(norm(p.nome), t); for (const a of p.aliases || []) telPorNome.set(norm(a), t); } }

const LINK = 'https://natanbudny.github.io/EscalaMusica/';
function montar(pessoa, detalhe) {
  return [
    `Olá, ${pessoa}. Atualização na escala de louvor de ${cfg.mes_ano}.`,
    '',
    detalhe,
    '',
    '*Link da escala:*',
    LINK,
  ].join('\n');
}

const linhas = [];
linhas.push(`# Avisos de troca - Escala ${cfg.mes_ano}`);
linhas.push('');
linhas.push('Mensagens para avisar as pessoas afetadas pelas trocas.');
linhas.push('');
linhas.push('| Pessoa | Tipo | Link |');
linhas.push('|---|---|---|');

const semTel = [];
for (const t of cfg.trocas) {
  const tel = telPorNome.get(norm(t.pessoa));
  const texto = montar(t.pessoa, t.detalhe);
  if (!tel) { semTel.push(t.pessoa); linhas.push(`| ${t.pessoa} | ${t.tipo} | (sem telefone) |`); continue; }
  const url = `https://wa.me/${tel}?text=${encodeURIComponent(texto)}`;
  linhas.push(`| ${t.pessoa} | ${t.tipo} | [Abrir](${url}) |`);
}

linhas.push('');
linhas.push('## Prévia das mensagens');
linhas.push('');
for (const t of cfg.trocas) {
  linhas.push(`### ${t.pessoa} (${t.tipo})`);
  linhas.push('```text');
  linhas.push(montar(t.pessoa, t.detalhe));
  linhas.push('```');
  linhas.push('');
}

const outPath = resolve(dirname(resolve(ROOT, trocasPath)), 'avisos-trocas.md');
writeFileSync(outPath, linhas.join('\n'), 'utf8');
console.log('Arquivo gerado:', outPath.replace(ROOT + '\\', '').replace(ROOT + '/', ''));
console.log('Avisos:', cfg.trocas.length, '| Sem telefone:', semTel.length ? semTel.join(', ') : 0);
