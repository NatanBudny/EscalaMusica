# Processos - EscalaMusica

Esta pasta concentra os fluxos operacionais, regras e registros.

## Entrada rapida (baixo token)

1. Ler `processos/regras/regras.index.json` para localizar o grupo correto.
2. Ler apenas o arquivo de grupo necessario em `processos/regras/`.
3. Para operar o ciclo mensal, seguir `processos/guias/iniciar-escala-mensal.md`.
4. No inicio do mes, receber e salvar os insumos externos em JSON em `escalas/AAAA/MM/insumos/` (sonoplastia, acionato e indisponibilidade-cantores).
5. Validar nome a nome da indisponibilidade contra `contatos.json` e gerar `indisponibilidade-cantores-vinculada.json`.
6. Arquivar um snapshot da indisponibilidade em `escalas/AAAA/MM/arquivo/indisponibilidade-cantores-AAAA-MM-DD.json`.

## Estrutura

- `processos/guias/`: passos operacionais por responsabilidade unica.
- `processos/regras/`: regras agrupadas por categoria e cadastros.
- `processos/templates/`: modelos reutilizaveis.
- `processos/logs/`: historicos oficiais.

## Compatibilidade

Os caminhos antigos em `docs/regras/` permanecem disponiveis durante a transicao.
