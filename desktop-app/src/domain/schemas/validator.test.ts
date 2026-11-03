import { describe, expect, it } from 'vitest';
import { validateEntity, validateEntitySet } from './validator';
import { JSON_SCHEMAS } from './jsonSchemas';
import { FIELD_CLASSIFICATION, assertClassificationComplete } from './classification';
import { SCHEMA_VERSION, type CanonicalEntityName } from './models';
import { validFixtures, invalidFixtures, validEntitySet, brokenReferenceSet } from './fixtures';

const entityNames = Object.keys(JSON_SCHEMAS) as CanonicalEntityName[];

describe('schemas canonicos — cobertura e consistencia', () => {
  it('ha um JSON Schema e uma fixture valida para cada entidade canonica', () => {
    for (const name of entityNames) {
      expect(JSON_SCHEMAS[name], `schema ausente: ${name}`).toBeDefined();
      expect(validFixtures[name], `fixture valida ausente: ${name}`).toBeDefined();
    }
  });

  it('cada schema embute a versao atual no $id', () => {
    for (const name of entityNames) {
      const id = (JSON_SCHEMAS[name] as { $id?: string }).$id ?? '';
      expect(id, `${name} sem $id versionado`).toContain(SCHEMA_VERSION);
    }
  });
});

describe('classificacao obrigatoria publico/privado (Requisito 11.1)', () => {
  it('todo campo de todo schema esta classificado', () => {
    for (const name of entityNames) {
      const schema = JSON_SCHEMAS[name] as { properties?: Record<string, unknown> };
      const fields = Object.keys(schema.properties ?? {});
      expect(() => assertClassificationComplete(name, fields)).not.toThrow();
    }
  });

  it('cada campo classificado usa exatamente uma categoria valida', () => {
    for (const name of entityNames) {
      const table = FIELD_CLASSIFICATION[name];
      for (const [field, cls] of Object.entries(table)) {
        expect(['public', 'private'], `${name}.${field}`).toContain(cls);
      }
    }
  });
});

describe('fixtures validas passam na validacao', () => {
  for (const name of entityNames) {
    it(`"${name}" valida sem problemas`, () => {
      const outcome = validateEntity(name, validFixtures[name]);
      expect(outcome.issues, JSON.stringify(outcome.issues)).toEqual([]);
      expect(outcome.valid).toBe(true);
    });
  }
});

describe('fixtures invalidas falham sem mutacao', () => {
  for (const c of invalidFixtures) {
    it(`"${c.name}": ${c.description} falha (${c.expectKind})`, () => {
      // Snapshot profundo para comprovar ausencia de mutacao.
      const before = structuredClone(c.value);
      const outcome = validateEntity(c.name, c.value);

      expect(outcome.valid).toBe(false);
      expect(outcome.issues.length).toBeGreaterThan(0);
      expect(
        outcome.issues.some((i) => i.kind === c.expectKind),
        `esperava um problema do tipo "${c.expectKind}", recebi: ${JSON.stringify(outcome.issues)}`,
      ).toBe(true);

      // A entrada nao foi modificada pela validacao.
      expect(c.value).toEqual(before);
    });
  }
});

describe('integridade referencial de conjuntos de entidades', () => {
  it('conjunto coerente valido passa', () => {
    const outcome = validateEntitySet(validEntitySet);
    expect(outcome.issues, JSON.stringify(outcome.issues)).toEqual([]);
    expect(outcome.valid).toBe(true);
  });

  it('referencia quebrada falha com kind broken-reference e sem mutacao', () => {
    const before = structuredClone(brokenReferenceSet);
    const outcome = validateEntitySet(brokenReferenceSet);

    expect(outcome.valid).toBe(false);
    expect(outcome.issues.some((i) => i.kind === 'broken-reference')).toBe(true);
    expect(brokenReferenceSet).toEqual(before);
  });

  it('insumo apontando para culto inexistente e detectado', () => {
    const outcome = validateEntitySet({
      ...validEntitySet,
      externalInputs: [
        {
          ...(validFixtures.externalInput as object),
          serviceId: '00000000-0000-4000-8000-0000000000ff',
        },
      ],
    });
    expect(
      outcome.issues.some(
        (i) => i.kind === 'broken-reference' && i.path.includes('externalInputs'),
      ),
    ).toBe(true);
  });

  it('excecao apontando para regra inexistente e detectada', () => {
    const outcome = validateEntitySet({
      ...validEntitySet,
      exceptions: [
        {
          ...(validFixtures.approvedException as object),
          fundamentalRuleId: '00000000-0000-4000-8000-0000000000ee',
        },
      ],
    });
    expect(
      outcome.issues.some((i) => i.kind === 'broken-reference' && i.path.includes('exceptions')),
    ).toBe(true);
  });
});

describe('versao desconhecida e rejeitada para todas as entidades', () => {
  for (const name of entityNames) {
    it(`"${name}" com schemaVersion desconhecida falha`, () => {
      const bad = { ...(validFixtures[name] as object), schemaVersion: '0.0.0-desconhecida' };
      const outcome = validateEntity(name, bad);
      expect(outcome.valid).toBe(false);
      expect(outcome.issues.some((i) => i.kind === 'unknown-version')).toBe(true);
    });
  }
});
