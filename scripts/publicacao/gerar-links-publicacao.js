#!/usr/bin/env node

// Gera escalas/AAAA/MM/links-whatsapp.md a partir de atual.json e contatos.json
// (linha de comando). A lógica de montagem dos links vive em
// scripts/lib/links-whatsapp.js (compartilhada com montador/lib/whatsapp.mjs,
// que serve GET /api/whatsapp sem gravar arquivo). O texto das mensagens vem
// das Mensagens_WhatsApp editáveis (processos/regras/mensagens-whatsapp.json),
// não mais de um template fixo neste arquivo.

import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { carregarMensagens } from '../lib/mensagens-whatsapp.js';
import { derivarContatos } from '../lib/contatos.js';
import { montarListaEnvios } from '../lib/links-whatsapp.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const atualPath = resolve(ROOT, 'atual.json');
const pessoasPath = resolve(ROOT, 'pessoas.json');
const mensagensPath = resolve(ROOT, 'processos/regras/mensagens-whatsapp.json');

<<<<<<< Updated upstream
const MENSAGEM_TEMPLATE = [
  'Olá, {nome}. Você está na escala de {mes/ano}, como {funções}. Entre na escala, veja os dias.',
  '',
  'Dê um joinha nessa mensagem para confirmar que poderá participar.',
  '',
  '*Link da escala:*',
  'https://natanbudny.github.io/EscalaMusica/'
].join('\n');

const FIXOS = [
  { label: 'Lider da banda (Adelaide)', nome: 'ADELAIDE' },
  { label: 'Anciao principal (Yasser)', nome: 'YASSER' }
];

// Grupos/departamentos não têm telefone próprio: têm um RESPONSÁVEL de contato.
// Quando um grupo aparece na escala, a mensagem vai para o responsável.
// telefone: só dígitos (formato wa.me). nome: como será exibido na mensagem.
const RESPONSAVEL_GRUPO = {
  'CORAL INFANTIL': { responsavel: 'JESSIE', telefone: '' },   // telefone resolvido via contatos.json
  'CORAL KIDS': { responsavel: 'JESSIE', telefone: '' },        // diretora do Coral Kids (contatos.json)
  'DESBRAVADORES': { responsavel: 'MAXWELL', telefone: '554396489680' },
  'JOVENS': { responsavel: 'FABRICIO', telefone: '' },          // resolvido via contatos.json
  // MANU C. é cantora infantil sem telefone próprio: contato via mãe (Silvana).
  'MANU C.': { responsavel: 'SILVANA', telefone: '' }
};

// Grupos/participações externas cujo aviso vai para o ANCIÃO da semana do culto
// em que aparecem (não têm responsável fixo). Ex.: mensagem musical de visitantes.
const EXTERNOS_VIA_ANCIAO = new Set([
  'JHON', 'ANDREIA', 'JHON E ANDREIA', 'QUARTETO', 'QUARTETO DE MARINGA', 'VOZ JUVENIL',
]);

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

function montarMensagemPersonalizada({ nome, mesAno, funcoes }) {
  return MENSAGEM_TEMPLATE
    .replaceAll('{nome}', nome)
    .replaceAll('{mes/ano}', mesAno)
    .replaceAll('{funções}', funcoes);
}

function montarLink(telefone, mensagem) {
  return `https://wa.me/${telefone}?text=${encodeURIComponent(mensagem)}`;
}

