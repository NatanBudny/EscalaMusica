# Requirements Document

## Introduction

A funcionalidade **gestao-leiga-de-escalas** deve permitir que uma pessoa sem conhecimento de inteligência artificial, programação, linha de comando ou estrutura interna do repositório prepare, confira e publique as escalas da igreja. A operação deve preservar o visualizador atual hospedado no GitHub Pages e manter a publicação por arquivos estáticos.

Este documento descreve necessidades e resultados esperados para um aplicativo instalado, compatível com Windows e macOS e utilizável em mais de uma máquina. As escolhas técnicas internas serão feitas na fase de design depois da confirmação das perguntas abertas remanescentes.

### Fluxo atual compreendido

O fluxo mensal atual combina tarefas manuais e scripts Node.js:

1. O diretor cria a pasta mensal e prepara arquivos JSON de acionado, sonoplastia e indisponibilidade.
2. A indisponibilidade coletada pelo WhatsApp é convertida em JSON e vinculada ao cadastro por comparação aproximada de nomes.
3. O solver usa `pessoas.json`, histórico, indisponibilidades e dados externos para gerar `rascunho.md` e uma justificativa.
4. O diretor revisa e altera o Markdown, executa validações separadas e promove o rascunho para `atual.json`.
5. A publicação arquiva a escala anterior, gera links de WhatsApp e remove parte dos artefatos mensais.
6. O operador ainda precisa conferir arquivos, atualizar registros e controles, criar commit e enviar alterações ao GitHub.
7. Um push na branch `main` aciona o workflow que publica o repositório como conteúdo estático no GitHub Pages.
8. O visualizador carrega `atual.json` e `contatos.json` no navegador, mantém cache local, oferece login Google, filtros, links de WhatsApp e exportação de agenda.

### Limitações atuais observadas

- A operação exige edição direta de JSON e Markdown, execução de comandos e conhecimento de Git.
- Parte da entrada de indisponibilidade depende de conversão assistida por IA, apesar de existir um manual que pretende não depender de IA.
- Dados de pessoas, contatos, habilitações e regras aparecem em fontes canônicas, derivadas e legadas que podem divergir.
- Os modelos de acionado e sonoplastia aceitam estruturas diferentes, e nem todas as etapas consomem os mesmos campos.
- A comparação aproximada pode associar um nome à pessoa errada. Um artefato real associou um nome de André ao cadastro de Dani, enquanto o relatório manual registrava André.
- O validador de rascunho cobre apenas parte das regras e consulta um nome de propriedade diferente daquele produzido pelo vinculador de indisponibilidade, o que pode gerar aprovação incorreta.
- O fechamento altera `atual.json` antes de executar todas as validações e pode apagar insumos e rascunhos antes da confirmação do deploy.
- A publicação no GitHub, a confirmação do deploy, o registro oficial e os controles de rotação não formam uma transação única.
- A escala vigente pode existir em produção mesmo com falhas detectáveis. A validação atual de observações públicas encontra quatro registros sem o prefixo exigido no `atual.json` vigente.
- A autenticação do visualizador é executada no navegador e não restringe o download direto dos arquivos estáticos.
- O workflow atual envia o repositório inteiro para o artefato do GitHub Pages, o que exige uma definição explícita de quais dados pessoais podem ser públicos.
- Alterações posteriores à publicação exigem edição direta de `atual.json`.
- A documentação contém caminhos legados, sequências divergentes e atividades ainda dependentes do conhecimento do diretor atual.

### Decisões já confirmadas

- A funcionalidade é nova e segue a abordagem de requisitos primeiro.
- O operador-alvo não deve depender de IA nem de conhecimento técnico.
- O Visualizador_Atual para membros deve continuar funcionando.
- A distribuição pública deve continuar compatível com hospedagem estática.
- A solução deve buscar baixo custo recorrente.
- A fase atual não altera código de produção.
- A forma principal de operação será um aplicativo instalado, compatível com Windows e macOS e utilizável em mais de uma máquina.
- A publicação oferecerá integração direta com GitHub e exportação guiada como alternativa.
- Uma única pessoa exercerá as responsabilidades de operação, aprovação e publicação.
- Anciãos, pregadores e sonoplastia serão recebidos em PDF e digitados manualmente na primeira versão.
- A primeira versão sugerirá automaticamente uma Escala completa, sujeita a revisão e alteração manual.
- Telefones podem permanecer nos Dados_Publicos, sujeitos à autorização e classificação previstas neste documento.
- O Git será a fonte principal do estado persistente e do histórico; cópias locais não serão a fonte principal.
- A gestão usará um Repositorio_Privado_Gestao separado do Repositorio_Publico_Site.
- As regras atuais serão consolidadas em uma única fonte versionada.
- Toda exceção exigirá justificativa.
- A publicação somente será concluída depois da verificação do resultado no Site_Publico.
- A homologação do treinamento exigirá uma Escala_Simulada completa, executada sem ajuda técnica.
- O aplicativo realizará commit e push por um Fluxo_Git_Guiado, sem linha de comando.

### Escopo

Inclui operação mensal, cadastro, dados externos, indisponibilidade, montagem manual, eventual sugestão opcional, validação, pré-visualização, publicação, segurança, credenciais, recuperação, backup, documentação, treinamento e transição de responsabilidade.

Não inclui nesta fase a substituição do visualizador para membros, o envio automático de mensagens pelo WhatsApp, a contratação de infraestrutura paga ou a implementação da funcionalidade.

## Glossário

- **Sistema_de_Gestao_Leiga**: Aplicativo instalado usado para preparar e publicar escalas sem edição de código ou uso obrigatório de IA, compatível com Windows e macOS.
- **Operador**: Única pessoa treinada e autorizada a manter dados, montar escalas, aprovar versões e executar publicações.
- **Aprovador**: Responsabilidade de aprovação exercida pela mesma pessoa definida como Operador.
- **Aplicativo_Instalado**: Distribuição do Sistema_de_Gestao_Leiga executada em Windows ou macOS.
- **Repositorio_Privado_Gestao**: Repositório Git privado que constitui a fonte principal do estado persistente, regras, histórico e dados administrativos do Sistema_de_Gestao_Leiga.
- **Repositorio_Publico_Site**: Repositório Git público separado que contém somente o Artefato_Estatico destinado ao Visualizador_Atual.
- **Fluxo_Git_Guiado**: Controles do Sistema_de_Gestao_Leiga que preparam commit e push sem exigir linha de comando do Operador.
- **Site_Publico**: Endereço público do GitHub Pages no qual o resultado do Repositorio_Publico_Site é verificado.
- **Escala_Simulada**: Escala completa com dados fictícios usada para homologar o treinamento sem alterar a Escala vigente.
- **Ciclo_Mensal**: Conjunto de etapas de abertura, coleta, montagem, validação, aprovação, publicação e fechamento de uma escala mensal.
- **Culto**: Evento religioso identificado por data e tipo, incluindo quarta-feira, sábado, domingo ou evento extraordinário.
- **Escala**: Conjunto de Cultos e respectivas atribuições de pessoas ou departamentos.
- **Rascunho**: Versão editável de uma Escala que ainda não alterou a publicação vigente.
- **Previa_Publica**: Representação do Rascunho com somente os dados que seriam exibidos aos membros.
- **Visualizador_Atual**: Página estática já hospedada no GitHub Pages e alimentada por `atual.json` e `contatos.json`.
- **Cadastro_Central**: Fonte única de pessoas, contatos, aliases, estados, habilitações, disponibilidades permanentes e vínculos.
- **Pessoa_Canonica**: Registro único de uma pessoa no Cadastro_Central.
- **Departamento**: Unidade da igreja que pode ocupar funções da Escala sem representar uma pessoa individual.
- **Insumo_Externo**: Dado recebido de outro departamento, incluindo ancião, pregador, sonoplastia, músicas da Escola Sabatina, tema, pedido de música e observação pública.
- **Indisponibilidade**: Restrição declarada para uma Pessoa_Canonica em uma data, conjunto de datas ou intervalo.
- **Conjunto_de_Regras_Ativo**: Versão aprovada e identificada das regras fundamentais, restrições pessoais e preferências usadas em um Ciclo_Mensal.
- **Regra_Fundamental**: Regra bloqueante cuja violação invalida a Escala, salvo quando existir uma Excecao_Aprovada aplicável.
- **Preferencia_de_Escala**: Regra não bloqueante usada para qualidade, equilíbrio e rotação.
- **Excecao_Aprovada**: Exceção documentada, identificada e vigente para uma Regra_Fundamental.
- **Validador**: Parte do Sistema_de_Gestao_Leiga que verifica estrutura, dados e regras.
- **Bloqueio**: Erro que impede aprovação ou publicação.
- **Aviso**: Situação que exige ciência do Operador, mas não impede publicação.
- **Dados_Publicos**: Dados aprovados para inclusão no Artefato_Estatico.
- **Dados_Privados**: Dados administrativos, pessoais ou operacionais não aprovados para publicação estática.
- **Artefato_Estatico**: Conjunto de arquivos públicos consumidos pelo Visualizador_Atual sem servidor de aplicação em produção.
- **Pacote_de_Publicacao**: Versão validada e identificada do Artefato_Estatico, acompanhada do resumo da validação e da versão de origem.
- **Publicador**: Parte do Sistema_de_Gestao_Leiga que prepara ou envia o Pacote_de_Publicacao pelo procedimento aprovado.
- **Gerenciador_de_Credenciais**: Parte responsável por obter, guardar, usar e remover credenciais de publicação.
- **Registro_de_Auditoria**: Histórico de ações relevantes com data, responsável, alvo e resultado.
- **Backup**: Versão ou cópia identificada dos dados necessária para restaurar um estado anterior, mantida no Repositorio_Privado_Gestao quando integrar o estado persistente oficial.
- **Importador_de_Dados**: Parte opcional que interpreta arquivos externos conforme formato documentado.
- **Exportador_de_Dados**: Parte que gera arquivos portáveis e artefatos compatíveis.
- **Formatador_Canonico**: Parte que apresenta um arquivo suportado em estrutura estável e legível.
- **Material_de_Treinamento**: README e materiais associados para instalação, operação, manutenção e transição.
- **Modo_de_Treinamento**: Ambiente com dados fictícios que não altera Dados_Publicos nem a Escala vigente.

