# Documento de Requisitos: Melhoras Domingão

## Introdução

O **editor de escala** (o "montador": `montador/server.mjs`, Node puro sem dependências de runtime, UI em `montador/public/`, libs em `montador/lib/` que reusam `scripts/lib/*`) passa a cobrir, sem terminal, todo o processo oficial de `processos/guias/iniciar-escala-mensal.md`: iniciar o mês, digitar acionato e sonoplastia, importar a indisponibilidade, montar, revalidar, fazer o fechamento completo (equivalente a `scripts/publicacao/publicar-fechamento.js`), conferir o site, enviar as mensagens de WhatsApp e ajustar a escala publicada. Cadastro de pessoas e regras ganham telas próprias, e as regras aplicadas pelo código passam a ter parâmetros versionados. O cadastro passa a ter grupos escaláveis (família, ministério) e a habilitação de sonoplastia; as mensagens de WhatsApp ficam editáveis; e o editor confere, com o código da própria escala online, que cada nome publicado abre o WhatsApp da pessoa certa.

O repositório é único e público, e o git é a fonte da verdade. `.github/workflows/static.yml` publica a pasta inteira a cada push na `main`. O editor ganha instalador Windows (casca Electron + MinGit) que roda o montador de dentro de um clone do repositório.

Fora de escopo: `desktop-app/` (Tauri, continua separado), alterações em `montador/lib/participacao.mjs`, correções por desistência após a publicação, certificado de assinatura do instalador, instaladores para macOS/Linux e a tela `html-revisao/` (só as regras por nome dela são migradas).

## Glossário

- **Editor_de_Escala**: o montador como um todo (servidor + interface). Em desenvolvimento roda com `npm run montar`.
- **Servidor_Local**: `montador/server.mjs`, que serve `montador/public/` e a API JSON.
- **Escala_Online**: `index.html` no GitHub Pages (`https://natanbudny.github.io/EscalaMusica/`), que lê `atual.json`.
- **Repositorio**: repositório git público `NatanBudny/EscalaMusica`, branch `main`.
- **Modulo_Git**: `montador/lib/git.mjs`, única porta de entrada do editor para o git.
- **Commit_Seletivo**: commit feito com `git commit -m <mensagem> -- <arquivos>`, contendo só os arquivos da operação.
- **Envio_Pendente**: commit local ainda não enviado ao remoto (`git rev-list --count @{u}..HEAD` > 0).
- **Cadastro**: `pessoas.json`.
- **Validador_de_Cadastro**: `carregarPessoas` em `scripts/lib/cadastro.js`.
- **Contatos_Derivados**: `contatos.json`, gerado de `pessoas.json` com as pessoas que têm telefone e uma entrada por Grupo_Escalavel cujo responsável tem telefone.
- **Vinculo**: relação entre pessoas no Cadastro: `sempre_junto` (casal, simétrico), `familia_requerida` (grupo de `pessoas.json.grupos`) e `precisa_de` (unidirecional, só aviso).
- **Grupo_Escalavel**: grupo de `pessoas.json.grupos` com `escalavel: true`, escalado como uma unidade: `nome_exibicao` (nome publicado), `responsavel_id`, `membros_ids`, `modo` (`funcao`: ocupa uma vaga das `funcoes` permitidas, padrão `["mm"]`; `culto_inteiro`: assume regente, equipe e MM do culto) e `mensagem` opcional.
- **Caracteres_de_Nome**: letras (com acento), espaço, ponto, apóstrofo e hífen. Vírgula e demais caracteres ficam de fora.
- **Conferencia_de_Links**: checagem que aplica `buscarContato` de `src/utils/contact.js` e a divisão por vírgula de `formatarLista` (`src/utils/formatter.js`) a um `atual.json` e um `contatos.json`, para saber que número o link de cada nome publicado abre na Escala_Online.
- **Mensagens_WhatsApp**: `processos/regras/mensagens-whatsapp.json`, com os templates `pessoa`, `grupo`, `culto_inteiro` e `fixo`, os contatos fixos e o link do grupo do louvor.
- **Catalogo_de_Regras**: regras em `processos/regras/` (`fundamentais.json`, `preferencias.json`, `restricoes-pessoais.json`, `papeis.json`, `glossario.json`).
- **Historico_de_Versoes**: `processos/regras/historico-versoes.json`, registro somente de acréscimos das versões de texto, de parâmetros e das Mensagens_WhatsApp.
- **Parametros**: `processos/regras/parametros.json`, com ativa/inativa, nível e valores das regras aplicadas pelo código.
- **Nivel**: `bloqueio` (gera erro e impede a escolha/envio) ou `aviso` (permite, com alerta).
- **Solver**: `scripts/lib/solver-filtros.js`, `solver-score.js`, `solver-selecao.js` e `solver-historico.js`.
- **Culto**: item do mês com data; tem tipo `louvor`, `quarta`, `departamental` ou `sem_louvor`.
- **Modelo_de_Louvor**: funções de um culto: `sabado` (regente, equipe de 5, MM ES e MM culto), `domingo` (regente, equipe de 5, 1 MM) ou `sem_louvor`.
- **Dia_Extraordinario**: culto incluído no acionato com data qualquer do mês e Modelo_de_Louvor escolhido na hora.
- **Acionato**: `escalas/AAAA/MM/insumos/acionato.json` (ancião, pregador, observações públicas por culto).
- **Insumo_Sonoplastia**: `escalas/AAAA/MM/insumos/sonoplastia.json`, com sonoplasta e suporte por culto.
- **Enquete**: `escalas/AAAA/MM/insumos/indisponibilidade-cantores.json`, exportado da enquete "dias em que NÃO pode cantar".
- **Indisponibilidade_Vinculada**: `escalas/AAAA/MM/insumos/indisponibilidade-cantores-vinculada.json` (por ID).
- **Rascunho**: estado da montagem de um mês salvo no `localStorage` do navegador, com pessoas e Grupos_Escalaveis por ID, Banda/PB e OBS de cada culto.
- **Publicacao**: `atual.json` no schema do viewer.
- **Fechamento**: sequência de publicação, validações, controles, registro, limpeza, commit e push.
- **Controles_de_Rotacao**: `controle-mensagem-musical.json`, `controle-regentes.json` e `controle-equipe-louvor.json` (RF022).
- **Departamento**: nome de departamento reconhecido por `ehDepartamental` (RF015) que assume o louvor do culto. É o único participante isento da trava de telefone.
- **Casca**: aplicativo Electron em `editor-windows/` que roda o Servidor_Local e mostra a interface numa janela.
- **Clone_Local**: clone do Repositorio na pasta de dados do app (`app.getPath('userData')/repo`).
- **MinGit**: Git portátil oficial do Git for Windows embutido no instalador.
- **Instalador**: instalador NSIS para Windows gerado pelo Workflow_de_Build.
- **Workflow_de_Build**: `.github/workflows/editor-windows.yml`.

## Requisitos

### Requisito 1: Segurança do servidor local e privacidade

**User Story:** Como diretor da música, quero que o editor só aceite pedidos do meu próprio computador e não publique arquivos temporários, para que sites abertos no navegador não leiam nem alterem o cadastro.

#### Critérios de Aceitação

1. THE Servidor_Local SHALL escutar somente no endereço 127.0.0.1.
2. IF uma requisição POST, PUT ou DELETE chega sem cabeçalho Origin igual a `http://127.0.0.1:<porta>` ou `http://localhost:<porta>`, THEN THE Servidor_Local SHALL responder 403 sem executar a operação.
3. IF uma requisição chega com cabeçalho Host diferente de `127.0.0.1:<porta>` e de `localhost:<porta>`, THEN THE Servidor_Local SHALL responder 403.
4. IF uma requisição com corpo chega com content-type diferente de `application/json`, THEN THE Servidor_Local SHALL responder 415 sem interpretar o corpo.
5. IF o corpo de uma requisição excede 5 MB, THEN THE Servidor_Local SHALL responder 413.
6. THE Repositorio SHALL ignorar no `.gitignore` os caminhos `montador/backups-pessoas/` e `.pessoas.tmp.json`.
7. WHEN o formulário de pessoa é exibido, THE Editor_de_Escala SHALL mostrar junto ao campo de notas o aviso "visível publicamente".
8. WHEN o Servidor_Local inicia sem a variável `MONTADOR_SEM_NAVEGADOR=1`, THE Servidor_Local SHALL abrir o navegador em `http://127.0.0.1:<porta>/`.

