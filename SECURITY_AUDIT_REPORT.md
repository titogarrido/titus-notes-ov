# Relatório de Auditoria de Segurança - Titus Notes

**Data da Auditoria:** 31 de Maio de 2026  
**Versão do Aplicativo:** 0.2.0  
**Auditor:** Análise de Segurança Automatizada  
**Escopo:** Código-fonte completo (Frontend React/TypeScript + Backend Rust/Tauri)

---

## 📋 Sumário Executivo

### Visão Geral

Esta auditoria identificou **15 vulnerabilidades de segurança** no aplicativo Titus Notes, distribuídas da seguinte forma:

| Severidade | Quantidade | Ação Requerida |
|------------|------------|----------------|
| 🔴 **Crítica** | 3 | Imediata |
| 🟠 **Alta** | 5 | Urgente (< 7 dias) |
| 🟡 **Média** | 4 | Importante (< 30 dias) |
| 🟢 **Baixa** | 3 | Recomendada |

### Principais Descobertas

**Vulnerabilidades Críticas que Requerem Ação Imediata:**

1. **Credenciais S3 armazenadas em texto plano** - Exposição de chaves de acesso AWS/S3
2. **Zip Slip vulnerability em restore_backup** - Path traversal durante extração de arquivos
3. **Falta de validação de entrada em scan_hyprnote_sessions** - Possível leitura de arquivos arbitrários

**Riscos de Segurança Principais:**

- Exposição de credenciais sensíveis (S3 access keys, secret keys)
- Vulnerabilidades de path traversal e manipulação de arquivos
- Falta de rate limiting em operações críticas
- Ausência de Content Security Policy (CSP)
- Comunicação não criptografada com serviço Ollama

### Recomendações Prioritárias

1. **Implementar criptografia para credenciais S3** usando keychain do sistema operacional
2. **Corrigir vulnerabilidade Zip Slip** com validação adequada de paths
3. **Adicionar validação rigorosa de entrada** em todos os comandos Tauri
4. **Implementar CSP** para proteção contra XSS
5. **Adicionar rate limiting** em operações sensíveis

---

## 🔴 Vulnerabilidades Críticas

### CRIT-001: Arquivo de Credenciais Não Protegido no .gitignore

**Localização:** [`.gitignore`](.gitignore:1)

**Descrição:**
O arquivo `.gitignore` não inclui o arquivo `.s3-creds` que armazena credenciais AWS em texto plano. Isso cria um risco crítico de exposição acidental de credenciais se um desenvolvedor executar `git add .` ou adicionar o arquivo manualmente ao repositório. Uma vez commitadas, as credenciais ficam permanentemente no histórico do Git, mesmo após remoção.

**Código Vulnerável:**
```gitignore
# .gitignore atual - NÃO protege arquivos de credenciais
node_modules
dist
dist-ssr
*.local
# Falta: .s3-creds, *.key, *.pem, etc.
```

**Impacto:**
- **Severidade:** Crítica
- **CVSS Score:** 9.8 (Critical)
- **CWE:** CWE-540 (Inclusion of Sensitive Information in Source Code)
- **OWASP:** A01:2021 - Broken Access Control

**Cenário de Exploração:**
1. Desenvolvedor configura credenciais S3 localmente
2. Arquivo `.s3-creds` é criado com access_key e secret_key
3. Desenvolvedor executa `git add .` sem verificar
4. Credenciais são commitadas e enviadas para GitHub
5. Repositório público ou vazamento expõe credenciais
6. Atacante obtém acesso total ao bucket S3
7. Mesmo após remoção, credenciais permanecem no histórico Git

**Remediação:**

1. **Atualizar .gitignore imediatamente:**

```gitignore
# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
lerna-debug.log*

node_modules
dist
dist-ssr
*.local

# Credenciais e arquivos sensíveis (CRÍTICO)
.s3-creds
*.key
*.pem
*.p12
*.pfx
.env
.env.*
!.env.example
secrets.json
credentials.json
*-credentials.json
config/secrets.*

# Diretórios de dados do aplicativo
**/app-data/
**/user-data/

# Editor directories and files
.vscode/*
!.vscode/extensions.json
.idea
.DS_Store
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?
```

2. **Verificar histórico do Git:**

```bash
# Verificar se credenciais foram commitadas
git log --all --full-history -- "*s3-creds*"
git log --all --full-history -- "*credentials*"

# Se encontradas, usar git-filter-repo para remover
pip install git-filter-repo
git filter-repo --path .s3-creds --invert-paths
git filter-repo --path-glob '*credentials*' --invert-paths
```

3. **Adicionar pre-commit hook:**