function toMdLink(url, label = 'Abrir') {
  return `[${label}](${url})`;
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
=======
function lerJSON(caminho, obrigatorio = true) {
  try {
    return JSON.parse(readFileSync(caminho, 'utf8'));
  } catch (err) {
    if (obrigatorio) {
      console.error(`Erro ao ler ${caminho}:`, err.message);
      process.exit(1);
>>>>>>> Stashed changes
    }
    return null;
  }
}

/** Nome do responsável de cada Grupo_Escalavel (para o template `{nome}`). */
function gruposComResponsavel(arquivoPessoas) {
  const pessoas = Array.isArray(arquivoPessoas?.pessoas) ? arquivoPessoas.pessoas : [];
  const porId = new Map(pessoas.map((p) => [p.id, p]));
  const grupos = {};
  for (const [chave, def] of Object.entries(arquivoPessoas?.grupos || {})) {
    if (!def || def.escalavel !== true) continue;
    const responsavel = porId.get(def.responsavel_id);
    grupos[chave] = {
      ...def,
      nome_responsavel: responsavel ? responsavel.nome : def.nome_exibicao,
    };
  }
  return grupos;
}

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

function extrairAnoMesDaEscala(escala) {
  for (const item of escala) {
    const match = String(item?.DATA || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (match) return { ano: match[3], mes: match[2] };
  }
  throw new Error('Nao foi possivel identificar ano/mes a partir de atual.json (campo DATA).');
}

function toMdLink(url, label = 'Abrir') {
  return `[${label}](${url})`;
}

const escala = lerJSON(atualPath);
if (!Array.isArray(escala)) {
  console.error('Erro: atual.json precisa ser um array.');
  process.exit(1);
}

const arquivoPessoas = lerJSON(pessoasPath);
const contatos = derivarContatos(arquivoPessoas.pessoas || [], arquivoPessoas.grupos || {});
const grupos = gruposComResponsavel(arquivoPessoas);
const { mensagens, avisos } = carregarMensagens(mensagensPath);
for (const aviso of avisos) console.warn(`Aviso: ${aviso}`);

const { envios, semContato } = montarListaEnvios(escala, contatos, { mensagens, grupos });

<<<<<<< Updated upstream
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
          campos: new Set([campo]),
          ancioes: new Set(culto['ANCIÃO'] ? [String(culto['ANCIÃO']).trim()] : [])
        });
      } else {
        membrosMap.get(chave).campos.add(campo);
        if (culto['ANCIÃO']) membrosMap.get(chave).ancioes.add(String(culto['ANCIÃO']).trim());
      }
    }
  }
}

const membrosOrdenados = Array.from(membrosMap.values()).sort((a, b) =>
  a.nomeEscala.localeCompare(b.nomeEscala, 'pt-BR', { sensitivity: 'base' })
);

const comContato = [];
const semContato = [];
const { ano, mes } = extrairAnoMesDaEscala(escala);
const mesAno = `${mes}/${ano}`;

// Mapa de responsáveis com chave normalizada (independe de ponto/acento/caixa).
const respGrupoNorm = new Map();
for (const [grupo, def] of Object.entries(RESPONSAVEL_GRUPO)) {
  respGrupoNorm.set(normalizeNome(grupo), def);
}

