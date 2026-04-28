# Processo: Iniciar Nova Escala Mensal

## 1. Preparação Inicial

- [ ] Confirmar mês da escala (ex: MAIO/2026)
- [ ] Verificar se houve mudanças no cadastro de funções (`processos/regras/cadastros/funcoes-louvor.json`)
  - Se **SIM**: Atualizar `pode_regencia` e `pode_equipe` de cada pessoa conforme necessário
- [ ] Regenerar ou criar novo `controle-mensagem-musical.json` com contadores zerados para o novo período

## 2. Coleta de Dados

- [ ] Obter data de todos os cultos do mês
- [ ] Receber escala de sonoplastia em JSON
- [ ] Receber escala de acionato (anciãos, pregadores e observações) em JSON
- [ ] Armazenar os dois arquivos em `escalas/AAAA/MM/insumos/`
- [ ] Confirmar disponibilidades do louvor (enquete ou privado)

## 3. Preenchimento da Escala

Use o arquivo `controle-mensagem-musical.json` como **sistema de sugestão**:

### Para Regência de Louvor
- Priorizar pessoas com `pode_regencia: true`
- Sugerir quem tem menor contador `REGENCIA`
- Considerar disponibilidade

### Para Equipe de Louvor (5 pessoas por culto)
- Priorizar pessoas com `pode_equipe: true`
- Sugerir quem tem menor contador `EQUIPE`
- Garantir exatamente 5 pessoas por evento
- Considerar disponibilidade

### Para Mensagem Musical
- **ES** (Escola Sabatina): Sugerir menor `ES`, com `pode_mm_es: true`
- **CULTO** (Culto Principal): Sugerir menor `CULTO`, com `pode_mm_culto: true`
- **DOMINGO**: Sugerir menor `DOMINGO`, com `pode_mm_dom: true`
- Considerar disponibilidade

**Preencher tabela em**: `escalas/2026/[MES]/rascunho.md`

Insumos obrigatórios para montar o rascunho:

- `escalas/AAAA/MM/insumos/sonoplastia.json`
- `escalas/AAAA/MM/insumos/acionato.json`

Usar estrutura:
```
| Data | Dia | Anciao | Pregador | Sonoplastia | Regente Louvor | Equipe Louvor (5) | Mensagem Musical | Observacoes |
```

## 4. Validações

- [ ] Executar: `npm run validar:regras`
- [ ] Executar: `npm run validar:obs`
- [ ] Revisar erros/avisos
- [ ] Corrigir nomes/conflitos conforme necessário

## 5. Publicação

- [ ] Arquivar o `atual.json` vigente em `old/[ANO]/mmaaaa.json`
- [ ] Criar o novo `atual.json` do mês aprovado usando o `rascunho.md` como base
- [ ] Revisar a coluna OBS antes de publicar:
  - manter somente observações vindas da escala externa (ancião/pregador) ou autorizadas explicitamente para publicação
  - remover observações de montagem interna (deixar somente no rascunho/Motivo interno)
- [ ] Executar: `npm run gerar:links-publicacao`
- [ ] Compartilhar links no WhatsApp
- [ ] Após aprovação do rascunho, remover `escalas/AAAA/MM/insumos/sonoplastia.json` e `escalas/AAAA/MM/insumos/acionato.json` (dados temporários de montagem)
- [ ] Após publicar e conferir, descartar `rascunho.md` e `publicada.md` do mês (não são necessários para manutenção)
- [ ] Qualquer ajuste posterior deve ser feito diretamente no `atual.json`

## 6. Atualização de Registros

- [ ] Atualizar `controle-mensagem-musical.json` - incrementar contadores:
  - `REGENCIA`: +1 para regentes escalados
  - `EQUIPE`: +1 para cada membro escalado
  - `ES` / `CULTO` / `DOMINGO`: +1 para MM escalados
  - Atualizar `por_mes` com contadores do mês atual
- [ ] Registrar publicação em: `processos/logs/publicacoes.md`

## Estrutura de Arquivos por Mês

```
escalas/2026/[MES]/
├── insumos/
│   ├── sonoplastia.json     ← Entrada externa temporária para montagem
│   └── acionato.json        ← Entrada externa temporária para montagem
├── rascunho.md              ← Versão em trabalho (descartável após aprovação)
├── publicada.md             ← Opcional/temporário (descartável após aprovação)
├── controle-mensagem-musical.json  ← Ranking e sugestões
└── links-whatsapp.md        ← Links gerados automaticamente
```

## Dicas de Otimização

1. **Considerar sonoplastia**: Se alguém está na sonoplastia, pode estar indisponível para louvor no mesmo dia
2. **Balancear carga**: Tentar distribuir REGENCIA e EQUIPE entre pessoas
3. **Respeitar disponibilidades**: Nunca forçar alguém indisponível
4. **Atualizar cadastro**: Se alguém mudar de função (ex: passa a poder fazer regência), registrar em `processos/regras/cadastros/funcoes-louvor.json`
