//! Decisao de sincronizacao Git sem shell e sem force-push (tarefa 11.12).
//!
//! Este modulo espelha, no nucleo Rust, a politica de push do dominio
//! (`git/gitPolicy.ts`): o push so avanca em fast-forward; um head remoto
//! divergente BLOQUEIA (nunca force-push). A implementacao real sobre libgit2
//! usara esta mesma decisao antes de qualquer operacao de rede; aqui validamos
//! a logica com um "remoto" simulado em memoria, cobrindo conflito A/B.

/// Resultado da decisao de push.
#[derive(Debug, PartialEq, Eq)]
pub enum PushDecision {
    /// Fast-forward permitido do head remoto (== base) para o commit local.
    FastForward { from: String, to: String },
    /// Remoto ja aponta para o commit local; nada a enviar.
    UpToDate,
    /// Head remoto divergiu da base: push bloqueado (sem force).
    BlockedDiverged,
}

/// Decide o push comparando a base de origem, o commit local e o head remoto.
pub fn decide_push(base_commit: &str, local_commit: &str, remote_head: &str) -> PushDecision {
    if remote_head == local_commit {
        PushDecision::UpToDate
    } else if remote_head == base_commit {
        PushDecision::FastForward {
            from: remote_head.to_string(),
            to: local_commit.to_string(),
        }
    } else {
        PushDecision::BlockedDiverged
    }
}

/// Remoto bare simulado em memoria para os testes de integracao A/B.
pub struct FakeRemote {
    head: String,
}

impl FakeRemote {
    pub fn new(initial_head: &str) -> Self {
        Self {
            head: initial_head.to_string(),
        }
    }

    pub fn head(&self) -> &str {
        &self.head
    }

    /// Tenta empurrar `local_commit` partindo de `base_commit`. Aplica apenas em
    /// fast-forward; NUNCA sobrescreve um head divergente (sem force-push).
    pub fn try_push(&mut self, base_commit: &str, local_commit: &str) -> PushDecision {
        let decision = decide_push(base_commit, local_commit, &self.head);
        if let PushDecision::FastForward { to, .. } = &decision {
            self.head = to.clone();
        }
        decision
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fast_forward_avanca_o_remoto() {
        let mut remote = FakeRemote::new("A");
        let d = remote.try_push("A", "B");
        assert_eq!(
            d,
            PushDecision::FastForward {
                from: "A".into(),
                to: "B".into()
            }
        );
        assert_eq!(remote.head(), "B");
    }

    #[test]
    fn divergencia_bloqueia_e_preserva_o_remoto() {
        // Maquina A empurrou "X"; maquina B tenta empurrar partindo de "A".
        let mut remote = FakeRemote::new("A");
        assert!(matches!(remote.try_push("A", "X"), PushDecision::FastForward { .. }));
        assert_eq!(remote.head(), "X");

        // B parte da base antiga "A" -> divergencia; remoto NAO e alterado.
        let d = remote.try_push("A", "B");
        assert_eq!(d, PushDecision::BlockedDiverged);
        assert_eq!(remote.head(), "X"); // nunca sobrescreve
    }

    #[test]
    fn up_to_date_nao_altera() {
        let mut remote = FakeRemote::new("B");
        assert_eq!(remote.try_push("A", "B"), PushDecision::UpToDate);
        assert_eq!(remote.head(), "B");
    }
}