### Requisito 2: Sincronização com o git

**User Story:** Como diretor da música, quero que cada alteração vá para o GitHub sem levar arquivos que eu não mexi, para que o repositório continue sendo a fonte da verdade.

#### Critérios de Aceitação

1. WHEN o Editor_de_Escala grava uma operação, THE Modulo_Git SHALL criar um Commit_Seletivo contendo somente os arquivos gravados ou removidos por aquela operação, inclusive na publicação feita por `montador/lib/publicar.mjs`.
2. WHEN um arquivo da operação ainda não é rastreado, THE Modulo_Git SHALL executar `git add -- <arquivo>` antes do Commit_Seletivo.
3. THE Modulo_Git SHALL executar o git por `execFile` com lista de argumentos, sem shell.
4. WHEN o Servidor_Local inicia, THE Modulo_Git SHALL executar `git pull --rebase --autostash`.
5. WHEN o Editor_de_Escala vai enviar commits, THE Modulo_Git SHALL executar `git pull --rebase --autostash` antes de `git push`.
6. THE Modulo_Git SHALL enviar com `git push` sem opção de force.
7. IF o rebase gera conflito somente em `atual.json`, THEN THE Modulo_Git SHALL manter a versão local recém-publicada (RF021) e concluir o rebase.
8. IF o rebase gera conflito em qualquer outro arquivo, THEN THE Modulo_Git SHALL abortar o rebase, preservar os commits locais e devolver mensagem com a lista de arquivos em conflito.
9. IF o push falha, THEN THE Modulo_Git SHALL manter o commit local como Envio_Pendente e devolver a mensagem do erro.
10. WHILE existe Envio_Pendente, THE Editor_de_Escala SHALL exibir na tela de cadastro o indicador "não sincronizado" com a quantidade de commits e o botão "tentar de novo".
11. WHEN o usuário aciona "tentar de novo", THE Modulo_Git SHALL repetir `git pull --rebase --autostash` e `git push`.
12. IF nenhum arquivo da operação mudou em relação ao HEAD, THEN THE Modulo_Git SHALL deixar de criar commit e informar "sem alterações".
13. WHERE o Servidor_Local é executado pela Casca, IF o pull da inicialização altera arquivos em `montador/` ou `scripts/`, THEN THE Servidor_Local SHALL encerrar com código 75.
14. IF o pull da inicialização em desenvolvimento altera arquivos em `montador/` ou `scripts/`, THEN THE Servidor_Local SHALL registrar no console que é preciso reiniciar.

### Requisito 3: Cadastro comita na hora e migração do contatos.json

**User Story:** Como diretor da música, quero que cada salvamento no cadastro seja publicado na hora e que nenhum contato manual se perca, para que a escala online e o WhatsApp usem dados atuais.

#### Critérios de Aceitação

1. WHEN o usuário salva, desativa ou exclui uma pessoa, THE Editor_de_Escala SHALL gravar `pessoas.json` aprovado pelo Validador_de_Cadastro, regenerar `contatos.json`, criar Commit_Seletivo dos dois arquivos e enviá-lo.
2. THE Editor_de_Escala SHALL gerar Contatos_Derivados pela mesma função usada por `scripts/manutencao/gerar-contatos.js`, com as pessoas que têm telefone e uma entrada por Grupo_Escalavel cujo responsável tem telefone (chave = `nome_exibicao`, telefone do responsável, apelidos vazios), no formato `{ NOME: { telefone: "https://wa.me/<dígitos>", apelidos: [...] } }` com chaves em ordem alfabética.
3. IF o `pessoas.json` resultante é rejeitado pelo Validador_de_Cadastro, THEN THE Editor_de_Escala SHALL recusar a operação sem gravar arquivos e sem commit.
4. WHEN a operação termina, THE Editor_de_Escala SHALL devolver na resposta o resultado do commit e do push.
5. WHILE a migração única do `contatos.json` não está registrada como concluída em `pessoas.json`, THE Editor_de_Escala SHALL exibir, antes da lista do cadastro, as diferenças entre o `contatos.json` atual e o gerado a partir de `pessoas.json`.
6. WHEN o usuário aplica a migração, THE Editor_de_Escala SHALL incorporar cada entrada que só existe no `contatos.json` conforme a decisão registrada para ela ou, sem pessoa de mesmo telefone, como pessoa inativa sem habilitações com o telefone e os apelidos da entrada, registrar a migração como concluída e criar Commit_Seletivo de `pessoas.json` e `contatos.json`.
7. THE Editor_de_Escala SHALL garantir que o `contatos.json` regenerado após a migração contenha o telefone e os apelidos de toda entrada do `contatos.json` original, exceto os apelidos que o usuário renomeou ou removeu pelo critério 9.
8. WHEN uma entrada que só existe no `contatos.json` tem o telefone de uma ou mais pessoas do Cadastro, THE Editor_de_Escala SHALL deixá-la como decisão pendente, listando essas pessoas, com as opções "apelido de <pessoa>" e "pessoa nova inativa com o mesmo telefone".
9. IF um nome ou apelido do `contatos.json` ou do Cadastro tem caractere fora dos Caracteres_de_Nome, THEN THE Editor_de_Escala SHALL listá-lo como decisão pendente, com as opções renomear ou remover.
10. WHILE há decisão pendente na migração do `contatos.json`, THE Editor_de_Escala SHALL manter desabilitada a aplicação dessa migração.

### Requisito 4: Validações do cadastro

**User Story:** Como diretor da música, quero que o cadastro impeça telefone errado e nomes repetidos, para que as mensagens cheguem à pessoa certa.

#### Critérios de Aceitação

1. IF o telefone, após remover caracteres que não são dígitos, não corresponde a 55 + DDD de 2 dígitos (1 a 9 cada) + número de 8 ou 9 dígitos, THEN THE Editor_de_Escala SHALL recusar o salvamento com mensagem que mostra o formato esperado.
2. WHEN o telefone está vazio, THE Editor_de_Escala SHALL salvar sem exigir formato nem confirmação.
3. IF o nome ou um apelido é igual ao nome ou a um apelido de outra pessoa, ou ao `nome_exibicao` de um Grupo_Escalavel, THEN THE Editor_de_Escala SHALL recusar o salvamento indicando a pessoa ou o grupo em conflito.
4. WHEN o nome ou um apelido coincide com nome ou apelido de outra pessoa somente após normalização (acentos, caixa, espaços), THE Editor_de_Escala SHALL exibir aviso de possível duplicidade e salvar somente após confirmação do usuário.
5. WHEN o usuário salva com telefone novo ou alterado, THE Editor_de_Escala SHALL abrir `https://wa.me/<numero>` e perguntar "Abriu o WhatsApp da pessoa certa?".
6. WHEN o usuário responde "não", THE Editor_de_Escala SHALL voltar ao formulário sem salvar.
7. WHEN o usuário responde "sim", THE Editor_de_Escala SHALL salvar a pessoa.
8. IF a API recebe telefone novo ou alterado sem a confirmação, THEN THE Servidor_Local SHALL recusar o salvamento.
9. IF o nome ou um apelido tem caractere fora dos Caracteres_de_Nome, THEN THE Editor_de_Escala SHALL recusar o salvamento indicando o caractere.
10. WHEN o telefone é igual ao de outra pessoa, THE Editor_de_Escala SHALL exibir aviso com as pessoas que usam o mesmo número e permitir o salvamento.

