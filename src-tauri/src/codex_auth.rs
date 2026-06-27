//! Login "Entrar com ChatGPT" via OAuth device-code e geração de texto usando a
//! assinatura do ChatGPT (Plus/Pro) — sem CLI e sem custo de API.
//!
//! Fluxo (espelha o `openai/codex`, cliente público do Codex):
//!   1. POST {AUTH_BASE}/api/accounts/deviceauth/usercode  -> { device_auth_id, user_code, interval }
//!   2. usuário abre {AUTH_BASE}/codex/device e digita o user_code
//!   3. POST {AUTH_BASE}/api/accounts/deviceauth/token (poll) -> { authorization_code, code_verifier }
//!   4. POST {AUTH_BASE}/oauth/token (authorization_code + PKCE) -> { access_token, refresh_token, id_token }
//!   5. chamadas vão para {CODEX_BASE}/responses com Bearer + ChatGPT-Account-ID
//!
//! ATENÇÃO: usa o client_id do Codex e um endpoint não-documentado do ChatGPT.
//! É gray-area de ToS e pode quebrar se a OpenAI mudar o fluxo.

use base64::Engine;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_BASE: &str = "https://auth.openai.com";
const CODEX_BASE: &str = "https://chatgpt.com/backend-api/codex";
const USER_AGENT: &str = "titus-notes-codex";
const DEFAULT_MODEL: &str = "gpt-5";

// ---------------------------------------------------------------------------
// Armazenamento dos tokens (fora do banco/backup — fica no diretório de config).
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct StoredAuth {
    access_token: String,
    refresh_token: String,
    #[serde(default)]
    id_token: String,
    #[serde(default)]
    account_id: Option<String>,
}

fn auth_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Não foi possível resolver o diretório de config: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("codex_oauth.json"))
}

fn load_auth(app: &AppHandle) -> Result<Option<StoredAuth>, String> {
    let path = auth_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let auth: StoredAuth = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    if auth.access_token.is_empty() {
        return Ok(None);
    }
    Ok(Some(auth))
}

fn save_auth(app: &AppHandle, auth: &StoredAuth) -> Result<(), String> {
    let path = auth_path(app)?;
    let raw = serde_json::to_string_pretty(auth).map_err(|e| e.to_string())?;
    std::fs::write(&path, raw).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Helpers HTTP / JWT
// ---------------------------------------------------------------------------

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| e.to_string())
}

/// Extrai o `chatgpt_account_id` das claims do id_token (JWT).
fn account_id_from_id_token(id_token: &str) -> Option<String> {
    let payload_b64 = id_token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload_b64.trim_end_matches('='))
        .ok()?;
    let v: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    v.get("https://api.openai.com/auth")?
        .get("chatgpt_account_id")?
        .as_str()
        .map(|s| s.to_string())
}

fn coerce_interval(v: Option<&serde_json::Value>) -> u64 {
    match v {
        Some(serde_json::Value::Number(n)) => n.as_u64().unwrap_or(5),
        Some(serde_json::Value::String(s)) => s.trim().parse().unwrap_or(5),
        _ => 5,
    }
    .clamp(1, 30)
}