## Requirements

### Requirement 1: Operação guiada para pessoa não técnica

**User Story:** Como sucessor da liderança de música, quero executar o ciclo mensal por um fluxo guiado, para que eu não dependa do líder anterior, de IA ou de conhecimento de programação.

#### Critérios de Aceitação

1. THE Sistema_de_Gestao_Leiga SHALL permitir ao Operador concluir as sete etapas do Ciclo_Mensal usando somente os controles apresentados pelo sistema, sem editar diretamente código, JSON ou Markdown.
2. THE Sistema_de_Gestao_Leiga SHALL permitir ao Operador concluir as sete etapas do Ciclo_Mensal sem executar comandos em linha de comando.
3. THE Sistema_de_Gestao_Leiga SHALL permitir ao Operador concluir as sete etapas do Ciclo_Mensal sem usar IA.
4. WHEN um Operador iniciar um Ciclo_Mensal, THE Sistema_de_Gestao_Leiga SHALL apresentar as etapas na ordem de abertura, coleta, montagem, validação, aprovação, publicação e fechamento.
5. WHILE um Ciclo_Mensal estiver aberto, THE Sistema_de_Gestao_Leiga SHALL identificar a etapa atual e, para cada pendência bloqueante, a ação não concluída e o motivo que impede o avanço para a etapa seguinte.
6. WHEN uma etapa for concluída, THE Sistema_de_Gestao_Leiga SHALL registrar no Ciclo_Mensal a etapa concluída, seu resultado, a data e a hora da conclusão e o Operador responsável.
7. IF uma ação do fluxo exigir edição de código, JSON ou Markdown, execução em linha de comando ou conhecimento da estrutura interna do repositório, THEN THE Sistema_de_Gestao_Leiga SHALL bloquear a ação, preservar os dados já registrados e apresentar em português o motivo do bloqueio e um procedimento que permita realizar o mesmo objetivo usando somente os controles apresentados pelo sistema.
8. WHEN o Operador solicitar ajuda em uma etapa, THE Sistema_de_Gestao_Leiga SHALL apresentar em português o objetivo da etapa atual, os dados necessários, as ações na ordem de execução e as condições observáveis para considerar a etapa concluída.
9. THE Sistema_de_Gestao_Leiga SHALL ser distribuído como Aplicativo_Instalado compatível com Windows e macOS.
10. WHEN o Operador instalar o Sistema_de_Gestao_Leiga em uma segunda máquina autorizada, THE Sistema_de_Gestao_Leiga SHALL permitir a retomada do estado persistente obtido do Repositorio_Privado_Gestao sem exigir cópia manual de arquivos da primeira máquina.
11. THE Sistema_de_Gestao_Leiga SHALL permitir que o mesmo Operador execute as ações de operação, aprovação e publicação previstas no Ciclo_Mensal.

### Requirement 2: Abertura e controle do ciclo mensal

**User Story:** Como Operador, quero abrir uma escala a partir do mês desejado, para que as datas e os dados do período sejam preparados sem sobrescrever trabalho existente.

#### Critérios de Aceitação

1. WHEN o Operador informar um ano inteiro de 1 a 9999 e um mês inteiro de 1 a 12, THE Sistema_de_Gestao_Leiga SHALL criar exatamente um Ciclo_Mensal identificado de forma única pela combinação do ano e do mês informados.
2. IF já existir um Ciclo_Mensal para a combinação de ano e mês informada, THEN THE Sistema_de_Gestao_Leiga SHALL abrir o único ciclo existente sem criar outro ciclo e sem alterar seus dados, seu Rascunho ou seu estado.
3. WHEN um Ciclo_Mensal for criado, THE Sistema_de_Gestao_Leiga SHALL gerar exatamente uma ocorrência de cada data pertencente ao mês informado que corresponda a uma quarta-feira, sábado ou domingo, sem gerar automaticamente datas de outros dias da semana.
4. WHEN o Operador confirmar a adição de um Culto extraordinário com uma data válida pertencente ao período do Ciclo_Mensal, THE Sistema_de_Gestao_Leiga SHALL incluir exatamente uma ocorrência desse Culto no Rascunho sem alterar as datas já existentes.
5. WHEN o Operador solicitar a remoção de uma data gerada e informar um motivo com 1 a 500 caracteres após a desconsideração dos espaços nas extremidades, THE Sistema_de_Gestao_Leiga SHALL remover a data e registrar o motivo no Ciclo_Mensal.
6. WHEN uma data de Culto válida for informada, THE Sistema_de_Gestao_Leiga SHALL calcular pelo calendário gregoriano e associar à data o dia da semana correspondente.
7. IF o dia da semana informado divergir do dia calculado pelo calendário gregoriano para a data, THEN THE Sistema_de_Gestao_Leiga SHALL registrar um Bloqueio para a data, impedir a confirmação da alteração e preservar o estado anterior do Ciclo_Mensal.
8. THE Sistema_de_Gestao_Leiga SHALL atribuir a cada Ciclo_Mensal exatamente um dos estados mutuamente exclusivos aberto, publicado ou arquivado, considerando aberto somente o ciclo cujo Rascunho seja editável e cuja versão atual não tenha publicação confirmada, publicado somente o ciclo cuja versão confirmada corresponda à Escala vigente e não permita edição direta, e arquivado somente o ciclo que não corresponda à Escala vigente e permita apenas leitura.
9. IF o ano informado não for um inteiro de 1 a 9999 ou o mês informado não for um inteiro de 1 a 12, THEN THE Sistema_de_Gestao_Leiga SHALL rejeitar a abertura, preservar todos os ciclos existentes e indicar qual valor está fora do intervalo permitido.
10. IF o motivo da remoção estiver ausente, contiver somente espaços ou exceder 500 caracteres após a desconsideração dos espaços nas extremidades, THEN THE Sistema_de_Gestao_Leiga SHALL impedir a remoção, preservar a data e seus dados e indicar a condição que impediu a remoção.

### Requirement 3: Cadastro central de pessoas, departamentos e contatos

**User Story:** Como Operador, quero manter nomes, contatos e habilitações em um cadastro único, para que a escala e as comunicações usem dados consistentes.

#### Critérios de Aceitação

1. THE Cadastro_Central SHALL manter para cada Pessoa_Canonica um identificador que não mude após a criação, um nome canônico de 1 a 120 caracteres, no máximo 20 aliases de 1 a 120 caracteres cada, no máximo um telefone, um estado de participação entre ativo e inativo e, sem duplicidade, uma habilitação para cada função aplicável definida pelo Conjunto_de_Regras_Ativo.
2. THE Cadastro_Central SHALL manter para cada Pessoa_Canonica um conjunto sem duplicidade de zero a sete dias da semana permitidos para escala.
3. THE Cadastro_Central SHALL manter para cada Pessoa_Canonica no máximo 1.000 períodos de afastamento, cada um com uma data inicial obrigatória e uma data final opcional que, quando informada, seja igual ou posterior à data inicial.
4. THE Cadastro_Central SHALL manter para cada Pessoa_Canonica no máximo 50 vínculos vigentes, cada um com o tipo de vínculo previsto pelo Conjunto_de_Regras_Ativo e a referência a outra Pessoa_Canonica.
5. THE Cadastro_Central SHALL representar cada Departamento separadamente de Pessoa_Canonica, com identificador que não mude após a criação, nome canônico de 1 a 120 caracteres, no máximo 20 aliases de 1 a 120 caracteres cada e estado entre ativo e inativo.
6. WHEN o Operador cadastrar ou alterar um nome canônico ou alias, THE Cadastro_Central SHALL remover espaços no início e no fim, substituir cada sequência interna de espaços por um único espaço e preservar as demais letras e sinais informados.
7. IF um nome canônico ou alias, após a normalização, coincidir sem distinção entre letras maiúsculas e minúsculas com o nome canônico ou alias de outra Pessoa_Canonica ou Departamento, THEN THE Cadastro_Central SHALL impedir a gravação, preservar o registro anterior e apresentar uma indicação de duplicidade que identifique o registro conflitante.
8. IF um telefone não começar pelo sinal de adição seguido de 8 a 15 algarismos, contiver outro caractere ou não atender ao formato internacional configurado, THEN THE Cadastro_Central SHALL impedir a gravação, preservar o telefone anterior e apresentar uma indicação de formato inválido.
9. WHEN o Operador desativar uma Pessoa_Canonica, THE Cadastro_Central SHALL impedir novas atribuições da pessoa e preservar suas atribuições em escalas existentes, vínculos, afastamentos e registros de auditoria.
10. WHEN o Operador alterar um registro, THE Cadastro_Central SHALL registrar, para cada campo alterado, o valor anterior, o valor posterior, a data e a hora da alteração e o Operador responsável no Registro_de_Auditoria.
11. WHEN dados públicos de contato forem gerados, THE Exportador_de_Dados SHALL derivar do Cadastro_Central somente o identificador, o nome canônico e o telefone das Pessoas_Canonicas ativas cujo contato esteja aprovado como Dado_Publico.
12. THE Exportador_de_Dados SHALL excluir dos dados públicos de contato aliases não aprovados como Dados_Publicos, estados de participação, habilitações, dias permitidos, períodos de afastamento, vínculos, notas administrativas e dados do Registro_de_Auditoria.
13. IF uma exclusão de Pessoa_Canonica remover referências usadas por regras, vínculos, escalas ou histórico, THEN THE Cadastro_Central SHALL bloquear a exclusão, preservar o registro e suas referências e apresentar a desativação como alternativa.
14. IF o Operador informar uma data final de afastamento anterior à data inicial ou tentar exceder 1.000 períodos de afastamento para uma Pessoa_Canonica, THEN THE Cadastro_Central SHALL impedir a gravação, preservar os períodos existentes e apresentar uma indicação da condição inválida.
15. IF um vínculo referenciar a mesma Pessoa_Canonica nas duas extremidades, repetir outro vínculo vigente do mesmo tipo ou usar um tipo ausente do Conjunto_de_Regras_Ativo, THEN THE Cadastro_Central SHALL impedir a gravação, preservar os vínculos existentes e apresentar uma indicação da condição inválida.

