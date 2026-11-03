//! Nucleo local do aplicativo de gestao leiga de escalas.
//!
//! Este scaffold expoe apenas um comando tipado (`ping`) que comprova o canal
//! IPC sem acessar nem alterar os arquivos publicos vigentes do legado
//! (atual.json, contatos.json) nem o visualizador. Nenhuma capability de shell,
//! filesystem arbitrario ou rede e habilitada.

use serde::{Deserialize, Serialize};

// Modulos do nucleo privilegiado (tarefa 11.12 / 12): operacoes de filesystem,
// Git, cofre de credenciais e verificacao HTTP. A logica de DECISAO vive no
// dominio TypeScript; estes modulos aplicam os efeitos com seguranca e sao
// cobertos por testes de integracao (cargo test).
pub mod atomic_fs;
pub mod credential_vault;
pub mod git_sync;
pub mod http_verify;

/// Carga recebida pelo comando `ping`. Espelha `PingRequest` no TypeScript.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PingRequest {
    pub message: String,
}

/// Resposta do comando `ping`. Espelha `PingResponse` no TypeScript.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PingResponse {
    pub echo: String,
    pub core_version: String,
    pub legacy_untouched: bool,
}

/// Logica pura do `ping`, separada do atributo de comando para permitir testes
/// unitarios do nucleo sem inicializar o runtime do Tauri.
pub fn handle_ping(request: PingRequest) -> PingResponse {
    PingResponse {
        echo: request.message,
        core_version: env!("CARGO_PKG_VERSION").to_string(),
        // Este scaffold nunca abre, le ou grava arquivos do legado.
        legacy_untouched: true,
    }
}

/// Comando IPC tipado exposto ao frontend.
#[tauri::command]
fn ping(request: PingRequest) -> PingResponse {
    handle_ping(request)
}

/// Ponto de entrada compartilhado entre o binario desktop e os testes.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Apenas o comando `ping` e exposto: superficie IPC minima.
        .invoke_handler(tauri::generate_handler![ping])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o nucleo do aplicativo");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_ecoa_mensagem_e_nao_toca_no_legado() {
        let response = handle_ping(PingRequest {
            message: "ola-nucleo".to_string(),
        });
        assert_eq!(response.echo, "ola-nucleo");
        assert!(response.legacy_untouched);
        assert_eq!(response.core_version, env!("CARGO_PKG_VERSION"));
    }
}
