#!/usr/bin/env node

import { gerarControleMensagemMusical, imprimirResumo } from './controle-rotacao-utils.js';

const mesArg = process.argv.find((a) => a.startsWith('--mes='));
const mes = mesArg ? mesArg.slice('--mes='.length) : '';

const { saida, ranking } = gerarControleMensagemMusical(mes);

console.log(`Controle de Mensagem Musical atualizado em: ${saida}`);
imprimirResumo('', ranking, ['ES', 'CULTO', 'DOMINGO', 'TOTAL']);
