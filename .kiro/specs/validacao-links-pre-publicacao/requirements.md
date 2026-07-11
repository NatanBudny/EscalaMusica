# Requirements Document

## Introduction

Este documento especifica os requisitos para a funcionalidade de validação pré-publicação (trava) que impede a publicação de uma escala (`atual.json`) caso algum participante do ministério de louvor não possua um contato de WhatsApp resolvido. A feature inclui também o conceito de vinculação, que permite que nomes coletivos (ex: "FAMILIA NILSINHO") sejam associados ao contato de uma pessoa específica, eliminando falsos positivos na validação.

## Glossary

- **Sistema_Validacao**: Módulo responsável por verificar se todos os participantes escalados possuem contato de WhatsApp resolvível antes de permitir a publicação.
- **Participante**: Pessoa ou entidade que aparece nos campos `REGENTE LOUVOR`, `EQUIPE LOUVOR` ou `MENSAGEM MUSICAL` da escala.
- **Contato_Resolvido**: Um participante cujo link de WhatsApp (wa.me) pode ser determinado — seja por entrada direta em `contatos.json`, por correspondência de apelido, ou por vinculação.
- **Vinculacao**: Mapeamento configurável que associa um nome coletivo/grupo a um contato existente em `contatos.json`, permitindo que o nome coletivo herde o link de WhatsApp desse contato.
- **Nome_Coletivo**: Entrada na escala que representa um grupo ou departamento (ex: "FAMILIA NILSINHO", "QUARTETO") e não uma pessoa individual.
- **Departamento**: Entrada na escala que representa um departamento da igreja assumindo o louvor de um culto inteiro (ex: "JOVENS", "MELHOR IDADE", "AVENTUREIROS"). Departamentos são identificados pela regra RF015 — quando o PREGADOR é um departamento, os campos de louvor recebem o nome do departamento.
- **Publicacao**: Ato de promover a escala para uso oficial, incluindo a geração do arquivo `links-whatsapp.md`.
- **Arquivo_Vinculacoes**: Arquivo de configuração (JSON) que armazena os mapeamentos de vinculação entre nomes coletivos e contatos existentes.

## Requirements

### Requisito 1: Validação de contatos antes da publicação

**User Story:** Como diretor do ministério de louvor, eu quero que a publicação seja bloqueada quando existem participantes sem contato de WhatsApp resolvível, para que eu nunca publique uma escala sem conseguir notificar todos os envolvidos.

#### Critérios de Aceitação

1. WHEN o processo de publicação é iniciado, THE Sistema_Validacao SHALL extrair todos os nomes únicos dos campos `REGENTE LOUVOR`, `EQUIPE LOUVOR` e `MENSAGEM MUSICAL` de todos os cultos da escala, ignorando valores vazios ("") e valores "-".
2. WHEN o processo de publicação é iniciado, THE Sistema_Validacao SHALL tentar resolver o contato de WhatsApp de cada Participante utilizando, nesta ordem de precedência e parando no primeiro método bem-sucedido: (a) correspondência exata pelo nome em `contatos.json`, (b) correspondência por apelido em `contatos.json`, (c) correspondência por Vinculacao no Arquivo_Vinculacoes.
3. IF todos os Participantes extraídos possuem Contato_Resolvido ou estão isentos por serem Departamento, THEN THE Sistema_Validacao SHALL permitir a continuidade do processo de publicação.
4. IF ao menos um Participante não possui Contato_Resolvido e não está isento, THEN THE Sistema_Validacao SHALL bloquear a publicação e exibir uma lista contendo cada nome sem contato resolvível acompanhado das datas dos cultos onde aparece.
5. WHILE um Participante corresponde a um Departamento que assumiu o louvor do culto (conforme RF015), THE Sistema_Validacao SHALL isentar esse Participante da obrigatoriedade de Contato_Resolvido.

### Requisito 2: Cadastro de vinculações

**User Story:** Como diretor do ministério de louvor, eu quero cadastrar vinculações entre nomes coletivos e contatos existentes, para que grupos como "FAMILIA NILSINHO" sejam resolvidos automaticamente sem precisar criar entradas duplicadas em `contatos.json`.

#### Critérios de Aceitação

1. THE Sistema_Validacao SHALL manter um Arquivo_Vinculacoes em formato JSON que armazena pares de nome coletivo e nome do contato de destino, com no máximo 200 entradas.
2. WHEN uma vinculação é cadastrada com um contato de destino que existe em `contatos.json`, THE Sistema_Validacao SHALL registrar o par no Arquivo_Vinculacoes e confirmar o cadastro com sucesso.
3. IF uma vinculação é cadastrada com um contato de destino inexistente em `contatos.json`, THEN THE Sistema_Validacao SHALL rejeitar o cadastro e exibir mensagem de erro indicando que o contato de destino não foi encontrado.
4. WHEN o Sistema_Validacao resolve o contato de um Nome_Coletivo via vinculação, THE Sistema_Validacao SHALL utilizar o link de WhatsApp do contato de destino vinculado.
5. THE Arquivo_Vinculacoes SHALL seguir o formato: `{ "NOME_COLETIVO": "NOME_CONTATO_DESTINO", ... }`.
6. WHEN uma vinculação é cadastrada com um nome coletivo que já existe no Arquivo_Vinculacoes, THE Sistema_Validacao SHALL sobrescrever a vinculação anterior com o novo contato de destino.
7. THE Sistema_Validacao SHALL comparar nomes coletivos e nomes de contato de destino de forma case-insensitive, normalizando ambos para letras maiúsculas antes da busca.

### Requisito 3: Isenção de departamentos

