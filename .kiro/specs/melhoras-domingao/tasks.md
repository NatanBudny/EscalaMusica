# Plano de Implementação: Melhoras Domingão

## Visão Geral

Implementação incremental em JavaScript (Node ESM), seguindo a ordem de dependências: fundação (A), cadastro (B), regras (C), mês e insumos (D), montagem (E), envio (F) e instalador (G). Lógica nova fica em `montador/lib/` e `scripts/lib/`, com testes Jest em `tests/montador/*.test.js` (e `tests/editor-windows/*.test.js` na etapa G). Lógica pura do navegador fica em `montador/public/modulos/`. UI é validada por roteiro manual em cada tarefa. Cada tarefa termina integrada ao servidor e à interface, sem código solto.

## Tarefas

### A) Fundação

- [x] Task 1: Segurança do servidor local e `.gitignore`
  - Objetivo: o servidor só atende o próprio computador e não versiona arquivos temporários.
  - Orientação:
    - Criar `montador/lib/seguranca.mjs` com `validarRequisicao` e `lerCorpoJson` (limite de 5 MB) e aplicá-los a todas as rotas de `montador/server.mjs`, substituindo `readBody`.
    - Exportar `criarServidor({ root, porta, git })` e só chamar `listen(porta, '127.0.0.1')` quando o arquivo é executado diretamente.
    - Adicionar `GET /api/saude`; abrir o navegador em `http://127.0.0.1:<porta>/`, salvo `MONTADOR_SEM_NAVEGADOR=1`.
    - Acrescentar `montador/backups-pessoas/` e `.pessoas.tmp.json` ao `.gitignore`.
  - [ ]* 1.1 Teste de propriedade das requisições
    - **Property 38: Segurança das requisições**
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.5**
  - [ ]* 1.2 Testes unitários do servidor
    - Endereço de escuta, `/api/saude`, URL do navegador e ausência de abertura com `MONTADOR_SEM_NAVEGADOR=1`.
  - _Requisitos: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 30.3, 30.4_
  - Demo: `curl -X POST -H 'Origin: https://exemplo.com' -H 'content-type: application/json' http://127.0.0.1:4599/api/validar` responde 403; a interface continua funcionando.

- [x] Task 2: Módulo git e commit seletivo na publicação atual
  - Objetivo: toda gravação passa por um único módulo que comita só os arquivos da operação e sincroniza sem force.
  - Orientação:
    - Criar `montador/lib/git.mjs` (`criarGit` com `commitSeletivo`, `pullRebase`, `enviar`, `status`, `autor`) conforme o design: `execFile`, `GIT_TERMINAL_PROMPT=0`, `git add --` para não rastreados, `git commit -m <msg> -- <arquivos>`, `pull --rebase --autostash`, política RF021 para `atual.json`, `rebase --abort` nos demais conflitos, push sem force, `semAlteracoes`.
    - Remover o git de `montador/lib/publicar.mjs` (que hoje faz `git commit -m` sem pathspec) e fazer `POST /api/publicar` comitar `atual.json` e o backup via `commitSeletivo` + `enviar`.
    - Na inicialização do servidor, `pullRebase()` salvo `MONTADOR_SEM_PULL=1`; com código alterado em `montador/` ou `scripts/`, sair com 75 quando `MONTADOR_NA_CASCA=1`, senão avisar no console.
    - Rotas `GET /api/sync/status` e `POST /api/sync/tentar-de-novo`.
    - Criar `tests/helpers/repo-temporario.js` (repositório em `os.tmpdir()` com remoto bare local, sem rede).
  - [ ]* 2.1 Teste de propriedade do commit seletivo
    - **Property 1: Commit seletivo exato**
    - **Validates: Requirements 2.1, 2.2, 2.12, 23.8, 28.4**
  - [ ]* 2.2 Teste de propriedade da sincronização
    - **Property 2: Sincronização sem perda**
    - **Validates: Requirements 2.6, 2.7, 2.8, 2.9, 2.10, 2.11**
  - [ ]* 2.3 Testes unitários do módulo git
    - Argumentos de `execFile` sem shell, push sem `--force`, saída 75 e aviso de reinício.
  - _Requisitos: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.11, 2.12, 2.13, 2.14_
  - Demo: com outro arquivo modificado no repositório, publicar pelo editor gera commit só com `atual.json` e o backup; `git status` continua mostrando o outro arquivo.

- [x] Task 3: Contatos derivados e cadastro comitando na hora
  - Objetivo: cada salvamento de pessoa grava `pessoas.json` e `contatos.json` e vai para o GitHub.
  - Orientação:
    - Criar `scripts/lib/contatos.js` (`derivarContatos`) com a lógica de `scripts/manutencao/gerar-contatos.js` e fazer o script usá-la.
    - Em `montador/lib/pessoas.mjs`, `gravarValidado` passa a gravar os dois arquivos e devolver `arquivos`; todas as funções aceitam `root`.
    - Nas rotas de pessoas, chamar `commitSeletivo(arquivos, 'Cadastro: ... (editor de escala)')` + `enviar()` e devolver `git` na resposta.
  - [ ]* 3.1 Teste de propriedade da derivação de contatos
    - **Property 3: Derivação de contatos**
    - **Validates: Requirements 3.2, 23.4**
  - [ ]* 3.2 Teste de propriedade de falha no cadastro
    - **Property 5: Falha não deixa rastro** (parte do cadastro: alterações inválidas geradas não mudam arquivos nem HEAD)
    - **Validates: Requirements 3.3, 5.5**
  - [ ]* 3.3 Teste unitário de `gerar-contatos.js`
    - O script produz o mesmo `contatos.json` que antes para o `pessoas.json` do repositório.
  - _Requisitos: 3.1, 3.2, 3.3, 3.4_
  - Demo: salvar uma pessoa pela tela e ver no `git log` um commit com só `pessoas.json` e `contatos.json`.

- [x] Task 4: Migração única do `contatos.json`
  - Objetivo: nenhuma entrada manual do `contatos.json` atual se perde quando ele passa a ser só derivado.
  - Orientação:
    - Criar `scripts/lib/texto-publico.js` com `CARACTERES_DE_NOME` e `problemasNome` (letras com acento, espaço, ponto, apóstrofo e hífen; vírgula proibida).
    - Criar `montador/lib/migracoes.mjs` com `diferencasContatos` e `aplicarMigracaoContatos(pessoasArquivo, contatosAtual, decisoes)`: entrada com telefone de uma ou mais pessoas vira pendência `telefone_compartilhado` (apelido de uma delas ou pessoa nova inativa com o mesmo telefone); sem pessoa de mesmo telefone vira pessoa inativa sem habilitações; nome ou apelido com `problemasNome` vira pendência `caracteres` (renomear ou remover). Recusa aplicar com pendência sem decisão. Marca `pessoas.json.migracoes.contatos_para_pessoas`.
    - Nota de incremento: o gate de grupos desta migração (marcar entradas `coberto_por_grupo` e desabilitar a aplicação enquanto a migração de grupos não rodou) é completado na Task 8, que adiciona `propostaGrupos`/`aplicarMigracaoGrupos` e ajusta `diferencasContatos`. Nesta task, implementar apenas o caminho sem grupos.
    - Rotas `GET /api/migracoes` e `POST /api/migracoes/:nome/aplicar` (`{ decisoes }`); `listarPessoas` devolve `migracoesPendentes`.
    - Na tela de cadastro, mostrar as migrações pendentes, suas diferenças e as pendências com as opções antes da lista; botão "Aplicar" desabilitado enquanto falta decisão.
  - [ ]* 4.1 Teste de propriedade da migração
    - **Property 4: Migração de contatos sem perda** (parte das pessoas)
    - **Validates: Requirements 3.6, 3.7, 3.8, 3.9, 3.10**
  - [ ]* 4.2 Teste com os arquivos reais e roteiro manual
    - Cópias do `contatos.json` e `pessoas.json` atuais: `LAURA GESSNER` (telefone de LAURA) e `MIN. JOVEM` (telefone de FABRICIO) ficam pendentes por telefone; o apelido `FABRICIO 1` fica pendente por caractere; após decidir e aplicar, os telefones e apelidos mantidos estão no `contatos.json` regenerado.
    - Roteiro: abrir cadastro, ver diferenças e pendências, decidir, aplicar, conferir que a tela some e o commit tem os dois arquivos.
  - _Requisitos: 3.5, 3.6, 3.7, 3.8, 3.9, 3.10_
  - Demo: a tela de cadastro mostra a migração com LAURA GESSNER pendente ("apelido de LAURA" ou "pessoa nova"); "Aplicar" só habilita depois de decidir.

