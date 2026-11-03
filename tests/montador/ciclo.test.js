// Testes de iniciar/retomar o mês (Task 14): calendarioBase e abrirMes.

import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { calendarioBase, abrirMes } from '../../montador/lib/ciclo.mjs';

function diasDoMes(mes) {
  const [ano, mm] = mes.split('-').map(Number);
  return new Date(ano, mm, 0).getDate();
}

/** Conjuntos reais de quartas/sábados/domingos do mês via Date. */
function esperadoPorDow(mes) {
  const [ano, mm] = mes.split('-').map(Number);
  const quartas = [];
  const sabados = [];
  const domingos = [];
  for (let d = 1; d <= diasDoMes(mes); d += 1) {
    const dow = new Date(ano, mm - 1, d).getDay();
    const iso = `${mes}-${String(d).padStart(2, '0')}`;
    if (dow === 3) quartas.push(iso);
    else if (dow === 6) sabados.push(iso);
    else if (dow === 0) domingos.push(iso);
  }
  return { quartas, sabados, domingos };
}

describe('Task 14: calendarioBase', () => {
  // Meses com 28, 29, 30 e 31 dias.
  const meses = ['2026-02', '2024-02', '2026-04', '2026-07'];

  for (const mes of meses) {
    test(`contém exatamente as quartas, sábados e domingos de ${mes}`, () => {
      const itens = calendarioBase(mes);
      const { quartas, sabados, domingos } = esperadoPorDow(mes);

      const datasQuartas = itens.filter((i) => i.dia === 'quarta-feira').map((i) => i.data);
      const datasSabados = itens.filter((i) => i.dia === 'sabado').map((i) => i.data);
      const datasDomingos = itens.filter((i) => i.dia === 'domingo').map((i) => i.data);

      expect(datasQuartas).toEqual(quartas);
      expect(datasSabados).toEqual(sabados);
      expect(datasDomingos).toEqual(domingos);

      // Nenhum outro dia da semana entra.
      expect(itens.length).toBe(quartas.length + sabados.length + domingos.length);

      // Ordenação por data.
      const ordenado = [...itens].sort((a, b) => a.data.localeCompare(b.data));
      expect(itens.map((i) => i.data)).toEqual(ordenado.map((i) => i.data));

      // modelo_louvor por dia.
      for (const i of itens) {
        if (i.dia === 'sabado') expect(i.modelo_louvor).toBe('sabado');
        else if (i.dia === 'domingo') expect(i.modelo_louvor).toBe('domingo');
        else expect(i.modelo_louvor).toBe('sem_louvor');
        expect(i.extraordinario).toBe(false);
      }
    });
  }

  test('rejeita mês inválido', () => {
    expect(() => calendarioBase('2026/07')).toThrow();
  });
});

describe('Task 14: abrirMes', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(resolve(tmpdir(), 'escala-ciclo-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('cria a estrutura e o acionato com calendário completo', () => {
    const r = abrirMes('2026-10', { root: dir });
    expect(r.iniciadoAgora).toBe(true);
    expect(existsSync(resolve(dir, 'escalas/2026/10/insumos'))).toBe(true);
    expect(existsSync(resolve(dir, 'escalas/2026/10/arquivo'))).toBe(true);

    const acionatoPath = resolve(dir, 'escalas/2026/10/insumos/acionato.json');
    expect(existsSync(acionatoPath)).toBe(true);
    const acionato = JSON.parse(readFileSync(acionatoPath, 'utf8'));
    expect(acionato.itens).toEqual(calendarioBase('2026-10'));

    expect(r.arquivos).toEqual(['escalas/2026/10/insumos/acionato.json']);
    expect(r.insumos).toEqual({
      acionato: 'preenchido',
      sonoplastia: 'pendente',
      enquete: 'pendente',
    });
    expect(r.publicado).toBe(false);
  });

  test('mês já iniciado não é sobrescrito', () => {
    const insumosDir = resolve(dir, 'escalas/2026/11/insumos');
    mkdirSync(insumosDir, { recursive: true });
    const acionatoPath = resolve(insumosDir, 'acionato.json');
    const original = { mes: '2026-11', itens: [{ data: '2026-11-07', dia: 'sabado' }] };
    writeFileSync(acionatoPath, `${JSON.stringify(original, null, 2)}\n`, 'utf8');

    const r = abrirMes('2026-11', { root: dir });
    expect(r.iniciadoAgora).toBe(false);
    expect(r.arquivos).toEqual([]);
    expect(JSON.parse(readFileSync(acionatoPath, 'utf8'))).toEqual(original);
    expect(r.insumos.acionato).toBe('preenchido');
  });

  test('detecta insumos existentes e mês publicado', () => {
    const insumosDir = resolve(dir, 'escalas/2026/12/insumos');
    mkdirSync(insumosDir, { recursive: true });
    writeFileSync(resolve(insumosDir, 'sonoplastia.json'), '{}\n', 'utf8');
    writeFileSync(
      resolve(insumosDir, 'indisponibilidade-cantores.json'),
      '{}\n',
      'utf8',
    );
    writeFileSync(
      resolve(dir, 'atual.json'),
      `${JSON.stringify([{ DATA: '2026-12-05' }])}\n`,
      'utf8',
    );

    const r = abrirMes('2026-12', { root: dir });
    expect(r.insumos.sonoplastia).toBe('preenchido');
    expect(r.insumos.enquete).toBe('preenchido');
    expect(r.publicado).toBe(true);
  });
});
