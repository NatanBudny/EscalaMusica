// Suite de seguranca e privacidade (tarefas 15.1, 15.2, 15.3).
//
// Validacao objetiva: path traversal, symlink/abs, host divergente, zip bomb e
// colagem com formula/HTML falham sem mutacao; o scanner detecta tokens, URLs
// autenticadas, telefones e notas privadas sem ecoar o valor.
//
// Requisitos: 1.7, 7.20, 9.5-9.7, 10.4, 11.2, 11.3, 11.5, 11.7, 11.11, 12.11.

import { describe, it, expect } from 'vitest';
import {
  INPUT_LIMITS,
  guardZipEntries,
  isApprovedRedirect,
  isApprovedUrl,
  isSafeRelativePath,
  sanitizeOutput,
  sanitizePastedCell,
  scanForSecrets,
} from './hardening';

describe('15.1 — allowlist de caminhos', () => {
  it('aceita caminho relativo seguro e rejeita travessia/absoluto/vazio', () => {
    expect(isSafeRelativePath('registry/people.json')).toBe(true);
    expect(isSafeRelativePath('../../etc/passwd')).toBe(false);
    expect(isSafeRelativePath('/etc/hosts')).toBe(false);
    expect(isSafeRelativePath('C:\\win')).toBe(false);
    expect(isSafeRelativePath('')).toBe(false);
    expect(isSafeRelativePath('a//b')).toBe(false);
  });
});

describe('15.1 — allowlist de URL e redirect', () => {
  const hosts = ['igreja.github.io'];
  it('aceita HTTPS no host aprovado e rejeita o resto', () => {
    expect(isApprovedUrl('https://igreja.github.io/atual.json', hosts)).toBe(true);
    expect(isApprovedUrl('http://igreja.github.io/x', hosts)).toBe(false);
    expect(isApprovedUrl('https://atacante.example/x', hosts)).toBe(false);
  });

  it('bloqueia redirect para host diferente', () => {
    expect(isApprovedRedirect('https://igreja.github.io/a', 'https://igreja.github.io/b', hosts)).toBe(true);
    expect(isApprovedRedirect('https://igreja.github.io/a', 'https://atacante.example/b', hosts)).toBe(false);
  });
});

describe('15.1 — guarda de ZIP (anti bomba e travessia)', () => {
  it('rejeita excesso de entradas, tamanho total e caminhos inseguros', () => {
    const many = Array.from({ length: INPUT_LIMITS.maxZipEntries + 1 }, (_, i) => ({ path: `f${i}.json`, bytes: 1 }));
    expect(guardZipEntries(many).some((i) => i.kind === 'too-many-entries')).toBe(true);

    const big = [{ path: 'a.json', bytes: INPUT_LIMITS.maxZipTotalBytes + 1 }];
    expect(guardZipEntries(big).some((i) => i.kind === 'total-too-large')).toBe(true);

    const unsafe = [{ path: '../x', bytes: 1 }];
    expect(guardZipEntries(unsafe).some((i) => i.kind === 'unsafe-path')).toBe(true);
  });

  it('aceita um conjunto seguro', () => {
    expect(guardZipEntries([{ path: 'ok.json', bytes: 10 }])).toEqual([]);
  });
});

describe('15.1 — colagem sem formula/HTML', () => {
  it('neutraliza prefixo de formula e remove HTML', () => {
    expect(sanitizePastedCell('=SOMA(A1:A2)')).toBe("'=SOMA(A1:A2)");
    expect(sanitizePastedCell('+1')).toBe("'+1");
    expect(sanitizePastedCell('<b>Ana</b>')).toBe('Ana');
    expect(sanitizePastedCell('Ana')).toBe('Ana');
  });
});

describe('15.2 — scanner de segredos e campos privados', () => {
  it('detecta token de valor sem ecoar o valor', () => {
    const r = scanForSecrets({ config: { url: 'https://x-access-token:ghp_ABCDEFGHIJKLMNOPQRST1234@github.com/o/r.git' } });
    expect(r.clean).toBe(false);
    expect(r.findings.some((f) => f.kind === 'secret-value')).toBe(true);
    // O achado nunca inclui o valor.
    expect(JSON.stringify(r.findings).includes('ghp_ABCDEFGHIJKLMNOPQRST1234')).toBe(false);
  });

  it('detecta nome de campo de segredo', () => {
    const r = scanForSecrets({ auth: { token: 'qualquer' } });
    expect(r.findings.some((f) => f.kind === 'secret-field' && f.path === 'auth.token')).toBe(true);
  });

  it('detecta campo privado proibido numa saida publica', () => {
    const r = scanForSecrets({ person: { canonicalName: 'Ana', administrativeNotes: 'interno' } }, { forbiddenPrivateFields: ['administrativeNotes'] });
    expect(r.findings.some((f) => f.kind === 'private-field')).toBe(true);
  });

  it('considera limpo um objeto publico sem segredos', () => {
    const r = scanForSecrets({ atual: [{ DATA: '01/02/2026', TEMA: 'Fe' }] });
    expect(r.clean).toBe(true);
  });

  it('sanitizeOutput redige segredos conhecidos antes de emitir', () => {
    const out = sanitizeOutput({ log: 'usou ghp_SECRET123 agora' }, { values: ['ghp_SECRET123'] }) as { log: string };
    expect(out.log.includes('ghp_SECRET123')).toBe(false);
  });
});
