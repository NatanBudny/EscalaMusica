# Plano de Implementação: Gestão Leiga de Escalas

## Visão geral

A implementação será incremental em TypeScript, React e Rust, mantendo o visualizador e o processo atual como caminho oficial até a homologação. Cada incremento deve produzir código integrado, validação automatizada e evidência objetiva. Nenhuma tarefa autoriza substituir `atual.json`, `contatos.json`, o workflow atual do Pages ou os scripts legados antes dos checkpoints de equivalência, restauração e treinamento.

## Tarefas

- [x] 1. Estabelecer inventário, baseline e estrutura isolada da nova aplicação
  - [x] 1.1 Implementar o inventário reproduzível do legado e o manifesto de transição
    - Criar um utilitário somente de leitura que catalogue `atual.json`, `contatos.json`, `pessoas.json`, `old/**`, `escalas/**`, fontes de regras, controles, scripts e workflow do Pages, registrando caminho, tipo, tamanho e SHA-256.
    - Registrar formatos encontrados, divergências conhecidas e classificação público/privado sem alterar os arquivos inventariados.
    - **Validação objetiva:** duas execuções sobre a mesma árvore produzem o mesmo manifesto canônico; `git diff` confirma que nenhum arquivo legado foi modificado.
    - _Requisitos: 9.4, 9.5, 16.5, 16.6, 16.8_

  - [x] 1.2 Criar testes de baseline do visualizador e dos contratos legados
    - Congelar fixtures representativas e testar carregamento de `atual.json`/`contatos.json`, tabela, cartões, filtros, agenda, contatos, cache e login Google sem mudar o comportamento atual.
    - **Validação objetiva:** a suíte passa contra a versão anterior ao scaffold e gera relatório de baseline versionado sem publicar artefatos.
    - _Requisitos: 9.1, 9.2, 9.3, 11.13, 16.1, 16.8_

  - [x] 1.3 Criar o scaffold isolado Tauri 2 + React/TypeScript + núcleo Rust
    - Adicionar a aplicação desktop em diretório próprio, com workspace Rust, frontend React, IPC tipado, lint, formatação e scripts de build/teste de execução única.
    - Restringir capabilities Tauri à superfície inicial mínima e impedir shell, caminhos arbitrários e acesso direto aos arquivos públicos vigentes.
    - **Validação objetiva:** builds de desenvolvimento do frontend e do núcleo concluem; teste smoke invoca um comando tipado sem acessar nem alterar o legado.
    - _Requisitos: 1.1, 1.2, 1.3, 1.7, 1.9, 16.1, 16.2_

  - [x] 1.4 Implementar configuração operacional versionada e feature gate de transição
    - Modelar mínimos de SO, destinos Git/Pages, branches, classificação de campos, retenção, offline, formatos e estado de homologação.
    - Manter publicação real e escrita nos arquivos vigentes desabilitadas por padrão até o registro de homologação válido.
    - **Validação objetiva:** configuração ausente ou não homologada bloqueia o corte e informa em português que o fluxo atual continua oficial.
    - _Requisitos: 10.4, 11.1, 13.9, 16.3, 16.7, 16.8, 16.11, 16.12_

- [x] 2. Criar schemas, modelos canônicos e fundação do domínio puro
  - [x] 2.1 Implementar schemas versionados e modelos canônicos
    - Definir tipos e JSON Schemas para cadastro, regras, ciclos, cultos, insumos, indisponibilidades, rascunhos, validações, prévias, aprovações, publicações, auditoria, backups e migração.
    - Usar UUIDs, datas ISO, instantes UTC, revisão por hash e classificação obrigatória de campos.
    - **Validação objetiva:** fixtures válidas passam e fixtures com referência quebrada, versão desconhecida, cardinalidade ou formato inválido falham sem mutação.
    - _Requisitos: 2.8, 3.1–3.5, 4.1–4.9, 6.1, 8.7, 10.10, 11.1, 13.3_

  - [x] 2.2 Implementar serialização JSON canônica, hashing e escrita por staging
    - Garantir UTF-8, LF, chaves ordenadas, ordenação apenas de coleções sem semântica, SHA-256 e troca atômica após validação.
    - **Validação objetiva:** entradas semanticamente equivalentes produzem os mesmos bytes e falha injetada antes da troca preserva o snapshot anterior.
    - _Requisitos: 9.8, 9.10, 12.1, 12.3, 12.11_

  - [x] 2.3 Implementar comandos puros, revisões, eventos de domínio e auditoria sanitizada
    - Criar envelopes idempotentes, resultados tipados, mensagens `AppError` em português, diff real e invalidadores de derivados quando a revisão muda.
    - **Validação objetiva:** repetir `operationId` não duplica efeitos; cada alteração aceita gera uma revisão e evento correspondentes; segredos são rejeitados pelo schema de auditoria.
    - _Requisitos: 1.6–1.8, 3.10, 4.17, 6.4, 8.8, 11.11, 12.12_

  - [x] 2.4 Escrever teste baseado em propriedade para normalização de nomes
    - **Property 6: Normalização de nomes é idempotente e não destrutiva**
    - Executar no mínimo 100 casos e registrar seed/replayPath em falhas.
    - **Valida: Requisito 3.6**

  - [x] 2.5 Escrever teste baseado em propriedade para unicidade global de identidade
    - **Property 7: Namespace de identidade é globalmente único**
    - **Valida: Requisito 3.7**

  - [x] 2.6 Escrever teste baseado em propriedade para invariantes dos agregados
    - **Property 8: Agregados de pessoa e departamento preservam invariantes**
    - **Valida: Requisitos 3.1–3.5, 3.8, 3.14, 3.15**

  - [x] 2.7 Escrever teste baseado em propriedade para auditoria por diff
    - **Property 10: Toda alteração de domínio é auditada pelo diff real**
    - **Valida: Requisitos 3.10, 4.17, 6.4, 8.7, 10.10, 11.11, 14.4, 14.7, 14.11**

  - [x] 2.8 Criar suíte de testes unitários do domínio puro
    - Cobrir calendário, normalização, limites de texto/cardinalidade, telefone, predicados, diff, formatadores e mensagens de erro com exemplos e bordas definidos no desenho.
    - **Validação objetiva:** casos 0/1/9999/10000, mês 0/1/12/13, bissexto, 1/500/501, 1/1000/1001, 20/21, 50/51 e 1000/1001 produzem o resultado esperado sem I/O.
    - _Requisitos: 2.3, 2.9, 2.10, 3.1–3.8, 3.14, 3.15, 6.5, 6.8, 7.3_

