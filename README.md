# EscalaMusica

Sistema de gestão de escalas para a equipe de louvor da igreja. Combina um aplicativo web (visualização da escala para os membros) com um pipeline de automação em CLI (geração, validação e publicação da escala mensal pelo diretor).

---

## Funcionalidades do App Web

| Funcionalidade | Descrição |
|---|---|
| **Escala completa** | Tabela (desktop) e cards (mobile) com todos os cultos |
| **Login com Google** | Autenticação OAuth vincula sua conta ao seu nome na equipe |
| **Minha escala** | Filtra apenas os cultos em que você está escalado |
| **Alerta de 7 dias** | Banner automático quando um culto seu está chegando |
| **Links do WhatsApp** | Clique em qualquer nome para abrir o WhatsApp |
| **Me substitua** | Gera mensagem pré-escrita para o coordenador correto |
| **Exportar para agenda** | Baixa um `.ics` com lembrete configurado para o culto |
| **Músicas no YouTube** | Títulos das músicas viram links de busca no YouTube |
| **Modo offline** | Usa cache local quando sem conexão, com indicador visual |

---

## Pipeline de Automação (CLI)

O ciclo mensal de escala é suportado por scripts Node.js organizados por responsabilidade:

### Ciclo Mensal (fluxo principal)

| Comando | O que faz |
|---------|-----------|
| `npm run iniciar:mes` | Cria a estrutura de diretórios para o novo mês |
| `npm run vincular:indisponibilidade` | Resolve nomes informais da enquete WhatsApp para IDs via fuzzy match e propaga indisponibilidade entre casais |
| `npm run sugerir:rascunho` | Solver determinístico que gera rascunho + justificativa com base em regras, histórico e disponibilidade |
| `npm run analisar:participacao` | Calcula % participação, carga real e ICR de cada membro (RF027); gera `participacao-icr.md` e sinaliza sobrecarregados/esquecidos |
| `npm run ciclo:mensal` | Orquestra o ciclo completo de ponta a ponta (já inclui a análise de participação após validar o rascunho) |

### Controle de Rotação

| Comando | O que faz |
|---------|-----------|
| `npm run controle:mm` | Apura frequência histórica de Mensagem Musical (ES / Culto / Domingo) |
| `npm run controle:regentes` | Apura frequência de regências |
| `npm run controle:equipe` | Apura frequência de escalações na equipe de louvor |

### Validação

| Comando | O que faz |
|---------|-----------|
| `npm run validar:regras` | Checa consistência entre REGRAS.md e regras.json |
| `npm run validar:rascunho` | Valida rascunho contra as regras fundamentais |
| `npm run validar:obs` | Garante que o campo OBS não contém informações internas |
| `npm run analisar:participacao` | **Obrigatório (RF027)** antes de aprovar: calcula ICR e aponta desequilíbrios de carga |

### Publicação

| Comando | O que faz |
|---------|-----------|
| `npm run publicar:mensal` | Promove o rascunho aprovado para `atual.json` |
| `npm run publicar:fechamento` | Fechamento completo (arquiva vigente + promove novo) |
| `npm run gerar:links-publicacao` | Gera links de WhatsApp para confirmação pós-publicação |

### Manutenção

| Comando | O que faz |
|---------|-----------|
| `npm run gerar:contatos` | Deriva `contatos.json` a partir de `pessoas.json` |
| `npm run limpar:pos-publicacao` | Remove arquivos temporários do ciclo anterior |
| `npm run limpar:regras` | Remove restrições pessoais expiradas |
| `npm run migrar:cadastro` | Migração de formato do cadastro de pessoas |

---

## Tecnologias

- **Vanilla JS (ES Modules)** — sem frameworks, sem bundler
- **Node.js** — scripts de automação em ESM nativo
- **Google Identity Services** — OAuth 2.0 para o app web
- **Jest 29** — testes unitários com cobertura (src/ e scripts/)
- **fast-check** — testes baseados em propriedade
- **Python** — servidor HTTP de desenvolvimento local

---

## Estrutura do Projeto

