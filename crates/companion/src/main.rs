use serde_json::{Value, json};
mod activation;
mod double_tap;
mod fonts;
use std::{
    io::{self, BufRead, Write},
    path::PathBuf,
    sync::{
        Mutex,
        atomic::{AtomicBool, AtomicIsize, AtomicU32, Ordering},
    },
    thread,
    time::Duration,
};
use windows::Win32::{
    Foundation::*,
    System::{
        Com::*,
        Threading::{AttachThreadInput, GetCurrentThreadId},
    },
    UI::{
        Accessibility::*,
        Input::{Ime::*, KeyboardAndMouse::*},
        WindowsAndMessaging::*,
    },
};

static APP: AtomicIsize = AtomicIsize::new(0);
static PREVIOUS: AtomicIsize = AtomicIsize::new(0);
static AUTOMATIC: AtomicBool = AtomicBool::new(true);
static DOUBLE_CTRL: AtomicBool = AtomicBool::new(true);
const UPDATE_ACTIVATION: u32 = WM_APP + 1;
static LOOP_THREAD: AtomicU32 = AtomicU32::new(0);
static OUTPUT: Mutex<()> = Mutex::new(());

fn emit(value: Value) {
    let _lock = OUTPUT.lock().unwrap();
    let mut out = io::stdout().lock();
    let _ = writeln!(out, "{}", value);
    let _ = out.flush();
}
fn hwnd(n: isize) -> HWND {
    HWND(n as *mut _)
}
fn settings_path() -> PathBuf {
    std::env::var_os("ZIBAN_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap_or_default())
                .join("Rizum")
                .join("Ziban")
        })
        .join("preferences.json")
}
fn load() -> Value {
    std::fs::read(settings_path())
        .ok()
        .and_then(|v| serde_json::from_slice(&v).ok())
        .unwrap_or(json!({}))
}
fn save(value: &Value) -> io::Result<()> {
    let path = settings_path();
    std::fs::create_dir_all(path.parent().unwrap())?;
    let temporary = path.with_extension("tmp");
    let mut f = std::fs::File::create(&temporary)?;
    f.write_all(&serde_json::to_vec_pretty(value)?)?;
    f.sync_all()?;
    drop(f);
    // Windows rename cannot replace an existing destination. MoveFileEx keeps replacement atomic.
    use windows::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };
    use windows::core::PCWSTR;
    let a: Vec<u16> = temporary
        .as_os_str()
        .to_string_lossy()
        .encode_utf16()
        .chain(Some(0))
        .collect();
    let b: Vec<u16> = path
        .as_os_str()
        .to_string_lossy()
        .encode_utf16()
        .chain(Some(0))
        .collect();
    unsafe {
        MoveFileExW(
            PCWSTR(a.as_ptr()),
            PCWSTR(b.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
        .map_err(io::Error::other)?;
    }
    Ok(())
}

unsafe fn activate(reason: &str) {
    let target = hwnd(APP.load(Ordering::Relaxed));
    if target.0.is_null() || !unsafe { IsWindow(Some(target)).as_bool() } {
        return;
    }
    let foreground = unsafe { GetForegroundWindow() };
    if foreground != target && !foreground.0.is_null() {
        PREVIOUS.store(foreground.0 as isize, Ordering::Relaxed);
    }
    unsafe {
        if reason == "ime" {
            let layout = GetKeyboardLayout(GetWindowThreadProcessId(foreground, None));
            let _ = PostMessageW(
                Some(target),
                WM_INPUTLANGCHANGEREQUEST,
                WPARAM(0),
                LPARAM(layout.0 as isize),
            );
        }
        let style = GetWindowLongPtrW(target, GWL_EXSTYLE);
        SetWindowLongPtrW(
            target,
            GWL_EXSTYLE,
            style & !((WS_EX_TRANSPARENT.0 | WS_EX_NOACTIVATE.0) as isize),
        );
        let _ = ShowWindow(target, SW_SHOWNORMAL);
        if !SetForegroundWindow(target).as_bool() {
            let foreground_thread = GetWindowThreadProcessId(foreground, None);
            let current_thread = GetCurrentThreadId();
            let mut message = MSG::default();
            let _ = PeekMessageW(&mut message, None, 0, 0, PM_NOREMOVE);
            if AttachThreadInput(current_thread, foreground_thread, true).as_bool() {
                let _ = SetForegroundWindow(target);
                let _ = AttachThreadInput(current_thread, foreground_thread, false);
            }
        }
        if reason == "ime" {
            let ime = ImmGetDefaultIMEWnd(target);
            if !ime.0.is_null() {
                let _ = SendMessageTimeoutW(
                    ime,
                    WM_IME_CONTROL,
                    WPARAM(6),
                    LPARAM(1),
                    SMTO_ABORTIFHUNG,
                    60,
                    None,
                );
            }
        }
    }
    emit(json!({"event":"activate","reason":reason}));
}

unsafe fn editable(automation: &IUIAutomation, foreground: HWND) -> Option<bool> {
    let mut process = 0;
    let tid = unsafe { GetWindowThreadProcessId(foreground, Some(&mut process)) };
    let mut info = GUITHREADINFO {
        cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
        ..Default::default()
    };
    if unsafe { GetGUIThreadInfo(tid, &mut info) }.is_err() {
        return None;
    }
    if !info.hwndCaret.0.is_null() {
        return Some(true);
    }
    let mut class_name = [0u16; 256];
    let len = unsafe { GetClassNameW(info.hwndFocus, &mut class_name) };
    if len > 0
        && String::from_utf16_lossy(&class_name[..len as usize])
            .to_ascii_lowercase()
            .contains("edit")
    {
        return Some(true);
    }
    let mut element = unsafe { automation.GetFocusedElement() }.ok()?;
    if unsafe { element.CurrentProcessId() }.ok()? as u32 != process {
        return None;
    }
    let walker = unsafe { automation.ControlViewWalker() }.ok()?;
    for _ in 0..6 {
        if unsafe { element.CurrentIsPassword() }.ok()?.as_bool() {
            return Some(true);
        }
        let control = unsafe { element.CurrentControlType() }.ok()?;
        if control == UIA_CustomControlTypeId {
            return None;
        }
        if [
            UIA_EditControlTypeId,
            UIA_DocumentControlTypeId,
            UIA_ComboBoxControlTypeId,
        ]
        .contains(&control)
        {
            return Some(true);
        }
        if unsafe { element.GetCurrentPattern(UIA_TextPatternId) }.is_ok()
            || unsafe { element.GetCurrentPattern(UIA_TextEditPatternId) }.is_ok()
        {
            return Some(true);
        }
        if let Ok(value) =
            unsafe { element.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId) }
        {
            if !unsafe { value.CurrentIsReadOnly() }.ok()?.as_bool() {
                return Some(true);
            }
        }
        if control == UIA_WindowControlTypeId {
            return Some(false);
        }
        match unsafe { walker.GetParentElement(&element) } {
            Ok(parent) => element = parent,
            Err(_) => return Some(false),
        }
    }
    Some(false)
}

