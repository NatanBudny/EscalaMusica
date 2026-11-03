# Catalogo de falhas (versao 1.0.0)

Para cada situacao de erro, veja o sintoma, o que foi preservado, o impacto, como corrigir e como confirmar que a falha foi superada.

## A alteracao nao foi registrada porque a auditoria seria invalida. (`auditoria-invalida`)

- Sintoma: A alteracao nao e registrada e aparece aviso de que o registro de auditoria seria invalido.
- Preservado: o agregado anterior; a revisao atual; o registro de auditoria existente.
- Alterado: nada.
- Impacto: Nenhuma mudanca foi aplicada; a escala vigente permanece como estava.
- Correcao:
  1. Repita a operacao.
  1. Se persistir, anote o codigo exibido e reporte ao responsavel tecnico.
- Confirmacao: A operacao conclui e a auditoria registra a alteracao sem campos proibidos.

## A operacao nao foi concluida. (`comando-falhou`)

- Sintoma: A operacao nao conclui e aparece uma mensagem generica de falha.
- Preservado: o estado anterior.
- Alterado: nada.
- Impacto: Nenhuma mudanca confirmada; a escala vigente permanece como estava.
- Correcao:
  1. Tente novamente a operacao.
  1. Se persistir, anote o codigo exibido e reporte ao responsavel tecnico.
- Confirmacao: A operacao conclui normalmente na nova tentativa.

## A alteracao nao foi aplicada porque a revisao mudou. (`revisao-divergente`)

- Sintoma: Ao salvar uma alteracao, aparece a mensagem de que a revisao mudou e a edicao foi recusada.
- Preservado: a revisao atual do estado; todos os dados ja gravados.
- Alterado: nada.
- Impacto: Nenhuma mudanca foi aplicada; a escala vigente permanece como estava.
- Correcao:
  1. Recarregue o estado atual pelo botao indicado.
  1. Revise a alteracao sobre a versao mais recente.
  1. Salve novamente.
- Confirmacao: A alteracao e aceita e a grade passa a exibir o novo valor.

## Nenhuma alteracao foi detectada. (`sem-alteracao`)

- Sintoma: Ao salvar, aparece a mensagem de que nenhuma alteracao foi detectada.
- Preservado: o estado atual; a revisao atual.
- Alterado: nada.
- Impacto: A escala vigente permanece exatamente como estava.
- Correcao:
  1. Verifique se voce realmente alterou algum campo.
  1. Se nao havia mudanca, apenas feche a mensagem.
- Confirmacao: Ao fazer uma mudanca real e salvar, a alteracao e aceita.

## A alteracao foi recusada pela validacao. (`validacao-dominio`)

- Sintoma: A alteracao e recusada e o campo problematico e destacado com o motivo.
- Preservado: o agregado anterior; a revisao atual.
- Alterado: nada.
- Impacto: Nenhuma mudanca foi aplicada; a escala vigente permanece como estava.
- Correcao:
  1. Va ao campo destacado.
  1. Ajuste o valor conforme a regra indicada na mensagem.
  1. Confirme novamente.
- Confirmacao: A validacao deixa de apontar o campo e a alteracao e aceita.

