// Detecção de reunião: monitora quais processos estão capturando o microfone
// via Core Audio process objects (kAudioHardwarePropertyProcessObjectList,
// macOS 14.4+). Quando um app de reunião (Teams, Zoom, Meet no navegador,
// FaceTime…) começa a usar o microfone, emite `meeting-started` para o
// frontend oferecer a gravação; quando o app solta o microfone, emite
// `meeting-ended` e encerra a gravação ativa (se ela foi marcada com
// stop_on_meeting_end).
//
// Em versões do macOS sem a API, a primeira consulta falha e o monitor se
// desativa silenciosamente — o resto do app não é afetado. A consulta lê só
// metadados (quem usa o mic), não áudio, e não dispara prompt de permissão.

use std::ffi::c_void;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

const fn fourcc(s: &[u8; 4]) -> u32 {
    u32::from_be_bytes(*s)
}

/// kAudioObjectSystemObject
const SYSTEM_OBJECT: u32 = 1;
/// kAudioHardwarePropertyProcessObjectList
const PROP_PROCESS_OBJECT_LIST: u32 = fourcc(b"prs#");
/// kAudioProcessPropertyPID
const PROP_PID: u32 = fourcc(b"ppid");
/// kAudioProcessPropertyBundleID
const PROP_BUNDLE_ID: u32 = fourcc(b"pbid");
/// kAudioProcessPropertyIsRunningInput
const PROP_IS_RUNNING_INPUT: u32 = fourcc(b"piri");
/// kAudioObjectPropertyScopeGlobal
const SCOPE_GLOBAL: u32 = fourcc(b"glob");
/// kAudioObjectPropertyElementMain
const ELEMENT_MAIN: u32 = 0;
/// kCFStringEncodingUTF8
const CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;

const POLL_INTERVAL: Duration = Duration::from_secs(2);
/// Sondagens consecutivas com mic em uso antes de anunciar (filtra Siri/ditado).
const START_CONFIRM_POLLS: u32 = 2;
/// Tolerância de ausência antes de considerar a reunião encerrada (o app pode
/// soltar o mic por instantes ao trocar de dispositivo de áudio).
const END_GRACE: Duration = Duration::from_secs(10);

#[repr(C)]
struct AudioObjectPropertyAddress {
    selector: u32,
    scope: u32,
    element: u32,
}

#[link(name = "CoreAudio", kind = "framework")]
extern "C" {
    fn AudioObjectGetPropertyDataSize(
        object_id: u32,
        address: *const AudioObjectPropertyAddress,
        qualifier_size: u32,
        qualifier: *const c_void,
        out_size: *mut u32,
    ) -> i32;
    fn AudioObjectGetPropertyData(
        object_id: u32,
        address: *const AudioObjectPropertyAddress,
        qualifier_size: u32,
        qualifier: *const c_void,
        io_size: *mut u32,
        out_data: *mut c_void,
    ) -> i32;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFStringGetCString(s: *const c_void, buffer: *mut u8, buffer_size: isize, encoding: u32)
        -> u8;
    fn CFRelease(cf: *const c_void);
}

fn prop_addr(selector: u32) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress {
        selector,
        scope: SCOPE_GLOBAL,
        element: ELEMENT_MAIN,
    }
}

fn get_u32(object: u32, selector: u32) -> Option<u32> {
    let addr = prop_addr(selector);
    let mut value: u32 = 0;
    let mut size = std::mem::size_of::<u32>() as u32;
    let status = unsafe {
        AudioObjectGetPropertyData(
            object,
            &addr,
            0,
            std::ptr::null(),
            &mut size,
            (&mut value as *mut u32).cast(),
        )
    };
    (status == 0).then_some(value)
}

fn get_pid(object: u32) -> Option<i32> {
    get_u32(object, PROP_PID).map(|v| v as i32)
}

fn get_bundle_id(object: u32) -> Option<String> {
    let addr = prop_addr(PROP_BUNDLE_ID);
    let mut cf: *const c_void = std::ptr::null();
    let mut size = std::mem::size_of::<*const c_void>() as u32;
    let status = unsafe {
        AudioObjectGetPropertyData(
            object,
            &addr,
            0,
            std::ptr::null(),
            &mut size,
            (&mut cf as *mut *const c_void).cast(),
        )
    };
    if status != 0 || cf.is_null() {
        return None;
    }
    let mut buf = [0u8; 512];
    let ok = unsafe { CFStringGetCString(cf, buf.as_mut_ptr(), buf.len() as isize, CF_STRING_ENCODING_UTF8) };
    unsafe { CFRelease(cf) };
    if ok == 0 {
        return None;
    }
    let end = buf.iter().position(|b| *b == 0).unwrap_or(buf.len());
    Some(String::from_utf8_lossy(&buf[..end]).to_string())
}