- [x] 3. Implementar cadastro, grades e controle do ciclo mensal
  - [x] 3.1 Implementar `RegistryService` para pessoas, departamentos e autorizações públicas
    - Cobrir nomes, aliases, E.164, estados, habilitações, dias, afastamentos, vínculos, desativação, proteção de referências e autorização por valor/finalidade/vigência.
    - **Validação objetiva:** limites 20/21, 50/51 e 1000/1001, telefone de 8/15 dígitos e referências inválidas retornam erros específicos e preservam o agregado.
    - _Requisitos: 3.1–3.15, 11.4, 11.15, 11.16_

  - [x] 3.2 Implementar grades e formulários de cadastro acessíveis
    - Criar busca por nome/alias, edição por teclado, colagem confirmada, erros inline e painéis de pessoa/departamento sem aceitar JSON livre.
    - **Validação objetiva:** testes de componente comprovam foco, edição, cancelamento, conflito de nome e preservação após erro.
    - _Requisitos: 1.1, 1.7, 1.8, 3.1–3.15_

  - [x] 3.3 Implementar `CycleService` e o assistente das sete etapas
    - Gerar quartas, sábados e domingos pelo calendário gregoriano; suportar culto extraordinário, remoção motivada, estado exclusivo, etapa atual, pendências e conclusão auditada.
    - **Validação objetiva:** casos de borda de ano/mês e fevereiro bissexto passam; reabrir o período não cria nem altera ciclo; avanço sem pré-condição fica bloqueado.
    - _Requisitos: 1.4–1.6, 2.1–2.10_

  - [x] 3.4 Escrever teste baseado em propriedade para ordem e pendências do ciclo
    - **Property 1: Ordem e pendências do ciclo são derivadas do estado**
    - **Valida: Requisitos 1.4, 1.5, 1.6**

  - [x] 3.5 Escrever teste baseado em propriedade para abertura idempotente
    - **Property 2: Abertura mensal é única e idempotente**
    - **Valida: Requisitos 2.1, 2.2**

  - [x] 3.6 Escrever teste baseado em propriedade para calendário mensal
    - **Property 3: Calendário mensal é completo e correto**
    - **Valida: Requisitos 2.3, 2.6**

  - [x] 3.7 Escrever teste baseado em propriedade para alterações atômicas do calendário
    - **Property 4: Alterações do calendário são atômicas**
    - **Valida: Requisitos 2.4, 2.5, 2.7, 2.10**

  - [x] 3.8 Escrever teste baseado em propriedade para estado exclusivo
    - **Property 5: Estado do ciclo é exclusivo**
    - **Valida: Requisito 2.8**

  - [x] 3.9 Escrever teste baseado em propriedade para desativação
    - **Property 9: Desativação preserva o passado e restringe o futuro**
    - **Valida: Requisitos 3.9, 3.13**

- [x] 4. Implementar coleta, conferência e indisponibilidades
  - [x] 4.1 Implementar entrada manual de insumos externos e conferência de PDF
    - Criar grades para ancião, pregador, sonoplastia, músicas, tema, pedidos e observações; o PDF é somente referência externa e toda entrada mostra resumo antes da confirmação.
    - **Validação objetiva:** cardinalidades e comprimentos de borda são verificados; observação sem classificação e insumo sem proveniência não são salvos.
    - _Requisitos: 4.1–4.8, 4.15, 4.18–4.20_

  - [x] 4.2 Implementar indisponibilidades e propagação rastreável
    - Suportar datas, intervalo e mês inteiro; derivar efeitos por vínculos com origem/caminho e alcançar cultos extraordinários adicionados depois.
    - **Validação objetiva:** intervalo invertido e data externa ao ciclo preservam o estado; a matriz pessoa × data exibe exatamente os efeitos diretos e propagados.
    - _Requisitos: 4.9–4.11, 4.16, 4.17_

  - [x] 4.3 Implementar pipeline de importação pendente e atômica
    - Validar o lote inteiro, nunca resolver identidade ambígua por fuzzy match e produzir classificação e totais por item.
    - **Validação objetiva:** um único registro inválido impede qualquer gravação; nomes com zero ou várias correspondências permanecem pendentes até decisão explícita.
    - _Requisitos: 4.12–4.14, 9.5–9.7, 9.13, 9.14_

  - [x] 4.4 Escrever teste baseado em propriedade para insumos
    - **Property 11: Insumos respeitam tipos, limites e proveniência**
    - **Valida: Requisitos 4.2–4.8**

  - [x] 4.5 Escrever teste baseado em propriedade para indisponibilidade efetiva
    - **Property 12: Indisponibilidade efetiva é rastreável**
    - **Valida: Requisitos 4.9–4.11**

  - [x] 4.6 Escrever teste baseado em propriedade para identidade importada
    - **Property 13: Importação nunca resolve identidade ambígua**
    - **Valida: Requisitos 4.12, 4.13, 9.14**

  - [x] 4.7 Escrever teste baseado em propriedade para partição dos relatórios
    - **Property 14: Relatórios de importação formam uma partição completa**
    - **Valida: Requisitos 4.14, 9.13, 16.5**

  - [x] 4.8 Escrever teste baseado em propriedade para atomicidade de lotes
    - **Property 15: Lotes inválidos são atômicos**
    - **Valida: Requisitos 9.5–9.7**