**User Story:** Como diretor do ministério de louvor, eu quero que departamentos que assumem o louvor de um culto inteiro sejam automaticamente isentos da validação de contato, para que a publicação não seja bloqueada por entradas que representam departamentos e não indivíduos.

#### Critérios de Aceitação

1. WHEN o campo `PREGADOR` de um culto contém um valor que coincide (comparação case-insensitive, com trim) com os campos `REGENTE LOUVOR` e `EQUIPE LOUVOR`, e o campo `EQUIPE LOUVOR` contém um único valor sem vírgulas, THE Sistema_Validacao SHALL classificar esse valor como Departamento para aquele culto, aplicando a isenção a todos os campos cujo conteúdo seja idêntico ao valor do `PREGADOR`.
2. WHILE um nome é classificado como Departamento em um culto, THE Sistema_Validacao SHALL excluir esse nome da busca em `contatos.json` naquele culto, não gerando alerta de contato ausente e não bloqueando a geração de links de WhatsApp para esse culto.
3. WHEN um nome aparece como Departamento em um culto e como participante individual (escalado nominalmente em `REGENTE LOUVOR`, `EQUIPE LOUVOR` ou `MENSAGEM MUSICAL` sem que o `PREGADOR` corresponda a esse nome) em outro culto, THE Sistema_Validacao SHALL validar o contato apenas para os cultos onde o nome aparece como participante individual.
4. IF o campo `MENSAGEM MUSICAL` de um culto departamental contiver um valor diferente do `PREGADOR`, THEN THE Sistema_Validacao SHALL tratar o valor distinto de `MENSAGEM MUSICAL` como participante individual e aplicar a validação de contato normalmente para esse nome naquele culto.

### Requisito 4: Relatório de validação

**User Story:** Como diretor do ministério de louvor, eu quero receber um relatório claro indicando quais participantes falharam na validação e por quê, para que eu saiba exatamente o que corrigir antes de tentar publicar novamente.

#### Critérios de Aceitação

1. WHEN a validação detecta Participantes sem Contato_Resolvido, THE Sistema_Validacao SHALL gerar um relatório agrupado por Participante, contendo para cada um: o nome do Participante, a lista de datas dos cultos em que está escalado (excluindo cultos onde o nome é classificado como Departamento), e as funções que exerce nesses cultos, ordenados alfabeticamente pelo nome do Participante.
2. WHEN a validação detecta Participantes sem Contato_Resolvido, THE Sistema_Validacao SHALL exibir, junto a cada Participante no relatório, as duas ações corretivas aplicáveis: cadastrar o contato diretamente em `contatos.json` ou criar uma vinculação no Arquivo_Vinculacoes associando o nome a um contato existente.
3. WHEN a validação é bem-sucedida (todos os Participantes possuem Contato_Resolvido), THE Sistema_Validacao SHALL informar a quantidade total de Participantes validados (excluindo Departamentos isentos) e a quantidade resolvida por cada método (direto, apelido, vinculação).
4. IF a escala não contém nenhum Participante sujeito a validação (todos os cultos são de quarta-feira ou todos os nomes são Departamentos isentos), THEN THE Sistema_Validacao SHALL informar que nenhum participante requer validação de contato e permitir a continuidade da publicação.

### Requisito 5: Campos de cultos de quarta-feira não são validados

**User Story:** Como diretor do ministério de louvor, eu quero que cultos de quarta-feira sejam ignorados na validação, pois não há escala própria de louvor nesses dias.

#### Critérios de Aceitação

1. WHILE o campo `DIA SEMANA` de um culto é "quarta-feira", THE Sistema_Validacao SHALL ignorar os campos `REGENTE LOUVOR`, `EQUIPE LOUVOR`, `MENSAGEM MUSICAL` e `SUPORTE` desse culto, não extraindo nenhum nome deles para validação de participantes.
2. IF os campos `REGENTE LOUVOR`, `EQUIPE LOUVOR`, `MENSAGEM MUSICAL` ou `SUPORTE` de um culto de quarta-feira contêm valores vazios ("") ou "-", THEN THE Sistema_Validacao SHALL considerar esses valores como não-aplicáveis e não gerar erro de validação para eles.
3. WHILE o campo `DIA SEMANA` de um culto é "quarta-feira", THE Sistema_Validacao SHALL continuar validando normalmente os campos de origem externa (`ANCIÃO`, `PREGADOR`, `AUDIOVISUAL`) desse culto conforme as demais regras aplicáveis.

### Requisito 6: Resolução de nomes compostos separados por vírgula

**User Story:** Como diretor do ministério de louvor, eu quero que o sistema resolva corretamente campos que contêm múltiplos nomes separados por vírgula, para que cada pessoa dentro de um campo composto seja validada individualmente.

#### Critérios de Aceitação

1. WHEN um campo de louvor (REGENTE LOUVOR, EQUIPE LOUVOR ou MENSAGEM MUSICAL) contém múltiplos nomes separados por vírgula, THE Sistema_Validacao SHALL separar os nomes usando a vírgula como delimitador, remover espaços em branco no início e no fim de cada nome resultante, e validar cada nome individualmente contra o cadastro de contatos (por nome canônico ou apelido).
2. IF um nome individual dentro de um campo composto não é encontrado no cadastro de contatos (nem como nome canônico, nem como apelido), THEN THE Sistema_Validacao SHALL reportar o nome específico que falhou na resolução, identificando o campo e a data do culto em que o nome aparece, sem reportar os demais nomes do mesmo campo que foram resolvidos com sucesso.
3. WHEN um campo composto contém um valor de departamento ou grupo (por exemplo, "JOVENS", "QUARTETO", "MELHOR IDADE") sem vírgula, THE Sistema_Validacao SHALL tratar o campo como valor único de grupo e não aplicar separação por vírgula nem validação individual de nomes.
