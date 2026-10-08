import { dlopen, FFIType as T, ptr } from "bun:ffi";
import { findProcessWindowByTitle } from "./window-lookup";
import { dirname, resolve, basename } from "node:path";
import { offscreen } from "../runtime";

export const TITLE = "字伴";
const u = dlopen("user32.dll", {
  SetProcessDpiAwarenessContext: { args: [T.i64], returns: T.bool },
  SetWindowPos: {
    args: [T.ptr, T.i64, T.i32, T.i32, T.i32, T.i32, T.u32],
    returns: T.bool,
  },
  GetWindowLongPtrW: { args: [T.ptr, T.i32], returns: T.i64 },
  SetWindowLongPtrW: { args: [T.ptr, T.i32, T.i64], returns: T.i64 },
  GetDpiForWindow: { args: [T.ptr], returns: T.u32 },
  GetWindowRect: { args: [T.ptr, T.ptr], returns: T.bool },
  GetClientRect: { args: [T.ptr, T.ptr], returns: T.bool },
  ShowWindow: { args: [T.ptr, T.i32], returns: T.bool },
  SetForegroundWindow: { args: [T.ptr], returns: T.bool },
  FindWindowW: { args: [T.ptr, T.ptr], returns: T.ptr },
  SetLayeredWindowAttributes: {
    args: [T.ptr, T.u32, T.u8, T.u32],
    returns: T.bool,
  },
  GetForegroundWindow: { args: [], returns: T.ptr },
  ReleaseCapture: { args: [], returns: T.bool },
  SetCapture: { args: [T.ptr], returns: T.ptr },
  GetCursorPos: { args: [T.ptr], returns: T.bool },
  GetSystemMetrics: { args: [T.i32], returns: T.i32 },
  GetAsyncKeyState: { args: [T.i32], returns: T.i16 },
  PostMessageW: { args: [T.ptr, T.u32, T.u64, T.i64], returns: T.bool },
  SystemParametersInfoW: {
    args: [T.u32, T.u32, T.ptr, T.u32],
    returns: T.bool,
  },
  LoadImageW: {
    args: [T.ptr, T.ptr, T.u32, T.i32, T.i32, T.u32],
    returns: T.u64,
  },
  SendMessageW: { args: [T.ptr, T.u32, T.u64, T.i64], returns: T.i64 },
});
const dwm = dlopen("dwmapi.dll", {
  DwmSetWindowAttribute: { args: [T.ptr, T.u32, T.ptr, T.u32], returns: T.i32 },
});
const shell = dlopen("shell32.dll", {
  SetCurrentProcessExplicitAppUserModelID: { args: [T.ptr], returns: T.i32 },
});
export const handle = () => findProcessWindowByTitle(TITLE, false);
export function preparePreview() {
  if (!offscreen) return;
  const h = handle();
  if (!h) throw new Error("Preview HWND missing");
  const style = BigInt(u.symbols.GetWindowLongPtrW(h, -20));
  u.symbols.SetWindowLongPtrW(h, -20, (style | 0x08000080n) & ~0x00040000n);
  const left = u.symbols.GetSystemMetrics(76),
    top = u.symbols.GetSystemMetrics(77);
  u.symbols.SetWindowPos(h, 0n, left - 4000, top - 4000, 0, 0, 0x15);
  u.symbols.ShowWindow(h, 4);
  const rectangle = new Int32Array(4);
  u.symbols.GetWindowRect(h, ptr(rectangle));
  if (rectangle[2]! >= left || rectangle[3]! >= top) {
    u.symbols.ShowWindow(h, 0);
    throw new Error("Preview must remain outside all displays");
  }
}
export function setupProcess() {
  u.symbols.SetProcessDpiAwarenessContext(-4n);
  const s = Buffer.from("Rizum.Ziban\0", "utf16le");
  shell.symbols.SetCurrentProcessExplicitAppUserModelID(ptr(s));
}
export function decorate() {
  const h = handle();
  if (!h) return;
  const style = BigInt(u.symbols.GetWindowLongPtrW(h, -16));
  u.symbols.SetWindowLongPtrW(h, -16, style & ~0x00c40000n);
  const corner = new Int32Array([2]);
  dwm.symbols.DwmSetWindowAttribute(h, 33, ptr(corner), 4);
  const frame = new Int32Array([2]);
  dwm.symbols.DwmSetWindowAttribute(h, 2, ptr(frame), 4);
  u.symbols.SetWindowPos(h, 0n, 0, 0, 0, 0, 0x37);
}
export function resize(width: number, height: number) {
  const h = handle();
  if (!h) return;
  const scale = u.symbols.GetDpiForWindow(h) / 96;
  const outer = new Int32Array(4),
    client = new Int32Array(4);
  u.symbols.GetWindowRect(h, ptr(outer));
  u.symbols.GetClientRect(h, ptr(client));
  u.symbols.SetWindowPos(
    h,
    0n,
    0,
    0,
    Math.ceil(width * scale) + Math.max(0, outer[2]! - outer[0]! - client[2]!),
    Math.ceil(height * scale) + Math.max(0, outer[3]! - outer[1]! - client[3]!),
    0x16,
  );
}
export function pin(enabled: boolean) {
  if (offscreen) return;
  const h = handle();
  if (h) u.symbols.SetWindowPos(h, enabled ? -1n : -2n, 0, 0, 0, 0, 0x13);
}
export function hide() {
  const h = handle();
  if (h) u.symbols.ShowWindow(h, 0);
}
export function reveal(activate = false) {
  if (offscreen) return;
  const h = handle();
  if (h) {
    u.symbols.ShowWindow(h, activate ? 1 : 4);
    if (activate) u.symbols.SetForegroundWindow(h);
  }
}
let originalExtendedStyle: bigint | undefined;
export function passThrough(enabled: boolean) {
  if (offscreen) return;
  const h = handle();
  if (!h) return;
  const current = BigInt(u.symbols.GetWindowLongPtrW(h, -20));
  originalExtendedStyle ??= current;
  u.symbols.SetWindowLongPtrW(
    h,
    -20,
    enabled ? current | 0x08080020n : originalExtendedStyle,
  );
  if (enabled) u.symbols.SetLayeredWindowAttributes(h, 0, 255, 2);
  u.symbols.SetWindowPos(h, 0n, 0, 0, 0, 0, 0x37);
}
export function revealExisting() {
  if (offscreen) return false;
  const title = Buffer.from(TITLE + "\0", "utf16le");
  const h = u.symbols.FindWindowW(null, ptr(title));
  if (!h) return false;
  const style = BigInt(u.symbols.GetWindowLongPtrW(h, -20));
  u.symbols.SetWindowLongPtrW(h, -20, style & ~0x08080020n);
  u.symbols.ShowWindow(h, 1);
  u.symbols.SetForegroundWindow(h);
  return true;
}
let dragPoll: ReturnType<typeof setInterval> | undefined;
export function endDrag() {
  if (dragPoll) clearInterval(dragPoll);
  dragPoll = undefined;
  if (!offscreen) u.symbols.ReleaseCapture();
}
export function drag() {
  if (offscreen) return;
  const h = handle();
  if (!h) return;
  const start = new Int32Array(2),
    bounds = new Int32Array(4);
  if (
    !u.symbols.GetCursorPos(ptr(start)) ||
    !u.symbols.GetWindowRect(h, ptr(bounds))
  )
    return;
  endDrag();
  u.symbols.SetCapture(h);
  dragPoll = setInterval(() => {
    if (!(u.symbols.GetAsyncKeyState(1) & 0x8000)) return endDrag();
    const cursor = new Int32Array(2);
    if (u.symbols.GetCursorPos(ptr(cursor))) {
      u.symbols.SetWindowPos(
        h,
        0n,
        bounds[0]! + cursor[0]! - start[0]!,
        bounds[1]! + cursor[1]! - start[1]!,
        0,
        0,
        0x15,
      );
    }
  }, 8);
}
process.once("exit", endDrag);
export function prefersReducedMotion() {
  const v = new Int32Array([1]);
  u.symbols.SystemParametersInfoW(0x1042, 0, ptr(v), 0);
  return !v[0];
}
export function setIcon() {
  if (offscreen) return;
  const h = handle();
  if (!h) return;
  const root =
    basename(process.execPath).toLowerCase() === "bun.exe"
      ? resolve(import.meta.dir, "../..")
      : dirname(process.execPath);
  const path = Buffer.from(resolve(root, "assets/Ziban.ico") + "\0", "utf16le");
  const scale = u.symbols.GetDpiForWindow(h) / 96;
  const small = u.symbols.LoadImageW(
    null,
    ptr(path),
    1,
    Math.round(16 * scale),
    Math.round(16 * scale),
    0x10,
  );
  const big = u.symbols.LoadImageW(
    null,
    ptr(path),
    1,
    Math.round(32 * scale),
    Math.round(32 * scale),
    0x10,
  );
  if (small) {
    u.symbols.SendMessageW(h, 0x80, 0n, BigInt(small));
    u.symbols.SendMessageW(h, 0x80, 2n, BigInt(small));
  }
  if (big) u.symbols.SendMessageW(h, 0x80, 1n, BigInt(big));
}