### Requisito 5: Vínculos entre pessoas

**User Story:** Como diretor da música, quero editar casais, famílias e dependências na tela, para que as regras que hoje estão fixas por nome venham do cadastro.

#### Critérios de Aceitação

1. THE Editor_de_Escala SHALL permitir criar e remover, no formulário de pessoa, Vinculos `sempre_junto`, `familia_requerida` e `precisa_de`.
2. WHEN um Vinculo `sempre_junto` é criado ou removido, THE Editor_de_Escala SHALL aplicar a mesma alteração nas duas pessoas.
3. WHEN um Vinculo `familia_requerida` é salvo, THE Editor_de_Escala SHALL referenciar um grupo existente em `pessoas.json.grupos` ou criar o grupo com os membros escolhidos.
4. THE Editor_de_Escala SHALL gravar `precisa_de` como `{ "tipo": "precisa_de", "com_ids": [...] }` somente na pessoa que precisa, significando "precisa de pelo menos uma destas pessoas escaladas no mesmo culto".
5. IF um Vinculo `precisa_de` tem `com_ids` vazio, referencia ID inexistente ou a própria pessoa, THEN THE Validador_de_Cadastro SHALL rejeitar o cadastro com mensagem que identifica a pessoa.
6. THE Editor_de_Escala SHALL tratar `precisa_de` não atendido como aviso, sem bloquear escolha, sugestão automática ou envio.
7. WHEN a migração das regras por nome de `html-revisao/index.html` é executada, THE Editor_de_Escala SHALL gravar `dias_permitidos: ["sabado"]` em CATHERINE e ARIADNY, `precisa_de` SILVANA em MANU C., `precisa_de` JESSICA ou JOAS em MANU S. e `precisa_de` NILSINHO (apelido NILSON) em MIRELLA e MARCELA, e criar Commit_Seletivo de `pessoas.json` e `contatos.json`.

### Requisito 6: Grupos escaláveis

**User Story:** Como diretor da música, quero escalar uma família ou um ministério como uma unidade, para que a escala online mostre o nome do grupo com o link do responsável e a mensagem chegue a quem responde pelo grupo.

#### Critérios de Aceitação

1. THE Validador_de_Cadastro SHALL aceitar em cada grupo de `pessoas.json.grupos` os campos opcionais `escalavel`, `nome_exibicao`, `responsavel_id`, `modo` (`funcao` ou `culto_inteiro`), `funcoes` (padrão `["mm"]`) e `mensagem`.
2. IF um Grupo_Escalavel tem responsável ou membro inexistente, `membros_ids` vazio, `nome_exibicao` fora dos Caracteres_de_Nome ou `nome_exibicao` que coincide, após normalização, com nome ou apelido de pessoa ou com o `nome_exibicao` de outro grupo, THEN THE Validador_de_Cadastro SHALL rejeitar o cadastro com mensagem que identifica o grupo.
3. THE Editor_de_Escala SHALL oferecer no cadastro a tela "Grupos" para criar, editar e remover grupos com membros, responsável, modo, funções e mensagem, gravando e comitando como no critério 3.1.
4. WHILE a migração única de grupos não está registrada em `pessoas.json`, THE Editor_de_Escala SHALL exibir na tela de migrações a proposta de FAMILIA NILSINHO (membros NILSINHO, JULIANA ALVES, MIRELLA e MARCELA; responsável NILSINHO; modo `funcao`; funções `["mm"]`) e de MIN. JOVEM (responsável FABRICIO; modo `culto_inteiro`), com a lista de membros editável.
5. WHEN o usuário confirma a migração de grupos, THE Editor_de_Escala SHALL gravar os grupos com os membros confirmados, registrar a migração como concluída e criar Commit_Seletivo de `pessoas.json` e `contatos.json`.
6. WHEN a migração do `contatos.json` encontra entrada cuja chave é o `nome_exibicao` de um Grupo_Escalavel, THE Editor_de_Escala SHALL tratá-la como coberta pelo grupo, sem criar pessoa nem apelido.
7. WHILE a migração de grupos não foi aplicada, THE Editor_de_Escala SHALL manter desabilitada a aplicação da migração do `contatos.json`.
8. WHEN o usuário clica numa função de um culto, THE Editor_de_Escala SHALL incluir nos candidatos, identificados como grupo, os Grupos_Escalaveis cujas `funcoes` contêm essa função.
9. IF nenhum membro do Grupo_Escalavel está disponível na data, THEN THE Editor_de_Escala SHALL classificar o grupo pela regra de indisponibilidade (RF026) com o Nivel de Parametros.
10. WHEN algum membro do Grupo_Escalavel está indisponível na data e outro está disponível, THE Editor_de_Escala SHALL classificar o grupo como elegível com aviso que lista os membros indisponíveis.
11. WHEN um membro do Grupo_Escalavel ocupa outra função do mesmo culto, THE Editor_de_Escala SHALL exibir aviso com o nome do membro e a função.
12. THE Editor_de_Escala SHALL contar o Grupo_Escalavel como uma vaga da função e como uma participação do grupo no máximo de MM por mês (RF014).
13. WHERE o Grupo_Escalavel tem modo `culto_inteiro`, WHEN o usuário aciona "Grupo assume o culto" no card, THE Editor_de_Escala SHALL preencher regente, equipe e MM do culto com o grupo e contar o culto como completo no progresso.
14. THE Solver SHALL deixar os Grupos_Escalaveis fora da sugestão automática.
15. WHEN a escala é publicada, THE Editor_de_Escala SHALL gravar o `nome_exibicao` do grupo em cada campo que ele ocupa.
16. THE Editor_de_Escala SHALL considerar atendida a trava de telefone de um Grupo_Escalavel quando o responsável tem telefone.
17. THE Editor_de_Escala SHALL contar o Grupo_Escalavel nos Controles_de_Rotacao pelo `nome_exibicao`.
18. WHEN um Grupo_Escalavel está escalado no mês, THE Editor_de_Escala SHALL gerar uma única mensagem de WhatsApp para ele, enviada ao responsável (critério 25.10).

### Requisito 7: Lista e filtros do cadastro

**User Story:** Como diretor da música, quero achar pessoas rápido e ver quando serviram pela última vez, para que eu mantenha o cadastro sem planilha.

#### Critérios de Aceitação

1. THE Editor_de_Escala SHALL manter sempre visível a busca por nome e apelido.
2. THE Editor_de_Escala SHALL manter os filtros avançados ocultos atrás do botão "Filtros".
3. WHEN o usuário aciona "Filtros", THE Editor_de_Escala SHALL exibir filtros de função (regente, equipe, MM, sonoplastia), situação (ativo, inativo), afastado, dias permitidos e perfil de canto.
4. WHEN há busca ou filtros ativos, THE Editor_de_Escala SHALL listar somente as pessoas que atendem à busca e a todos os filtros ativos.
5. THE Editor_de_Escala SHALL exibir o contador de pessoas da lista filtrada.
6. THE Editor_de_Escala SHALL exibir em cada linha a data mais recente em que a pessoa aparece em REGENTE LOUVOR, EQUIPE LOUVOR ou MENSAGEM MUSICAL de `old/AAAA/*.json` ou `atual.json`, ou "nunca".

### Requisito 8: Desativar e excluir pessoa

**User Story:** Como diretor da música, quero escolher claramente entre desativar e excluir, para que eu não apague histórico sem querer.

#### Critérios de Aceitação

