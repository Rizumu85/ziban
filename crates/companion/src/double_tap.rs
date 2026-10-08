// Only timing and an opaque window/device identity are retained. Other input
// invalidates the gesture; no text or sequence of ordinary keys is collected.
#[derive(Default)]
pub struct DoubleTap {
    down: bool,
    press: Option<u32>,
    first_release: Option<u32>,
    context: (isize, isize),
    last_trigger: Option<u32>,
}

impl DoubleTap {
    pub fn cancel(&mut self) {
        self.press = None;
        self.first_release = None;
    }

    pub fn reset(&mut self) {
        *self = Self::default();
    }

    // Called only for physical right Ctrl transitions. Times come from the
    // Windows message, so a delayed event loop cannot turn a hold into a tap.
    pub fn right_ctrl(
        &mut self,
        released: bool,
        time: u32,
        context: (isize, isize),
        alone: bool,
    ) -> bool {
        if self.context != context || !alone || context.0 == 0 {
            self.cancel();
        }
        self.context = context;
        if !released {
            if self.down {
                return false;
            } // Key repeat is not another tap.
            self.down = true;
            if !alone
                || context.0 == 0
                || self
                    .last_trigger
                    .is_some_and(|t| time.wrapping_sub(t) < 650)
            {
                self.cancel();
                return false;
            }
            if self
                .first_release
                .is_some_and(|t| time.wrapping_sub(t) > 400)
            {
                self.first_release = None;
            }
            self.press = Some(time);
            return false;
        }
        if !self.down {
            return false;
        }
        self.down = false;
        let valid = self
            .press
            .take()
            .is_some_and(|t| time.wrapping_sub(t) <= 250);
        if !valid || !alone {
            self.cancel();
            return false;
        }
        if self.first_release.take().is_some() {
            self.last_trigger = Some(time);
            return true;
        }
        self.first_release = Some(time);
        false
    }
}