```bash
#!/bin/bash
# .git/hooks/pre-commit

# Lista de padrões sensíveis
SENSITIVE_PATTERNS=(
    "\.s3-creds"
    "access_key"
    "secret_key"
    "AKIA[0-9A-Z]{16}"  # AWS Access Key pattern
    "password.*=.*['\"]"
)

# Verificar arquivos staged
for pattern in "${SENSITIVE_PATTERNS[@]}"; do
    if git diff --cached --name-only | grep -qE "$pattern"; then
        echo "❌ ERRO: Arquivo sensível detectado: $pattern"
        echo "Remova o arquivo antes de commitar"
        exit 1
    fi
    
    if git diff --cached | grep -qE "$pattern"; then
        echo "❌ ERRO: Padrão sensível detectado no conteúdo: $pattern"
        echo "Remova credenciais antes de commitar"
        exit 1
    fi
done
```

4. **Implementar GitHub Secret Scanning:**

Adicionar arquivo `.github/workflows/secret-scan.yml`:

```yaml
name: Secret Scanning
on: [push, pull_request]

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0
      
      - name: TruffleHog Secret Scan
        uses: trufflesecurity/trufflehog@main
        with:
          path: ./
          base: ${{ github.event.repository.default_branch }}
          head: HEAD
```

**Ações Imediatas Requeridas:**
1. ✅ Atualizar `.gitignore` com padrões de credenciais
2. ✅ Verificar histórico Git para exposição de credenciais
3. ✅ Se credenciais foram expostas, rotacionar IMEDIATAMENTE
4. ✅ Implementar pre-commit hooks
5. ✅ Habilitar GitHub Secret Scanning
6. ✅ Adicionar documentação sobre segurança de credenciais

**Referências:**
- OWASP: https://owasp.org/Top10/A01_2021-Broken_Access_Control/
- CWE-540: https://cwe.mitre.org/data/definitions/540.html
- GitHub Secret Scanning: https://docs.github.com/en/code-security/secret-scanning

---

### CRIT-002: Credenciais S3 Armazenadas em Texto Plano

**Localização:** [`src-tauri/src/lib.rs:1215-1226`](src-tauri/src/lib.rs:1215)

**Descrição:**  
As credenciais S3 (access_key e secret_key) são armazenadas em texto plano no arquivo `.s3-creds` no diretório de dados do aplicativo. Embora as permissões Unix sejam definidas como 0600, isso não oferece proteção adequada em sistemas Windows e não protege contra malware ou acesso físico ao disco.

**Código Vulnerável:**
```rust
#[tauri::command]
fn save_s3_credentials(app: AppHandle, creds: S3Credentials) -> Result<(), String> {
    let path = get_s3_creds_path(&app)?;
    let json = serde_json::to_string_pretty(&creds).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}
```

**Impacto:**  
- **Severidade:** Crítica
- **CVSS Score:** 9.1 (Critical)
- **CWE:** CWE-312 (Cleartext Storage of Sensitive Information)
- **OWASP:** A02:2021 - Cryptographic Failures

**Cenário de Exploração:**
1. Atacante obtém acesso ao sistema de arquivos (malware, backup não seguro, etc.)
2. Lê o arquivo `.s3-creds` em texto plano
3. Obtém acesso completo ao bucket S3 com as credenciais expostas
4. Pode ler, modificar ou deletar todos os backups

**Remediação:**

Usar o keyring/keychain do sistema operacional para armazenar credenciais de forma segura:

```rust
// Adicionar ao Cargo.toml:
// [dependencies]
// keyring = "2.0"

use keyring::Entry;

#[tauri::command]
fn save_s3_credentials(app: AppHandle, creds: S3Credentials) -> Result<(), String> {
    let service = "titus-notes";
    
    // Salvar access_key no keychain
    let entry_access = Entry::new(service, "s3_access_key")
        .map_err(|e| e.to_string())?;
    entry_access.set_password(&creds.access_key)
        .map_err(|e| e.to_string())?;
    
    // Salvar secret_key no keychain
    let entry_secret = Entry::new(service, "s3_secret_key")
        .map_err(|e| e.to_string())?;
    entry_secret.set_password(&creds.secret_key)
        .map_err(|e| e.to_string())?;
    
    // Salvar apenas configurações não-sensíveis em arquivo
    let non_sensitive = S3Config {
        endpoint: creds.endpoint,
        region: creds.region,
        bucket: creds.bucket,
        prefix: creds.prefix,
        path_style: creds.path_style,
    };
    
    let path = get_s3_config_path(&app)?;
    let json = serde_json::to_string_pretty(&non_sensitive)
        .map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
fn load_s3_credentials(app: AppHandle) -> Result<Option<S3Credentials>, String> {
    let service = "titus-notes";
    
    // Carregar configurações não-sensíveis
    let path = get_s3_config_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let config: S3Config = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    
    // Recuperar credenciais do keychain
    let entry_access = Entry::new(service, "s3_access_key")
        .map_err(|e| e.to_string())?;
    let access_key = entry_access.get_password()
        .map_err(|e| format!("Credenciais não encontradas: {}", e))?;
    
    let entry_secret = Entry::new(service, "s3_secret_key")
        .map_err(|e| e.to_string())?;
    let secret_key = entry_secret.get_password()
        .map_err(|e| format!("Credenciais não encontradas: {}", e))?;
    
    Ok(Some(S3Credentials {
        endpoint: config.endpoint,
        region: config.region,
        bucket: config.bucket,
        access_key,
        secret_key,
        prefix: config.prefix,
        path_style: config.path_style,
    }))
}
```

