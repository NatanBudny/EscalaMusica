# EscalaMusica 🎵

Aplicativo web para a equipe de louvor da Igreja — visualize a escala, exporte para a agenda, entre em contato com a equipe e encontre um substituto, tudo em um único lugar.

---

## Funcionalidades

| Funcionalidade | Descrição |
|---|---|
| 📅 **Escala completa** | Tabela (desktop) e cards (mobile) com todos os cultos |
| 🔐 **Login com Google** | Autenticação OAuth — vincula sua conta ao seu nome na equipe |
| 🔍 **Minha escala** | Filtra apenas os cultos em que você está escalado |
| 🔔 **Alerta de 7 dias** | Banner automático quando um culto seu está chegando |
| 📲 **Links do WhatsApp** | Clique no nome de qualquer membro para abrir o WhatsApp |
| 🔄 **Me substitua** | Gera uma mensagem pré-escrita para o responsável certo com um clique |
| 📆 **Exportar para agenda** | Baixa um `.ics` com lembretes configurados para o horário do culto |
| 🎶 **Músicas no YouTube** | Títulos das músicas viram links de busca no YouTube |
| 📡 **Modo offline** | Usa cache local quando sem conexão, com indicador visual |

---

## Tecnologias

- **Vanilla JS (ES Modules)** — sem frameworks, sem bundler
- **Google Identity Services** — OAuth 2.0 via `accounts.id`
- **Jest 29** — testes unitários com cobertura, em ESM nativo
- **Python** — servidor HTTP de desenvolvimento local

---

## Estrutura do Projeto

```
EscalaMusica/
├── index.html              # Shell da UI: todo CSS e markup. Zero JS inline.
├── atual.json              # Dados da escala vigente
├── contatos.json           # Mapa de nomes → { telefone, apelidos[] }
│
├── src/
│   ├── config.js           # Constantes globais (Client ID, chaves do localStorage)
│   ├── main.js             # Entry point: listeners de evento e handlers do HTML
│   ├── state.js            # Singleton de estado compartilhado
│   ├── auth/
│   │   ├── auth.js         # Fluxo OAuth e troca de views
│   │   └── storage.js      # Helpers puros de localStorage
│   ├── data/
│   │   └── loader.js       # Fetch de JSONs + fallback de cache offline
│   ├── utils/
│   │   ├── date.js         # Parsing e formatação de datas
│   │   ├── name.js         # Normalização de nomes e busca na escala
│   │   ├── contact.js      # Lookup de contatos por nome ou apelido
│   │   └── formatter.js    # Construtores de HTML (links, listas, músicas)
│   ├── business/
│   │   ├── agenda.js       # Monta o evento .ics conforme o papel na escala
│   │   └── substitute.js   # Gera o link WhatsApp para o substituto certo
│   └── ui/
│       ├── filters.js      # Orquestração de filtros e re-renderização
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
└── old/                    # Histórico de escalas anteriores (referência)
```

---

## Como rodar localmente

**Pré-requisito:** Python 3 instalado.

```bash
npm run dev
```

O servidor sobe em `http://localhost:8000/index.html` e abre o navegador automaticamente.

> O servidor local é necessário porque o app usa `fetch()` para carregar os arquivos `.json` — abrir o `index.html` diretamente pelo sistema de arquivos não funciona por restrições de CORS.

---

## Testes

```bash
# Rodar com cobertura
npm test

# Modo watch (re-executa ao salvar)
npm run test:watch
```

Todos os módulos de lógica pura têm cobertura de testes. Os módulos de UI (que manipulam o DOM) são exercitados manualmente.

---

## Dados

### `atual.json`

Array de registros de cultos. Cada registro segue o esquema:

```json
{
  "DATA": "11/03/2026",
  "DIA SEMANA": "Quarta",
  "REGENTE LOUVOR": "NOME",
  "EQUIPE LOUVOR": "NOME1, NOME2, NOME3",
  "MENSAGEM MUSICAL": "NOME",
  "PREGADOR": "NOME",
  "ANCIÃO": "NOME",
  "AUDIOVISUAL": "NOME",
  "SUPORTE": "NOME",
  "MÚSICAS": "Música 1 | Música 2 | Música 3"
}
```

### `contatos.json`

Mapa de nomes para contatos e apelidos:

```json
{
  "NOME COMPLETO": {
    "telefone": "https://wa.me/55XXXXXXXXXXX",
    "apelidos": ["APELIDO1", "APELIDO2"]
  }
}
```

---

## Fluxo da Aplicação

```
carregarCSV()  →  state (dadosGlobais + contatosMap)
                      ↓
              verificarAutenticacao()
                      ↓
                 mostrarApp()
                      ↓
           aplicarFiltroAutomatico()
             ↙            ↓           ↘
      montarTabela()  montarCards()  verificarAlertas()
```

---

## Coordenadores de Substituição

Configurados em `src/business/substitute.js` no objeto `COORDENADORES`. Atualizar este objeto quando houver mudança de liderança — não requer alteração na lógica.

| Papel | Coordenador padrão |
|---|---|
| Regente / Mensagem Musical | `LOUVOR` |
| Ancião de Culto | `ANCIAO` |
| Audiovisual / Suporte | `AUDIOVISUAL` |
