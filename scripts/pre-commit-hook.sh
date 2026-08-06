#!/bin/sh
# Bloqueia commits se a documentação de regras estiver inconsistente

# Só roda se arquivos de regras foram modificados
REGRAS_MODIFICADAS=$(git diff --cached --name-only | grep -E "docs/regras/(REGRAS\.md|regras\.json)")
ATUAL_MODIFICADO=$(git diff --cached --name-only | grep -E "^atual\.json$")

if [ -n "$REGRAS_MODIFICADAS" ]; then
  echo "📋 Arquivos de regras modificados — executando validação..."
  node scripts/validar-regras.js
  if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Commit bloqueado. Corrija os erros de documentação antes de commitar."
    exit 1
  fi
fi

if [ -n "$ATUAL_MODIFICADO" ]; then
  echo "🔒 atual.json modificado — validando campo OBS publico..."
  node scripts/validar-obs-publico.js
  if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Commit bloqueado. OBS deve conter apenas avisos publicos autorizados."
    exit 1
  fi
fi
