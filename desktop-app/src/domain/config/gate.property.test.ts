import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  createDefaultOperationalConfig,
  evaluateCutoverGate,
  isConfigValid,
  isHomologationValid,
  type HomologationRecord,
  type OperationalConfig,
} from './index';

// Feature: gestao-leiga-de-escalas, gate de transicao: o corte e permitido
// se e somente se a configuracao operacional e valida E existe um registro de
// homologacao valido. Caso contrario, o corte permanece bloqueado e informa
// que o fluxo atual continua oficial (requisitos 16.7, 16.8, 16.11, 16.12).

// Gerador de registros de homologacao com valores mistos (validos e invalidos).
// Os campos opcionais usam string vazia ou preenchida (em vez de undefined)
// para respeitar exactOptionalPropertyTypes; a validacao trata string vazia
// como ausente.
const homologationArb: fc.Arbitrary<HomologationRecord> = fc.record({
  confirmed: fc.boolean(),
  rejectedCount: fc.nat({ max: 5 }),
  pendingCount: fc.nat({ max: 5 }),
  divergenceCount: fc.nat({ max: 5 }),
  restoreVerified: fc.boolean(),
  transitionBackupId: fc.oneof(fc.constant(''), fc.string({ minLength: 1 })),
  approvedBy: fc.oneof(fc.constant(''), fc.string({ minLength: 1 })),
  approvedAt: fc.oneof(fc.constant(''), fc.string({ minLength: 1 })),
});

// Gerador de configuracoes: a base pode ser valida ou corrompida em um campo,
// com homologacao ausente ou gerada.
const configArb: fc.Arbitrary<OperationalConfig | undefined> = fc.oneof(
  // Configuracao ausente.
  fc.constant<OperationalConfig | undefined>(undefined),
  // Configuracao derivada do default, opcionalmente corrompida e/ou com
  // homologacao gerada.
  fc
    .record({
      corruptProfiles: fc.boolean(),
      withHomologation: fc.boolean(),
      homologation: homologationArb,
    })
    .map(({ corruptProfiles, withHomologation, homologation }) => {
      const overrides: Partial<OperationalConfig> = {
        ...(corruptProfiles ? { authorizedPublishProfiles: [] } : {}),
        ...(withHomologation ? { homologation } : {}),
      };
      return createDefaultOperationalConfig(overrides);
    }),
);

describe('Propriedade do feature gate de transicao', () => {
  it('permite o corte se e somente se config e homologacao sao validas', () => {
    fc.assert(
      fc.property(configArb, (config) => {
        const result = evaluateCutoverGate(config);
        const expected = isConfigValid(config) && isHomologationValid(config?.homologation);

        expect(result.allowed).toBe(expected);

        if (result.allowed) {
          // Quando permitido, nenhum motivo e nenhuma mensagem de oficial.
          expect(result.reasons).toEqual([]);
          expect(result.currentFlowOfficialMessage).toBeUndefined();
        } else {
          // Quando bloqueado, ha ao menos um motivo e a mensagem em portugues
          // de que o fluxo atual continua oficial.
          expect(result.reasons.length).toBeGreaterThan(0);
          expect(typeof result.currentFlowOfficialMessage).toBe('string');
        }
      }),
      { numRuns: 200 },
    );
  });

  it('o corte nunca e permitido sem homologacao (publicacao real desabilitada por padrao)', () => {
    fc.assert(
      fc.property(fc.boolean(), (corruptProfiles) => {
        const config = createDefaultOperationalConfig(
          corruptProfiles ? { authorizedPublishProfiles: [] } : {},
        );
        // Sem homologacao, independentemente de a config ser valida ou nao.
        expect(evaluateCutoverGate(config).allowed).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
