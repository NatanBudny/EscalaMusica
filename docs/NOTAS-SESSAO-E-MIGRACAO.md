# Notas da sessão + Plano de migração (SQLite)

> Documento de continuidade. Registra o contexto da sessão de 01/09/2026 (setembro/2026)
> e a intenção de migração para banco de dados, para retomar no próximo ciclo.
> Objetivo do diretor: **processo determinístico, com mínimo de IA** — a IA vira
> apenas orquestradora/consultora pontual, não executora do trabalho repetitivo.

---

## 1. Visão-alvo (o que queremos alcançar)

- **Menos IA, mais scripts.** Tudo que for determinístico deve ser script. A IA só entra
  no que é caro demais para automatizar (ex: interpretar frase em linguagem natural →
  virar regra; decidir caso ambíguo). No fluxo mensal, a IA deve **apontar os comandos**
  a rodar, não fazer o trabalho manual.
- **Banco de dados hospedado no próprio repositório GitHub**, sem instalar servidor,
  clonável e executável em qualquer máquina.
- **Motivação de custo:** o Kiro cobra por requisição de agente. As ~8 rodadas de revisão
  da escala deste mês gastaram muitos créditos (≈1 crédito por interação). Automatizando,
  o diretor roda os scripts sozinho (0 crédito) e só chama a IA quando necessário.

---

## 2. Decisão de banco: SQLite

- **Escolha:** SQLite — banco em **arquivo único** (`.db`), sem servidor, versionável no Git,
  clonável e pronto para rodar. Node tem suporte (`node:sqlite` nativo em versões recentes,
  ou `better-sqlite3`).
- **Datas:** usar **TEXT no formato ISO 8601** (`"2026-09-05"`), NÃO integer/epoch.
  Fica legível, ordenável e comparável. (O diretor não gosta de data como inteiro — resolvido.)
- **Escopo de tabelas (rascunho inicial):**
  - `pessoas` (id, nome, genero, ativo, perfil_canto, telefone, incentivo_intervalo_meses, ...)
  - `aliases` (pessoa_id, alias)
  - `habilitacoes` (pessoa_id, regente, equipe, mm_es, mm_culto, mm_domingo)
  - `vinculos` (pessoa_id, tipo, com_id/grupo)
  - `regras` (id, categoria RF/RP/PE, descricao, condicao estruturada, prioridade)
  - `restricoes_pessoais` (pessoa_id, tipo, condicao, dias_bloqueados/permitidos, intervalo_meses)
  - `indisponibilidades` (pessoa_id, data_referencia ou mes_inteiro)
  - `cultos` / `escala` (data, dia, acomp, anciao, pregador, av, regente, equipe, mm, obs)
  - `contatos_responsavel_grupo` (grupo, responsavel_pessoa_id) — ver seção 5
- **O que vira SQL:** as regras (hoje espalhadas em MD/JSON + hardcoded no auditor) viram
  linhas consultáveis; os insumos (indisponibilidade, acionato) viram INSERTs; a escala e o
  histórico viram tabelas. Scripts preenchem/consultam o banco.

### Migração incremental sugerida (não fazer tudo de uma vez)
1. Criar o `.db` e o schema (tabelas + datas em TEXT ISO).
2. Script de carga: `pessoas.json` → tabelas `pessoas/aliases/habilitacoes/vinculos`.
3. Script de carga: histórico (`old/**` + `atual.json`) → tabela `escala`.
4. Portar o **auditor** (`scripts/lib/auditor-escala.js`) para ler regras do banco em vez de
   hardcoded (unifica a fonte da verdade das regras — resolve o BUG-8 de vez).
5. Portar controles de rotação e ICR para consultas SQL.
6. Aposentar os JSON/MD duplicados de regras.

---

## 3. Entrada de dados (insumos) e o ponto de IA

O diretor recebe mensalmente:
- **PDF** — escala de ancião/pregador + escala de sonoplastia (audiovisual).
- **CSV** — enquete de indisponibilidade dos cantores (WhatsApp), **sempre no mesmo padrão**.

Situação de automação:
- **CSV de indisponibilidade:** já é determinístico (formato fixo). Deve ter um parser próprio
  `csv → JSON/tabela` sem IA. (Nesta sessão foi convertido via script pontual; falta um script
  permanente `importar:indisponibilidade`.)
- **PDF (acionato + sonoplastia):** extração de texto é determinística (`pypdf` funcionou),
  mas a **interpretação do layout** varia. Hoje o diretor usa IA para transformar PDF→JSON.
  Este é o **único ponto caro** para "zero IA". Investigar se o PDF vem sempre no mesmo
  formato: se sim, dá para um parser determinístico; se não, mantém IA só nesse passo.

---

## 4. Bugs corrigidos nesta sessão (já commitados e no GitHub)

Revisão de arquitetura de todos os scripts. Corrigidos:

