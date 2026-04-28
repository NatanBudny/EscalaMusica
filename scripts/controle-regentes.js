#!/usr/bin/env node

import { gerarControleRegentes, imprimirResumo } from './controle-rotacao-utils.js';

const { saida, ranking } = gerarControleRegentes();

console.log(`Controle de Regentes atualizado em: ${saida}`);
imprimirResumo('', ranking, ['REGENCIAS', 'TOTAL']);