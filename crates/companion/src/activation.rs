use crate::double_tap::DoubleTap;
use windows::{
    Win32::{
        Foundation::*,
        UI::{
            Input::{KeyboardAndMouse::*, *},
            WindowsAndMessaging::*,
        },
    },
    core::w,
};

// A message-only window receives passive Raw Input. No hook, key suppression,
// text conversion, input injection, visible window, or foreground activation.
pub struct Listener {
    window: HWND,
    enabled: bool,
    gesture: DoubleTap,
}

impl Listener {
    pub fn new() -> windows::core::Result<Self> {
        let window = unsafe {
            CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                w!("STATIC"),
                w!("Ziban activation"),
                WINDOW_STYLE::default(),
                0,
                0,
                0,
                0,
                Some(HWND_MESSAGE),
                None,
                None,
                None,
            )?
        };
        Ok(Self {
            window,
            enabled: false,
            gesture: DoubleTap::default(),
        })
    }

    pub fn set_enabled(&mut self, enabled: bool) -> windows::core::Result<()> {
        self.gesture.reset();
        if enabled == self.enabled {
            return Ok(());
        }
        let devices = [6, 2].map(|usage| RAWINPUTDEVICE {
            usUsagePage: 1,
            usUsage: usage,
            dwFlags: if enabled {
                RIDEV_INPUTSINK | RIDEV_DEVNOTIFY
            } else {
                RIDEV_REMOVE
            },
            hwndTarget: if enabled {
                self.window
            } else {
                HWND::default()
            },
        });
        // Disable recognition even if unregistering fails. Never suppress the
        // foreground application's ordinary keyboard or pointer messages.
        self.enabled = false;
        unsafe {
            RegisterRawInputDevices(&devices, size_of::<RAWINPUTDEVICE>() as u32)?;
        }
        self.enabled = enabled;
        Ok(())
    }

    pub fn process(&mut self, message: &MSG, app: isize) -> bool {
        if message.message == WM_INPUT_DEVICE_CHANGE {
            self.gesture.reset();
            return false;
        }
        if !self.enabled || message.message != WM_INPUT || message.hwnd != self.window {
            return false;
        }
        unsafe {
            let mut input = RAWINPUT::default();
            let mut size = size_of::<RAWINPUT>() as u32;
            let read = GetRawInputData(
                HRAWINPUT(message.lParam.0 as *mut _),
                RID_INPUT,
                Some((&mut input as *mut RAWINPUT).cast()),
                &mut size,
                size_of::<RAWINPUTHEADER>() as u32,
            );
            if read == u32::MAX || read < size_of::<RAWINPUTHEADER>() as u32 {
                self.gesture.reset();
                return false;
            }
            if input.header.dwType == RIM_TYPEMOUSE.0 {
                if read >= (size_of::<RAWINPUTHEADER>() + size_of::<RAWMOUSE>()) as u32
                    && input.data.mouse.Anonymous.Anonymous.usButtonFlags != 0
                {
                    self.gesture.cancel(); // Includes button and wheel actions.
                }
                return false;
            }
            if input.header.dwType != RIM_TYPEKEYBOARD.0
                || read < (size_of::<RAWINPUTHEADER>() + size_of::<RAWKEYBOARD>()) as u32
            {
                return false;
            }
            let key = input.data.keyboard;
            let right = (key.VKey == VK_CONTROL.0 || key.VKey == VK_RCONTROL.0)
                && key.Flags as u32 & RI_KEY_E0 != 0
                && key.Flags as u32 & RI_KEY_E1 == 0;
            if !right {
                self.gesture.cancel();
                return false;
            }
            let foreground = GetForegroundWindow().0 as isize;
            // Check currently held input only at Ctrl transitions, including
            // keys already held before observation began. Do not retain codes.
            let alone = foreground != app
                && !(1..=254).any(|key| {
                    key != VK_CONTROL.0 as i32
                        && key != VK_RCONTROL.0 as i32
                        && GetAsyncKeyState(key) as u16 & 0x8000 != 0
                });
            self.gesture.right_ctrl(
                key.Flags as u32 & RI_KEY_BREAK != 0,
                message.time,
                (foreground, input.header.hDevice.0 as isize),
                alone,
            )
        }
    }
}

impl Drop for Listener {
    fn drop(&mut self) {
        let _ = self.set_enabled(false);
        unsafe {
            let _ = DestroyWindow(self.window);
        }
    }
}
