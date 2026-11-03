// Testes de contrato e compatibilidade E2E do Visualizador_Atual (tarefa 9.8).
//
// OBJETIVO
// --------
// Provar que um PACOTE CANDIDATO produzido pelo `LegacyExporter`
// (atual.json/contatos.json) satisfaz TODOS os contratos que o
// Visualizador_Atual consome e que o visualizador real carrega e opera esse
// pacote sem alteracao: tabela, cartoes, filtro, agenda, contatos, cache
// offline e o vinculo de nome via login Google.
//
// VALIDACAO OBJETIVA (requisitos 9.1-9.3, 11.13, 16.1, 16.8, 16.9)
// ----------------------------------------------------------------
//   1) O pacote candidato (saida do exportLegacy) passa nos SCHEMAS de
//      atual.json/contatos.json exigidos pelo visualizador (AJV + assercoes
//      estruturais que espelham tests/baseline/legacy-contract.test.js).
//   2) Os MODULOS REAIS do visualizador (repo-root src/*.js) carregam o
//      artefato candidato e exercitam tabela, cartoes, filtro, agenda,
//      contatos, cache offline e o caminho de vinculo de nome do login Google.
//   3) A suite NAO grava nem publica sobre o site vigente: o candidato e
//      materializado apenas em um diretorio temporario do SO e o fetch do
//      visualizador recebe uma COPIA em memoria desse artefato. Os arquivos
//      publicos vigentes (repo-root atual.json/contatos.json) tem seu hash
//      conferido antes e depois e permanecem identicos.
//
// NOTA SOBRE PLAYWRIGHT (16.9)
// ----------------------------
// O passo "abrir o artefato com Playwright" so e executavel em homologacao com
// o Playwright instalado. Como o Playwright NAO faz parte das dependencias
// deste workspace, o E2E de navegador fica como teste GUARDADO (skipIf): ele
// so roda quando `@playwright/test` resolve. Nesse meio tempo, os modulos reais
// do visualizador sao conduzidos IN-PROCESS sobre o DOM (jsdom), o que cobre os
// mesmos comportamentos observaveis (tabela/cartoes/filtro/agenda/contatos/
// cache/login) sem depender de um navegador. Isso mantem a validacao objetiva
// satisfeita e documenta explicitamente a lacuna do navegador.
//
// Requisitos: 9.1, 9.2, 9.3, 11.13, 16.1, 16.8, 16.9.

import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import type { ValidateFunction } from 'ajv';

import type {
  PublicAssignment,
  PublicContactDTO,
  PublicProjectionDTO,
  PublicServiceDTO,
} from '../projection/publicProjection';
import type { Weekday } from '../schemas/models';
import {
  ATUAL_KEYS,
  exportLegacy,
  legacyStringify,
  type LegacyContacts,
  type LegacyExportConfig,
  type LegacyScheduleRecord,
} from './legacyExporter';

// --------------------------------------------------------------------------
// Localizacao do repositorio e dos arquivos publicos vigentes (somente leitura)
// --------------------------------------------------------------------------

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
// desktop-app/src/domain/export -> repo root (quatro niveis acima de /domain/export).
const REPO_ROOT = resolve(__dirname, '../../../..');
const LIVE_ATUAL = resolve(REPO_ROOT, 'atual.json');
const LIVE_CONTATOS = resolve(REPO_ROOT, 'contatos.json');

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

// --------------------------------------------------------------------------
// Mapeamento funcao -> coluna legada (contrato de compatibilidade do exportador)
// --------------------------------------------------------------------------

const ROLE = {
  acomp: 'r-acomp',
  regente: 'r-regente',
  equipe: 'r-equipe',
  mensagem: 'r-mensagem',
  audiovisual: 'r-audiovisual',
  anciao: 'r-anciao',
  pregador: 'r-pregador',
  suporte: 'r-suporte',
} as const;