### Requirement 4: Coleta de dados externos e indisponibilidades

**User Story:** Como Operador, quero lançar os dados recebidos de cada departamento e as indisponibilidades por data, para que o Rascunho use informações completas e rastreáveis.

#### Critérios de Aceitação

1. WHEN o Operador editar um Culto, THE Sistema_de_Gestao_Leiga SHALL permitir o registro do ancião responsável por seleção de uma Pessoa_Canonica.
2. WHEN o Operador editar um Culto, THE Sistema_de_Gestao_Leiga SHALL permitir o registro do pregador responsável por seleção de uma Pessoa_Canonica ou de um Departamento.
3. WHEN o Operador editar um Culto, THE Sistema_de_Gestao_Leiga SHALL permitir o registro de 1 a 20 Pessoas_Canonicas responsáveis por audiovisual ou sonoplastia.
4. WHEN o Operador editar um Culto, THE Sistema_de_Gestao_Leiga SHALL permitir o registro de até 50 músicas externas da Escola Sabatina, com título de 1 a 200 caracteres para cada música.
5. WHEN o Operador editar um Culto, THE Sistema_de_Gestao_Leiga SHALL permitir o registro de um tema do culto com 1 a 200 caracteres.
6. WHEN o Operador editar um Culto, THE Sistema_de_Gestao_Leiga SHALL permitir o registro de até 20 pedidos de música recebidos do pregador, com descrição de 1 a 200 caracteres para cada pedido.
7. WHEN o Operador registrar uma observação, THE Sistema_de_Gestao_Leiga SHALL exigir a classificação da observação como pública ou privada antes de salvá-la.
8. WHEN o Operador registrar um Insumo_Externo, THE Sistema_de_Gestao_Leiga SHALL registrar a fonte, a data da atualização e o Operador responsável.
9. WHEN o Operador registrar uma Indisponibilidade, THE Sistema_de_Gestao_Leiga SHALL exigir a seleção de exatamente uma Pessoa_Canonica e de uma ou mais datas do Ciclo_Mensal ou de um intervalo inclusivo com data inicial e data final.
10. WHEN o Operador registrar indisponibilidade para o período inteiro, THE Sistema_de_Gestao_Leiga SHALL aplicar a restrição a todas as datas existentes ou adicionadas posteriormente ao mesmo Ciclo_Mensal.
11. WHEN uma regra de vínculo propagar uma Indisponibilidade, THE Sistema_de_Gestao_Leiga SHALL identificar a Indisponibilidade de origem e mostrar cada Pessoa_Canonica e cada data afetada pela propagação.
12. WHERE importação de Insumo_Externo estiver habilitada, IF um nome importado corresponder a mais de uma Pessoa_Canonica ou Departamento, THE Importador_de_Dados SHALL manter o item pendente e exigir que o Operador selecione exatamente uma das correspondências antes de aplicar a associação.
13. IF um nome importado não corresponder a exatamente uma Pessoa_Canonica ou Departamento, THEN THE Importador_de_Dados SHALL manter o item pendente, não aplicar a associação e preservar os dados existentes.
14. WHEN uma importação terminar, THE Importador_de_Dados SHALL apresentar, para cada item de origem, a classificação como aceito, corrigido, pendente ou rejeitado, o motivo da classificação e os totais separados por classificação.
15. IF um campo exigido pelo Conjunto_de_Regras_Ativo estiver ausente, THEN THE Validador SHALL registrar um Bloqueio para o Culto correspondente e identificar o campo ausente.
16. IF uma Indisponibilidade contiver uma data fora do Ciclo_Mensal ou um intervalo cuja data final seja anterior à data inicial, THEN THE Sistema_de_Gestao_Leiga SHALL rejeitar o registro, preservar as indisponibilidades existentes e indicar a data ou o intervalo inválido.
17. WHEN o Operador alterar ou remover um Insumo_Externo ou uma Indisponibilidade, THE Sistema_de_Gestao_Leiga SHALL registrar no Registro_de_Auditoria os valores anteriores e posteriores, a data da alteração e o Operador responsável.
18. WHEN o Operador receber em PDF os dados de anciãos, pregadores ou sonoplastia, THE Sistema_de_Gestao_Leiga SHALL permitir a digitação manual dos dados correspondentes usando somente os controles apresentados pelo sistema.
19. THE Sistema_de_Gestao_Leiga SHALL considerar a digitação manual dos dados de anciãos, pregadores e sonoplastia recebidos em PDF como o procedimento completo de entrada da primeira versão.
20. WHEN o Operador concluir a digitação manual de dados recebidos em PDF, THE Sistema_de_Gestao_Leiga SHALL apresentar os dados digitados para conferência antes de confirmar o Insumo_Externo.

### Requirement 5: Montagem manual e sugestão automática revisável

**User Story:** Como Operador, quero lançar nomes por data e receber ajuda verificável, para que eu mantenha controle sobre a escala sem precisar entender o solver atual.

#### Critérios de Aceitação

1. WHEN o Operador selecionar um Culto, THE Sistema_de_Gestao_Leiga SHALL permitir incluir, substituir e remover atribuições de regente, equipe de louvor, mensagem musical, suporte e acompanhamento no Rascunho.
2. WHEN o Operador preencher uma função individual, THE Sistema_de_Gestao_Leiga SHALL permitir a seleção de uma Pessoa_Canonica habilitada para a função ou, quando o Conjunto_de_Regras_Ativo permitir responsabilidade departamental nessa função, de um Departamento.
3. WHEN o Operador pesquisar uma pessoa por nome canônico ou alias completo, THE Sistema_de_Gestao_Leiga SHALL apresentar todas as Pessoas_Canonicas cujo nome canônico ou alias corresponda à pesquisa e identificar cada resultado pelo nome canônico.
4. WHEN o Operador selecionar uma pessoa para uma função e uma data, THE Sistema_de_Gestao_Leiga SHALL mostrar a habilitação para a função, o estado de disponibilidade na data e cada conflito identificado com a respectiva Regra_Fundamental ou Preferencia_de_Escala do Conjunto_de_Regras_Ativo.
5. THE Sistema_de_Gestao_Leiga SHALL permitir a revisão e o preenchimento de todas as atribuições da Escala por escolhas manuais do Operador, sem exigir a aceitação das sugestões automáticas.
6. WHEN o Operador ignorar uma sugestão automática, THE Sistema_de_Gestao_Leiga SHALL manter a atribuição atual do Rascunho e o Cadastro_Central inalterados.
7. WHEN o Sistema_de_Gestao_Leiga apresentar uma sugestão automática, THE Sistema_de_Gestao_Leiga SHALL identificar a função, o Culto, cada pessoa ou Departamento sugerido, as regras e disponibilidades consideradas e os registros históricos que influenciaram a sugestão.
8. WHEN forem fornecidos o mesmo Rascunho, Cadastro_Central, Insumos_Externos, histórico e versão do Conjunto_de_Regras_Ativo, THE Sistema_de_Gestao_Leiga SHALL apresentar as mesmas sugestões automáticas na mesma ordem.
9. WHEN o Operador consultar candidatos para uma função, THE Sistema_de_Gestao_Leiga SHALL mostrar, para cada candidato, a quantidade e as datas de atribuições anteriores consideradas pelas regras de rotação do Conjunto_de_Regras_Ativo para essa função.
10. WHEN o Operador escolher uma atribuição que contrarie uma Preferencia_de_Escala, THE Sistema_de_Gestao_Leiga SHALL exigir uma justificativa não vazia e registrar a justificativa com a atribuição antes de salvar a escolha.
11. IF uma escolha violar uma Regra_Fundamental sem Excecao_Aprovada vigente e aplicável à função, pessoa ou Departamento e data, THEN THE Sistema_de_Gestao_Leiga SHALL impedir a confirmação, preservar o Rascunho anterior à tentativa e indicar a regra violada e a atribuição rejeitada.
12. WHEN o pregador for um Departamento reconhecido, THE Sistema_de_Gestao_Leiga SHALL aplicar às atribuições do Culto as responsabilidades departamentais definidas pelo Conjunto_de_Regras_Ativo e mostrar ao Operador quais funções passaram a ser responsabilidade do Departamento.
13. WHEN os dados obrigatórios de um Ciclo_Mensal estiverem completos, THE Sistema_de_Gestao_Leiga SHALL gerar automaticamente uma sugestão completa para todas as atribuições exigidas em todos os Cultos do Rascunho.
14. WHEN o Sistema_de_Gestao_Leiga gerar uma sugestão completa, THE Sistema_de_Gestao_Leiga SHALL manter cada atribuição sugerida em estado editável para revisão, substituição ou remoção manual pelo Operador antes da validação e aprovação.
15. IF o Sistema_de_Gestao_Leiga não encontrar uma atribuição que atenda às Regras_Fundamentais para uma função, THEN THE Sistema_de_Gestao_Leiga SHALL identificar a função e o Culto sem atribuição, apresentar as Regras_Fundamentais que impediram a sugestão e manter o Rascunho editável.

