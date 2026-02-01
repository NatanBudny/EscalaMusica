# Resumo do Projeto - Escala de Louvor

## 1. Visão Geral
Este projeto gerencia a escala de louvor de uma igreja. O objetivo é usar o histórico de dados e um conjunto de regras para gerar sugestões de escalas de forma inteligente e consistente.

## 2. Estrutura de Dados
- **`atual.json`**: Contém a escala do período vigente ou futuro.
- **`contatos.json`**: Mapeia nomes de participantes a seus contatos e apelidos.
- **`old/`**: Diretório com o histórico das escalas passadas (arquivos `.json` e `.csv`).

---

## 3. Diretrizes de Geração de Escala

### A. Regras Estruturais e de Formatação
- **Nomes**: Todos os nomes de participantes devem estar em **MAIÚSCULAS**.
- **Composição da Equipe**: A escala padrão é **1 Regente + 5 cantores**.
  - A equipe de louvor deve ter no mínimo **2 homens**.
- **Afinidade com Banda**: *[Diretriz adicionada]* Membros com baixa afinidade para cantar com banda serão priorizados em dias de PB. (Nenhum membro especificado até o momento).
- **Campos a Ignorar**: O campo `AUDIOVISUAL` não deve ser preenchido, pois é gerenciado por outro departamento.

### B. Status de Disponibilidade (Atual)
- **Indisponíveis (Longo Prazo)**:
  - `JUNIOR` (pausa até ~08/2026).
  - `BRUNA` (mesmo motivo do JUNIOR).
- **Indisponíveis (Temporário)**:
  - `CATHERINE` (saúde, indisponível até **20/02/2026**).
  - `ANDRÉ` (viagem, indisponível até 06/2026).
- **Disponibilidade Especial**:
  - `FABÍOLA`: Frequência ocasional (membro de outra igreja).
  - `LUIZ DA SILVA` e `ARIADNY`: Alta disponibilidade, mas **não devem ser escalados juntos** para promover variedade.

### C. Regras Específicas de Membros
- `ANISSA`: Canta apenas aos **sábados** e com frequência reduzida.
- `MIRELLA` & `MARCELLA`: Só podem ser escaladas para o louvor se `NILSON` também estiver na escala do mesmo dia (seja como regente ou na equipe). Para a mensagem musical, podem se apresentar sozinhas.
- **Regra de Rotação Específica**:
  - Para a escala atual, priorizar que `LUIZ DA SILVA`, `RAISSA`, e `MARAIR` apareçam em dias distintos (apenas um dia para cada).

### D. Prioridades de Escalação
- Os seguintes nomes devem ser priorizados nas sugestões de louvor, respeitando suas disponibilidades:
  - `EMILY`
  - `KHEYCIANE`
  - `FABRICIO`
  - `GIOVANA`
  - `ARIADNY`
  - `LUIS`
  - `FABRÍCIO`
  - `ANISSA` (respeitando a regra do sábado)
  - `CATHERINE` (somente após 20/02/2026)

---
*Este resumo deve ser a fonte primária de regras ao gerar ou modificar escalas.*