1. THE Editor_de_Escala SHALL oferecer no formulário de pessoa os botões "Desativar" e "Excluir definitivamente".
2. WHEN o usuário confirma "Desativar", THE Editor_de_Escala SHALL gravar `ativo: false`, zerar as habilitações e manter a pessoa no Cadastro.
3. IF a pessoa participa de algum Vinculo, é membro ou responsável de grupo ou aparece em `old/AAAA/*.json` ou `atual.json`, THEN THE Editor_de_Escala SHALL bloquear "Excluir definitivamente" e informar o motivo.
4. WHEN o usuário confirma "Excluir definitivamente" de pessoa sem Vinculo, sem grupo e sem histórico, THE Editor_de_Escala SHALL remover a pessoa de `pessoas.json`.

### Requisito 9: Catálogo de regras e versões de texto

**User Story:** Como diretor da música, quero ver e editar o texto de todas as regras com histórico, para que eu saiba o que vale hoje e possa voltar atrás.

#### Critérios de Aceitação

1. WHEN o usuário abre "Regras" no menu, THE Editor_de_Escala SHALL listar todas as entradas do Catalogo_de_Regras com identificador, categoria, arquivo de origem e texto.
2. WHEN o usuário salva um texto de regra alterado, THE Editor_de_Escala SHALL acrescentar uma versão ao Historico_de_Versoes, atualizar o texto no arquivo de origem e criar Commit_Seletivo dos dois arquivos.
3. WHEN uma regra é editada pela primeira vez, THE Editor_de_Escala SHALL registrar o texto original como versão 1 antes da nova versão.
4. THE Editor_de_Escala SHALL alterar o Historico_de_Versoes somente por acréscimo, sem modificar nem remover versões existentes.
5. WHEN o usuário reverte uma regra para uma versão anterior, THE Editor_de_Escala SHALL criar uma nova versão com o texto da versão escolhida e a referência a ela.
6. WHEN o usuário abre o histórico de uma regra, THE Editor_de_Escala SHALL exibir as versões com número, data, autor e texto.
7. THE Editor_de_Escala SHALL exibir junto a cada regra os Parametros que a referenciam.

### Requisito 10: Parâmetros executáveis das regras

**User Story:** Como diretor da música, quero ligar, desligar e ajustar as regras aplicadas pelo código, para que a sugestão e a validação sigam o que a igreja decidiu sem mexer em JavaScript.

#### Critérios de Aceitação

1. THE Editor_de_Escala SHALL ler de Parametros, para cada regra, `ativa`, `nivel` e `valores`.
2. THE Parametros SHALL conter: tamanho da equipe (5), mínimo de homens RF001 (1), MM no sábado RF012 (2), máximo de MM por pessoa no mês RF014 (1), indisponibilidade RF026, sonoplastia no culto RF002, regência no culto, pregador no louvor RF004, equipe e MM no mesmo culto, consecutivos PE006, funções vazias, janela de histórico (4 meses) e pesos do score.
3. THE Solver, `candidatosParaCelula` e `validarEscala` SHALL obter regras e valores de Parametros.
4. WHEN `scripts/ciclo/sugerir-rascunho.js` é executado, THE Solver SHALL usar os mesmos Parametros.
5. WHILE Parametros tem os valores padrão, THE Solver SHALL produzir para julho/2026 sugestão idêntica à produzida antes da refatoração.
6. WHEN o usuário altera um parâmetro na tela de regras, THE Editor_de_Escala SHALL validar o arquivo, acrescentar versão ao Historico_de_Versoes e criar Commit_Seletivo de `parametros.json` e do histórico.
7. IF `parametros.json` está ausente ou inválido, THEN THE Editor_de_Escala SHALL usar os valores padrão e exibir aviso com o problema.
8. WHERE uma regra está inativa, THE Editor_de_Escala SHALL deixar de aplicá-la em candidatos, validação e sugestão automática.
9. THE Editor_de_Escala SHALL manter as restrições pessoais (dias permitidos, afastamento, Vinculos) no Cadastro, fora de Parametros.

### Requisito 11: Iniciar ou retomar o mês

**User Story:** Como diretor da música, quero abrir um mês novo pelo editor, para que eu não precise rodar `npm run iniciar:mes`.

#### Critérios de Aceitação

1. WHEN o usuário abre um mês sem `escalas/AAAA/MM/insumos/acionato.json`, THE Editor_de_Escala SHALL criar `escalas/AAAA/MM/insumos/` e `escalas/AAAA/MM/arquivo/`, gerar o Acionato com o calendário base e criar Commit_Seletivo do Acionato.
2. THE Editor_de_Escala SHALL gerar o calendário base com todas as quartas, sábados e domingos do mês.
3. WHEN o usuário abre um mês já iniciado, THE Editor_de_Escala SHALL retomar os insumos existentes sem sobrescrevê-los.
4. WHEN um mês é aberto, THE Editor_de_Escala SHALL mostrar Acionato, Insumo_Sonoplastia e Enquete como preenchido ou pendente.

### Requisito 12: Acionato e dia extraordinário

**User Story:** Como diretor da música, quero digitar a escala do ancião e incluir dias especiais, para que cada card da montagem mostre quem dirige e quem prega.

#### Critérios de Aceitação

1. THE Editor_de_Escala SHALL oferecer a tela de acionato com, por culto, data, dia, ancião, pregador e observações públicas digitados à mão, com o placeholder "Este texto será publicado na escala online" no campo de observações.
2. WHEN o usuário salva o acionato, THE Editor_de_Escala SHALL gravar o Acionato no formato de `processos/templates/insumo-acionato.json` acrescido de `modelo_louvor` e `extraordinario` em cada item, e criar Commit_Seletivo do arquivo.
3. WHEN o usuário inclui um Dia_Extraordinario, THE Editor_de_Escala SHALL aceitar qualquer data do mês e exigir o Modelo_de_Louvor: como sábado, como domingo ou sem louvor.
4. IF a data do Dia_Extraordinario já existe no Acionato, THEN THE Editor_de_Escala SHALL recusar a inclusão.
5. IF a data do Dia_Extraordinario está fora do mês aberto, THEN THE Editor_de_Escala SHALL recusar a inclusão.
6. WHEN o usuário remove um Dia_Extraordinario, THE Editor_de_Escala SHALL retirá-lo do Acionato e da montagem.
7. THE Editor_de_Escala SHALL exibir no card de cada culto da montagem o ancião e o pregador do Acionato.
8. THE Editor_de_Escala SHALL publicar no campo OBS do culto a Observação do card, pré-preenchida com as observações públicas do Acionato (RF016).

### Requisito 13: Sonoplastia

**User Story:** Como diretor da música, quero escolher sonoplasta e suporte de cada culto a partir do cadastro, para que o editor evite escalar no louvor quem está na mesa de som e a escala online mostre o link de cada um.

#### Critérios de Aceitação

1. THE Editor_de_Escala SHALL oferecer a tela de sonoplastia com, por culto (inclusive quartas), os campos "Sonoplasta", "Suporte" (opcional) e observações.
2. WHEN o usuário salva a sonoplastia, THE Editor_de_Escala SHALL gravar o Insumo_Sonoplastia no formato de `processos/templates/insumo-sonoplastia.json` com `sonoplastia: [sonoplasta, suporte]` e o ID de cada nome vindo do Cadastro, e criar Commit_Seletivo do arquivo.
3. THE Editor_de_Escala SHALL exibir no card de cada culto o sonoplasta e o suporte.
4. THE Editor_de_Escala SHALL publicar AUDIOVISUAL com o sonoplasta e SUPORTE com o suporte ou "-", um nome por campo.
5. THE Editor_de_Escala SHALL oferecer no formulário de pessoa a habilitação `sonoplastia`.
6. THE Editor_de_Escala SHALL oferecer em "Sonoplasta" e "Suporte" as pessoas ativas com habilitação `sonoplastia` e um texto livre nos Caracteres_de_Nome, marcado "fora do cadastro" e publicado sem link.
7. WHEN o usuário aciona "cadastrar pessoa" na tela de sonoplastia, THE Editor_de_Escala SHALL abrir o formulário de pessoa com a habilitação `sonoplastia` marcada e, após o salvamento, oferecer a pessoa nos campos da tela de sonoplastia.
8. THE Editor_de_Escala SHALL detectar o conflito com o louvor (RF002) pelo ID quando o sonoplasta ou o suporte vem do Cadastro e, em Insumo_Sonoplastia sem ID, pelo nome ou apelido.