### Requirement 6: Governança e versionamento das regras

**User Story:** Como responsável pelo processo, quero uma única versão identificada das regras em cada escala, para que validações e decisões não dependam de documentos divergentes.

#### Critérios de Aceitação

1. THE Sistema_de_Gestao_Leiga SHALL manter para cada Ciclo_Mensal a associação com exatamente um Conjunto_de_Regras_Ativo aprovado e identificado por uma versão única.
2. WHEN um Ciclo_Mensal for criado, THE Sistema_de_Gestao_Leiga SHALL registrar o identificador da versão do Conjunto_de_Regras_Ativo e preservar essa associação durante todo o ciclo.
3. WHEN uma regra for alterada, THE Sistema_de_Gestao_Leiga SHALL criar uma nova versão identificada do conjunto de regras sem modificar versões anteriores nem as associações de Ciclos_Mensais existentes.
4. WHEN uma regra for alterada, THE Sistema_de_Gestao_Leiga SHALL registrar o autor, a data e a hora, o motivo, o conteúdo anterior e o conteúdo posterior da alteração.
5. IF a vigência de uma regra não incluir nenhuma data de Culto do Ciclo_Mensal, THEN THE Validador SHALL desconsiderar a regra em todas as validações desse ciclo.
6. IF duas regras da versão proposta prescreverem resultados mutuamente incompatíveis para a mesma condição, função e Culto, THEN THE Validador SHALL impedir a ativação da versão proposta, preservar a versão ativa anterior e identificar as duas regras e a condição conflitante.
7. WHEN uma Excecao_Aprovada for cadastrada, THE Sistema_de_Gestao_Leiga SHALL registrar um identificador único, a Regra_Fundamental afetada, a condição de aplicação, as datas inicial e final de vigência, a justificativa, o Aprovador e a data e a hora da aprovação.
8. IF a data do Culto não estiver entre as datas inicial e final de vigência de uma Excecao_Aprovada, inclusive, THEN THE Validador SHALL rejeitar o uso da exceção, preservar os dados do Rascunho e indicar a exceção e a vigência não atendida.
9. THE Material_de_Treinamento SHALL identificar, para a proposição, revisão, aprovação e retirada de regras, o responsável, os dados obrigatórios, a ordem das ações e a condição observável de conclusão de cada etapa.
10. IF uma versão do conjunto de regras não possuir aprovação registrada com responsável, data e hora, THEN THE Sistema_de_Gestao_Leiga SHALL impedir sua designação para um Ciclo_Mensal, preservar a associação vigente e indicar os dados de aprovação ausentes.
11. WHEN o Validador avaliar um Ciclo_Mensal, THE Validador SHALL usar exclusivamente a versão do conjunto de regras registrada para esse ciclo.
12. WHEN uma nova versão do conjunto de regras for aprovada, THE Sistema_de_Gestao_Leiga SHALL registrar seu identificador único, o responsável pela aprovação, a data e a hora da aprovação e as datas inicial e final de vigência.
13. THE Repositorio_Privado_Gestao SHALL manter o Conjunto_de_Regras_Ativo como a única fonte versionada usada para montagem, sugestão, validação e auditoria de regras.
14. WHEN as regras atuais forem migradas, THE Sistema_de_Gestao_Leiga SHALL consolidar as regras reconhecidas em uma única versão inicial do Conjunto_de_Regras_Ativo e registrar a origem e a decisão aplicada a cada divergência encontrada.
15. IF uma regra usada pela operação não estiver presente na versão do Conjunto_de_Regras_Ativo associada ao Ciclo_Mensal, THEN THE Validador SHALL rejeitar o uso da regra e identificar a ausência na fonte única versionada.
16. WHEN uma exceção for solicitada, THE Sistema_de_Gestao_Leiga SHALL exigir uma justificativa de 1 a 1.000 caracteres após a desconsideração dos espaços nas extremidades antes de registrar a Excecao_Aprovada.

### Requirement 7: Validação completa e compreensível

**User Story:** Como Operador, quero receber bloqueios e avisos em linguagem direta antes da publicação, para que erros não cheguem ao Visualizador_Atual.

#### Critérios de Aceitação

1. WHEN o Operador alterar um campo do Rascunho, THE Validador SHALL reavaliar todas as regras do Conjunto_de_Regras_Ativo que usem esse campo, substituir os resultados anteriores dessas regras pelos novos resultados e identificar a revisão validada do Rascunho.
2. WHEN o Operador solicitar validação completa, THE Validador SHALL verificar cada Culto e cada atribuição do Rascunho contra todas as regras aplicáveis do Conjunto_de_Regras_Ativo registrado no Ciclo_Mensal.
3. WHEN o Validador encontrar um problema, THE Validador SHALL informar o Culto e a data afetados, a função ou o campo afetado, o valor ou a atribuição que causou o problema, a regra aplicável, a severidade, o motivo e a ação necessária para atender à regra.
4. WHEN o Validador encontrar uma Regra_Fundamental violada, THE Validador SHALL classificar o resultado como Bloqueio.
5. WHEN o Validador encontrar uma Preferencia_de_Escala não atendida, THE Validador SHALL classificar o resultado como Aviso.
6. IF uma data aparecer mais de uma vez no Rascunho, THEN THE Validador SHALL registrar um Bloqueio para cada ocorrência duplicada e identificar os Cultos envolvidos.
7. IF um nome individual não corresponder de forma única a uma Pessoa_Canonica, THEN THE Validador SHALL registrar um Bloqueio e manter a atribuição sem associação automática.
8. IF uma equipe de louvor de culto normal não contiver a quantidade definida pelo Conjunto_de_Regras_Ativo, THEN THE Validador SHALL registrar um Bloqueio.
9. IF uma equipe de louvor não atender à composição de gênero definida pelo Conjunto_de_Regras_Ativo, THEN THE Validador SHALL registrar um Bloqueio.
10. IF uma quarta-feira contiver função própria de louvor, THEN THE Validador SHALL registrar um Bloqueio.
11. IF uma quarta-feira não contiver cada dado externo obrigatório definido pelo Conjunto_de_Regras_Ativo, THEN THE Validador SHALL registrar um Bloqueio e identificar cada dado ausente.
12. IF um sábado não contiver cada mensagem musical exigida pelo Conjunto_de_Regras_Ativo, THEN THE Validador SHALL registrar um Bloqueio e identificar cada mensagem ausente.
13. IF uma Pessoa_Canonica estiver indisponível para a data de uma atribuição, THEN THE Validador SHALL registrar um Bloqueio para a atribuição.
14. IF uma Pessoa_Canonica ocupar funções classificadas como incompatíveis pelo Conjunto_de_Regras_Ativo no mesmo Culto, THEN THE Validador SHALL registrar um Bloqueio e identificar as funções conflitantes.
15. IF uma função externa conflitar com uma função própria do louvor e não existir Excecao_Aprovada vigente para o ancião, o Culto e as funções conflitantes, THEN THE Validador SHALL registrar um Bloqueio e identificar as funções conflitantes.
16. IF uma atribuição destinar uma função a uma Pessoa_Canonica sem a habilitação exigida ou em um dia não permitido no Cadastro_Central, THEN THE Validador SHALL registrar um Bloqueio e identificar a restrição violada.
17. IF uma atribuição violar uma regra de sequência entre Cultos, THEN THE Validador SHALL registrar a severidade definida para essa regra no Conjunto_de_Regras_Ativo e identificar os Cultos e as atribuições envolvidos.
18. IF uma Pessoa_Canonica ultrapassar o limite mensal de mensagem musical definido pelo Conjunto_de_Regras_Ativo, THEN THE Validador SHALL registrar um Bloqueio e informar o limite e a quantidade de atribuições no Ciclo_Mensal.
19. IF um Departamento assumir o louvor e algum campo exigido pela regra departamental do Conjunto_de_Regras_Ativo estiver ausente ou não atender aos valores permitidos pela regra, THEN THE Validador SHALL registrar um Bloqueio e identificar cada campo afetado.
20. IF uma observação pública contiver conteúdo classificado como Dado_Privado, THEN THE Validador SHALL registrar um Bloqueio e identificar a observação afetada sem expor o conteúdo privado no resultado apresentado.
21. IF uma observação pública não atender à convenção pública do Conjunto_de_Regras_Ativo, THEN THE Validador SHALL registrar um Bloqueio e identificar a condição não atendida.
22. IF uma Pessoa_Canonica que receberá comunicação não tiver contato público aprovado no Cadastro_Central, THEN THE Validador SHALL registrar um Aviso e identificar a pessoa e cada atribuição afetada.
23. WHILE existir um Bloqueio para a revisão atual do Rascunho ou a validação completa dessa revisão não tiver terminado, THE Publicador SHALL manter a publicação desabilitada.
24. WHEN a validação completa terminar, THE Validador SHALL apresentar a revisão do Rascunho e a versão do Conjunto_de_Regras_Ativo validadas, os totais separados de Bloqueios, Avisos e verificações aprovadas e a relação individual de cada resultado.
25. IF o Validador não conseguir concluir qualquer verificação por ausência, invalidade ou indisponibilidade dos dados necessários, THEN THE Validador SHALL registrar um Bloqueio, identificar a verificação não concluída e os dados afetados, preservar o Rascunho sem alterações e informar a ação necessária para repetir a validação.

