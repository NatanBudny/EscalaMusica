# Resumo do Projeto - Escala de Louvor

## 1. Visão Geral

Este projeto é um sistema de gerenciamento e visualização para a escala de atividades de uma igreja, com foco principal no ministério de louvor. A interface (`index.html`) permite visualizar, pesquisar e filtrar as escalas. O objetivo principal, para futuras interações, é usar o histórico de dados para sugerir e pré-preencher novas escalas de forma inteligente.

## 2. Arquivos Principais e Estrutura de Dados

-   **`index.html`**: A aplicação web (frontend). É um arquivo único que carrega os dados dos arquivos JSON e os exibe de forma interativa. Possui funcionalidades de busca, filtros, login e confirmação de presença.
-   **`atual.json`**: Contém a escala do período **vigente ou futuro**. É uma lista de objetos JSON, onde cada objeto representa um evento/culto.
-   **`contatos.json`**: Um dicionário que mapeia nomes de participantes para seus contatos (link de WhatsApp) e uma lista de `apelidos`. **Este arquivo é crucial para normalizar e identificar os participantes corretamente.**
-   **`old/`**: Diretório que armazena o histórico das escalas.
    -   **`old/2026/*.json`**: Histórico a partir de 2026, seguindo o mesmo formato de `atual.json`.
    -   **`old/2025/*.csv`**: Histórico de 2025 em formato CSV. O schema é similar, mas requer atenção às pequenas diferenças nos nomes das colunas (ex: `MENSAGEM MUSCAL`).
-   **`local.py`**: Um script Python simples para iniciar um servidor web local e facilitar o desenvolvimento/visualização do `index.html`.

### Estrutura do Objeto de Escala (JSON)

Cada evento é um objeto com as seguintes chaves principais:

-   `DATA`: "dd/mm/aaaa"
-   `DIA SEMANA`: "sábado", "domingo", etc.
-   `ACOMP`: Acompanhamento musical. Valores comuns são **"BANDA"** ou **"PB"** (Playback).
-   `REGENTE LOUVOR`: Nome do regente principal.
-   `EQUIPE LOUVOR`: Nomes dos cantores, separados por vírgula.
-   `MENSAGEM MUSICAL`: Nome do participante ou grupo.
-   `PREGADOR`: Nome do pregador.
-   `AUDIOVISUAL`, `ANCIÃO`, `SUPORTE`: Outras funções de apoio.
-   `OBS`: Observações gerais sobre o evento (ex: "10 dias de oração", "Ministério Jovem").

---

## 3. Análise do Histórico e Pessoas-Chave

Esta seção é a base para futuras sugestões. É um resumo extraído dos arquivos de `old/`.

### Participantes Frequentes por Função

-   **Regentes de Louvor:**
    -   GIOVANA
    -   CATHERINE
    -   FABRÍCIO
    -   ANDRÉ
    -   SUELLEN
    -   NILSINHO
    -   JOÁS (com a família)

-   **Equipe de Louvor (Vozes):**
    -   *Base Frequente:* LUIS, ARIADNY, EMILY, FABRÍCIO, JUNIOR, CATHERINE, GIOVANA.
    -   *Participações Recorrentes:* DANY KALLAS, SIRLENE, GABRIEL P., HELOISE, JEMELLI, KHEYCI, BRUNA, VANDERLEY.

-   **Mensagem Musical:**
    -   ALEX
    -   JUNIOR
    -   SILVANA
    -   DANI HERREIRA
    -   IGOR DUARTE
    -   FABRICIO
    -   Ministérios específicos (M. MULHER, M. JOVEM).

-   **Pregadores:**
    -   PR. HOFNI (recorrente)
    -   CLEVERSON
    -   RICARDO
    -   ADELMO
    -   ENOQUE
    -   Participações de líderes de ministérios (SUELLEN, DULCE, etc.).

-   **Audiovisual:**
    -   ALEX
    -   DIEGO
    -   RICARDO
    -   SAMUEL
    -   LUIS

### Padrões de Eventos e Acompanhamento

-   **Acompanhamento (Banda vs. PB):**
    -   A **BANDA** é mais frequente aos **sábados e domingos**.
    -   O **PB** (Playback) é frequentemente utilizado em domingos e em eventos de ministérios específicos (M. Mulher, M. Criança).
    -   A escolha parece alternar, raramente há dois cultos seguidos no mesmo fim de semana (sábado/domingo) com o mesmo tipo de acompanhamento.

-   **Dias de Culto:**
    -   As escalas são principalmente para **Sábados** e **Domingos**.
    -   **Quartas-feiras** aparecem em `atual.json` como dias de culto, mas sem escala musical preenchida no histórico.
    -   Eventos especiais como "10 dias de oração" ou "Semana de Oração Jovem" ocorrem em dias de semana consecutivos.

-   **Eventos Especiais / Ministérios:**
    -   Existem escalas dedicadas a ministérios específicos, onde eles assumem todas as funções: `M. MULHER`, `M. JOVEM`, `M. CRIANÇA`.
    -   Eventos como "Sábado Total Jovem" e "Domingo do Poder" são recorrentes.

---

## 4. Como Usar Este Resumo (Instruções para o Assistente)

1.  **Priorize este Arquivo:** Ao receber uma solicitação para criar ou sugerir uma escala, consulte a seção `3. Análise do Histórico` deste arquivo primeiro. Isso economiza tokens e tempo.
2.  **Sugestão de Nomes:** Baseie as sugestões de nomes para cada função na lista de `Participantes Frequentes`. Tente variar as combinações para não repetir sempre as mesmas pessoas.
3.  **Banda ou PB:** Para decidir entre `BANDA` e `PB`, verifique a escala do dia anterior ou da mesma semana para promover uma alternância. Sábados e domingos são os dias mais prováveis para a banda.
4.  **Normalização de Nomes:** Ao analisar nomes, sempre considere os `apelidos` definidos em `contatos.json` para evitar duplicatas e identificar corretamente os participantes.
5.  **Leitura Adicional:** Só leia os arquivos JSON/CSV completos (`atual.json`, `old/*`) se o usuário pedir um dado muito específico que não esteja neste resumo (ex: "Quais foram os louvores exatos cantados em 17/01/2026?").