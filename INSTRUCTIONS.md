# EscalaMusica - Instruções para IA

## Visão Geral
Sistema de gerenciamento de escala musical com contatos, histórico e interface web.

## Estrutura do Projeto

### Arquivos Principais
- **contatos.json** - Base de dados de contatos com números de WhatsApp
  - Formato: Chave é o nome da pessoa (sempre MAIÚSCULA)
  - Cada contato tem: `telefone` (link WhatsApp em formato `https://wa.me/5543...`) e `apelidos` (array de strings)
  - Números são convertidos para formato WhatsApp removendo hífens/espaços e prefixando `https://wa.me/`
  - Exemplo: `+55 43 9686-8206` → `https://wa.me/5543986868206`

- **atual.json** - Dados atuais (estrutura a verificar conforme necessário)

- **index.html** - Interface web do sistema

- **local.py** - Script Python para processamento/backend

- **dezembro.csv** - Arquivo de escala do mês (dados históricos)

- **old/** - Pasta com arquivo históricos de escala

## Tarefas Comuns

### Adicionar novo contato
1. Abrir `contatos.json`
2. Adicionar entrada antes da chave de fechamento `}`
3. Nome em MAIÚSCULAS, apelidos como array (pode ser vazio)
4. Telefone em formato WhatsApp: remover caracteres especiais e prefixar `https://wa.me/`

**Exemplo do que foi feito:**
```json
"BRUNA": {
  "telefone": "https://wa.me/5543986868206",
  "apelidos": []
}
```

### Atualizar telefone
- Encontrar o contato em `contatos.json` pelo nome
- Atualizar apenas o valor de `telefone` mantendo o mesmo padrão de formato

## Padrões e Convenções
- **Nomes**: SEMPRE MAIÚSCULAS (ex: BRUNA, ANDRÉ, JOÃO)
- **Apelidos**: Array strings em minúsculas ou padrão do projeto
- **Telefones WhatsApp**: Formato `https://wa.me/[55DDD+número]` sem espaços ou hífens
- **Arquivos CSV**: Histórico de escalas por período
- **JSON**: Estrutura principal para dados persistentes

## Dicas para Resolver Tarefas Rapidamente
1. **Sempre preservar o JSON válido** - verificar fechamento de chaves e vírgulas
2. **Manter ordem alfabética** (opcional, mas ajuda) nos contatos
3. **Não criar backups** - apenas editar os arquivos necessários
4. **Para tarefas em contatos.json**: use `multi_replace_string_in_file` se houver várias edições

## Estrutura do JSON de Contatos
```json
{
  "NOME_MAIÚSCULO": {
    "telefone": "https://wa.me/[NÚMERO_SEM_FORMATAÇÃO]",
    "apelidos": ["apelido1", "apelido2"]
  }
}
```
