// Hook React que adapta o ExternalInputService (dominio puro) ao estado da UI.
//
// O hook NAO introduz um modelo de dados paralelo nem aceita JSON livre: ele
// detem uma instancia de `ExternalInputService` e expoe seu snapshot como
// estado React. Toda mutacao delega ao servico; quando o servico rejeita
// (falha tipada), o estado anterior e preservado (o servico nunca muta em
// falha) e o hook repassa o erro para a UI exibir inline.

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ExternalInputService,
  type ConfirmationSummary,
  type ExternalInputResult,
  type ExternalInputSnapshot,
  type RegisterExternalInput,
} from '../../domain/cycle/externalInputService';
import type { ExternalInput, ExternalInputType } from '../../domain/schemas/models';

export interface UseExternalInputs {
  snapshot: ExternalInputSnapshot;
  /** Insumos de um culto. */
  forService: (serviceId: string) => ExternalInput[];
  /** Conferencia (4.20): valida sem salvar e retorna o resumo. */
  validate: <T extends ExternalInputType>(
    input: RegisterExternalInput<T>,
  ) => ExternalInputResult<ConfirmationSummary>;
  /** Salva apos a conferencia. */
  register: <T extends ExternalInputType>(
    input: RegisterExternalInput<T>,
  ) => ExternalInputResult<ExternalInput>;
  remove: (id: string) => ExternalInputResult<ExternalInput>;
}

export function useExternalInputs(initial?: ExternalInputSnapshot): UseExternalInputs {
  const serviceRef = useRef<ExternalInputService | null>(null);
  if (serviceRef.current === null) {
    serviceRef.current = new ExternalInputService(initial);
  }
  const service = serviceRef.current;

  const [snapshot, setSnapshot] = useState<ExternalInputSnapshot>(() => service.snapshot());

  const publish = useCallback(() => {
    setSnapshot(service.snapshot());
  }, [service]);

  const forService = useCallback((serviceId: string) => service.forService(serviceId), [service]);

  const validate = useCallback(
    <T extends ExternalInputType>(input: RegisterExternalInput<T>) => service.validate(input),
    [service],
  );

  const register = useCallback(
    <T extends ExternalInputType>(input: RegisterExternalInput<T>) => {
      const result = service.register(input);
      if (result.ok) publish();
      return result;
    },
    [service, publish],
  );

  const remove = useCallback(
    (id: string) => {
      const result = service.remove(id);
      if (result.ok) publish();
      return result;
    },
    [service, publish],
  );

  return useMemo(
    () => ({ snapshot, forService, validate, register, remove }),
    [snapshot, forService, validate, register, remove],
  );
}
