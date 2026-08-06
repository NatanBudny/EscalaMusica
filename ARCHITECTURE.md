# Architecture

> **Context map for AI sessions.** Read this file first before asking for features or fixes.
> All code is in English. The app is a single-page church schedule viewer (no server-side logic).

---

## Folder Structure

```
EscalaMusica/
├── index.html              # Shell: CSS + HTML markup only. Zero inline JS.
├── src/
│   ├── main.js             # Entry point. Event listeners + window-exposed onclick handlers.
│   ├── state.js            # Single shared mutable state object (dadosGlobais, contatosMap, usuarioAtual).
│   ├── auth/
│   │   ├── auth.js         # Google OAuth flow + all view-switching logic (mostrarAuth/App/SelecaoNome).
│   │   └── storage.js      # Pure localStorage helpers: lerVinculosGoogle, obterNomeVinculadoPorSub, salvarVinculoPorSub.
│   ├── data/
│   │   └── loader.js       # Fetches atual.json + contatos.json; falls back to localStorage cache.
│   ├── utils/
│   │   ├── date.js         # parseDate, isPastDate, formatarDataExtenso — no side effects.
│   │   ├── name.js         # normalizarNome, estaEscalado, buscarPorNome — no side effects.
│   │   ├── contact.js      # buscarContato(contatosMap, nome) — finds by exact name or alias.
│   │   └── formatter.js    # linkarNome, formatarNome, formatarLista, formatarMusicasComYouTube — returns HTML strings.
│   ├── business/
│   │   ├── agenda.js       # getDetalhesAgenda(registro, nome) — detects all 7 roles; builds .ics description.
│   │   └── substitute.js   # gerarLinkSubstituto(contatosMap, usuarioAtual, registro) — WhatsApp substitute link.
│   └── ui/
│       ├── table.js        # montarTabela(d) — desktop <table> renderer.
│       ├── cards.js        # montarCards(d) — mobile card renderer.
│       ├── filters.js      # montarFiltros, aplicarFiltros, aplicarFiltroAutomatico, renderizar.
│       └── alerts.js       # verificarAlertas() — 7-day schedule reminder banner.
├── tests/
│   ├── utils/              # date.test.js, name.test.js, contact.test.js, formatter.test.js
│   ├── auth/               # storage.test.js
│   └── business/           # agenda.test.js, substitute.test.js
├── atual.json              # Current schedule data (array of service records).
├── contatos.json           # Contact map: { "NAME": { telefone, apelidos[] } }
├── old/                    # Historical schedules (read-only reference, not loaded at runtime).
├── local.py                # Dev server: serves files over HTTP on port 8000.
├── package.json            # "type": "module". Test script uses --experimental-vm-modules.
├── jest.config.js          # Jest config for native ESM.
├── escalas/                # Escalas mensais organizadas por ano/mês (YYYY/MM/).
├── processos/              # Guias operacionais, regras, templates e logs.
└── docs/resumo.md          # Business rules for schedule generation (AI context).
```

---

## Data Flow

```
carregarCSV()
  └─→ state.dadosGlobais, state.contatosMap
        └─→ verificarAutenticacao()
              └─→ mostrarApp() + aplicarFiltroAutomatico()
                    └─→ renderizar(d)
                          ├─→ montarTabela(d)   [desktop]
                          ├─→ montarCards(d)    [mobile]
                          └─→ verificarAlertas()
```

---

## Dependency Graph

```
main.js
  ├── state.js
  ├── data/loader.js → state
  ├── auth/auth.js   → state, auth/storage.js, ui/filters.js
  ├── utils/name.js
  ├── business/agenda.js → utils/name.js
  └── ui/filters.js
        ├── state
        ├── utils/date.js, utils/name.js
        ├── ui/table.js  → state, utils/date.js, utils/formatter.js
        ├── ui/cards.js  → state, utils/date.js, utils/name.js, utils/formatter.js, business/substitute.js
        └── ui/alerts.js → state, utils/date.js, utils/name.js

utils/formatter.js → utils/name.js, utils/contact.js
utils/contact.js   → utils/name.js
business/substitute.js → utils/name.js, utils/date.js, utils/contact.js
```

> No circular dependencies.

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| `state.js` singleton | Avoids passing 3 globals through every call. All modules reference `state.*`. |
| `buscarContato(contatosMap, nome)` takes map as arg | Makes it a pure function — fully testable without DOM or global state. |
| `formatarNome/List/etc.` take `(contatosMap, usuarioAtual, ...)` | Same reason: pure, injectable, tested in isolation. |
| `src/auth/auth.js` merges views + Google auth | Eliminates the circular dependency that would form if `views.js ↔ google.js`. |
| UI modules (`ui/`) are not unit-tested | They depend on real DOM elements. Tested via integration (browser). Core logic they call is fully covered. |
| `window.exportarParaAgenda`, `window.salvarNomeVinculado` | HTML inline `onclick` attributes require global functions. Explicitly exported from `main.js`. |

---

## Schedule Record Shape

```json
{
  "DATA":             "DD/MM/YYYY",
  "DIA SEMANA":       "domingo | sábado | quarta-feira",
  "ACOMP":            "BANDA | PB",
  "REGENTE LOUVOR":   "NAME",
  "EQUIPE LOUVOR":    "NAME, NAME, NAME",
  "MENSAGEM MUSICAL": "NAME",
  "LOUVORES ES":      "NUM - Title | NUM - Title",
  "LOUVORES CULTO":   "Title | Title",
  "TEMA CULTO":       "string",
  "AUDIOVISUAL":      "NAME",
  "ANCIÃO":           "NAME",
  "PREGADOR":         "NAME",
  "SUPORTE":          "NAME",
  "OBS":              "string"
}
```

`SCHEDULE_FIELDS` (checked by `estaEscalado`): `REGENTE LOUVOR`, `EQUIPE LOUVOR`, `PREGADOR`, `MENSAGEM MUSICAL`, `AUDIOVISUAL`, `ANCIÃO`, `SUPORTE`.

---

## Running Tests

```bash
npm test          # run all tests + coverage report
npm run test:watch
```

Coverage target: 100% statements/lines/functions for `src/utils/` and `src/business/`.
UI and auth modules are excluded from the unit-test coverage requirement (DOM-dependent).

---

## Adding a New Feature — Checklist

1. Does it touch **data transformation**? → Add to `src/utils/` and write a unit test.
2. Does it touch **scheduling business rules**? → Add to `src/business/` and write a unit test.
3. Does it touch **rendering HTML**? → Add to the appropriate `src/ui/` module.
4. Does it need **state** (`dadosGlobais`, `contatosMap`, `usuarioAtual`)? → Import `state` from `src/state.js`.
5. Does it need to be callable from an HTML `onclick`? → Attach to `window.*` in `src/main.js`.
6. Run `npm test` and confirm green before shipping.