### Requisito 14: Importação da indisponibilidade

**User Story:** Como diretor da música, quero anexar o arquivo da enquete e associar cada votante a uma pessoa, para que ninguém seja escalado num dia em que disse que não pode.

#### Critérios de Aceitação

1. WHILE o mês aberto não tem Enquete importada, THE Editor_de_Escala SHALL pedir o anexo do arquivo `indisponibilidade-cantores.json` exportado.
2. IF o arquivo anexado não segue o formato `{ contexto, origem, atualizado_em, datas: [...] }` com `data_referencia` em AAAA-MM-DD ou `geral`, THEN THE Editor_de_Escala SHALL recusar o arquivo indicando o problema.
3. IF uma `data_referencia` está fora do mês aberto, THEN THE Editor_de_Escala SHALL ignorar a data e listá-la no relatório.
4. WHEN os dígitos da entrada de um votante correspondem ao telefone de exatamente uma pessoa, no formato 55 + DDD + número e aceitando a ausência do nono dígito, THE Editor_de_Escala SHALL associar a entrada a essa pessoa.
5. WHEN a entrada não foi associada por telefone e coincide, após normalização por `scripts/lib/normalizar.js`, com nome ou apelido de exatamente uma pessoa, THE Editor_de_Escala SHALL associá-la a essa pessoa.
6. WHEN a entrada coincide com nome ou apelido de mais de uma pessoa, THE Editor_de_Escala SHALL deixá-la pendente com as pessoas possíveis.
7. WHEN a entrada não foi associada pelos critérios anteriores, THE Editor_de_Escala SHALL sugerir as pessoas mais parecidas por `scripts/lib/fuzzy-match.js` e deixá-la pendente até o usuário confirmar, escolher outra pessoa ou ignorar.
8. WHEN o usuário confirma uma associação que não foi por telefone e o texto da entrada está nos Caracteres_de_Nome, THE Editor_de_Escala SHALL salvar o nome da enquete como apelido da pessoa e criar Commit_Seletivo de `pessoas.json` e `contatos.json`.
9. THE Editor_de_Escala SHALL tratar a entrada `geral` (`indisponiveis_tempo_indeterminado`) como indisponibilidade no mês inteiro.
10. WHEN uma pessoa associada tem Vinculo `sempre_junto`, THE Editor_de_Escala SHALL propagar a indisponibilidade ao parceiro.
11. WHEN a importação é gravada, THE Editor_de_Escala SHALL gravar a Enquete, a Indisponibilidade_Vinculada no formato de `scripts/ciclo/vincular-indisponibilidade.js` e o snapshot `escalas/AAAA/MM/arquivo/indisponibilidade-cantores-AAAA-MM-DD.json`, e criar Commit_Seletivo dos três.
12. THE Editor_de_Escala SHALL exibir o relatório da importação com associados, pendentes e ignorados.
13. IF os dígitos da entrada correspondem ao telefone de mais de uma pessoa, THEN THE Editor_de_Escala SHALL deixar a entrada pendente com essas pessoas como opções.
14. IF o texto de uma entrada confirmada pelo usuário tem caractere fora dos Caracteres_de_Nome, THEN THE Editor_de_Escala SHALL aplicar a decisão somente na importação atual, sem gravar apelido.

### Requisito 15: Grade de montagem e filtro por dia

**User Story:** Como diretor da música, quero ver o mês numa grade com tudo que importa em cada card, para que eu monte sem abrir outros arquivos.

#### Critérios de Aceitação

1. THE Editor_de_Escala SHALL exibir os cultos em grade de 4 por linha, reduzindo para 3 ou 2 colunas quando a largura ao lado do painel de participação não comporta 4.
2. THE Editor_de_Escala SHALL destacar visualmente os cards de sábado.
3. THE Editor_de_Escala SHALL exibir em cada card o acionato, a sonoplastia e um seletor Banda/PB editável, com padrão BANDA no Modelo_de_Louvor sábado e PB nos demais.
4. WHEN o usuário filtra por dia da semana, por data ou por Dia_Extraordinario, THE Editor_de_Escala SHALL exibir somente os cards correspondentes.
5. WHILE um filtro está ativo, THE Editor_de_Escala SHALL preservar as atribuições dos cards ocultos e considerá-las em validação, Rascunho, progresso e envio.
6. WHEN o usuário remove o filtro, THE Editor_de_Escala SHALL exibir todos os cards com as atribuições intactas.
7. THE Editor_de_Escala SHALL manter o painel de participação de `montador/lib/participacao.mjs` sem alterar esse arquivo.
8. THE Editor_de_Escala SHALL exibir em cada card o campo editável "Observação", pré-preenchido com as observações públicas do Acionato e com o placeholder "Este texto será publicado na escala online".
9. WHEN o usuário edita a Observação de um card, THE Editor_de_Escala SHALL validar o texto na hora contra os termos proibidos de `scripts/validacao/validar-obs-publico.js` e os caracteres "<" e ">", e exibir no card cada problema encontrado.

### Requisito 16: Candidatos, substitutos e classificação

**User Story:** Como diretor da música, quero ver quem pode, quem pode com ressalva e quem não pode, com o motivo, para que eu decida rápido e com segurança.

#### Critérios de Aceitação

1. WHEN o usuário clica numa função de um culto, THE Editor_de_Escala SHALL listar os elegíveis em ordem de score, em seguida os elegíveis com aviso com o texto do aviso e, recolhidos, os não elegíveis com o motivo.
2. WHEN o usuário clica num nome já definido, THE Editor_de_Escala SHALL listar os substitutos para aquela função pelas mesmas regras, desconsiderando a pessoa substituída.
3. WHEN um candidato ou substituto tem Vinculo `precisa_de`, `sempre_junto` ou `familia_requerida` não atendido no culto, THE Editor_de_Escala SHALL exibir aviso de vínculo sem bloquear a escolha.
4. THE Editor_de_Escala SHALL classificar como bloqueio a pessoa que está na regência ou na sonoplastia do mesmo culto.
5. THE Editor_de_Escala SHALL classificar como aviso a pessoa que é pregador do culto.
6. THE Editor_de_Escala SHALL classificar sem aviso a pessoa que é ancião do culto (RF004-A).
7. THE Editor_de_Escala SHALL classificar como aviso a pessoa que está na equipe e na MM do mesmo culto.
8. THE Editor_de_Escala SHALL classificar como bloqueio as demais repetições da mesma pessoa no mesmo culto.
9. THE Editor_de_Escala SHALL aplicar a mesma classificação em `candidatosParaCelula` e em `validarEscala`, com o Nivel de cada regra lido de Parametros.
10. THE Solver SHALL continuar evitando, na sugestão automática, o pregador do culto e a mesma pessoa na equipe e na MM do culto.
11. WHEN o usuário escolhe um elegível com aviso, THE Editor_de_Escala SHALL aplicar a escolha e manter o aviso visível no card.

### Requisito 17: Dia extraordinário de ponta a ponta

**User Story:** Como diretor da música, quero que um dia extraordinário funcione como qualquer culto, para que eu não precise tratá-lo à parte.

#### Critérios de Aceitação

1. THE Editor_de_Escala SHALL aplicar ao Dia_Extraordinario com Modelo_de_Louvor sábado ou domingo as mesmas regras de candidatos, validação, participação, publicação e sugestão automática dos demais cultos, com as funções do modelo escolhido.
2. WHEN a sugestão automática roda, THE Solver SHALL receber os cultos do Acionato, incluindo os Dia_Extraordinario e o Modelo_de_Louvor de cada um.
3. THE Solver SHALL verificar `dias_permitidos` pelo dia da semana real da data do culto.
4. WHERE o Modelo_de_Louvor é sem louvor, THE Editor_de_Escala SHALL tratar o culto como a quarta-feira (RF005).
5. WHEN a escala é publicada, THE Editor_de_Escala SHALL incluir o Dia_Extraordinario no `atual.json` em ordem de data.

