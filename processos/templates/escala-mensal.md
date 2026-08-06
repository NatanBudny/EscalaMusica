# Escala de Louvor - [MÊS/ANO] (Rascunho)

## Instruções

- Preencha a tabela com os dados do novo mês
- Siga a estrutura: Data | Dia | Ancião | Pregador | Sonoplastia | Regente Louvor | Equipe Louvor (5) | Mensagem Musical | Banda/PB | Observações
- A coluna "Equipe Louvor (5)" sempre deve ter exatamente 5 pessoas
- A coluna "Banda/PB" e de acompanhamento operacional e deve ser preenchida com `BANDA` ou `PB`
- Nomes devem corresponder aos cadastrados em `contatos.json`

## Tabela

| Data | Dia | Anciao | Pregador | Sonoplastia | Regente Louvor | Equipe Louvor (5) | Mensagem Musical | Banda/PB | Observacoes |
|---|---|---|---|---|---|---|---|---|---|
| DD/MM/YYYY | Dia | Nome | Nome | Nome | Nome | Nome1, Nome2, Nome3, Nome4, Nome5 | Nome | BANDA/PB | Observação opcional |
| DD/MM/YYYY | Dia | Nome | Nome | Nome | Nome | Nome1, Nome2, Nome3, Nome4, Nome5 | Nome | BANDA/PB | |
| DD/MM/YYYY | Dia | Nome | Nome | Nome | Nome | Nome1, Nome2, Nome3, Nome4, Nome5 | Nome | BANDA/PB | |
| DD/MM/YYYY | Dia | Nome | Nome | Nome | Nome | Nome1, Nome2, Nome3, Nome4, Nome5 | Nome | BANDA/PB | |
| DD/MM/YYYY | Dia | Nome | Nome | Nome | Nome | Nome1, Nome2, Nome3, Nome4, Nome5 | Nome | BANDA/PB | |
| DD/MM/YYYY | Dia | Nome | Nome | Nome | Nome | Nome1, Nome2, Nome3, Nome4, Nome5 | Nome | BANDA/PB | |

## Processo antes de iniciar

1. Atualizar `processos/regras/cadastros/funcoes-louvor.json` se houve mudanças de habilitações (regencia/equipe)
2. Regenerar `controle-mensagem-musical.json` para o novo mês com os contadores zerados
3. Receber e salvar os insumos externos em `escalas/AAAA/MM/insumos/`:
   - `sonoplastia.json`
   - `acionato.json`
   - `indisponibilidade-cantores.json`
4. Arquivar snapshot da indisponibilidade em `escalas/AAAA/MM/arquivo/indisponibilidade-cantores-AAAA-MM-DD.json`
5. Na indisponibilidade vinculada, propagar automaticamente indisponibilidade entre casais oficiais (JESSIE↔JESSE, JESSICA↔JOAS)

## Processo de preenchimento da escala

1. Validar nomes em `contatos.json`
2. **Usar ranking de `controle-mensagem-musical.json` como sugestão para:**
   - **Mensagem Musical (ES/CULTO/DOMINGO)**: Priorizar menor frequência em cada slot
   - **Regência Louvor**: Priorizar pessoas com `pode_regencia: true` e menor contador REGENCIA
   - **Equipe Louvor**: Priorizar pessoas com `pode_equipe: true` e menor contador EQUIPE
3. Converter para `atual.json` com dados de quarta-feira
4. Executar: `npm run validar:regras`
5. Executar: `npm run validar:obs`

## Processo após publicação

1. Executar: `npm run gerar:links-publicacao`
2. Registrar publicação em `processos/logs/publicacoes.md`
3. **Atualizar `controle-mensagem-musical.json`**: Incrementar contadores de REGENCIA, EQUIPE e MM para cada pessoa que foi escalada
4. Após publicar e validar o `atual.json`, `rascunho.md` e `publicada.md` podem ser descartados
5. Alterações futuras da escala do mês devem ser feitas diretamente no `atual.json`