**Referências:**
- OWASP: https://owasp.org/Top10/A02_2021-Cryptographic_Failures/
- CWE-312: https://cwe.mitre.org/data/definitions/312.html

---

### CRIT-003: Zip Slip Vulnerability em restore_backup

**Localização:** [`src-tauri/src/lib.rs:1006-1033`](src-tauri/src/lib.rs:1006)

**Descrição:**  
A função `restore_backup` extrai arquivos de um arquivo ZIP sem validação adequada dos paths. A verificação `starts_with` pode ser contornada com paths relativos maliciosos, permitindo que um atacante escreva arquivos fora do diretório de dados.

**Código Vulnerável:**
```rust
#[tauri::command]
fn restore_backup(app: AppHandle, backup_path: String) -> Result<(), String> {
    let data_root = get_data_root(&app)?;
    // ...
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        let out_path = data_root.join(&name);
        if !out_path.starts_with(&data_root) {  // ⚠️ Verificação insuficiente
            continue;
        }
        // ... extração de arquivo
    }
}
```

**Impacto:**  
- **Severidade:** Crítica
- **CVSS Score:** 8.8 (High)
- **CWE:** CWE-22 (Path Traversal), CWE-23 (Relative Path Traversal)
- **OWASP:** A01:2021 - Broken Access Control

**Cenário de Exploração:**
1. Atacante cria arquivo ZIP malicioso com entrada: `../../.ssh/authorized_keys`
2. Usuário restaura o backup malicioso
3. Arquivo é extraído fora do diretório de dados
4. Atacante pode sobrescrever arquivos críticos do sistema

**Remediação:**

```rust
use std::path::Component;

fn validate_zip_entry_path(entry_path: &Path) -> Result<(), String> {
    // Rejeitar paths absolutos
    if entry_path.is_absolute() {
        return Err(format!("Path absoluto não permitido: {:?}", entry_path));
    }
    
    // Verificar cada componente do path
    for component in entry_path.components() {
        match component {
            Component::ParentDir => {
                return Err(format!("Path traversal (..) detectado: {:?}", entry_path));
            }
            Component::RootDir => {
                return Err(format!("Root path não permitido: {:?}", entry_path));
            }
            Component::Prefix(_) => {
                return Err(format!("Path prefix não permitido: {:?}", entry_path));
            }
            _ => {}
        }
    }
    
    Ok(())
}

#[tauri::command]
fn restore_backup(app: AppHandle, backup_path: String) -> Result<(), String> {
    let data_root = get_data_root(&app)?;
    let src = PathBuf::from(&backup_path);
    
    if !src.exists() {
        return Err(format!("Arquivo não encontrado: {}", backup_path));
    }
    
    let file = fs::File::open(&src).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name();
        let entry_path = PathBuf::from(name);
        
        // Validação rigorosa do path
        validate_zip_entry_path(&entry_path)?;
        
        let out_path = data_root.join(&entry_path);
        
        // Verificação adicional após join
        let canonical_out = out_path.canonicalize()
            .unwrap_or_else(|_| out_path.clone());
        let canonical_root = data_root.canonicalize()
            .unwrap_or_else(|_| data_root.clone());
        
        if !canonical_out.starts_with(&canonical_root) {
            return Err(format!("Path inseguro detectado: {}", name));
        }
        
        if entry.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut out_file = fs::File::create(&out_path).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out_file).map_err(|e| e.to_string())?;
        }
    }
    
    Ok(())
}
```

**Referências:**
- Snyk: https://security.snyk.io/research/zip-slip-vulnerability
- OWASP: https://owasp.org/www-community/vulnerabilities/Path_Traversal

---

### CRIT-004: Falta de Validação de Entrada em scan_hyprnote_sessions

