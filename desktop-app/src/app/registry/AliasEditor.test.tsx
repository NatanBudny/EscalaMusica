import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { AliasEditor } from './AliasEditor';

afterEach(() => cleanup());

/** Wrapper controlado para exercitar o editor como o pai faria. */
function Harness({ onChange }: { onChange?: (next: string[]) => void }): JSX.Element {
  const [aliases, setAliases] = useState<string[]>([]);
  return (
    <AliasEditor
      aliases={aliases}
      onChange={(next) => {
        setAliases(next);
        onChange?.(next);
      }}
    />
  );
}

/** Dispara um evento de colagem com o texto informado. */
function pasteInto(input: HTMLElement, text: string): void {
  fireEvent.paste(input, {
    clipboardData: { getData: () => text },
  });
}

describe('AliasEditor (colagem confirmada)', () => {
  it('adiciona um alias por vez via Enter', () => {
    render(<Harness />);
    const input = screen.getByLabelText('Novo apelido');
    fireEvent.change(input, { target: { value: 'Mah' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('Mah')).toBeInTheDocument();
    // O campo e limpo e mantem o foco (gestao de foco).
    expect(input).toHaveValue('');
  });

  it('colar um bloco NAO aplica direto: exige confirmacao', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByLabelText('Novo apelido');
    pasteInto(input, 'Ana\nBruno\nCarlos');

    // Nada aplicado ainda; apenas um resumo para confirmar.
    expect(onChange).not.toHaveBeenCalled();
    const confirmPanel = screen.getByRole('region', { name: 'Confirmar colagem de apelidos' });
    expect(within(confirmPanel).getByText('Ana')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar colagem' }));
    expect(onChange).toHaveBeenCalledWith(['Ana', 'Bruno', 'Carlos']);
  });

  it('descartar a colagem nao aplica os valores', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByLabelText('Novo apelido');
    pasteInto(input, 'Ana;Bruno');
    fireEvent.click(screen.getByRole('button', { name: 'Descartar colagem' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('region', { name: 'Confirmar colagem de apelidos' }),
    ).not.toBeInTheDocument();
  });

  it('colar conteudo que parece JSON e rejeitado com erro inline', () => {
    render(<Harness />);
    const input = screen.getByLabelText('Novo apelido');
    pasteInto(input, '{ "alias": "x" }');
    expect(screen.getByRole('alert')).toHaveTextContent(/JSON/i);
    expect(
      screen.queryByRole('region', { name: 'Confirmar colagem de apelidos' }),
    ).not.toBeInTheDocument();
  });
});