- **BUG-1** `publicar-escala-mensal`: lia o rascunho no formato errado (esperava ACOMP na
  col5, mas é AUDIOVISUAL; rascunho não tem coluna ACOMP). Reescrito o parse para o formato
  canônico do solver-output + `acompPorDia` (quarta=PB, sáb/dom=BANDA).
- **BUG-2** AV das quartas vinha de `sonoplastia.json` inexistente → agora lê `audiovisual`
  do `acionato.json`.
- **BUG-3** `publicar:fechamento` não validava o rascunho → agora roda `validar:rascunho`
  como 1º passo e aborta se houver violação.
- **BUG-4** `publicar:fechamento` não atualizava os controles de rotação → agora roda
  `controle:mm/regentes/equipe --mes=AAAA-MM` após publicar.
- **BUG-5** `controle-rotacao-utils` tinha períodos hardcoded (jan-abr, atual.json="ABR")
  e saída fixa em `escalas/2026/05/` → agora descobre períodos de `old/**` + `atual.json`
  e grava em `escalas/AAAA/MM/` (parâmetro `--mes`).
- **BUG-6** `validar-obs-publico` exigia prefixo `PUBLICAR:` e barraria OBS externo do
  acionato (MANÁ, Semana de Esperança) → o publicar agora **prefixa automaticamente**
  `PUBLICAR:` nos OBS vindos do acionato (RF016) via `formatarObsPublico` + `mergeObsAcionato`.
- **BUG-7** `aplicar-revisao` reconstruía a linha do rascunho com `cols.join('|')`, perdendo
  os espaços `| x |` e quebrando o regex dos leitores → corrigido para `'| '+internas.join(' | ')+' |'`.
- **BUG-8** (documental) DOIS diretórios de regras: `docs/regras/` (fonte editada nesta sessão)
  e `processos/regras/` (o que o `validar:regras` validava). Correção MÍNIMA aplicada:
  `validar:regras` agora prefere `docs/regras/`. **Consolidação plena fica para a migração SQLite.**

---

## 5. Novidades criadas nesta sessão

Scripts/ferramentas novos (determinísticos):
- `scripts/lib/auditor-escala.js` — auditor central com TODAS as regras (RF/RP/PE, disponibilidade,
  gênero, casais, incentivo, Nilson, RF002/RF004 com resolução de identidade nome↔alias).
- `scripts/validacao/validar-rascunho.js` — reescrito para usar o auditor; lista violações +
  avisos + ICR. (Antes só checava 2 coisas e a de indisponibilidade estava quebrada — lia campo
  `indisponiveis_contatos` inexistente.)
- `scripts/controle/analisar-participacao.js` (`npm run analisar:participacao`) — calcula
  % participação, carga real e ICR (RF027); gera `escalas/AAAA/MM/participacao-icr.md`.
- `scripts/ciclo/aplicar-revisao.js` (`npm run aplicar:revisao`) — aplica o JSON de revisão
  (exportado pela tela) ao rascunho, troca reprovados por substitutos, **audita** e só grava
  se válido. Detecta automaticamente o JSON mais recente em `~/Downloads`.
- `scripts/controle/gerar-baseline-aprovacoes.js` (`npm run baseline:aprovacoes`) — gera o
  baseline de aprovações que continuam no rascunho (usado pela tela para o ícone ↩).
- `scripts/lib/revisao-input.js` — lib compartilhada que resolve o JSON de revisão
  (--input > mais recente em Downloads > pasta do mês).
- `scripts/revisar.py` (`npm run revisar -- AAAA-MM`) — sobe servidor local com **anti-cache**
  (Cache-Control: no-store) e abre a tela de revisão no navegador.
- `revisao/index.html` — tela de revisão clicável:
  - clique no nome: 1x aprova (verde), 2x reprova (vermelho + campo de motivo), 3x neutro;
  - **clique-direito** num reprovado abre menu de **substitutos disponíveis** (filtra por
    disponibilidade + habilitação do papel; permite permuta de papel entre pessoas do dia);
  - cards com todos respondidos ficam **esmaecidos** (editáveis);
  - aprovações de rodadas anteriores voltam com ícone **↩** (baseline);
  - botões: "↻ Recarregar limpo" (descarta sessão, mantém ↩) e "⭐ Revisão final"
    (zera tudo, inclusive ↩, para revisão nome a nome);
  - salva JSON com **timestamp** no nome (`revisao-resultado-AAAA-MM-AAAAMMDD-HHMM.json`).

Conceito novo em `gerar-links-publicacao.js`:
- `RESPONSAVEL_GRUPO` — grupos/departamentos e pessoas sem telefone próprio recebem contato
  via um responsável. Mapeados: CORAL INFANTIL→Jessie, DESBRAVADORES→Maxwell, JOVENS→Fabricio,
  MANU C.→Silvana. (Chave comparada normalizada — sem ponto/acento.)

---

## 6. Regras novas documentadas (docs/regras/) nesta sessão

- **RF006** (alterada): o rascunho **deve omitir** as quartas-feiras; a publicação final
  reintroduz as quartas com dados externos.
