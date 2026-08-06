# Guia: Coletar Insumos

## Objetivo

Reunir todos os dados externos antes da montagem da escala.

## Checklist

- [ ] Datas de todos os cultos do mes
- [ ] Escala de sonoplastia em JSON
- [ ] Escala de acionato em JSON (anciaos, pregadores e observacoes)
- [ ] Disponibilidade do louvor (enquete e mensagens)
- [ ] Consolidar a enquete de indisponibilidade em JSON
- [ ] Validar nome a nome da enquete com `contatos.json`
- [ ] Aplicar propagacao por casal na indisponibilidade vinculada (JESSIE↔JESSE, JESSICA↔JOAS)
- [ ] Gerar JSON vinculado para uso nas sugestoes do mes
- [ ] Confirmar preenchimento da coluna de acompanhamento `Banda/PB` no rascunho
- [ ] Atualizacoes no cadastro de funcoes

## Saida esperada

- JSONs consolidados em `escalas/AAAA/MM/insumos/`:
	- `sonoplastia.json`
	- `acionato.json`
	- `indisponibilidade-cantores.json`
	- `indisponibilidade-cantores-vinculada.json`
	- `mapeamento-indisponibilidade-contatos.md`
- Snapshot arquivado em `escalas/AAAA/MM/arquivo/`:
	- `indisponibilidade-cantores-AAAA-MM-DD.json`
- Insumos prontos para iniciar o rascunho em `escalas/AAAA/MM/rascunho.md`.
