use std::{os::windows::ffi::OsStrExt, path::Path};
use windows::{
    Win32::{Foundation::*, System::Registry::*},
    core::{PCWSTR, w},
};

const RUN_KEY: PCWSTR = w!("Software\\Microsoft\\Windows\\CurrentVersion\\Run");
const ENTRY: PCWSTR = w!("Rizum.Ziban");

struct Key(HKEY);
impl Drop for Key {
    fn drop(&mut self) {
        unsafe {
            let _ = RegCloseKey(self.0);
        }
    }
}

// Registry is authoritative; ordinary preference saves never touch startup.
struct StartupEntry {
    subkey: PCWSTR,
}
impl StartupEntry {
    fn read(&self) -> Result<Option<Vec<u16>>, String> {
        let mut value = [0u16; 1024];
        let mut bytes = size_of_val(&value) as u32;
        let result = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                self.subkey,
                ENTRY,
                RRF_RT_REG_SZ,
                None,
                Some(value.as_mut_ptr().cast()),
                Some(&mut bytes),
            )
        };
        if result == ERROR_FILE_NOT_FOUND || result == ERROR_PATH_NOT_FOUND {
            return Ok(None);
        }
        result
            .ok()
            .map_err(|_| "无法读取开机自启设置，请重试".to_string())?;
        let end = value.iter().position(|v| *v == 0).unwrap_or(value.len());
        Ok(Some(value[..end].to_vec()))
    }

    fn write(&self, command: Option<&[u16]>) -> Result<(), String> {
        let mut handle = HKEY::default();
        let result = unsafe {
            if command.is_some() {
                RegCreateKeyExW(
                    HKEY_CURRENT_USER,
                    self.subkey,
                    None,
                    None,
                    REG_OPTION_NON_VOLATILE,
                    KEY_SET_VALUE,
                    None,
                    &mut handle,
                    None,
                )
            } else {
                RegOpenKeyExW(
                    HKEY_CURRENT_USER,
                    self.subkey,
                    None,
                    KEY_SET_VALUE,
                    &mut handle,
                )
            }
        };
        if command.is_none() && (result == ERROR_FILE_NOT_FOUND || result == ERROR_PATH_NOT_FOUND) {
            return Ok(());
        }
        result
            .ok()
            .map_err(|_| "无法更改开机自启设置，请重试".to_string())?;
        let key = Key(handle);
        let result = unsafe {
            if let Some(command) = command {
                let bytes: Vec<u8> = command
                    .iter()
                    .copied()
                    .chain(Some(0))
                    .flat_map(u16::to_le_bytes)
                    .collect();
                RegSetValueExW(key.0, ENTRY, None, REG_SZ, Some(&bytes))
            } else {
                RegDeleteValueW(key.0, ENTRY)
            }
        };
        if command.is_none() && result == ERROR_FILE_NOT_FOUND {
            return Ok(());
        }
        result
            .ok()
            .map_err(|_| "无法更改开机自启设置，请重试".to_string())
    }
}

fn launch_command(executable: &Path) -> Result<Vec<u16>, String> {
    let path: Vec<u16> = executable.as_os_str().encode_wide().collect();
    if path.contains(&0) || path.contains(&34) || !executable.is_absolute() {
        return Err("程序路径无效，无法设置开机自启".into());
    }
    let mut command = vec![34];
    command.extend(path);
    command.extend("\" --startup".encode_utf16());
    if command.len() > 260 {
        return Err("程序路径过长，请移动到较短的路径后再开启".into());
    }
    Ok(command)
}

fn command() -> Result<Vec<u16>, String> {
    let executable = std::env::current_exe()
        .map_err(|_| "无法找到字伴程序".to_string())?
        .with_file_name("Ziban.exe");
    if !executable.is_file() {
        return Err("请在完整的字伴发布目录中设置开机自启".into());
    }
    launch_command(&executable)
}

pub fn enabled() -> Result<bool, String> {
    let actual = StartupEntry { subkey: RUN_KEY }.read()?;
    // Match this installation, including quoting and the background argument.
    Ok(actual.as_deref() == Some(command()?.as_slice()))
}

pub fn set_enabled(enabled: bool) -> Result<bool, String> {
    let entry = StartupEntry { subkey: RUN_KEY };
    let command = command()?;
    if enabled {
        entry.write(Some(&command))?;
    } else {
        // A copied portable app must not disable another installation's entry.
        if entry.read()?.as_deref() == Some(command.as_slice()) {
            entry.write(None)?;
        }
    }
    let actual = entry.read()?.as_deref() == Some(command.as_slice());
    if actual != enabled {
        return Err("开机自启设置未能确认，请重试".into());
    }
    Ok(actual)
}