const CONFIG: LegacyExportConfig = {
  columns: {
    roleColumns: {
      [ROLE.acomp]: 'ACOMP',
      [ROLE.regente]: 'REGENTE LOUVOR',
      [ROLE.equipe]: 'EQUIPE LOUVOR',
      [ROLE.mensagem]: 'MENSAGEM MUSICAL',
      [ROLE.audiovisual]: 'AUDIOVISUAL',
      [ROLE.anciao]: 'ANCIÃO',
      [ROLE.pregador]: 'PREGADOR',
      [ROLE.suporte]: 'SUPORTE',
    },
    fieldColumns: {
      theme: 'TEMA CULTO',
      'sabbath-school-song': 'LOUVORES ES',
      'song-request': 'LOUVORES CULTO',
      observation: 'OBS',
    },
    listColumns: ['EQUIPE LOUVOR', 'MENSAGEM MUSICAL'],
    songColumns: ['LOUVORES ES', 'LOUVORES CULTO'],
  },
};

// --------------------------------------------------------------------------
// Builders do DTO publico candidato
// --------------------------------------------------------------------------

function assign(
  roleId: string,
  name: string,
  subjectType: PublicAssignment['subjectType'] = 'person',
): PublicAssignment {
  return { serviceId: 's', roleId, name, subjectType };
}

function svc(
  partial: Partial<PublicServiceDTO> & { serviceId: string; date: string; weekday: Weekday },
): PublicServiceDTO {
  return {
    serviceId: partial.serviceId,
    date: partial.date,
    weekday: partial.weekday,
    kind: partial.kind ?? 'regular',
    publicFields: partial.publicFields ?? {},
    publicInputs: partial.publicInputs ?? [],
    assignments: partial.assignments ?? [],
  };
}

function contact(
  subjectId: string,
  canonicalName: string,
  phoneE164?: string,
  aliases: string[] = [],
): PublicContactDTO {
  return phoneE164 === undefined
    ? { subjectId, canonicalName, aliases }
    : { subjectId, canonicalName, aliases, phoneE164 };
}

/**
 * DTO publico candidato que exercita todas as superficies do visualizador:
 * - tres cultos (quarta/sabado/domingo) com datas distintas para filtros/agenda;
 * - equipe multi-pessoa (lista por ", ") e musicas (lista por " | ");
 * - um culto no passado e dois no futuro relativo a 07/08/2026;
 * - FABRICIO como regente (vinculo de login Google) e membro de equipe/pregador;
 * - contatos com telefone autorizado e um alias publico.
 */
function candidateDto(): PublicProjectionDTO {
  return {
    period: '2026-08',
    services: [
      svc({
        serviceId: 's-05',
        date: '2026-08-05', // passado (antes de 07/08)
        weekday: 'wednesday',
        assignments: [
          assign(ROLE.acomp, 'PB'),
          assign(ROLE.anciao, 'MARCOS'),
          assign(ROLE.pregador, 'ROSANA'),
        ],
      }),
      svc({
        serviceId: 's-08',
        date: '2026-08-08', // futuro
        weekday: 'saturday',
        assignments: [
          assign(ROLE.acomp, 'BANDA'),
          assign(ROLE.regente, 'ANDRE'),
          assign(ROLE.equipe, 'LUIZ ANTONIO'),
          assign(ROLE.equipe, 'ARIADNY'),
          assign(ROLE.equipe, 'FABRICIO'),
          assign(ROLE.audiovisual, 'ALEX'),
          assign(ROLE.anciao, 'RICARDO'),
          assign(ROLE.pregador, 'MORDOMIA'),
        ],
        publicInputs: [{ type: 'theme', value: 'MORDOMIA' }],
      }),
      svc({
        serviceId: 's-09',
        date: '2026-08-09', // futuro
        weekday: 'sunday',
        assignments: [
          assign(ROLE.acomp, 'PB'),
          assign(ROLE.regente, 'FABRICIO'),
          assign(ROLE.equipe, 'MARIA HELOISA'),
          assign(ROLE.equipe, 'DANY KALLAS'),
          assign(ROLE.anciao, 'YASSER'),
          assign(ROLE.pregador, 'CONVIDADO'),
          assign(ROLE.suporte, 'ANISSA'),
        ],
        publicInputs: [
          { type: 'theme', value: 'A GRACA DE DEUS' },
          { type: 'song-request', value: ['128 - Cristo, minha seguranca', '15 - Grandioso es Tu'] },
          { type: 'observation', value: 'culto especial' },
        ],
      }),
    ],
    contacts: [
      contact('p-andre', 'ANDRE', '+5543920008370'),
      contact('p-alex', 'ALEX', '+554396849723'),
      contact('p-ariadny', 'ARIADNY', '+554396158329'),
      contact('p-dany', 'DANY KALLAS', '+554399990001', ['DANI']),
      contact('p-fabricio', 'FABRICIO', '+554399990002'),
      contact('p-luiz', 'LUIZ ANTONIO', '+554399990003'),
      contact('p-yasser', 'YASSER', '+554399990005'),
    ],
  };
}