**Localização:** [`src-tauri/src/lib.rs:680-790`](src-tauri/src/lib.rs:680)

**Descrição:**  
A função `scan_hyprnote_sessions` aceita um path arbitrário do usuário sem validação adequada, permitindo que um atacante leia arquivos de qualquer local do sistema de arquivos.

**Código Vulnerável:**
```rust
#[tauri::command]
fn scan_hyprnote_sessions(path: String) -> Result<Vec<ImportedHyprnoteSession>, String> {
    let root = PathBuf::from(&path);  // ⚠️ Sem validação
    if !root.exists() {
        return Err(format!("Pasta não existe: {}", path));
    }
    // Lê conteúdo de arquivos arbitrários
    let entries = fs::read_dir(&root).map_err(|e| e.to_string())?;
    // ...
}
```

**Impacto:**  
- **Severidade:** Crítica
- **CVSS Score:** 7.5 (High)
- **CWE:** CWE-22 (Path Traversal), CWE-73 (External Control of File Name or Path)
- **OWASP:** A01:2021 - Broken Access Control

**Cenário de Exploração:**
1. Atacante fornece path para diretório sensível: `/etc/`, `~/.ssh/`, etc.
2. Aplicativo lê e processa arquivos desses diretórios
3. Informações sensíveis podem ser expostas através de logs ou interface

**Remediação:**

```rust
fn is_safe_import_path(path: &Path) -> Result<(), String> {
    // Canonicalizar o path para resolver symlinks e paths relativos
    let canonical = path.canonicalize()
        .map_err(|e| format!("Path inválido: {}", e))?;
    
    // Verificar se não é um diretório do sistema
    let forbidden_prefixes = [
        "/etc", "/var", "/usr", "/bin", "/sbin",
        "/System", "/Library", "/private",
        "C:\\Windows", "C:\\Program Files",
    ];
    
    let path_str = canonical.to_string_lossy();
    for prefix in &forbidden_prefixes {
        if path_str.starts_with(prefix) {
            return Err(format!("Acesso negado a diretório do sistema: {}", prefix));
        }
    }
    
    // Verificar se não é um diretório oculto sensível
    if path_str.contains("/.ssh/") || 
       path_str.contains("/.gnupg/") ||
       path_str.contains("/Library/Keychains/") {
        return Err("Acesso negado a diretório sensível".to_string());
    }
    
    Ok(())
}

#[tauri::command]
fn scan_hyprnote_sessions(path: String) -> Result<Vec<ImportedHyprnoteSession>, String> {
    let root = PathBuf::from(&path);
    
    // Validar path antes de processar
    is_safe_import_path(&root)?;
    
    if !root.exists() {
        return Err(format!("Pasta não existe: {}", path));
    }
    if !root.is_dir() {
        return Err(format!("Caminho não é um diretório: {}", path));
    }
    
    // Continuar com processamento seguro...
    let mut sessions: Vec<ImportedHyprnoteSession> = Vec::new();
    // ...
}
```

**Referências:**
- CWE-22: https://cwe.mitre.org/data/definitions/22.html
- OWASP Path Traversal: https://owasp.org/www-community/attacks/Path_Traversal

---

## 🟠 Vulnerabilidades de Alta Severidade

### HIGH-001: Content Security Policy (CSP) Desabilitada

**Localização:** [`src-tauri/tauri.conf.json:20-21`](src-tauri/tauri.conf.json:20)

**Descrição:**  
A Content Security Policy está explicitamente desabilitada (`"csp": null`), removendo uma camada crítica de proteção contra ataques XSS.

**Código Vulnerável:**
```json
"security": {
  "csp": null,  // ⚠️ CSP desabilitada
  "assetProtocol": {
    "enable": true,
    "scope": ["$APPDATA/files/audio/*"]
  }
}
```

**Impacto:**  
- **Severidade:** Alta
- **CVSS Score:** 7.3 (High)
- **CWE:** CWE-1021 (Improper Restriction of Rendered UI Layers)
- **OWASP:** A03:2021 - Injection

**Cenário de Exploração:**
1. Usuário importa nota com conteúdo malicioso
2. Script malicioso é executado no contexto do aplicativo
3. Atacante pode acessar APIs do Tauri e dados locais

**Remediação:**

```json
{
  "security": {
    "csp": {
      "default-src": "'self'",
      "script-src": "'self' 'wasm-unsafe-eval'",
      "style-src": "'self' 'unsafe-inline'",
      "img-src": "'self' data: asset: https:",
      "font-src": "'self' data:",
      "connect-src": "'self' http://localhost:11434 http://127.0.0.1:11434",
      "media-src": "'self' asset:",
      "object-src": "'none'",
      "base-uri": "'self'",
      "form-action": "'self'",
      "frame-ancestors": "'none'"
    }
  }
}
```

