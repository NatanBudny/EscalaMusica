# Escala de Louvor - [MÊS/ANO] (Rascunho)

## Instruções

- Preencha a tabela com os dados do novo mês
- Siga a estrutura: Data | Dia | Ancião | Pregador | Sonoplastia | Regente Louvor | Equipe Louvor (5) | Mensagem Musical | Observações
- A coluna "Equipe Louvor (5)" sempre deve ter exatamente 5 pessoas
- Nomes devem corresponder aos cadastrados em `contatos.json`

## Tabela

| Data | Dia | Anciao | Pregador | Sonoplastia | Regente Louvor | Equipe Louvor (5) | Mensagem Musical | Observacoes |
|---|---|---|---|---|---|---|---|---|
| DD/MM/YYYY | Dia | Nome | Nome | Nome | Nome | Nome1, Nome2, Nome3, Nome4, Nome5 | Nome | Observação opcional |
| DD/MM/YYYY | Dia | Nome | Nome | Nome | Nome | Nome1, Nome2, Nome3, Nome4, Nome5 | Nome | |
| DD/MM/YYYY | Dia | Nome | Nome | Nome | Nome | Nome1, Nome2, Nome3, Nome4, Nome5 | Nome | |
| DD/MM/YYYY | Dia | Nome | Nome | Nome | Nome | Nome1, Nome2, Nome3, Nome4, Nome5 | Nome | |
| DD/MM/YYYY | Dia | Nome | Nome | Nome | Nome | Nome1, Nome2, Nome3, Nome4, Nome5 | Nome | |
| DD/MM/YYYY | Dia | Nome | Nome | Nome | Nome | Nome1, Nome2, Nome3, Nome4, Nome5 | Nome | |

## Processo após conclusão

1. Validar nomes em `contatos.json`
2. Converter para `atual.json` com dados de quarta-feira
3. Executar: `npm run validar:regras`
4. Executar: `npm run validar:obs`
5. Depois de publicado oficialmente, executar: `npm run gerar:links-publicacao`
6. Registrar publicação em `publicacoes-escala.md`
