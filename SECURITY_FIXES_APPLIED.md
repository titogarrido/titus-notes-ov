# Correções de Segurança Aplicadas - Titus Notes v0.2.0

**Data:** 31/05/2026  
**Auditoria Base:** SECURITY_AUDIT_REPORT.md

---

## ✅ Vulnerabilidades Corrigidas

### 🔴 Críticas

#### CRIT-001: Arquivo de Credenciais Não Protegido no .gitignore
**Status:** ✅ CORRIGIDO

**Implementação:**
- Adicionado ao `.gitignore`:
  - `.s3-creds`
  - `*.key`, `*.pem`, `*.p12`, `*.pfx`
  - `.env`, `.env.*` (exceto `.env.example`)
  - `secrets.json`, `credentials.json`, `*-credentials.json`
  - `config/secrets.*`
  - Diretórios: `**/app-data/`, `**/user-data/`

**Verificação:**
```bash
git ls-files | grep -E "(s3-creds|\.key|\.pem|credentials)"
# Resultado: 0 arquivos sensíveis trackeados ✅
```

---

#### CRIT-003: Zip Slip Vulnerability em restore_backup
**Status:** ✅ CORRIGIDO

**Localização:** `src-tauri/src/lib.rs` - função `restore_backup`

**Implementação:**
```rust
fn is_safe_zip_entry_name(entry_path: &Path) -> bool {
    // Rejeita paths absolutos
    if entry_path.is_absolute() {
        return false;
    }
    
    // Verifica cada componente do path
    for component in entry_path.components() {
        match component {
            Component::ParentDir => return false,  // Bloqueia ".."
            Component::RootDir => return false,     // Bloqueia "/"
            Component::Prefix(_) => return false,   // Bloqueia "C:\" etc
            _ => {}
        }
    }
    true
}

// Após join, canonicaliza e re-verifica
let canonical_path = out_path.canonicalize()
    .map_err(|e| format!("Erro ao canonicalizar path: {}", e))?;
let canonical_root = data_root.canonicalize()
    .map_err(|e| format!("Erro ao canonicalizar root: {}", e))?;

if !canonical_path.starts_with(&canonical_root) {
    return Err(format!("Path fora do diretório permitido: {:?}", canonical_path));
}
```

**Proteção Belt-and-Suspenders:**
1. Validação pré-join (componentes do path)
2. Validação pós-join (canonicalização + verificação)

---

### 🟠 Alta Severidade

#### HIGH-001: Content Security Policy (CSP) Desabilitada
**Status:** ✅ CORRIGIDO

**Localização:** `src-tauri/tauri.conf.json`

**Implementação:**
```json
{
  "security": {
    "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://localhost:* http://127.0.0.1:* https: ipc:; img-src 'self' data: http: https:; object-src 'none'; frame-ancestors 'none'"
  }
}
```

**Política Aplicada:**
- `script-src 'self'` - Sem inline scripts ou eval()
- `style-src 'self' 'unsafe-inline'` - Permite React inline styles
- `connect-src` - Localhost (Ollama) + HTTPS + IPC
- `img-src` - Self + data URIs + HTTP/HTTPS
- `object-src 'none'` - Bloqueia plugins
- `frame-ancestors 'none'` - Previne clickjacking

**⚠️ Atenção:**
Se alguma funcionalidade parar de funcionar, verificar console do DevTools para violações CSP. Comum:
- Imagens externas (já liberadas)
- Fontes web (não usadas)
- iframes (bloqueados - não usamos)

---

#### HIGH-004: Validação Insuficiente de Nomes de Arquivo
**Status:** ✅ CORRIGIDO

**Localização:** `src-tauri/src/lib.rs` - função `is_safe_filename`

**Implementação:**
```rust
fn is_safe_filename(name: &str) -> bool {
    // Limite de comprimento
    if name.len() > 255 {
        return false;
    }
    
    // Caracteres proibidos expandidos
    let forbidden = ['/', '\\', '\0', '<', '>', ':', '"', '|', '?', '*'];
    if name.chars().any(|c| forbidden.contains(&c)) {
        return false;
    }
    
    // Nomes reservados Windows
    let reserved = ["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", 
                    "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", 
                    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", 
                    "LPT7", "LPT8", "LPT9"];
    let upper = name.to_uppercase();
    if reserved.contains(&upper.as_str()) {
        return false;
    }
    
    true
}
```

**Proteções Adicionadas:**
- Limite de 255 caracteres
- Caracteres bloqueados: `< > : " | ? *`
- Nomes reservados Windows

---

### 🟡 Média Severidade

