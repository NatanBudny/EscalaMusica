# Processos - EscalaMusica

Esta pasta concentra os fluxos operacionais, regras e registros.

## Entrada rapida (baixo token)

1. Ler `processos/regras/regras.index.json` para localizar o grupo correto.
2. Ler apenas o arquivo de grupo necessario em `processos/regras/`.
3. Para operar o ciclo mensal, seguir `processos/guias/iniciar-escala-mensal.md`.
4. No inicio do mes, receber e salvar os insumos externos em JSON em `escalas/AAAA/MM/insumos/` (sonoplastia e acionato).

## Estrutura

- `processos/guias/`: passos operacionais por responsabilidade unica.
- `processos/regras/`: regras agrupadas por categoria e cadastros.
- `processos/templates/`: modelos reutilizaveis.
- `processos/logs/`: historicos oficiais.

## Compatibilidade

Os caminhos antigos em `docs/regras/` permanecem disponiveis durante a transicao.