/** Produz o pacote candidato ou falha o teste com os bloqueios encontrados. */
function produceCandidate(): {
  atual: readonly LegacyScheduleRecord[];
  contatos: LegacyContacts;
  atualJson: string;
  contatosJson: string;
} {
  const res = exportLegacy(candidateDto(), CONFIG);
  if (!res.ok) {
    throw new Error(
      `exportLegacy bloqueou a producao do pacote candidato: ${res.blocks
        .map((b) => `${b.code}@${b.reference}`)
        .join('; ')}`,
    );
  }
  return {
    atual: res.atual.value,
    contatos: res.contatos.value,
    atualJson: legacyStringify(res.atual.value),
    contatosJson: legacyStringify(res.contatos.value),
  };
}

// --------------------------------------------------------------------------
// Schemas do contrato do visualizador (AJV)
// --------------------------------------------------------------------------

const DATE_PATTERN = '^\\d{2}/\\d{2}/\\d{4}$';
const WA_PATTERN = '^https://wa\\.me/\\d{8,15}$';

// atual.json: array; cada registro tem EXATAMENTE as 14 chaves conhecidas, todas
// string; DATA em DD/MM/YYYY; DIA SEMANA nao vazio.
const ATUAL_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [...ATUAL_KEYS],
    properties: Object.fromEntries(
      ATUAL_KEYS.map((k) => {
        if (k === 'DATA') return [k, { type: 'string', pattern: DATE_PATTERN }];
        if (k === 'DIA SEMANA') return [k, { type: 'string', minLength: 1 }];
        return [k, { type: 'string' }];
      }),
    ),
  },
} as const;

// contatos.json: objeto indexado por nome; cada entrada { telefone: wa.me,
// apelidos: string[] }.
const CONTATOS_SCHEMA = {
  type: 'object',
  additionalProperties: {
    type: 'object',
    additionalProperties: false,
    required: ['telefone', 'apelidos'],
    properties: {
      telefone: { type: 'string', pattern: WA_PATTERN },
      apelidos: { type: 'array', items: { type: 'string' } },
    },
  },
} as const;

let validateAtual: ValidateFunction;
let validateContatos: ValidateFunction;

beforeAll(() => {
  const ajv = new Ajv({ allErrors: true, strict: false });
  validateAtual = ajv.compile(ATUAL_SCHEMA);
  validateContatos = ajv.compile(CONTATOS_SCHEMA);
});

// --------------------------------------------------------------------------
// 1) Contrato / schema do pacote candidato
// --------------------------------------------------------------------------

describe('9.8 — contrato do pacote candidato (atual.json/contatos.json)', () => {
  it('o atual.json candidato satisfaz o schema do visualizador', () => {
    const { atual } = produceCandidate();
    const ok = validateAtual(atual);
    if (!ok) {
      throw new Error('atual.json candidato violou o schema: ' + JSON.stringify(validateAtual.errors));
    }
    expect(ok).toBe(true);
  });

  it('o contatos.json candidato satisfaz o schema do visualizador', () => {
    const { contatos } = produceCandidate();
    const ok = validateContatos(contatos);
    if (!ok) {
      throw new Error(
        'contatos.json candidato violou o schema: ' + JSON.stringify(validateContatos.errors),
      );
    }
    expect(ok).toBe(true);
  });

  it('cada registro carrega exatamente as 14 chaves conhecidas, todas string', () => {
    const { atual } = produceCandidate();
    expect(atual.length).toBeGreaterThan(0);
    for (const rec of atual) {
      expect(Object.keys(rec).sort()).toEqual([...ATUAL_KEYS].sort());
      for (const key of ATUAL_KEYS) expect(typeof rec[key]).toBe('string');
    }
  });

  it('o pacote candidato e parseavel como JSON exatamente como o visualizador espera', () => {
    const { atualJson, contatosJson } = produceCandidate();
    const atualParsed = JSON.parse(atualJson);
    const contatosParsed = JSON.parse(contatosJson);
    expect(validateAtual(atualParsed)).toBe(true);
    expect(validateContatos(contatosParsed)).toBe(true);
    expect(Array.isArray(atualParsed)).toBe(true);
    expect(Array.isArray(contatosParsed)).toBe(false);
  });
});

