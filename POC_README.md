# 🚀 POC - Escala de Música com Funcionalidades Avançadas

## 📋 Funcionalidades Implementadas

### ✅ 1. Autenticação com Google
- Login via Google Sign-In
- Persistência de sessão
- Exibição de informações do usuário
- Fallback para modo demo (sem Google configurado)

### ✅ 2. Sistema de Confirmação de Presença
- Botão de confirmação em cada escala do usuário
- Status visual com badges:
  - ✓ Confirmado (verde)
  - ⏳ Pendente (amarelo)
- Destaque visual em escalas não confirmadas
- Persistência no localStorage

### ✅ 3. Alertas Inteligentes
- **Alertas para não confirmados**: Exibe banner quando há escalas futuras sem confirmação
- **Alertas para próximas escalas**: Mostra próxima escala com contagem regressiva
- Alertas visuais com cores diferentes (warning, success, danger)

### ✅ 4. Notificações do Navegador
- Sistema de notificações configurável
- Por padrão **DESABILITADO**
- Usuário pode ativar notificações apenas das suas escalas
- Lembretes configuráveis:
  - 2 dias antes
  - 1 dia antes
- Verificação automática a cada minuto

### ✅ 5. Busca por Nome Próprio
- Campo de busca em tempo real
- Busca em todos os campos (regente, equipe, pregador, etc.)
- Busca parcial e inteligente
- Destaque visual nos resultados

### ✅ 6. Auto-filtro por Usuário
- **Ao fazer login, o usuário já vê suas escalas filtradas automaticamente**
- Botão "Minhas Escalas" para alternar visualização
- Badge "Minha Escala" nos cards relevantes
- Borda verde destacando escalas próprias

### ✅ 7. Animações Suaves (Estilo Apple)
- Transições suaves em todos os elementos
- Animações de entrada (fadeIn, slideDown, slideUp)
- Efeitos de hover elegantes
- Delays escalonados nos cards
- Curvas de animação: `cubic-bezier(0.4, 0, 0.2, 1)`

### ✅ 8. Badges Visuais
- Badge "Minha Escala" (azul)
- Badge "Confirmado" (verde)
- Badge "Pendente" (amarelo)
- Animações de entrada (scaleIn)
- Design minimalista e sofisticado

## 🎨 Design Minimalista (Estilo Apple)

### Características:
- **Cores**: Sistema de cores baseado em variáveis CSS
- **Tipografia**: System fonts (-apple-system, BlinkMacSystemFont)
- **Espaçamento**: Generoso e consistente
- **Bordas**: Arredondadas (12px radius)
- **Sombras**: Suaves e discretas
- **Transições**: Suaves em todas as interações
- **Modo Escuro**: Suporte completo

### Paleta de Cores:
- Primary: `#007AFF` (Azul iOS)
- Success: `#34C759` (Verde iOS)
- Warning: `#FF9500` (Laranja iOS)
- Danger: `#FF3B30` (Vermelho iOS)
- Background: `#F2F2F7` (Cinza claro iOS)
- Card: `#FFFFFF`

## 🔧 Configuração

### 1. Google Sign-In (Opcional)

Para usar autenticação real com Google:

1. Acesse [Google Cloud Console](https://console.cloud.google.com/)
2. Crie um novo projeto ou selecione existente
3. Ative a API "Google Sign-In"
4. Crie credenciais OAuth 2.0
5. Substitua `YOUR_GOOGLE_CLIENT_ID` no código:

```javascript
google.accounts.id.initialize({
    client_id:'SEU_CLIENT_ID.apps.googleusercontent.com',
    callback:handleCredentialResponse
});
```

**Nota**: Sem configurar, o sistema usa fallback com prompt de nome.

### 2. Notificações do Navegador

As notificações requerem permissão do usuário:
- Primeira vez: usuário precisa permitir no navegador
- Chrome/Edge: ícone de cadeado na barra de endereços
- Firefox: popup de permissão
- Safari: Preferências > Sites > Notificações

## 📱 Como Usar

### Para Usuários:

1. **Login**: 
   - Clique em "Entrar com Google" (ou use modo demo)
   - Suas escalas aparecerão automaticamente filtradas

2. **Confirmar Presença**:
   - Nas suas escalas futuras, clique em "Confirmar"
   - Status muda para "✓ Confirmado"
   - Badge verde aparece

3. **Ativar Notificações**:
   - Clique no ícone de sino
   - Ative "Receber notificações das minhas escalas"
   - Configure lembretes (2 dias, 1 dia antes)

4. **Buscar**:
   - Digite qualquer nome no campo de busca
   - Resultados aparecem em tempo real

5. **Ver Todas as Escalas**:
   - Clique em "Limpar Filtros" ou desative "Minhas Escalas"

### Para Desenvolvedores:

#### Estrutura de Dados:

**Confirmações** (localStorage):
```json
{
  "03/01/2026": {
    "user123": true,
    "user456": false
  }
}
```

**Configurações de Notificações** (localStorage):
```json
{
  "notificacoesAtivas": false,
  "reminder2Days": false,
  "reminder1Day": false
}
```

**Dados do Usuário** (localStorage):
```json
{
  "email": "usuario@exemplo.com",
  "name": "Nome do Usuário",
  "picture": "url_da_foto",
  "sub": "id_unico"
}
```

## 🎯 Fluxo de Experiência do Usuário

1. **Primeiro Acesso**:
   - Usuário vê tela de login
   - Faz login com Google (ou modo demo)
   - **Automaticamente vê suas escalas filtradas**
   - Recebe alertas sobre escalas não confirmadas

2. **Uso Diário**:
   - Ao abrir, já vê suas escalas
   - Pode confirmar presença rapidamente
   - Recebe notificações (se ativadas)
   - Busca por outros membros quando necessário

3. **Notificações**:
   - Por padrão desabilitadas
   - Usuário ativa se quiser
   - Recebe lembretes apenas das suas escalas
   - Configurável (2 dias ou 1 dia antes)

## 🔔 Sistema de Alertas

### Tipos de Alertas:

1. **Não Confirmados** (Amarelo):
   - Aparece quando há escalas futuras sem confirmação
   - Conta quantas escalas estão pendentes

2. **Próxima Escala** (Verde):
   - Mostra a próxima escala do usuário
   - Indica quantos dias faltam
   - Aparece quando falta 7 dias ou menos

3. **Notificações do Navegador**:
   - Lembrete 2 dias antes (se ativado)
   - Lembrete 1 dia antes (se ativado)
   - Apenas para escalas do usuário logado

## 🎨 Animações Implementadas

### Transições:
- **Cards**: `slideUp` com delay escalonado
- **Controles**: `slideDown` com delay
- **Badges**: `scaleIn` ao aparecer
- **Hover**: `translateY(-2px)` suave
- **Toggle**: Transição suave de estado

### Curvas de Animação:
- Padrão: `cubic-bezier(0.4, 0, 0.2, 1)` (Material Design)
- Duração: 0.3s - 0.4s
- Delays: 0.05s entre cards

## 📊 Status Visual

### Badges:
- **Minha Escala**: Azul claro, indica que você está escalado
- **Confirmado**: Verde, presença confirmada
- **Pendente**: Amarelo, aguardando confirmação

### Destaques:
- **Borda Verde**: Escalas do usuário
- **Borda Amarela**: Escalas não confirmadas
- **Opacidade Reduzida**: Escalas passadas

## 🚀 Próximos Passos (Melhorias Futuras)

1. **Backend Real**: Substituir localStorage por API
2. **Notificações Push**: Service Worker para notificações offline
3. **Estatísticas**: Dashboard de participação
4. **Exportação**: PDF, iCal, etc.
5. **Calendário Visual**: Vista mensal
6. **Compartilhamento**: Links diretos para escalas

## 🐛 Notas da POC

- **Google Sign-In**: Requer configuração de Client ID real
- **Notificações**: Funciona apenas em HTTPS (ou localhost)
- **Dados**: Armazenados localmente (localStorage)
- **Fallback**: Sistema funciona sem Google configurado

## 📝 Testando a POC

1. Abra `index.html` no navegador
2. Se não tiver Google configurado, use modo demo
3. Digite seu nome quando solicitado
4. Veja suas escalas automaticamente filtradas
5. Teste confirmação de presença
6. Ative notificações e aguarde lembretes
7. Teste busca por nomes
8. Explore animações e transições

---

**Desenvolvido com foco em UX minimalista e sofisticada, inspirado no design da Apple.**
