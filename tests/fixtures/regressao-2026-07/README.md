# Fixture de regressão — julho/2026

Esta pasta congela o comportamento do solver **antes** das refatorações das Tasks 7,
8 e 12 do spec `melhoras-domingao`. Serve de baseline para a Task 12.2 (teste de
regressão), que ainda **não** foi criado aqui — esta tarefa apenas captura os insumos
e os arquivos esperados.

## Quando foi capturado

Tudo foi capturado a partir do estado inicial do repositório (HEAD inicial do projeto),
antes de qualquer alteração em `scripts/lib/cadastro.js`, `scripts/manutencao/gerar-contatos.js`,
`contatos.json`, `pessoas.json`, `montador/lib/regras.mjs` ou nos módulos `scripts/lib/solver-*`.

## Insumos (cópias exatas do estado atual)

- `pessoas.json` — cópia byte a byte de `/pessoas.json`.
- `atual.json` — cópia byte a byte de `/atual.json` (contém apenas cultos de agosto/2026).
- `old/2026/*.json` — cópia byte a byte de `/old/2026/` (histórico: `01-2026.json`,
  `02-2026.json`, `032026.json`, `042026.json`, `052026.json`, `062026.json`).
- `escalas/2026/07/insumos/indisponibilidade-cantores-vinculada.json` — cópia byte a byte
  do insumo de indisponibilidade vinculada de julho/2026.
- `escalas/2026/07/insumos/acionato.json` — **recuperado do histórico do git**
  (`git show a3a432c~1:escalas/2026/07/insumos/acionato.json`). O acionato de julho/2026
  havia sido removido do repositório no commit `a3a432c`; sem ele não é possível
  reproduzir a sugestão do mês (o `atual.json` só tem agosto/2026). Esta cópia é idêntica
  à última versão versionada do acionato de julho.

## Arquivos esperados (gerados pelo código ATUAL)

- `esperado-sugestao.json` — saída de `sugerirMes(carregarContexto('2026-07'))`
  (`montador/lib/regras.mjs`), sem nenhuma modificação do solver.
- `esperado-rascunho.md` — saída de `node scripts/ciclo/sugerir-rascunho.js --mes=2026-07`,
  rodado como está hoje.

### Como foram gerados

`montador/lib/regras.mjs` → `carregarContexto` ainda **não** aceita `{ root }` nesta versão
do código (usa o `ROOT` do repositório). Por isso a geração foi feita a partir do root real
do repositório, com o `acionato.json` acima colocado temporariamente em
`escalas/2026/07/insumos/` apenas durante a captura e removido em seguida (ele não existe
no HEAD). Nenhum arquivo de produção foi modificado de forma permanente: o `acionato.json`
temporário foi apagado e os `rascunho.md`/`rascunho-justificativa.md` versionados de julho
foram restaurados com `git checkout`.

Quando a Task 12 adicionar o suporte a `--root=<pasta>` em `sugerir-rascunho.js` e o
parâmetro `{ root }` em `carregarContexto`, o teste de regressão (Task 12.2) poderá apontar
diretamente para esta fixture, sem mexer no root real.

## Observações importantes para quem for escrever o teste (Task 12.2)

- O `acionato.json` de julho usa `"dia": "quarta"` (e não `"quarta-feira"`). O código atual
  normaliza o dia para `"quarta"`, que **não** bate com a verificação `=== 'quarta-feira'`
  usada para pular cultos sem louvor. Resultado: as quartas de julho são tratadas como
  cultos **normais** e recebem regente/equipe na sugestão. Isso é o comportamento real do
  código nesta versão e foi congelado de propósito; não é um bug a corrigir nesta tarefa.
- Por causa disso, `esperado-rascunho.md` e `esperado-sugestao.json` **divergem** do
  `escalas/2026/07/rascunho.md` que já existia no repositório (aquele foi gerado por uma
  versão anterior do código/insumos). O baseline correto para a regressão é o que está nesta
  pasta.
- Dois cultos aparecem como `departamental` (QUARTETO em 04/07 e CULTO MELHOR IDADE em
  26/07, resolvido como MELHOR IDADE), conforme a lógica de `ehDepartamental`.
- O teste de regressão deve comparar com `PARAMETROS_PADRAO` e também com o
  `parametros.json` do repositório (conforme o design), lembrando que, ao rodar via
  `{ root }`, os caminhos de `old/` e `atual.json` precisam resolver para dentro desta
  fixture.