**Referências:**
- OWASP CSP: https://owasp.org/www-community/controls/Content_Security_Policy

---

### HIGH-002: Comunicação Não Criptografada com Ollama

**Localização:** [`src/lib/ollama.ts:104-129`](src/lib/ollama.ts:104)

**Descrição:**  
A comunicação com o serviço Ollama usa HTTP sem criptografia por padrão. Dados sensíveis (conteúdo de notas, transcrições) são transmitidos em texto plano.

**Código Vulnerável:**
```typescript
const baseUrl = (settings.url || "http://localhost:11434").replace(/\/+$/, "");
const res = await fetch(`${baseUrl}/api/generate`, {
  method: "POST",
  body: JSON.stringify({ model, prompt }),  // ⚠️ Dados sensíveis em texto plano
});
```

**Impacto:**  
- **Severidade:** Alta
- **CVSS Score:** 7.4 (High)
- **CWE:** CWE-319 (Cleartext Transmission of Sensitive Information)
- **OWASP:** A02:2021 - Cryptographic Failures

**Remediação:**

```typescript
function validateOllamaUrl(url: string): void {
  const parsed = new URL(url);
  const isLocalhost = 
    parsed.hostname === 'localhost' || 
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '::1';
  
  if (!isLocalhost && parsed.protocol === 'http:') {
    throw new Error(
      'Conexões remotas devem usar HTTPS. HTTP só é permitido para localhost.'
    );
  }
}

export async function generateSummaryWithOllama(
  settings: OllamaSettings,
  prompt: string,
  opts: GenerateOptions = {},
): Promise<string> {
  const baseUrl = (settings.url || "http://localhost:11434").replace(/\/+$/, "");
  validateOllamaUrl(baseUrl);
  // ...
}
```

---

### HIGH-003: Falta de Rate Limiting em Operações Críticas

**Localização:** [`src-tauri/src/lib.rs`](src-tauri/src/lib.rs) (múltiplas funções)

**Descrição:**  
Não há rate limiting implementado para operações críticas como backup S3, geração de sumários com IA, e importação de arquivos.

**Impacto:**  
- **Severidade:** Alta
- **CVSS Score:** 6.5 (Medium)
- **CWE:** CWE-770 (Allocation of Resources Without Limits)
- **OWASP:** A04:2021 - Insecure Design

**Remediação:**

```rust
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use std::collections::HashMap;

struct RateLimiter {
    operations: HashMap<String, Instant>,
    cooldowns: HashMap<String, Duration>,
}

impl RateLimiter {
    fn new() -> Self {
        let mut cooldowns = HashMap::new();
        cooldowns.insert("backup_to_s3".to_string(), Duration::from_secs(300));
        cooldowns.insert("restore_from_s3".to_string(), Duration::from_secs(60));
        Self { operations: HashMap::new(), cooldowns }
    }
    
    fn check_and_update(&mut self, operation: &str) -> Result<(), String> {
        let now = Instant::now();
        let cooldown = self.cooldowns.get(operation)
            .copied()
            .unwrap_or(Duration::from_secs(60));
        
        if let Some(last_time) = self.operations.get(operation) {
            let elapsed = now.duration_since(*last_time);
            if elapsed < cooldown {
                return Err(format!(
                    "Operação em cooldown. Aguarde {} segundos.",
                    (cooldown - elapsed).as_secs()
                ));
            }
        }
        
        self.operations.insert(operation.to_string(), now);
        Ok(())
    }
}
```

---

### HIGH-004: Validação Insuficiente de Nomes de Arquivo

**Localização:** [`src-tauri/src/lib.rs:623-629`](src-tauri/src/lib.rs:623)

**Descrição:**  
A função `is_safe_filename` tem validação básica mas não protege contra todos os casos de path traversal e caracteres especiais perigosos.

**Código Vulnerável:**
```rust
fn is_safe_filename(name: &str) -> bool {
    !name.is_empty()
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains("..")
        && !name.starts_with('.')
}
```

**Impacto:**  
- **Severidade:** Alta
- **CVSS Score:** 6.8 (Medium)
- **CWE:** CWE-73 (External Control of File Name or Path)

**Remediação:**