### Requisito 18: Sugestão automática com confirmação

**User Story:** Como diretor da música, quero escolher se a sugestão sobrescreve o que já fiz, para que eu não perca escolhas manuais.

#### Critérios de Aceitação

1. WHEN o usuário aciona a sugestão automática e há alguma atribuição preenchida, THE Editor_de_Escala SHALL perguntar: sobrescrever tudo, só preencher vazios ou cancelar.
2. WHEN o usuário aciona a sugestão automática sem atribuição preenchida, THE Editor_de_Escala SHALL aplicar a sugestão sem perguntar.
3. WHEN o usuário escolhe "sobrescrever tudo", THE Editor_de_Escala SHALL substituir todas as atribuições pela sugestão.
4. WHEN o usuário escolhe "só preencher vazios", THE Solver SHALL receber as atribuições existentes como fixas, pré-carregadas em `escaladosPorCulto` e `escaladosNesteMes`, e preencher somente as funções vazias.
5. WHEN a sugestão de "só preencher vazios" é aplicada, THE Editor_de_Escala SHALL revalidar a escala e exibir o resultado.
6. WHEN o usuário escolhe "cancelar", THE Editor_de_Escala SHALL manter a escala inalterada.

### Requisito 19: Rascunho automático e indicador da escala

**User Story:** Como diretor da música, quero que o trabalho seja salvo sozinho e que eu veja se a escala difere do que está publicado, para que eu não perca nem esqueça nada.

#### Critérios de Aceitação

1. WHEN uma atribuição, o Banda/PB ou a Observação de um culto muda, THE Editor_de_Escala SHALL salvar o Rascunho do mês com as pessoas e os Grupos_Escalaveis por ID.
2. WHEN o usuário abre um mês com Rascunho salvo, THE Editor_de_Escala SHALL perguntar se deseja recuperar o rascunho ou começar uma nova montagem.
3. WHEN o usuário escolhe recuperar, THE Editor_de_Escala SHALL restaurar o Rascunho com os nomes atuais do Cadastro e revalidar a escala.
4. IF o Rascunho referencia um ID que não existe no Cadastro, THEN THE Editor_de_Escala SHALL manter a atribuição marcada como "fora do cadastro".
5. WHEN o usuário escolhe nova montagem, THE Editor_de_Escala SHALL apagar o Rascunho e começar pelas atribuições da Publicacao do mês, se `atual.json` contém esse mês, ou vazia.
6. WHEN o usuário abre um mês sem Rascunho, THE Editor_de_Escala SHALL começar pelas atribuições da Publicacao do mês, se `atual.json` contém esse mês, ou vazia.
7. WHEN a tela de conclusão é exibida, THE Editor_de_Escala SHALL apagar o Rascunho do mês.
8. WHILE a escala em montagem (atribuições, Banda/PB e OBS) difere da Publicacao do mês em `atual.json`, THE Editor_de_Escala SHALL exibir na tela de montagem o indicador "não sincronizado", calculado no navegador sem consultar o git.

### Requisito 20: Progresso visual

**User Story:** Como diretor da música, quero ver quanto falta, para que eu saiba quando posso enviar.

#### Critérios de Aceitação

1. THE Editor_de_Escala SHALL exibir barra de progresso e contadores de funções preenchidas e pendentes.
2. THE Editor_de_Escala SHALL contar somente cultos do tipo `louvor`, excluindo quartas, cultos departamentais e cultos sem louvor.
3. WHEN todas as funções de um culto estão preenchidas, THE Editor_de_Escala SHALL esmaecer o card desse culto.

### Requisito 21: Revalidação antes do envio

**User Story:** Como diretor da música, quero que o editor confira tudo antes de publicar, para que erros não cheguem à igreja e avisos não passem despercebidos.

#### Critérios de Aceitação

1. WHEN o usuário solicita o envio, THE Editor_de_Escala SHALL revalidar cada atribuição contra inativo, afastado, habilitação, dias permitidos, indisponibilidade, conflitos no culto, consecutivos, MM por mês, equipe incompleta e regente vazio, com o Nivel de Parametros.
2. IF uma atribuição referencia pessoa fora do Cadastro, THEN THE Editor_de_Escala SHALL registrar erro.
3. IF uma pessoa escalada não tem telefone, ou o responsável de um Grupo_Escalavel escalado não tem telefone, THEN THE Editor_de_Escala SHALL registrar erro, isentando somente Departamento e avaliando separadamente cada nome de campo com vírgula.
4. THE Editor_de_Escala SHALL executar o equivalente de `validar:regras` (integridade do Catalogo_de_Regras) e de `validar:obs` (OBS somente pública: RF007, RF011, RF016 e termos proibidos de `scripts/validacao/validar-obs-publico.js`).
5. WHEN há votantes da Enquete pendentes de associação, THE Editor_de_Escala SHALL registrar um aviso por votante pendente.
6. IF a revalidação tem erro, THEN THE Editor_de_Escala SHALL bloquear o envio e listar cada erro com culto, função e pessoa.
7. WHILE há aviso sem ciência, THE Editor_de_Escala SHALL manter o envio bloqueado e exigir a marcação de ciência em cada aviso.
8. IF a requisição de Fechamento chega com erro de revalidação ou com aviso sem ciência, THEN THE Servidor_Local SHALL recusar o Fechamento.

### Requisito 22: Conferência da escala online

**User Story:** Como diretor da música, quero que o editor confira, com o mesmo código da escala online, que cada nome publicado abre o WhatsApp da pessoa certa, para que links, "minha escala", destaque, alertas e agenda funcionem para todos.

#### Critérios de Aceitação

1. THE Editor_de_Escala SHALL publicar cada participante com exatamente `pessoa.nome` ou o `nome_exibicao` do Grupo_Escalavel, igual à chave correspondente nos Contatos_Derivados.
2. WHEN a revalidação antes do Fechamento é executada, THE Editor_de_Escala SHALL executar a Conferencia_de_Links sobre o `atual.json` gerado e o `contatos.json` que será publicado, importando `buscarContato` de `src/utils/contact.js`.
3. IF um nome de REGENTE LOUVOR, EQUIPE LOUVOR ou MENSAGEM MUSICAL não resolve para um contato, ou resolve para telefone diferente do telefone da pessoa escalada ou do responsável do grupo escalado, THEN THE Editor_de_Escala SHALL registrar erro.
4. IF um nome de qualquer campo exibido pela Escala_Online, inclusive AUDIOVISUAL, SUPORTE, ANCIÃO e PREGADOR, resolve para o telefone de pessoa diferente da designada pelo campo, THEN THE Editor_de_Escala SHALL registrar erro.
5. IF um nome coincide, após a normalização de `buscarContato`, com chave ou apelido de mais de uma entrada do `contatos.json`, THEN THE Editor_de_Escala SHALL registrar erro.
6. IF REGENTE LOUVOR, AUDIOVISUAL, SUPORTE, ANCIÃO ou PREGADOR contém vírgula, THEN THE Editor_de_Escala SHALL registrar erro.
7. IF um nome publicado de pessoa ou grupo tem caractere fora dos Caracteres_de_Nome, ou OBS, ANCIÃO ou PREGADOR contém "<" ou ">", THEN THE Editor_de_Escala SHALL registrar erro.
8. THE Editor_de_Escala SHALL listar cada erro da Conferencia_de_Links com culto, campo, nome e o número que o link abre.

### Requisito 23: Fechamento

**User Story:** Como diretor da música, quero publicar com um clique fazendo tudo que o processo oficial exige, para que o mês fique fechado sem terminal.

