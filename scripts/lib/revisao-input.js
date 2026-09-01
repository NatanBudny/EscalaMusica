/**
 * revisao-input.js
 *
 * Resolve o caminho do JSON de revisão exportado pela tela. Regra única e
 * determinística compartilhada pelos scripts (aplicar-revisao, baseline):
 *   1. --input explícito, se informado;
 *   2. senão, o arquivo revisao-resultado-<mes>-*.json mais recente em ~/Downloads;
 *   3. senão, o padrão na pasta do mês (escalas/AAAA/MM/revisao-resultado-AAAA-MM.json).
 */

import { existsSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';

export function resolverRevisaoInput({ argInput, root, ano, mes }) {
  if (argInput) return resolve(String(argInput));

  const downloads = join(homedir(), 'Downloads');
  const prefixo = `revisao-resultado-${ano}-${mes}`;
  if (existsSync(downloads)) {
    let melhor = null;
    for (const nome of readdirSync(downloads)) {
      if (!nome.endsWith('.json') || !nome.startsWith(prefixo)) continue;
      const full = join(downloads, nome);
      const mtime = statSync(full).mtimeMs;
      if (!melhor || mtime > melhor.mtime) melhor = { full, mtime };
    }
    if (melhor) return melhor.full;
  }

  return resolve(root, `escalas/${ano}/${mes}/revisao-resultado-${ano}-${mes}.json`);
}