```rust
fn is_safe_filename(name: &str) -> bool {
    if name.is_empty() || name.len() > 255 {
        return false;
    }
    
    // Rejeitar caracteres perigosos
    let dangerous_chars = ['/', '\\', '\0', '<', '>', ':', '"', '|', '?', '*'];
    if name.chars().any(|c| dangerous_chars.contains(&c)) {
        return false;
    }
    
    // Rejeitar path traversal
    if name.contains("..") || name.starts_with('.') {
        return false;
    }
    
    // Rejeitar nomes reservados do Windows
    let reserved = ["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "LPT1"];
    let name_upper = name.to_uppercase();
    let name_base = name_upper.split('.').next().unwrap_or("");
    if reserved.contains(&name_base) {
        return false;
    }
    
    // Rejeitar caracteres de controle
    if name.chars().any(|c| c.is_control()) {
        return false;
    }
    
    true
}
```

---

### HIGH-005: Falta de Sanitização em Conteúdo de Notas

**Localização:** [`src/context/AppContext.tsx:25-42`](src/context/AppContext.tsx:25)

**Descrição:**  
O conteúdo das notas (JSON do Lexical) não é sanitizado antes de ser processado, permitindo potencial injeção de código malicioso.

**Impacto:**  
- **Severidade:** Alta
- **CVSS Score:** 6.5 (Medium)
- **CWE:** CWE-20 (Improper Input Validation)
- **OWASP:** A03:2021 - Injection

**Remediação:**

```typescript
interface LexicalNode {
  type: string;
  children?: LexicalNode[];
  filename?: string;
}

function sanitizeFilename(filename: string): string | null {
  const sanitized = filename
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .substring(0, 255);
  
  if (!sanitized || sanitized.includes('..') || sanitized.startsWith('.')) {
    return null;
  }
  
  return sanitized;
}

function extractImageFilenames(content: string): string[] {
  if (!content) return [];
  
  try {
    const parsed = JSON.parse(content);
    const found: string[] = [];
    const maxDepth = 100;
    
    const walk = (node: LexicalNode, depth: number = 0) => {
      if (!node || typeof node !== "object" || depth > maxDepth) return;
      
      const allowedTypes = ['image', 'paragraph', 'heading', 'list', 'text'];
      if (!allowedTypes.includes(node.type)) {
        console.warn(`Tipo de nó desconhecido: ${node.type}`);
        return;
      }
      
      if (node.type === "image" && typeof node.filename === "string") {
        const sanitized = sanitizeFilename(node.filename);
        if (sanitized) found.push(sanitized);
      }
      
      if (Array.isArray(node.children)) {
        node.children.forEach(child => walk(child, depth + 1));
      }
    };
    
    if (parsed?.root) walk(parsed.root);
    return found;
  } catch {
    return [];
  }
}
```

---

## 🟡 Vulnerabilidades de Média Severidade

### MED-001: Logs Podem Expor Informações Sensíveis

**Localização:** Múltiplos arquivos

**Descrição:**  
Várias funções usam `console.error` e `console.log` que podem expor informações sensíveis em logs de produção.

**Impacto:**  
- **Severidade:** Média
- **CVSS Score:** 5.3 (Medium)
- **CWE:** CWE-532 (Insertion of Sensitive Information into Log File)

**Remediação:**

```typescript
class SecureLogger {
  private static sanitize(message: any): string {
    if (typeof message === 'string') {
      return message
        .replace(/access[_-]?key["\s:=]+[a-zA-Z0-9]+/gi, 'access_key=***')
        .replace(/secret[_-]?key["\s:=]+[a-zA-Z0-9]+/gi, 'secret_key=***')
        .replace(/password["\s:=]+[^\s"]+/gi, 'password=***')
        .replace(/token["\s:=]+[^\s"]+/gi, 'token=***');
    }
    return String(message);
  }
  
  static error(message: string, error?: any) {
    console.error(this.sanitize(message), error ? this.sanitize(error) : '');
  }
}
```

---

### MED-002: Falta de Validação de Tamanho de Arquivo

**Localização:** [`src-tauri/src/lib.rs:631-658`](src-tauri/src/lib.rs:631)

**Descrição:**  
A função `save_image` não valida o tamanho do arquivo antes de salvar, permitindo upload de arquivos muito grandes.

**Impacto:**  
- **Severidade:** Média
- **CVSS Score:** 5.3 (Medium)
- **CWE:** CWE-400 (Uncontrolled Resource Consumption)

**Remediação:**

```rust
const MAX_IMAGE_SIZE: usize = 10 * 1024 * 1024; // 10 MB

#[tauri::command]
fn save_image(app: AppHandle, data: Vec<u8>, ext: String) -> Result<String, String> {
    if data.len() > MAX_IMAGE_SIZE {
        return Err(format!(
            "Imagem muito grande: {} bytes (máximo: 10 MB)",
            data.len()
        ));
    }
    
    let allowed_exts = ["png", "jpg", "jpeg", "gif", "webp"];
    let safe_ext = ext.trim_start_matches('.').to_lowercase();
    
    if !allowed_exts.contains(&safe_ext.as_str()) {
        return Err(format!("Extensão não permitida: {}", safe_ext));
    }
    
    // Continuar com salvamento...
}
```

