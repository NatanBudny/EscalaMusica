#!/usr/bin/env node

import { gerarControleRegentes, imprimirResumo } from './controle-rotacao-utils.js';

const mesArg = process.argv.find((a) => a.startsWith('--mes='));
const mes = mesArg ? mesArg.slice('--mes='.length) : '';

const { saida, ranking } = gerarControleRegentes(mes);

console.log(`Controle de Regentes atualizado em: ${saida}`);
imprimirResumo('', ranking, ['REGENCIAS', 'TOTAL']);
