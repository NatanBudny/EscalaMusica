# Guia: Montar Escala

## Objetivo

Preencher o rascunho mensal respeitando regras e prioridades.

## Entradas

- `escalas/AAAA/MM/controle-mensagem-musical.json`
- `escalas/AAAA/MM/insumos/sonoplastia.json`
- `escalas/AAAA/MM/insumos/acionato.json`
- `processos/regras/regras.index.json`
- Grupos em `processos/regras/*.json`
- Cadastros em `processos/regras/cadastros/`

## Passos

- [ ] Definir regencia priorizando menor `REGENCIA` e disponibilidade
- [ ] Definir equipe (5 pessoas) priorizando menor `EQUIPE` e disponibilidade
- [ ] Definir mensagem musical por slot (ES/CULTO/DOMINGO) por menor frequencia
- [ ] Revisar conflitos com papeis externos no mesmo culto
- [ ] Carregar observacoes vindas do acionato e separar o que e publico do que e interno

## Saida esperada

- `escalas/AAAA/MM/rascunho.md` preenchido e pronto para validacao.
