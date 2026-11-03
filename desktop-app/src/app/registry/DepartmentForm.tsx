// Painel de cadastro de Departamento (requisitos 3.5, 3.6, 3.7).
//
// Mesma base acessivel do PersonForm: labels associados, foco inicial no nome,
// erros com role="alert", operacao por teclado, colagem confirmada de aliases e
// nenhuma entrada de JSON livre. Departamento nao possui telefone nem aliases
// publicos por padrao; apenas nome canonico, aliases e estado.

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { RegistryResult } from '../../domain/registry/registry-service';
import type { CreateDepartmentInput } from '../../domain/aggregates/people';
import type { Department, PersonAlias } from '../../domain/schemas/models';
import { registryErrorMessage } from './errors';
import { newUuid, nowUtc } from './ids';
import { AliasEditor } from './AliasEditor';

export interface DepartmentFormProps {
  onSubmit: (input: CreateDepartmentInput) => RegistryResult<Department>;
  onCreated?: (department: Department) => void;
  onCancel?: () => void;
}

export function DepartmentForm({
  onSubmit,
  onCreated,
  onCancel,
}: DepartmentFormProps): JSX.Element {
  const nameId = useId();
  const [name, setName] = useState('');
  const [aliases, setAliases] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const reset = useCallback(() => {
    setName('');
    setAliases([]);
    setError(null);
  }, []);

  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      setError(null);
      const aliasObjects: PersonAlias[] = aliases.map((value) => ({ value }));
      const input: CreateDepartmentInput = {
        id: newUuid(),
        canonicalName: name,
        aliases: aliasObjects,
        now: nowUtc(),
      };
      const result = onSubmit(input);
      if (!result.ok) {
        setError(registryErrorMessage(result.error));
        nameRef.current?.focus();
        return;
      }
      reset();
      onCreated?.(result.value);
    },
    [name, aliases, onSubmit, onCreated, reset],
  );

  const handleCancel = useCallback(() => {
    reset();
    onCancel?.();
  }, [reset, onCancel]);

  return (
    <form aria-label="Cadastrar departamento" onSubmit={handleSubmit}>
      <h2>Cadastrar departamento</h2>

      <label htmlFor={nameId}>Nome canonico</label>
      <input
        id={nameId}
        ref={nameRef}
        type="text"
        value={name}
        onChange={(event) => setName(event.target.value)}
        aria-required="true"
        aria-invalid={error !== null}
        aria-describedby={error ? `${nameId}-erro` : undefined}
      />

      <AliasEditor aliases={aliases} onChange={setAliases} />

      {error ? (
        <p id={`${nameId}-erro`} role="alert">
          {error}
        </p>
      ) : null}

      <div>
        <button type="submit">Salvar departamento</button>
        <button type="button" onClick={handleCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
