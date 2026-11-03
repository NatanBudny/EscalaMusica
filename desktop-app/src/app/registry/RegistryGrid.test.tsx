import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { RegistryGrid } from './RegistryGrid';

afterEach(() => cleanup());

/** Cadastra uma pessoa pelo painel, preenchendo nome e (opcional) telefone. */
function createPerson(name: string, phone?: string): void {
  fireEvent.click(screen.getByRole('button', { name: 'Nova pessoa' }));
  const form = screen.getByRole('form', { name: 'Cadastrar pessoa' });
  fireEvent.change(within(form).getByLabelText('Nome canonico'), { target: { value: name } });
  if (phone !== undefined) {
    fireEvent.change(within(form).getByLabelText(/Telefone/), { target: { value: phone } });
  }
  fireEvent.click(within(form).getByRole('button', { name: 'Salvar pessoa' }));
}

describe('RegistryGrid (grade e paineis acessiveis)', () => {
  beforeEach(() => cleanup());

  it('da foco ao primeiro campo ao abrir o painel de pessoa (gestao de foco)', () => {
    render(<RegistryGrid />);
    fireEvent.click(screen.getByRole('button', { name: 'Nova pessoa' }));
    const nameField = screen.getByLabelText('Nome canonico');
    expect(nameField).toHaveFocus();
  });

  it('cadastra uma pessoa e a exibe na grade', () => {
    render(<RegistryGrid />);
    createPerson('Ana Clara');
    const grid = screen.getByRole('grid', { name: 'Lista de cadastro' });
    expect(within(grid).getByText('Ana Clara')).toBeInTheDocument();
  });

  it('busca por alias filtra a grade', () => {
    render(<RegistryGrid />);
    // Cadastra pessoa com alias via colagem confirmada.
    fireEvent.click(screen.getByRole('button', { name: 'Nova pessoa' }));
    const form = screen.getByRole('form', { name: 'Cadastrar pessoa' });
    fireEvent.change(within(form).getByLabelText('Nome canonico'), { target: { value: 'Maria' } });
    fireEvent.change(within(form).getByLabelText('Novo apelido'), { target: { value: 'Mah' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Adicionar apelido' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Salvar pessoa' }));

    createPerson('Bruno');

    fireEvent.change(screen.getByLabelText('Buscar por nome ou apelido'), {
      target: { value: 'mah' },
    });
    const grid = screen.getByRole('grid', { name: 'Lista de cadastro' });
    expect(within(grid).getByText('Maria')).toBeInTheDocument();
    expect(within(grid).queryByText('Bruno')).not.toBeInTheDocument();
  });

  it('conflito de nome: impede gravacao, preserva os valores e aponta o conflito', () => {
    render(<RegistryGrid />);
    createPerson('Ana');

    // Tenta criar uma segunda pessoa com o mesmo nome (sem distincao de caixa).
    fireEvent.click(screen.getByRole('button', { name: 'Nova pessoa' }));
    const form = screen.getByRole('form', { name: 'Cadastrar pessoa' });
    const nameField = within(form).getByLabelText('Nome canonico');
    fireEvent.change(nameField, { target: { value: 'ANA' } });
    fireEvent.change(within(form).getByLabelText(/Telefone/), {
      target: { value: '+5511999998888' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Salvar pessoa' }));

    // Erro inline exibido e identifica o conflito.
    const alert = within(form).getByRole('alert');
    expect(alert).toHaveTextContent(/coincide|conflita/i);
    expect(alert).toHaveTextContent(/Ana/);

    // Estado preservado apos o erro: os valores digitados permanecem.
    expect(within(form).getByLabelText('Nome canonico')).toHaveValue('ANA');
    expect(within(form).getByLabelText(/Telefone/)).toHaveValue('+5511999998888');
    // A grade ainda tem apenas uma Ana.
    const grid = screen.getByRole('grid', { name: 'Lista de cadastro' });
    expect(within(grid).getAllByText(/ana/i)).toHaveLength(1);
  });

  it('cancelar o painel fecha o formulario sem cadastrar', () => {
    render(<RegistryGrid />);
    fireEvent.click(screen.getByRole('button', { name: 'Nova pessoa' }));
    const form = screen.getByRole('form', { name: 'Cadastrar pessoa' });
    fireEvent.change(within(form).getByLabelText('Nome canonico'), { target: { value: 'Temp' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('form', { name: 'Cadastrar pessoa' })).not.toBeInTheDocument();
    const grid = screen.getByRole('grid', { name: 'Lista de cadastro' });
    expect(within(grid).queryByText('Temp')).not.toBeInTheDocument();
  });

  it('edicao inline de telefone: Enter salva o valor', () => {
    render(<RegistryGrid />);
    createPerson('Carlos');

    fireEvent.click(screen.getByRole('button', { name: 'Editar telefone de Carlos' }));
    const phoneField = screen.getByLabelText('Telefone de Carlos');
    fireEvent.change(phoneField, { target: { value: '+5511988887777' } });
    fireEvent.keyDown(phoneField, { key: 'Enter' });

    const grid = screen.getByRole('grid', { name: 'Lista de cadastro' });
    expect(within(grid).getByText('+5511988887777')).toBeInTheDocument();
  });

  it('edicao inline de telefone: telefone invalido mostra erro e preserva o anterior', () => {
    render(<RegistryGrid />);
    createPerson('Diana', '+5511900001111');

    fireEvent.click(screen.getByRole('button', { name: 'Editar telefone de Diana' }));
    const phoneField = screen.getByLabelText('Telefone de Diana');
    fireEvent.change(phoneField, { target: { value: '12345' } });
    fireEvent.keyDown(phoneField, { key: 'Enter' });

    // Erro inline exibido; a edicao permanece aberta com o valor invalido.
    expect(screen.getByRole('alert')).toHaveTextContent(/formato|algarismos/i);

    // O servico preservou o telefone anterior: ao cancelar a edicao, a grade
    // volta a exibir o valor original (nenhuma mutacao foi aplicada).
    fireEvent.keyDown(screen.getByLabelText('Telefone de Diana'), { key: 'Escape' });
    const grid = screen.getByRole('grid', { name: 'Lista de cadastro' });
    expect(within(grid).getByText('+5511900001111')).toBeInTheDocument();
  });

  it('edicao inline de telefone: Escape cancela sem alterar', () => {
    render(<RegistryGrid />);
    createPerson('Eva', '+5511900002222');

    fireEvent.click(screen.getByRole('button', { name: 'Editar telefone de Eva' }));
    const phoneField = screen.getByLabelText('Telefone de Eva');
    fireEvent.change(phoneField, { target: { value: '+5511000000000' } });
    fireEvent.keyDown(phoneField, { key: 'Escape' });

    const grid = screen.getByRole('grid', { name: 'Lista de cadastro' });
    expect(within(grid).getByText('+5511900002222')).toBeInTheDocument();
    expect(within(grid).queryByText('+5511000000000')).not.toBeInTheDocument();
  });

  it('navegacao por teclado move a linha ativa com as setas', () => {
    render(<RegistryGrid />);
    createPerson('Ana');
    createPerson('Bruno');

    const grid = screen.getByRole('grid', { name: 'Lista de cadastro' });
    const dataRows = () =>
      within(grid)
        .getAllByRole('row')
        .filter((r) => r.getAttribute('data-active') !== null);

    // Primeira linha ativa por padrao.
    expect(dataRows()[0]).toHaveAttribute('data-active', 'true');

    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    expect(dataRows()[1]).toHaveAttribute('data-active', 'true');
    expect(dataRows()[0]).toHaveAttribute('data-active', 'false');

    fireEvent.keyDown(grid, { key: 'ArrowUp' });
    expect(dataRows()[0]).toHaveAttribute('data-active', 'true');
  });

  it('desativa uma pessoa pela acao da grade', () => {
    render(<RegistryGrid />);
    createPerson('Fabio');
    fireEvent.click(screen.getByRole('button', { name: 'Desativar Fabio' }));
    const grid = screen.getByRole('grid', { name: 'Lista de cadastro' });
    const row = within(grid).getByText('Fabio').closest('[role="row"]')!;
    expect(within(row as HTMLElement).getByText('Inativo')).toBeInTheDocument();
  });

  it('departamento: cadastra e conflito com pessoa existente e bloqueado (namespace global)', () => {
    render(<RegistryGrid />);
    createPerson('Louvor');

    fireEvent.click(screen.getByRole('button', { name: 'Novo departamento' }));
    const form = screen.getByRole('form', { name: 'Cadastrar departamento' });
    expect(within(form).getByLabelText('Nome canonico')).toHaveFocus();
    fireEvent.change(within(form).getByLabelText('Nome canonico'), { target: { value: 'louvor' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Salvar departamento' }));

    expect(within(form).getByRole('alert')).toHaveTextContent(/coincide|conflita/i);
  });
});