unsafe fn chinese_mode(foreground: HWND) -> bool {
    let tid = unsafe { GetWindowThreadProcessId(foreground, None) };
    let layout = unsafe { GetKeyboardLayout(tid) }.0 as usize;
    if (layout & 0x3ff) != 0x04 {
        return false;
    }
    let ime = unsafe { ImmGetDefaultIMEWnd(foreground) };
    if ime.0.is_null() {
        return true;
    } // Some modern TSF canvases expose layout only.
    let mut open = 0usize;
    let replied = unsafe {
        SendMessageTimeoutW(
            ime,
            WM_IME_CONTROL,
            WPARAM(0x0005),
            LPARAM(0),
            SMTO_ABORTIFHUNG,
            40,
            Some(&mut open),
        )
    };
    if replied.0 == 0 {
        return true;
    }
    open != 0
}

fn monitor() {
    unsafe {
        if CoInitializeEx(None, COINIT_MULTITHREADED).is_err() {
            emit(json!({"event":"warning","message":"自动唤起不可用；可双击右 Ctrl 或点击输入框"}));
            return;
        }
        let automation: windows::core::Result<IUIAutomation> =
            CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER);
        let Ok(automation) = automation else {
            emit(json!({"event":"warning","message":"无法识别文本框；可双击右 Ctrl 或点击输入框"}));
            return;
        };
        let mut last_window = HWND::default();
        let mut last_chinese = false;
        let mut last_chinese_layout = false;
        let mut last_safe = false;
        loop {
            thread::sleep(Duration::from_millis(100));
            let foreground = GetForegroundWindow();
            if foreground.0.is_null() || foreground.0 as isize == APP.load(Ordering::Relaxed) {
                last_window = foreground;
                last_safe = false;
                continue;
            }
            PREVIOUS.store(foreground.0 as isize, Ordering::Relaxed);
            let chinese = chinese_mode(foreground);
            let chinese_layout =
                (GetKeyboardLayout(GetWindowThreadProcessId(foreground, None)).0 as usize & 0x3ff)
                    == 0x04;
            let transitioned = foreground == last_window
                && ((!last_chinese_layout && chinese_layout) || (!last_chinese && chinese));
            let safe = editable(&automation, foreground) == Some(false);
            let stable_safe = safe && last_safe;
            last_window = foreground;
            last_chinese = chinese;
            last_chinese_layout = chinese_layout;
            last_safe = safe;
            if transitioned
                && stable_safe
                && AUTOMATIC.load(Ordering::Relaxed)
                && GetForegroundWindow() == foreground
            {
                activate("ime");
            }
        }
    }
}