// --------------------------------------------------------------------------
// 2) Compatibilidade E2E in-process: visualizador real sobre o candidato
// --------------------------------------------------------------------------

/** Diretorio temporario onde o candidato e materializado (NUNCA o site vigente). */
let tmpDir: string;
let candidateAtualPath: string;
let candidateContatosPath: string;
let liveAtualHashBefore: string | undefined;
let liveContatosHashBefore: string | undefined;

beforeAll(() => {
  const { atualJson, contatosJson } = produceCandidate();
  tmpDir = mkdtempSync(join(tmpdir(), 'escala-candidate-9-8-'));
  candidateAtualPath = join(tmpDir, 'atual.json');
  candidateContatosPath = join(tmpDir, 'contatos.json');
  writeFileSync(candidateAtualPath, atualJson, 'utf8');
  writeFileSync(candidateContatosPath, contatosJson, 'utf8');

  // Snapshot do site vigente (se existir) para provar que a suite nao o toca.
  liveAtualHashBefore = existsSync(LIVE_ATUAL) ? sha256File(LIVE_ATUAL) : undefined;
  liveContatosHashBefore = existsSync(LIVE_CONTATOS) ? sha256File(LIVE_CONTATOS) : undefined;
});

afterAll(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

// --- DOM/localStorage/fetch do visualizador ---------------------------------

function buildViewerDom(): void {
  document.body.innerHTML = `
    <table><tbody id="tableBody"></tbody></table>
    <div id="containerFuturo"></div>
    <div id="containerPassado" class="show"></div>
    <div id="pastDivider"></div>
    <div id="alertContainer"></div>
    <span id="offlineIndicator"></span>
    <input id="searchInput" value="" />
    <div id="filtros">
      <select data-col="DATA"><option>Todos</option></select>
      <select data-col="DIA SEMANA"><option>Todos</option></select>
      <select data-col="EQUIPE LOUVOR"><option>Todos</option></select>
    </div>`;
}

function installLocalStorage(): Record<string, string> {
  const store: Record<string, string> = {};
  const ls = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true });
  return store;
}

/** fetch que serve uma COPIA em memoria do artefato candidato do diretorio temp. */
function mockFetchFromCandidate(): void {
  const atual = JSON.parse(readFileSync(candidateAtualPath, 'utf8'));
  const contatos = JSON.parse(readFileSync(candidateContatosPath, 'utf8'));
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn((url: string) => {
    const u = String(url);
    if (u.includes('atual.json')) return Promise.resolve({ json: async () => atual });
    if (u.includes('contatos.json')) return Promise.resolve({ json: async () => contatos });
    return Promise.reject(new Error(`url inesperada no teste: ${u}`));
  });
}

// Modulos reais do visualizador (repo-root src/*.js), carregados in-process.
type ViewerModules = {
  state: { dadosGlobais: unknown[]; contatosMap: Record<string, unknown>; usuarioAtual: unknown };
  STORAGE_KEYS: { CACHE_DADOS: string; CACHE_CONTATOS: string } & Record<string, string>;
  carregarCSV: () => Promise<void>;
  aplicarFiltroAutomatico: () => void;
  aplicarFiltros: () => void;
  getDetalhesAgenda: (rec: Record<string, string>, nome: string) => { papel: string; descricao: string };
  buscarContato: (
    map: Record<string, { telefone: string; apelidos: string[] }>,
    nome: string,
  ) => { telefone: string; apelidos: string[] } | null;
  salvarVinculoPorSub: (sub: string, nome: string) => void;
  obterNomeVinculadoPorSub: (sub: string) => string;
};

let V: ViewerModules;
let lsStore: Record<string, string>;

