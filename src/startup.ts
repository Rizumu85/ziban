import { createSignal } from "solid-js";
import { request } from "./companion";
import { offscreen } from "./runtime";

export const [startupEnabled, setStartupEnabled] = createSignal(false);
export const [startupLoaded, setStartupLoaded] = createSignal(false);
export const [startupBusy, setStartupBusy] = createSignal(false);
export const [startupError, setStartupError] = createSignal("");

async function syncStartup(enabled?: boolean) {
  if (startupBusy()) return;
  setStartupBusy(true);
  setStartupError("");
  try {
    // The isolated preview never writes the real Windows startup entry.
    const result = offscreen
      ? { enabled: enabled ?? startupEnabled() }
      : await request(enabled === undefined ? "startupStatus" : "setStartup", {
          enabled,
        });
    if (typeof result.enabled !== "boolean")
      throw new Error("无法确认开机自启状态，请重试");
    setStartupEnabled(result.enabled);
    setStartupLoaded(true);
  } catch (error) {
    setStartupError(
      error instanceof Error ? error.message : "无法更改开机自启，请重试",
    );
  } finally {
    setStartupBusy(false);
  }
}

export const refreshStartup = () => syncStartup();
export const toggleStartup = () => syncStartup(!startupEnabled());
