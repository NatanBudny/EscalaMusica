import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { CollectionGrids, type CollectionGridsProps } from './CollectionGrids';

afterEach(() => cleanup());

const PROPS: CollectionGridsProps = {
  services: [{ id: 'svc-1', label: 'Quarta 05/02' }],
  people: [
    { id: 'p-1', name: 'Ana' },
    { id: 'p-2', name: 'Bruno' },
  ],
  departments: [{ id: 'd-1', name: 'Louvor' }],
  operatorId: 'op-1',
};

function fillSource(value = 'PDF anciaos'): void {
  fireEvent.change(screen.getByLabelText('Fonte (proveniencia)'), { target: { value } });
}

describe('CollectionGrids - conferencia antes de salvar (Requisito 4.20)', () => {
  it('apresenta o resumo de conferencia antes de confirmar e so salva na confirmacao', () => {
    render(<CollectionGrids {...PROPS} />);
    fillSource();

    // Tipo "Tema".
    fireEvent.click(screen.getByRole('tab', { name: 'Tema' }));
    fireEvent.change(screen.getByLabelText('Tema do culto'), { target: { value: 'Fe e obras' } });

    // Etapa 1: conferir -> aparece o dialogo de conferencia, nada foi salvo.
    fireEvent.click(screen.getByRole('button', { name: 'Conferir antes de salvar' }));
    const dialog = screen.getByRole('dialog', { name: 'Conferencia do insumo' });
    expect(within(dialog).getByText(/Fe e obras/)).toBeInTheDocument();

    const grid = screen.getByRole('grid', { name: 'Insumos do culto' });
    expect(within(grid).getByText('Nenhum insumo registrado para este culto.')).toBeInTheDocument();

    // Etapa 2: confirmar -> aparece na grade.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar insumo' }));
    expect(within(grid).getByText('Fe e obras')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Insumo confirmado e salvo.');
  });

  it('voltar e corrigir fecha o resumo sem salvar', () => {
    render(<CollectionGrids {...PROPS} />);
    fillSource();
    fireEvent.click(screen.getByRole('tab', { name: 'Tema' }));
    fireEvent.change(screen.getByLabelText('Tema do culto'), { target: { value: 'Tema X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Conferir antes de salvar' }));

    const dialog = screen.getByRole('dialog', { name: 'Conferencia do insumo' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Voltar e corrigir' }));

    expect(
      screen.queryByRole('dialog', { name: 'Conferencia do insumo' }),
    ).not.toBeInTheDocument();
    const grid = screen.getByRole('grid', { name: 'Insumos do culto' });
    expect(within(grid).queryByText('Tema X')).not.toBeInTheDocument();
  });
});

describe('CollectionGrids - observacao exige classificacao (Requisito 4.7)', () => {
  it('bloqueia a conferencia de observacao sem classificacao e nao salva', () => {
    render(<CollectionGrids {...PROPS} />);
    fillSource();
    fireEvent.click(screen.getByRole('tab', { name: 'Observacoes' }));
    fireEvent.change(screen.getByLabelText('Observacao'), { target: { value: 'Avisar ensaio' } });

    fireEvent.click(screen.getByRole('button', { name: 'Conferir antes de salvar' }));

    expect(screen.getByRole('alert')).toHaveTextContent(/classificacao/i);
    expect(
      screen.queryByRole('dialog', { name: 'Conferencia do insumo' }),
    ).not.toBeInTheDocument();
  });

  it('com classificacao publica, confere e salva com visibilidade publica', () => {
    render(<CollectionGrids {...PROPS} />);
    fillSource();
    fireEvent.click(screen.getByRole('tab', { name: 'Observacoes' }));
    fireEvent.change(screen.getByLabelText('Observacao'), { target: { value: 'Culto especial' } });
    fireEvent.click(screen.getByLabelText('Publica'));

    fireEvent.click(screen.getByRole('button', { name: 'Conferir antes de salvar' }));
    const dialog = screen.getByRole('dialog', { name: 'Conferencia do insumo' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar insumo' }));

    const grid = screen.getByRole('grid', { name: 'Insumos do culto' });
    expect(within(grid).getByText(/Culto especial/)).toBeInTheDocument();
    expect(within(grid).getByText('Publico')).toBeInTheDocument();
  });
});

describe('CollectionGrids - proveniencia obrigatoria (Requisito 4.8)', () => {
  it('sem fonte, a conferencia e bloqueada e nada e salvo', () => {
    render(<CollectionGrids {...PROPS} />);
    // Nao preenche a fonte.
    fireEvent.click(screen.getByRole('tab', { name: 'Tema' }));
    fireEvent.change(screen.getByLabelText('Tema do culto'), { target: { value: 'Tema' } });
    fireEvent.click(screen.getByRole('button', { name: 'Conferir antes de salvar' }));

    expect(screen.getByRole('alert')).toHaveTextContent(/proveniencia|fonte/i);
    const grid = screen.getByRole('grid', { name: 'Insumos do culto' });
    expect(within(grid).getByText('Nenhum insumo registrado para este culto.')).toBeInTheDocument();
  });
});

describe('CollectionGrids - cardinalidade de sonoplastia (Requisito 4.3)', () => {
  it('bloqueia 0 pessoas e aceita 1 pessoa', () => {
    render(<CollectionGrids {...PROPS} />);
    fillSource();
    fireEvent.click(screen.getByRole('tab', { name: 'Sonoplastia' }));

    // 0 selecionadas -> bloqueio.
    fireEvent.click(screen.getByRole('button', { name: 'Conferir antes de salvar' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/1 a 20/);

    // 1 selecionada -> confere e salva.
    fireEvent.click(screen.getByLabelText('Ana'));
    fireEvent.click(screen.getByRole('button', { name: 'Conferir antes de salvar' }));
    const dialog = screen.getByRole('dialog', { name: 'Conferencia do insumo' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar insumo' }));

    const grid = screen.getByRole('grid', { name: 'Insumos do culto' });
    expect(within(grid).getByText('Ana')).toBeInTheDocument();
  });
});

describe('CollectionGrids - anciao por selecao de pessoa (Requisito 4.1)', () => {
  it('salva o anciao selecionado e permite remover', () => {
    render(<CollectionGrids {...PROPS} />);
    fillSource();
    // Tipo anciao e o default.
    fireEvent.change(screen.getByLabelText('Anciao responsavel'), { target: { value: 'p-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Conferir antes de salvar' }));
    const dialog = screen.getByRole('dialog', { name: 'Conferencia do insumo' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar insumo' }));

    const grid = screen.getByRole('grid', { name: 'Insumos do culto' });
    expect(within(grid).getByText('Bruno')).toBeInTheDocument();

    fireEvent.click(within(grid).getByRole('button', { name: 'Remover insumo elder' }));
    expect(within(grid).queryByText('Bruno')).not.toBeInTheDocument();
  });
});
