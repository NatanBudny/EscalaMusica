# Implementation Plan: Cadastro Unificado e Solver

## Overview

Refatoração do modelo de dados para unificar cadastro de pessoas em `pessoas.json` com IDs numéricos imutáveis, migrar restrições pessoais para atributos do cadastro, e implementar solver determinístico que gera sugestões explicáveis.

Linguagem: JavaScript (ES Modules, Node.js >=18)
Testes: Jest (--experimental-vm-modules) + fast-check (property-based)

## Tasks

- [x] 1. Estrutura base e utilitários compartilhados
  - [x] 1.1 Criar módulo de carregamento e validação do cadastro (`scripts/lib/cadastro.js`)
    - Implementar `carregarPessoas(caminhoPessoas?)` que lê, valida e indexa `pessoas.json`
    - Retornar `{ pessoas, porId: Map<number, Pessoa>, porNome: Map<string, Pessoa>, grupos: Map<string, GrupoDef> }`
    - Validar: IDs únicos > 0, nomes UPPER únicos, aliases globalmente únicos, vínculos `sempre_junto` referenciam IDs existentes, vínculos `familia_requerida` referenciam grupos existentes, `proximo_id = max(ids) + 1`
    - Validar simetria de `sempre_junto` (P8)
    - Validar que todos `membros_ids` dos grupos existem no cadastro
    - Lançar erro descritivo em caso de inconsistência
    - _Requirements: Schema de pessoas.json (Design - Data Models), P2, P8_

  - [x] 1.2 Criar módulo de normalização de nomes (`scripts/lib/normalizar.js`)
    - Extrair e estender função `normalizar()` de `controle-rotacao-utils.js`
    - Aplicar NFD strip, uppercase, trim, remover sufixos comuns ("iasd", "central", "iasd central")
    - Exportar como ES module reutilizável
    - _Requirements: resolverPessoaPorNome (Design - Key Functions)_

  - [ ]* 1.3 Escrever testes unitários para `cadastro.js` e `normalizar.js`
    - Testar validação de IDs duplicados, aliases conflitantes, vínculos inválidos
    - Testar normalização com nomes reais da enquete (25+ casos)
    - **Property P2: IDs nunca reutilizados — `proximo_id` === max(ids) + 1**
    - **Property P8: Vínculos simétricos — se A→B então B→A**
    - **Validates: P2, P8**

- [x] 2. Script de migração one-shot
  - [x] 2.1 Implementar `scripts/migrar-cadastro.js`
    - Ler `processos/regras/cadastros/funcoes-louvor.json` + `contatos.json` + `regras.snapshot.json`
    - Atribuir IDs sequenciais (1, 2, 3...) em ordem alfabética do nome canônico
    - Merge telefone de `contatos.json` (via match por nome/alias, extrair somente dígitos)
    - Migrar RPs relevantes de `restricoes_pessoais` → campos `afastado`, `vinculos`, `dias_permitidos`, `perfil_canto`
    - Criar seção `grupos` (ex: `familia_silva` com membros JESSIE, JESSE, JOAS, JESSICA)
    - Criar seção `departamentos_contato` (ex: AVENTUREIROS → representante JESSIE)
    - Modelar vínculos `familia_requerida` apontando pro grupo em vez de IDs individuais
    - Gerar `pessoas.json` completo com schema documentado no design
    - Imprimir relatório de migração em stdout
    - _Requirements: Estratégia de migração (Design - Architecture), P2_

  - [x] 2.2 Implementar limpeza do `regras.snapshot.json`
    - Script ou seção em `migrar-cadastro.js` que remove a seção `restricoes_pessoais` inteira
    - Mantém `regras_fundamentais`, `preferencias`, `papeis`, `glossario`, `features_futuras`
    - Gerar arquivo limpo em caminho configurável (default: sobrescreve)
    - _Requirements: Estratégia de migração item 2 (Design - Architecture)_

  - [ ]* 2.3 Escrever testes para o migrador
    - Testar com subset dos dados reais (fixture)
    - Validar que IDs são sequenciais e em ordem alfabética
    - Validar que telefones são somente dígitos
    - Validar que vínculos simétricos foram criados (P8)
    - **Validates: P2, P8**

