# EscalaMusica

Aplicativo web para a equipe de louvor da Igreja. Exibe a escala de cultos, permite filtrar por membro, exportar eventos para agenda e facilitar substituições.

---

## Funcionalidades

| Funcionalidade | Descrição |
|---|---|
| Escala completa | Tabela (desktop) e cards (mobile) com todos os cultos |
| Login com Google | Autenticação OAuth para vincular conta ao nome na equipe |
| Minha escala | Filtro automático para exibir apenas os cultos do usuário |
| Alerta de 7 dias | Banner automático quando um culto do usuário está próximo |
| Links de WhatsApp | Clique em nomes para abrir contato no WhatsApp |
| Me substitua | Gera mensagem pronta para o coordenador correto |
| Exportar para agenda | Modal para Google Calendar ou download `.ics` |
| Músicas no YouTube | Louvores viram links de busca no YouTube |
| Modo offline | Fallback para cache local de escala e contatos |

---

## Tecnologias

- Vanilla JS (ES Modules)
- Google Identity Services (`google.accounts.id`)
- Jest 29 (ESM nativo)
- Python (servidor local)

---

## Estrutura do projeto

```text
EscalaMusica/
├── index.html
├── atual.json
├── contatos.json
├── src/
│   ├── auth/
│   ├── business/
│   ├── data/
│   ├── ui/
│   ├── utils/
│   ├── config.js
│   ├── main.js
│   └── state.js
├── scripts/
├── tests/
├── escalas/                 # Escalas mensais organizadas por ano/mês
├── processos/
│   ├── guias/               # Guias operacionais
│   ├── regras/              # Regras e cadastros
│   ├── templates/           # Modelos reutilizáveis
│   └── logs/                # Registros oficiais
├── docs/
├── old/                     # Histórico de escalas publicadas
├── package.json
├── jest.config.js
└── ARCHITECTURE.md
```

---

## Como rodar localmente

Requer Python 3.

```bash
npm run dev
```

Abre em `http://localhost:8000/index.html`.

> O servidor é necessário porque o app usa `fetch()` para carregar os arquivos `.json`.

---

## Testes

```bash
npm test
npm run test:watch
```

---

## Scripts NPM

### Validação

- `npm run validar:regras`
- `npm run validar:rascunho`
- `npm run validar:obs`

### Controle e relatórios

- `npm run controle:mm`
- `npm run controle:regentes`
- `npm run controle:equipe`

### Publicação

- `npm run publicar:mensal`
- `npm run publicar:fechamento`
- `npm run gerar:links-publicacao`
- `npm run limpar:pos-publicacao`

### Dados e apoio

- `npm run gerar:contatos`
- `npm run limpar:regras`
- `npm run migrar:cadastro`
- `npm run vincular:indisponibilidade`
- `npm run sugerir:rascunho`

---

## Dados

### `atual.json`

Cada culto segue o formato:

```json
{
  "DATA": "11/07/2026",
  "DIA SEMANA": "quarta-feira | sábado | domingo",
  "ACOMP": "BANDA",
  "REGENTE LOUVOR": "NOME",
  "EQUIPE LOUVOR": "NOME1, NOME2, NOME3",
  "MENSAGEM MUSICAL": "NOME",
  "LOUVORES ES": "NUM - Título",
  "LOUVORES CULTO": "Título 1 | Título 2",
  "TEMA CULTO": "Tema opcional",
  "AUDIOVISUAL": "NOME",
  "ANCIÃO": "NOME",
  "PREGADOR": "NOME",
  "SUPORTE": "NOME",
  "OBS": "Observação pública"
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

## Fluxo mensal (rascunho → produção)

Para o passo a passo completo, use os guias em `processos/guias/`.

1. Iniciar ciclo: `processos/guias/iniciar-escala-mensal.md`
2. Validar rascunho: `processos/guias/validar-escala.md`
3. Publicar escala: `processos/guias/publicar-escala.md`
4. Pós-publicação: `processos/guias/pos-publicacao.md`

Referências importantes do fluxo:

- Insumos externos por mês: `escalas/AAAA/MM/insumos/`
- Arquivo de rastreabilidade: `escalas/AAAA/MM/arquivo/`
- Registro oficial de publicações: `processos/logs/publicacoes.md`
- Regras e cadastros: `processos/regras/`

### Comando recomendado de fechamento

```bash
npm run publicar:fechamento -- --rascunho=escalas/AAAA/MM/rascunho.md
```

Esse fluxo publica, valida, gera links de WhatsApp, limpa arquivos temporários do mês e inicia o servidor local.

---

## Links de publicação (WhatsApp)

```bash
npm run gerar:links-publicacao
```

Gera `escalas/AAAA/MM/links-whatsapp.md` com mensagens para:

- Regente de Louvor
- Equipe de Louvor
- Mensagem Musical
- Contatos fixos e grupo do louvor

---

## Substituições

- Coordenadores de substituição: `src/business/substitute.js`
- Telefones e apelidos: `contatos.json`
