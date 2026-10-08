// The release build replaces ZIBAN_INSPECT with "0". Inspection cannot register
// global hotkeys or take keyboard focus. Its tool window is positioned outside
// the virtual desktop before first show; Windows does not paint hidden HWNDs.
export const inspecting = process.env.ZIBAN_INSPECT === "1";
export const offscreen = inspecting;