- [x] 5. Consolidar e versionar a fonte única de regras
  - [x] 5.1 Implementar DSL declarativa limitada e `RuleSetService`
    - Modelar regras fundamentais, preferências, vigência, tipos de vínculo, campos obrigatórios, responsabilidades departamentais e exceções permitidas sem executar código arbitrário.
    - **Validação objetiva:** referência ausente, predicado inválido, versão sem aprovação e exceção fora da vigência são rejeitados sem alterar a versão ativa.
    - _Requisitos: 6.1–6.13, 6.15, 6.16_

  - [x] 5.2 Implementar consolidação versionada das fontes legadas
    - Comparar cada regra de todas as fontes inventariadas, criar item de decisão por divergência e gerar `RuleSet v1` somente com zero pendências e aprovação registrada.
    - **Validação objetiva:** relatório liga cada regra à origem e decisão; nenhuma precedência silenciosa é possível; o ciclo fixa uma versão imutável.
    - _Requisitos: 6.13–6.15, 16.5, 16.7, 16.11_

  - [x] 5.3 Escrever teste baseado em propriedade para versões vinculadas
    - **Property 22: Versões de regras são imutáveis e vinculadas**
    - **Valida: Requisitos 6.1–6.3, 6.10–6.12, 6.15**

  - [x] 5.4 Escrever teste baseado em propriedade para vigência inclusiva
    - **Property 23: Aplicabilidade temporal é inclusiva**
    - **Valida: Requisitos 6.5, 6.8**

  - [x] 5.5 Escrever teste baseado em propriedade para contradições
    - **Property 24: Conjuntos de regras contraditórios não são ativados**
    - **Valida: Requisito 6.6**

- [x] 6. Implementar montagem manual e sugestão determinística completa
  - [x] 6.1 Implementar grade de montagem e elegibilidade manual
    - Permitir incluir, substituir e remover atribuições; mostrar habilitação, disponibilidade, conflitos, histórico e responsabilidade departamental por célula.
    - Exigir justificativa para preferência e bloquear regra fundamental sem exceção vigente.
    - **Validação objetiva:** toda atribuição aceita usa sujeito elegível; rejeições preservam a revisão anterior; ignorar sugestão não altera rascunho/cadastro.
    - _Requisitos: 5.1–5.6, 5.9–5.12_

  - [x] 6.2 Implementar `SuggestionEngine` puro e determinístico
    - Separar elegibilidade bloqueante de score inteiro, ordenar por função/data/ID, executar backtracking limitado e produzir sugestão completa editável com traço e slots não preenchidos.
    - **Validação objetiva:** hashes de entrada iguais geram bytes e ordem iguais em execuções repetidas; nenhuma atribuição fundamentalmente inválida é produzida.
    - _Requisitos: 5.7–5.9, 5.13–5.15_

  - [x] 6.3 Escrever teste baseado em propriedade para elegibilidade
    - **Property 16: Elegibilidade manual corresponde às regras**
    - **Valida: Requisitos 5.2–5.4, 7.13, 7.15, 7.16**

  - [x] 6.4 Escrever teste baseado em propriedade para ignorar sugestão
    - **Property 17: Ignorar sugestão é identidade**
    - **Valida: Requisito 5.6**

  - [x] 6.5 Escrever teste baseado em propriedade para determinismo e explicação
    - **Property 18: Sugestão é determinística e explicável**
    - **Valida: Requisitos 5.7–5.9**

  - [x] 6.6 Escrever teste baseado em propriedade para segurança da sugestão
    - **Property 19: Sugestão nunca viola regra fundamental**
    - **Valida: Requisitos 5.11, 5.13, 5.15**

  - [x] 6.7 Escrever teste baseado em propriedade para override de preferência
    - **Property 20: Override de preferência exige justificativa**
    - **Valida: Requisito 5.10**

  - [x] 6.8 Escrever teste baseado em propriedade para responsabilidade departamental
    - **Property 21: Responsabilidade departamental é aplicada integralmente**
    - **Valida: Requisitos 5.12, 7.19**

- [x] 7. Checkpoint — garantir que o legado continua oficial e todos os testes do domínio passam
  - Garantir que todos os testes passam, perguntar ao usuário se surgirem dúvidas.
  - Confirmar por hash e `git diff` que `atual.json`, `contatos.json`, scripts e workflow atual não foram substituídos; manter o feature gate fechado.

