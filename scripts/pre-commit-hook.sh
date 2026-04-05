#!/bin/sh
# Bloqueia commits se a documentação de regras estiver inconsistente

# Só roda se arquivos de regras foram modificados
REGRAS_MODIFICADAS=$(git diff --cached --name-only | grep -E "docs/regras/(REGRAS\.md|regras\.json)")

if [ -n "$REGRAS_MODIFICADAS" ]; then
  echo "📋 Arquivos de regras modificados — executando validação..."
  node scripts/validar-regras.js
  if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Commit bloqueado. Corrija os erros de documentação antes de commitar."
    exit 1
  fi
fi