fn main() {
    // This read-only command exits before reading preferences, registering
    // input observation, initializing UIA, or observing the foreground window.
    if std::env::args().nth(1).as_deref() == Some("--list-fonts") {
        match fonts::list() {
            Ok(names) => emit(json!(names)),
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(1);
            }
        }
        return;
    }
    let preferences = load();
    DOUBLE_CTRL.store(
        preferences["doubleCtrl"].as_bool().unwrap_or(true),
        Ordering::Relaxed,
    );
    AUTOMATIC.store(
        preferences["automatic"].as_bool().unwrap_or(true),
        Ordering::Relaxed,
    );
    let mut listener = activation::Listener::new();
    let activation_ready = listener.as_mut().is_ok_and(|listener| {
        listener
            .set_enabled(DOUBLE_CTRL.load(Ordering::Relaxed))
            .is_ok()
    });
    unsafe {
        LOOP_THREAD.store(GetCurrentThreadId(), Ordering::Relaxed);
        let mut message = MSG::default();
        let _ = PeekMessageW(&mut message, None, 0, 0, PM_NOREMOVE);
        emit(
            json!({"event":"ready","preferences":preferences,"activationReady":activation_ready && DOUBLE_CTRL.load(Ordering::Relaxed)}),
        );
    }
    thread::spawn(monitor);
    thread::spawn(|| {
        for line in io::stdin().lock().lines().map_while(Result::ok) {
            let Ok(command) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            let id = command["id"].clone();
            let result: Result<Value, String> = (|| match command["command"].as_str().unwrap_or("")
            {
                "attach" => {
                    let n = command["hwnd"].as_i64().ok_or("missing HWND")? as isize;
                    APP.store(n, Ordering::Relaxed);
                    unsafe {
                        let fg = GetForegroundWindow();
                        if fg.0 as isize != n {
                            PREVIOUS.store(fg.0 as isize, Ordering::Relaxed);
                        }
                    }
                    Ok(json!({}))
                }
                "save" => {
                    let p = &command["preferences"];
                    save(p).map_err(|e| e.to_string())?;
                    AUTOMATIC.store(p["automatic"].as_bool().unwrap_or(true), Ordering::Relaxed);
                    let enabled = p["doubleCtrl"].as_bool().unwrap_or(true);
                    if DOUBLE_CTRL.swap(enabled, Ordering::Relaxed) != enabled {
                        unsafe {
                            let _ = PostThreadMessageW(
                                LOOP_THREAD.load(Ordering::Relaxed),
                                UPDATE_ACTIVATION,
                                WPARAM(0),
                                LPARAM(0),
                            );
                        }
                    }
                    Ok(json!({}))
                }
                "return" => {
                    unsafe {
                        let h = hwnd(PREVIOUS.load(Ordering::Relaxed));
                        if IsWindow(Some(h)).as_bool()
                            && GetForegroundWindow().0 as isize == APP.load(Ordering::Relaxed)
                        {
                            let _ = SetForegroundWindow(h);
                        }
                    }
                    Ok(json!({}))
                }
                "summon" => {
                    unsafe { activate("button") };
                    Ok(json!({}))
                }
                "probe" => unsafe {
                    let foreground = GetForegroundWindow();
                    let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
                    let automation: windows::core::Result<IUIAutomation> =
                        CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER);
                    let edit = automation
                        .as_ref()
                        .ok()
                        .and_then(|a| editable(a, foreground));
                    Ok(
                        json!({"foreground":foreground.0 as isize,"chinese":chinese_mode(foreground),"editable":edit}),
                    )
                },
                "quit" => {
                    unsafe {
                        let _ = PostThreadMessageW(
                            LOOP_THREAD.load(Ordering::Relaxed),
                            WM_QUIT,
                            WPARAM(0),
                            LPARAM(0),
                        );
                    }
                    Ok(json!({}))
                }
                _ => Err("unknown command".into()),
            })();
            match result {
                Ok(v) => emit(json!({"id":id,"result":v})),
                Err(e) => emit(json!({"id":id,"error":e})),
            }
        }
        unsafe {
            let _ = PostThreadMessageW(
                LOOP_THREAD.load(Ordering::Relaxed),
                WM_QUIT,
                WPARAM(0),
                LPARAM(0),
            );
        }
    });
    unsafe {
        let mut message = MSG::default();
        while GetMessageW(&mut message, None, 0, 0).0 > 0 {
            if message.message == UPDATE_ACTIVATION {
                if listener.is_err() {
                    listener = activation::Listener::new();
                }
                let available = listener.as_mut().is_ok_and(|listener| {
                    listener
                        .set_enabled(DOUBLE_CTRL.load(Ordering::Relaxed))
                        .is_ok()
                });
                emit(
                    json!({"event":"activationStatus","available":available && DOUBLE_CTRL.load(Ordering::Relaxed)}),
                );
            }
            if let Ok(listener) = &mut listener {
                if listener.process(&message, APP.load(Ordering::Relaxed)) {
                    activate("doubleCtrl");
                }
            }
            if message.message == WM_INPUT {
                // Required cleanup for foreground Raw Input packets.
                let _ = DefWindowProcW(
                    message.hwnd,
                    message.message,
                    message.wParam,
                    message.lParam,
                );
            } else {
                let _ = DispatchMessageW(&message);
            }
        }
    }
}
