// Traducao de falhas tipadas do RegistryService para texto inline em portugues.
//
// O RegistryService ja retorna mensagens em portugues; este modulo apenas
// enriquece a mensagem de colisao de identidade (requisito 3.7) identificando o
// registro conflitante, para que o erro inline aponte o duplicado.

import type { RegistryError } from '../../domain/registry/registry-service';

/**
 * Mensagem inline para uma falha do servico. Para colisao de identidade,
 * acrescenta o valor conflitante detectado, atendendo a exigencia de
 * "indicacao de duplicidade que identifique o registro conflitante" (3.7).
 */
export function registryErrorMessage(error: RegistryError): string {
  if (error.code === 'identity-collision' && error.collisions && error.collisions.length > 0) {
    const conflict = error.collisions[0]!;
    const existingValue = conflict.existing.value;
    return `${error.message} (conflita com "${existingValue}").`;
  }
  return error.message;
}
