#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const atualPath = resolve(ROOT, 'atual.json');
const contatosPath = resolve(ROOT, 'contatos.json');

const MENSAGEM = [
  'Oi, escala desse mes, me confirma por favor?',
  'Link da escala: https://natanbudny.github.io/EscalaMusica/'
].join('\n');

const FIXOS = [
  { label: 'Lider da banda (Adelaide)', nome: 'ADELAIDE' },
  { label: 'Anciao principal (Yasser)', nome: 'YASSER' }
];

const GRUPO_LOUVOR = 'https://chat.whatsapp.com/EsfZwmrdWntG9wxqoSN5zw';

function normalizeNome(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function limparTelefone(waLink) {
  const match = String(waLink || '').match(/wa\.me\/(\+?\d+)/i);
  if (!match) return '';
  return match[1].replace('+', '');
}

function montarLink(telefone) {
  return `https://wa.me/${telefone}?text=${encodeURIComponent(MENSAGEM)}`;
}

function parseCelulaNomes(celula, lookupContato) {
  if (!celula) return [];

  const texto = String(celula).trim();
  if (!texto || texto === '-') return [];

  const partesVirgula = texto.split(',').map((p) => p.trim()).filter(Boolean);
  const nomes = [];

  for (const parte of partesVirgula) {
    const normalizado = normalizeNome(parte);

    // Mantem nomes compostos com "E" quando existe contato exatamente assim.
    if (/\sE\s/.test(normalizado) && !lookupContato.has(normalizado)) {
      const splitE = parte
        .split(/\s+e\s+/i)
        .map((p) => p.trim())
        .filter(Boolean);
      nomes.push(...splitE);
      continue;
    }

    nomes.push(parte);
  }

  return nomes;
}

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

let escala;
let contatos;

try {
  escala = JSON.parse(readFileSync(atualPath, 'utf8'));
} catch (err) {
  console.error('Erro ao ler atual.json:', err.message);
  process.exit(1);
}

try {
  contatos = JSON.parse(readFileSync(contatosPath, 'utf8'));
} catch (err) {
  console.error('Erro ao ler contatos.json:', err.message);
  process.exit(1);
}

if (!Array.isArray(escala)) {
  console.error('Erro: atual.json precisa ser um array.');
  process.exit(1);
}

const lookupContato = new Map();

for (const [nomePrincipal, payload] of Object.entries(contatos)) {
  const telefoneLimpo = limparTelefone(payload?.telefone);
  if (!telefoneLimpo) continue;

  const registro = {
    nomeContato: nomePrincipal,
    telefone: telefoneLimpo
  };

  lookupContato.set(normalizeNome(nomePrincipal), registro);

  for (const apelido of payload?.apelidos || []) {
    lookupContato.set(normalizeNome(apelido), registro);
  }
}

const membrosMap = new Map();

for (const culto of escala) {
  for (const campo of ['REGENTE LOUVOR', 'EQUIPE LOUVOR', 'MENSAGEM MUSICAL']) {
    const nomes = parseCelulaNomes(culto[campo], lookupContato);

    for (const nome of nomes) {
      const nomeExibicao = String(nome).trim();
      if (!nomeExibicao) continue;

      const chave = normalizeNome(nomeExibicao);
      if (!membrosMap.has(chave)) {
        membrosMap.set(chave, {
          nomeEscala: nomeExibicao,
          campos: new Set([campo])
        });
      } else {
        membrosMap.get(chave).campos.add(campo);
      }
    }
  }
}

const membrosOrdenados = Array.from(membrosMap.values()).sort((a, b) =>
  a.nomeEscala.localeCompare(b.nomeEscala, 'pt-BR', { sensitivity: 'base' })
);

const comContato = [];
const semContato = [];

for (const membro of membrosOrdenados) {
  const encontrado = lookupContato.get(normalizeNome(membro.nomeEscala));
  const campos = Array.from(membro.campos).sort().join(', ');

  if (encontrado) {
    comContato.push({
      nomeEscala: membro.nomeEscala,
      origemContato: encontrado.nomeContato,
      campos,
      link: montarLink(encontrado.telefone)
    });
  } else {
    semContato.push({
      nomeEscala: membro.nomeEscala,
      campos
    });
  }
}

const fixos = FIXOS.map((item) => {
  const encontrado = lookupContato.get(normalizeNome(item.nome));
  return {
    ...item,
    link: encontrado ? montarLink(encontrado.telefone) : '',
    origemContato: encontrado ? encontrado.nomeContato : ''
  };
});

const data = hojeISO();
const arquivoSaida = `links-whatsapp-publicacao-${data}.md`;
const outPath = resolve(ROOT, arquivoSaida);

const linhas = [];
linhas.push(`# Links WhatsApp - Publicacao ${data}`);
linhas.push('');
linhas.push('## Mensagem padrao');
linhas.push('');
linhas.push('```text');
linhas.push(MENSAGEM);
linhas.push('```');
linhas.push('');
linhas.push('## Membros da escala (Regencia, Equipe Louvor e Mensagem Musical)');
linhas.push('');

for (const item of comContato) {
  linhas.push(`- ${item.nomeEscala} (${item.campos}) -> ${item.link}`);
}

linhas.push('');
linhas.push('## Contatos fixos');
linhas.push('');

for (const item of fixos) {
  if (item.link) {
    linhas.push(`- ${item.label} (${item.origemContato}) -> ${item.link}`);
  } else {
    linhas.push(`- ${item.label} -> SEM CONTATO EM contatos.json`);
  }
}

linhas.push('');
linhas.push('## Grupo do louvor');
linhas.push('');
linhas.push(`- Convite do grupo: ${GRUPO_LOUVOR}`);
linhas.push('- Observacao: link de convite nao preenche mensagem automaticamente como no wa.me.');

if (semContato.length > 0) {
  linhas.push('');
  linhas.push('## Sem contato cadastrado');
  linhas.push('');
  for (const item of semContato) {
    linhas.push(`- ${item.nomeEscala} (${item.campos})`);
  }
}

linhas.push('');
linhas.push('## Fonte');
linhas.push('');
linhas.push('- Escala: atual.json');
linhas.push('- Contatos: contatos.json');

writeFileSync(outPath, `${linhas.join('\n')}\n`, 'utf8');

console.log(`Arquivo gerado: ${arquivoSaida}`);
console.log(`Com contato: ${comContato.length}`);
console.log(`Sem contato: ${semContato.length}`);