- [x] 8. Implementar validação incremental e completa
  - [x] 8.1 Implementar `ValidationEngine` puro e catálogo completo de achados
    - Avaliar regras por dependência e em lote; produzir bloqueios, avisos, aprovações, revisão, rule set, motivo, referência segura e ação necessária.
    - Cobrir duplicidade, identidade, equipes, quartas, sábados, externos, indisponibilidade, incompatibilidade, sequência, limites, departamento, privacidade e contato.
    - **Validação objetiva:** validação incremental e completa resultam no mesmo conjunto; falha inconclusiva vira bloqueio e nenhuma entrada é modificada.
    - _Requisitos: 4.15, 7.1–7.25, 12.4, 12.13, 14.5_

  - [x] 8.2 Integrar achados à grade e ao gate de publicação
    - Destacar células, navegar ao campo, mostrar totais e manter publicação desabilitada até validação completa da revisão atual.
    - **Validação objetiva:** alterar campo invalida resultados derivados; zero bloqueios habilita apenas a próxima etapa, nunca publicação direta.
    - _Requisitos: 1.5, 7.3, 7.23, 7.24, 8.1_

  - [x] 8.3 Escrever teste baseado em propriedade para equivalência incremental
    - **Property 25: Validação incremental equivale à validação completa**
    - **Valida: Requisitos 7.1, 14.5**

  - [x] 8.4 Escrever teste baseado em propriedade para pureza e classificação
    - **Property 26: Validação é completa, pura e corretamente classificada**
    - **Valida: Requisitos 7.2–7.5, 7.25, 12.13**

  - [x] 8.5 Escrever teste baseado em propriedade para regras estruturais
    - **Property 27: Regras estruturais produzem exatamente seus achados**
    - **Valida: Requisitos 7.6–7.18**

  - [x] 8.6 Escrever teste baseado em propriedade para o gate de publicação
    - **Property 28: Gate de publicação depende da revisão atual**
    - **Valida: Requisitos 7.23, 8.1, 8.6, 8.8–8.10, 14.8**

  - [x] 8.7 Escrever teste baseado em propriedade para consistência do relatório
    - **Property 29: Relatório de validação é consistente**
    - **Valida: Requisito 7.24**

- [x] 9. Implementar projeção pública e exportação compatível
  - [x] 9.1 Implementar `PublicProjection` por allowlist e autorizações
    - Construir DTO público sem campos privados, aplicar autorizações de nome/alias/telefone e scanner de segredos antes da serialização.
    - **Validação objetiva:** sentinelas privadas injetadas em todas as categorias não aparecem na prévia, pacote, logs ou erros; telefone sem autorização gera bloqueio.
    - _Requisitos: 3.11, 3.12, 7.20, 9.11, 11.1–11.5, 11.15, 11.16, 13.8_

  - [x] 9.2 Implementar `LegacyExporter` para `atual.json` e `contatos.json`
    - Preservar chaves, tipos, datas, delimitadores, ordem e forma `wa.me` exigidos pelo visualizador; rejeitar delimitadores ambíguos.
    - **Validação objetiva:** fixtures atuais e históricas passam nos schemas e o visualizador baseline carrega o artefato sem servidor de aplicação.
    - _Requisitos: 9.1–9.3, 9.8–9.10, 10.7, 10.16, 16.1, 16.2_

  - [x] 9.3 Implementar formatos portáveis e importação de round-trip
    - Exportar cadastro, regras, ciclos, escalas, insumos e auditoria em formatos documentados e reimportáveis.
    - **Validação objetiva:** exportar/importar/exportar sem edição preserva entidades e bytes, salvo metadados variáveis declarados.
    - _Requisitos: 9.9, 9.10, 16.4_

  - [x] 9.4 Escrever teste baseado em propriedade para não interferência privada
    - **Property 30: Projeção pública não sofre interferência de dados privados**
    - **Valida: Requisitos 3.12, 7.20, 8.3, 9.11, 10.21, 11.1–11.3, 11.5, 11.7, 13.8, 15.12**

  - [x] 9.5 Escrever teste baseado em propriedade para contatos autorizados
    - **Property 31: Contatos públicos correspondem exatamente às autorizações vigentes**
    - **Valida: Requisitos 3.11, 10.7, 11.4, 11.15, 11.16**

  - [x] 9.6 Escrever teste baseado em propriedade para serialização legada
    - **Property 33: Serialização legada é canônica**
    - **Valida: Requisitos 9.1, 9.2, 9.8, 10.16**

  - [x] 9.7 Escrever teste baseado em propriedade para round-trip dos formatos
    - **Property 34: Formatos suportados preservam round-trip**
    - **Valida: Requisitos 9.9, 9.10, 16.4**

  - [x] 9.8 Criar testes de contrato e compatibilidade E2E do visualizador
    - Validar schemas de `atual.json`/`contatos.json` e abrir o artefato com Playwright para tabela, cartões, filtro, agenda, contatos, cache e login Google em homologação.
    - **Validação objetiva:** pacote candidato satisfaz todos os contratos e a suíte não grava nem publica sobre o site vigente.
    - _Requisitos: 9.1–9.3, 11.13, 16.1, 16.8, 16.9_

- [x] 10. Implementar prévia, aprovação e manutenção pós-publicação
  - [x] 10.1 Implementar `PreviewService` e diff público reversível
    - Gerar prévia identificada da revisão validada, excluir privados e comparar inclusão, alteração e remoção contra a vigente sem tocá-la.
    - **Validação objetiva:** aplicar diff e inverso reproduz candidata e vigente; revisão alterada invalida prévia e aprovação.
    - _Requisitos: 8.1–8.5, 8.8–8.10, 14.6_

  - [x] 10.2 Implementar `ApprovalService` e ciência individual de avisos
    - Registrar aprovador, versões, data/hora e avisos reconhecidos; impedir aprovação incompleta ou de período/revisão divergente.
    - **Validação objetiva:** casos com zero, um e vários avisos passam somente quando todas as condições estão atendidas.
    - _Requisitos: 8.6–8.11_

  - [x] 10.3 Implementar revisões pós-publicação
    - Criar cópia editável para troca, cancelamento e correção pública com motivo/auditoria; regenerar somente links afetados e recalcular rotação da escala resultante após confirmação.
    - **Validação objetiva:** todas as ações anteriores à confirmação preservam o hash da vigente; falha de publicação preserva vigente, revisão e backup.
    - _Requisitos: 14.1–14.13_

  - [x] 10.4 Escrever teste baseado em propriedade para diff da prévia
    - **Property 32: Diff da prévia é completo e reversível**
    - **Valida: Requisitos 8.2, 8.4, 14.6, 16.9**

  - [x] 10.5 Escrever teste baseado em propriedade para isolamento pós-publicação
    - **Property 45: Revisão pós-publicação não modifica a vigente antes da confirmação**
    - **Valida: Requisitos 14.1–14.3, 14.9**

