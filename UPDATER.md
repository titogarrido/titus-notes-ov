# OTA Updates — Titus Notes

App usa `tauri-plugin-updater` v2 com GitHub Releases como endpoint.

## Setup inicial (uma vez)

### 1. Gerar par de chaves

```bash
npm run tauri signer generate -- -w ~/.tauri/titus-notes.key
```

Vai pedir uma senha (anota — vira segredo no GitHub). Gera:

- `~/.tauri/titus-notes.key` — **PRIVADA**. Nunca commitar. Vai pro segredo do GitHub.
- `~/.tauri/titus-notes.key.pub` — pública. Vai no `tauri.conf.json`.

### 2. Colar a pública no `tauri.conf.json`

Substitua `REPLACE_WITH_CONTENTS_OF_titus-notes.key.pub` pelo conteúdo do `.key.pub`:

```bash
cat ~/.tauri/titus-notes.key.pub
```

Exemplo final:

```json
"plugins": {
  "updater": {
    "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlz...",
    "endpoints": [
      "https://github.com/titogarrido/titus-notes-ov/releases/latest/download/latest.json"
    ]
  }
}
```

### 3. GitHub Secrets

No repositório (`Settings → Secrets and variables → Actions`), criar:

- `TAURI_SIGNING_PRIVATE_KEY` — cole o conteúdo de `~/.tauri/titus-notes.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — a senha usada no `signer generate`

## Publicando uma nova versão

1. Bump em **três** lugares (mantenha sincronizado):
   - `package.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/tauri.conf.json`

2. Commit + tag:

```bash
git add -A
git commit -m "release: v0.2.0"
git tag v0.2.0
git push origin main --tags
```

3. O workflow `.github/workflows/release.yml` dispara, builda macOS arm64/x64, Windows, Linux, assina e cria o Release no GitHub com:
   - Bundles (`.dmg`, `.app.tar.gz`, `.msi`, `.AppImage`, `.deb`)
   - Assinaturas (`.sig`)
   - `latest.json` (manifesto do updater)

4. Usuários abrem `Configurações → Atualizações → Verificar` e o app baixa/instala/relança.

## Como o updater funciona no macOS

Não troca o `.app` em execução. Baixa `.app.tar.gz`, extrai num temp, substitui o `.app` instalado, mata o processo atual e relança. Por isso `createUpdaterArtifacts: true` no `tauri.conf.json` força gerar o `.tar.gz` (além do DMG).

## Sem Apple Code Signing

App roda mas o Gatekeeper avisa "developer não verificado" na primeira abertura. Updates funcionam normalmente. Pra remover o warning, precisaria de Apple Developer Program ($99/ano) + adicionar credenciais no workflow.

## Troubleshooting

- **"signature mismatch"**: pubkey no `tauri.conf.json` não bate com a chave privada usada no build. Re-cole.
- **"no updates available" sempre**: confere se a tag começa com `v` e a release não está como draft.
- **`latest.json` 404**: o asset não foi enviado. Confere o log do workflow `tauri-action`.
- **Windows não atualiza**: `updaterJsonPreferNsis: false` força MSI no manifesto; se quiser NSIS, muda pra `true`.