- [x] Task 5: Indicador "não sincronizado" no cadastro e aviso de privacidade
  - Objetivo: o usuário vê quando há commits não enviados e pode reenviar; sabe que as notas são públicas.
  - Orientação:
    - Em `montador/public/app.js`, consultar `GET /api/sync/status` ao abrir o cadastro e após cada gravação; exibir badge com a quantidade e botão "tentar de novo" (`POST /api/sync/tentar-de-novo`).
    - Exibir a mensagem de conflito devolvida pelo git quando `push: 'conflito'`.
    - Em `montador/public/index.html`, aviso "visível publicamente" junto ao campo de notas.
  - [ ]* 5.1 Roteiro de verificação manual
    - Apontar o remoto para endereço inexistente, salvar pessoa, ver o indicador com 1 commit; restaurar o remoto, "tentar de novo", indicador some.
  - _Requisitos: 1.7, 2.10, 2.11_
  - Demo: sem internet, salvar uma pessoa mostra "não sincronizado (1)"; com internet, "tentar de novo" limpa o indicador.

### B) Cadastro

- [x] Task 6: Validações do cadastro com confirmação no WhatsApp
  - Objetivo: impedir telefone fora do formato e nomes repetidos, e confirmar o número antes de salvar.
  - Orientação:
    - Em `montador/lib/pessoas.mjs`: `validarTelefone`, `verificarPessoa` (exato = erro, normalizado por `scripts/lib/normalizar.js` = aviso, `problemasNome` de nome ou apelido = erro, `telefoneCompartilhadoCom` com as outras pessoas do mesmo número) e `salvarPessoa` recusando telefone novo/alterado sem `confirmacaoTelefone` e avisos sem `confirmarAvisos`. Telefone compartilhado não exige confirmação extra.
    - Rota `POST /api/pessoas/verificar`; `POST`/`PUT /api/pessoas` recebem `{ dados, confirmacaoTelefone, confirmarAvisos }`.
    - Na UI: verificar → mostrar avisos e pedir confirmação → se o telefone mudou, abrir `https://wa.me/<numero>` e perguntar "Abriu o WhatsApp da pessoa certa?" (não = volta ao formulário; sim = salva), mostrando "este número também é usado por ..." quando compartilhado.
  - [ ]* 6.1 Teste de propriedade do telefone
    - **Property 6: Formato de telefone**
    - **Validates: Requirements 4.1, 4.2**
  - [ ]* 6.2 Teste de propriedade das regras de salvamento
    - **Property 7: Regras de salvamento do cadastro**
    - **Validates: Requirements 4.3, 4.4, 4.8, 4.10**
  - [ ]* 6.3 Roteiro de verificação manual
    - Telefone com 11 dígitos é recusado; "FABRICIO" com pessoa "FABRÍCIO" mostra aviso; apelido "FABRICIO 1" é recusado pelo dígito; telefone de BERNARDO em outra pessoa mostra "também é usado por BERNARDO" e salva; telefone alterado abre o WhatsApp e "não" volta sem salvar.
  - _Requisitos: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10_
  - Demo: editar o telefone de alguém abre o WhatsApp do número digitado e só salva após "sim".

- [x] Task 7: Vínculos, `precisa_de` e migração das regras por nome
  - Objetivo: casais, famílias e dependências passam a ser editados no cadastro, sem regras fixas por nome.
  - Orientação:
    - Em `scripts/lib/cadastro.js`, validar `precisa_de` (`com_ids` não vazio, IDs existentes, sem a própria pessoa).
    - Em `montador/lib/pessoas.mjs`, `aplicarVinculos` (simetria de `sempre_junto`, grupo existente ou novo para `familia_requerida`, `precisa_de` unidirecional).
    - Editor de vínculos no formulário de pessoa (seleção de pessoas e grupos).
    - Em `montador/lib/migracoes.mjs`, `migrarRegrasPorNome` (ARIADNY e CATHERINE `dias_permitidos: ["sabado"]`; MANU C. → SILVANA; MANU S. → JESSICA ou JOAS; MIRELLA e MARCELA → NILSINHO), exposta como migração pendente na mesma tela da Task 4.
  - [ ]* 7.1 Teste de propriedade dos vínculos
    - **Property 8: Vínculos válidos e simétricos**
    - **Validates: Requirements 5.2, 5.3, 5.4, 5.5**
  - [ ]* 7.2 Teste da migração por nome e roteiro manual
    - Sobre cópia do `pessoas.json` real: resultado esperado, aprovado por `carregarPessoas` e idempotente.
    - Roteiro: criar `sempre_junto` em A e ver o recíproco em B; criar `precisa_de` e salvar.
  - _Requisitos: 5.1, 5.2, 5.3, 5.4, 5.5, 5.7_
  - Demo: abrir MANU S. e ver "precisa de JESSICA ou JOAS" vindo do cadastro.

- [x] Task 8: Grupos escaláveis no cadastro
  - Objetivo: família e ministério ficam cadastrados como grupos com responsável, e a escala online passa a ter o link do responsável para o nome do grupo.
  - Orientação:
    - Em `scripts/lib/cadastro.js`, validar os campos de Grupo_Escalavel (responsável e membros existentes, membros não vazio, `modo` e `funcoes` válidos, `nome_exibicao` com `problemasNome` vazio e único após `normalizarNome` entre nomes, apelidos e outros grupos).
    - Em `scripts/lib/contatos.js`, `derivarContatos(pessoas, grupos)` acrescenta uma entrada por Grupo_Escalavel cujo responsável tem telefone; `gerar-contatos.js` passa `arquivo.grupos`. `verificarPessoa` também compara nome e apelidos com `nome_exibicao`.
    - Criar `montador/lib/grupos.mjs` (`gruposEscalaveis`, `ocupanteDeGrupo`, `salvarGrupo`, `removerGrupo`) e as rotas `PUT`/`DELETE /api/grupos/:chave`, comitando `pessoas.json` e `contatos.json`.
    - Tela "Grupos" no cadastro: lista e formulário com membros, responsável, modo (`funcao`/`culto_inteiro`), funções e mensagem opcional.
    - Em `montador/lib/migracoes.mjs`, `propostaGrupos` e `aplicarMigracaoGrupos` (FAMILIA NILSINHO e MIN. JOVEM, com membros editáveis antes de aplicar); `diferencasContatos` marca como `coberto_por_grupo` a entrada cuja chave é `nome_exibicao`; a migração de contatos fica desabilitada até a de grupos ser aplicada e a tela mostra grupos antes de contatos.
  - [ ]* 8.1 Teste de propriedade dos grupos
    - **Property 9: Grupos escaláveis válidos**
    - **Validates: Requirements 6.1, 6.2**
  - [ ]* 8.2 Teste de propriedade da derivação com grupos
    - **Property 3: Derivação de contatos** (parte dos grupos)
    - **Validates: Requirements 3.2**
  - [ ]* 8.3 Teste de propriedade da migração com grupos
    - **Property 4: Migração de contatos sem perda** (parte dos grupos: entrada coberta por grupo não vira pessoa nem apelido)
    - **Validates: Requirements 6.6**
  - [ ]* 8.4 Testes com dados reais e roteiro manual
    - Cópia do `pessoas.json` real: a migração de grupos gera os dois grupos aprovados por `carregarPessoas`; `contatos.json` gerado tem "FAMILIA NILSINHO" com o telefone de NILSINHO e "MIN. JOVEM" com o de FABRICIO; MIN. JOVEM sai das pendências da migração de contatos.
    - Roteiro: criar, editar e remover um grupo; tentar `nome_exibicao` igual a um apelido e ver o erro.
  - _Requisitos: 3.2, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_
  - Demo: após aplicar a migração de grupos, `contatos.json` tem "FAMILIA NILSINHO" com o link de NILSINHO, que até agosto/2026 aparecia sem link na escala online.

- [x] Task 9: Lista do cadastro com filtros, contador, última vez e habilitação de sonoplastia
  - Objetivo: achar pessoas rápido, ver quando serviram pela última vez e marcar quem faz sonoplastia.
  - Orientação:
    - Criar `montador/public/modulos/filtro.js` com `filtrarPessoas(pessoas, busca, filtros)`.
    - `listarPessoas` devolve `ultimaVez` (varredura de `atual.json` e `old/AAAA/*.json` que sejam arrays).
    - `scripts/lib/cadastro.js` aceita `habilitacoes.sonoplastia` (padrão `false`); o formulário de pessoa ganha a caixa "Sonoplastia".
    - Na UI: busca sempre visível; botão "Filtros" revela função (regente, equipe, MM, sonoplastia), situação, afastado, dias permitidos e perfil; contador de resultados; coluna "última vez" (ou "nunca").
  - [ ]* 9.1 Teste de propriedade dos filtros
    - **Property 10: Filtros do cadastro**
    - **Validates: Requirements 7.4, 7.5**
  - [ ]* 9.2 Teste de `ultimaVez` e roteiro manual
    - Fixture de `old/` com datas conhecidas; `carregarPessoas` aceita pessoa com e sem `habilitacoes.sonoplastia`; roteiro: filtrar "regente + ativo" e "sonoplastia" e conferir contador.
  - _Requisitos: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 13.5_
  - Demo: filtrar "MM domingo + ativo" mostra a contagem e a última data de cada pessoa.