// ---------------------------------------------------------------------------
// Estruturas de resposta dos endpoints OAuth
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct UserCodeResp {
    device_auth_id: String,
    #[serde(alias = "user_code", alias = "usercode")]
    user_code: String,
    interval: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct CodeSuccessResp {
    authorization_code: String,
    code_verifier: String,
}

#[derive(Deserialize)]
struct TokenResp {
    #[serde(default)]
    id_token: String,
    access_token: String,
    #[serde(default)]
    refresh_token: String,
}

// ---------------------------------------------------------------------------
// Comandos: login (device-code), status e logout
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceStart {
    verification_url: String,
    user_code: String,
    device_auth_id: String,
    interval: u64,
}

/// Passo 1: pede o user-code. O frontend mostra o código e abre a verification_url.
#[tauri::command]
pub async fn codex_login_start() -> Result<DeviceStart, String> {
    let client = http_client()?;
    let resp = client
        .post(format!("{AUTH_BASE}/api/accounts/deviceauth/usercode"))
        .json(&serde_json::json!({ "client_id": CLIENT_ID }))
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| format!("Falha ao iniciar login: {e}"))?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("Login por device-code indisponível para esta conta/região.".to_string());
    }
    if !resp.status().is_success() {
        let st = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Falha ao iniciar login ({st}): {}", body.trim()));
    }
    let uc: UserCodeResp = resp.json().await.map_err(|e| e.to_string())?;
    Ok(DeviceStart {
        verification_url: format!("{AUTH_BASE}/codex/device"),
        user_code: uc.user_code,
        device_auth_id: uc.device_auth_id,
        interval: coerce_interval(uc.interval.as_ref()),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexStatus {
    logged_in: bool,
    account_id: Option<String>,
}

/// Passo 2/3/4: faz o polling até o usuário autorizar, troca o código por tokens
/// e persiste. Bloqueia por até ~15 min (o frontend aguarda a Promise).
#[tauri::command]
pub async fn codex_login_complete(
    app: AppHandle,
    device_auth_id: String,
    user_code: String,
    interval: u64,
) -> Result<CodexStatus, String> {
    let client = http_client()?;
    let poll_url = format!("{AUTH_BASE}/api/accounts/deviceauth/token");
    let max_wait = Duration::from_secs(15 * 60);
    let start = Instant::now();
    let interval = interval.clamp(1, 30);

    let code_resp: CodeSuccessResp = loop {
        let resp = client
            .post(&poll_url)
            .json(&serde_json::json!({
                "device_auth_id": device_auth_id,
                "user_code": user_code,
            }))
            .timeout(Duration::from_secs(20))
            .send()
            .await
            .map_err(|e| format!("Falha no polling de login: {e}"))?;
        let status = resp.status();
        if status.is_success() {
            break resp.json().await.map_err(|e| e.to_string())?;
        }
        if status == reqwest::StatusCode::FORBIDDEN || status == reqwest::StatusCode::NOT_FOUND {
            if start.elapsed() >= max_wait {
                return Err("Login expirou após 15 minutos. Tente novamente.".to_string());
            }
            tokio::time::sleep(Duration::from_secs(interval)).await;
            continue;
        }
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Login falhou ({status}): {}", body.trim()));
    };

    // Passo 4: troca o authorization_code (com PKCE devolvido pelo servidor) por tokens.
    let redirect_uri = format!("{AUTH_BASE}/deviceauth/callback");
    let resp = client
        .post(format!("{AUTH_BASE}/oauth/token"))
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code_resp.authorization_code.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("client_id", CLIENT_ID),
            ("code_verifier", code_resp.code_verifier.as_str()),
        ])
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("Falha na troca de tokens: {e}"))?;
    if !resp.status().is_success() {
        let st = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Troca de tokens falhou ({st}): {}", body.trim()));
    }
    let tokens: TokenResp = resp.json().await.map_err(|e| e.to_string())?;

    let account_id = account_id_from_id_token(&tokens.id_token);
    let auth = StoredAuth {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        id_token: tokens.id_token,
        account_id: account_id.clone(),
    };
    save_auth(&app, &auth)?;
    Ok(CodexStatus {
        logged_in: true,
        account_id,
    })
}

#[tauri::command]
pub fn codex_auth_status(app: AppHandle) -> Result<CodexStatus, String> {
    match load_auth(&app)? {
        Some(a) => Ok(CodexStatus {
            logged_in: true,
            account_id: a.account_id,
        }),
        None => Ok(CodexStatus {
            logged_in: false,
            account_id: None,
        }),
    }
}

#[tauri::command]
pub fn codex_logout(app: AppHandle) -> Result<(), String> {
    let path = auth_path(&app)?;
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Geração de texto via {CODEX_BASE}/responses
// ---------------------------------------------------------------------------

enum RespErr {
    Unauthorized,
    Other(String),
}

async fn refresh_tokens(client: &reqwest::Client, refresh_token: &str) -> Result<TokenResp, String> {
    let resp = client
        .post(format!("{AUTH_BASE}/oauth/token"))
        .form(&[
            ("grant_type", "refresh_token"),
            ("client_id", CLIENT_ID),
            ("refresh_token", refresh_token),
            ("scope", "openid profile email"),
        ])
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("Falha ao renovar o token: {e}"))?;
    if !resp.status().is_success() {
        let st = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!(
            "Renovação de token falhou ({st}). Saia e entre de novo. {}",
            body.trim()
        ));
    }
    resp.json::<TokenResp>().await.map_err(|e| e.to_string())
}