beforeAll(async () => {
  // Os modulos do visualizador legado sao .js sem tipos (fora do tsconfig do
  // desktop-app). Importamos via helper que carrega em runtime e tipa como
  // `unknown`, sem gerar dependencia de tipos sobre o legado.
  const load = (rel: string): Promise<Record<string, unknown>> =>
    import(/* @vite-ignore */ rel) as Promise<Record<string, unknown>>;

  const state = await load('../../../../src/state.js');
  const config = await load('../../../../src/config.js');
  const loader = await load('../../../../src/data/loader.js');
  const filters = await load('../../../../src/ui/filters.js');
  const agenda = await load('../../../../src/business/agenda.js');
  const contactMod = await load('../../../../src/utils/contact.js');
  const authStorage = await load('../../../../src/auth/storage.js');
  V = {
    state: state.state as ViewerModules['state'],
    STORAGE_KEYS: config.STORAGE_KEYS as ViewerModules['STORAGE_KEYS'],
    carregarCSV: loader.carregarCSV as ViewerModules['carregarCSV'],
    aplicarFiltroAutomatico: filters.aplicarFiltroAutomatico as ViewerModules['aplicarFiltroAutomatico'],
    aplicarFiltros: filters.aplicarFiltros as ViewerModules['aplicarFiltros'],
    getDetalhesAgenda: agenda.getDetalhesAgenda as ViewerModules['getDetalhesAgenda'],
    buscarContato: contactMod.buscarContato as ViewerModules['buscarContato'],
    salvarVinculoPorSub: authStorage.salvarVinculoPorSub as ViewerModules['salvarVinculoPorSub'],
    obterNomeVinculadoPorSub:
      authStorage.obterNomeVinculadoPorSub as ViewerModules['obterNomeVinculadoPorSub'],
  };
});