- [x] Task 10: Desativar e excluir definitivamente
  - Objetivo: dois botões claros, sem apagar histórico por engano.
  - Orientação:
    - Em `montador/lib/pessoas.mjs`: `desativarPessoa`, `motivosBloqueioExclusao` (vínculos de qualquer tipo, membro ou responsável de grupo, histórico em `old/` e `atual.json`) e `excluirPessoa`.
    - Rotas `POST /api/pessoas/:id/desativar` e `DELETE /api/pessoas/:id`; remover o `?fisica=1` atual.
    - Na UI, substituir "Remover" por "Desativar" e "Excluir definitivamente" (desabilitado com o motivo quando bloqueado).
  - [ ]* 10.1 Teste de propriedade da exclusão
    - **Property 11: Exclusão definitiva**
    - **Validates: Requirements 8.3, 8.4**
  - [ ]* 10.2 Roteiro de verificação manual
    - Pessoa com histórico mostra o motivo do bloqueio; pessoa recém-criada é excluída.
  - _Requisitos: 8.1, 8.2, 8.3, 8.4_
  - Demo: tentar excluir alguém que já cantou mostra "aparece em old/2026/062026.json".

### C) Regras

- [x] Task 11: Catálogo de regras e versionamento de texto
  - Objetivo: todas as regras de `processos/regras/*.json` ficam visíveis e editáveis com histórico.
  - Orientação:
    - Criar `scripts/lib/validar-catalogo.js` com as checagens de `scripts/validacao/validar-regras.js` (que passa a usá-lo, mesma saída) mais a integridade dos arquivos canônicos.
    - Criar `montador/lib/regras-catalogo.mjs` (`listarCatalogo`, `historico`, `editarTexto`, `reverter`, `validarCatalogo`) e `processos/regras/historico-versoes.json` vazio (`{ "versoes": [] }`).
    - Rotas `GET /api/regras`, `GET /api/regras/:id/historico`, `PUT /api/regras/:id/texto`, `POST /api/regras/:id/reverter`, comitando o arquivo de origem e o histórico.
  - [ ]* 11.1 Teste de propriedade do histórico
    - **Property 12: Histórico somente por acréscimo e reversão fiel**
    - **Validates: Requirements 9.2, 9.3, 9.4, 9.5, 10.6**
  - [ ]* 11.2 Testes unitários do catálogo
    - `listarCatalogo` cobre todas as entradas dos cinco arquivos; `validar-regras.js` mantém a saída; edição em repositório temporário gera commit com os dois arquivos.
  - _Requisitos: 9.1, 9.2, 9.3, 9.4, 9.5, 21.4_
  - Demo: `PUT /api/regras/PE001/texto` cria as versões 1 e 2 e um commit com `preferencias.json` e o histórico.

- [x] Task 12: Parâmetros executáveis e refatoração do solver com regressão de julho/2026
  - Objetivo: o solver, os candidatos e a validação leem `parametros.json`, sem mudar a sugestão atual.
  - Orientação:
    - Primeiro, antes de refatorar: criar `tests/fixtures/regressao-2026-07/` com cópias de `pessoas.json`, `atual.json`, `old/2026/*.json` e `escalas/2026/07/insumos/indisponibilidade-cantores-vinculada.json`, e gravar `esperado-sugestao.json` (saída de `sugerirMes`) e `esperado-rascunho.md` (saída de `sugerir-rascunho.js`). Os arquivos de entrada e os esperados SHALL ser capturados do estado do repositório no início do projeto (antes da Task 7, que já altera `cadastro.js` e `contatos.json`), não do estado "após o bloco de regras"; rode `git stash`/checkout de HEAD inicial ou copie do working tree antes de qualquer alteração em `scripts/lib/`.
    - Criar `scripts/lib/parametros.js` (`PARAMETROS_PADRAO`, `carregarParametros`, `validarParametros`, `nivel`, `evitarNaSugestao`) e `processos/regras/parametros.json` com os valores do design.
    - Alterar `solver-filtros.js`, `solver-score.js` e `solver-selecao.js` conforme a tabela do design (inclui `papeisPorCulto` e dia real normalizado em `dias_permitidos`).
    - `carregarContexto(mes, { root })` carrega parâmetros e passa a janela a `carregarHistorico`; checagens atuais de `validarEscala` (RF001, RF014, indisponibilidade) passam a ler os níveis.
    - `scripts/ciclo/sugerir-rascunho.js` carrega os parâmetros e ganha `--root=<pasta>`.
    - `salvarParametros` em `regras-catalogo.mjs` e rotas `GET`/`PUT /api/parametros`.
  - [ ]* 12.1 Teste de propriedade dos padrões
    - **Property 13: Parâmetros padrão preservam o Solver**
    - **Validates: Requirements 10.3, 10.4, 10.5**
  - [ ]* 12.2 Teste de regressão de julho/2026
    - `sugerirMes` e `sugerir-rascunho.js --root` sobre a fixture iguais aos arquivos esperados, com `PARAMETROS_PADRAO` e com o `parametros.json` do repositório.
  - [ ]* 12.3 Testes unitários de parâmetros
    - Arquivo ausente ou inválido → padrão + aviso; `validarParametros` aceita o arquivo do repositório.
  - _Requisitos: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.9_
  - Demo: `npm test` passa a regressão; mudar `equipe.tamanho` para 4 via `PUT /api/parametros` faz a sugestão montar equipes de 4.

- [x] Task 13: Tela de regras
  - Objetivo: o diretor consulta, edita, reverte textos e ajusta parâmetros pelo menu.
  - Orientação:
    - Item "Regras" no menu de `montador/public/index.html`; lista por categoria com busca.
    - Card de regra com textos editáveis, histórico (número, data, autor, texto), botão "reverter" por versão e os parâmetros que a referenciam (ativa, nível, valores).
    - Editor de parâmetros gerais (equipe, janela, pesos); avisos de `parametros.json` inválido no topo.
  - [ ]* 13.1 Roteiro de verificação manual
    - Editar RF014, ver histórico com 2 versões, reverter para a 1 (vira versão 3); desativar `minimo_homens` e ver o aviso de RF001 sumir em "Validar".
  - _Requisitos: 9.1, 9.6, 9.7, 10.6, 10.7_
  - Demo: reverter uma regra pela tela e ver o novo commit no `git log`.

### D) Iniciar o mês e insumos

- [x] Task 14: Iniciar ou retomar o mês
  - Objetivo: abrir um mês pelo editor faz o que `npm run iniciar:mes` faz, com calendário completo.
  - Orientação:
    - Criar `montador/lib/ciclo.mjs` (`calendarioBase`, `abrirMes`) e a rota `POST /api/mes/:mes/abrir`, comitando o Acionato criado.
    - Na UI, "Montar escala" chama `abrirMes` e mostra o checklist de insumos (acionato, sonoplastia, enquete) com preenchido/pendente.
  - [ ]* 14.1 Testes unitários e roteiro manual
    - `calendarioBase` para meses de 28 a 31 dias contém exatamente as quartas, sábados e domingos; `abrirMes` em pasta temporária cria a estrutura; mês existente não é sobrescrito.
    - Roteiro: abrir um mês futuro e ver o checklist com tudo pendente.
  - _Requisitos: 11.1, 11.2, 11.3, 11.4_
  - Demo: escolher outubro/2026 cria `escalas/2026/10/insumos/acionato.json` com todas as quartas, sábados e domingos, comitado.