/// Extrai o texto final de um corpo SSE da Responses API.
fn parse_responses_sse(body: &str) -> Result<String, String> {
    let mut out = String::new();
    let mut completed_fallback: Option<String> = None;
    for line in body.lines() {
        let line = line.trim_start();
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(data) else {
            continue;
        };
        match v.get("type").and_then(|t| t.as_str()) {
            Some("response.output_text.delta") => {
                if let Some(d) = v.get("delta").and_then(|d| d.as_str()) {
                    out.push_str(d);
                }
            }
            Some("response.completed") => {
                // Fallback: concatena todo o texto de saída do objeto final.
                if let Some(items) = v
                    .get("response")
                    .and_then(|r| r.get("output"))
                    .and_then(|o| o.as_array())
                {
                    let mut text = String::new();
                    for item in items {
                        if let Some(content) = item.get("content").and_then(|c| c.as_array()) {
                            for c in content {
                                if let Some(t) = c.get("text").and_then(|t| t.as_str()) {
                                    text.push_str(t);
                                }
                            }
                        }
                    }
                    if !text.is_empty() {
                        completed_fallback = Some(text);
                    }
                }
            }
            Some("response.failed") | Some("error") => {
                let msg = v
                    .get("response")
                    .and_then(|r| r.get("error"))
                    .and_then(|e| e.get("message"))
                    .and_then(|m| m.as_str())
                    .or_else(|| v.get("message").and_then(|m| m.as_str()))
                    .unwrap_or("erro desconhecido");
                return Err(format!("Codex respondeu com erro: {msg}"));
            }
            _ => {}
        }
    }
    let result = if !out.trim().is_empty() {
        out
    } else {
        completed_fallback.unwrap_or_default()
    };
    if result.trim().is_empty() {
        return Err("Resposta vazia do Codex.".to_string());
    }
    Ok(result.trim().to_string())
}

async fn call_responses(
    client: &reqwest::Client,
    auth: &StoredAuth,
    model: &str,
    prompt: &str,
    timeout_secs: u64,
) -> Result<String, RespErr> {
    let mut req = client
        .post(format!("{CODEX_BASE}/responses"))
        .bearer_auth(&auth.access_token)
        .header("OpenAI-Beta", "responses=experimental")
        .header("originator", "codex_cli_rs")
        .header("session_id", uuid::Uuid::new_v4().to_string())
        .header("Accept", "text/event-stream")
        .timeout(Duration::from_secs(timeout_secs));
    if let Some(acc) = &auth.account_id {
        req = req.header("ChatGPT-Account-ID", acc);
    }
    let resp = req
        .json(&serde_json::json!({
            "model": model,
            "input": [
                {
                    "type": "message",
                    "role": "user",
                    "content": [
                        { "type": "input_text", "text": prompt }
                    ]
                }
            ],
            "stream": true,
            "store": false,
        }))
        .send()
        .await
        .map_err(|e| RespErr::Other(format!("Falha ao chamar o Codex: {e}")))?;

    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(RespErr::Unauthorized);
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(RespErr::Other(format!(
            "Codex respondeu {status}: {}",
            body.trim()
        )));
    }
    let body = resp
        .text()
        .await
        .map_err(|e| RespErr::Other(e.to_string()))?;
    parse_responses_sse(&body).map_err(RespErr::Other)
}

#[tauri::command]
pub async fn codex_generate(
    app: AppHandle,
    prompt: String,
    model: Option<String>,
    timeout_secs: Option<u64>,
) -> Result<String, String> {
    let mut auth = load_auth(&app)?.ok_or_else(|| {
        "Você não está conectado ao ChatGPT. Faça login em Configuração de AIs.".to_string()
    })?;
    let model = model
        .map(|m| m.trim().to_string())
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| DEFAULT_MODEL.to_string());
    let timeout = timeout_secs.unwrap_or(300).clamp(10, 1800);
    let client = http_client()?;

    match call_responses(&client, &auth, &model, &prompt, timeout).await {
        Ok(text) => Ok(text),
        Err(RespErr::Other(msg)) => Err(msg),
        Err(RespErr::Unauthorized) => {
            // Token expirou: renova com o refresh_token e tenta de novo.
            if auth.refresh_token.is_empty() {
                return Err("Sessão do ChatGPT expirou. Saia e entre de novo.".to_string());
            }
            let refreshed = refresh_tokens(&client, &auth.refresh_token).await?;
            auth.access_token = refreshed.access_token;
            if !refreshed.refresh_token.is_empty() {
                auth.refresh_token = refreshed.refresh_token;
            }
            if !refreshed.id_token.is_empty() {
                auth.account_id = account_id_from_id_token(&refreshed.id_token);
                auth.id_token = refreshed.id_token;
            }
            save_auth(&app, &auth)?;
            call_responses(&client, &auth, &model, &prompt, timeout)
                .await
                .map_err(|e| match e {
                    RespErr::Other(m) => m,
                    RespErr::Unauthorized => {
                        "Sessão do ChatGPT inválida. Saia e entre de novo.".to_string()
                    }
                })
        }
    }
}