fn process_objects() -> Result<Vec<u32>, i32> {
    let addr = prop_addr(PROP_PROCESS_OBJECT_LIST);
    let mut size: u32 = 0;
    let status = unsafe {
        AudioObjectGetPropertyDataSize(SYSTEM_OBJECT, &addr, 0, std::ptr::null(), &mut size)
    };
    if status != 0 {
        return Err(status);
    }
    let count = size as usize / std::mem::size_of::<u32>();
    let mut ids = vec![0u32; count];
    if count == 0 {
        return Ok(ids);
    }
    let status = unsafe {
        AudioObjectGetPropertyData(
            SYSTEM_OBJECT,
            &addr,
            0,
            std::ptr::null(),
            &mut size,
            ids.as_mut_ptr().cast(),
        )
    };
    if status != 0 {
        return Err(status);
    }
    ids.truncate(size as usize / std::mem::size_of::<u32>());
    Ok(ids)
}

/// Bundle IDs de processos externos com captura de microfone ativa.
fn external_mic_users(my_pid: i32) -> Result<Vec<String>, i32> {
    let mut out = Vec::new();
    for obj in process_objects()? {
        if get_u32(obj, PROP_IS_RUNNING_INPUT).unwrap_or(0) == 0 {
            continue;
        }
        if get_pid(obj) == Some(my_pid) {
            continue;
        }
        let bundle = get_bundle_id(obj).unwrap_or_default();
        if is_ignored_bundle(&bundle) {
            continue;
        }
        out.push(bundle);
    }
    Ok(out)
}

/// Ignora processos de sistema da Apple (Siri, ditado, Central de Controle…),
/// mas mantém os que hospedam reuniões: FaceTime e Safari (Meet/Teams na web
/// capturam o mic via processo WebKit).
fn is_ignored_bundle(bundle: &str) -> bool {
    if bundle.starts_with("com.apple.") {
        let allowed = bundle == "com.apple.FaceTime"
            || bundle == "com.apple.Safari"
            || bundle.starts_with("com.apple.WebKit");
        return !allowed;
    }
    false
}

const KNOWN_APPS: &[(&str, &str)] = &[
    ("com.microsoft.teams", "Microsoft Teams"),
    ("us.zoom", "Zoom"),
    ("com.cisco", "Webex"),
    ("com.google.Chrome", "Google Chrome"),
    ("com.microsoft.edgemac", "Microsoft Edge"),
    ("org.mozilla.firefox", "Firefox"),
    ("com.brave.Browser", "Brave"),
    ("company.thebrowser.Browser", "Arc"),
    ("com.apple.Safari", "Safari"),
    ("com.apple.WebKit", "Safari"),
    ("com.apple.FaceTime", "FaceTime"),
    ("com.tinyspeck.slackmacgap", "Slack"),
    ("com.hnc.Discord", "Discord"),
];

fn friendly_app_name(bundle: &str) -> String {
    for (prefix, name) in KNOWN_APPS {
        if bundle.starts_with(prefix) {
            return (*name).to_string();
        }
    }
    if bundle.is_empty() {
        return "Um aplicativo".to_string();
    }
    bundle.rsplit('.').next().unwrap_or(bundle).to_string()
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MeetingEvent {
    app_name: String,
    bundle_id: String,
}

pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || monitor_loop(app));
}

fn monitor_loop(app: AppHandle) {
    let my_pid = std::process::id() as i32;

    // API disponível só no macOS 14.4+ — em versões antigas, desativa-se.
    if let Err(status) = process_objects() {
        eprintln!(
            "Detecção de reunião desativada (Core Audio process objects exige macOS 14.4+; OSStatus {})",
            status
        );
        return;
    }

    let mut confirm_polls: u32 = 0;
    let mut session: Option<MeetingEvent> = None;
    let mut last_seen = Instant::now();

    loop {
        std::thread::sleep(POLL_INTERVAL);
        let users = match external_mic_users(my_pid) {
            Ok(u) => u,
            Err(_) => continue,
        };
        let present = !users.is_empty();

        match (&session, present) {
            (None, true) => {
                confirm_polls += 1;
                if confirm_polls >= START_CONFIRM_POLLS {
                    confirm_polls = 0;
                    // Prefere um app de reunião conhecido entre os capturando.
                    let bundle = users
                        .iter()
                        .find(|b| KNOWN_APPS.iter().any(|(p, _)| b.starts_with(p)))
                        .unwrap_or(&users[0])
                        .clone();
                    let ev = MeetingEvent {
                        app_name: friendly_app_name(&bundle),
                        bundle_id: bundle,
                    };
                    let _ = app.emit("meeting-started", ev.clone());
                    session = Some(ev);
                    last_seen = Instant::now();
                }
            }
            (None, false) => {
                confirm_polls = 0;
            }
            (Some(_), true) => {
                last_seen = Instant::now();
            }
            (Some(ev), false) => {
                if last_seen.elapsed() >= END_GRACE {
                    let _ = app.emit("meeting-ended", ev.clone());
                    crate::recorder::request_meeting_stop(&app);
                    session = None;
                    confirm_polls = 0;
                }
            }
        }
    }
}