- [x] Task 15: Tela de acionato e dia extraordinário
  - Objetivo: digitar ancião, pregador e observações públicas, e incluir dias especiais com modelo de louvor.
  - Orientação:
    - Criar `montador/lib/insumos.mjs` (`lerAcionato`, `validarAcionato`, `salvarAcionato`) e rotas `GET`/`PUT /api/mes/:mes/acionato`.
    - Criar `montador/lib/contexto.mjs` (`DEPARTAMENTOS`, `ehDepartamental`, `tipoDoCulto`, `slotsDoCulto`, `nomesParticipantes`), reexportando de `regras.mjs` o que já era exportado lá.
    - `cultosDoMes` passa a ler `modelo_louvor`, `extraordinario` e `observacoes` (como `obs`).
    - Tela de acionato: tabela por culto, com o placeholder "Este texto será publicado na escala online" no campo de observações; "Incluir dia extraordinário" (data + modelo sábado/domingo/sem louvor); remover extraordinário.
  - [ ]* 15.1 Testes unitários e roteiro manual
    - `validarAcionato` recusa data duplicada, fora do mês e modelo inválido; salvar e ler preserva os itens; `slotsDoCulto` por modelo.
    - Roteiro: incluir sexta-feira "como domingo", salvar, reabrir e ver o item.
  - _Requisitos: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_
  - Demo: o Acionato gravado contém o dia extraordinário com `modelo_louvor` e `extraordinario: true`.

- [x] Task 16: Tela de sonoplastia
  - Objetivo: escolher sonoplasta e suporte de cada culto pelo cadastro e usá-los como AUDIOVISUAL, SUPORTE e nos conflitos.
  - Orientação:
    - `lerSonoplastia`, `validarSonoplastia` e `salvarSonoplastia` em `montador/lib/insumos.mjs` no formato de `processos/templates/insumo-sonoplastia.json` (`sonoplastia: [sonoplasta, suporte]` + `ids`, `null` para texto livre); rotas `GET`/`PUT /api/mes/:mes/sonoplastia`.
    - `cultosDoMes` preenche `audiovisual` (sonoplasta), `suporte` (ou "-") e `sonoplastiaIds`; `externosPorCulto` usa os IDs e, em arquivo sem `ids`, resolve cada nome por nome/apelido; texto livre não gera conflito.
    - Tela de sonoplastia com todos os cultos do mês (inclusive quartas): "Sonoplasta" e "Suporte" (opcional) com as pessoas ativas de habilitação sonoplastia ou texto livre marcado "fora do cadastro" (validado por `problemasNome`); atalho "cadastrar pessoa" que abre o formulário com a habilitação marcada e volta à tela; status preenchido/pendente no checklist do mês.
  - [ ]* 16.1 Testes unitários e roteiro manual
    - Sonoplasta e suporte do cadastro viram dois IDs em `externosPorCulto`; arquivo antigo sem `ids` resolve por nome; texto livre com vírgula é recusado; sem `sonoplastia.json`, o comportamento atual não muda.
    - Roteiro: escolher ALEX como sonoplasta e "VOLUNTÁRIO" como suporte de um sábado; cadastrar uma pessoa nova pelo atalho e escolhê-la numa quarta.
  - _Requisitos: 11.4, 13.1, 13.2, 13.6, 13.7, 13.8_
  - Demo: com ALEX na sonoplastia de um sábado, ele deixa de aparecer como elegível na equipe desse culto.

- [x] Task 17: Importação da indisponibilidade
  - Objetivo: anexar a enquete e associar cada votante com segurança, como `vincular-indisponibilidade.js`.
  - Orientação:
    - Criar `scripts/lib/indisponibilidade.js` (`nomesDaEnquete`, `montarVinculada`) e fazer `scripts/ciclo/vincular-indisponibilidade.js` usá-la, com a mesma saída.
    - Criar `montador/lib/indisponibilidade.mjs` (`validarEnquete`, `analisarEnquete`, `gravarImportacao`) com o algoritmo de associação do design: telefone de uma só pessoa associa; telefone compartilhado fica pendente com as pessoas possíveis.
    - Rotas `.../indisponibilidade/analisar` e `.../gravar`; confirmações por nome gravam apelidos via `salvarPessoa` (commit do cadastro) só quando o texto passa em `problemasNome`; Enquete, Indisponibilidade_Vinculada e snapshot em `arquivo/` em outro commit.
    - UI: anexar arquivo (lido no navegador e enviado como JSON), lista de pendentes com opções (confirmar, escolher outra pessoa, ignorar) e relatório.
  - [ ]* 17.1 Teste de propriedade da associação
    - **Property 24: Associação da enquete**
    - **Validates: Requirements 14.4, 14.5, 14.6, 14.7, 14.8, 14.13, 14.14**
  - [ ]* 17.2 Teste de propriedade da vinculada
    - **Property 25: Indisponibilidade vinculada**
    - **Validates: Requirements 14.9, 14.10, 14.11**
  - [ ]* 17.3 Testes com dados reais e roteiro manual
    - `escalas/2026/07/insumos/indisponibilidade-cantores.json`: `vincular-indisponibilidade.js` produz o mesmo arquivo de antes (exceto `gerado_em`); `validarEnquete` recusa formato errado e lista datas fora do mês.
    - Entrada com o número 5543996579868 fica pendente entre BERNARDO e RONI e a decisão não vira apelido.
    - Roteiro: anexar a enquete de julho, resolver um pendente, reimportar e ver a associação automática.
  - _Requisitos: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.10, 14.11, 14.12, 14.13, 14.14_
  - Demo: o relatório mostra associados, pendentes e ignorados; quem votou "não posso" some dos elegíveis daquela data.

### E) Montagem

- [x] Task 18: Grade, card e Banda/PB com estado por ID
  - Objetivo: a montagem mostra o mês em grade com acionato, sonoplastia e Banda/PB, guardando pessoas por ID.
  - Orientação:
    - `GET /api/dados` devolve `CultoMontagem` com `tipo`, `slots`, `modelo_louvor`, acionato e sonoplastia.
    - `montador/public/app.js`: estado por ID (`regente`, `equipe[]`, `mm` por slot), nomes por `pessoasPorId`; card com ancião, pregador, OBS, sonoplasta e suporte e `<select>` Banda/PB (padrão BANDA no modelo sábado, PB nos demais).
    - `montador/public/estilo.css`: grade `repeat(4, minmax(0, 1fr))` com media queries para 3 e 2 colunas; destaque de sábado.
    - `paraParticipacao` em `contexto.mjs` usado por `POST /api/participacao` (sem alterar `participacao.mjs`).
  - [ ]* 18.1 Testes unitários e roteiro manual
    - `paraParticipacao`: dia extraordinário conta como o modelo; `sem_louvor` fica de fora.
    - Roteiro: 4 colunas em tela larga, 3 e 2 ao estreitar; sábado destacado; trocar Banda/PB.
  - _Requisitos: 12.7, 13.3, 15.1, 15.2, 15.3, 15.7_
  - Demo: abrir setembro/2026 e ver os cards em 4 colunas com ancião, pregador, sonoplastia e Banda/PB.

- [x] Task 19: Filtro por dia na montagem
  - Objetivo: focar em parte do mês sem perder o que está oculto.
  - Orientação:
    - `datasVisiveis` em `montador/public/modulos/filtro.js`.
    - Chips "Sábados", "Domingos", "Quartas", "Extraordinários" e seletor de data; esconder cards por atributo, sem tirar do estado.
  - [ ]* 19.1 Testes unitários e roteiro manual
    - `datasVisiveis` para combinações de dias e data.
    - Roteiro: filtrar sábados, editar, limpar o filtro e ver o resto intacto.
  - _Requisitos: 15.4, 15.5, 15.6_
  - Demo: "só domingos" mostra apenas domingos; ao limpar, os sábados continuam preenchidos.

- [x] Task 20: Avaliação única para candidatos, substitutos e validação
  - Objetivo: uma só regra decide quem pode, quem pode com aviso e quem não pode, tanto na escolha quanto na validação.
  - Orientação:
    - Criar `montador/lib/avaliacao.mjs` (`criarEstadoMes`, `avaliarAtribuicao`, `avaliarCulto`) conforme o design, com níveis de `parametros.json` e avisos de vínculo.
    - Em `montador/lib/regras.mjs`: `candidatosParaCelula(base, cultos, data, slot)` devolve `{ elegiveis, elegiveisComAviso, naoElegiveis }`; `candidatosSubstitutos`; `validarEscala` via avaliação, com nome/ID fora do cadastro = erro e `ItemValidacao` com `id` estável.
    - Rotas `POST /api/candidatos` e `POST /api/substitutos` recebem a escala do mês inteira.
  - [ ]* 20.1 Teste de propriedade dos níveis
    - **Property 14: Nível define a severidade**
    - **Validates: Requirements 10.8, 16.9, 21.1**
  - [ ]* 20.2 Teste de propriedade da coerência
    - **Property 15: Candidatos coerentes com a validação**
    - **Validates: Requirements 16.1, 16.2, 16.9**
  - [ ]* 20.3 Teste de propriedade do acúmulo no culto
    - **Property 16: Acúmulo no mesmo culto**
    - **Validates: Requirements 13.8, 16.4, 16.5, 16.6, 16.7, 16.8**
  - [ ]* 20.4 Teste de propriedade dos vínculos
    - **Property 17: Vínculos só avisam**
    - **Validates: Requirements 5.6, 16.3, 16.11**
  - _Requisitos: 5.6, 10.8, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8, 16.9, 21.1, 21.2_
  - Demo: `POST /api/candidatos` para a equipe de um sábado devolve o pregador em `elegiveisComAviso` e o regente do culto em `naoElegiveis` com o motivo.

