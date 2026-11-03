// Testes unitarios do BackupService (tarefa 11.2).
//
// Validacao objetiva: byte alterado, arquivo ausente/extra e versao futura sao
// rejeitados; round-trip restaura as categorias e metadados exatos; retencao
// preserva publicacoes oficiais.
//
// Requisitos: 13.1-13.12, 16.6, 16.10.

import { describe, it, expect } from 'vitest';
import type { RetentionPolicy } from '../config/model';
import {
  BACKUP_FORMAT_VERSION,
  applyRetention,
  createBackup,
  exportBackup,
  importBackup,
  inspectBeforeRestore,
  restoreBackup,
  verifyIntegrity,
  type BackupFile,
  type BackupPackage,
} from './backupService';

const FILES: BackupFile[] = [
  { path: 'registry/people.json', content: '[{"id":"p1","name":"Ana"}]' },
  { path: 'rules/ruleset.json', content: '{"version":"v1"}' },
];

function pkg(official = false): BackupPackage {
  return createBackup({
    id: 'bk-1',
    period: '2026-02',
    sourceVersion: 'v1',
    createdAt: '2026-02-20T10:00:00Z',
    operatorId: 'op-1',
    categories: ['registry', 'rules'],
    officialPublication: official,
    files: FILES,
  });
}

describe('createBackup + verifyIntegrity (13.1-13.4)', () => {
  it('cria manifesto com checksums e verifica integro', () => {
    const p = pkg();
    expect(p.manifest.formatVersion).toBe(BACKUP_FORMAT_VERSION);
    expect(p.manifest.files).toHaveLength(2);
    expect(p.manifest.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyIntegrity(p).ok).toBe(true);
  });

  it('detecta alteracao de byte em um arquivo coberto', () => {
    const p = pkg();
    const tampered: BackupPackage = {
      ...p,
      files: p.files.map((f) =>
        f.path === 'rules/ruleset.json' ? { ...f, content: '{"version":"v2"}' } : f,
      ),
    };
    const r = verifyIntegrity(tampered);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.some((i) => i.kind === 'content-mismatch' && i.path === 'rules/ruleset.json')).toBe(true);
  });

  it('detecta arquivo ausente', () => {
    const p = pkg();
    const missing: BackupPackage = { ...p, files: p.files.filter((f) => f.path !== 'rules/ruleset.json') };
    const r = verifyIntegrity(missing);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.some((i) => i.kind === 'missing-file')).toBe(true);
  });

  it('detecta arquivo extra fora do manifesto', () => {
    const p = pkg();
    const extra: BackupPackage = { ...p, files: [...p.files, { path: 'x/secret.json', content: '{}' }] };
    const r = verifyIntegrity(extra);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.some((i) => i.kind === 'extra-file')).toBe(true);
  });

  it('detecta adulteracao do proprio manifesto', () => {
    const p = pkg();
    const bad: BackupPackage = {
      ...p,
      manifest: { ...p.manifest, period: '2099-12' },
    };
    const r = verifyIntegrity(bad);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.some((i) => i.kind === 'manifest-mismatch')).toBe(true);
  });
});

describe('inspectBeforeRestore (13.8/16.6)', () => {
  it('rejeita caminho com travessia', () => {
    const p = createBackup({
      id: 'bk', period: '2026-02', sourceVersion: 'v1', createdAt: '2026-02-20T10:00:00Z',
      operatorId: 'op', categories: ['x'], officialPublication: false,
      files: [{ path: '../../etc/passwd', content: 'x' }],
    });
    const r = inspectBeforeRestore(p);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.some((i) => i.kind === 'path-traversal')).toBe(true);
  });

  it('rejeita caminho absoluto', () => {
    const p = createBackup({
      id: 'bk', period: '2026-02', sourceVersion: 'v1', createdAt: '2026-02-20T10:00:00Z',
      operatorId: 'op', categories: ['x'], officialPublication: false,
      files: [{ path: '/etc/hosts', content: 'x' }],
    });
    const r = inspectBeforeRestore(p);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.some((i) => i.kind === 'absolute-path')).toBe(true);
  });

  it('rejeita versao de formato desconhecida', () => {
    const p = pkg();
    const future: BackupPackage = { ...p, manifest: { ...p.manifest, formatVersion: '9' } };
    const r = inspectBeforeRestore(future);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.some((i) => i.kind === 'unknown-format-version')).toBe(true);
  });

  it('rejeita pacote acima do limite de tamanho (anti zip bomb)', () => {
    const p = pkg();
    const r = inspectBeforeRestore(p, 5); // limite minusculo
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.some((i) => i.kind === 'size-limit')).toBe(true);
  });
});

describe('round-trip: export -> import -> restore (13.5, 13.6, 13.11)', () => {
  it('reconstroi categorias, valores e metadados de origem', () => {
    const p = pkg(true);
    const text = exportBackup(p);
    const reimported = importBackup(text);
    const r = restoreBackup(reimported);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest.id).toBe('bk-1');
    expect(r.manifest.period).toBe('2026-02');
    expect(r.manifest.sourceVersion).toBe('v1');
    expect(r.manifest.officialPublication).toBe(true);
    // Conteudo restaurado (ordenado por path) identico ao original.
    const byPath = Object.fromEntries(r.files.map((f) => [f.path, f.content]));
    expect(byPath['registry/people.json']).toBe(FILES[0]!.content);
    expect(byPath['rules/ruleset.json']).toBe(FILES[1]!.content);
  });
});

describe('applyRetention (13.9, 13.10)', () => {
  const policy: RetentionPolicy = { maxBackups: 2, maxAgeMonths: 6, preserveOfficialPublications: true };
  const now = '2026-12-01T00:00:00Z';

  it('mantem sempre as publicacoes oficiais, independentemente de idade/quantidade', () => {
    const backups = [
      { id: 'official-old', createdAt: '2020-01-01T00:00:00Z', officialPublication: true },
      { id: 'recent-1', createdAt: '2026-11-01T00:00:00Z', officialPublication: false },
      { id: 'recent-2', createdAt: '2026-10-01T00:00:00Z', officialPublication: false },
      { id: 'recent-3', createdAt: '2026-09-01T00:00:00Z', officialPublication: false },
    ];
    const d = applyRetention(backups, policy, now);
    expect(d.keep).toContain('official-old'); // oficial antigo preservado
    expect(d.keep).toContain('recent-1');
    expect(d.keep).toContain('recent-2');
    // recent-3 excede maxBackups=2 nao oficiais -> removido
    expect(d.remove).toContain('recent-3');
  });

  it('remove backups nao oficiais mais velhos que a idade maxima', () => {
    const backups = [
      { id: 'too-old', createdAt: '2020-01-01T00:00:00Z', officialPublication: false },
      { id: 'fresh', createdAt: '2026-11-20T00:00:00Z', officialPublication: false },
    ];
    const d = applyRetention(backups, policy, now);
    expect(d.keep).toContain('fresh');
    expect(d.remove).toContain('too-old');
  });
});
