// Painel de cadastro de Pessoa_Canonica (requisitos 3.1, 3.6, 3.7, 3.8).
//
// Acessibilidade:
//  - cada campo tem <label> associado; erros usam role="alert" e aria-describedby;
//  - ao abrir, o foco vai para o primeiro campo (nome canonico);
//  - toda a operacao e por teclado (Enter em botoes/campos);
//  - o painel e um <form> com <h2> e aria-label.
//
// O painel NUNCA aceita JSON livre: nome e telefone sao campos simples e os
// aliases usam o AliasEditor com colagem confirmada (requisito 1.7).
//
// O painel delega ao RegistryService (via callback) e exibe o erro tipado
// inline sem perder os valores digitados (preservacao apos erro: a submissao
// falha nao limpa o formulario).

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { RegistryResult } from '../../domain/registry/registry-service';
import type { CreatePersonInput } from '../../domain/aggregates/people';
import type { Person, PersonAlias } from '../../domain/schemas/models';
import { registryErrorMessage } from './errors';
import { newUuid, nowUtc } from './ids';
import { AliasEditor } from './AliasEditor';

export interface PersonFormProps {
  /** Cria a pessoa no cadastro; retorna o resultado tipado do servico. */
  onSubmit: (input: CreatePersonInput) => RegistryResult<Person>;
  /** Chamado apos criar com sucesso. */
  onCreated?: (person: Person) => void;
  /** Chamado ao cancelar (fechar painel). */
  onCancel?: () => void;
}

const EMPTY = { name: '', phone: '', aliases: [] as string[] };

export function PersonForm({ onSubmit, onCreated, onCancel }: PersonFormProps): JSX.Element {
  const nameId = useId();
  const phoneId = useId();
  const [name, setName] = useState(EMPTY.name);
  const [phone, setPhone] = useState(EMPTY.phone);
  const [aliases, setAliases] = useState<string[]>(EMPTY.aliases);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Foco inicial no primeiro campo ao montar (gestao de foco).
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const reset = useCallback(() => {
    setName(EMPTY.name);
    setPhone(EMPTY.phone);
    setAliases([]);
    setError(null);
  }, []);

  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      setError(null);

      const trimmedPhone = phone.trim();
      const aliasObjects: PersonAlias[] = aliases.map((value) => ({ value }));
      const input: CreatePersonInput = {
        id: newUuid(),
        canonicalName: name,
        aliases: aliasObjects,
        now: nowUtc(),
        ...(trimmedPhone.length > 0 ? { phoneE164: trimmedPhone } : {}),
      };

      const result = onSubmit(input);
      if (!result.ok) {
        // Preserva os valores digitados; apenas mostra o erro inline.
        setError(registryErrorMessage(result.error));
        nameRef.current?.focus();
        return;
      }
      reset();
      onCreated?.(result.value);
    },
    [name, phone, aliases, onSubmit, onCreated, reset],
  );

  const handleCancel = useCallback(() => {
    reset();
    onCancel?.();
  }, [reset, onCancel]);

  return (
    <form aria-label="Cadastrar pessoa" onSubmit={handleSubmit}>
      <h2>Cadastrar pessoa</h2>

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

      <label htmlFor={phoneId}>Telefone (formato internacional, ex.: +5511999998888)</label>
      <input
        id={phoneId}
        type="text"
        inputMode="tel"
        value={phone}
        onChange={(event) => setPhone(event.target.value)}
        placeholder="+DDI..."
      />

      <AliasEditor aliases={aliases} onChange={setAliases} />

      {error ? (
        <p id={`${nameId}-erro`} role="alert">
          {error}
        </p>
      ) : null}

      <div>
        <button type="submit">Salvar pessoa</button>
        <button type="button" onClick={handleCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