- **RP008** BERNARDO — cantor infantil, meses alternados (incentivo).
- **RP009** MANU C. — só canta com SILVANA no mesmo culto.
- **RP010/RP015** MANU C. / MANU S. — infantis, meses alternados.
- **RP011** MANU S. — só canta com JESSICA ou JOÁS.
- **RP012** YASSER — regente só em último caso; escalar no máx a cada 2 meses.
- **RP013** LIDIANE — mesma cadência do Yasser (casal), a cada 2 meses.
- **RP014** RONI — evitar escalar em datas próximas da montagem (recusa em cima da hora).
- **RP016** VANDERLEY — entra ~1x a cada 3 meses, só sábados, apoio de sonoplastia.
- **RP017** CATHERINE — não canta aos domingos.
- **PE009** — perfil de **incentivo**: pessoas que cantam menos de propósito (campo
  `incentivo: { ativo, intervalo_meses }` em `pessoas.json`). Aplicado: ROSANA, BERNARDO,
  MANU C., MANU S., LAURA (1.5 mês); VANDERLEY (3 meses).

Correção de cadastro: **LUIZ ANTONIO** não é regente (`regente:false`). **MARIA HELOISA**
renomeada para **MARIA ELOISA**.

Pessoas cadastradas nesta sessão: STEPHANY, DILSON CASTRO (contato via Yasser), ROOSEVELT,
e externos não-escaláveis MAXWELL, ENOQUE JR. (alias JÚNIOR OLIVEIRA), ADELMO.
Aliases adicionados para dar link no app: ANDRÉ HERREIRA→ANDRE, JOVENS→FABRICIO,
DA SILVA→LUIZ DA SILVA, DULCI→DULCINEIA.

---

## 7. Fluxo mensal atual (determinístico) — comandos na ordem

```
1. npm run iniciar:mes -- --mes=AAAA-MM
2. (coletar insumos em escalas/AAAA/MM/insumos/)
   - indisponibilidade-cantores.json  (do CSV — falta script permanente de import)
   - acionato.json                    (do PDF — hoje via IA)
3. npm run vincular:indisponibilidade -- --mes=AAAA-MM --auto
4. npm run sugerir:rascunho -- --mes=AAAA-MM
5. npm run validar:rascunho escalas/AAAA/MM/rascunho.md
6. npm run analisar:participacao -- --mes=AAAA-MM
7. npm run revisar -- AAAA-MM        (revisar na tela → salvar JSON)
8. npm run aplicar:revisao -- --mes=AAAA-MM   (--dry para conferir antes)
9. (repetir 5-8 até aprovar)
10. npm run publicar:fechamento -- --rascunho=escalas/AAAA/MM/rascunho.md --skip-local
11. registrar em processos/logs/publicacoes.md (RF008)
```

Observações importantes:
- **Não rodar `ciclo:mensal` depois de ajustar o rascunho manualmente** — ele regenera vínculo
  e rascunho do zero, apagando as edições.
- O ACOMP é derivado por dia (quarta=PB, sáb/dom=BANDA). Exceções (ex: um sábado em PB) são
  ajustadas direto no `atual.json` após publicar (RF018). **Ideia para o banco:** tornar ACOMP
  um campo editável na tela de revisão, por culto.

---

## 8. Pendências para o próximo ciclo (TODO)

- [ ] **TASK-12 (guias):** alinhar `processos/guias/publicar-escala.md` e `pos-publicacao.md`
      ao fluxo real corrigido; incluir `gerar:contatos` **antes** de `gerar:links` no
      `publicar:fechamento` (hoje contatos ficam desatualizados na publicação).
- [ ] **Abertura dos links no Kiro:** definir como abrir o `links-whatsapp.md` no editor do
      Kiro ao final do processo (nesta sessão abriu no VS Code externo por engano).
- [ ] **Script permanente de import do CSV** de indisponibilidade (`importar:indisponibilidade`).
- [ ] **Investigar padrão do PDF** do acionato/sonoplastia para parser determinístico (reduzir IA).
- [ ] **Migração SQLite** (seção 2) — incremental.
- [ ] **Consolidar regras** definitivamente na migração (encerra o BUG-8).
- [ ] **BERNARDO e RONI** compartilham o mesmo telefone no cadastro (pai/filho) — revisar se
      deve ter números distintos.

---

## 9. Estado atual (fim da sessão 01/09/2026)

- Escala de **setembro/2026 publicada** em `atual.json` (13 cultos). Backup de agosto em
  `old/2026/082026.json`. Links em `escalas/2026/09/links-whatsapp.md` (31 com contato, 0 sem).
- ACOMP ajustado: PB em 05/09, 13/09, 20/09, 27/09; BANDA nos demais sáb/dom.
- Publicação registrada em `processos/logs/publicacoes.md`.
- Tudo commitado e enviado ao GitHub (`origin/main`).
- `npm test`: 356 testes passando.