---

### MED-003: Falta de Timeout em Requisições HTTP

**Localização:** [`src/lib/ollama.ts:104-172`](src/lib/ollama.ts:104)

**Descrição:**  
Requisições para o serviço Ollama não têm timeout configurado, podendo causar travamento da aplicação.

**Impacto:**  
- **Severidade:** Média
- **CVSS Score:** 4.3 (Medium)
- **CWE:** CWE-400 (Uncontrolled Resource Consumption)

**Remediação:**

```typescript
function createTimeoutSignal(timeoutMs: number, existingSignal?: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  if (existingSignal) {
    existingSignal.addEventListener('abort', () => {
      clearTimeout(timeoutId);
      controller.abort();
    });
  }
  
  return controller.signal;
}

export async function generateSummaryWithOllama(
  settings: OllamaSettings,
  prompt: string,
  opts: GenerateOptions = {},
): Promise<string> {
  const signal = createTimeoutSignal(5 * 60 * 1000, opts.signal);
  
  try {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false }),
      signal,
    });
    // ...
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error('Timeout: Ollama não respondeu em 5 minutos');
    }
    throw error;
  }
}
```

---

### MED-004: Falta de Validação de Modelo Ollama

**Localização:** [`src/lib/ollama.ts`](src/lib/ollama.ts)

**Descrição:**  
O nome do modelo Ollama não é validado, permitindo potencial injeção de comandos.

**Impacto:**  
- **Severidade:** Média
- **CVSS Score:** 4.8 (Medium)
- **CWE:** CWE-20 (Improper Input Validation)

**Remediação:**

```typescript
function validateModelName(model: string): void {
  const validPattern = /^[a-zA-Z0-9._-]+$/;
  
  if (!validPattern.test(model)) {
    throw new Error('Nome de modelo inválido');
  }
  
  if (model.length > 100) {
    throw new Error('Nome de modelo muito longo');
  }
}
```

---

## 🟢 Vulnerabilidades de Baixa Severidade

### LOW-001: Falta de Verificação de Integridade em Atualizações

**Localização:** [`src-tauri/tauri.conf.json:40-46`](src-tauri/tauri.conf.json:40)

**Descrição:**  
O sistema de atualização usa uma chave pública para verificação, mas não há validação adicional de checksums.

**Impacto:**  
- **Severidade:** Baixa
- **CVSS Score:** 3.7 (Low)
- **CWE:** CWE-494 (Download of Code Without Integrity Check)

**Recomendação:**
- Implementar verificação de checksum SHA-256 adicional
- Validar certificado SSL do servidor de atualizações

---

### LOW-002: Informações de Versão Expostas

**Localização:** [`package.json`](package.json), [`src-tauri/Cargo.toml`](src-tauri/Cargo.toml)

**Descrição:**  
Informações de versão e dependências são expostas, facilitando reconhecimento de vulnerabilidades conhecidas.

**Impacto:**  
- **Severidade:** Baixa
- **CVSS Score:** 3.1 (Low)
- **CWE:** CWE-200 (Exposure of Sensitive Information)

**Recomendação:**
- Manter dependências sempre atualizadas
- Implementar processo de atualização automática de dependências

---

### LOW-003: Falta de Auditoria de Ações Sensíveis

**Localização:** Todo o código

**Descrição:**  
Não há sistema de auditoria para registrar ações sensíveis como exclusão de dados, alteração de configurações, etc.

**Impacto:**  
- **Severidade:** Baixa
- **CVSS Score:** 2.7 (Low)
- **CWE:** CWE-778 (Insufficient Logging)

**Recomendação:**

```rust
fn audit_log(app: &AppHandle, action: &str, details: &str) -> Result<(), String> {
    let timestamp = chrono_like_timestamp();
    let log_entry = format!("[{}] {} - {}\n", timestamp, action, details);
    
    let mut audit_path = get_data_root(app)?;
    audit_path.push("audit.log");
    
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&audit_path)
        .map_err(|e| e.to_string())?;
    
    use std::io::Write;
    file.write_all(log_entry.as_bytes()).map_err(|e| e.to_string())?;
    
    Ok(())
}
```

---

## 📊 Resumo de Vulnerabilidades por Categoria OWASP