#### MED-002: Falta de Validação de Tamanho de Arquivo
**Status:** ✅ CORRIGIDO

**Localização:** `src-tauri/src/lib.rs` - função `save_image`

**Implementação:**
```rust
fn save_image(app: AppHandle, data: Vec<u8>, ext: String) -> Result<String, String> {
    // Validação de tamanho
    if data.is_empty() {
        return Err("Imagem vazia".to_string());
    }
    if data.len() > 20 * 1024 * 1024 {  // 20MB
        return Err("Imagem muito grande (máximo 20MB)".to_string());
    }
    
    // Whitelist de extensões
    let allowed_exts = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];
    let safe_ext = ext.trim_start_matches('.').to_lowercase();
    
    if !allowed_exts.contains(&safe_ext.as_str()) {
        // Fallback para PNG se extensão inválida
        safe_ext = "png".to_string();
    }
    
    // Continuar com salvamento...
}
```

**Proteções:**
- Rejeita arquivos vazios
- Limite de 20MB
- Whitelist de extensões: png, jpg, jpeg, gif, webp, bmp, svg
- Fallback para PNG se extensão inválida

---

#### MED-003: Falta de Timeout em Requisições HTTP
**Status:** ✅ CORRIGIDO

**Localização:** `src/lib/ollama.ts`

**Implementação:**
```typescript
function withTimeout(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  
  if (signal) {
    signal.addEventListener('abort', () => {
      clearTimeout(timeoutId);
      controller.abort();
    });
  }
  
  controller.signal.addEventListener('abort', () => {
    clearTimeout(timeoutId);
  });
  
  return controller.signal;
}

// Aplicado em:
// - generateSummaryWithOllama: 5 minutos
// - streamChatWithOllama: 5 minutos  
// - pingOllama: 10 segundos

try {
  const response = await fetch(url, {
    signal: withTimeout(5 * 60 * 1000, opts.signal),
    // ...
  });
} catch (error: any) {
  if (error.name === 'AbortError') {
    throw new Error('Ollama timeout após 5 minutos');
  }
  throw error;
}
```

**Timeouts Configurados:**
- Geração/Chat: 5 minutos
- Ping: 10 segundos
- Mensagens de erro claras

---

## ⏭️ Vulnerabilidades Não Implementadas (Justificadas)

### 🔴 Críticas

#### CRIT-002: Credenciais S3 Armazenadas em Texto Plano
**Status:** ⏭️ NÃO IMPLEMENTADO

**Justificativa:**
- Solicitado explicitamente pelo usuário para não implementar
- Aplicação offline single-user
- Keyring/keychain adiciona complexidade desnecessária
- Arquivo `.s3-creds` agora protegido no `.gitignore` (CRIT-001)
- Permissões Unix 0600 já aplicadas

**Mitigação Atual:**
- Arquivo protegido no `.gitignore`
- Permissões restritivas (Unix)
- Aplicação desktop local

---

#### CRIT-004: Path Traversal em scan_hyprnote_sessions
**Status:** ⏭️ NÃO IMPLEMENTADO

**Justificativa:**
- Aplicação single-user offline
- Path é escolha consciente do usuário/dono
- Não há vetor de ataque remoto
- Usuário tem controle total do sistema de arquivos
- Whitelist seria restritiva demais para uso legítimo

**Contexto:**
Função permite usuário escolher diretório para importar sessões Hyprnote. Em aplicação desktop local, usuário tem direito de acessar qualquer diretório que desejar.

---

### 🟠 Alta Severidade

#### HIGH-002: Comunicação Não Criptografada com Ollama
**Status:** ⏭️ NÃO IMPLEMENTADO

**Justificativa:**
- Design intencional: Ollama roda em localhost
- Comunicação local não atravessa rede
- HTTPS em localhost adiciona complexidade (certificados)
- Não há vetor de ataque man-in-the-middle em loopback
- Ollama não suporta HTTPS por padrão

**Arquitetura:**
```
Titus Notes (localhost) → HTTP → Ollama (localhost:11434)
```

---

#### HIGH-003: Falta de Rate Limiting
**Status:** ⏭️ NÃO IMPLEMENTADO

**Justificativa:**
- Aplicação desktop, não é servidor web
- Single-user: usuário controla suas próprias ações
- Não há vetor de ataque de DoS externo
- Rate limiting seria contra-produtivo para uso legítimo
- Timeouts já implementados (MED-003) previnem travamento

---

#### HIGH-005: Falta de Sanitização em Conteúdo de Notas
**Status:** ⏭️ NÃO IMPLEMENTADO

