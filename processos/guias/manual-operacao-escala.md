# Manual de Operacao da Escala (Sem Dependencia de IA)

## Objetivo

Este manual descreve o processo completo para montar, validar, publicar e encerrar uma escala mensal no projeto.

## Quando usar

- Inicio de um novo mes de escala
- Ajustes finais antes do push/publicacao
- Fechamento do ciclo para evitar arquivos temporarios (lixo)

## Arquivos principais

- `atual.json`: escala oficial vigente (fonte da aplicacao)
- `contatos.json`: contatos e apelidos para gerar links
- `escalas/AAAA/MM/links-whatsapp.md`: links oficiais do mes
- `processos/logs/publicacoes.md`: historico oficial de publicacao

## Processo completo (checklist)

### Comando principal (recomendado)

Para fechamento mensal completo, use:

```bash
npm run publicar:fechamento -- --rascunho=escalas/AAAA/MM/rascunho.md
```

Esse fluxo executa publicacao, validacoes, geracao de links, limpeza pos-publicacao e sobe o ambiente local (`python scripts/local.py`) no final.

### 1. Preparar o mes

1. Confirmar ano/mes da escala.
2. Se necessario, ajustar cadastro em `processos/regras/cadastros/funcoes-louvor.json`.
3. Montar/ajustar `atual.json` com os cultos do mes.

### 2. Validar antes de publicar

Execute na raiz do projeto:

```bash
npm run validar:regras
npm run validar:obs
```

Criterio de aprovacao:

- `validar:regras` sem erro
- `validar:obs` sem erro

### 3. Gerar links de WhatsApp

Execute:

```bash
npm run gerar:links-publicacao
```

Resultado esperado:

- Arquivo gerado em `escalas/AAAA/MM/links-whatsapp.md` (mes inferido do `atual.json`)
- Layout em tabela
- Mensagem curta pre-preenchida nos links

### 4. Registrar publicacao

Atualize `processos/logs/publicacoes.md` com:

- Data da publicacao
- Referencia da escala publicada
- Responsavel
- Observacoes relevantes (ex.: cultos excepcionais)

### 5. Encerrar o ciclo (coletor de lixo)

Execute:

```bash
npm run limpar:pos-publicacao
```

Observacao: quando usar `publicar:fechamento`, esta etapa ja e executada automaticamente.

O coletor remove automaticamente no mes vigente:

- `rascunho.md`
- `publicada.md`
- Arquivos temporarios de `insumos/` (sonoplastia/acionato, se existirem)

Arquivos preservados para rastreabilidade:

- `insumos/indisponibilidade-cantores.json`
- `insumos/mapeamento-indisponibilidade-contatos.md`
- `arquivo/indisponibilidade-cantores-AAAA-MM-DD.json`

Opcional (simulacao, sem apagar):

```bash
node scripts/coletor-lixo-pos-publicacao.js --dry-run
```

Opcional (mes especifico):

```bash
node scripts/coletor-lixo-pos-publicacao.js --ano=2026 --mes=05
```

### 6. Revisao final antes de commit/push

```bash
git status --short
```

Conferir se os arquivos esperados estao corretos e entao seguir com commit/push.

## Regra operacional importante

Depois de publicado, qualquer ajuste deve ser feito diretamente no `atual.json` vigente.

## Troubleshooting rapido

- Links gerados no mes errado:
  - Sempre informe `--rascunho=escalas/AAAA/MM/rascunho.md` no comando de fechamento.
  - Verifique se `atual.json` contem datas validas no formato `DD/MM/YYYY`.
- Nome sem link:
  - Verifique se o nome existe em `contatos.json` (nome principal ou apelido).
- Erro de OBS publico:
  - Remova anotacoes internas e mantenha apenas observacoes autorizadas para publicacao.