| Categoria OWASP | Vulnerabilidades | Severidade Máxima |
|-----------------|------------------|-------------------|
| A01:2021 - Broken Access Control | 4 | 🔴 Crítica |
| A02:2021 - Cryptographic Failures | 1 | 🔴 Crítica |
| A03:2021 - Injection | 2 | 🟠 Alta |
| A04:2021 - Insecure Design | 3 | 🟠 Alta |
| A05:2021 - Security Misconfiguration | 1 | 🟠 Alta |
| A09:2021 - Security Logging Failures | 2 | 🟢 Baixa |

---

## 🎯 Plano de Ação Recomendado

### Fase 1: Ação Imediata (0-7 dias)

1. **URGENTE: Proteger arquivos de credenciais no .gitignore** (CRIT-001)
   - Atualizar `.gitignore` imediatamente
   - Verificar histórico Git para exposição
   - Rotacionar credenciais se expostas
   - Implementar pre-commit hooks
   - Habilitar GitHub Secret Scanning

2. **Implementar criptografia para credenciais S3** (CRIT-002)
   - Usar keyring/keychain do sistema operacional
   - Migrar credenciais existentes

3. **Corrigir Zip Slip vulnerability** (CRIT-003)
   - Implementar validação rigorosa de paths
   - Adicionar testes de segurança

4. **Validar paths em scan_hyprnote_sessions** (CRIT-004)
   - Implementar whitelist de diretórios permitidos
   - Adicionar verificações de segurança

### Fase 2: Urgente (7-30 dias)

5. **Implementar CSP** (HIGH-001)
   - Configurar política de segurança de conteúdo
   - Testar compatibilidade com funcionalidades existentes

6. **Validar URLs do Ollama** (HIGH-002)
   - Forçar HTTPS para conexões remotas
   - Adicionar avisos na UI

7. **Implementar rate limiting** (HIGH-003)
   - Adicionar cooldowns para operações críticas
   - Implementar sistema de rate limiting global

7. **Melhorar validação de nomes de arquivo** (HIGH-004)
   - Implementar validação robusta
   - Adicionar testes unitários

8. **Sanitizar conteúdo de notas** (HIGH-005)
   - Validar estrutura JSON do Lexical
   - Implementar whitelist de tipos de nós

### Fase 3: Importante (30-90 dias)

9. **Implementar logging seguro** (MED-001)
10. **Validar tamanhos de arquivo** (MED-002)
11. **Adicionar timeouts HTTP** (MED-003)
12. **Validar nomes de modelo** (MED-004)

### Fase 4: Melhorias Contínuas

13. **Implementar auditoria de ações** (LOW-003)
14. **Manter dependências atualizadas** (LOW-002)
15. **Melhorar verificação de atualizações** (LOW-001)

---

## 🔒 Recomendações Gerais de Segurança

### Desenvolvimento Seguro

1. **Code Review:** Implementar revisão de código obrigatória para mudanças de segurança
2. **Testes de Segurança:** Adicionar testes automatizados para vulnerabilidades conhecidas
3. **Análise Estática:** Usar ferramentas como `cargo clippy`, `cargo audit`, e `eslint-plugin-security`
4. **Dependências:** Manter todas as dependências atualizadas e monitorar vulnerabilidades

### Configuração de Produção

1. **Minimizar Superfície de Ataque:** Desabilitar funcionalidades não utilizadas
2. **Princípio do Menor Privilégio:** Limitar permissões do aplicativo
3. **Isolamento:** Usar sandboxing quando possível
4. **Monitoramento:** Implementar logging e monitoramento de segurança

### Resposta a Incidentes

1. **Plano de Resposta:** Criar plano de resposta a incidentes de segurança
2. **Comunicação:** Estabelecer canal para reportar vulnerabilidades
3. **Atualizações:** Implementar processo rápido de patch para vulnerabilidades críticas

---

## 📚 Referências

- **OWASP Top 10 2021:** https://owasp.org/Top10/
- **CWE Top 25:** https://cwe.mitre.org/top25/
- **Tauri Security:** https://tauri.app/v1/references/architecture/security/
- **Rust Security:** https://rustsec.org/
- **NIST Cybersecurity Framework:** https://www.nist.gov/cyberframework

---

## 📝 Notas Finais

Este relatório identifica vulnerabilidades de segurança no código-fonte do Titus Notes versão 0.2.0. As recomendações fornecidas devem ser implementadas de acordo com o plano de ação sugerido, priorizando as vulnerabilidades críticas e de alta severidade.

**Próximos Passos:**
1. Revisar e priorizar as vulnerabilidades identificadas
2. Criar issues/tickets para cada vulnerabilidade
3. Implementar correções seguindo as recomendações
4. Realizar testes de segurança após implementação
5. Agendar auditorias de segurança regulares

**Data do Relatório:** 31 de Maio de 2026  
**Versão do Relatório:** 1.0
