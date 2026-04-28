# Guia: Publicar Escala

## Objetivo

Promover a escala aprovada para producao com rastreabilidade.

## Checklist

- [ ] Arquivar o `atual.json` vigente em `old/AAAA/mmaaaa.json`
- [ ] Gerar novo `atual.json` com a escala aprovada
- [ ] Confirmar quarta-feira com campos de louvor vazios
- [ ] Executar `npm run gerar:links-publicacao`
- [ ] Confirmar links em `escalas/AAAA/MM/links-whatsapp.md`
- [ ] Publicar links no WhatsApp
- [ ] Executar `npm run limpar:pos-publicacao` para remover arquivos temporarios do mes (rascunho/publicada/insumos)

## Registro

Apos publicar, registrar em `processos/logs/publicacoes.md`.
