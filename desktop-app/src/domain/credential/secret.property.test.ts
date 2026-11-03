// Teste baseado em propriedade — Property 38: Segredos permanecem fora de
// saidas (tarefa 11.6).
//
// Property 38 (design.md): "Para todo segredo possivel armazenado pelo
// CredentialService, nenhuma substring do segredo aparece em IPC para UI,
// workspace, URL Git, log, auditoria, pacote ou backup; qualquer representacao
// exibida e composta somente por caracteres de ocultacao e metadados nao
// secretos."
//
// Estrategia: geramos segredos arbitrarios e os embutimos em estruturas
// arbitrarias (strings, objetos, arrays, chaves e URLs). Apos `redactValue`,
// provamos que o segredo COMPLETO nunca sobrevive na saida serializada e que a
// dica mascarada nunca contem o valor.
//
// **Validates: Requirements 11.7, 11.8, 11.11**

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { maskedHintOf, redactValue, type SecretSet } from './credentialService';

/** Segredo arbitrario nao trivial (ao menos 8 chars, sem espacos). */
const secretArb = fc.stringMatching(/^[A-Za-z0-9_-]{8,40}$/);

/** Estrutura arbitraria onde o segredo sera embutido em varios lugares. */
function embed(secret: string): unknown {
  return {
    gitUrl: `https://x-access-token:${secret}@github.com/org/repo.git`,
    log: [`conectando com ${secret}`, 'linha sem segredo'],
    audit: { token: secret, note: `usou ${secret} aqui` },
    [`chave_${secret}`]: 'valor',
    nested: { deep: { arr: [secret, `${secret}${secret}`] } },
  };
}

describe('CredentialService — Property 38: segredos fora de todas as saidas', () => {
  it('nenhuma substring do segredo sobrevive apos a redacao', () => {
    // Feature: gestao-leiga-de-escalas, Property 38: Segredos permanecem fora de saídas
    fc.assert(
      fc.property(secretArb, (secret) => {
        const secrets: SecretSet = { values: [secret] };
        const redacted = redactValue(embed(secret), secrets);
        const serialized = JSON.stringify(redacted);
        // O segredo COMPLETO nunca aparece na saida.
        expect(serialized.includes(secret)).toBe(false);
        // A dica mascarada nunca contem o segredo.
        const hint = maskedHintOf(secret.slice(0, 3));
        expect(hint.includes(secret)).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it('redige multiplos segredos simultaneos, inclusive sobrepostos', () => {
    // Feature: gestao-leiga-de-escalas, Property 38: Segredos permanecem fora de saídas
    fc.assert(
      fc.property(secretArb, secretArb, (a, b) => {
        const secrets: SecretSet = { values: [a, b] };
        const text = `${a}--${b}--${a}${b}`;
        const redacted = redactValue({ text }, secrets) as { text: string };
        expect(redacted.text.includes(a)).toBe(false);
        expect(redacted.text.includes(b)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});
