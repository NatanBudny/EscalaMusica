# EscalaMusica

Aplicativo web para a equipe de louvor da Igreja. Exibe a escala de cultos, permite filtrar por membro, exportar eventos para a agenda e facilitar substituições.

---

## Funcionalidades

| Funcionalidade | Descricao |
|---|---|
| **Escala completa** | Tabela (desktop) e cards (mobile) com todos os cultos |
| **Login com Google** | Autenticacao OAuth vincula sua conta ao seu nome na equipe |
| **Minha escala** | Filtra apenas os cultos em que voce esta escalado |
| **Alerta de 7 dias** | Banner automatico quando um culto seu esta chegando |
| **Links do WhatsApp** | Clique em qualquer nome para abrir o WhatsApp |
| **Me substitua** | Gera mensagem pre-escrita para o coordenador correto |
| **Exportar para agenda** | Baixa um `.ics` com lembrete configurado para o culto |
| **Musicas no YouTube** | Titulos das musicas viram links de busca no YouTube |
| **Modo offline** | Usa cache local quando sem conexao, com indicador visual |

---

## Tecnologias

- **Vanilla JS (ES Modules)** — sem frameworks, sem bundler
- **Google Identity Services** — OAuth 2.0 via `accounts.id`
- **Jest 29** — testes unitarios com cobertura, em ESM nativo
- **Python** — servidor HTTP de desenvolvimento local

---

## Estrutura do Projeto

```
EscalaMusica/
├── index.html              # UI: todo CSS e markup
├── atual.json              # Dados da escala vigente
├── contatos.json           # Mapa de nomes para { telefone, apelidos[] }
│
├── src/
│   ├── config.js           # Constantes globais (Client ID, chaves do localStorage)
│   ├── main.js             # Entry point: listeners de evento
│   ├── state.js            # Singleton de estado compartilhado
│   ├── auth/
│   │   ├── auth.js         # Fluxo OAuth e troca de views
│   │   └── storage.js      # Helpers de localStorage
│   ├── data/
│   │   └── loader.js       # Fetch de JSONs + fallback offline
│   ├── utils/
│   │   ├── date.js         # Parsing e formatacao de datas
│   │   ├── name.js         # Normalizacao de nomes e busca na escala
│   │   ├── contact.js      # Lookup de contatos por nome ou apelido
│   │   └── formatter.js    # Construtores de HTML (links, listas, musicas)
│   ├── business/
│   │   ├── agenda.js       # Monta o evento .ics conforme o papel na escala
│   │   └── substitute.js   # Gera o link WhatsApp para o coordenador correto
│   └── ui/
│       ├── filters.js      # Orquestracao de filtros e re-renderizacao
│       ├── table.js        # Renderer da tabela desktop
│       ├── cards.js        # Renderer dos cards mobile
│       └── alerts.js       # Banner de alerta de 7 dias
│
├── tests/
│   ├── utils/              # date, name, contact, formatter
│   ├── auth/               # storage
│   └── business/           # agenda, substitute
│
├── scripts/
│   └── local.py            # Servidor HTTP de dev na porta 8000
└── old/                    # Escalas anteriores (referencia)
```

---

## Como rodar localmente

Requer Python 3.

```bash
npm run dev
```

Sobe em `http://localhost:8000/index.html` e abre o navegador automaticamente.

> O servidor e necessario porque o app usa `fetch()` para carregar os arquivos `.json`. Abrir o `index.html` diretamente pelo sistema de arquivos nao funciona por restricoes de CORS.

---

## Testes

```bash
npm test             # com cobertura
npm run test:watch   # re-executa ao salvar
```

Modulos de logica pura possuem cobertura de testes. Modulos de UI sao verificados manualmente.

---

## Dados

### `atual.json`

Array de registros de cultos:

```json
{
  "DATA": "11/03/2026",
  "DIA SEMANA": "Quarta",
  "REGENTE LOUVOR": "NOME",
  "EQUIPE LOUVOR": "NOME1, NOME2, NOME3",
  "MENSAGEM MUSICAL": "NOME",
  "PREGADOR": "NOME",
  "ANCIAO": "NOME",
  "AUDIOVISUAL": "NOME",
  "SUPORTE": "NOME",
  "MUSICAS": "Musica 1 | Musica 2 | Musica 3"
}
```

### `contatos.json`

```json
{
  "NOME COMPLETO": {
    "telefone": "https://wa.me/55XXXXXXXXXXX",
    "apelidos": ["APELIDO1", "APELIDO2"]
  }
}
```

---

## Processo mensal da escala (rascunho -> producao)

Fluxo padrao para abrir um novo mes sem perder historico.

### 1) Criar rascunho em Markdown

- Criar um arquivo de rascunho em Markdown para o novo mes.
- Sugestao de nome: `escala-louvor-<mes>-<ano>-draft.md`.
- Revisar internamente ate chegar na versao aprovada.
- No rascunho/preview, as quartas-feiras podem ficar fora da tabela.

### 2) Aprovar o rascunho

- Apos validacao final, definir qual arquivo de rascunho foi autorizado.
- Este arquivo sera a base da nova escala vigente.

### 3) Arquivar a escala vigente

- Antes de trocar a escala atual, mover o arquivo vigente para `old/`.
- Nomear o arquivo arquivado no formato `mmaaaa` (mes + ano), por exemplo: `042026.json`.
- Objetivo: manter historico organizado e facilitar consultas futuras.

### 4) Promover o rascunho aprovado para atual

- Criar/atualizar o arquivo atual da escala com base no rascunho aprovado.
- O arquivo vigente deve continuar acessivel no caminho esperado pela aplicacao (`atual.json`).
- Na publicacao final (`atual.json`), incluir tambem as quartas-feiras com dados de `PREGADOR`, `ANCIAO`, `AUDIOVISUAL` e `OBS`.
- Para quartas-feiras, manter `REGENTE LOUVOR`, `EQUIPE LOUVOR`, `MENSAGEM MUSICAL` e `SUPORTE` em branco (ou `-`).
- Apos a promocao para `atual.json`, os arquivos `rascunho.md` e `publicada.md` do mes podem ser descartados.
- Qualquer alteracao posterior na escala deve ser feita diretamente no `atual.json`.

### 5) Checklist rapido de fechamento

- Confirmar que o historico foi salvo em `old/` com nome `mmaaaa`.
- Confirmar que `atual.json` contem a escala aprovada do novo mes.
- Subir o app localmente e validar se a escala carregou sem erros.

### 6) Pos-publicacao (obrigatorio)

- Registrar a publicacao oficial em `processos/logs/publicacoes.md` com data, referencia do `atual.json` publicado e responsavel.
- Gerar lista de links de WhatsApp para confirmacao da escala:

```bash
npm run gerar:links-publicacao
```

- A lista deve contemplar REGENTE LOUVOR, EQUIPE LOUVOR, MENSAGEM MUSICAL, contatos fixos (Adelaide e Yasser) e o link do grupo do louvor.

> ⚠️ **Arquivos temporários:** Os arquivos `links-whatsapp-publicacao-*.md` são gerados para divulgação após cada publicação e podem ser deletados quando a próxima escala for aberta.

---

## Coordenadores de Substituicao

Configurados em `src/business/substitute.js` no objeto `COORDENADORES`. Atualizar quando houver mudanca de lideranca.

| Papel | Coordenador |
|---|---|
| Regente / Mensagem Musical | `LOUVOR` |
| Anciao de Culto | `ANCIAO` |
| Audiovisual / Suporte | `AUDIOVISUAL` |