- [x] Task 21: Interface de candidatos e substitutos
  - Objetivo: o seletor mostra os três grupos e o clique num nome mostra substitutos.
  - Orientação:
    - Seletor em `app.js`: elegíveis (ordem de score, histórico e "porquê"), "com aviso" com o texto, "não elegíveis" recolhidos com motivo.
    - Clique num chip abre substitutos (`/api/substitutos`) e troca a pessoa.
    - Card mostra ícone e texto dos avisos das atribuições escolhidas com aviso.
  - [ ]* 21.1 Roteiro de verificação manual
    - Escolher o pregador para a equipe (aviso visível no card); trocar um nome por substituto; abrir "não elegíveis" e ler os motivos.
  - _Requisitos: 16.1, 16.2, 16.11_
  - Demo: clicar num nome já escalado mostra os substitutos, e quem tem `precisa_de` não atendido no culto aparece com o aviso de vínculo.

- [x] Task 22: Dia extraordinário de ponta a ponta
  - Objetivo: o dia extraordinário funciona na sugestão, validação, participação e publicação como os demais.
  - Orientação:
    - `sugerirMes(base, { cultos, modo })` percorre os cultos do Acionato (inclusive extraordinários) e passa `dia_semana: modelo_louvor` a `sugerirCulto`.
    - Em `montador/lib/publicar.mjs`, criar `gerarLinhasAtual(base, cultos)` usando `tipoDoCulto` (quarta e sem louvor com "-", departamental com o nome, `pessoa.nome` por ID, OBS de `culto.obs`, AUDIOVISUAL = sonoplasta, SUPORTE = suporte ou "-", MM do modelo sábado como "NOME_ES, NOME_CULTO" ou só a preenchida, ordem por data).
  - [ ]* 22.1 Teste de propriedade da sugestão
    - **Property 19: Sugestão respeita bloqueios, evitações e modelo**
    - **Validates: Requirements 16.10, 17.1, 17.2, 17.3**
  - [ ]* 22.2 Teste de exemplo de ponta a ponta
    - Sexta-feira "como domingo", sexta "como sábado" e quinta "sem louvor": candidatos, `validarEscala`, `paraParticipacao` e `gerarLinhasAtual` (posição, "-", duas MMs na sexta "como sábado" e aviso `mm_vazia` com uma só).
  - _Requisitos: 12.8, 13.4, 16.10, 17.1, 17.2, 17.3, 17.4, 17.5, 22.1, 29.5, 29.6, 29.7_
  - Demo: incluir uma sexta "como sábado", rodar a sugestão e ver regente, 5 na equipe e 2 MM nela.

- [x] Task 23: Sugestão automática com confirmação e fixos
  - Objetivo: a sugestão não apaga escolhas manuais sem perguntar.
  - Orientação:
    - `solver-selecao.js`: `culto.fixos` (regente, equipe, MM por slot) já marcados no contexto, preenchendo só o que falta; `sugerirMes` em modo `vazios` pré-carrega `escaladosPorCulto`, `escaladosNesteMes` e `papeisPorCulto` com todas as atribuições.
    - `POST /api/sugerir` recebe `{ mes, cultos, modo }` e, em `vazios`, devolve também `validarEscala` do resultado.
    - UI: modal "Sobrescrever tudo / Só preencher vazios / Cancelar" quando há atribuição; sem atribuição, aplica direto.
  - [ ]* 23.1 Teste de propriedade dos fixos
    - **Property 20: "Só preencher vazios" preserva os fixos**
    - **Validates: Requirements 18.3, 18.4**
  - [ ]* 23.2 Regressão e roteiro manual
    - Modo `vazios` com escala vazia é igual a `esperado-sugestao.json` da fixture.
    - Roteiro: fixar um regente, "só preencher vazios", ver o regente mantido e a validação exibida.
  - _Requisitos: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6_
  - Demo: com dois sábados preenchidos à mão, "só preencher vazios" completa o resto sem tocar neles.

- [x] Task 24: Rascunho automático por ID e partida pela publicação
  - Objetivo: o trabalho é salvo a cada mudança e um mês publicado abre com o que está no site.
  - Orientação:
    - `montador/public/modulos/rascunho.js` (`chaveRascunho`, `serializarRascunho`, `desserializarRascunho`).
    - `cultosDeAtual(linhas, base)` em `publicar.mjs` (nomes → IDs, preservando LOUVORES ES, TEMA CULTO e SUPORTE; MENSAGEM MUSICAL do modelo sábado com o 1º nome em `mm_es` e o 2º em `mm_culto`; nomes além das vagas em `culto.excedentes`); `GET /api/dados` devolve `publicada`.
    - `avaliarCulto` ganha o aviso `excedente` por nome em `culto.excedentes`; o card mostra os excedentes com "remover" e "mover para vaga".
    - Criar `tests/fixtures/agosto-2026/` com cópias de `atual.json`, `contatos.json`, `escalas/2026/08/links-whatsapp.md` e um `pessoas.json` com os grupos da Task 8 (usada também nas Tasks 27, 30 e 34).
    - UI: salvar no `localStorage` a cada atribuição ou Banda/PB; ao abrir mês com rascunho, modal "Recuperar / Nova montagem"; recuperar revalida; nova apaga o rascunho; sem rascunho, parte de `publicada` ou vazio. Atribuições "fora do cadastro" aparecem marcadas no card.
  - [ ]* 24.1 Teste de propriedade do rascunho
    - **Property 21: Rascunho por ID**
    - **Validates: Requirements 19.1, 19.3, 19.4**
  - [ ]* 24.2 Teste de propriedade da ida e volta do atual.json
    - **Property 26: Geração do atual.json e ida e volta** (parte das pessoas)
    - **Validates: Requirements 12.8, 13.4, 17.5, 19.5, 19.6, 22.1, 23.2, 29.6, 29.7, 29.8**
  - [ ]* 24.3 Teste de propriedade da leitura sem descarte
    - **Property 27: Leitura do atual.json sem descarte**
    - **Validates: Requirements 29.8, 29.9**
  - [ ]* 24.4 Teste de regressão do sábado de agosto/2026 e roteiro manual
    - Fixture de agosto: 08/08 "DANI HERREIRA, BERNARDO" vira `mm_es` = DANI HERREIRA e `mm_culto` = BERNARDO, e `gerarLinhasAtual` devolve a mesma string; MENSAGEM MUSICAL com três nomes num sábado gera dois nomes nas vagas, um excedente e um aviso.
    - Roteiro: montar parte do mês, recarregar a página, recuperar; renomear uma pessoa no cadastro e ver o novo nome no rascunho.
  - _Requisitos: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 29.8, 29.9_
  - Demo: abrir agosto/2026 (publicado) mostra as atribuições do `atual.json`; fechar e reabrir oferece recuperar o rascunho.

- [x] Task 25: Indicador da escala e progresso visual
  - Objetivo: ver se a escala difere do publicado e quanto falta.
  - Orientação:
    - `assinatura` em `modulos/rascunho.js` e `calcularProgresso` em `modulos/progresso.js`.
    - UI: indicador "não sincronizado" na barra da montagem quando `assinatura(estado) ≠ assinatura(publicada)`; barra de progresso, contadores e card esmaecido quando completo.
  - [ ]* 25.1 Teste de propriedade do filtro e do indicador
    - **Property 22: Filtro e indicador não alteram a escala**
    - **Validates: Requirements 15.4, 15.5, 15.6, 19.8**
  - [ ]* 25.2 Teste de propriedade do progresso
    - **Property 23: Progresso**
    - **Validates: Requirements 20.1, 20.2, 20.3**
  - [ ]* 25.3 Roteiro de verificação manual
    - Trocar um nome num mês publicado acende o indicador; desfazer apaga; completar um culto esmaece o card; quartas não contam.
  - _Requisitos: 19.8, 20.1, 20.2, 20.3_
  - Demo: a barra mostra "38 de 52 funções" e o indicador acende ao mudar qualquer atribuição publicada.