beforeEach(() => {
  buildViewerDom();
  lsStore = installLocalStorage();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 7)); // 07/08/2026: 05/08 passado, 08-09/08 futuros
  // Reseta o estado global compartilhado do visualizador.
  V.state.dadosGlobais = [];
  V.state.contatosMap = {};
  V.state.usuarioAtual = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('9.8 — visualizador real carrega e opera o pacote candidato', () => {
  it('carrega atual.json/contatos.json candidatos e popula o estado + cache offline', async () => {
    mockFetchFromCandidate();
    await V.carregarCSV();

    expect(V.state.dadosGlobais).toHaveLength(3);
    expect(V.state.contatosMap).toHaveProperty('ANDRE');
    expect((document.getElementById('offlineIndicator') as HTMLElement).style.display).toBe('none');

    // Cache offline recebeu ambos os payloads candidatos.
    expect(JSON.parse(lsStore[V.STORAGE_KEYS.CACHE_DADOS]!)).toHaveLength(3);
    expect(JSON.parse(lsStore[V.STORAGE_KEYS.CACHE_CONTATOS]!).ALEX.telefone).toContain('wa.me');
  });

  it('fallback offline restaura o candidato do cache e sinaliza offline', async () => {
    const { atualJson, contatosJson } = produceCandidate();
    lsStore[V.STORAGE_KEYS.CACHE_DADOS] = atualJson;
    lsStore[V.STORAGE_KEYS.CACHE_CONTATOS] = contatosJson;
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(() => Promise.reject(new Error('offline')));

    await V.carregarCSV();
    expect(V.state.dadosGlobais).toHaveLength(3);
    expect((document.getElementById('offlineIndicator') as HTMLElement).style.display).toBe(
      'inline-block',
    );
  });

  it('renderiza a tabela e os cartoes (futuro/passado) a partir do candidato', async () => {
    mockFetchFromCandidate();
    await V.carregarCSV();
    V.aplicarFiltroAutomatico();

    const tbody = document.getElementById('tableBody')!;
    expect(tbody.children).toHaveLength(3);

    // 05/08 e passado; 08/08 e 09/08 sao futuros em relacao a 07/08/2026.
    expect(document.getElementById('containerPassado')!.children).toHaveLength(1);
    expect(document.getElementById('containerFuturo')!.children).toHaveLength(2);

    const html = Array.from(tbody.children)
      .map((r) => (r as HTMLElement).innerHTML)
      .join('');
    // Nome de contato vira link wa.me e tema aparece renderizado.
    expect(html).toContain('https://wa.me/5543920008370'); // ANDRE
    expect(html).toContain('A GRACA DE DEUS');
  });

  it('o filtro de DIA SEMANA restringe a tabela; EQUIPE LOUVOR casa por substring', async () => {
    mockFetchFromCandidate();
    await V.carregarCSV();
    V.aplicarFiltroAutomatico();

    const selects = Array.from(
      document.querySelectorAll('#filtros select'),
    ) as HTMLSelectElement[];
    const dia = selects.find((s) => s.dataset.col === 'DIA SEMANA')!;
    const diaVals = Array.from(dia.children).map((o) => (o as HTMLOptionElement).value);
    expect(diaVals).toEqual(expect.arrayContaining(['quarta-feira', 'sábado', 'domingo']));

    dia.value = 'domingo';
    V.aplicarFiltros();
    expect(document.getElementById('tableBody')!.children).toHaveLength(1);

    // Reabre tudo e filtra EQUIPE LOUVOR por substring do membro. O filtro do
    // visualizador casa por substring (includes), entao injetamos a opcao do
    // membro individual para exercitar exatamente esse comportamento.
    dia.value = '';
    const equipe = selects.find((s) => s.dataset.col === 'EQUIPE LOUVOR')!;
    const opt = document.createElement('option');
    opt.value = 'ARIADNY';
    opt.textContent = 'ARIADNY';
    equipe.appendChild(opt);
    equipe.value = 'ARIADNY';
    V.aplicarFiltros();
    expect(document.getElementById('tableBody')!.children).toHaveLength(1); // culto de 08/08
  });

  it('a busca por nome filtra os registros candidatos', async () => {
    mockFetchFromCandidate();
    await V.carregarCSV();
    V.aplicarFiltroAutomatico();

    (document.getElementById('searchInput') as HTMLInputElement).value = 'YASSER';
    V.aplicarFiltros();
    expect(document.getElementById('tableBody')!.children).toHaveLength(1); // anciao do 09/08
  });

  it('a agenda detecta papeis (regente, equipe) e inclui o tema do culto', async () => {
    mockFetchFromCandidate();
    await V.carregarCSV();

    const dados = V.state.dadosGlobais as Record<string, string>[];
    const rec09 = dados.find((r) => r['DATA'] === '09/08/2026')!;
    const detRegente = V.getDetalhesAgenda(rec09, 'FABRICIO');
    expect(detRegente.papel).toContain('REGÊNCIA NA CENTRAL');
    expect(detRegente.descricao).toContain('A GRACA DE DEUS');

    const rec08 = dados.find((r) => r['DATA'] === '08/08/2026')!;
    const detEquipe = V.getDetalhesAgenda(rec08, 'ARIADNY');
    expect(detEquipe.papel).toContain('CANTAR LOUVOR');

    const detGenerico = V.getDetalhesAgenda(rec08, 'NINGUEM');
    expect(detGenerico.papel).toBe('ESCALA NA CENTRAL');
  });

  it('a busca de contatos resolve por nome canonico e por alias (sem diacriticos)', async () => {
    mockFetchFromCandidate();
    await V.carregarCSV();
    const map = V.state.contatosMap as Record<string, { telefone: string; apelidos: string[] }>;

    expect(V.buscarContato(map, 'ALEX')!.telefone).toBe('https://wa.me/554396849723');
    expect(V.buscarContato(map, 'DANI')).toBe(map['DANY KALLAS']);
    expect(V.buscarContato(map, 'DESCONHECIDO')).toBeNull();
  });

  it('o vinculo de nome do login Google destaca o usuario e emite o alerta de 7 dias', async () => {
    mockFetchFromCandidate();
    await V.carregarCSV();

    // O vinculo sub->nome persiste (caminho do login Google).
    V.salvarVinculoPorSub('google-sub-1', 'FABRICIO');
    expect(V.obterNomeVinculadoPorSub('google-sub-1')).toBe('FABRICIO');

    V.state.usuarioAtual = { nomeVinculado: 'FABRICIO', sub: 'google-sub-1' };
    V.aplicarFiltroAutomatico();

    const html = Array.from(document.getElementById('tableBody')!.children)
      .map((r) => (r as HTMLElement).innerHTML)
      .join('');
    expect(html).toContain('highlight-me');
    // FABRICIO esta escalado em 08/08 (dentro de 7 dias de 07/08) -> banner.
    expect(document.getElementById('alertContainer')!.children.length).toBeGreaterThan(0);
  });
});

// --------------------------------------------------------------------------
// 3) Seguranca da suite: nunca grava/publica sobre o site vigente
// --------------------------------------------------------------------------

