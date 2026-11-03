# Distribuicao e instaladores assinados (tarefa 17.1)

Este documento descreve como os instaladores assinados do aplicativo desktop sao
produzidos. Ele acompanha a configuracao em `src-tauri/tauri.conf.json` e o
workflow `.github/workflows/desktop-release.yml`.

## Alvos de build

| Plataforma | Arquitetura        | Formato        | Requisito de SO |
| ---------- | ------------------ | -------------- | --------------- |
| Windows    | x64 (x86_64)       | NSIS (`.exe`)  | Windows 10/11   |
| macOS      | Intel (x86_64)     | `.app` + `.dmg`| macOS 12+       |
| macOS      | Apple Silicon (arm64) | `.app` + `.dmg` | macOS 12+   |

- No Windows, o WebView2 e instalado sob demanda (`downloadBootstrapper`), sem
  exigir que o operador o instale manualmente.
- O instalador NSIS usa idioma Portugues (Brasil) e instalacao por usuario
  (`currentUser`), evitando pedir elevacao de administrador.

## Scripts locais

Na pasta `desktop-app/`:

- `npm run dist:windows` — instalador NSIS x64.
- `npm run dist:macos:intel` — pacote macOS Intel.
- `npm run dist:macos:arm` — pacote macOS Apple Silicon.

Esses comandos exigem a toolchain Rust e os pre-requisitos do Tauri instalados
na maquina. Em release oficial, use o workflow de CI (abaixo), que tambem assina
e notariza.

## Assinatura, notarizacao e updater

Os segredos ficam EXCLUSIVAMENTE nos secrets protegidos do repositorio — nunca
no codigo ou em arquivos versionados:

- `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — chave do
  atualizador do Tauri.
- macOS: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
  `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` —
  assinatura (Developer ID) e notarizacao.
- Windows: `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD` — assinatura
  Authenticode.

Um artefato nao assinado (ou nao notarizado, no macOS) e rejeitado pelo gate de
distribuicao (`src/domain/distribution/artifactGate.ts`), cujas regras sao
verificadas pelos testes da tarefa 17.6
(`src/domain/distribution/artifactGate.test.ts`), executados no CI via
`npm run test`.

## Release

1. Crie uma tag `desktop-vX.Y.Z` (ou dispare o workflow manualmente).
2. O workflow `Desktop Release` roda a matriz Windows/macOS, executa typecheck e
   testes, e gera os instaladores assinados como artefatos.
3. Este workflow NAO publica nada no GitHub Pages nem altera o visualizador
   vigente: ele apenas produz os instaladores.
