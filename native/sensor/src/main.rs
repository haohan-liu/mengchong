#![cfg_attr(not(target_os = "windows"), allow(dead_code))]

#[cfg(target_os = "windows")]
mod windows_sensor {
    use serde::Serialize;
    use std::{
        collections::VecDeque,
        ffi::OsString,
        io::{self, Write},
        os::windows::ffi::OsStringExt,
        path::Path,
        sync::atomic::{AtomicI64, AtomicU64, Ordering},
        thread,
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    };
    use windows::Win32::{
        Foundation::{CloseHandle, LPARAM, LRESULT, POINT, RECT, WPARAM},
        Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST},
        Networking::WinInet::InternetGetConnectedState,
        System::{
            Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS},
            StationsAndDesktops::{CloseDesktop, OpenInputDesktop, DESKTOP_READOBJECTS},
            Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION},
        },
        UI::{
            Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO},
            WindowsAndMessaging::{
                CallNextHookEx, DispatchMessageW, GetForegroundWindow, GetMessageW, GetTickCount,
                GetWindowRect, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
                SetWindowsHookExW, TranslateMessage, HHOOK, KBDLLHOOKSTRUCT, MSG, MSLLHOOKSTRUCT,
                WH_KEYBOARD_LL, WH_MOUSE_LL, WM_LBUTTONDOWN, WM_MBUTTONDOWN, WM_MOUSEMOVE,
                WM_MOUSEWHEEL, WM_RBUTTONDOWN, WM_XBUTTONDOWN, WM_KEYDOWN, WM_SYSKEYDOWN,
            },
        },
    };

    static KEY_COUNT: AtomicU64 = AtomicU64::new(0);
    static CLICK_COUNT: AtomicU64 = AtomicU64::new(0);
    static WHEEL_COUNT: AtomicU64 = AtomicU64::new(0);
    static MOVE_DISTANCE: AtomicU64 = AtomicU64::new(0);
    static LAST_X: AtomicI64 = AtomicI64::new(i64::MIN);
    static LAST_Y: AtomicI64 = AtomicI64::new(i64::MIN);

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Snapshot {
        timestamp: u128,
        foreground_process: String,
        foreground_path: String,
        window_title: String,
        document_title: String,
        app_category: &'static str,
        active_app_seconds: u64,
        app_switches5m: usize,
        keyboard_count1s: u64,
        keyboard_count10s: u64,
        keyboard_pulse: bool,
        mouse_clicks1s: u64,
        mouse_clicks10s: u64,
        mouse_click_pulse: bool,
        mouse_wheel1s: u64,
        mouse_wheel10s: u64,
        mouse_distance1s: u64,
        mouse_distance10s: u64,
        idle_seconds: u64,
        fullscreen: bool,
        locked: bool,
        meeting: bool,
        microphone_active: bool,
        online: bool,
        battery_percent: u8,
        charging: bool,
        sensor_source: &'static str,
    }

    unsafe extern "system" fn keyboard_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code >= 0 && matches!(wparam.0 as u32, WM_KEYDOWN | WM_SYSKEYDOWN) {
            // The KBDLLHOOKSTRUCT is intentionally never inspected. Key values and text are discarded.
            let _ = lparam.0 as *const KBDLLHOOKSTRUCT;
            KEY_COUNT.fetch_add(1, Ordering::Relaxed);
        }
        CallNextHookEx(HHOOK::default(), code, wparam, lparam)
    }

    unsafe extern "system" fn mouse_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code >= 0 {
            match wparam.0 as u32 {
                WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN | WM_XBUTTONDOWN => {
                    CLICK_COUNT.fetch_add(1, Ordering::Relaxed);
                }
                WM_MOUSEWHEEL => { WHEEL_COUNT.fetch_add(1, Ordering::Relaxed); }
                WM_MOUSEMOVE => {
                    let event = &*(lparam.0 as *const MSLLHOOKSTRUCT);
                    let x = event.pt.x as i64;
                    let y = event.pt.y as i64;
                    let old_x = LAST_X.swap(x, Ordering::Relaxed);
                    let old_y = LAST_Y.swap(y, Ordering::Relaxed);
                    if old_x != i64::MIN {
                        let dx = x - old_x;
                        let dy = y - old_y;
                        MOVE_DISTANCE.fetch_add(((dx * dx + dy * dy) as f64).sqrt() as u64, Ordering::Relaxed);
                    }
                }
                _ => {}
            }
        }
        CallNextHookEx(HHOOK::default(), code, wparam, lparam)
    }

    fn wide_to_string(buffer: &[u16]) -> String {
        let end = buffer.iter().position(|c| *c == 0).unwrap_or(buffer.len());
        OsString::from_wide(&buffer[..end]).to_string_lossy().to_string()
    }

    fn foreground() -> (u32, String, String, String, bool) {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.0.is_null() { return (0, "unknown".into(), String::new(), String::new(), false); }
            let length = GetWindowTextLengthW(hwnd);
            let mut title_buffer = vec![0u16; (length + 1).max(1) as usize];
            let copied = GetWindowTextW(hwnd, &mut title_buffer);
            let title = wide_to_string(&title_buffer[..copied.max(0) as usize]);
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            let mut path = String::new();
            if let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                let mut path_buffer = vec![0u16; 32768];
                let mut size = path_buffer.len() as u32;
                if QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, windows::core::PWSTR(path_buffer.as_mut_ptr()), &mut size).is_ok() {
                    path = wide_to_string(&path_buffer[..size as usize]);
                }
                let _ = CloseHandle(process);
            }
            let name = Path::new(&path).file_name().map(|v| v.to_string_lossy().to_string()).unwrap_or_else(|| "unknown".into());
            let mut rect = RECT::default();
            let fullscreen = if GetWindowRect(hwnd, &mut rect).is_ok() {
                let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
                let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
                GetMonitorInfoW(monitor, &mut info).as_bool()
                    && rect.left <= info.rcMonitor.left && rect.top <= info.rcMonitor.top
                    && rect.right >= info.rcMonitor.right && rect.bottom >= info.rcMonitor.bottom
            } else { false };
            (pid, name, path, title, fullscreen)
        }
    }

    fn idle_seconds() -> u64 {
        unsafe {
            let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
            if GetLastInputInfo(&mut info).as_bool() { GetTickCount().wrapping_sub(info.dwTime) as u64 / 1000 } else { 0 }
        }
    }

    fn is_locked() -> bool {
        unsafe {
            match OpenInputDesktop(0, false, DESKTOP_READOBJECTS) {
                Ok(desktop) => { let _ = CloseDesktop(desktop); false }
                Err(_) => true,
            }
        }
    }

    fn online() -> bool {
        unsafe { let mut flags = 0u32; InternetGetConnectedState(&mut flags, 0).as_bool() }
    }

    fn power() -> (u8, bool) {
        unsafe {
            let mut status = SYSTEM_POWER_STATUS::default();
            if GetSystemPowerStatus(&mut status).is_ok() {
                (if status.BatteryLifePercent == 255 { 100 } else { status.BatteryLifePercent }, status.ACLineStatus == 1)
            } else { (100, true) }
        }
    }

    fn is_meeting_process(name: &str) -> bool {
        let value = name.to_ascii_lowercase();
        ["teams", "zoom", "wechat", "dingtalk", "feishu", "skype", "webex"].iter().any(|part| value.contains(part))
    }

    fn run_writer() {
        let mut active_pid = 0u32;
        let mut active_since = Instant::now();
        let mut switches: VecDeque<Instant> = VecDeque::new();
        let mut keyboard: VecDeque<u64> = VecDeque::new();
        let mut clicks: VecDeque<u64> = VecDeque::new();
        let mut wheels: VecDeque<u64> = VecDeque::new();
        let mut distances: VecDeque<u64> = VecDeque::new();
        loop {
            thread::sleep(Duration::from_secs(1));
            let (pid, name, path, title, fullscreen) = foreground();
            if pid != active_pid {
                if active_pid != 0 { switches.push_back(Instant::now()); }
                active_pid = pid;
                active_since = Instant::now();
            }
            while switches.front().map(|time| time.elapsed() > Duration::from_secs(300)).unwrap_or(false) { switches.pop_front(); }
            let keyboard_now = KEY_COUNT.swap(0, Ordering::Relaxed);
            let clicks_now = CLICK_COUNT.swap(0, Ordering::Relaxed);
            let wheels_now = WHEEL_COUNT.swap(0, Ordering::Relaxed);
            let distance_now = MOVE_DISTANCE.swap(0, Ordering::Relaxed);
            for (queue, value) in [
                (&mut keyboard, keyboard_now),
                (&mut clicks, clicks_now),
                (&mut wheels, wheels_now),
                (&mut distances, distance_now),
            ] {
                queue.push_back(value);
                while queue.len() > 10 { queue.pop_front(); }
            }
            let (battery, charging) = power();
            let meeting = is_meeting_process(&name);
            let snapshot = Snapshot {
                timestamp: SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis(),
                foreground_process: name,
                foreground_path: path,
                window_title: title.clone(),
                document_title: title,
                app_category: "other",
                active_app_seconds: active_since.elapsed().as_secs(),
                app_switches5m: switches.len(),
                keyboard_count1s: keyboard_now,
                keyboard_count10s: keyboard.iter().sum(),
                keyboard_pulse: keyboard_now > 0,
                mouse_clicks1s: clicks_now,
                mouse_clicks10s: clicks.iter().sum(),
                mouse_click_pulse: clicks_now > 0,
                mouse_wheel1s: wheels_now,
                mouse_wheel10s: wheels.iter().sum(),
                mouse_distance1s: distance_now,
                mouse_distance10s: distances.iter().sum(),
                idle_seconds: idle_seconds(),
                fullscreen,
                locked: is_locked(),
                meeting,
                // No audio is captured. This is a conservative occupancy signal for known meeting apps.
                microphone_active: meeting,
                online: online(),
                battery_percent: battery,
                charging,
                sensor_source: "native",
            };
            if let Ok(line) = serde_json::to_string(&snapshot) {
                println!("{line}");
                let _ = io::stdout().flush();
            }
        }
    }

    pub fn run() {
        thread::spawn(run_writer);
        unsafe {
            let keyboard = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook), None, 0).expect("keyboard hook");
            let mouse = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook), None, 0).expect("mouse hook");
            let mut message = MSG::default();
            while GetMessageW(&mut message, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&message);
                DispatchMessageW(&message);
            }
            let _ = (keyboard, mouse);
        }
    }
}

fn main() {
    #[cfg(target_os = "windows")]
    windows_sensor::run();
    #[cfg(not(target_os = "windows"))]
    eprintln!("pet-sensor is available on Windows only");
}
