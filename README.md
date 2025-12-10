# Escala de Música - Igreja

Este projeto é uma aplicação web simples e eficiente para visualizar a escala de louvor e música da igreja. Ele permite que os membros da equipe consultem suas escalas, filtrem por datas ou funções e acessem as informações de forma rápida e responsiva, tanto no computador quanto no celular.

##  Funcionalidades

-   **Visualização Clara**: Exibe a escala completa em formato de tabela (desktop) ou cartões (mobile).
-   **Filtros Dinâmicos**: Permite filtrar a escala por qualquer coluna (Data, Regente, Equipe, etc.).
-   **Busca Rápida**: Encontre rapidamente quando você está escalado.
-   **Dados Sempre Atualizados**: O sistema carrega os dados de um arquivo CSV, garantindo facilidade na atualização.
-   **Responsivo**: Design adaptável que funciona bem em qualquer tamanho de tela.

##  Como Funciona

O sistema é uma página estática (`index.html`) que lê os dados de um arquivo `atual.csv` localizado na pasta `docs/`.

1.  Ao abrir a página, o sistema busca o arquivo `atual.csv`.
2.  Os dados são processados e exibidos na tela.
3.  Os menus de filtro são gerados automaticamente com base nas informações presentes na escala.

##  Como Atualizar a Escala

Para atualizar a escala, você não precisa mexer no código. Siga estes passos:

1.  Abra sua planilha de escala (Excel, Google Sheets, etc.).
2.  Salve ou exporte a planilha como **CSV (Separado por vírgulas)**.
3.  Renomeie o arquivo para `atual.csv`.
4.  Substitua o arquivo existente na pasta `docs/` pelo novo arquivo.
5.  Faça o commit e push das alterações para o repositório.

**Importante:** Mantenha a estrutura das colunas consistente para garantir que a tabela seja exibida corretamente.

##  Tecnologias Utilizadas

-   **HTML5 & CSS3**: Estrutura e estilização da página.
-   **JavaScript (Vanilla)**: Lógica de carregamento, processamento e filtragem dos dados.
-   **[PapaParse](https://www.papaparse.com/)**: Biblioteca para processamento de arquivos CSV.

##  Estrutura do Projeto

-   `docs/`: Contém os arquivos públicos do site.
    -   `index.html`: O código da aplicação.
    -   `atual.csv`: O arquivo de dados da escala atual.
-   `old/`: Pasta destinada ao arquivamento de escalas antigas.