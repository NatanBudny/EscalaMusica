// Grade de cadastro de pessoas e departamentos (requisitos 1.1, 1.7, 1.8,
// 3.1-3.15). Combina:
//  - busca por nome canonico ou alias (campo unico, reflete nos resultados);
//  - grade acessivel (role="grid") navegavel por teclado (setas Cima/Baixo);
//  - edicao inline de telefone por teclado (Enter salva, Escape cancela);
//  - erros inline (role="alert") que preservam o estado apos a falha;
//  - paineis laterais de pessoa/departamento (PersonForm/DepartmentForm);
//  - sem nenhum campo de JSON livre.
//
// A grade le o estado de `useRegistry` (que detem o RegistryService); nenhum
// modelo paralelo e criado.

import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { useRegistry } from './useRegistry';
import type { RegistrySnapshot } from '../../domain/registry/registry-service';
import { departmentToRow, filterSubjects, personToRow, type SubjectRow } from './search';
import { registryErrorMessage } from './errors';
import { PersonForm } from './PersonForm';
import { DepartmentForm } from './DepartmentForm';

export interface RegistryGridProps {
  /** Snapshot inicial opcional (ex.: carregado do estado persistente). */
  initial?: RegistrySnapshot;
}

type Panel = 'none' | 'person' | 'department';

