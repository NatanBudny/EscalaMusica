// Testes unitarios do CredentialService (tarefa 11.3).
//
// Requisitos: 10.18-10.20, 11.6-11.12.

import { describe, it, expect } from 'vitest';
import {
  REDACTION_MASK,
  containsSecret,
  gateSensitiveOperation,
  isUsable,
  maskedHintOf,
  redactText,
  redactValue,
  type CredentialPublicState,
  type SecretSet,
} from './credentialService';

const NOW = '2026-02-20T10:00:00Z';
const SECRETS: SecretSet = { values: ['ghp_SECRETTOKEN123', 'refresh_ABCDEF'] };

describe('estado publico e usabilidade (10.19, 10.20)', () => {
  it('credencial ativa e nao expirada e utilizavel', () => {
    const s: CredentialPublicState = { status: 'active', authorizedRepositories: ['org/repo'], expiresAt: '2027-01-01T00:00:00Z' };
    expect(isUsable(s, NOW)).toBe(true);
  });

  it('credencial expirada nao e utilizavel', () => {
    const s: CredentialPublicState = { status: 'active', authorizedRepositories: [], expiresAt: '2020-01-01T00:00:00Z' };
    expect(isUsable(s, NOW)).toBe(false);
  });
});

describe('gate de operacao sensivel (11.9, 11.10)', () => {
  it('bloqueia quando ausente/revogada/expirada e preserva trabalho', () => {
    expect(gateSensitiveOperation({ status: 'absent', authorizedRepositories: [] }, NOW).ok).toBe(false);
    expect(gateSensitiveOperation({ status: 'revoked', authorizedRepositories: [] }, NOW).ok).toBe(false);
    const exp = gateSensitiveOperation({ status: 'active', authorizedRepositories: [], expiresAt: '2000-01-01T00:00:00Z' }, NOW);
    expect(exp.ok).toBe(false);
    if (!exp.ok) expect(exp.reason).toBe('expired');
  });

  it('permite quando ativa e vigente', () => {
    const r = gateSensitiveOperation({ status: 'active', authorizedRepositories: ['org/repo'], expiresAt: '2030-01-01T00:00:00Z' }, NOW);
    expect(r.ok).toBe(true);
  });
});

describe('redator central (Property 38 / 11.7, 11.8, 11.11)', () => {
  it('redige o token em texto puro', () => {
    const text = `url=https://x-access-token:ghp_SECRETTOKEN123@github.com/org/repo.git`;
    const red = redactText(text, SECRETS);
    expect(red.includes('ghp_SECRETTOKEN123')).toBe(false);
    expect(red.includes(REDACTION_MASK)).toBe(true);
  });

  it('redige recursivamente em objetos e arrays, inclusive em chaves', () => {
    const value = {
      log: ['linha com ghp_SECRETTOKEN123 embutido'],
      nested: { ghp_SECRETTOKEN123: 'valor', ok: 'refresh_ABCDEF' },
    };
    const red = redactValue(value, SECRETS) as Record<string, unknown>;
    const serialized = JSON.stringify(red);
    expect(serialized.includes('ghp_SECRETTOKEN123')).toBe(false);
    expect(serialized.includes('refresh_ABCDEF')).toBe(false);
  });

  it('containsSecret identifica vazamentos', () => {
    expect(containsSecret('nada aqui', SECRETS)).toEqual([]);
    expect(containsSecret('vazou ghp_SECRETTOKEN123', SECRETS)).toContain('ghp_SECRETTOKEN123');
  });

  it('maskedHint nunca revela o segredo', () => {
    const hint = maskedHintOf('ghp');
    expect(hint).toBe('ghp_****');
    expect(hint.includes('SECRET')).toBe(false);
  });
});
