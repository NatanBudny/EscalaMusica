# Gestao Leiga de Escalas — Aplicativo desktop

Aplicativo de computador (Windows e macOS) para montar, validar, aprovar e
publicar a escala mensal do ministerio de musica, operado inteiramente por telas
e botoes. Voce NAO precisa de terminal, nao edita JSON ou Markdown, nao usa IA e
nao precisa conhecer o repositorio. O aplicativo e isolado: ele nao altera o
visualizador atual nem os arquivos publicos vigentes ate a homologacao.

> Observacao importante sobre privacidade: o login do Google na pagina publica
> NAO protege o conteudo. Qualquer pessoa com o endereco (URL) consegue abrir a
> pagina. Por isso, telefones e dados sensiveis so aparecem no site quando ha
> autorizacao explicita de cada pessoa.

## Glossario

- Ciclo mensal: todo o trabalho de um mes, da abertura ao fechamento.
- Escala vigente: a escala que ja esta publicada no site publico.
- Rascunho: a escala em construcao, ainda nao publicada.
- Revisao: uma "fotografia" do rascunho, identificada por um codigo.
- Insumo externo: dado recebido de fora (anciao, pregador, sonoplastia, tema,
  musicas, pedidos, observacoes).
- Indisponibilidade: datas em que uma pessoa nao pode servir.
- Regra fundamental: regra que nao pode ser quebrada sem excecao aprovada.
- Preferencia: orientacao que pode ser contrariada com justificativa.
- Previa: a imagem do que sera publicado, antes de publicar.
- Aprovacao: o aceite consciente do responsavel, com ciencia dos avisos.
- Publicacao: o envio do pacote aprovado ao site publico.
- Fechamento: o encerramento do mes, com links e rotacao atualizados.
- Homologacao: a aprovacao final que libera o corte para o novo fluxo.

## As sete etapas

1. Abertura — escolher o mes e conferir o calendario (quartas, sabados e
   domingos); incluir cultos extraordinarios se necessario.
2. Coleta — lancar anciao, pregador, sonoplastia, musicas, tema, pedidos,
   observacoes e as indisponibilidades recebidas.
3. Montagem — montar a escala por culto; a sugestao serve de apoio e pode ser
   ajustada manualmente.
4. Validacao — rodar a validacao completa e resolver cada bloqueio.
5. Aprovacao — revisar a previa e as diferencas e registrar ciencia de cada
   aviso antes de aprovar.
6. Publicacao — publicar o pacote aprovado e aguardar a verificacao do site
   publico.
7. Fechamento — confirmar o fechamento; os links de confirmacao e a rotacao sao
   atualizados a partir da escala publicada.

## Instalacao

- Windows 10/11 (x64): baixe o instalador `.exe` assinado e execute. O
  componente WebView2 e instalado automaticamente, se necessario. A instalacao e
  por usuario e nao pede senha de administrador.
- macOS 12 ou mais novo (Intel ou Apple Silicon): abra o arquivo `.dmg` assinado
  e notarizado e arraste o aplicativo para a pasta Aplicativos.

Nao instale versoes nao assinadas ou nao notarizadas: o sistema avisa e o
pipeline de distribuicao as rejeita.

## Configuracao inicial

Na primeira abertura, informe pelas telas: o mes de trabalho, os destinos de
publicacao ja definidos pelo responsavel e a entrada no GitHub (abaixo). Toda a
configuracao e feita por formularios; voce nunca edita arquivos.

## Atualizacao

O aplicativo avisa quando ha uma nova versao. Atualize apenas fora de um ciclo
em andamento. A atualizacao preserva seus dados locais.

## Remocao

Use o desinstalador do sistema (Windows) ou mova o aplicativo para a Lixeira
(macOS). Seus backups e a credencial no cofre do sistema podem ser removidos
separadamente pelas telas do aplicativo.

## Cadastro