export function RegistryGrid({ initial }: RegistryGridProps): JSX.Element {
  const registry = useRegistry(initial);
  const searchId = useId();
  const [query, setQuery] = useState('');
  const [panel, setPanel] = useState<Panel>('none');
  const [activeIndex, setActiveIndex] = useState(0);
  const [status, setStatus] = useState<string | null>(null);

  // Edicao inline de telefone.
  const [editingPhoneId, setEditingPhoneId] = useState<string | null>(null);
  const [phoneDraft, setPhoneDraft] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const phoneInputRef = useRef<HTMLInputElement>(null);

  const rows: SubjectRow[] = useMemo(() => {
    const people = registry.snapshot.people.map(personToRow);
    const departments = registry.snapshot.departments.map(departmentToRow);
    return filterSubjects([...people, ...departments], query);
  }, [registry.snapshot, query]);

  const clampedActive = Math.min(activeIndex, Math.max(0, rows.length - 1));

  const moveActive = useCallback(
    (delta: number) => {
      setActiveIndex((current) => {
        const next = current + delta;
        if (next < 0) return 0;
        if (next > rows.length - 1) return Math.max(0, rows.length - 1);
        return next;
      });
    },
    [rows.length],
  );

  const handleGridKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveActive(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveActive(-1);
      }
    },
    [moveActive],
  );

  const startEditPhone = useCallback((row: SubjectRow) => {
    setEditingPhoneId(row.id);
    setPhoneDraft(row.phoneE164 ?? '');
    setPhoneError(null);
    // Foco apos render.
    window.setTimeout(() => phoneInputRef.current?.focus(), 0);
  }, []);

  const cancelEditPhone = useCallback(() => {
    setEditingPhoneId(null);
    setPhoneDraft('');
    setPhoneError(null);
  }, []);

  const commitPhone = useCallback(
    (personId: string) => {
      const trimmed = phoneDraft.trim();
      const result = registry.setPhone(personId, trimmed.length > 0 ? trimmed : undefined);
      if (!result.ok) {
        // Preserva o telefone anterior (o servico nao mutou) e mostra o erro.
        setPhoneError(registryErrorMessage(result.error));
        return;
      }
      setEditingPhoneId(null);
      setPhoneDraft('');
      setPhoneError(null);
      setStatus('Telefone atualizado.');
    },
    [phoneDraft, registry],
  );

  const handlePhoneKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>, personId: string) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitPhone(personId);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancelEditPhone();
      }
    },
    [commitPhone, cancelEditPhone],
  );

  const deactivate = useCallback(
    (personId: string) => {
      const result = registry.deactivatePerson(personId);
      if (result.ok) setStatus('Pessoa desativada.');
    },
    [registry],
  );

  return (
    <section aria-label="Cadastro de pessoas e departamentos">
      <h1>Cadastro</h1>

      <div role="status" aria-live="polite">
        {status ?? ''}
      </div>

      <label htmlFor={searchId}>Buscar por nome ou apelido</label>
      <input
        id={searchId}
        type="search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
        }}
        placeholder="Digite um nome canonico ou apelido"
      />

      <div>
        <button type="button" onClick={() => setPanel('person')}>
          Nova pessoa
        </button>
        <button type="button" onClick={() => setPanel('department')}>
          Novo departamento
        </button>
      </div>

      <div
        role="grid"
        aria-label="Lista de cadastro"
        aria-rowcount={rows.length}
        onKeyDown={handleGridKeyDown}
        tabIndex={0}
      >
        <div role="row">
          <span role="columnheader">Nome canonico</span>
          <span role="columnheader">Tipo</span>
          <span role="columnheader">Apelidos</span>
          <span role="columnheader">Estado</span>
          <span role="columnheader">Telefone</span>
          <span role="columnheader">Acoes</span>
        </div>

        {rows.length === 0 ? (
          <p>Nenhum registro encontrado.</p>
        ) : (
          rows.map((row, index) => {
            const isActive = index === clampedActive;
            const isEditingPhone = editingPhoneId === row.id;
            return (
              <div
                role="row"
                key={row.id}
                aria-selected={isActive}
                data-active={isActive ? 'true' : 'false'}
              >
                <span role="gridcell">{row.canonicalName}</span>
                <span role="gridcell">{row.kind === 'person' ? 'Pessoa' : 'Departamento'}</span>
                <span role="gridcell">{row.aliases.length > 0 ? row.aliases.join(', ') : '-'}</span>
                <span role="gridcell">{row.active ? 'Ativo' : 'Inativo'}</span>
                <span role="gridcell">
                  {row.kind === 'person' ? (
                    isEditingPhone ? (
                      <>
                        <label htmlFor={`phone-${row.id}`} className="sr-only">
                          Telefone de {row.canonicalName}
                        </label>
                        <input
                          id={`phone-${row.id}`}
                          ref={phoneInputRef}
                          type="text"
                          value={phoneDraft}
                          onChange={(event) => setPhoneDraft(event.target.value)}
                          onKeyDown={(event) => handlePhoneKeyDown(event, row.id)}
                          aria-invalid={phoneError !== null}
                          aria-describedby={phoneError ? `phone-${row.id}-erro` : undefined}
                        />
                        <button type="button" onClick={() => commitPhone(row.id)}>
                          Salvar telefone
                        </button>
                        <button type="button" onClick={cancelEditPhone}>
                          Cancelar
                        </button>
                        {phoneError ? (
                          <span id={`phone-${row.id}-erro`} role="alert">
                            {phoneError}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <span>{row.phoneE164 ?? '-'}</span>
                        <button
                          type="button"
                          aria-label={`Editar telefone de ${row.canonicalName}`}
                          onClick={() => startEditPhone(row)}
                        >
                          Editar telefone
                        </button>
                      </>
                    )
                  ) : (
                    '-'
                  )}
                </span>
                <span role="gridcell">
                  {row.kind === 'person' && row.active ? (
                    <button
                      type="button"
                      aria-label={`Desativar ${row.canonicalName}`}
                      onClick={() => deactivate(row.id)}
                    >
                      Desativar
                    </button>
                  ) : (
                    '-'
                  )}
                </span>
              </div>
            );
          })
        )}
      </div>

      {panel === 'person' ? (
        <PersonForm
          onSubmit={registry.addPerson}
          onCreated={(person) => {
            setStatus(`Pessoa "${person.canonicalName}" cadastrada.`);
            setPanel('none');
          }}
          onCancel={() => setPanel('none')}
        />
      ) : null}

      {panel === 'department' ? (
        <DepartmentForm
          onSubmit={registry.addDepartment}
          onCreated={(department) => {
            setStatus(`Departamento "${department.canonicalName}" cadastrado.`);
            setPanel('none');
          }}
          onCancel={() => setPanel('none')}
        />
      ) : null}
    </section>
  );
}
