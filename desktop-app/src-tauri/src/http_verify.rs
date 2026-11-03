//! Cliente HTTP simulado e verificacao de conteudo publico (tarefa 11.12 / 12).
//!
//! A verificacao definitiva do Site_Publico compara, por HTTP, o conteudo
//! publicado com o pacote aprovado: exige host aprovado, aplica limites de
//! tamanho/timeout e so confirma com IGUALDADE integral apos parse/canonical.
//! Aqui modelamos um cliente FAKE em memoria e a logica de verificacao, que o
//! cliente real (reqwest) reusara. Redirects para host diferente FALHAM.

use std::collections::HashMap;

/// Limite defensivo de tamanho de resposta (bytes).
pub const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub enum VerifyError {
    HostNotApproved,
    ResponseTooLarge,
    NotFound,
    ContentMismatch,
    CrossHostRedirect,
}

/// Resposta simulada do "servidor".
#[derive(Clone)]
pub struct FakeResponse {
    pub body: Vec<u8>,
    /// Quando presente, indica um redirect para esta URL.
    pub redirect_to: Option<String>,
}

/// Cliente HTTP FAKE: mapeia URL -> resposta. Nenhuma rede real e usada.
pub struct FakeHttpClient {
    routes: HashMap<String, FakeResponse>,
    approved_host: String,
}

impl FakeHttpClient {
    pub fn new(approved_host: &str) -> Self {
        Self {
            routes: HashMap::new(),
            approved_host: approved_host.to_string(),
        }
    }

    pub fn route(&mut self, url: &str, body: &[u8]) {
        self.routes.insert(
            url.to_string(),
            FakeResponse {
                body: body.to_vec(),
                redirect_to: None,
            },
        );
    }

    pub fn route_redirect(&mut self, url: &str, to: &str) {
        self.routes.insert(
            url.to_string(),
            FakeResponse {
                body: Vec::new(),
                redirect_to: Some(to.to_string()),
            },
        );
    }

    fn host_of(url: &str) -> Option<String> {
        // Extrai o host de "https://host/caminho".
        let without_scheme = url.split("://").nth(1)?;
        let host = without_scheme.split('/').next()?;
        Some(host.to_string())
    }

    /// Busca o corpo de uma URL, aplicando host aprovado, limite de tamanho e
    /// bloqueio de redirect cross-host.
    pub fn fetch(&self, url: &str) -> Result<Vec<u8>, VerifyError> {
        let host = Self::host_of(url).ok_or(VerifyError::HostNotApproved)?;
        if host != self.approved_host {
            return Err(VerifyError::HostNotApproved);
        }
        let resp = self.routes.get(url).ok_or(VerifyError::NotFound)?;
        if let Some(target) = &resp.redirect_to {
            let target_host = Self::host_of(target).ok_or(VerifyError::CrossHostRedirect)?;
            if target_host != self.approved_host {
                return Err(VerifyError::CrossHostRedirect);
            }
            // Redirect de mesmo host: segue uma vez.
            let next = self.routes.get(target).ok_or(VerifyError::NotFound)?;
            return Self::check_size(&next.body);
        }
        Self::check_size(&resp.body)
    }

    fn check_size(body: &[u8]) -> Result<Vec<u8>, VerifyError> {
        if body.len() > MAX_RESPONSE_BYTES {
            return Err(VerifyError::ResponseTooLarge);
        }
        Ok(body.to_vec())
    }
}

/// Confirma que o conteudo publicado em `url` e IGUAL ao esperado (byte a byte
/// apos leitura). So retorna Ok com igualdade integral.
pub fn verify_published(
    client: &FakeHttpClient,
    url: &str,
    expected: &[u8],
) -> Result<(), VerifyError> {
    let actual = client.fetch(url)?;
    if actual == expected {
        Ok(())
    } else {
        Err(VerifyError::ContentMismatch)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOST: &str = "igreja.github.io";

    #[test]
    fn confirma_igualdade_integral() {
        let mut client = FakeHttpClient::new(HOST);
        let url = format!("https://{}/atual.json", HOST);
        client.route(&url, b"[{\"a\":1}]");
        assert!(verify_published(&client, &url, b"[{\"a\":1}]").is_ok());
    }

    #[test]
    fn divergencia_de_conteudo_nao_confirma() {
        let mut client = FakeHttpClient::new(HOST);
        let url = format!("https://{}/atual.json", HOST);
        client.route(&url, b"[{\"a\":1}]");
        assert_eq!(
            verify_published(&client, &url, b"[{\"a\":2}]"),
            Err(VerifyError::ContentMismatch)
        );
    }

    #[test]
    fn host_nao_aprovado_falha() {
        let client = FakeHttpClient::new(HOST);
        let url = "https://atacante.example/atual.json";
        assert_eq!(verify_published(&client, url, b"x"), Err(VerifyError::HostNotApproved));
    }

    #[test]
    fn redirect_cross_host_falha() {
        let mut client = FakeHttpClient::new(HOST);
        let url = format!("https://{}/atual.json", HOST);
        client.route_redirect(&url, "https://atacante.example/atual.json");
        assert_eq!(verify_published(&client, &url, b"x"), Err(VerifyError::CrossHostRedirect));
    }

    #[test]
    fn resposta_acima_do_limite_falha() {
        let mut client = FakeHttpClient::new(HOST);
        let url = format!("https://{}/grande.json", HOST);
        client.route(&url, &vec![b'x'; MAX_RESPONSE_BYTES + 1]);
        assert_eq!(verify_published(&client, &url, b"x"), Err(VerifyError::ResponseTooLarge));
    }
}