**Justificativa:**
- Conteúdo é do próprio usuário
- Não há compartilhamento entre usuários
- Aplicação offline: sem vetor de XSS remoto
- Lexical Editor já tem proteções built-in
- CSP agora ativa (HIGH-001) previne execução de scripts inline

**Contexto:**
Em aplicação single-user, usuário é responsável pelo próprio conteúdo. Sanitização excessiva pode quebrar funcionalidades legítimas (markdown, HTML).

---

### 🟡 Média Severidade

#### MED-001: Logs Podem Expor Informações Sensíveis
**Status:** ⏭️ NÃO IMPLEMENTADO

**Justificativa:**
- Código atual não loga credenciais
- Logs são locais (não enviados para servidor)
- Aplicação desktop: logs acessíveis apenas ao usuário
- Sem evidência de logging sensível no código auditado

**Verificação:**
```bash
grep -r "console.log.*password\|console.log.*key\|console.log.*secret" src/
# Resultado: 0 ocorrências
```

---

#### MED-004: Falta de Validação de Modelo Ollama
**Status:** ⏭️ NÃO IMPLEMENTADO

**Justificativa:**
- Nome do modelo vai em JSON body, não em URL
- Ollama API valida modelo no servidor
- Não há vetor de command injection via JSON
- Aplicação local: usuário controla configuração
- Erro de modelo inválido é tratado gracefully

**Exemplo:**
```typescript
fetch('/api/generate', {
  body: JSON.stringify({ 
    model: userInput,  // Vai em JSON, não em shell
    prompt: "..."
  })
})
```

---

### 🟢 Baixa Severidade

#### LOW-001, LOW-002, LOW-003
**Status:** ⏭️ NÃO IMPLEMENTADO

**Justificativa:**
- Severidade baixa
- Custo/benefício não justifica implementação
- Aplicação desktop offline
- Foco em vulnerabilidades críticas e altas

---

## 📊 Resumo Final

### Vulnerabilidades por Status

| Severidade | Total | Corrigidas | Não Implementadas | Taxa de Correção |
|------------|-------|------------|-------------------|------------------|
| 🔴 Crítica | 4 | 2 | 2 | 50% |
| 🟠 Alta | 5 | 2 | 3 | 40% |
| 🟡 Média | 4 | 2 | 2 | 50% |
| 🟢 Baixa | 3 | 0 | 3 | 0% |
| **TOTAL** | **16** | **6** | **10** | **37.5%** |

### Vulnerabilidades Críticas Corrigidas

✅ **CRIT-001**: Proteção de credenciais no .gitignore  
✅ **CRIT-003**: Zip Slip vulnerability corrigida  
⏭️ CRIT-002: Keyring não implementado (solicitado)  
⏭️ CRIT-004: Path traversal justificado (single-user)

### Postura de Segurança

**Antes da Auditoria:**
- 16 vulnerabilidades identificadas
- 4 críticas sem mitigação
- CSP desabilitada
- Validações insuficientes

**Após Correções:**
- 6 vulnerabilidades corrigidas (37.5%)
- 10 não implementadas com justificativa válida
- CSP ativa e configurada
- Validações robustas implementadas
- Proteção contra Zip Slip
- Timeouts configurados
- Credenciais protegidas no Git

**Risco Residual:**
- **Baixo** para aplicação desktop offline single-user
- Vulnerabilidades não implementadas têm justificativa técnica válida
- Foco em proteções relevantes para o contexto de uso

---

## 🔍 Verificações Recomendadas

### Teste de CSP
```bash
# Abrir DevTools → Console
# Verificar se há violações CSP durante uso normal
# Comum: imagens externas, fontes, iframes
```

### Teste de Zip Slip
```bash
# Criar ZIP malicioso com path traversal
zip malicious.zip ../../etc/passwd
# Tentar restaurar backup
# Deve rejeitar com erro de path inválido
```

### Teste de Timeout
```bash
# Desligar Ollama
# Tentar gerar resumo
# Deve falhar após 5 minutos com mensagem clara
```

---

## 📚 Referências

- Relatório Original: [`SECURITY_AUDIT_REPORT.md`](SECURITY_AUDIT_REPORT.md)
- OWASP Top 10 2021: https://owasp.org/Top10/
- CWE Top 25: https://cwe.mitre.org/top25/
- Tauri Security: https://tauri.app/v1/guides/security/

---

**Auditoria Realizada Por:** Claude (Anthropic)  
**Correções Aplicadas Por:** Equipe de Desenvolvimento Titus Notes  
**Próxima Revisão:** Recomendada em 6 meses ou após mudanças significativas