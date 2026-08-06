#!/usr/bin/env node

import { gerarControleMensagemMusical, imprimirResumo } from './controle-rotacao-utils.js';

const { saida, ranking } = gerarControleMensagemMusical();

console.log(`Controle de Mensagem Musical atualizado em: ${saida}`);
imprimirResumo('', ranking, ['ES', 'CULTO', 'DOMINGO', 'TOTAL']);