#### Critérios de Aceitação

1. WHEN o envio é confirmado, THE Editor_de_Escala SHALL executar em processo, sem shell e sem `scripts/local.py`, as etapas equivalentes a `scripts/publicacao/publicar-fechamento.js`.
2. THE Editor_de_Escala SHALL gerar `atual.json` no schema do viewer (`CAMPOS_ATUAL` de `montador/lib/publicar.mjs`), em ordem de data, incluindo as quartas com ancião, pregador, sonoplastia e OBS do Acionato (RF006).
3. WHEN `atual.json` contém outro mês, THE Editor_de_Escala SHALL copiá-lo para `old/AAAA/MMAAAA.json` se esse arquivo ainda não existir.
4. THE Editor_de_Escala SHALL regenerar `contatos.json` no Fechamento.
5. THE Editor_de_Escala SHALL atualizar os Controles_de_Rotacao em `escalas/AAAA/MM/` com a janela de histórico de Parametros (RF022).
6. THE Editor_de_Escala SHALL acrescentar em `processos/logs/publicacoes.md` uma linha com data, referência do `atual.json` publicado, responsável e observação (RF008).
7. THE Editor_de_Escala SHALL executar a limpeza equivalente a `scripts/manutencao/coletor-lixo-pos-publicacao.js`.
8. THE Editor_de_Escala SHALL criar Commit_Seletivo de todos os arquivos gravados e removidos no Fechamento e enviá-lo.
9. IF uma etapa anterior ao commit falha, THEN THE Editor_de_Escala SHALL restaurar os arquivos ao estado anterior ao Fechamento e deixar de commitar.
10. IF o push do Fechamento falha, THEN THE Editor_de_Escala SHALL manter o commit como Envio_Pendente e exibir "tentar de novo".

### Requisito 24: Verificação automática do site

**User Story:** Como diretor da música, quero que o editor confirme sozinho que o site atualizou, para que eu só avise as pessoas quando a escala estiver no ar.

#### Critérios de Aceitação

1. WHEN o push do Fechamento conclui, THE Servidor_Local SHALL consultar `atual.json` e `contatos.json` em `https://natanbudny.github.io/EscalaMusica/` com parâmetro de cache-busting a cada 15 segundos até os dois coincidirem com os arquivos enviados.
2. WHILE algum dos dois arquivos não coincide, THE Editor_de_Escala SHALL exibir "aguardando publicação" e manter desabilitado o botão "vi a escala atualizada".
3. WHEN os dois arquivos coincidem e a Conferencia_de_Links sobre os arquivos remotos não tem erro, THE Editor_de_Escala SHALL habilitar o botão "vi a escala atualizada" com o link da Escala_Online.
4. IF o conteúdo não coincide em 10 minutos, THEN THE Editor_de_Escala SHALL informar que o site não atualizou no tempo esperado e oferecer continuar verificando.
5. WHILE existe Envio_Pendente do Fechamento, THE Editor_de_Escala SHALL exibir "envio pendente" com "tentar de novo" em vez de consultar o site.
6. THE Editor_de_Escala SHALL liberar a etapa seguinte somente pela verificação do conteúdo, sem espera fixa de tempo.
7. WHEN os dois arquivos remotos coincidem com os enviados, THE Editor_de_Escala SHALL executar a Conferencia_de_Links sobre os arquivos remotos e exibir a tabela "nome na escala → número que o link abre" dos participantes de REGENTE LOUVOR, EQUIPE LOUVOR e MENSAGEM MUSICAL.
8. IF a Conferencia_de_Links sobre os arquivos remotos tem erro, THEN THE Editor_de_Escala SHALL manter desabilitado o botão "vi a escala atualizada" e listar os erros.

### Requisito 25: Mensagens de WhatsApp

**User Story:** Como diretor da música, quero mandar a mensagem oficial para cada pessoa com um clique e saber para quem já mandei, para que todos confirmem a escala.

#### Critérios de Aceitação

1. WHEN o usuário aciona "vi a escala atualizada", THE Editor_de_Escala SHALL exibir a tela de WhatsApp do mês.
2. THE Editor_de_Escala SHALL montar, em `montador/lib/whatsapp.mjs` com a lógica de `scripts/publicacao/gerar-links-publicacao.js`, um link wa.me por pessoa participante de REGENTE LOUVOR, EQUIPE LOUVOR e MENSAGEM MUSICAL com o template `pessoa` das Mensagens_WhatsApp preenchido com `{nome}`, `{mes/ano}` e `{funções}` (RF024, RF025).
3. THE Editor_de_Escala SHALL incluir os contatos fixos, com o template `fixo`, e o link do grupo do louvor definidos nas Mensagens_WhatsApp (inicialmente Adelaide, Yasser e `https://chat.whatsapp.com/EsfZwmrdWntG9wxqoSN5zw`).
4. THE Editor_de_Escala SHALL excluir Departamentos da lista de mensagens.
5. WHEN o usuário clica num contato, THE Editor_de_Escala SHALL abrir o link e mover o contato para a seção "Enviados".
6. THE Editor_de_Escala SHALL manter a seção "Enviados" recolhível e permitir reenviar a partir dela.
7. THE Editor_de_Escala SHALL guardar os enviados por mês no `localStorage`.
8. THE Editor_de_Escala SHALL montar as mensagens sem gerar arquivo `.md`.
9. THE Catalogo_de_Regras SHALL conter, como nova versão de RF023, o texto que define a tela de WhatsApp do editor como etapa obrigatória do Fechamento.
10. WHEN um Grupo_Escalavel está escalado no mês, THE Editor_de_Escala SHALL montar um único link para o telefone do responsável, com a `mensagem` do grupo quando preenchida ou, senão, com o template `grupo` (modo `funcao`) ou `culto_inteiro` (modo `culto_inteiro`, com `{data}`).

### Requisito 26: Mensagens de WhatsApp editáveis

**User Story:** Como diretor da música, quero editar o texto das mensagens de WhatsApp na tela de regras, para que eu ajuste a mensagem sem mexer em código e com histórico de versões.

#### Critérios de Aceitação

1. THE Mensagens_WhatsApp SHALL conter os templates `pessoa`, `grupo`, `culto_inteiro` e `fixo`, a lista de contatos fixos (Adelaide e Yasser) e o link do grupo do louvor.
2. THE Editor_de_Escala SHALL preencher os templates com `{nome}` (nome da pessoa em formato título), `{mes/ano}` (mês por extenso/ano), `{funções}` (funções em negrito ligadas por vírgula e " e "), `{data}` (DD/MM dos cultos) e `{grupo}` (`nome_exibicao`).
3. WHEN o usuário salva as Mensagens_WhatsApp alteradas na tela de regras, THE Editor_de_Escala SHALL validar o arquivo, acrescentar versão ao Historico_de_Versoes e criar Commit_Seletivo do arquivo e do histórico.
4. IF um template está vazio ou usa placeholder fora da lista do critério 2, THEN THE Editor_de_Escala SHALL recusar o salvamento indicando o template.
5. THE Mensagens_WhatsApp SHALL ter como conteúdo inicial as mensagens enviadas em agosto/2026 (`escalas/2026/08/links-whatsapp.md`): pessoa, família, Ministério Jovem e contatos fixos.
6. THE Catalogo_de_Regras SHALL conter, como nova versão de RF025, o texto que aponta as Mensagens_WhatsApp como fonte do template.
7. THE Editor_de_Escala SHALL compartilhar com `scripts/publicacao/gerar-links-publicacao.js` a mesma leitura e o mesmo preenchimento das Mensagens_WhatsApp.
8. IF `mensagens-whatsapp.json` está ausente ou inválido, THEN THE Editor_de_Escala SHALL usar o conteúdo inicial e exibir aviso com o problema.

### Requisito 27: Conclusão

**User Story:** Como diretor da música, quero um encerramento claro, para que eu saiba que o mês está fechado.