```
EscalaMusica/
├── index.html              # App web: CSS + HTML (zero JS inline)
├── atual.json              # Escala vigente (fonte do app web)
├── contatos.json           # Mapa nome → { telefone, apelidos[] }
├── pessoas.json            # Cadastro completo: habilitações, vínculos, disponibilidade
├── config.json             # Configuração geral (ex: maintenance_mode)
│
├── src/                    # Código do app web
│   ├── main.js             # Entry point
│   ├── state.js            # Estado compartilhado
│   ├── auth/               # Login Google OAuth
│   ├── data/               # Fetch de dados + fallback offline
│   ├── utils/              # Funções puras (datas, nomes, contatos, formatação)
│   ├── business/           # Regras de negócio (agenda .ics, substituição)
│   └── ui/                 # Renderização (tabela, cards, filtros, alertas)
│
├── scripts/                # Pipeline de automação
│   ├── ciclo/              # Fluxo mensal (iniciar, vincular, sugerir, orquestrar)
│   ├── controle/           # Apuração de rotação (MM, regentes, equipe)
│   ├── validacao/          # Validadores (regras, rascunho, OBS)
│   ├── publicacao/         # Publicação e geração de links
│   ├── manutencao/         # Utilitários (contatos, limpeza, migração)
│   ├── lib/                # Bibliotecas compartilhadas (cadastro, fuzzy-match, solver)
│   ├── local.py            # Servidor HTTP dev (porta 8000)
│   └── pre-commit-hook.sh  # Hook de pré-commit
│
├── tests/                  # Testes Jest
│   ├── utils/              # date, name, contact, formatter
│   ├── auth/               # storage
│   ├── business/           # agenda, substitute
│   ├── data/               # loader
│   ├── ui/                 # alerts, cards, filters, table
│   ├── lib/                # cadastro, fuzzy-match, normalizar, limpar-regras
│   ├── solver/             # solver-filtros, solver-output, solver-selecao
│   ├── scripts/            # controle-rotacao-utils
│   ├── fixtures/           # Dados de teste
│   └── helpers/            # Utilitários PBT (property-based testing)
│
├── escalas/                # Escalas mensais (YYYY/MM/): insumos, rascunhos, links
├── old/                    # Histórico de escalas passadas
├── docs/                   # Documentação de negócio e regras
│   ├── resumo.md           # Diretrizes de geração de escala
│   └── regras/             # Regras formais (REGRAS.md + JSON)
├── agents/                 # Prompts de agentes IA (documentador, escala)
└── .github/workflows/      # CI: deploy estático
```

---

## Como rodar localmente

Requer Python 3.

```bash
npm run dev
```

Sobe em `http://localhost:8000/index.html` e abre o navegador automaticamente.

> O servidor é necessário porque o app usa `fetch()` para carregar os JSONs. Abrir o `index.html` diretamente não funciona por restrições de CORS.

---

## Testes

```bash
npm test             # com cobertura (src/ + scripts/)
npm run test:watch   # re-executa ao salvar
```

Cobertura cobre lógica pura (`src/utils/`, `src/business/`, `scripts/lib/`). Módulos de UI são verificados manualmente no navegador.

---

## Dados principais

### `pessoas.json`

Cadastro central de pessoas. Contém habilitações (funções que a pessoa pode exercer), vínculos entre pessoas (ex: casais que cantam sempre juntos), dias permitidos, aliases e telefone. Usado pelos scripts de automação.

### `atual.json`

