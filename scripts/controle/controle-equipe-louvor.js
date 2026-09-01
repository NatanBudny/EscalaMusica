#!/usr/bin/env node

import { gerarControleEquipeLouvor, imprimirResumo } from './controle-rotacao-utils.js';

const mesArg = process.argv.find((a) => a.startsWith('--mes='));
const mes = mesArg ? mesArg.slice('--mes='.length) : '';

const { saida, ranking } = gerarControleEquipeLouvor(mes);

console.log(`Controle de Equipe de Louvor atualizado em: ${saida}`);
imprimirResumo('', ranking, ['ESCALAS_EQUIPE', 'TOTAL']);