- [x] Task 26: Observação pública editável no card
  - Objetivo: o diretor ajusta a OBS de cada culto na montagem, sabendo que ela vai para a escala online e sem texto que quebre a página.
  - Orientação:
    - Criar `scripts/lib/obs-publico.js` (termos de `scripts/validacao/validar-obs-publico.js`, que passa a importá-los) e acrescentar `problemasObs` e `problemasTextoLivre` a `scripts/lib/texto-publico.js`; rota `POST /api/texto-publico`.
    - Card: campo "Observação" (`<textarea>`) pré-preenchido com `obs` do Acionato, placeholder "Este texto será publicado na escala online", validação na hora pela rota (atraso de 300 ms) com o problema exibido no card.
    - `obs` entra em `serializarRascunho`/`desserializarRascunho` e em `assinatura` (todos os cultos, inclusive quartas); mudar a OBS salva o Rascunho; `gerarLinhasAtual` publica `culto.obs` e `cultosDeAtual` lê OBS.
  - [ ]* 26.1 Teste de propriedade do texto público
    - **Property 29: Texto exibido sem escape**
    - **Validates: Requirements 4.9, 6.2, 15.9**
  - [ ]* 26.2 Testes unitários e roteiro manual
    - Rascunho preserva a OBS; `assinatura` muda quando só a OBS muda; `validar-obs-publico.js` mantém a saída.
    - Roteiro: digitar "<b>" e "pendente" na OBS e ver os dois problemas; mudar a OBS de um mês publicado acende "não sincronizado".
  - _Requisitos: 12.8, 15.8, 15.9, 19.1, 19.8_
  - Demo: editar a OBS de um domingo acende o indicador, e a OBS editada aparece no `atual.json` gerado.

- [x] Task 27: Grupos escaláveis na montagem
  - Objetivo: escalar FAMILIA NILSINHO numa MM e deixar MIN. JOVEM assumir um culto, com as mesmas regras de disponibilidade e aviso.
  - Orientação:
    - `montador/lib/avaliacao.mjs`: ocupante `'grupo:<chave>'` com `avaliarGrupo` do design (funções do grupo, indisponível só sem nenhum membro disponível, aviso `membros_indisponiveis`, aviso `membro_em_outra_funcao` nos dois sentidos, uma vaga, MM por mês e consecutivo pela chave); `avaliarCulto` dispensa equipe, regente, MM e mínimo de homens do culto com `assumidoPor`.
    - `candidatosParaCelula` e `candidatosSubstitutos` incluem os grupos com `tipo: 'grupo'` ao fim de cada seção; `sugerirMes` não escala grupos e, em `vazios`, mantém grupos e cultos assumidos como fixos.
    - `CultoMontagem.assumidoPor` e ação "Grupo assume o culto" (e desfazer) no card de culto `louvor`; `calcularProgresso` conta o culto assumido como completo.
    - `gerarLinhasAtual` grava `nome_exibicao` (nos três campos de louvor quando o grupo assume o culto); `cultosDeAtual` reconhece `nome_exibicao` e culto assumido; Rascunho e `assinatura` guardam `'grupo:<chave>'` e `assumidoPor`.
  - [ ]* 27.1 Teste de propriedade do grupo na montagem
    - **Property 18: Grupo na montagem**
    - **Validates: Requirements 6.8, 6.9, 6.10, 6.11, 6.12, 6.13, 6.14**
  - [ ]* 27.2 Teste de propriedade da ida e volta com grupos
    - **Property 26: Geração do atual.json e ida e volta** (parte dos grupos: `nome_exibicao` e culto assumido)
    - **Validates: Requirements 6.15**
  - [ ]* 27.3 Testes com a fixture de agosto/2026 e roteiro manual
    - 29/08 com FAMILIA NILSINHO e 23/08 com MIN. JOVEM nos três campos: ida e volta por `cultosDeAtual` e `gerarLinhasAtual` igual ao `atual.json` de agosto; progresso conta 23/08 como completo.
    - Roteiro: escolher FAMILIA NILSINHO como MM culto com MIRELLA na equipe do mesmo culto e ver o aviso; marcar NILSINHO indisponível e ver o aviso com o nome; "Grupo assume o culto" com MIN. JOVEM.
  - _Requisitos: 6.8, 6.9, 6.10, 6.11, 6.12, 6.13, 6.14, 6.15, 29.5_
  - Demo: publicar um mês com FAMILIA NILSINHO na MM de um sábado e MIN. JOVEM assumindo um domingo grava os nomes como em agosto/2026.

- [x] Task 28: Checkpoint da montagem
  - Garantir que todos os testes passam; perguntar ao usuário em caso de dúvida.

### F) Envio

- [x] Task 29: Revalidação completa antes do envio
  - Objetivo: nada chega ao site com erro, e cada aviso tem ciência.
  - Orientação:
    - Criar `montador/lib/revalidacao.mjs` (`revalidarParaEnvio`, `travaTelefone` com Grupo_Escalavel validado pelo telefone do responsável e só Departamento isento, `verificarObs` com `problemasObs` da Task 26, `validarCatalogo`, aviso por votante pendente).
    - Rota `POST /api/revalidar-envio`.
    - UI: painel com erros (culto, função, pessoa) e avisos com caixa de ciência; botão "Enviar" só com zero erros e todas as ciências.
  - [ ]* 29.1 Teste de propriedade das travas
    - **Property 28: Travas de envio**
    - **Validates: Requirements 6.16, 21.2, 21.3, 21.4**
  - [ ]* 29.2 Testes unitários e roteiro manual
    - MANU C. (sem telefone) escalada gera erro; culto departamental de JOVENS não gera; FAMILIA NILSINHO passa pelo telefone de NILSINHO; grupo com responsável sem telefone gera erro; OBS com "pendente" ou "<" gera erro.
    - Roteiro: marcar ciência de cada aviso e ver o botão habilitar.
  - _Requisitos: 6.16, 21.1, 21.2, 21.3, 21.4, 21.5, 21.6, 21.7_
  - Demo: escalar alguém sem telefone bloqueia o envio com "sem telefone no cadastro".

- [x] Task 30: Conferência da escala online
  - Objetivo: antes do fechamento, o editor confirma com o código do próprio viewer que cada nome publicado abre o WhatsApp da pessoa certa.
  - Orientação:
    - Criar `montador/lib/conferencia.mjs` (`CAMPOS_LISTA`, `CAMPOS_NOME`, `nomesComoOViewer`, `entradasQueCasam`, `conferirLinks`) importando `buscarContato` de `src/utils/contact.js` e `normalizarNome` de `src/utils/name.js`, com as regras do design: louvor sem link ou com link de outro telefone, link de outra pessoa em qualquer campo exibido, nome ambíguo, vírgula em campo de `formatarNome`, `problemasNome` nos nomes publicados e "<"/">" em OBS, ANCIÃO e PREGADOR.
    - `revalidarParaEnvio` chama `conferirLinks(linhasAtual, derivarContatos(pessoas, grupos), base)` e confere que cada nome gerado é o `pessoa.nome` ou `nome_exibicao` do ocupante; `POST /api/revalidar-envio` devolve `conferencia.tabela`.
    - UI do painel de revalidação: erros da conferência com culto, campo, nome e número que o link abre.
  - [ ]* 30.1 Teste de propriedade da conferência
    - **Property 30: Conferência espelha o viewer**
    - **Validates: Requirements 22.3, 22.4, 22.5, 22.6, 22.7, 22.8**
  - [ ]* 30.2 Teste de contrato com o viewer
    - Como `tests/baseline/viewer-pipeline.test.js`: renderizar com `src/ui/table.js` e `src/ui/cards.js` a saída de `gerarLinhasAtual` e `derivarContatos` sobre a fixture de agosto/2026 e conferir que cada nome de REGENTE LOUVOR, EQUIPE LOUVOR e MENSAGEM MUSICAL vira `<a class="whats">` com o `href` da pessoa certa (FAMILIA NILSINHO com o de NILSINHO); `formatarLista` gera dois links para "DANI HERREIRA, BERNARDO"; `formatarNome` deixa AUDIOVISUAL "A, B" sem link.
  - [ ]* 30.3 Testes unitários
    - Nome com apelido normalizado igual ao de outra pessoa gera "ambíguo"; AUDIOVISUAL fora do cadastro que casa com um apelido gera "link de outra pessoa"; BERNARDO e RONI, com o mesmo número, não geram erro.
  - _Requisitos: 22.1, 22.2, 22.3, 22.4, 22.5, 22.6, 22.7, 22.8, 29.6_
  - Demo: dar a uma pessoa um apelido que só difere por acento do nome de outra (após confirmar o aviso) e escalar a outra bloqueia o envio com "nome ambíguo no contatos.json".

