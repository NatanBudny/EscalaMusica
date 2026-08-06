#!/usr/bin/env node

import { gerarControleEquipeLouvor, imprimirResumo } from './controle-rotacao-utils.js';

const { saida, ranking } = gerarControleEquipeLouvor();

console.log(`Controle de Equipe de Louvor atualizado em: ${saida}`);
imprimirResumo('', ranking, ['ESCALAS_EQUIPE', 'TOTAL']);