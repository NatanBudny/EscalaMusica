//! Adaptador de cofre de credenciais com segredo fora da IPC (tarefa 11.12).
//!
//! O token real vive SOMENTE no cofre do SO (Windows Credential Manager /
//! macOS Keychain) por tras de uma interface (`CredentialVault`). A UI recebe
//! apenas estado publico (conta, expiracao, status), NUNCA o valor. Aqui
//! fornecemos a interface e um adaptador FAKE em memoria para os testes de
//! integracao (token expirado/cancelado/removido), alem do estado publico que
//! cruza a IPC.

use serde::Serialize;

/// Estado publico da credencial — unico objeto que a IPC devolve a UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialPublicState {
    pub status: CredentialStatus,
    pub account: Option<String>,
    pub expires_at: Option<String>,
    /// Dica mascarada (ex.: "ghp_****"); nunca o valor real.
    pub masked_hint: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CredentialStatus {
    Absent,
    Active,
    Expired,
    Revoked,
}

/// Interface do cofre. Implementacoes reais usam Keychain/Credential Manager.
pub trait CredentialVault {
    /// Guarda o segredo no cofre do SO (nunca retorna o valor depois).
    fn store(&mut self, account: &str, secret: &str, expires_at: Option<String>);
    /// Remove o segredo e limpa memoria.
    fn remove(&mut self);
    /// Estado PUBLICO (sem segredo), seguro para a IPC.
    fn public_state(&self, now_epoch: i64) -> CredentialPublicState;
    /// Usa o segredo internamente para uma operacao Git, SEM expo-lo. Retorna
    /// se a operacao pode prosseguir (credencial utilizavel).
    fn can_authorize(&self, now_epoch: i64) -> bool;
}

/// Adaptador FAKE em memoria para testes. O segredo e privado e nunca e lido
/// por fora da struct.
pub struct InMemoryVault {
    account: Option<String>,
    secret: Option<String>,
    expires_epoch: Option<i64>,
    revoked: bool,
}

impl InMemoryVault {
    pub fn new() -> Self {
        Self {
            account: None,
            secret: None,
            expires_epoch: None,
            revoked: false,
        }
    }

    fn masked_hint(&self) -> Option<String> {
        self.secret.as_ref().map(|s| {
            // Classe nao secreta antes do primeiro '_' (ex.: "ghp").
            let class: String = s.chars().take_while(|c| *c != '_').collect();
            if class.is_empty() {
                "****".to_string()
            } else {
                format!("{}_****", class)
            }
        })
    }

    fn effective_status(&self, now_epoch: i64) -> CredentialStatus {
        if self.secret.is_none() {
            return CredentialStatus::Absent;
        }
        if self.revoked {
            return CredentialStatus::Revoked;
        }
        if let Some(exp) = self.expires_epoch {
            if now_epoch >= exp {
                return CredentialStatus::Expired;
            }
        }
        CredentialStatus::Active
    }
}

impl Default for InMemoryVault {
    fn default() -> Self {
        Self::new()
    }
}

impl CredentialVault for InMemoryVault {
    fn store(&mut self, account: &str, secret: &str, expires_at: Option<String>) {
        self.account = Some(account.to_string());
        self.secret = Some(secret.to_string());
        // Para o fake, interpretamos expires_at como epoch textual quando numerico.
        self.expires_epoch = expires_at.and_then(|s| s.parse::<i64>().ok());
        self.revoked = false;
    }

    fn remove(&mut self) {
        self.account = None;
        self.secret = None; // segredo apagado da memoria
        self.expires_epoch = None;
        self.revoked = false;
    }

    fn public_state(&self, now_epoch: i64) -> CredentialPublicState {
        let status = self.effective_status(now_epoch);
        CredentialPublicState {
            status,
            account: self.account.clone(),
            expires_at: self.expires_epoch.map(|e| e.to_string()),
            masked_hint: if matches!(status, CredentialStatus::Active | CredentialStatus::Expired) {
                self.masked_hint()
            } else {
                None
            },
        }
    }

    fn can_authorize(&self, now_epoch: i64) -> bool {
        matches!(self.effective_status(now_epoch), CredentialStatus::Active)
    }
}

/// Marca a credencial como revogada (equivalente a remocao de acesso remoto).
pub fn revoke(vault: &mut InMemoryVault) {
    vault.revoked = true;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn serialized(state: &CredentialPublicState) -> String {
        serde_json::to_string(state).unwrap()
    }

    #[test]
    fn estado_publico_nunca_contem_o_segredo() {
        let mut vault = InMemoryVault::new();
        vault.store("octocat", "ghp_SUPERSECRET0001", Some("9999999999".into()));
        let state = vault.public_state(1000);
        let json = serialized(&state);
        assert!(!json.contains("SUPERSECRET"));
        assert!(json.contains("ghp_****"));
        assert_eq!(state.status, CredentialStatus::Active);
    }

    #[test]
    fn token_expirado_bloqueia_autorizacao() {
        let mut vault = InMemoryVault::new();
        vault.store("octocat", "ghp_X", Some("1000".into()));
        assert!(vault.can_authorize(500)); // antes de expirar
        assert!(!vault.can_authorize(1000)); // no limite -> expirado
        assert_eq!(vault.public_state(1000).status, CredentialStatus::Expired);
    }

    #[test]
    fn token_revogado_bloqueia_autorizacao() {
        let mut vault = InMemoryVault::new();
        vault.store("octocat", "ghp_X", None);
        revoke(&mut vault);
        assert!(!vault.can_authorize(0));
        assert_eq!(vault.public_state(0).status, CredentialStatus::Revoked);
    }

    #[test]
    fn remover_apaga_segredo_e_zera_estado() {
        let mut vault = InMemoryVault::new();
        vault.store("octocat", "ghp_X", None);
        vault.remove();
        assert!(!vault.can_authorize(0));
        let state = vault.public_state(0);
        assert_eq!(state.status, CredentialStatus::Absent);
        assert!(state.account.is_none());
        assert!(state.masked_hint.is_none());
    }
}
