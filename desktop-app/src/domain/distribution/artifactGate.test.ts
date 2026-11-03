// Testes de instalacao e atualizacao por plataforma (tarefa 17.6).
//
// Validacao objetiva: artefatos nao assinados ou nao notarizados sao REJEITADOS;
// o smoke do instalador cobre instalar -> abrir -> cofre -> atualizar ->
// desinstalar; a atualizacao e adiada durante um ciclo em andamento.
// Requisitos: 1.9, 15.2, 16.2.

import { describe, it, expect } from 'vitest';
import {
  canUpdateNow,
  evaluateArtifactGate,
  runInstallerSmoke,
  SMOKE_SEQUENCE,
  type ArtifactDescriptor,
  type SmokeStep,
} from './artifactGate';

const signedWindows: ArtifactDescriptor = {
  platform: 'windows',
  architecture: 'x86_64',
  format: 'nsis',
  signed: true,
  notarized: false, // irrelevante no Windows
};

const signedNotarizedMac: ArtifactDescriptor = {
  platform: 'macos',
  architecture: 'aarch64',
  format: 'dmg',
  signed: true,
  notarized: true,
};

describe('evaluateArtifactGate (17.6)', () => {
  it('aceita Windows assinado', () => {
    expect(evaluateArtifactGate(signedWindows).accepted).toBe(true);
  });

  it('rejeita artefato nao assinado', () => {
    const r = evaluateArtifactGate({ ...signedWindows, signed: false });
    expect(r.accepted).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/nao assinado/i);
  });

  it('rejeita macOS nao notarizado mesmo que assinado', () => {
    const r = evaluateArtifactGate({ ...signedNotarizedMac, notarized: false });
    expect(r.accepted).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/nao notarizado/i);
  });

  it('aceita macOS assinado e notarizado', () => {
    expect(evaluateArtifactGate(signedNotarizedMac).accepted).toBe(true);
  });
});

describe('runInstallerSmoke (17.6)', () => {
  it('conclui o smoke completo quando o artefato e aceito', () => {
    const r = runInstallerSmoke(signedNotarizedMac, () => true);
    expect(r.completed).toBe(true);
    expect(r.executed).toEqual(SMOKE_SEQUENCE);
  });

  it('nao executa o smoke quando o artefato e rejeitado', () => {
    const r = runInstallerSmoke({ ...signedWindows, signed: false }, () => true);
    expect(r.completed).toBe(false);
    expect(r.executed).toEqual([]);
  });

  it('para no passo que falhar', () => {
    const failAt: SmokeStep = 'use-vault';
    const r = runInstallerSmoke(signedWindows, (step) => step !== failAt);
    expect(r.completed).toBe(false);
    expect(r.executed).toEqual(['install', 'open']);
    expect(r.stoppedReason).toMatch(/use-vault/);
  });
});

describe('canUpdateNow (1.9/16.2)', () => {
  it('adia a atualizacao durante um ciclo em andamento', () => {
    expect(canUpdateNow(true)).toBe(false);
    expect(canUpdateNow(false)).toBe(true);
  });
});
