import { getDetalhesAgenda } from '../../src/business/agenda.js';

const makeRecord = (overrides = {}) => ({
  'PREGADOR':         '',
  'REGENTE LOUVOR':   '',
  'EQUIPE LOUVOR':    '',
  'MENSAGEM MUSICAL': '',
  'AUDIOVISUAL':      '',
  'SUPORTE':          '',
  'ANCIÃO':           '',
  'TEMA CULTO':       '',
  ...overrides,
});

describe('getDetalhesAgenda', () => {
  test('detects PREGADOR role', () => {
    const r = makeRecord({ 'PREGADOR': 'CLEVERSON' });
    const { papel } = getDetalhesAgenda(r, 'CLEVERSON');
    expect(papel).toContain('PREGAR NA CENTRAL');
  });

  test('detects REGENTE LOUVOR role and includes conductor tasks in description', () => {
    const r = makeRecord({ 'REGENTE LOUVOR': 'GIOVANA' });
    const { papel, descricao } = getDetalhesAgenda(r, 'GIOVANA');
    expect(papel).toContain('REGÊNCIA NA CENTRAL');
    expect(descricao).toContain('TAREFAS DO REGENTE');
  });

  test('detects EQUIPE LOUVOR role (comma-list) and includes member tasks', () => {
    const r = makeRecord({ 'EQUIPE LOUVOR': 'EMILY, ARIADNY, CATHERINE' });
    const { papel, descricao } = getDetalhesAgenda(r, 'ARIADNY');
    expect(papel).toContain('CANTAR LOUVOR');
    expect(descricao).toContain('TAREFAS DA EQUIPE');
  });

  test('detects MENSAGEM MUSICAL role', () => {
    const r = makeRecord({ 'MENSAGEM MUSICAL': 'ALEX' });
    const { papel } = getDetalhesAgenda(r, 'ALEX');
    expect(papel).toContain('MENSAGEM MUSICAL NA CENTRAL');
  });

  test('detects AUDIOVISUAL role', () => {
    const r = makeRecord({ 'AUDIOVISUAL': 'DIEGO' });
    const { papel } = getDetalhesAgenda(r, 'DIEGO');
    expect(papel).toContain('FAZER A MÍDIA DO CULTO');
  });

  test('detects SUPORTE role', () => {
    const r = makeRecord({ 'SUPORTE': 'VANDERLEY' });
    const { papel } = getDetalhesAgenda(r, 'VANDERLEY');
    expect(papel).toContain('DAR SUPORTE NA CENTRAL');
  });

  test('detects ANCIÃO role (accented field name)', () => {
    const r = makeRecord({ 'ANCIÃO': 'ADELMO' });
    const { papel } = getDetalhesAgenda(r, 'ADELMO');
    expect(papel).toContain('SOU ANCIÃO');
  });

  test('combines multiple roles with " E "', () => {
    const r = makeRecord({
      'REGENTE LOUVOR': 'FABRÍCIO',
      'PREGADOR':       'FABRÍCIO',
    });
    const { papel } = getDetalhesAgenda(r, 'FABRÍCIO');
    expect(papel).toContain(' E ');
    expect(papel).toContain('PREGAR NA CENTRAL');
    expect(papel).toContain('REGÊNCIA NA CENTRAL');
  });

  test('returns default label and description when no role is matched', () => {
    const r = makeRecord();
    const { papel, descricao } = getDetalhesAgenda(r, 'SOMEONE');
    expect(papel).toBe('ESCALA NA CENTRAL');
    expect(descricao).toContain('PREPARAÇÃO');
  });

  test('appends tema do culto to description when present', () => {
    const r = makeRecord({ 'PREGADOR': 'NATAN', 'TEMA CULTO': 'Fé e Graça' });
    const { descricao } = getDetalhesAgenda(r, 'NATAN');
    expect(descricao).toContain('Fé e Graça');
  });

  test('description has default preparation note when only roles with empty descriptions are matched', () => {
    const r = makeRecord({ 'PREGADOR': 'SILVANA' });
    const { descricao } = getDetalhesAgenda(r, 'SILVANA');
    // PREGADOR has empty descricao → default message used
    expect(descricao).toContain('PREPARAÇÃO');
  });

  test('is accent-insensitive for name lookup', () => {
    const r = makeRecord({ 'REGENTE LOUVOR': 'FABRÍCIO' });
    const { papel } = getDetalhesAgenda(r, 'Fabricio');
    expect(papel).toContain('REGÊNCIA NA CENTRAL');
  });
});