- [x] 3. Gerador de contatos derivado
  - [x] 3.1 Implementar `scripts/gerar-contatos.js`
    - Ler `pessoas.json` via `carregarPessoas()`
    - Gerar `contatos.json` no formato existente: `{ "NOME": { telefone: "https://wa.me/...", apelidos: [...] } }`
    - Incluir somente pessoas com telefone preenchido
    - Manter compatibilidade com frontend e `gerar-links-publicacao.js`
    - _Requirements: Componente 4 (Design - Components), P7_

  - [ ]* 3.2 Escrever teste de integração para `gerar-contatos.js`
    - Comparar output do gerador com `contatos.json` atual (após migração)
    - Ignorar diferença de ordenação de chaves
    - **Property P7: contatos.json derivado funcionalmente equivalente**
    - **Validates: P7**

- [x] 4. Checkpoint — Migração e retrocompatibilidade
  - Ensure all tests pass, ask the user if questions arise.
  - Executar migrador nos dados reais e validar que o `gerar-contatos.js` produz output equivalente ao `contatos.json` atual.

- [x] 5. Vinculador de indisponibilidade
  - [x] 5.1 Implementar fuzzy match (`scripts/lib/fuzzy-match.js`)
    - Implementar algoritmo de similaridade inline (Levenshtein ou dice-coefficient, sem dependência externa)
    - Exportar `resolverPessoaPorNome(texto, porNome, threshold?)` conforme contrato do design
    - Normalizar input antes de comparar
    - Retornar `{ pessoa, confianca }` ou null se abaixo do threshold (default 0.6)
    - Determinístico para mesmo input
    - _Requirements: resolverPessoaPorNome (Design - Key Functions)_

  - [x] 5.2 Implementar `scripts/vincular-indisponibilidade.js`
    - CLI com opções: `--mes`, `--input`, `--output`, `--threshold`, `--auto`, `--verbose`
    - Carregar pessoas.json via `carregarPessoas()`
    - Para cada nome da enquete: normalizar → match exato → fuzzy match → confirmar/rejeitar
    - Propagar indisponibilidade para casais (vínculos `sempre_junto` bidirecional)
    - Gerar JSON vinculado no schema documentado (com `mapeamentos_aplicados`, `propagacoes`, `datas`)
    - Exit codes: 0 (sucesso), 1 (erro fatal), 2 (incompleto)
    - _Requirements: Componente 2 (Design - Components), Contrato CLI (Design)_

  - [ ]* 5.3 Escrever testes para fuzzy match e vinculador
    - Testar fuzzy match com 25+ nomes reais do mapeamento atual da enquete
    - Testar propagação de casais (JESSIE↔JESSE, JESSICA↔JOAS, YASSER↔LIDIANE)
    - Testar exit codes para cenários de erro
    - **Validates: resolverPessoaPorNome postconditions**

- [x] 6. Solver — Filtros duros e score
  - [x] 6.1 Implementar filtros duros (`scripts/lib/solver-filtros.js`)
    - Implementar `pessoasAtivasParaSlot(slot, data, contexto)` conforme design
    - Filtros na ordem: ativo → afastado → habilitação → dias_permitidos → indisponibilidade data → indisponibilidade mês → escala externa → conflito mesmo culto
    - Slots válidos: 'regente', 'equipe', 'mm_es', 'mm_culto', 'mm_domingo'
    - _Requirements: pessoasAtivasParaSlot (Design - Key Functions), RF001-RF020, P4, P9_

  - [x] 6.2 Implementar cálculo de score (`scripts/lib/solver-score.js`)
    - Implementar `scoreCandidato(pessoa, slot, data, contexto)` conforme tabela de pesos
    - Componentes: contadorRotacao (w=1.0), penalConsecutivo (w=10.0), penalMesmoMes (w=20.0), bonusGrupoRegente (w=-0.5), penalPerfilParticipacao (w=5.0), penalRepeticaoRegente (w=15.0), diasDesdeUltima (w=-0.3)
    - Desempate: menor `pessoa.id` vence
    - _Requirements: scoreCandidato (Design - Key Functions), PE004-PE009_

  - [ ]* 6.3 Escrever property tests para filtros duros
    - **Property P4: Filtros duros nunca violados — nenhuma pessoa escalada viola qualquer filtro**
    - **Property P9: Afastamento implica exclusão — pessoa com afastado.ativo=true nunca retornada**
    - Usar fast-check para gerar cadastros e indisponibilidades arbitrárias
    - **Validates: P4, P9**

  - [ ]* 6.4 Escrever testes unitários para score
    - Testar cada componente do score isoladamente
    - Testar desempate por ID (determinismo)
    - Testar cenário onde PE007 (regente repetido no mês) aplica penalização
    - **Validates: P5 (determinismo)**

