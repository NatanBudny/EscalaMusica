# Processo: Iniciar Nova Escala Mensal

## 1. Pré-requisitos

Antes de iniciar o ciclo:

- [ ] `pessoas.json` atualizado (habilitações, afastamentos, vínculos)
- [ ] Insumos coletados e salvos em `escalas/AAAA/MM/insumos/`:
  - `indisponibilidade-cantores.json` — gerado a partir da enquete WhatsApp (IA converte texto → JSON)
  - `acionato.json` — escala de anciãos e pregadores (formato em `processos/templates/insumo-acionato.json`)
- [ ] Datas dos cultos do mês confirmadas

---

## 2. Fluxo automatizado

### Fluxo rápido (5 comandos)

```bash
# 1. Iniciar estrutura do mês
npm run iniciar:mes -- --mes=2026-08

# 2. Coletar insumos (manual — colocar em escalas/2026/08/insumos/)
#    - indisponibilidade-cantores.json (enquete WhatsApp → IA → JSON)
#    - acionato.json (escala de anciãos/pregadores)

# 3. Vincular indisponibilidade (fuzzy match nomes → IDs)
npm run vincular:indisponibilidade -- --mes=2026-08 --auto

# 4. Rodar solver (gera rascunho + justificativa)
npm run sugerir:rascunho -- --mes=2026-08

# 5. Validar rascunho
npm run validar:rascunho escalas/2026/08/rascunho.md

# 6. Revisar manualmente e publicar
npm run publicar:fechamento -- --rascunho=escalas/2026/08/rascunho.md
```

### Comando combinado (alternativa)

```bash
npm run ciclo:mensal -- --mes=2026-08
```

Executa os passos 1, 3, 4 e 5 em sequência. Os insumos (passo 2) devem estar no diretório antes de rodar.

---

## 3. O que o solver faz

O script `scripts/sugerir-rascunho.js` realiza:

1. Lê `pessoas.json` (cadastro, habilitações, vínculos, afastamentos)
2. Lê `regras.snapshot.json` (regras fundamentais, restrições pessoais, preferências)
3. Lê insumos do mês (indisponibilidade vinculada, acionato)
4. Aplica constraints de forma automática:
   - Respeita indisponibilidades e afastamentos
   - Garante habilitação correta para cada função (regência, equipe, MM)
   - Distribui carga por menor frequência (contadores de rotação)
   - Aplica vínculos (casais sempre_junto, família_requerida)
   - Respeita `dias_permitidos` por pessoa
5. Gera dois arquivos:
   - `escalas/AAAA/MM/rascunho.md` — tabela completa da escala
   - `escalas/AAAA/MM/rascunho-justificativa.md` — explicação das escolhas e exclusões

---

## 4. Revisão manual

Após o solver gerar o rascunho, o diretor deve verificar:

- [ ] Distribuição visual equilibrada (não repetir mesmas pessoas em cultos seguidos)
- [ ] Ajustes de contexto que o solver não captura (viagens não informadas, preferências verbais)
- [ ] Coluna `Banda/PB` preenchida corretamente
- [ ] Observações do acionato transferidas para a coluna OBS
- [ ] Se alguma sugestão precisa de troca manual, consultar a justificativa para entender o motivo da escolha original

### Validações automatizadas

```bash
npm run validar:rascunho escalas/AAAA/MM/rascunho.md
npm run validar:regras
npm run validar:obs
```

---

## 5. Publicação e fechamento

Após revisão e aprovação do rascunho:

```bash
npm run publicar:fechamento -- --rascunho=escalas/AAAA/MM/rascunho.md
```

Esse comando:

- Promove o rascunho para `atual.json` com backup do anterior em `old/AAAA/mmaaaa.json`
- Roda `validar:regras` e `validar:obs`
- Gera `links-whatsapp.md`
- Roda limpeza pós-publicação
- Inicia `python scripts/local.py` ao final

Use `--skip-local` para não subir o servidor local ao final.

### Observações na publicação

- Manter somente observações vindas da escala externa (ancião/pregador) ou autorizadas para publicação
- Remover observações de montagem interna (deixar somente no rascunho)

---

## 6. Pós-publicação

- [ ] Compartilhar links do `links-whatsapp.md` nos grupos
- [ ] Atualizar contadores de rotação em `controle-mensagem-musical.json`:
  - `REGENCIA`: +1 para regentes escalados
  - `EQUIPE`: +1 para cada membro escalado
  - `ES` / `CULTO` / `DOMINGO`: +1 para MM escalados
- [ ] Registrar publicação em `processos/logs/publicacoes.md`
- [ ] Qualquer ajuste posterior: editar diretamente `atual.json`

---

## 7. Estrutura de arquivos do mês

```
escalas/AAAA/MM/
├── arquivo/
│   └── indisponibilidade-cantores-AAAA-MM-DD.json  ← Snapshot de referência
├── insumos/
│   ├── acionato.json                                ← Entrada externa (template: processos/templates/insumo-acionato.json)
│   ├── indisponibilidade-cantores.json              ← Enquete bruta convertida em JSON
│   ├── indisponibilidade-cantores-vinculada.json    ← Gerado por vincular-indisponibilidade
│   └── mapeamento-indisponibilidade-contatos.md     ← Log de match nomes → IDs
├── rascunho.md                                      ← Gerado pelo solver (editável)
├── rascunho-justificativa.md                        ← Explicação das escolhas do solver
├── controle-mensagem-musical.json                   ← Ranking e contadores
├── controle-equipe-louvor.json                      ← Controle de equipe
├── controle-regentes.json                           ← Controle de regência
└── links-whatsapp.md                                ← Gerado por publicar:fechamento
```