- [x] Task 31: Fechamento completo em processo
  - Objetivo: um clique faz tudo que `publicar-fechamento.js` faz, sem shell, e envia ao GitHub.
  - Orientação:
    - `scripts/controle/controle-rotacao-utils.js`: funções aceitam `{ periodos, saida, root }` com os padrões atuais e `IGNORAR` inclui `DEPARTAMENTOS`; Grupo_Escalavel é contado pelo `nome_exibicao`; criar `montador/lib/controles.mjs` (`periodosDaJanela`, `atualizarControles`).
    - Criar `montador/lib/fechamento.mjs` (`fechar`) com as etapas do design: pull, revalidação com ciências (inclui a conferência da Task 30), backup em `old/`, `atual.json`, `contatos.json` (`derivarContatos(pessoas, grupos)`, o mesmo conferido), controles, linha em `processos/logs/publicacoes.md`, limpeza como `coletor-lixo-pos-publicacao.js`, restauração em falha, commit seletivo e `enviar()`.
    - `POST /api/fechar` substitui `POST /api/publicar`; UI mostra o relatório e, com `push: 'pendente'`, "tentar de novo".
  - [ ]* 31.1 Teste de propriedade do bloqueio do fechamento
    - **Property 31: Fechamento só com tudo resolvido**
    - **Validates: Requirements 21.6, 21.7, 21.8, 28.3**
  - [ ]* 31.2 Teste de propriedade dos controles
    - **Property 32: Controles de rotação**
    - **Validates: Requirements 6.17, 23.5, 28.4, 29.4**
  - [ ]* 31.3 Teste de propriedade de falha no fechamento
    - **Property 5: Falha não deixa rastro** (parte do fechamento: falha injetada em cada etapa antes do commit)
    - **Validates: Requirements 23.9**
  - [ ]* 31.4 Teste de integração do fechamento
    - Cópia da fixture num repositório temporário com remoto bare: arquivos esperados no commit (inclusive removidos), linha no log, push `ok`; com remoto inexistente, `pendente`. Scripts `controle:*` mantêm a saída.
  - _Requisitos: 6.17, 21.8, 23.1, 23.2, 23.3, 23.4, 23.5, 23.6, 23.7, 23.8, 23.9, 23.10_
  - Demo: enviar setembro/2026 gera um commit com `atual.json`, backup, `contatos.json`, três controles, log e insumos removidos.

- [x] Task 32: Verificação automática do site
  - Objetivo: o editor confirma sozinho que o site publicou a escala enviada e que os links publicados abrem o número certo.
  - Orientação:
    - Criar `montador/lib/verificacao-site.mjs` (`conteudoCoincide`, `conferirSite`) e `POST /api/verificar-site`: busca `atual.json` e `contatos.json` remotos com `?t=` e `cache: 'no-store'`; com os dois iguais aos locais, roda `conferirLinks` (Task 30) sobre os remotos e devolve `publicado` com a `tabela` ou `erro_conferencia` com os erros.
    - UI após o fechamento: "aguardando publicação" com consulta a cada 15 s; após 10 min, mensagem e "continuar verificando"; `pendente_envio` mostra "tentar de novo"; em `publicado`, tabela "nome na escala → número que o link abre" dos participantes do louvor e o botão "vi a escala atualizada" com o link; em `erro_conferencia`, lista de erros e botão desabilitado. Remover o texto de espera de 5 minutos.
  - [ ]* 32.1 Teste de propriedade da comparação
    - **Property 33: Verificação do site**
    - **Validates: Requirements 24.1, 24.2, 24.3, 24.5, 24.7, 24.8**
  - [ ]* 32.2 Testes unitários e roteiro manual
    - `fetch` falso e relógio falso: as duas URLs com `?t=`, `cache: 'no-store'`, estados `aguardando` (só `atual.json` igual), `publicado`, `erro_conferencia` e `pendente_envio`.
    - Roteiro: após um envio real, ver a tabela e o botão habilitar quando o Pages atualizar.
  - _Requisitos: 24.1, 24.2, 24.3, 24.4, 24.5, 24.6, 24.7, 24.8_
  - Demo: depois do push, a tela troca de "aguardando publicação" para a tabela de links e o botão com o link quando o Pages termina.

- [x] Task 33: Mensagens de WhatsApp editáveis
  - Objetivo: o texto das mensagens sai do código e passa a ser editado na tela de regras, com histórico.
  - Orientação:
    - Criar `scripts/lib/mensagens-whatsapp.js` (`MENSAGENS_PADRAO` com os textos de agosto/2026 do design, `PLACEHOLDERS`, `carregarMensagens`, `validarMensagens`, `preencherMensagem`) e `processos/regras/mensagens-whatsapp.json` com o conteúdo inicial.
    - `salvarMensagens` em `montador/lib/regras-catalogo.mjs` (histórico com `alvo: 'mensagens-whatsapp'`) e rotas `GET`/`PUT /api/mensagens-whatsapp`, comitando o arquivo e o histórico.
    - Card "Mensagens de WhatsApp" na tela de regras: templates `pessoa`, `grupo`, `culto_inteiro` e `fixo`, contatos fixos, link do grupo, prévia com um exemplo, histórico e reverter; aviso no topo se o arquivo estiver ausente ou inválido.
    - Gravar a nova versão de RF025 com `editarTexto`, apontando para `mensagens-whatsapp.json`.
  - [ ]* 33.1 Teste de propriedade do histórico das mensagens
    - **Property 12: Histórico somente por acréscimo e reversão fiel** (parte das mensagens)
    - **Validates: Requirements 26.3**
  - [ ]* 33.2 Testes unitários e roteiro manual
    - `preencherMensagem`: `{nome}` "DANY KALLAS" → "Dany Kallas"; `{funções}` com três funções → "*REGENTE LOUVOR*, *EQUIPE LOUVOR* e *MENSAGEM MUSICAL*"; `{data}` "23/08"; placeholder desconhecido e template vazio recusados; arquivo ausente → padrão + aviso.
    - Roteiro: editar o template `pessoa`, ver a prévia, salvar e reverter.
  - _Requisitos: 26.1, 26.2, 26.3, 26.4, 26.5, 26.6, 26.8_
  - Demo: editar o template `pessoa` na tela de regras gera um commit com `mensagens-whatsapp.json` e o histórico.

- [x] Task 34: WhatsApp no servidor e texto da RF023
  - Objetivo: montar as mensagens por pessoa e por grupo com os templates editáveis, sem gerar `.md`.
  - Orientação:
    - Criar `scripts/lib/links-whatsapp.js` com as funções de `scripts/publicacao/gerar-links-publicacao.js`, usando `carregarMensagens` e `preencherMensagem` da Task 33 no lugar do `MENSAGEM_TEMPLATE` fixo; o script passa a importá-las e continua gerando o `.md`.
    - Pessoa: um envio com o template `pessoa`. Grupo_Escalavel: um envio para o telefone do responsável com `grupo.mensagem` ou o template `grupo`/`culto_inteiro` (com `{data}`); membros não recebem envio pelo grupo. Fixos com o template `fixo`; convite do grupo do louvor.
    - Criar `montador/lib/whatsapp.mjs` (`listaDoMes`) com isenção só de departamentos e `GET /api/whatsapp`.
    - Gravar a nova versão de RF023 com `editarTexto` (tela de WhatsApp do editor como etapa obrigatória; `links-whatsapp.md` só pela linha de comando).
  - [ ]* 34.1 Teste de propriedade da lista
    - **Property 34: Lista de WhatsApp**
    - **Validates: Requirements 6.18, 25.2, 25.3, 25.4, 25.10, 26.2, 26.7, 29.4**
  - [ ]* 34.2 Teste de regressão de agosto/2026 e unitários
    - Fixture de agosto: a lista gerada reproduz o texto dos links de `escalas/2026/08/links-whatsapp.md` (pessoas, FAMILIA NILSINHO para NILSINHO, MIN. JOVEM para FABRICIO com "23/08", Adelaide e Yasser), salvo as diferenças documentadas no design ("no culto da família", "(Total Jovem)", espaço após "Yasser!", "Fabricio" sem acento).
    - `listaDoMes` não grava arquivos; RF023 tem nova versão no histórico.
  - _Requisitos: 6.18, 25.2, 25.3, 25.4, 25.8, 25.9, 25.10, 26.7_
  - Demo: `GET /api/whatsapp` devolve os links de agosto/2026 com uma mensagem para NILSINHO pela FAMILIA NILSINHO, Adelaide, Yasser e o grupo, sem envios para as quartas.

