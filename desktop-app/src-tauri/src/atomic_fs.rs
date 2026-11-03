//! Escrita atomica em disco com staging + fsync + troca atomica (tarefa 11.12).
//!
//! Implementa a invariante do design ("Escrita atomica e recuperacao de
//! crash"): cada conjunto de bytes e escrito num arquivo TEMPORARIO no mesmo
//! diretorio de destino, sincronizado em disco (`fsync`) e, so entao, renomeado
//! atomicamente para o caminho final. Uma falha antes do rename NUNCA deixa o
//! arquivo de destino parcialmente escrito: ou o conteudo anterior permanece,
//! ou o novo conteudo completo passa a existir.
//!
//! Operacoes privilegiadas de filesystem vivem exclusivamente no nucleo Rust;
//! a logica de DECISAO (quando/por que escrever) e tomada no dominio TypeScript
//! (modulo `persistence/journal.ts`).

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// Erro de escrita atomica, com o caminho afetado.
#[derive(Debug)]
pub enum AtomicWriteError {
    Io(io::Error),
}

impl From<io::Error> for AtomicWriteError {
    fn from(e: io::Error) -> Self {
        AtomicWriteError::Io(e)
    }
}

/// Escreve `bytes` em `dest` de forma atomica: grava em um temporario no mesmo
/// diretorio, faz `fsync` do arquivo e renomeia sobre o destino. O diretorio de
/// destino e criado se necessario.
pub fn atomic_write(dest: &Path, bytes: &[u8]) -> Result<(), AtomicWriteError> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = staging_path(dest);

    {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        // Garante que os bytes chegaram ao disco antes da troca.
        file.sync_all()?;
    }

    // Rename e atomico no mesmo filesystem: o destino nunca fica parcial.
    fs::rename(&tmp, dest)?;
    Ok(())
}

/// Caminho do arquivo temporario de staging para um destino.
fn staging_path(dest: &Path) -> PathBuf {
    let mut name = dest
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    name.push(".staging.tmp");
    dest.with_file_name(name)
}

/// Remove qualquer arquivo de staging remanescente de uma escrita interrompida
/// (chamado na recuperacao de abertura; staging sem commit e descartado).
pub fn discard_staging(dest: &Path) -> Result<(), AtomicWriteError> {
    let tmp = staging_path(dest);
    if tmp.exists() {
        fs::remove_file(&tmp)?;
    }
    Ok(())
}

/// Verdadeiro quando existe um staging pendente (escrita interrompida).
pub fn has_pending_staging(dest: &Path) -> bool {
    staging_path(dest).exists()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn escreve_e_le_de_volta() {
        let dir = tempdir().unwrap();
        let dest = dir.path().join("sub/dados.json");
        atomic_write(&dest, b"conteudo-1").unwrap();
        assert_eq!(fs::read(&dest).unwrap(), b"conteudo-1");
        // Nenhum staging remanescente apos sucesso.
        assert!(!has_pending_staging(&dest));
    }

    #[test]
    fn sobrescrita_preserva_conteudo_completo() {
        let dir = tempdir().unwrap();
        let dest = dir.path().join("dados.json");
        atomic_write(&dest, b"versao-A").unwrap();
        atomic_write(&dest, b"versao-B-mais-longa").unwrap();
        assert_eq!(fs::read(&dest).unwrap(), b"versao-B-mais-longa");
    }

    #[test]
    fn staging_interrompido_e_descartado_sem_tocar_o_destino() {
        let dir = tempdir().unwrap();
        let dest = dir.path().join("dados.json");
        atomic_write(&dest, b"confirmado").unwrap();

        // Simula escrita interrompida: cria o staging manualmente, sem rename.
        let tmp = staging_path(&dest);
        fs::write(&tmp, b"parcial-nao-confirmado").unwrap();
        assert!(has_pending_staging(&dest));

        // Recuperacao: descarta staging; o destino confirmado permanece intacto.
        discard_staging(&dest).unwrap();
        assert!(!has_pending_staging(&dest));
        assert_eq!(fs::read(&dest).unwrap(), b"confirmado");
    }
}
