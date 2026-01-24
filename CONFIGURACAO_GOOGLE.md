# 🔐 Configuração do Google Sign-In

## Passo a Passo Rápido

### 1. Acesse Google Cloud Console
- Vá para: https://console.cloud.google.com/
- Faça login com sua conta Google

### 2. Criar/Selecionar Projeto
- Clique em "Selecionar projeto" no topo
- Clique em "Novo Projeto"
- Dê um nome (ex: "Escala Musica")
- Clique em "Criar"

### 3. Configurar OAuth Consent Screen
- No menu lateral, vá em "APIs e Serviços" > "Tela de consentimento OAuth"
- Escolha "Externo" (ou "Interno" se tiver Google Workspace)
- Preencha:
  - Nome do app: "Escala de Louvor"
  - Email de suporte: seu email
  - Logo (opcional)
- Clique em "Salvar e continuar"
- Adicione seu email como usuário de teste (se necessário)
- Clique em "Salvar e continuar" até finalizar

### 4. Criar Credenciais OAuth
- Vá em "APIs e Serviços" > "Credenciais"
- Clique em "Criar credenciais" > "ID do cliente OAuth"
- Tipo de aplicativo: "Aplicativo da Web"
- Nome: "Escala Web Client"
- **Origens JavaScript autorizadas**:
  - `http://localhost:8000`
  - `http://localhost:3000`
  - Seu domínio de produção (ex: `https://seudominio.github.io`)
- **URIs de redirecionamento autorizados**:
  - `http://localhost:8000`
  - `http://localhost:3000`
  - Seu domínio de produção
- Clique em "Criar"

### 5. Copiar Client ID
- Após criar, você verá uma tela com:
  - **ID do cliente**: `644626883802-8dv5caoftedv677hhiiidtff03j4ne43.apps.googleusercontent.com`
  - **Segredo do cliente**: (não necessário para Sign-In)

### 6. Atualizar o Código
No arquivo `index.html`, encontre a linha:

```javascript
client_id:'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com',
```

Substitua `YOUR_GOOGLE_CLIENT_ID` pelo seu Client ID completo:

```javascript
client_id:'123456789-abc123def456.apps.googleusercontent.com',
```

### 7. Testar
1. Abra `index.html` no navegador
2. Você deve ver o botão "Entrar com Google"
3. Clique e faça login
4. Suas informações devem aparecer no topo

## ⚠️ Importante

### Domínios Autorizados
- Adicione TODOS os domínios onde o app será usado
- Para desenvolvimento local: `http://localhost:8000`
- Para GitHub Pages: `https://seuusuario.github.io`
- Para domínio próprio: `https://seudominio.com`

### Modo Demo (Sem Google)
Se não configurar o Google Sign-In, o sistema funciona em modo demo:
- Solicita nome do usuário
- Funciona normalmente
- Todas as funcionalidades disponíveis
- Dados salvos localmente

## 🔒 Segurança

- **Nunca** compartilhe seu Client ID publicamente em repositórios públicos
- Use variáveis de ambiente em produção
- Configure domínios corretamente
- Revise permissões OAuth regularmente

## 📚 Documentação Oficial

- [Google Identity Services](https://developers.google.com/identity/gsi/web)
- [OAuth 2.0 Setup](https://developers.google.com/identity/protocols/oauth2)

---

**Dica**: Para POC/testes, o modo demo (sem Google) funciona perfeitamente!