- [x] 11. Implementar persistência, backup, Git privado, autenticação, cofre e sincronização
  - [x] 11.1 Implementar workspace local, journal, recuperação de crash e desfazer
    - Manter clones, pendências, cache e recovery em diretório interno; recuperar último snapshot confirmado e desfazer somente alterações elegíveis.
    - **Validação objetiva:** falhas injetadas em cada marco não promovem staging parcial; reinício recupera o último estado confirmado; desfazer restaura o hash anterior.
    - _Requisitos: 12.1–12.3, 12.11, 13.16_

  - [x] 11.2 Implementar `BackupService` seguro e política de retenção
    - Criar manifesto/checksums, ZIP protegido contra travessia e bombas, inspeção antes de restaurar, compensação em falha e preservação de backups oficiais.
    - **Validação objetiva:** byte alterado, arquivo ausente/extra e versão futura são rejeitados; round-trip restaura as categorias e metadados exatos.
    - _Requisitos: 10.3, 12.7–12.10, 13.1–13.12, 16.6, 16.10_

  - [x] 11.3 Implementar `CredentialService` no cofre de Windows/macOS e autenticação GitHub
    - Usar fluxo de dispositivo e adaptadores do Credential Manager/Keychain; não enviar token pela IPC; remover e renovar acesso com memória sanitizada.
    - **Validação objetiva:** token nunca aparece em UI, clipboard, URL, log, auditoria, backup ou pacote; credencial removida/expirada bloqueia push e preserva trabalho.
    - _Requisitos: 10.18–10.20, 11.6–11.12_

  - [x] 11.4 Implementar `GitWorkspaceService` sem shell para o repositório privado
    - Suportar clone/fetch/status/commit/push fast-forward, destinos/branches aprovados, mensagens identificadas e commits por alteração persistente.
    - **Validação objetiva:** tentativa contra outro repositório/branch e non-fast-forward é bloqueada; nenhum force-push ou comando shell é emitido.
    - _Requisitos: 1.2, 10.4, 10.18, 10.20, 13.13–13.16_

  - [x] 11.5 Implementar modo offline e conciliação guiada entre máquinas
    - Enfileirar comandos com `baseCommit`; combinar mudanças disjuntas e exigir escolha explícita para mesmo campo, exclusão/alteração, regras, aprovação e publicação.
    - **Validação objetiva:** harness com máquinas A/B comprova retomada, fila offline, conflito sem sobrescrita automática e resultado conforme escolhas.
    - _Requisitos: 1.10, 12.3, 13.13–13.16_

  - [x] 11.6 Escrever teste baseado em propriedade para segredo fora das saídas
    - **Property 38: Segredos permanecem fora de saídas**
    - **Valida: Requisitos 11.7, 11.8, 11.11**

  - [x] 11.7 Escrever teste baseado em propriedade para desfazer
    - **Property 40: Desfazer restaura exatamente a revisão anterior**
    - **Valida: Requisito 12.2**

  - [x] 11.8 Escrever teste baseado em propriedade para integridade de backup
    - **Property 41: Backup detecta qualquer alteração de conteúdo**
    - **Valida: Requisitos 13.3, 13.4, 13.7**

  - [x] 11.9 Escrever teste baseado em propriedade para round-trip de backup
    - **Property 42: Backup faz round-trip do estado coberto**
    - **Valida: Requisitos 13.1, 13.2, 13.5, 13.6, 13.11**

  - [x] 11.10 Escrever teste baseado em propriedade para retenção
    - **Property 43: Retenção nunca elimina publicação oficial**
    - **Valida: Requisitos 13.9, 13.10**

  - [x] 11.11 Escrever teste baseado em propriedade para divergência Git
    - **Property 44: Divergência Git nunca causa sobrescrita automática**
    - **Valida: Requisito 13.15**

  - [x] 11.12 Criar testes de integração Rust para filesystem, Git, HTTP e cofres
    - Usar temporários, remotos bare, servidor HTTP simulado e adaptadores fake/real na matriz de SO.
    - **Validação objetiva:** cobrir crash antes/depois de commit/push, conflito A/B, token expirado/cancelado/removido e escrita atômica.
    - _Requisitos: 10.4, 11.6–11.12, 12.1–12.12, 13.14–13.16_