- [x] 7. Solver — Carregamento de histórico
  - [x] 7.1 Implementar carregamento de histórico (`scripts/lib/solver-historico.js`)
    - Implementar `carregarHistorico(pessoas, pathsOld, pathAtual, meses?)` conforme pseudocode
    - Janela de 4 meses configurável
    - Contadores: regencias, escalas_equipe, mm_es, mm_culto, mm_domingo, ultima_regencia, ultima_equipe, ultima_mm, datas_escalado
    - Resolver nomes do histórico para IDs via `porNome` (tolerante a grafias antigas)
    - _Requirements: carregarHistorico (Design - Algorithmic Pseudocode)_

  - [ ]* 7.2 Escrever testes para carregamento de histórico
    - Testar com fixture de dados do `old/` e `atual.json`
    - Validar contadores para nomes conhecidos
    - Testar resolução de nomes com grafias diversas
    - **Validates: P3 (sem regressão nos rankings)**

- [x] 8. Checkpoint — Módulos do solver testados
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Solver — Seleção por culto
  - [x] 9.1 Implementar `sugerirCulto` (`scripts/lib/solver-selecao.js`)
    - Fase 1: Selecionar regente (menor score)
    - Fase 2: Preencher equipe (5 membros) respeitando vínculos sempre_junto e familia_requerida
    - Fase 3: Preencher MM conforme dia (2 sábado / 1 domingo)
    - Registrar justificativa para cada escolha e exclusão
    - Validar RF001 (mín 1 homem na equipe) — emitir aviso se impossível
    - _Requirements: sugerirCulto (Design - Key Functions), RF001, RF012, RF013, RF014, RF019, RF020_

  - [x] 9.2 Implementar tratamento de vínculos na seleção
    - `sempre_junto`: inserir par obrigatório, excluir membro isolado se parceiro indisponível
    - `familia_requerida`: consultar grupo nomeado em `pessoas.grupos`, exigir ao menos 1 membro do grupo na equipe ou regente
    - Registrar exclusões com motivo na justificativa
    - Relaxar PEs automaticamente quando não há alternativa viável (cenário 6: PE007 etc.)
    - _Requirements: sugerirCulto (Design - Algorithmic Pseudocode), RP003-RP005, RP009, RP016, Error Handling cenário 6_

  - [ ]* 9.3 Escrever testes para sugerirCulto
    - Cenário: vínculo sempre_junto (JESSIE↔JESSE)
    - Cenário: familia_requerida (LUIZ DA SILVA precisa de familiar)
    - Cenário: equipe com mínimo 1 homem (RF001)
    - Cenário: MM dupla no sábado (RF012)
    - Cenário: pool insuficiente (aviso gerado)
    - **Property P1: Todo ID no output existe em pessoas.json**
    - **Validates: P1, P4**