### Requirement 8: Pré-visualização e aprovação

**User Story:** Como Aprovador, quero ver o resultado que será publicado e as diferenças para a versão vigente, para que eu confirme conscientemente a mudança.

#### Critérios de Aceitação

1. WHEN uma validação completa do Rascunho terminar sem Bloqueios, THE Sistema_de_Gestao_Leiga SHALL gerar uma Previa_Publica identificada e vinculada à versão validada do Rascunho sem alterar o Artefato_Estatico vigente.
2. THE Previa_Publica SHALL apresentar todos os Cultos e, para cada Culto, todos os Dados_Publicos que integrarão o Pacote_de_Publicacao correspondente.
3. THE Previa_Publica SHALL excluir todos os campos classificados como Dados_Privados.
4. WHEN existir uma Escala vigente, THE Previa_Publica SHALL identificar cada inclusão, alteração e remoção em relação à Escala vigente, indicando o Culto, o campo afetado e os valores anterior e novo aplicáveis.
5. WHEN a Previa_Publica for gerada, THE Sistema_de_Gestao_Leiga SHALL apresentar o período, a versão do Rascunho, a versão do Conjunto_de_Regras_Ativo, a data e a hora de geração e o Operador responsável pela geração.
6. WHEN a Previa_Publica contiver Avisos, THE Sistema_de_Gestao_Leiga SHALL exigir que o Aprovador registre ciência de cada Aviso antes de permitir a aprovação.
7. WHEN o Aprovador confirmar uma Previa_Publica vinculada à versão atual do Rascunho e sem Bloqueios, THE Sistema_de_Gestao_Leiga SHALL registrar no Registro_de_Auditoria a identificação da Previa_Publica, o período, a versão do Rascunho, a versão do Conjunto_de_Regras_Ativo, o Aprovador, a data e a hora da aprovação e os Avisos reconhecidos.
8. IF o Rascunho mudar depois da aprovação, THEN THE Sistema_de_Gestao_Leiga SHALL invalidar a aprovação anterior, impedir seu uso na publicação e exigir nova validação completa, nova Previa_Publica e nova aprovação.
9. IF o período da Previa_Publica divergir do período selecionado para publicação, THEN THE Publicador SHALL bloquear a publicação, preservar a Escala vigente e informar os dois períodos divergentes.
10. IF o Aprovador tentar aprovar sem uma Previa_Publica vinculada à versão atual do Rascunho, com Bloqueios ou sem registrar ciência de cada Aviso, THEN THE Sistema_de_Gestao_Leiga SHALL rejeitar a aprovação, preservar o Rascunho e informar cada condição que impede a aprovação.
11. WHEN o Operador aprovar uma Previa_Publica, THE Sistema_de_Gestao_Leiga SHALL registrar o Operador como Aprovador da mesma Previa_Publica.

### Requirement 9: Compatibilidade de dados, importação e exportação

**User Story:** Como mantenedor, quero importar dados existentes e exportar arquivos estáveis, para que a nova operação preserve o histórico e continue alimentando o site atual.

#### Critérios de Aceitação

1. WHEN o Exportador_de_Dados gerar `atual.json`, THE Exportador_de_Dados SHALL incluir todos os campos públicos obrigatórios, tipos de valor e valores permitidos definidos na especificação documentada de entrada do Visualizador_Atual.
2. WHEN o Exportador_de_Dados gerar `contatos.json`, THE Exportador_de_Dados SHALL incluir todos os campos públicos obrigatórios, tipos de valor e valores permitidos definidos na especificação documentada de entrada do Visualizador_Atual.
3. WHEN o Artefato_Estatico for disponibilizado em hospedagem de arquivos estáticos, THE Visualizador_Atual SHALL carregar `atual.json` e `contatos.json` e apresentar seus dados públicos sem depender de servidor de aplicação em produção.
4. WHEN dados existentes forem migrados, THE Importador_de_Dados SHALL preservar todas as datas, funções, associações com pessoas reconhecidas, departamentos, observações públicas e entradas de histórico, admitindo somente transformações previstas na especificação documentada do formato de origem.
5. WHERE um formato de arquivo for aceito como entrada, WHEN o Operador solicitar sua importação, THE Importador_de_Dados SHALL validar todos os registros do arquivo contra a especificação documentada desse formato antes de alterar dados existentes.
6. IF um arquivo de entrada ou qualquer registro nele contido não atender à especificação documentada, THEN THE Importador_de_Dados SHALL rejeitar a importação completa, preservar todos os dados existentes e indicar que nenhuma alteração foi aplicada.
7. IF um valor de entrada for inválido, THEN THE Importador_de_Dados SHALL informar o arquivo, a posição identificável do registro, o campo e o motivo da rejeição para cada valor inválido encontrado.
8. WHEN o Formatador_Canonico receber dados semanticamente equivalentes no mesmo formato suportado, THE Formatador_Canonico SHALL gerar conteúdo idêntico, exceto pelos metadados de geração expressamente identificados como variáveis na especificação documentada.
9. WHEN um arquivo gerado pelo Exportador_de_Dados for importado novamente, THE Importador_de_Dados SHALL reconstruir todas as entidades, valores e associações exportados sem acréscimos, perdas ou alterações, desconsiderando somente os metadados de geração identificados como variáveis na especificação documentada.
10. WHEN dados forem exportados, importados e exportados novamente sem alteração pelo Operador, THE Formatador_Canonico SHALL produzir conteúdo idêntico ao da primeira exportação, exceto pelos metadados de geração identificados como variáveis na especificação documentada.
11. WHEN um Pacote_de_Publicacao for gerado, THE Exportador_de_Dados SHALL incluir somente os arquivos cujos campos estejam classificados e aprovados como Dados_Publicos e SHALL excluir todos os demais arquivos.
12. THE Material_de_Treinamento SHALL documentar, para cada formato suportado, os campos obrigatórios e opcionais, os tipos e valores permitidos, as regras de validação, os metadados variáveis e ao menos um exemplo válido e um exemplo inválido.
13. WHEN uma migração terminar, THE Importador_de_Dados SHALL apresentar, para cada formato de origem, as quantidades de registros lidos, importados sem alteração, transformados, rejeitados e pendentes, de modo que a soma dos quatro últimos totais seja igual à quantidade de registros lidos.
14. IF um registro importado referenciar uma pessoa ou um departamento que não corresponda de forma única ao Cadastro_Central, THEN THE Importador_de_Dados SHALL manter o registro pendente, não criar nem escolher uma associação e informar a referência que exige decisão do Operador.

### Requirement 10: Publicação estática e confirmação do resultado

**User Story:** Como Operador, quero publicar por um procedimento guiado e verificável, para que o GitHub Pages receba a versão correta sem depender de comandos memorizados.

#### Critérios de Aceitação

1. THE Publicador SHALL disponibilizar os dois procedimentos aprovados de publicação, integração direta com GitHub e exportação guiada, para levar um Pacote_de_Publicacao aprovado ao Repositorio_Publico_Site sem exigir comandos memorizados.
2. WHEN o Operador iniciar uma publicação, THE Publicador SHALL mostrar o período, a versão aprovada, o repositório e a branch de destino e a relação completa dos arquivos públicos que serão incluídos, alterados ou removidos.
3. WHEN o Operador confirmar uma publicação, THE Publicador SHALL criar e identificar um Backup da versão pública vigente antes de alterar qualquer arquivo no destino.
4. IF o repositório ou a branch de destino divergir do repositório ou da branch registrados na configuração aprovada para o procedimento selecionado, THEN THE Publicador SHALL bloquear o envio, preservar o Pacote_de_Publicacao e informar qual destino precisa ser corrigido.
5. WHERE integração direta com GitHub estiver habilitada, THE Publicador SHALL enviar ao destino somente os arquivos incluídos no Pacote_de_Publicacao aprovado e as remoções explicitamente identificadas nesse pacote.
6. WHERE publicação por exportação estiver habilitada, THE Publicador SHALL gerar o Pacote_de_Publicacao acompanhado de instruções em português que identifiquem, em ordem, cada ação do Operador, o destino aprovado, os arquivos afetados e a evidência observável exigida para confirmar cada ação, sem exigir edição de código, JSON ou Markdown.
7. WHEN a publicação incluir contatos públicos, THE Publicador SHALL gerar todos esses contatos a partir do Cadastro_Central e excluir qualquer contato que não esteja aprovado como Dado_Publico.
8. WHEN a versão publicada for confirmada, THE Publicador SHALL gerar os links personalizados de confirmação por WhatsApp previstos no Conjunto_de_Regras_Ativo do Ciclo_Mensal.
9. WHEN a versão publicada for confirmada, THE Publicador SHALL atualizar uma única vez os controles de rotação de regência, equipe e mensagem musical com as atribuições do Pacote_de_Publicacao aprovado.
10. WHEN uma tentativa de publicação terminar, THE Publicador SHALL registrar no Registro_de_Auditoria a data e a hora, o período, o responsável, a versão aprovada, o destino e um resultado entre confirmada, incompleta ou falhou.
11. WHERE integração direta com GitHub estiver habilitada, WHILE uma publicação estiver em andamento, THE Publicador SHALL apresentar separadamente um dos estados de envio, não iniciado, em andamento, concluído ou falhou, e um dos estados do GitHub Pages, não iniciado, em andamento, concluído ou falhou.
12. WHERE integração direta com GitHub estiver habilitada, WHEN o GitHub Pages concluir o processamento da nova versão, THE Publicador SHALL confirmar a publicação somente se todos os arquivos do Pacote_de_Publicacao aprovado estiverem presentes no endereço público, nenhum arquivo previsto para remoção permanecer disponível e o conteúdo público corresponder integralmente ao pacote aprovado.
13. IF qualquer arquivo esperado estiver ausente, qualquer arquivo previsto para remoção permanecer disponível, qualquer conteúdo público divergir do Pacote_de_Publicacao aprovado ou o destino não puder ser consultado, THEN THE Publicador SHALL classificar a publicação como incompleta, identificar os arquivos afetados, preservar os dados de trabalho e informar uma ação de nova verificação ou nova tentativa.
14. WHILE a publicação estiver incompleta, THE Publicador SHALL preservar sem alteração o Rascunho, a aprovação, os insumos, o Pacote_de_Publicacao e o Backup.
15. WHEN o mesmo período e a mesma versão aprovada forem publicados novamente, THE Publicador SHALL manter um único registro de publicação confirmada e impedir novos incrementos nos controles de rotação para essa versão.
16. THE Publicador SHALL gerar o Pacote_de_Publicacao com `atual.json` e os dados públicos de contato em conformidade com as especificações documentadas dos arquivos consumidos pelo Visualizador_Atual.
17. WHERE publicação por exportação estiver habilitada, WHEN o Operador solicitar a confirmação após concluir o envio guiado, THE Publicador SHALL aplicar ao endereço público a mesma comparação entre arquivos esperados, remoções previstas e conteúdo aprovado exigida para a integração direta e marcar a publicação como confirmada somente se a comparação for aprovada.
18. WHEN o Operador confirmar a integração direta com GitHub, THE Fluxo_Git_Guiado SHALL criar um commit identificado no Repositorio_Privado_Gestao e executar o push correspondente usando somente os controles apresentados pelo Sistema_de_Gestao_Leiga.
19. WHEN o Pacote_de_Publicacao aprovado estiver pronto para envio direto, THE Fluxo_Git_Guiado SHALL criar no Repositorio_Publico_Site um commit contendo somente os arquivos públicos incluídos, alterados ou removidos pelo pacote e executar o push correspondente usando somente os controles apresentados pelo Sistema_de_Gestao_Leiga.
20. THE Sistema_de_Gestao_Leiga SHALL manter o Repositorio_Privado_Gestao separado do Repositorio_Publico_Site.
21. THE Publicador SHALL incluir somente o Artefato_Estatico no Repositorio_Publico_Site.
22. WHEN o push do Repositorio_Publico_Site terminar, THE Publicador SHALL manter a publicação em estado incompleta até verificar no Site_Publico o conteúdo exigido pelo critério 12.
23. WHEN a publicação por exportação guiada for selecionada, THE Publicador SHALL orientar o Operador até a verificação do Pacote_de_Publicacao no Site_Publico usando somente controles e instruções em português.