Escala vigente no formato:

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
  "MUSICAS": "Musica 1 | Musica 2 | Musica 3"
}
```

### `contatos.json`

Derivado de `pessoas.json` via `npm run gerar:contatos`. Formato:

```json
{
  "NOME COMPLETO": {
    "telefone": "https://wa.me/55XXXXXXXXXXX",
    "apelidos": ["APELIDO1", "APELIDO2"]
  }
}
```

---

## Processo mensal (resumo)

1. **Iniciar mês** — cria estrutura de diretórios (`npm run iniciar:mes`)
2. **Coletar indisponibilidade** — enquete no WhatsApp, salvar em `escalas/YYYY/MM/insumos/`
3. **Vincular indisponibilidade** — fuzzy match nomes → IDs, propagar casais (`npm run vincular:indisponibilidade`)
4. **Gerar rascunho** — solver aplica regras + histórico + disponibilidade (`npm run sugerir:rascunho`)
5. **Validar** — checar regras fundamentais (`npm run validar:rascunho`)
6. **Analisar participação (ICR)** — **obrigatório (RF027)**: `npm run analisar:participacao -- --mes=YYYY-MM`. Gera `escalas/YYYY/MM/participacao-icr.md`. Revisar sobrecarregados (ICR > 2.0) e esquecidos (ICR 0 estando disponíveis).
7. **Revisar e ajustar** — diretor revisa o rascunho com apoio do agente de escalas. Para uma revisão clicável (aprovar/reprovar cada participante), abrir `revisao/index.html` (ver [Tela de revisão](#tela-de-revisão-do-rascunho)).
8. **Publicar** — promover para `atual.json` e arquivar anterior em `old/` (`npm run publicar:fechamento`)
9. **Pós-publicação** — gerar links WhatsApp de confirmação (`npm run gerar:links-publicacao`)

> ⚠️ **Não rode `npm run ciclo:mensal` depois de ajustar o rascunho manualmente** — ele regenera o vínculo e o rascunho do zero, descartando as edições manuais. Após a revisão, use os comandos avulsos (`analisar:participacao`, `validar:rascunho`) ou vá direto para `publicar:fechamento`.

---

## Tela de revisão do rascunho

Ferramenta interna para o diretor revisar o rascunho clicando em cada participante, sem editar o markdown à mão.

**Como usar (jeito rápido):**

```bash
npm run revisar -- 2026-09   # sobe o servidor e abre a tela já no mês certo
npm run revisar              # usa o mês atual
```

O comando sobe o servidor local e abre o navegador direto na tela de revisão do mês. Encerre com `Ctrl+C`.

**Aplicar a revisão de forma determinística (sem edição manual):**

Depois de salvar o JSON pela tela, aplique-o direto ao rascunho:

```bash
npm run aplicar:revisao -- --mes=2026-09 --input="caminho/revisao-resultado-....json" --dry   # inspeciona
npm run aplicar:revisao -- --mes=2026-09 --input="caminho/revisao-resultado-....json"          # aplica
```

O script troca cada reprovado pelo substituto escolhido, **audita o resultado** (todas as regras via `scripts/lib/auditor-escala.js`) e só grava se não houver violação. Reprovados sem substituto são reportados como pendência (nada é inventado). Rode `npm run validar:rascunho` a qualquer momento para a auditoria completa (regras + disponibilidade + ICR).

**Alternativa manual:**

1. Suba o servidor local: `npm run dev`
2. Abra `http://localhost:8000/revisao/index.html?mes=YYYY-MM` (ou informe o mês no campo e clique em **Carregar rascunho**)
3. Para cada nome escalado, **clique para alternar o status**:
   - 1 clique → **verde** (aprovado)
   - 2 cliques → **vermelho** (reprovado; abre um campo para escrever a observação/motivo)
   - 3 cliques → volta ao neutro
   - Nomes de departamento (Jovens, Desbravadores, etc.) aparecem fixos e não são clicáveis
4. As marcações ficam guardadas automaticamente no navegador (localStorage) enquanto você revisa
5. Ao terminar, clique em **Salvar revisão (JSON)** — baixa `revisao-resultado-YYYY-MM.json`
6. Mova esse arquivo para `escalas/YYYY/MM/` para que o agente de escalas possa lê-lo e aplicar as reprovações

O botão **Importar revisão** recarrega um JSON salvo anteriormente, permitindo continuar de onde parou.

**Formato do resultado** (`revisao-resultado-YYYY-MM.json`): cada culto lista, por grupo (REGENTE/EQUIPE/MENSAGEM MUSICAL), os participantes com `status` (`aprovado`/`reprovado`/`neutro`) e `obs`. O agente usa esse arquivo para saber quem trocar e por quê.

---

## Coordenadores de Substituição

Configurados em `src/business/substitute.js`. Atualizar quando houver mudança de liderança.

| Papel | Coordenador |
|---|---|
| Regente / Mensagem Musical | `LOUVOR` |
| Ancião de Culto | `ANCIÃO` |
| Audiovisual / Suporte | `AUDIOVISUAL` |