- [x] 12. Implementar publicação recuperável e verificação do GitHub Pages
  - [x] 12.1 Implementar `PublicationOrchestrator` como saga idempotente
    - Encadear sincronização privada, backup público, pacote imutável, commit/push público, estado Pages, verificação HTTP e confirmação; persistir cada transição.
    - **Validação objetiva:** falha injetada em cada transição resulta em `incomplete`/`failed`, preserva artefatos declarados e permite retomar pelo mesmo `publicationId`.
    - _Requisitos: 10.2–10.5, 10.8–10.15, 10.18–10.22, 12.5–12.7_

  - [x] 12.2 Implementar pacote público allowlist e commit exato no repositório público
    - Incluir somente arquivos e remoções do manifesto aprovado; bloquear destinos divergentes e manter repositórios físico/logicamente separados.
    - **Validação objetiva:** diff da árvore pública corresponde exatamente ao manifesto e nenhuma categoria privada é alcançável.
    - _Requisitos: 9.11, 10.4, 10.5, 10.16, 10.19–10.21, 11.2, 11.3_

  - [x] 12.3 Implementar verificação definitiva do Site Público e rollback compensatório
    - Consultar Pages e depois comparar por HTTP com cache-busting, limites e host aprovado; exigir presença/hash e ausência de removidos; restaurar por novo commit.
    - **Validação objetiva:** sucesso do workflow sem igualdade não confirma; falhas preservam backup; rollback restaura e verifica conteúdo sem force-push.
    - _Requisitos: 10.11–10.17, 10.22, 12.7–12.10, 14.9–14.11_

  - [x] 12.4 Implementar exportação guiada como contingência
    - Gerar ZIP público e `INSTRUCOES.html` em português, com destino, arquivos, ações e evidências; usar a mesma verificação do Site Público.
    - **Validação objetiva:** o pacote não contém privados/credenciais e não pode ser confirmado antes da comparação pública integral.
    - _Requisitos: 10.1, 10.6, 10.17, 10.23_

  - [x] 12.5 Implementar fechamento idempotente
    - Após confirmação pública, atualizar ciclo, links de WhatsApp, histórico/rotação derivados e backup oficial exatamente uma vez, sem apagar insumos.
    - **Validação objetiva:** repetir a confirmação do mesmo pacote não duplica publicação, links, rotação ou backup oficial.
    - _Requisitos: 2.8, 10.8–10.10, 10.15, 13.2, 14.12, 14.13_

  - [x] 12.6 Escrever teste baseado em propriedade para commit público
    - **Property 35: Commit público corresponde exatamente ao pacote**
    - **Valida: Requisitos 10.2, 10.4, 10.5, 10.19**

  - [x] 12.7 Escrever teste baseado em propriedade para confirmação pública
    - **Property 36: Confirmação pública exige igualdade integral**
    - **Valida: Requisitos 10.12–10.14, 10.17, 10.22**

  - [x] 12.8 Escrever teste baseado em propriedade para efeitos idempotentes
    - **Property 37: Efeitos de confirmação são idempotentes**
    - **Valida: Requisitos 10.8, 10.9, 10.15, 14.12, 14.13**

  - [x] 12.9 Escrever teste baseado em propriedade para preservação sob falhas
    - **Property 39: Falhas preservam os estados declarados**
    - **Valida: Requisitos 12.4–12.7, 12.10–12.12, 14.10**

  - [x] 12.10 Criar teste de integração em repositórios GitHub/Pages de homologação
    - Cobrir autenticação, push privado/público, processamento, igualdade, divergência, nova verificação e rollback sem apontar para produção.
    - **Validação objetiva:** todos os estados observados correspondem à saga e o destino de produção permanece intocado.
    - _Requisitos: 10.1–10.23, 12.6, 12.7_

- [x] 13. Checkpoint — provar equivalência e restauração antes de qualquer corte
  - Garantir que todos os testes passam, perguntar ao usuário se surgirem dúvidas.
  - Exigir contratos legados, E2E do visualizador, publicação em homologação e rollback público/privado aprovados; manter o fluxo atual e feature gate de produção inalterados.

- [x] 14. Implementar migração, comparação e homologação controlada
  - [x] 14.1 Implementar `MigrationService` a partir do inventário e backup de transição
    - Importar cadastro, separar departamentos, normalizar telefones com pendência, preservar histórico/texto original e impedir gravação parcial por formato.
    - **Validação objetiva:** relatório apresenta cada origem e partição de resultados; backup verificado existe antes de qualquer dado novo; legado permanece sem alteração.
    - _Requisitos: 9.4–9.7, 9.13, 9.14, 16.5–16.8_

  - [x] 14.2 Implementar comparação de homologação campo a campo
    - Comparar todos os cultos/campos/valores públicos do pacote candidato com os dados consumidos pelo visualizador, distinguindo equivalência semântica de divergência.
    - **Validação objetiva:** cada campo recebe resultado rastreável; qualquer divergência, rejeitado ou pendente bloqueia homologação.
    - _Requisitos: 16.7–16.9, 16.11, 16.12_

  - [x] 14.3 Implementar ensaio de restauração e rollback de transição
    - Restaurar em instalação limpa o backup privado e o backup público por commits compensatórios, verificar integridade e preservar separadamente dados da nova operação se houver cancelamento.
    - **Validação objetiva:** hashes e categorias restaurados equivalem ao estado pré-transição; falha no ensaio mantém gate fechado.
    - _Requisitos: 12.8–12.10, 13.11, 13.12, 16.10–16.12_

  - [x] 14.4 Implementar registro e feature gate de homologação
    - Permitir confirmação somente com zero rejeitados, pendentes e divergências, restauração aprovada e referência ao backup de transição.
    - **Validação objetiva:** tabela-verdade completa aceita somente a combinação exigida; confirmação registra data, responsável, comparação e backup.
    - _Requisitos: 16.7, 16.8, 16.11, 16.12_

  - [x] 14.5 Escrever teste baseado em propriedade para gates de homologação
    - **Property 47: Gates de homologação são necessários e suficientes**
    - **Valida: Requisitos 16.7, 16.11, 16.12**

  - [x] 14.6 Criar golden tests da migração real
    - Congelar aliases conflitantes, pessoas/departamentos misturados, formatos legados, indisponibilidades incompatíveis e divergências de regras.
    - **Validação objetiva:** relatório golden identifica cada transformação/pendência conhecida e nenhuma fixture escreve no site atual.
    - _Requisitos: 6.14, 9.4, 9.13, 16.5–16.9_

