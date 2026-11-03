// Sincronia entre o catalogo tipado e o documento versionado
// `docs/CATALOGO-DE-FALHAS.md` (tarefas 17.3/17.5).
//
// O documento e GERADO a partir do catalogo tipado. Este teste falha se o
// arquivo versionado divergir da saida do gerador — garantindo que
// documentacao e codigo permanecam sincronizados. Para regenerar, rode este
// teste com `UPDATE_CATALOG=1`.

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderFailureCatalogMarkdown } from './failureCatalog';

const DOC_PATH = resolve(__dirname, '../../../docs/CATALOGO-DE-FALHAS.md');

describe('documento do catalogo de falhas (17.3/17.5)', () => {
  it('o arquivo versionado corresponde exatamente ao gerador', () => {
    const expected = renderFailureCatalogMarkdown() + '\n';
    if (process.env.UPDATE_CATALOG === '1') {
      writeFileSync(DOC_PATH, expected, 'utf8');
    }
    const actual = readFileSync(DOC_PATH, 'utf8');
    expect(actual).toBe(expected);
  });
});