describe('9.8 — a suite nao grava nem publica sobre o site vigente', () => {
  it('o artefato candidato e materializado apenas em diretorio temporario do SO', () => {
    expect(tmpDir.startsWith(tmpdir())).toBe(true);
    expect(candidateAtualPath.startsWith(tmpdir())).toBe(true);
    expect(candidateContatosPath.startsWith(tmpdir())).toBe(true);
    // O caminho do candidato NUNCA e o do site vigente.
    expect(resolve(candidateAtualPath)).not.toBe(resolve(LIVE_ATUAL));
    expect(resolve(candidateContatosPath)).not.toBe(resolve(LIVE_CONTATOS));
  });

  it('os arquivos publicos vigentes permanecem com o mesmo hash (intocados)', () => {
    if (liveAtualHashBefore !== undefined) {
      expect(sha256File(LIVE_ATUAL)).toBe(liveAtualHashBefore);
    }
    if (liveContatosHashBefore !== undefined) {
      expect(sha256File(LIVE_CONTATOS)).toBe(liveContatosHashBefore);
    }
  });
});

// --------------------------------------------------------------------------
// 4) E2E de navegador com Playwright (GUARDADO): so roda em homologacao
// --------------------------------------------------------------------------

/**
 * Detecta de forma sincrona se o Playwright esta disponivel no ambiente. Sem
 * ele, o E2E de navegador e PULADO (nao falha): os mesmos comportamentos ja
 * foram validados in-process acima sobre os modulos reais do visualizador.
 */
function playwrightAvailable(): boolean {
  try {
    // require resolve evita importar/instanciar o pacote quando ausente.
    const req = (globalThis as unknown as { require?: (id: string) => unknown }).require;
    if (typeof req === 'function') {
      req('@playwright/test');
      return true;
    }
  } catch {
    /* ausente */
  }
  // Fallback: variavel de ambiente de homologacao pode forcar a tentativa.
  return process.env.ESCALA_E2E_PLAYWRIGHT === '1';
}

const HAS_PLAYWRIGHT = playwrightAvailable();

describe.skipIf(!HAS_PLAYWRIGHT)(
  '9.8 — E2E de navegador do visualizador com Playwright (homologacao)',
  () => {
    it('abre index.html servindo o pacote candidato e exercita a UI real no navegador', async () => {
      // Este bloco so executa quando o Playwright esta instalado (homologacao).
      // Ele deve: (1) subir um servidor estatico do repo-root servindo uma COPIA
      // do index.html e dos modulos src/*.js, mas com atual.json/contatos.json
      // apontando para o PACOTE CANDIDATO (diretorio temporario), nunca o site
      // vigente; (2) navegar, aguardar a tabela, exercitar filtro/cartoes/agenda/
      // contatos/cache/login; (3) assertar os estados observaveis.
      // Especificador em variavel + @vite-ignore: impede o Vite de tentar
      // resolver estaticamente o Playwright (ausente fora de homologacao).
      const playwrightSpecifier = '@playwright/test';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw: any = await import(/* @vite-ignore */ playwrightSpecifier);
      const { chromium } = pw;
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        // O tipo do Playwright nao esta disponivel (pacote ausente fora de
        // homologacao); tipamos o route de forma minima e explicita.
        type PwRoute = { fulfill: (opts: { path: string; contentType: string }) => Promise<void> };
        await page.route('**/atual.json*', (route: PwRoute) =>
          route.fulfill({ path: candidateAtualPath, contentType: 'application/json' }),
        );
        await page.route('**/contatos.json*', (route: PwRoute) =>
          route.fulfill({ path: candidateContatosPath, contentType: 'application/json' }),
        );
        await page.goto(`file://${join(REPO_ROOT, 'index.html')}`);
        await page.waitForSelector('#tableBody tr');
        const rows = await page.locator('#tableBody tr').count();
        expect(rows).toBe(3);
      } finally {
        await browser.close();
      }
    });
  },
);

// Documenta explicitamente a lacuna quando o Playwright esta ausente.
describe('9.8 — nota sobre o E2E de navegador', () => {
  it.runIf(!HAS_PLAYWRIGHT)(
    'Playwright ausente: o E2E de navegador fica guardado e a compatibilidade e provada in-process',
    () => {
      expect(HAS_PLAYWRIGHT).toBe(false);
    },
  );
});
