# Editor de Escala — Casca Windows

Aplicativo Electron (só Windows) que roda o montador (`montador/server.mjs`) de
dentro de um clone do repositório `NatanBudny/EscalaMusica` e mostra a interface
numa janela, sem terminal nem navegador.

O instalador NSIS é gerado no GitHub Actions
(`.github/workflows/editor-windows.yml`), testado por um smoke test antes de
publicar.

## Instalação (usuário final)

1. Baixe o instalador (`Editor de Escala Setup *.exe`) da release mais recente
   (aba Releases do repositório, tags `editor-v*`).
2. Execute o instalador.
3. **Alerta do SmartScreen**: o instalador não tem certificado de assinatura,
   então o Windows pode mostrar "O Windows protegeu o computador". Clique em
   **"Mais informações"** e depois em **"Executar assim mesmo"** para continuar.
4. Na primeira abertura, informe o token do GitHub (veja abaixo). O app valida o
   token, clona o repositório e cria um atalho na área de trabalho.

## Criar o token do GitHub

O token precisa de permissão de **push** no repositório
`NatanBudny/EscalaMusica`. Use uma das opções:

- **Classic**: em GitHub → Settings → Developer settings → Personal access
  tokens → Tokens (classic), gere um token com o escopo `repo`.
- **Fine-grained**: em Personal access tokens → Fine-grained tokens, limite o
  acesso ao repositório `NatanBudny/EscalaMusica` e conceda as permissões de
  repositório **Contents: Read and write** e **Metadata: Read-only**.

O token é guardado cifrado (`safeStorage`) na pasta de dados do app, fora do
clone. Ele é entregue ao git apenas por `GIT_ASKPASS` + variável de ambiente,
nunca em URL, log ou arquivo do repositório.

## Desenvolvimento

```
cd editor-windows
npm install
ESCALA_REPO_DIR=<caminho-do-repo> npx electron .
```

`ESCALA_REPO_DIR` aponta para um clone do repositório (em dev, o próprio
checkout). Sem ele, o app usa `userData/repo`.

## MinGit embutido e conferência do SHA-256

O instalador embute o **MinGit** (Git portátil oficial do Git for Windows). A
versão fixa, a URL oficial e o SHA-256 ficam em
[`mingit.json`](./mingit.json):

```json
{
  "versao": "2.47.1.windows.1",
  "url": "https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.1/MinGit-2.47.1-64-bit.zip",
  "sha256": "PENDENTE_CONFERIR"
}
```

> **Importante:** o campo `sha256` vem com o placeholder
> `PENDENTE_CONFERIR`. **Confira o checksum SHA-256 oficial** do arquivo
> `MinGit-2.47.1-64-bit.zip` na página da release do Git for Windows
> (git-for-windows/git, tag `v2.47.1.windows.1`) e substitua o placeholder pelo
> hash real antes de rodar o build.
>
> Enquanto o placeholder não for substituído, `scripts/baixar-mingit.mjs` falha
> de propósito com uma mensagem clara e **não extrai nada** — o build não
> prossegue com um MinGit não conferido.

Para baixar e conferir o MinGit manualmente:

```
cd editor-windows
node scripts/baixar-mingit.mjs
```

O script baixa a URL de `mingit.json`, confere o SHA-256 **antes** de extrair e
só então extrai em `vendor/mingit`. Se o hash não bater (ou ainda for o
placeholder), ele falha sem extrair.

## Smoke test

`main.mjs` aceita o modo `--smoke` (usado pelo workflow): pula a primeira
execução, usa `ESCALA_REPO_DIR` como clone, inicia o servidor com
`MONTADOR_SEM_PULL=1`, exige 200 em `/api/saude` e em `/`, roda `git --version`
do MinGit embutido (quando `vendor/mingit` existe) e sai com código 0 em
sucesso ou 1 em falha / após 60 s. Se o smoke falhar, o workflow não publica o
artefato.
