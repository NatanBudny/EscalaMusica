// Hook React que adapta o RegistryService (dominio puro) ao estado da UI.
//
// O hook NAO introduz um modelo de dados paralelo: ele detem uma instancia de
// `RegistryService` e expoe seu snapshot como estado React. Toda operacao de
// mutacao delega ao servico; quando o servico rejeita (falha tipada), o estado
// anterior e preservado automaticamente (o servico nunca muta em falha) e o
// hook apenas repassa o erro para a UI exibir inline.

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  RegistryService,
  type RegistryResult,
  type RegistrySnapshot,
} from '../../domain/registry/registry-service';
import type { CreateDepartmentInput, CreatePersonInput } from '../../domain/aggregates/people';
import type { Department, Person, PersonAlias } from '../../domain/schemas/models';
import { nowUtc } from './ids';

export interface UseRegistry {
  snapshot: RegistrySnapshot;
  addPerson: (input: CreatePersonInput) => RegistryResult<Person>;
  addDepartment: (input: CreateDepartmentInput) => RegistryResult<Department>;
  addAlias: (personId: string, alias: PersonAlias) => RegistryResult<Person>;
  setPhone: (personId: string, phone: string | undefined) => RegistryResult<Person>;
  deactivatePerson: (personId: string) => RegistryResult<Person>;
}

/**
 * Cria o hook sobre um snapshot inicial opcional. O servico e criado uma unica
 * vez (ref estavel) e cada mutacao bem-sucedida publica um novo snapshot.
 */
export function useRegistry(initial?: RegistrySnapshot): UseRegistry {
  const serviceRef = useRef<RegistryService | null>(null);
  if (serviceRef.current === null) {
    serviceRef.current = new RegistryService(initial);
  }
  const service = serviceRef.current;

  const [snapshot, setSnapshot] = useState<RegistrySnapshot>(() => service.snapshot());

  const publish = useCallback(() => {
    setSnapshot(service.snapshot());
  }, [service]);

  const addPerson = useCallback(
    (input: CreatePersonInput): RegistryResult<Person> => {
      const result = service.addPerson(input);
      if (result.ok) publish();
      return result;
    },
    [service, publish],
  );

  const addDepartment = useCallback(
    (input: CreateDepartmentInput): RegistryResult<Department> => {
      const result = service.addDepartment(input);
      if (result.ok) publish();
      return result;
    },
    [service, publish],
  );

  const addAlias = useCallback(
    (personId: string, alias: PersonAlias): RegistryResult<Person> => {
      const result = service.addAlias(personId, alias, nowUtc());
      if (result.ok) publish();
      return result;
    },
    [service, publish],
  );

  const setPhone = useCallback(
    (personId: string, phone: string | undefined): RegistryResult<Person> => {
      const result = service.setPhone(personId, phone, nowUtc());
      if (result.ok) publish();
      return result;
    },
    [service, publish],
  );

  const deactivatePerson = useCallback(
    (personId: string): RegistryResult<Person> => {
      const result = service.deactivatePerson(personId, nowUtc());
      if (result.ok) publish();
      return result;
    },
    [service, publish],
  );

  return useMemo(
    () => ({ snapshot, addPerson, addDepartment, addAlias, setPhone, deactivatePerson }),
    [snapshot, addPerson, addDepartment, addAlias, setPhone, deactivatePerson],
  );
}
