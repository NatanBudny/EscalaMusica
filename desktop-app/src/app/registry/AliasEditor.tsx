// Editor acessivel de aliases com colagem confirmada.
//
// O Operador adiciona aliases um a um (campo + botao/Enter) ou cola um bloco de
// texto. A colagem NUNCA aplica diretamente: ela abre um resumo com os valores
// detectados para confirmacao explicita (requisito 1.7, "colagem confirmada").
// Nenhum JSON livre e aceito (parsePastedValues rejeita estruturas).

import { useCallback, useId, useRef, useState } from 'react';
import { normalizeName } from '../../domain/registry/identity';
import { parsePastedValues } from './paste';

export interface AliasEditorProps {
  /** Aliases atuais (controlado pelo pai). */
  aliases: readonly string[];
  /** Notifica o pai com a nova lista de aliases. */
  onChange: (next: string[]) => void;
  /** Rotulo do grupo, para acessibilidade. */
  label?: string;
}

/** Remove duplicatas (por caixa) preservando a ordem. */
function dedupe(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function AliasEditor({
  aliases,
  onChange,
  label = 'Apelidos',
}: AliasEditorProps): JSX.Element {
  const inputId = useId();
  const [draft, setDraft] = useState('');
  const [pendingPaste, setPendingPaste] = useState<string[] | null>(null);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addOne = useCallback(() => {
    const value = normalizeName(draft);
    if (value.length === 0) return;
    onChange(dedupe([...aliases, value]));
    setDraft('');
    inputRef.current?.focus();
  }, [draft, aliases, onChange]);

  const removeAt = useCallback(
    (index: number) => {
      const next = aliases.filter((_, i) => i !== index);
      onChange([...next]);
    },
    [aliases, onChange],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addOne();
      }
    },
    [addOne],
  );

  const handlePaste = useCallback((event: React.ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text');
    const trimmed = text.trim();
    // Interceptamos blocos (multilinha ou com separadores) para confirmar e
    // tambem qualquer conteudo que pareca JSON/estrutura, para rejeita-lo
    // explicitamente (requisito 1.7). Um valor simples de uma unica linha segue
    // o comportamento padrao de digitacao.
    const looksLikeStructure = /^[[{"]/.test(trimmed);
    if (!/[\n\r;,]/u.test(text) && !looksLikeStructure) return;
    event.preventDefault();
    const parsed = parsePastedValues(text);
    if (!parsed.ok) {
      setPasteError(parsed.reason);
      setPendingPaste(null);
      return;
    }
    setPasteError(null);
    setPendingPaste(parsed.values);
  }, []);

  const confirmPaste = useCallback(() => {
    if (pendingPaste === null) return;
    onChange(dedupe([...aliases, ...pendingPaste]));
    setPendingPaste(null);
  }, [pendingPaste, aliases, onChange]);

  const cancelPaste = useCallback(() => {
    setPendingPaste(null);
    setPasteError(null);
    inputRef.current?.focus();
  }, []);

  return (
    <fieldset>
      <legend>{label}</legend>

      {aliases.length > 0 ? (
        <ul aria-label="Apelidos cadastrados">
          {aliases.map((alias, index) => (
            <li key={`${alias}-${index}`}>
              <span>{alias}</span>
              <button
                type="button"
                aria-label={`Remover apelido ${alias}`}
                onClick={() => removeAt(index)}
              >
                Remover
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p>Nenhum apelido cadastrado.</p>
      )}

      <label htmlFor={inputId}>Novo apelido</label>
      <input
        id={inputId}
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        aria-describedby={pasteError ? `${inputId}-erro` : undefined}
      />
      <button type="button" onClick={addOne}>
        Adicionar apelido
      </button>

      {pasteError ? (
        <p id={`${inputId}-erro`} role="alert">
          {pasteError}
        </p>
      ) : null}

      {pendingPaste !== null ? (
        <section aria-label="Confirmar colagem de apelidos">
          <p>Confirmar a adicao de {pendingPaste.length} apelido(s)?</p>
          <ul aria-label="Apelidos a confirmar">
            {pendingPaste.map((value, index) => (
              <li key={`${value}-${index}`}>{value}</li>
            ))}
          </ul>
          <button type="button" onClick={confirmPaste}>
            Confirmar colagem
          </button>
          <button type="button" onClick={cancelPaste}>
            Descartar colagem
          </button>
        </section>
      ) : null}
    </fieldset>
  );
}
