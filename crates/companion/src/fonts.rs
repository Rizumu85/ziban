use std::collections::BTreeSet;
use windows::Win32::{Foundation::LPARAM, Graphics::Gdi::*};

unsafe extern "system" fn collect_font(
    font: *const LOGFONTW,
    _metrics: *const TEXTMETRICW,
    _kind: u32,
    context: LPARAM,
) -> i32 {
    if font.is_null() || context.0 == 0 {
        return 1;
    }
    let family = unsafe { &(*font).lfFaceName };
    let end = family.iter().position(|c| *c == 0).unwrap_or(family.len());
    let name = String::from_utf16_lossy(&family[..end]);
    if !name.is_empty() && !name.starts_with('@') {
        let names = unsafe { &mut *(context.0 as *mut BTreeSet<String>) };
        names.insert(name);
    }
    1
}

pub fn list() -> Result<Vec<String>, String> {
    let mut names = BTreeSet::new();
    unsafe {
        let dc = GetDC(None);
        if dc.0.is_null() {
            return Err("Cannot access the Windows font catalog".into());
        }
        let spec = LOGFONTW {
            lfCharSet: DEFAULT_CHARSET,
            ..Default::default()
        };
        // Both the callback and LOGFONT live in Rust for this synchronous call.
        let result = EnumFontFamiliesExW(
            dc,
            &spec,
            Some(collect_font),
            LPARAM(&mut names as *mut _ as isize),
            0,
        );
        ReleaseDC(None, dc);
        if result == 0 || names.is_empty() {
            return Err("Windows returned an empty font catalog".into());
        }
    }
    Ok(names.into_iter().collect())
}
