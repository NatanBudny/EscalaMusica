# Guia: Publicar Escala

## Objetivo

Promover a escala aprovada para producao com rastreabilidade.

## Checklist

- [ ] Definir explicitamente o rascunho do mes (ex.: `escalas/2026/07/rascunho.md`)
- [ ] Arquivar o `atual.json` vigente em `old/AAAA/mmaaaa.json`
- [ ] Gerar novo `atual.json` com a escala aprovada
- [ ] Confirmar quarta-feira com campos de louvor vazios
- [ ] Preferencial: executar fechamento completo com `npm run publicar:fechamento -- --rascunho=escalas/AAAA/MM/rascunho.md`
- [ ] Alternativa manual: executar `npm run publicar:mensal -- --rascunho=escalas/AAAA/MM/rascunho.md`
- [ ] Executar `npm run gerar:links-publicacao`
- [ ] Confirmar links em `escalas/AAAA/MM/links-whatsapp.md`
- [ ] Publicar links no WhatsApp
- [ ] Executar `npm run limpar:pos-publicacao` para remover arquivos temporarios do mes (rascunho/publicada e insumos temporarios)
- [ ] Confirmar que `insumos/indisponibilidade-cantores.json` e `arquivo/indisponibilidade-cantores-AAAA-MM-DD.json` foram preservados
- [ ] Confirmar que o `local.py` foi iniciado ao fim do `publicar:fechamento`

## Fluxo recomendado (mes que vem)

1. Rodar o comando unico com alvo explicito:

```bash
npm run publicar:fechamento -- --rascunho=escalas/AAAA/MM/rascunho.md
```

2. O fluxo executa automaticamente, nesta ordem:

- publicacao do mes (`publicar:mensal`)
- validacao de regras (`validar:regras`)
- validacao de OBS (`validar:obs`)
- geracao de links (`gerar:links-publicacao`)
- limpeza pos-publicacao (`limpar:pos-publicacao`)
- subida do ambiente local (`python scripts/local.py`)

3. Se precisar apenas validar o fluxo sem subir servidor local:

```bash
npm run publicar:fechamento -- --rascunho=escalas/AAAA/MM/rascunho.md --skip-local
```

4. Se precisar informar insumos fora do padrao do mes:

```bash
npm run publicar:fechamento -- --rascunho=escalas/AAAA/MM/rascunho.md --acionato=escalas/AAAA/MM/insumos/acionato.json --sonoplastia=escalas/AAAA/MM/insumos/sonoplastia.json
```

## Observacao de seguranca

- Sempre informar `--rascunho` para evitar publicar o mes errado quando houver mais de um `rascunho.md` no repositorio.

## Registro

Apos publicar, registrar em `processos/logs/publicacoes.md`.
