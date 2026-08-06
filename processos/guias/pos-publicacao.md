# Guia: Pos-publicacao

## Objetivo

Atualizar controles e manter historico consistente apos a escala entrar em producao.

## Checklist

- [ ] Atualizar os 3 controles de rotacao:
	- `controle-mensagem-musical.json`
	- `controle-regentes.json`
	- `controle-equipe-louvor.json`
- [ ] Confirmar registro em `processos/logs/publicacoes.md`
- [ ] Regenerar e conferir `escalas/AAAA/MM/links-whatsapp.md`
- [ ] Confirmar mensagem personalizada por contato com `{nome}`, `{mes/ano}` e `{funcoes}`
- [ ] Confirmar template oficial da mensagem de WhatsApp:
	- `Ola, {nome}. Voce esta na escala de {mes/ano}, como {funcoes}. Entre na escala, veja os dias.`
	- `De um joinha nessa mensagem para confirmar que podera participar.`
	- `*Link da escala:* https://natanbudny.github.io/EscalaMusica/`
- [ ] Remover artefatos temporarios do mes, se aplicavel
- [ ] Aplicar ajustes futuros diretamente em `atual.json`