- [x] Task 35: Tela de WhatsApp com enviados
  - Objetivo: mandar a mensagem com um clique e saber para quem já foi.
  - Orientação:
    - Criar `montador/public/modulos/enviados.js` (`chaveEnviados`, `marcarEnviado`, `separar`).
    - Tela aberta por "vi a escala atualizada": lista de pendentes; clique abre o link e move para "Enviados" (recolhível, com "reenviar"); estado por mês no `localStorage`.
  - [ ]* 35.1 Teste de propriedade dos enviados
    - **Property 35: Enviados por mês**
    - **Validates: Requirements 25.5, 25.6, 25.7**
  - [ ]* 35.2 Roteiro de verificação manual
    - Clicar em três contatos, recarregar, ver os três em "Enviados"; reenviar um; trocar de mês e ver a lista limpa.
  - _Requisitos: 25.1, 25.5, 25.6, 25.7_
  - Demo: clicar num nome abre o WhatsApp com a mensagem pronta e o nome desce para "Enviados".

- [x] Task 36: Conclusão
  - Objetivo: encerrar o mês com um sinal claro.
  - Orientação:
    - Botão "Concluir" na tela de WhatsApp; animação CSS "Escala de (mês) concluída, te vejo na próxima" com o link da escala online verificada; apagar o rascunho do mês do `localStorage`.
  - [ ]* 36.1 Roteiro de verificação manual
    - Concluir, ver a animação e o link; reabrir o mês e confirmar que não há pergunta de rascunho.
  - _Requisitos: 19.7, 27.1_
  - Demo: o fluxo inteiro de um mês termina na animação com o link do site.

- [x] Task 37: Ajustar escala publicada
  - Objetivo: corrigir um campo do `atual.json` com as mesmas regras do envio.
  - Orientação:
    - Criar `montador/lib/ajuste-publicada.mjs` (`listarPublicada`, `previsaoAjuste`, `ajustar`) e rotas `GET /api/publicada`, `POST /api/publicada/previa`, `PUT /api/publicada`.
    - Item de menu "Ajustar escala publicada": lista de cultos, edição de nome (seletor com pessoas e Grupos_Escalaveis do cadastro), OBS (placeholder "Este texto será publicado na escala online", validação na hora pela rota da Task 26) ou Banda/PB, prévia da revalidação com ciências (inclui `conferirLinks`), salvar e ir para a verificação do site (sem WhatsApp).
  - [ ]* 37.1 Teste de propriedade do ajuste
    - **Property 36: Ajuste altera só o campo**
    - **Validates: Requirements 28.2, 28.4**
  - [ ]* 37.2 Testes unitários e roteiro manual
    - Ajuste com erro não grava; ajuste válido comita só `atual.json` e os três controles.
    - Roteiro: trocar uma pessoa da equipe de um domingo e ver o site atualizar.
  - _Requisitos: 28.1, 28.2, 28.3, 28.4, 28.5_
  - Demo: trocar a OBS de um culto publicado gera um commit e a verificação confirma o site.

- [x] Task 38: Verificação cruzada das regras de contexto
  - Objetivo: quartas, departamentos, sem louvor e "-"/vazio tratados igual em todos os pontos.
  - Orientação:
    - Substituir checagens locais de `'quarta-feira'`, `ehDepartamental` e `'-'` em `montador/lib/` e `montador/public/app.js` por `contexto.mjs` (ou pelos campos `tipo`/`slots` vindos da API).
  - [ ]* 38.1 Teste de propriedade do contexto
    - **Property 37: Contexto do culto único**
    - **Validates: Requirements 12.3, 17.4, 29.1, 29.2, 29.3, 29.4, 29.5**
  - _Requisitos: 29.1, 29.2, 29.3, 29.4_
  - Demo: um mês com quarta, culto de JOVENS e dia sem louvor aparece igual na montagem, no `atual.json`, nos controles e sem mensagens de WhatsApp para esses cultos.

- [x] Task 39: Checkpoint do envio
  - Garantir que todos os testes passam; perguntar ao usuário em caso de dúvida.

### G) Instalador Windows

- [x] Task 40: Casca Electron rodando o montador do clone
  - Objetivo: abrir o editor como programa no Windows, com o servidor do próprio clone.
  - Orientação:
    - Pré-requisito: `montador/` está versionado no repositório (hoje `git ls-files montador` é vazio), pois a casca roda o servidor de dentro do clone.
    - Criar `editor-windows/` (`package.json` com Electron e electron-builder em devDependencies, `main.mjs`, `lib/servidor.mjs`, `lib/links.mjs`).
    - `main.mjs`: instância única; `utilityProcess.fork` de `<clone>/montador/server.mjs` (fallback `ELECTRON_RUN_AS_NODE`) com o `env` do design; espera `/api/saude`; janela em `http://127.0.0.1:4599`; reinício único no código 75; encerra o servidor ao fechar; `setWindowOpenHandler` e `will-navigate` com `linkPermitido`; `MONTADOR_GIT` aponta para o MinGit.
  - [ ]* 40.1 Teste de propriedade da casca
    - **Property 39: Casca não vaza token nem abre links arbitrários**
    - **Validates: Requirements 30.8, 31.5**
  - [ ]* 40.2 Testes unitários e roteiro manual
    - `decidirReinicio` e `montarEnvServidor` em `tests/editor-windows/`.
    - Roteiro em Windows: abrir duas vezes (foca a primeira), clicar num link wa.me (abre fora), fechar a janela (processo do servidor some).
  - _Requisitos: 30.1, 30.2, 30.5, 30.6, 30.7, 30.8, 30.9, 30.10_
  - Demo: `npx electron .` em `editor-windows/` com `ESCALA_REPO_DIR` apontando para o repositório abre o editor numa janela.

- [x] Task 41: Primeira execução
  - Objetivo: configurar o login do GitHub uma vez e clonar o repositório.
  - Orientação:
    - Criar `lib/primeira-execucao.mjs` (`validarToken` via `GET /repos/NatanBudny/EscalaMusica` e `GET /user`, `clonar`, `configurarIdentidade`), `preload.cjs`, `configuracao.html` e `askpass.cmd`.
    - Guardar o token com `safeStorage` em `userData/credencial.bin`; clonar em `userData/repo`; `user.name`/`user.email` locais (`<id>+<login>@users.noreply.github.com`); atalho com `shell.writeShortcutLink`; mensagens e "tentar de novo" em falhas.
  - [ ]* 41.1 Testes unitários e roteiro manual
    - `validarToken` com `fetch` falso (válido, inválido, sem push); `clonar` a partir de remoto bare local.
    - Roteiro em Windows: token sem permissão de escrita é recusado; token válido clona e cria o atalho.
  - _Requisitos: 31.1, 31.2, 31.3, 31.4, 31.5, 31.6, 31.7, 31.8_
  - Demo: na primeira abertura, colar o token leva à janela do editor já com o repositório clonado e atalho na área de trabalho.

- [ ] Task 42: Instalador com MinGit e workflow com smoke test
  - Objetivo: gerar o instalador Windows no GitHub Actions, testado antes de publicar.
  - Orientação:
    - `editor-windows/mingit.json` (versão, URL oficial, SHA-256) e `scripts/baixar-mingit.mjs` (baixa, confere o hash, extrai em `vendor/mingit`).
    - `electron-builder.yml` (NSIS x64, `extraResources` com MinGit e `askpass.cmd`); modo `--smoke` em `main.mjs`.
    - `.github/workflows/editor-windows.yml` em `windows-latest` conforme o design; release em tags `editor-v*` com a nota do SmartScreen.
    - `editor-windows/README.md`: instalação, criação do token e alerta do SmartScreen ("Mais informações" > "Executar assim mesmo").
  - [ ]* 42.1 Testes unitários e smoke no CI
    - `baixar-mingit.mjs` recusa arquivo com hash diferente; o workflow falha se o smoke falhar; `package.json` da raiz continua sem `dependencies`.
  - _Requisitos: 30.9, 32.1, 32.2, 32.3, 32.4, 32.5_
  - Demo: rodar o workflow manualmente gera o artefato do instalador após o smoke test passar.

- [~] Task 43: Checkpoint final
  - Garantir que todos os testes passam; perguntar ao usuário em caso de dúvida.

## Notas

- Sub-tarefas marcadas com `*` são testes ou roteiros e podem ser puladas num MVP; as demais são obrigatórias.
- Propriedades usam fast-check com no mínimo 100 iterações e o comentário `// Feature: melhoras-domingao, Property N: <título>`.
- A Task 12 grava os arquivos esperados da regressão a partir do estado do repositório no início do projeto (antes da Task 7), não só antes de mudar o solver, porque as Tasks 7 e 8 já alteram `cadastro.js` e `contatos.json`.
- A Task 24 cria `tests/fixtures/agosto-2026/`, reutilizada nas Tasks 27, 30 e 34.
- A migração de grupos (Task 8) é aplicada antes da de contatos (Task 4); a tela de migrações já mostra nessa ordem.
- Testes de git usam `tests/helpers/repo-temporario.js` (remoto bare local), sem rede.