- [x] 15. Implementar segurança, privacidade e endurecimento operacional
  - [x] 15.1 Restringir capabilities, caminhos, URLs e conteúdo não confiável
    - Aplicar allowlists de IPC/filesystem/rede, limites HTTP/ZIP, bloqueio de redirect de host, colagem sem fórmulas/HTML e DSL sem código.
    - **Validação objetiva:** testes negativos de path traversal, symlink, zip bomb, host divergente, arquivo excessivo e comando não autorizado falham sem mutação.
    - _Requisitos: 1.7, 9.5–9.7, 10.4, 11.2, 11.3, 12.11_

  - [x] 15.2 Implementar scanner de segredos, redator central e verificação de dependências
    - Inspecionar pacote, logs, auditoria e backups; falhar CI/release diante de segredo ou campo privado proibido.
    - **Validação objetiva:** corpus com tokens, URLs autenticadas, telefones e notas privadas é detectado/redigido sem ecoar o valor.
    - _Requisitos: 7.20, 11.2, 11.3, 11.5, 11.7, 11.11_

  - [x] 15.3 Criar suíte automatizada de segurança e privacidade
    - Cobrir capabilities Tauri, permissões GitHub, repositório/branch não autorizados, remoção de acesso, pacote público e dependências.
    - **Validação objetiva:** relatório comprova menor privilégio e ausência de dados privados/segredos nos artefatos públicos.
    - _Requisitos: 10.4, 11.1–11.16, 13.8_

- [x] 16. Implementar experiência completa, ajuda e modo de treinamento
  - [x] 16.1 Integrar o `CycleWizard` às sete etapas e aos serviços concluídos
    - Exibir etapa, pendências, ajuda contextual, estado online/offline, sincronização, validação, aprovação, publicação e fechamento em português.
    - **Validação objetiva:** o ciclo completo pode ser operado somente pelos controles da aplicação, sem JSON, Markdown, IA, terminal ou conhecimento do repositório.
    - _Requisitos: 1.1–1.8, 1.11, 10.1, 10.23_

  - [x] 16.2 Implementar `TrainingMode` isolado e destino simulado
    - Fornecer fixtures fictícias, workspace, credenciais e publicação simulada separados; registrar abertura até restauração e conclusão do operador.
    - **Validação objetiva:** hashes de dados operacionais e públicos permanecem inalterados durante todo o exercício; registro cobre todas as etapas exigidas.
    - _Requisitos: 15.11–15.14_

  - [x] 16.3 Criar testes de componente e integração da interface
    - Cobrir grades, teclado, colagem, ajuda, bloqueios, avisos, diff, autenticação, conflito e retomada offline.
    - **Validação objetiva:** a suíte automatizada verifica estados observáveis e mensagens em português para caminhos felizes e falhas.
    - _Requisitos: 1.4–1.8, 3.6–3.8, 4.20, 7.3, 8.4–8.10, 12.12_

  - [x] 16.4 Criar E2E desktop da Escala Simulada
    - Automatizar abertura, coleta, sugestão, revisão manual, validação, aprovação, publicação simulada, fechamento e restauração em Windows/macOS.
    - **Validação objetiva:** o cenário conclui sem terminal e comprova isolamento; capturas e logs sanitizados identificam cada etapa.
    - _Requisitos: 1.1–1.3, 1.9, 15.12–15.14_

- [x] 17. Criar distribuição assinada, README e material de treinamento
  - [x] 17.1 Configurar builds e instaladores assinados para Windows e macOS
    - Produzir instalador Windows x64 com WebView2 e assinatura; pacotes macOS Intel/Apple Silicon assinados e notarizados; manter certificados e chave do updater somente nos secrets protegidos.
    - **Validação objetiva:** matriz instala, abre, usa cofre, atualiza, conclui smoke e remove em Windows 10/11 e macOS 12/atual sem contornar alertas.
    - _Requisitos: 1.9, 16.2_

  - [x] 17.2 Criar README completo em português e documentação de formatos
    - Documentar glossário, sete etapas, instalação/configuração/atualização/remoção, cadastro, entradas, indisponibilidades, regras, sugestão, validação, prévia, publicação, Git, credenciais, offline, conciliação, backup, migração, rollback, pós-publicação, custos e formatos com exemplos válidos/inválidos.
    - Explicar que login Google não protege URLs públicas e registrar responsáveis e histórico por versão.
    - **Validação objetiva:** lint estrutural confirma todas as seções, exemplos validam contra schemas e nenhum procedimento exige terminal, edição de JSON/Markdown ou IA do operador.
    - _Requisitos: 6.9, 9.12, 11.14, 15.1–15.10, 15.15, 15.16, 16.3_

  - [x] 17.3 Criar catálogo versionado de falhas ligado aos códigos da aplicação
    - Gerar ajuda/README a partir do mesmo catálogo tipado de erros, com sintoma, dados preservados/alterados, impacto, correção e confirmação.
    - **Validação objetiva:** teste falha se um código emitível não tiver exatamente um procedimento vigente ou se houver procedimento órfão.
    - _Requisitos: 1.7, 1.8, 12.12, 15.10, 15.16_

  - [x] 17.4 Criar roteiro de treinamento e checklist de homologação humana
    - Implementar conteúdo versionado dentro do modo de treinamento e no material em português, com dados fictícios, “o que você deve ver”, backup em outra instalação, restauração e critérios de execução sem ajuda técnica.
    - **Validação objetiva:** lint vincula cada passo ao controle/tela e o registro do modo de treinamento consegue comprovar todos os critérios sem tocar produção.
    - _Requisitos: 13.12, 15.11–15.16_

  - [x] 17.5 Escrever teste baseado em propriedade para sincronização do catálogo de falhas
    - **Property 46: Catálogo de falhas e documentação permanecem sincronizados**
    - **Valida: Requisitos 15.10, 15.16**

  - [x] 17.6 Criar testes de instalação e atualização por plataforma
    - Automatizar smoke do instalador, assinatura, notarização, cofre, atualização adiada durante ciclo e desinstalação.
    - **Validação objetiva:** artefatos não assinados ou não notarizados são rejeitados no pipeline de distribuição ao operador.
    - _Requisitos: 1.9, 15.2, 16.2_

