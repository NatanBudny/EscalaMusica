# Guia: Validar Escala

## Objetivo

Garantir que o rascunho atende regras obrigatorias antes da publicacao.

## Comandos

```bash
npm run validar:regras
npm run validar:rascunho
npm run validar:obs
npm run analisar:participacao -- --mes=AAAA-MM
```

## Analise de participacao (ICR) — obrigatorio (RF027)

Antes de apresentar/aprovar o rascunho, rodar:

```bash
npm run analisar:participacao -- --mes=AAAA-MM
```

Gera `escalas/AAAA/MM/participacao-icr.md` com, para cada membro escalavel:

- **% Participacao** = dias escalado / dias disponivel
- **Carga Real** = dias escalado / total de cultos proprios
- **ICR** = dias escalado / media ideal (~3)

Interpretar os alertas:

- **SOBRECARGA (ICR > 2.0):** propor alivio, redistribuir.
- **ESQUECIDO (ICR 0 e disponivel na maioria dos cultos):** avaliar inclusao.

> Observacao: o `ciclo:mensal` ja executa esta analise automaticamente apos validar o rascunho (etapa 3.5). Rode o comando avulso ao ajustar o rascunho manualmente.

## Revisao clicavel do rascunho (tela HTML)

Para aprovar/reprovar cada participante sem editar o markdown:

1. `npm run revisar -- AAAA-MM` (sobe o servidor e abre a tela no mês; sem argumento usa o mês atual)
2. Clicar em cada nome: 1x aprova (verde), 2x reprova (vermelho + observacao), 3x neutro
4. **Salvar revisao (JSON)** e mover `revisao-resultado-AAAA-MM.json` para `escalas/AAAA/MM/`
5. O agente de escalas le esse JSON para aplicar as reprovacoes e sugerir substitutos

## Checklist

- [ ] Sem erro de regras fundamentais
- [ ] Sem duplicidade individual entre REGENTE e EQUIPE no mesmo culto
- [ ] Sem obs interna na coluna publica
- [ ] Sem conflito de nomes/funcoes
- [ ] Analise de participacao (ICR) revisada — sobrecarregados e esquecidos avaliados
- [ ] Ajustes aplicados no rascunho

## Saida esperada

- Escala aprovada para publicacao.