### Requirement 11: Segurança, privacidade e credenciais

**User Story:** Como responsável pelos dados, quero separar conteúdo público, informações pessoais e credenciais, para que a facilidade operacional não exponha dados administrativos.

#### Critérios de Aceitação

1. THE Sistema_de_Gestao_Leiga SHALL classificar cada campo persistido em exatamente uma das categorias Dado_Publico ou Dado_Privado, conforme a relação de campos aprovada na configuração operacional.
2. THE Artefato_Estatico SHALL conter somente campos classificados como Dados_Publicos na configuração operacional vigente e aprovados para o Pacote_de_Publicacao.
3. THE Artefato_Estatico SHALL excluir credenciais, tokens, senhas, notas internas, indisponibilidades e justificativas administrativas, ainda que algum desses conteúdos esteja associado a um campo classificado como Dado_Publico.
4. WHEN um telefone for autorizado para inclusão nos Dados_Publicos, THE Sistema_de_Gestao_Leiga SHALL registrar a pessoa e o telefone abrangidos, a finalidade autorizada, o responsável pela autorização, a data inicial, a data final quando houver e o estado vigente ou revogado da autorização.
5. IF um Dado_Privado estiver presente no Pacote_de_Publicacao, THEN THE Validador SHALL registrar um Bloqueio que identifique o arquivo e o campo afetados e impedir a inclusão do dado no Artefato_Estatico.
6. WHERE integração direta com GitHub estiver habilitada, THE Gerenciador_de_Credenciais SHALL aceitar para publicação somente uma credencial restrita ao repositório e à branch configurados e às operações de enviar o Pacote_de_Publicacao aprovado e consultar o estado da publicação.
7. THE Gerenciador_de_Credenciais SHALL manter credenciais fora dos arquivos versionados, dos Pacotes_de_Publicacao, dos Backups e do Registro_de_Auditoria.
8. WHEN uma credencial for exibida ao Operador, THE Gerenciador_de_Credenciais SHALL substituir todos os caracteres secretos por caracteres de ocultação, sem exibir qualquer parte do valor original.
9. WHEN o Operador solicitar a remoção de acesso, THE Gerenciador_de_Credenciais SHALL remover a credencial armazenada no ambiente operacional, confirmar a remoção ao Operador e impedir novas publicações com essa credencial, sem alterar Rascunhos, Pacotes_de_Publicacao ou a Escala vigente.
10. IF uma credencial expirar ou for revogada, THEN THE Publicador SHALL rejeitar a publicação, preservar o Rascunho, o Pacote_de_Publicacao e a Escala vigente e apresentar ao Operador uma orientação de nova autenticação sem exibir o valor da credencial.
11. THE Registro_de_Auditoria SHALL excluir tokens, senhas e qualquer conteúdo parcial ou integral de credenciais.
12. WHERE mais de um perfil operacional estiver habilitado, THE Sistema_de_Gestao_Leiga SHALL permitir a ação de publicação somente aos perfis identificados como autorizados na configuração operacional vigente.
13. WHILE a transição para o Sistema_de_Gestao_Leiga estiver em andamento, THE Visualizador_Atual SHALL permitir que um usuário conclua o login Google e acesse as funções que exigiam esse login antes da transição.
14. THE Material_de_Treinamento SHALL informar que o login Google executado no navegador não impede o acesso direto aos arquivos do Artefato_Estatico por seus endereços públicos.
15. IF um telefone destinado aos Dados_Publicos não possuir autorização vigente para a pessoa, o telefone e a finalidade da publicação, THEN THE Validador SHALL registrar um Bloqueio, identificar o contato afetado e impedir a inclusão do telefone no Pacote_de_Publicacao.
16. WHEN um telefone possuir a autorização vigente definida no critério 4, THE Exportador_de_Dados SHALL permitir a permanência do telefone nos Dados_Publicos do Repositorio_Publico_Site.

### Requirement 12: Recuperação de erros operacionais

**User Story:** Como Operador, quero corrigir falhas sem perder trabalho ou derrubar a escala vigente, para que um erro não exija intervenção técnica.

#### Critérios de Aceitação

1. WHEN o Operador confirmar uma alteração de dados, THE Sistema_de_Gestao_Leiga SHALL persistir a alteração no Rascunho ou cadastro correspondente antes de indicar a conclusão da operação.
2. WHEN o Operador solicitar desfazer a última alteração confirmada e ainda não publicada, THE Sistema_de_Gestao_Leiga SHALL restaurar exatamente o estado persistido imediatamente anterior a essa alteração sem modificar a Escala vigente.
3. IF o Sistema_de_Gestao_Leiga for encerrado durante um Ciclo_Mensal, THEN THE Sistema_de_Gestao_Leiga SHALL recuperar, na próxima abertura do ciclo, todos os dados do último estado cuja persistência foi confirmada, sem alterar a Escala vigente.
4. IF uma validação falhar antes de apresentar o resultado completo, THEN THE Sistema_de_Gestao_Leiga SHALL preservar o Rascunho e a Escala vigente nos estados anteriores ao início da validação e indicar que nenhum resultado de validação foi concluído.
5. IF uma geração de Pacote_de_Publicacao falhar, THEN THE Publicador SHALL descartar o pacote incompleto, preservar a aprovação e a Escala vigente e permitir nova tentativa a partir da mesma versão aprovada.
6. IF um envio ao GitHub falhar, THEN THE Publicador SHALL classificar a publicação como incompleta, preservar sem alteração o Pacote_de_Publicacao aprovado e permitir nova tentativa com o mesmo pacote.
7. IF o deploy falhar antes da confirmação pública, THEN THE Publicador SHALL classificar a publicação como incompleta, preservar o Rascunho, a aprovação e o Pacote_de_Publicacao e manter disponível o Backup da versão pública anterior para restauração.
8. WHEN o Operador solicitar restauração, THE Sistema_de_Gestao_Leiga SHALL apresentar a identificação, o período e a data da versão de origem, além dos dados atuais que serão substituídos, e exigir confirmação antes de iniciar a substituição.
9. WHEN uma restauração terminar, THE Validador SHALL verificar a integridade de todos os dados restaurados antes de indicar a restauração como concluída.
10. IF a verificação de integridade do estado restaurado falhar, THEN THE Sistema_de_Gestao_Leiga SHALL restaurar o estado persistido imediatamente anterior à tentativa, indicar os dados que falharam na verificação e manter a Escala vigente sem alteração.
11. IF um arquivo de operação não puder ser lido integralmente ou falhar na verificação de integridade aplicável ao seu formato, THEN THE Sistema_de_Gestao_Leiga SHALL rejeitar o arquivo sem alterar os dados persistidos e apresentar os Backups cuja integridade tenha sido verificada como opções de restauração.
12. WHEN uma operação falhar, THE Sistema_de_Gestao_Leiga SHALL apresentar em português a operação afetada, a causa identificada ou a indisponibilidade da causa, os dados alterados e preservados, o impacto no Ciclo_Mensal e na Escala vigente e a ação disponível para corrigir ou repetir a operação.
13. THE Validador SHALL executar verificações sem modificar Cadastro_Central, Rascunho ou Escala vigente.