- [x] 18. Checkpoint — executar equivalência, restauração e treinamento antes da homologação
  - Garantir que todos os testes passam, perguntar ao usuário se surgirem dúvidas.
  - Exigir zero pendências/rejeições/divergências, restauração íntegra em instalação limpa, publicação/rollback de homologação, instaladores assinados e Escala Simulada concluída pelo novo operador sem ajuda técnica.
  - Manter o visualizador e o processo atual como oficiais se qualquer evidência estiver ausente ou falhar.

- [x] 19. Preparar corte reversível sem remover o legado
  - [x] 19.1 Implementar comando guiado de corte protegido pelo registro de homologação
    - Criar backup final, conferir destinos, publicar o pacote já aprovado e registrar o marco de transição; preservar processo legado em branch/tag de transição pelo período configurado.
    - **Validação objetiva:** sem registro válido o comando não executa; com falha, rollback compensatório restaura e verifica a vigente anterior.
    - _Requisitos: 10.2–10.4, 12.7–12.10, 16.7–16.12_

  - [x] 19.2 Executar suíte final automatizada de regressão e contrato
    - Executar unitários, propriedades, integração Rust, componentes, contratos, E2E desktop, compatibilidade do visualizador, segurança, migração e publicação/rollback em homologação.
    - **Validação objetiva:** produzir relatório único com zero falhas e referências às seeds/replayPaths; nenhum teste aponta para o destino público vigente.
    - _Requisitos: 1.1–1.10, 7.1–7.25, 9.1–9.14, 10.1–10.23, 11.1–11.16, 12.1–12.13, 16.7–16.12_

- [x] 20. Checkpoint final — autorizar homologação sem substituir silenciosamente o fluxo atual
  - Garantir que todos os testes passam, perguntar ao usuário se surgirem dúvidas.
  - Apresentar ao Aprovador as evidências de equivalência, restauração, treinamento, assinatura e verificação do Pages; somente a confirmação explícita poderá abrir o feature gate de corte.

## Notas

- Tarefas marcadas com `*` são testes opcionais para execução acelerada, mas compõem os critérios da release candidata e da homologação.
- Cada propriedade do desenho possui um teste fast-check próprio, mesmo quando duas propriedades aparecem no mesmo item de planejamento.
- Testes de propriedade usam no mínimo 100 execuções e o comentário `// Feature: gestao-leiga-de-escalas, Property N: <texto da propriedade>`; calendário, serialização e merge usam 500 execuções no CI noturno.
- O aplicativo novo deve permanecer isolado. Nenhuma tarefa anterior ao corte pode substituir ou publicar `atual.json`, `contatos.json`, o visualizador, o workflow Pages ou o processo legado.
- Alterações preexistentes do usuário em `contatos.json` e `escalas/2026/08/links-whatsapp.md` devem ser preservadas.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["1.4", "2.1"] },
    { "id": 3, "tasks": ["2.2", "2.4", "2.5", "2.6"] },
    { "id": 4, "tasks": ["2.3", "3.1", "3.3"] },
    { "id": 5, "tasks": ["2.7", "2.8", "3.2", "3.4", "3.5", "3.6", "3.7", "3.8", "3.9"] },
    { "id": 6, "tasks": ["4.1", "4.2", "5.1"] },
    { "id": 7, "tasks": ["4.3", "4.4", "4.5", "5.2", "5.3", "5.4", "5.5"] },
    { "id": 8, "tasks": ["4.6", "4.7", "4.8", "6.1", "6.2"] },
    { "id": 9, "tasks": ["6.3", "6.4", "6.5", "6.6", "6.7", "6.8", "8.1"] },
    { "id": 10, "tasks": ["8.2", "8.3", "8.4", "8.5", "8.7", "9.1"] },
    { "id": 11, "tasks": ["8.6", "9.2", "9.4", "9.5", "10.1"] },
    { "id": 12, "tasks": ["9.3", "9.6", "9.8", "10.2", "10.4"] },
    { "id": 13, "tasks": ["9.7", "10.3", "10.5", "11.1", "11.3"] },
    { "id": 14, "tasks": ["11.2", "11.4", "11.6", "11.7"] },
    { "id": 15, "tasks": ["11.5", "11.8", "11.9", "11.10", "11.12"] },
    { "id": 16, "tasks": ["11.11", "12.1", "12.2", "12.4"] },
    { "id": 17, "tasks": ["12.3", "12.6", "12.9", "15.1"] },
    { "id": 18, "tasks": ["12.5", "12.7", "12.10", "15.2"] },
    { "id": 19, "tasks": ["12.8", "14.1", "15.3"] },
    { "id": 20, "tasks": ["14.2", "14.6", "16.1", "16.2"] },
    { "id": 21, "tasks": ["14.3", "16.3", "17.1", "17.3"] },
    { "id": 22, "tasks": ["14.4", "14.5", "16.4", "17.2"] },
    { "id": 23, "tasks": ["17.4", "17.5", "17.6"] },
    { "id": 24, "tasks": ["19.1"] },
    { "id": 25, "tasks": ["19.2"] }
  ]
}
```