- [x] 10. Solver — Orquestrador principal
  - [x] 10.1 Implementar `scripts/sugerir-rascunho.js`
    - CLI: `node scripts/sugerir-rascunho.js --mes=YYYY-MM [--pessoas=PATH] [--insumos=PATH]`
    - Carregar todos os insumos (pessoas, indisponibilidade vinculada, histórico, acionato, sonoplastia)
    - Extrair cultos do mês a partir de acionato
    - Processar em ordem cronológica: quartas → skip, departamentais → RF015, normais → sugerirCulto
    - Atualizar contexto acumulado entre cultos
    - _Requirements: sugerirRascunhoCompleto (Design - Algorithmic Pseudocode), RF005, RF015_

  - [x] 10.2 Implementar formatação de saída (`scripts/lib/solver-output.js`)
    - `formatarRascunhoMd(sugestoes)` → gera `rascunho.md` compatível com `validar-rascunho.js`
    - `gerarJustificativa(sugestoes, contexto)` → gera `rascunho-justificativa.md` conforme formato do design
    - Cada escolha rastreável (P6)
    - _Requirements: gerarJustificativa (Design - Key Functions), P6_

  - [ ]* 10.3 Escrever property tests para o solver completo
    - **Property P5: Determinismo — mesmo input produz mesmo output em N execuções**
    - **Property P1: Todo ID na saída existe em pessoas.json**
    - **Property P4: Filtros duros nunca violados na saída final**
    - Usar fast-check com inputs simplificados (mini-cadastro, 3-4 cultos)
    - **Validates: P1, P4, P5**

- [x] 11. Checkpoint — Solver completo
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Integração e wiring final
  - [x] 12.1 Adicionar `fast-check` como devDependency e configurar Jest para ESM
    - `npm install --save-dev fast-check` (versão pinada)
    - Verificar que `jest.config.js` suporta ESM (já configurado no projeto)
    - Criar helper de teste em `tests/helpers/pbt-setup.js` se necessário
    - _Requirements: Dependencies (Design)_

  - [x] 12.2 Atualizar `package.json` com scripts de CLI
    - Adicionar scripts: `migrar:cadastro`, `gerar:contatos`, `vincular:indisponibilidade`, `sugerir:rascunho`
    - Garantir que comandos usam paths relativos corretos
    - _Requirements: Fluxo do ciclo mensal (Design - Architecture)_

  - [x] 12.3 Adaptar `controle-rotacao-utils.js` para ler `pessoas.json`
    - Importar `carregarPessoas` de `scripts/lib/cadastro.js` como alternativa
    - Manter fallback para `funcoes-louvor.json` durante transição
    - Garantir que scripts de controle existentes continuam funcionando
    - _Requirements: Retrocompatibilidade (Design - Architecture item 5)_

  - [ ]* 12.4 Escrever teste de integração end-to-end do solver
    - Executar solver com insumos reais de julho/2026
    - Validar que rascunho gerado passa no `validar-rascunho.js`
    - Validar que justificativa contém entrada para cada nome do rascunho (P6)
    - **Property P6: Toda escolha rastreável na justificativa**
    - **Validates: P6**

- [x] 13. Checkpoint final
  - Ensure all tests pass, ask the user if questions arise.
  - Validar execução completa: migração → geração de contatos → vinculação → solver → validação

## Notes

- Tasks marcadas com `*` são opcionais (testes) e podem ser puladas para MVP mais rápido
- Cada task referencia propriedades de corretude (P1-P9) do design quando aplicável
- Checkpoints garantem validação incremental
- O solver é determinístico — property tests verificam reprodutibilidade
- Zero dependências externas em runtime (fast-check é devDependency somente)
- `pessoas.json` é gerado uma única vez pelo migrador e depois mantido manualmente

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "12.1"] },
    { "id": 1, "tasks": ["1.3", "2.1", "5.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.1", "5.2"] },
    { "id": 3, "tasks": ["3.2", "5.3", "6.1", "6.2", "7.1"] },
    { "id": 4, "tasks": ["6.3", "6.4", "7.2"] },
    { "id": 5, "tasks": ["9.1", "9.2"] },
    { "id": 6, "tasks": ["9.3", "10.1"] },
    { "id": 7, "tasks": ["10.2", "12.2", "12.3"] },
    { "id": 8, "tasks": ["10.3", "12.4"] }
  ]
}
```