### Requirement 13: Backups e portabilidade

**User Story:** Como responsável pela continuidade, quero backups portáveis e testáveis, para que outra máquina ou outra pessoa consiga retomar a operação.

#### Critérios de Aceitação

1. WHEN um Ciclo_Mensal for aprovado, THE Sistema_de_Gestao_Leiga SHALL criar um Backup que contenha o Cadastro_Central, o Conjunto_de_Regras_Ativo e sua versão, os Insumos_Externos, as Indisponibilidades, o Rascunho e a aprovação vinculados ao ciclo no estado existente no momento da aprovação.
2. WHEN uma publicação for confirmada, THE Sistema_de_Gestao_Leiga SHALL criar um Backup que contenha a versão publicada e os registros do Registro_de_Auditoria vinculados à publicação no estado existente no momento da confirmação.
3. THE Backup SHALL incluir identificador único, período de referência, versão do formato do Backup, versão de origem, data e hora de criação e responsável pela criação.
4. WHEN o Operador solicitar a verificação de integridade de um Backup, THE Sistema_de_Gestao_Leiga SHALL classificar o Backup como íntegro ou corrompido e apresentar os itens ausentes ou inválidos sem alterar os dados existentes.
5. WHEN o Operador exportar um Backup, THE Sistema_de_Gestao_Leiga SHALL gerar um arquivo ou conjunto de arquivos no formato de Backup documentado, contendo todos os dados e metadados incluídos no Backup.
6. WHEN um Backup íntegro cuja versão de formato seja suportada for importado, THE Sistema_de_Gestao_Leiga SHALL apresentar o identificador, o período, a versão de origem, a data e a hora de criação, o responsável e as categorias de dados contidas no Backup sem restaurá-lo nem alterar os dados existentes.
7. IF um Backup estiver corrompido ou usar uma versão de formato não suportada, THEN THE Sistema_de_Gestao_Leiga SHALL rejeitar a importação, preservar os dados existentes e apresentar a causa da rejeição e as versões de formato suportadas.
8. IF um Backup contiver Dados_Privados, THEN THE Sistema_de_Gestao_Leiga SHALL impedir a inclusão do Backup no Artefato_Estatico sem remover ou alterar o Backup.
9. WHEN a política de retenção aprovada for aplicada, THE Sistema_de_Gestao_Leiga SHALL manter ou eliminar cada Backup conforme os limites de quantidade e tempo definidos na configuração operacional.
10. WHEN a política de retenção selecionar para eliminação um Backup marcado como publicação oficial, THE Sistema_de_Gestao_Leiga SHALL preservar o Backup sem alterar seu conteúdo ou sua marcação.
11. WHEN o Operador confirmar a restauração de um Backup íntegro e compatível após revisar os dados que serão substituídos, THE Sistema_de_Gestao_Leiga SHALL restaurar os dados e metadados contidos no Backup e apresentar o resultado da verificação de integridade do estado restaurado.
12. THE Material_de_Treinamento SHALL incluir um exercício no qual o Operador exporte um Backup, importe-o em outra instalação que suporte a mesma versão de formato, restaure-o e confirme a equivalência do identificador, período, versão de origem e categorias de dados com o Backup exportado.
13. THE Repositorio_Privado_Gestao SHALL constituir a fonte principal do estado persistente e do histórico do Sistema_de_Gestao_Leiga.
14. WHEN o Sistema_de_Gestao_Leiga confirmar uma alteração persistente, THE Fluxo_Git_Guiado SHALL registrar a alteração no Repositorio_Privado_Gestao por commit e push sem exigir linha de comando.
15. IF o estado local divergir do estado persistente vigente no Repositorio_Privado_Gestao, THEN THE Sistema_de_Gestao_Leiga SHALL identificar a divergência e impedir a substituição automática de qualquer uma das versões até o Operador selecionar a versão de origem do procedimento guiado de conciliação.
16. THE Sistema_de_Gestao_Leiga SHALL classificar cópias locais como auxiliares de operação ou recuperação, mantendo o Repositorio_Privado_Gestao como fonte principal do estado persistente e do histórico.

### Requirement 14: Manutenção depois da publicação

**User Story:** Como Operador, quero corrigir trocas, cancelamentos e dados públicos pelo mesmo fluxo seguro, para que eu não precise editar `atual.json` diretamente.

#### Critérios de Aceitação

1. WHEN o Operador iniciar uma alteração pós-publicação, THE Sistema_de_Gestao_Leiga SHALL criar uma nova revisão editável como cópia da Escala vigente sem alterar a Escala vigente.
2. WHEN o Operador registrar uma troca, THE Sistema_de_Gestao_Leiga SHALL exigir a seleção do Culto, da função, da pessoa substituída e da pessoa substituta, exigir o motivo e registrar a data e a hora da alteração e o Operador responsável.
3. WHEN o Operador registrar um cancelamento, THE Sistema_de_Gestao_Leiga SHALL exigir a seleção do Culto e do item cancelado, exigir o motivo e registrar a data e a hora da alteração e o Operador responsável.
4. WHEN o Operador corrigir um dado público em uma revisão pós-publicação, THE Sistema_de_Gestao_Leiga SHALL registrar o Culto, o campo, os valores anterior e novo, o motivo, a data e a hora da alteração e o Operador responsável.
5. WHEN uma revisão pós-publicação for alterada, THE Validador SHALL verificar todos os dados alterados e os Cultos afetados contra o Conjunto_de_Regras_Ativo correspondente ao período.
6. WHEN a validação mais recente de uma revisão pós-publicação terminar sem Bloqueios, THE Sistema_de_Gestao_Leiga SHALL gerar uma Previa_Publica que identifique cada inclusão, alteração e remoção em relação à Escala vigente sem alterar a Escala vigente.
7. WHEN o Aprovador confirmar a Previa_Publica de uma revisão pós-publicação, THE Sistema_de_Gestao_Leiga SHALL registrar a identificação da revisão, o Aprovador, a data e a hora da aprovação no Registro_de_Auditoria.
8. IF uma revisão pós-publicação for alterada depois da aprovação, THEN THE Sistema_de_Gestao_Leiga SHALL invalidar a aprovação e impedir a publicação até que a revisão seja novamente validada sem Bloqueios e aprovada.
9. WHEN o Operador confirmar a publicação de uma revisão pós-publicação aprovada e sem alterações posteriores à validação e à aprovação, THE Publicador SHALL criar um Backup da Escala vigente antes de substituí-la pela revisão aprovada.
10. IF a publicação da revisão pós-publicação falhar antes da confirmação pública, THEN THE Publicador SHALL preservar a Escala vigente, o Backup e a revisão aprovada e apresentar o estado dos dados e a ação disponível para nova tentativa.
11. WHEN a publicação da revisão pós-publicação for confirmada publicamente, THE Publicador SHALL registrar no Registro_de_Auditoria a identificação da revisão, as diferenças publicadas, a data e a hora, o responsável e o resultado da publicação.
12. WHEN uma revisão publicada alterar as pessoas que receberão comunicação, THE Publicador SHALL regenerar somente os links personalizados de confirmação afetados pela alteração.
13. WHEN uma revisão publicada alterar participações, THE Publicador SHALL recalcular os controles de rotação a partir da Escala resultante e contar cada atribuição vigente exatamente uma vez.

### Requirement 15: Treinamento, documentação e transição

**User Story:** Como líder atual, quero entregar documentação e prática suficientes ao sucessor, para que a continuidade não dependa da minha memória ou presença.

#### Critérios de Aceitação