Cadastre pessoas e departamentos por formularios: nome, apelidos, telefone (no
formato internacional), habilitacoes, dias permitidos, afastamentos e vinculos.
Erros aparecem ao lado do campo e preservam o que voce ja digitou.

## Entradas (insumos externos)

Lance cada insumo por grade, escolhendo pessoas/departamentos em listas. O PDF
recebido e apenas referencia: voce o abre a parte e digita os dados. Antes de
salvar, o aplicativo mostra um resumo para conferencia.

## Indisponibilidades

Registre datas, intervalos ou o mes inteiro. Os efeitos em casais e vinculos sao
calculados e exibidos com a origem, para voce conferir.

## Regras

As regras (fundamentais e preferencias) ficam em uma unica fonte versionada. O
ciclo usa uma versao fixa de regras; mudancas criam uma nova versao.

## Sugestao

A sugestao e automatica e explicavel: para cada escolha, ela mostra o porque.
Voce pode aceitar, ajustar ou ignorar — ignorar nao altera o rascunho.

## Validacao

A validacao aponta bloqueios (que impedem avancar) e avisos (que exigem
ciencia). Cada achado indica o culto, o campo, o motivo e a acao. Um clique leva
voce ao campo afetado.

## Previa

A previa mostra exatamente o que sera publicado e as diferencas em relacao a
escala vigente (inclusoes, alteracoes e remocoes), sem alterar a vigente.

## Publicacao

Publique somente o pacote aprovado. O aplicativo confirma o resultado comparando
o site publico com o pacote. Se algo divergir, nada e dado como publicado.

## Git e repositorios

O aplicativo usa dois repositorios separados: um privado (gestao) e um publico
(site). Voce nao usa comandos de Git: tudo e feito por botoes.

## Credenciais

A entrada no GitHub usa o fluxo de dispositivo. A credencial fica guardada no
cofre do sistema (Windows Credential Manager ou Keychain do macOS). O token nunca
aparece na tela, em logs, em backups ou no pacote publicado.

## Modo offline

Sem internet, voce continua trabalhando: as alteracoes entram em uma fila e sao
enviadas quando a conexao volta. A publicacao exige internet.

## Conciliacao entre maquinas

Se a mesma escala foi alterada em duas maquinas, o aplicativo mostra os conflitos
e pede sua escolha. Nada e sobrescrito automaticamente.

## Backup

O aplicativo cria backups verificaveis por checksum. Antes de restaurar, ele
confere a integridade. Backups de publicacoes oficiais sao preservados.

## Migracao

Na transicao, o cadastro e as regras legadas sao importados com um relatorio por
origem. Nomes ambiguos ficam pendentes para sua decisao — nada e adivinhado.

## Rollback (reversao)

Se uma publicacao falhar ou precisar ser revertida, o aplicativo restaura a
versao anterior por uma nova publicacao, sem apagar historico.

## Revisoes pos-publicacao

Trocas, cancelamentos e correcoes publicas sao feitos por uma copia editavel, com
motivo e auditoria. So os links afetados sao regenerados.

## Custos

O uso operacional nao exige custo recorrente obrigatorio. Eventuais servicos
pagos sao opcionais e ficam registrados na configuracao.

## Formatos

- Exportacao/importacao portavel: JSON documentado, reimportavel sem perda.
- Compatibilidade com o visualizador: `atual.json` e `contatos.json` no formato
  exato exigido pelo site atual.

Exemplos de valores validos e invalidos acompanham cada formulario na propria
tela; voce nao edita arquivos de dados manualmente.

## Erros e recuperacao

Quando algo da errado, o aplicativo mostra o que nao foi concluido, o que foi
preservado, o impacto, o que fazer e como confirmar que a falha foi superada.
Consulte tambem o [catalogo de falhas](docs/CATALOGO-DE-FALHAS.md).

## Responsaveis e historico

Cada versao deste material registra os responsaveis e as mudancas. O historico e
mantido junto ao projeto.
