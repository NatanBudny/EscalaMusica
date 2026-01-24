# Escala de Música - Igreja

Este projeto é uma aplicação web simples e eficiente para visualizar a escala de louvor e música da igreja. Ele permite que os membros da equipe consultem suas escalas, filtrem por datas ou funções e acessem as informações de forma rápida e responsiva, tanto no computador quanto no celular.

##  Funcionalidades

-   **Visualização Clara**: Exibe a escala completa em formato de tabela (desktop) ou cartões (mobile).
-   **Busca Inteligente**: Campo de busca que encontra nomes em qualquer campo da escala.
-   **Minhas Escalas**: Visualização personalizada mostrando apenas quando você está escalado.
-   **Filtros Dinâmicos**: Permite filtrar a escala por qualquer coluna (Data, Regente, Equipe, etc.).
-   **Links para WhatsApp**: Clique em qualquer nome para abrir conversa no WhatsApp.
-   **Modo Escuro**: Tema escuro para melhor experiência visual.
-   **Dados Sempre Atualizados**: O sistema carrega os dados de arquivos JSON, garantindo facilidade na atualização.
-   **Responsivo**: Design adaptável que funciona bem em qualquer tamanho de tela.

##  Como Funciona

O sistema é uma página estática (`index.html`) que lê os dados de arquivos JSON na raiz do projeto.

1.  Ao abrir a página, o sistema busca os arquivos `atual.json` e `contatos.json`.
2.  Os dados são processados e exibidos na tela.
3.  Os menus de filtro são gerados automaticamente com base nas informações presentes na escala.
4.  As preferências do usuário (nome, modo escuro) são salvas no navegador.

##  Como Atualizar a Escala

Para atualizar a escala, você não precisa mexer no código. Siga estes passos:

1.  Abra sua planilha de escala (Excel, Google Sheets, etc.).
2.  Exporte a planilha como **JSON** (ou converta de CSV para JSON).
3.  Renomeie o arquivo para `atual.json`.
4.  Substitua o arquivo existente na raiz do projeto pelo novo arquivo.
5.  Faça o commit e push das alterações para o repositório.

**Importante:** Mantenha a estrutura das colunas consistente para garantir que a tabela seja exibida corretamente.

**Estrutura esperada do JSON:**
```json
[
  {
    "DATA": "03/01/2026",
    "DIA SEMANA": "sábado",
    "ACOMP": "PB",
    "REGENTE LOUVOR": "ANDRÉ",
    "EQUIPE LOUVOR": "ARIADNY, GIOVANA, LUIS",
    ...
  }
]
```

##  Como Atualizar Contatos

O arquivo `contatos.json` contém os telefones e apelidos dos membros. Para adicionar ou atualizar:

1.  Edite o arquivo `contatos.json`.
2.  Adicione ou modifique entradas no formato:
```json
{
  "NOME": {
    "telefone": "https://wa.me/5511999999999",
    "apelidos": ["APELIDO1", "APELIDO2"]
  }
}
```

##  Tecnologias Utilizadas

-   **HTML5 & CSS3**: Estrutura e estilização da página.
-   **JavaScript (Vanilla)**: Lógica de carregamento, processamento e filtragem dos dados.
-   **LocalStorage**: Armazenamento de preferências do usuário no navegador.

##  Estrutura do Projeto

-   `index.html`: A aplicação principal.
-   `atual.json`: O arquivo de dados da escala atual.
-   `contatos.json`: Arquivo com telefones e apelidos dos membros.
-   `local.py`: Script Python para rodar servidor local de desenvolvimento.
-   `old/`: Pasta destinada ao arquivamento de escalas antigas.

##  Como Usar

### Desenvolvimento Local

Execute o servidor Python:
```bash
python local.py
```

Ou use qualquer servidor HTTP simples:
```bash
python -m http.server 8000
```

Acesse `http://localhost:8000` no navegador.

### Produção

O projeto está configurado para GitHub Pages. Basta fazer push para a branch `main` e o site será atualizado automaticamente.

##  Funcionalidades em Destaque

### Busca por Nome
Digite qualquer nome no campo de busca para encontrar todas as escalas onde essa pessoa aparece.

### Minhas Escalas
Clique no botão de perfil (ícone de pessoa) para ver apenas suas escalas. Na primeira vez, você será solicitado a informar seu nome, que será salvo para uso futuro.

### Modo Escuro
Clique no botão de tema (ícone de sol/lua) para alternar entre modo claro e escuro. A preferência é salva automaticamente.

### Filtros Inteligentes
Os filtros agora suportam busca parcial em campos de lista (como Equipe de Louvor), facilitando encontrar escalas mesmo com nomes parciais.