1. THE Material_de_Treinamento SHALL conter um README em português com visão geral, definições dos termos do Glossário e mapa das etapas de abertura, coleta, montagem, validação, aprovação, publicação e fechamento do Ciclo_Mensal, nesta ordem.
2. THE Material_de_Treinamento SHALL documentar, para instalação, primeira configuração, atualização e remoção do Sistema_de_Gestao_Leiga, os pré-requisitos, as ações em ordem, o resultado esperado, a forma de verificar o resultado e a recuperação em caso de falha.
3. THE Material_de_Treinamento SHALL documentar, para cadastro e alteração de pessoas, contatos, habilitações, afastamentos, vínculos e Departamentos, os dados obrigatórios, os valores permitidos, as ações em ordem, o resultado esperado e os erros que impedem a gravação.
4. THE Material_de_Treinamento SHALL documentar, para lançamento e alteração de Cultos, Insumos_Externos e Indisponibilidades, os dados obrigatórios, os valores permitidos, as ações em ordem, o resultado esperado e os erros que impedem a conclusão.
5. THE Material_de_Treinamento SHALL documentar, para montagem manual, interpretação de sugestões automáticas e correção de conflitos, os dados necessários, as ações em ordem, o resultado esperado e a distinção entre Bloqueio e Aviso.
6. THE Material_de_Treinamento SHALL documentar, para validação, Previa_Publica, aprovação e cada procedimento de publicação habilitado, os pré-requisitos, as ações em ordem, o resultado esperado, a forma de verificar o resultado e a recuperação em caso de falha.
7. THE Material_de_Treinamento SHALL documentar, para configuração, substituição e remoção de credenciais, os pré-requisitos, as ações em ordem, o resultado esperado, a forma de verificar o resultado e o estado das credenciais após cada procedimento.
8. THE Material_de_Treinamento SHALL documentar, para criação, exportação, verificação e restauração de Backup, os pré-requisitos, as ações em ordem, o resultado esperado, a forma de verificar a integridade e os dados substituídos por uma restauração.
9. THE Material_de_Treinamento SHALL documentar, para correções pós-publicação, cancelamentos e atualização de controles, os pré-requisitos, as ações em ordem, o resultado esperado e a forma de verificar a Escala vigente e os controles resultantes.
10. THE Material_de_Treinamento SHALL conter, para cada condição de falha operacional descrita nos requisitos do Sistema_de_Gestao_Leiga, um procedimento de diagnóstico que identifique o sintoma observável, o estado dos dados, a ação corretiva e a forma de confirmar a recuperação.
11. THE Material_de_Treinamento SHALL conter um exemplo com dados fictícios que percorra as sete etapas do Ciclo_Mensal e apresente, para cada etapa, os dados de entrada, as ações em ordem e o resultado esperado.
12. WHILE o Modo_de_Treinamento estiver ativo, THE Sistema_de_Gestao_Leiga SHALL manter todos os dados e resultados do exercício separados dos Dados_Publicos, da Escala vigente e dos Ciclos_Mensais operacionais.
13. WHEN um novo Operador concluir sem Bloqueios uma Escala_Simulada completa pelas etapas de abertura, coleta, montagem automática seguida de revisão manual, validação, aprovação, publicação em destino simulado, fechamento e restauração com integridade verificada, usando somente o Material_de_Treinamento e os controles do Sistema_de_Gestao_Leiga, THE Sistema_de_Gestao_Leiga SHALL registrar as atividades concluídas, seus resultados, a data e a hora da conclusão e a identificação do novo Operador.
14. WHEN o Aprovador revisar o registro de treinamento, THE Aprovador SHALL homologar a transição somente se o novo Operador tiver concluído a Escala_Simulada completa do critério 13 sem ajuda de IA, edição de arquivos-fonte, linha de comando, orientação do líder atual ou outra ajuda técnica durante a execução.
15. THE Material_de_Treinamento SHALL identificar os responsáveis vigentes por cadastro, regras, aprovação, publicação, credenciais e backups, incluindo para cada responsabilidade o nome da pessoa ou função designada e um meio de contato.
16. WHEN uma mudança operacional alterar uma etapa do Ciclo_Mensal ou um procedimento documentado, THE Material_de_Treinamento SHALL identificar a versão do sistema e a data em que a mudança entrou em vigor, as etapas ou procedimentos afetados e as instruções vigentes que substituem as anteriores.

### Requirement 16: Continuidade, custo e preservação do sistema atual

**User Story:** Como responsável pela igreja, quero uma operação sustentável e reversível, para que o projeto continue útil com baixo custo e sem perder o site existente.

#### Critérios de Aceitação

1. THE Sistema_de_Gestao_Leiga SHALL disponibilizar uma opção operacional que publique o Artefato_Estatico no GitHub Pages e mantenha o Visualizador_Atual funcional sem servidor de aplicação em produção.
2. THE Sistema_de_Gestao_Leiga SHALL disponibilizar uma opção operacional cujo custo recorrente obrigatório adicional de servidor de aplicação seja de R$ 0,00 por mês.
3. WHERE uma integração opcional gerar custo recorrente, THE Material_de_Treinamento SHALL informar o serviço, a finalidade, o valor e a moeda por período de cobrança, as condições que podem alterar o valor e o procedimento de desativação sem interromper a opção operacional sem custo recorrente obrigatório de servidor de aplicação.
4. WHEN o Operador solicitar a exportação dos dados, THE Sistema_de_Gestao_Leiga SHALL exportar Cadastro_Central, conjuntos de regras, Ciclos_Mensais, Escalas, Insumos_Externos e Registro_de_Auditoria em formatos documentados que possam ser importados por outra instalação compatível sem uso obrigatório do fornecedor da opção operacional.
5. WHEN a migração inicial terminar, THE Sistema_de_Gestao_Leiga SHALL gerar um relatório que apresente, para cada registro de origem, sua identificação, a classificação como importado, transformado, rejeitado ou pendente e, para registros transformados, rejeitados ou pendentes, o motivo e os dados afetados.
6. WHEN a migração inicial for iniciada, THE Sistema_de_Gestao_Leiga SHALL criar e verificar um Backup de todos os arquivos de origem antes de alterar qualquer dado da nova operação.
7. IF a migração inicial apresentar ao menos um Bloqueio, THEN THE Sistema_de_Gestao_Leiga SHALL impedir a homologação e a substituição do processo atual, preservar o Backup dos arquivos de origem e informar os Bloqueios que precisam ser resolvidos.
8. WHILE a homologação da nova operação não estiver confirmada pelo Aprovador, THE Visualizador_Atual SHALL continuar consumindo a Escala vigente gerada pelo processo atual sem receber dados produzidos pela migração ou por testes da nova operação.
9. WHEN o Aprovador solicitar a homologação da nova operação, THE Sistema_de_Gestao_Leiga SHALL comparar todos os Cultos, campos e valores públicos do Pacote_de_Publicacao produzido pela nova operação com os dados correspondentes consumidos pelo Visualizador_Atual e apresentar cada equivalência e divergência encontrada.
10. IF a homologação falhar ou for cancelada, THEN THE Sistema_de_Gestao_Leiga SHALL restaurar, a partir do Backup de transição, a Escala vigente, os Dados_Publicos e os dados operacionais existentes antes da transição, preservar os dados produzidos pela nova operação separadamente e apresentar o resultado da restauração e da verificação de integridade.
11. IF a migração inicial possuir ao menos um registro rejeitado ou pendente, a comparação de homologação possuir ao menos uma divergência ou a restauração do Backup de transição não tiver sido concluída e verificada em teste, THEN THE Sistema_de_Gestao_Leiga SHALL impedir a confirmação da homologação e informar cada condição não atendida.
12. WHEN a migração inicial não possuir registros rejeitados nem pendentes, a comparação não possuir divergências e a restauração do Backup de transição tiver sido concluída e verificada em teste, THE Sistema_de_Gestao_Leiga SHALL permitir ao Aprovador confirmar a homologação e registrar a data, o responsável, o resultado da comparação e o Backup de transição no Registro_de_Auditoria.

## Perguntas abertas e decisões consequentes

### Perguntas resolvidas

1. **Forma principal de operação:** resolvida como Aplicativo_Instalado.
2. **Sistemas operacionais:** resolvida quanto às famílias Windows e macOS; as versões mínimas permanecem abertas abaixo.
3. **Publicação mínima aceitável:** resolvida com integração direta ao GitHub e exportação guiada como alternativa.
4. **Perfis e aprovação:** resolvida com uma única pessoa exercendo operação, aprovação e publicação.
5. **Privacidade dos contatos:** resolvida quanto à possibilidade de manter telefones nos Dados_Publicos, sujeitos à autorização vigente; nomes e aliases permanecem abertos abaixo.
6. **Fontes dos insumos externos:** resolvida para anciãos, pregadores e sonoplastia, que chegarão por PDF e serão digitados manualmente na primeira versão.
7. **Sugestão automática:** resolvida com geração automática de uma Escala completa na primeira versão, sempre sujeita a revisão e alteração manual.
8. **Autoridade das regras:** resolvida quanto à consolidação das regras atuais em uma fonte única versionada; a conciliação das fontes atuais permanece aberta abaixo.
9. **Exceções:** resolvida quanto à exigência de justificativa e ao exercício da aprovação pelo Operador; os tipos de exceção emergencial permanecem abertos abaixo.
10. **Conclusão da publicação:** resolvida como a verificação da nova versão no Site_Publico.
11. **Backups e persistência:** resolvida quanto ao Repositorio_Privado_Gestao como fonte principal do estado persistente e histórico, sem cópia local como fonte principal; retenção permanece aberta abaixo.
12. **Critério de transição:** resolvida com homologação após uma Escala_Simulada completa sem ajuda técnica.
13. **Operação Git:** resolvida com commit e push executados pelo Fluxo_Git_Guiado, sem linha de comando.
14. **Separação de repositórios:** resolvida com um Repositorio_Privado_Gestao separado de um Repositorio_Publico_Site.

### Perguntas ainda abertas

1. **Versões dos sistemas operacionais:** quais versões mínimas de Windows e macOS precisam ser atendidas? A decisão restringe tecnologias e procedimentos de instalação.
2. **Nomes e aliases públicos:** quais nomes e aliases podem permanecer nos arquivos públicos do GitHub Pages? A decisão completa a classificação dos contatos públicos.
3. **Indisponibilidade pelo WhatsApp:** o novo Operador digitará as respostas manualmente, importará uma planilha ou usará outro mecanismo sem IA? A decisão altera esforço mensal e risco de associação de nomes.
4. **Conciliação inicial das regras:** como cada divergência entre índice, snapshot, documentos legados e dados atuais deverá ser decidida para formar a primeira versão da fonte única? A decisão define a migração auditável das regras.
5. **Exceções emergenciais:** quais tipos de exceção a Regras_Fundamentais podem ser aprovados pelo Operador? A decisão define os limites dos bloqueios e da auditoria.
6. **Campos obrigatórios:** suporte, acompanhamento, músicas, temas, Escola Sabatina e sonoplastia são obrigatórios em quais tipos de Culto? A decisão define completude e validação.
7. **Retenção no Git:** por quanto tempo e segundo quais marcos as versões e os Backups privados devem ser retidos no Repositorio_Privado_Gestao? A decisão define a política de recuperação e o crescimento do repositório.
8. **Operação sem internet:** quais etapas precisam funcionar sem conexão? A decisão afeta sincronização entre máquinas e tratamento de divergências.
9. **Pós-publicação:** confirmações do WhatsApp e cancelamentos devem apenas gerar links e registros, ou o sistema precisa controlar respostas? A decisão separa preservação do fluxo atual de uma ampliação de escopo.