for (const membro of membrosOrdenados) {
  const encontrado = lookupContato.get(normalizeNome(membro.nomeEscala));
  const campos = Array.from(membro.campos).sort().join(', ');

  // Grupo/departamento: resolve o contato pelo responsável definido em RESPONSAVEL_GRUPO.
  const grupoResp = respGrupoNorm.get(normalizeNome(membro.nomeEscala));
  if (!encontrado && grupoResp) {
    const contatoResp = lookupContato.get(normalizeNome(grupoResp.responsavel));
    const telefone = grupoResp.telefone || (contatoResp ? contatoResp.telefone : '');
    if (telefone) {
      const mensagem = montarMensagemPersonalizada({ nome: grupoResp.responsavel, mesAno, funcoes: `${campos} (${membro.nomeEscala})` });
      comContato.push({
        nomeEscala: membro.nomeEscala,
        origemContato: `${grupoResp.responsavel} (resp. ${membro.nomeEscala})`,
        campos,
        link: montarLink(telefone, mensagem)
      });
      continue;
    }
  }

  // Externo sem responsável fixo (JHON, QUARTETO, VOZ JUVENIL...): avisa o ANCIÃO
  // da semana do(s) culto(s) em que aparece.
  if (!encontrado && EXTERNOS_VIA_ANCIAO.has(normalizeNome(membro.nomeEscala))) {
    const ancioes = Array.from(membro.ancioes || []);
    let resolvido = false;
    for (const anciao of ancioes) {
      const contatoAnciao = lookupContato.get(normalizeNome(anciao));
      if (contatoAnciao) {
        const mensagem = montarMensagemPersonalizada({ nome: anciao, mesAno, funcoes: `${campos} (${membro.nomeEscala})` });
        comContato.push({
          nomeEscala: membro.nomeEscala,
          origemContato: `${anciao} (ancião da semana)`,
          campos,
          link: montarLink(contatoAnciao.telefone, mensagem)
        });
        resolvido = true;
        break;
      }
    }
    if (resolvido) continue;
    // ancião sem contato cadastrado: cai em semContato com nota
    semContato.push({ nomeEscala: membro.nomeEscala, campos: `${campos} (avisar ancião: ${ancioes.join(', ') || 'n/d'})` });
    continue;
  }

  if (encontrado) {
    const mensagem = montarMensagemPersonalizada({
      nome: membro.nomeEscala,
      mesAno,
      funcoes: campos
    });

    comContato.push({
      nomeEscala: membro.nomeEscala,
      origemContato: encontrado.nomeContato,
      campos,
      link: montarLink(encontrado.telefone, mensagem)
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
  const mensagem = montarMensagemPersonalizada({
    nome: item.nome,
    mesAno,
    funcoes: item.label
  });

  return {
    ...item,
    link: encontrado ? montarLink(encontrado.telefone, mensagem) : '',
    origemContato: encontrado ? encontrado.nomeContato : ''
  };
});

=======
const { ano, mes } = extrairAnoMesDaEscala(escala);
>>>>>>> Stashed changes
const data = hojeISO();
const pastaMes = resolve(ROOT, 'escalas', ano, mes);
mkdirSync(pastaMes, { recursive: true });
const arquivoSaida = 'links-whatsapp.md';
const outPath = resolve(pastaMes, arquivoSaida);

const pessoasEnvios = envios.filter((e) => e.tipo === 'pessoa' || e.tipo === 'grupo');
const fixos = envios.filter((e) => e.tipo === 'fixo');
const convite = envios.find((e) => e.tipo === 'convite');

const linhas = [];
linhas.push(`# Links WhatsApp - Publicacao ${data}`);
linhas.push('');
linhas.push('## Membros da escala (Regencia, Equipe Louvor e Mensagem Musical)');
linhas.push('');
linhas.push('| Nome | Funcoes | Link |');
linhas.push('|---|---|---|');
for (const item of pessoasEnvios) {
  linhas.push(`| ${item.nome} | ${item.funcoes.join(', ')} | ${toMdLink(item.link)} |`);
}

linhas.push('');
linhas.push('## Contatos fixos');
linhas.push('');
linhas.push('| Contato | Nome | Link |');
linhas.push('|---|---|---|');
for (const item of fixos) {
  linhas.push(`| ${item.rotulo || '-'} | ${item.nome} | ${toMdLink(item.link)} |`);
}

linhas.push('');
linhas.push('## Grupo do louvor');
linhas.push('');
linhas.push('| Item | Link |');
linhas.push('|---|---|');
if (convite) linhas.push(`| Convite do grupo | ${toMdLink(convite.link)} |`);
linhas.push('');
linhas.push('Observacao: o link de convite do grupo nao preenche mensagem automaticamente como o wa.me.');

if (semContato.length > 0) {
  linhas.push('');
  linhas.push('## Sem contato cadastrado');
  linhas.push('');
  linhas.push('| Nome | Funcoes |');
  linhas.push('|---|---|');
  for (const item of semContato) {
    linhas.push(`| ${item.nome} | ${(item.funcoes || []).join(', ')} |`);
  }
}

linhas.push('');
linhas.push('## Fonte');
linhas.push('');
linhas.push('- Escala: atual.json');
linhas.push('- Contatos: derivado de pessoas.json');

writeFileSync(outPath, `${linhas.join('\n')}\n`, 'utf8');

console.log(`Arquivo gerado: escalas/${ano}/${mes}/${arquivoSaida}`);
console.log(`Com contato: ${pessoasEnvios.length + fixos.length}`);
console.log(`Sem contato: ${semContato.length}`);
