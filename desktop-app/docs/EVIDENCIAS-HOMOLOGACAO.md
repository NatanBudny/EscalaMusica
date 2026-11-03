# Evidencias para a homologacao (checkpoint final — tarefa 20)

Este documento reune as evidencias que o Aprovador deve conferir antes de
autorizar o corte. Apresentar estas evidencias NAO abre o feature gate: o corte
so ocorre apos a confirmacao explicita do Aprovador e o registro de homologacao
valido. Ate la, o fluxo atual (visualizador + processo legado) continua sendo o
oficial.

## Resumo da suite final

- Frontend (Vitest + fast-check): 876 testes aprovados, 2 guardados (E2E desktop
  Playwright, coberto in-process). 103 arquivos de teste.
- Nucleo (Rust, cargo test): 16 testes aprovados.
- Typecheck e lint (`--max-warnings 0`): sem erros.
- Nenhum teste aponta para o destino publico vigente (hosts de teste sao
  ficticios).

Reproduzir: em `desktop-app/`, rode `npm run typecheck`, `npm run lint`,
`npm run test`; em `desktop-app/src-tauri/`, rode `cargo test`.

## Equivalencia (visualizador e contratos legados)

- Exportacao legada (`atual.json`/`contatos.json`) validada por schema e
  serializacao canonica (tarefas 9.2, 9.6; Property 33).
- Compatibilidade do visualizador coberta pelos testes de contrato (tarefa 9.8).
- `atual.json` e o workflow do Pages permanecem intocados por esta entrega.

## Restauracao e rollback

- Backup integro por checksum e round-trip (tarefas 11.2, 11.8, 11.9;
  Properties 41, 42).
- Ensaio de restauracao e rollback de transicao (tarefa 14.3).
- Rollback compensatorio do corte preserva e verifica a vigente anterior
  (tarefa 19.1; `runCutover` em falha dispara `compensatingRollback`).

## Treinamento (Escala Simulada)

- Modo de treinamento isolado com fixtures ficticias e publicacao simulada
  (tarefa 16.2).
- Percurso completo coberto in-process (tarefa 16.4):
  `escalaSimulada.inprocess.test.tsx`, com prova de isolamento (hashes reais
  inalterados do inicio ao fim).
- Roteiro versionado e checklist de homologacao humana
  (`docs/ROTEIRO-DE-TREINAMENTO.md`, tarefa 17.4).

## Assinatura e distribuicao

- Bundle configurado para Windows (NSIS x64 + WebView2) e macOS (Intel/Apple
  Silicon, assinatura + notarizacao) em `src-tauri/tauri.conf.json`.
- Workflow de release assinado em `.github/workflows/desktop-release.yml`;
  certificados e chave do updater SOMENTE em secrets.
- Gate de distribuicao rejeita artefatos nao assinados / macOS nao notarizados
  (`src/domain/distribution/artifactGate.ts`, tarefa 17.6).

## Verificacao do Site Publico

- Confirmacao de publicacao exige igualdade integral por HTTP com host aprovado
  (tarefas 12.3, 12.7; Property 36). Sucesso do workflow sem igualdade NAO
  confirma a publicacao.

## Estado do feature gate

- Nenhum registro de homologacao valido esta commitado: o gate permanece
  FECHADO por padrao (`evaluateCutoverGate`), e a publicacao real e a escrita
  nos arquivos vigentes continuam desabilitadas.
- O comando guiado de corte (`runCutover`) retorna `blocked` enquanto o gate
  estiver fechado, informando que o fluxo atual continua oficial.

## Decisao do Aprovador

- [ ] Conferi as evidencias acima e autorizo registrar a homologacao.
- [ ] Mantenho o fluxo atual como oficial (nao autorizo o corte agora).

A abertura do gate exige o registro de homologacao com zero rejeitados, zero
pendentes, zero divergencias, restauracao verificada e a confirmacao do
Aprovador (data, responsavel, backup de transicao). Somente entao o corte pode
ser executado.
