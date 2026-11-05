# Observações da escala de Novembro/2026

Registradas em 05/11/2026 a pedido do diretor. Conferir cada item antes de publicar.

## Insumos

- [x] Indisponibilidade: `votes.csv` (enquete do WhatsApp; cada pessoa votou nos dias em que **não pode**). Nomes convertidos pelo telefone.
- [x] Anciãos e pregadores: `NOVEMBRO26.docx (2).pdf`, em `insumos/acionato.json`.
- [x] Sonoplastia: `Sonoplastia Novembro.pdf`, no audiovisual do acionato e em `insumos/sonoplastia.json`.

## Pedidos do diretor

- [ ] **14/11 sem banda (PB).** Ajustar o ACOMP no `atual.json` depois de publicar.
- [ ] **Padrão BANDA/PB:** sábados BANDA, domingos PB, quartas PB. O script põe BANDA nos domingos; corrigir no `atual.json` depois de publicar.
- [x] 14/11: MM com **Lilian**, nas duas músicas, nome uma vez. Lilian cadastrada (id 78) com o contato da Carla Ribeiro.
- [x] 21/11: MM com **Francieli Sastre**, nas duas músicas, nome uma vez. Cadastrada (id 77), +55 51 98262-7460.
- [x] Semana de Evangelismo: OBS públicas em 07/11 e 14/11.

## Decisões do diretor

- [x] 08/11 pregador PR. MAURICI; 15/11 MARCOS LEANDRO; DULCE = DULCINEIA (apelido adicionado).
- [x] 01/11 e 04/11 desconsiderados. Sem cultos extras na Semana de Evangelismo.
- [x] Bete, Manu S., Mirella e Laura fora em novembro. Luiz da Silva fora em novembro.
- [x] Dany Kallas, Giovana e Jessé escalados mesmo sem ter votado.
- [x] Sequências: evitar quando houver bastante gente; aceitar quando houver pouca.
- [x] Catherine uma vez no mês, na equipe em que o Fabrício reger (21/11).
- [x] Yasser, Maria Eloisa e Catherine não regem sábado. Regentes de sábado: Dany Kallas, Suellen, Fabrício e André.
- [x] Luiz Antonio fora dos sábados (vai cobrir o Diego na sonoplastia). Mantido nos domingos 15 e 29.
- [x] Giovana: não pode em dias seguidos por enquanto (bebê). Prega dia 21 e rege só dia 15.
- [x] Marcela fora da MM de 08/11; entrou a Raissa.

## Sonoplastia

- [x] 07/11: Luiz Antonio troca com o Diego (AUDIOVISUAL = LUIZ ANTONIO no rascunho, acionato e `insumos/sonoplastia.json`).
- [x] 15/11: "Luiz" da sonoplastia é sempre o Luiz Antonio (diretor). AUDIOVISUAL = LUIZ ANTONIO. Ele saiu da equipe de 15/11 e foi para a de 22/11; o Vanderley foi de 22/11 para 15/11.
- [x] Luiz Antonio marcado com "Sonoplastia" no cadastro, para o montador conferir o conflito sozinho nos próximos meses.

## Banda/PB (aplicar na publicação)

- [ ] Sábados BANDA, exceto 14/11 (PB). Domingos e quartas PB. O `publicar:fechamento` põe BANDA nos domingos: corrigir os domingos e o dia 14 no `atual.json` logo depois de publicar.

## Próxima etapa do processo

- [ ] Revisão do diretor na tela de revisão (`npm run revisar -- 2026-11`), salvar o JSON da revisão e aplicar com `npm run aplicar:revisao`. Só depois publicar.

## Conferência pelo montador (ferramenta do sucessor)

- `validarEscala` e `revalidarParaEnvio` do montador: 0 erros e 6 avisos. Os avisos são cantou no culto anterior em 14, 21 e 28, e MM do culto vazia em 14 e 21, porque Lilian e Francieli cantam as duas músicas com o nome uma vez só.
- `npm run validar:rascunho`: sem violações.
- Lilian cadastrada com o contato da Carla Ribeiro (`contato_via_id`).

## Histórico de versões do rascunho

- `arquivo/rascunho-solver-original.md`: saída do solver (11 violações).
- `arquivo/rascunho-antes-confirmacoes.md`: primeira correção manual.
- `arquivo/rascunho-antes-revisao-2.md`: antes das respostas de 05/11 (itens 1 a 12).
- `rascunho.md`: versão atual. `validar:rascunho` sem violações nem avisos; ninguém canta em cultos seguidos.

## Regras a documentar

Ver `regras-a-documentar.md` nesta pasta.