#### Critérios de Aceitação

1. WHEN o usuário conclui a tela de WhatsApp, THE Editor_de_Escala SHALL exibir a animação "Escala de (mês) concluída, te vejo na próxima" com o link da Escala_Online já verificada.

### Requisito 28: Ajustar escala publicada

**User Story:** Como diretor da música, quero corrigir um campo da escala já publicada, para que trocas pequenas não exijam refazer o mês.

#### Critérios de Aceitação

1. THE Editor_de_Escala SHALL oferecer no menu "Ajustar escala publicada", listando os cultos de `atual.json`.
2. WHEN o usuário altera um nome em REGENTE LOUVOR, EQUIPE LOUVOR ou MENSAGEM MUSICAL, a OBS (campo com o placeholder "Este texto será publicado na escala online") ou o Banda/PB de um culto e salva, THE Editor_de_Escala SHALL revalidar esse culto com as regras do envio, inclusive a Conferencia_de_Links.
3. IF a revalidação do ajuste tem erro ou aviso sem ciência, THEN THE Editor_de_Escala SHALL bloquear o salvamento.
4. WHEN o ajuste é salvo, THE Editor_de_Escala SHALL gravar em `atual.json` somente o campo alterado, recalcular os Controles_de_Rotacao, criar Commit_Seletivo de `atual.json` e dos controles, enviá-lo e iniciar a verificação automática do site.
5. THE Editor_de_Escala SHALL concluir o ajuste sem a tela de WhatsApp.

### Requisito 29: Regras de contexto consistentes

**User Story:** Como diretor da música, quero que quartas, departamentos e campos vazios sejam tratados igual em todo lugar, para que montagem, validação, site e WhatsApp nunca discordem.

#### Critérios de Aceitação

1. THE Editor_de_Escala SHALL classificar cada culto como `louvor`, `quarta` (RF005), `departamental` (RF015) ou `sem_louvor` por uma única função usada por montagem, validação, publicação, controles e WhatsApp.
2. WHERE o culto é `quarta` ou `sem_louvor`, THE Editor_de_Escala SHALL omitir funções de louvor na montagem, dispensá-lo da validação de louvor e publicar "-" em REGENTE LOUVOR, EQUIPE LOUVOR e MENSAGEM MUSICAL.
3. WHERE o culto é `departamental`, THE Editor_de_Escala SHALL omitir funções de louvor na montagem, publicar o nome do Departamento em REGENTE LOUVOR, EQUIPE LOUVOR e MENSAGEM MUSICAL e deixar de gerar mensagem de WhatsApp para ele.
4. THE Editor_de_Escala SHALL desconsiderar "-" e valores vazios como participantes em montagem, validação, publicação, controles e WhatsApp.
5. WHERE o culto tem Modelo_de_Louvor sábado, inclusive Dia_Extraordinario como sábado, THE Editor_de_Escala SHALL oferecer duas vagas de MM, ES e culto, cada uma aceitando pessoa ou Grupo_Escalavel.
6. WHEN as duas MMs de um culto com Modelo_de_Louvor sábado estão preenchidas, THE Editor_de_Escala SHALL publicar "NOME_ES, NOME_CULTO" em MENSAGEM MUSICAL.
7. IF somente uma MM de um culto com Modelo_de_Louvor sábado está preenchida, THEN THE Editor_de_Escala SHALL registrar o aviso `mm_vazia` e publicar somente o nome preenchido.
8. WHEN a Publicacao é lida para a montagem (`cultosDeAtual`), THE Editor_de_Escala SHALL atribuir o primeiro nome de MENSAGEM MUSICAL à MM ES e o segundo à MM culto.
9. IF um campo da Publicacao tem mais nomes do que vagas do Modelo_de_Louvor, THEN THE Editor_de_Escala SHALL registrar aviso e manter os nomes excedentes visíveis no card para o usuário remover ou realocar.

### Requisito 30: Casca Electron

**User Story:** Como diretor da música no Windows, quero abrir o editor como um programa, para que eu não precise de terminal nem de navegador.

#### Critérios de Aceitação

1. THE Casca SHALL executar `montador/server.mjs` de dentro do Clone_Local com o Node do Electron (`utilityProcess` ou `ELECTRON_RUN_AS_NODE`) e exibir a interface numa janela.
2. THE Casca SHALL iniciar o Servidor_Local com `MONTADOR_SEM_NAVEGADOR=1` e abrir a janela somente após `GET /api/saude` responder 200.
3. WHERE `MONTADOR_SEM_NAVEGADOR=1` está definida, THE Servidor_Local SHALL iniciar sem abrir o navegador.
4. THE Servidor_Local SHALL responder `GET /api/saude` com status 200 quando estiver pronto.
5. WHEN o Servidor_Local encerra com código 75, THE Casca SHALL reiniciá-lo uma vez.
6. WHEN a janela é fechada, THE Casca SHALL encerrar o processo do Servidor_Local.
7. IF uma segunda instância é aberta, THEN THE Casca SHALL focar a janela existente e encerrar a nova.
8. WHEN a interface abre um link externo, THE Casca SHALL abrir no navegador padrão somente endereços que começam com `https://wa.me/`, `https://chat.whatsapp.com/` ou `https://natanbudny.github.io/EscalaMusica/` e bloquear os demais.
9. THE Casca SHALL fazer o Modulo_Git usar o executável do MinGit embutido.
10. WHERE o Editor_de_Escala roda em desenvolvimento, THE Editor_de_Escala SHALL continuar iniciando com `npm run montar` e o git do sistema.

### Requisito 31: Primeira execução

**User Story:** Como diretor da música, quero configurar o programa uma vez com meu login do GitHub, para que ele publique em meu nome com segurança.

#### Critérios de Aceitação

1. WHEN a Casca é aberta sem configuração, THE Casca SHALL exibir a tela de configuração do login GitHub pedindo um token.
2. WHEN o token é informado, THE Casca SHALL confirmar pela API do GitHub que o token tem permissão de push em `NatanBudny/EscalaMusica`.
3. IF o token é inválido ou não tem permissão de push, THEN THE Casca SHALL exibir o motivo e permanecer na tela de configuração.
4. THE Casca SHALL guardar o token cifrado com `safeStorage` na pasta de dados do app, fora do Clone_Local.
5. THE Casca SHALL entregar o token ao git somente por `GIT_ASKPASS` e variável de ambiente do processo do Servidor_Local, sem gravá-lo em URL, log ou arquivo do Repositorio.
6. WHEN o token é aceito, THE Casca SHALL clonar `https://github.com/NatanBudny/EscalaMusica.git` no Clone_Local e configurar `user.name` e `user.email` locais do clone com o login do token.
7. WHEN o clone conclui, THE Casca SHALL criar atalho na área de trabalho.
8. IF o clone falha, THEN THE Casca SHALL exibir o motivo e oferecer tentar de novo.

### Requisito 32: Instalador Windows

**User Story:** Como diretor da música, quero um instalador que eu baixe e rode, para que o editor funcione em qualquer computador Windows da igreja.

#### Critérios de Aceitação

1. THE Instalador SHALL ser gerado somente para Windows, empacotando a Casca e o MinGit de versão fixa com SHA-256 conferido no build.
2. THE Instalador SHALL ser distribuído sem certificado de assinatura, com documentação do alerta do SmartScreen ("Mais informações" > "Executar assim mesmo").
3. THE Workflow_de_Build SHALL rodar em `windows-latest`, gerar o Instalador e executar smoke test que inicia o Servidor_Local pelo app empacotado, consulta `/api/saude` e executa `git --version` do MinGit.
4. IF o smoke test falha, THEN THE Workflow_de_Build SHALL falhar sem publicar artefato.
5. THE Editor_de_Escala SHALL manter o `package.json` da raiz sem dependências de runtime, com as dependências do Electron somente em `editor-windows/package.json`.
