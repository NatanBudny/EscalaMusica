# Roteiro de treinamento — Escala Simulada (versao 1.0.0)

Percorra os passos abaixo no modo de treinamento, usando dados ficticios. Em cada passo, confira "o que voce deve ver".

## Abertura: Abrir o mes ficticio

- O que fazer: Escolha o mes ficticio e confira o calendario gerado.
- Onde: Assistente do ciclo mensal > Etapa Abertura
- O que voce deve ver: As quartas, sabados e domingos do mes aparecem na lista.

## Coleta: Lancar insumos ficticios

- O que fazer: Lance anciao, pregador e uma indisponibilidade de teste.
- Onde: Coleta de insumos externos > grades + conferencia
- O que voce deve ver: O resumo de conferencia aparece antes de salvar.

## Montagem: Montar com apoio da sugestao

- O que fazer: Monte a escala usando a sugestao e ajuste uma celula manualmente.
- Onde: Montagem da escala > grade de montagem
- O que voce deve ver: Cada celula mostra os candidatos e o status de atribuicao.

## Validacao: Validar a escala

- O que fazer: Rode a validacao completa e resolva um bloqueio de teste.
- Onde: Validacao > botao "Validar escala completa"
- O que voce deve ver: Os totais de bloqueios/avisos/aprovadas aparecem.

## Aprovacao: Revisar a previa e aprovar

- O que fazer: Revise as diferencas e registre ciencia de cada aviso.
- Onde: Previa e aprovacao > lista de diferencas + caixas de aviso
- O que voce deve ver: O botao Aprovar so habilita apos reconhecer os avisos.

## Publicacao: Publicar de forma simulada

- O que fazer: Publique o pacote aprovado no destino simulado.
- Onde: Modo de treinamento > botao "Publicar (simulado)"
- O que voce deve ver: A publicacao simulada e registrada; nada vai a rede real.

## Fechamento: Fechar o mes

- O que fazer: Confirme o fechamento do mes ficticio.
- Onde: Assistente do ciclo mensal > Etapa Fechamento
- O que voce deve ver: Links e rotacao ficticios aparecem como atualizados.

## Restauracao: Ensaiar a restauracao

- O que fazer: Restaure o backup de treino em outra instalacao de teste.
- Onde: Modo de treinamento > botao "Restaurar (ensaio)"
- O que voce deve ver: A restauracao de treino e registrada no percurso.

## Conclusao: Concluir o treinamento

- O que fazer: Conclua o treinamento e verifique o isolamento.
- Onde: Modo de treinamento > botao "Concluir treinamento"
- O que voce deve ver: A mensagem confirma que os dados reais ficaram inalterados.

# Checklist de homologacao humana

- [ ] O novo operador concluiu a Escala Simulada sozinho, sem ajuda tecnica.
  - Evidencia: Registro do modo de treinamento com todas as etapas cobertas.
- [ ] Foi feito um backup e restaurado em outra instalacao limpa.
  - Evidencia: Modo de treinamento > ensaio de restauracao + verificacao de integridade.
- [ ] Os dados reais permaneceram inalterados durante todo o exercicio.
  - Evidencia: Verificacao de isolamento (hashes iguais no inicio e no fim).
- [ ] Nenhum passo exigiu terminal, edicao de JSON/Markdown ou IA.
  - Evidencia: Roteiro de treinamento (cada passo vinculado a um controle/tela).
