import { dirname, resolve, basename } from "node:path";
import { createSignal } from "solid-js";
import { offscreen } from "./runtime";

export interface Preferences {
  schemaVersion: number;
  automatic: boolean;
  pinned: boolean;
  grid: boolean;
  compare: boolean;
  dark: boolean;
  fontLeft: string;
  fontRight: string;
  size: number;
  history: string[];
  lastText: string;
}
export const defaults: Preferences = {
  schemaVersion: 2,
  automatic: true,
  pinned: true,
  grid: false,
  compare: false,
  dark: false,
  fontLeft: "Noto Serif SC",
  fontRight: "LXGW WenKai",
  size: 64,
  history: [],
  lastText: "",
};
export function sanitize(v: Partial<Preferences>): Preferences {
  const modern = v.schemaVersion === 2;
  return {
    ...defaults,
    ...Object.fromEntries(
      (modern
        ? ["automatic", "pinned", "grid", "compare", "dark"]
        : ["automatic", "pinned", "dark"]
      )
        .filter((k) => typeof v[k as keyof Preferences] === "boolean")
        .map((k) => [k, v[k as keyof Preferences]]),
    ),
    fontLeft:
      typeof v.fontLeft === "string" && v.fontLeft.length < 100
        ? v.fontLeft
        : defaults.fontLeft,
    fontRight:
      typeof v.fontRight === "string" && v.fontRight.length < 100
        ? v.fontRight
        : defaults.fontRight,
    size:
      modern && typeof v.size === "number"
        ? Math.max(40, Math.min(88, v.size))
        : defaults.size,
    lastText:
      typeof v.lastText === "string"
        ? [...v.lastText].slice(0, 512).join("")
        : "",
    history: Array.isArray(v.history)
      ? v.history
          .filter(
            (x) =>
              typeof x === "string" && x.length > 0 && [...x].length <= 512,
          )
          .slice(0, 18)
      : [],
  };
}
export const [preferences, setPreferences] =
  createSignal<Preferences>(defaults);
export const [workerError, setWorkerError] = createSignal("");
export const [ready, setReady] = createSignal(false);
export const [summonLabel, setSummonLabel] = createSignal("Ctrl Alt Space");
export const [hideLabel, setHideLabel] = createSignal("Ctrl Alt H");
export const [passLabel, setPassLabel] = createSignal("Ctrl Alt P");
export const [hotkeys, setHotkeys] = createSignal({
  summon: false,
  hide: false,
  pass: false,
});
const listeners = new Set<(event: Record<string, any>) => void>();
export const subscribe = (fn: (event: Record<string, any>) => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const root =
  basename(process.execPath).toLowerCase() === "bun.exe"
    ? resolve(import.meta.dir, "..")
    : dirname(process.execPath);
const executable =
  basename(process.execPath).toLowerCase() === "bun.exe"
    ? resolve(root, "target/release/ziban-companion.exe")
    : resolve(root, "ziban-companion.exe");
let worker: ReturnType<typeof Bun.spawn>;
let nextId = 0;
const pending = new Map<
  number,
  {
    resolve: (v: any) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
export function request(command: string, params: object = {}): Promise<any> {
  if (offscreen) return Promise.resolve({ inspectionOnly: true });
  if (!worker || worker.killed)
    return Promise.reject(new Error("系统助手未运行"));
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("系统助手响应超时"));
    }, 3500);
    pending.set(id, { resolve, reject, timer });
    if (worker.stdin && typeof worker.stdin !== "number") {
      worker.stdin.write(JSON.stringify({ id, command, ...params }) + "\n");
      worker.stdin.flush();
    }
  });
}
export function startWorker() {
  if (offscreen) {
    setReady(true);
    return;
  }
  try {
    worker = Bun.spawn([executable], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
      windowsHide: true,
    });
  } catch (e) {
    setWorkerError("系统助手无法启动，请重新解压完整的软件包");
    return;
  }
  void (async () => {
    let buffer = "";
    const decoder = new TextDecoder();
    for await (const chunk of worker.stdout as ReadableStream<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        let e;
        try {
          e = JSON.parse(line);
        } catch {
          continue;
        }
        if (typeof e.id === "number") {
          const p = pending.get(e.id);
          if (p) {
            clearTimeout(p.timer);
            pending.delete(e.id);
            e.error ? p.reject(new Error(e.error)) : p.resolve(e.result);
          }
          continue;
        }
        if (e.event === "ready") {
          setPreferences(sanitize(e.preferences));
          setSummonLabel(e.hotkeys.summonLabel);
          setHideLabel(e.hotkeys.hideLabel);
          setPassLabel(e.hotkeys.passLabel);
          setHotkeys(e.hotkeys);
          setReady(true);
          if (!e.hotkeys.summon)
            setWorkerError("唤起快捷键已被占用，可直接点击输入框");
          else if (!e.hotkeys.pass || !e.hotkeys.hide)
            setWorkerError("部分快捷键已被其他软件占用");
        }
        if (e.event === "warning") setWorkerError(e.message);
        for (const listener of listeners) listener(e);
      }
    }
  })().catch(() => setWorkerError("系统助手连接中断，请重开字伴"));
  void worker.exited.then(() => {
    setReady(false);
    setWorkerError("系统助手已退出，请重开字伴");
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("系统助手已退出"));
    }
    pending.clear();
  });
  process.once("exit", () => worker.kill());
}
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saveChain = Promise.resolve();
export function updatePreferences(patch: Partial<Preferences>) {
  setPreferences((p) => sanitize({ ...p, ...patch }));
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flushPreferences(), 250);
}
export function flushPreferences() {
  clearTimeout(saveTimer);
  const snapshot = preferences();
  saveChain = saveChain
    .catch(() => {})
    .then(() => request("save", { preferences: snapshot }))
    .then(() => {})
    .catch(() => {
      setWorkerError("偏好未能保存；当前设置仍可使用");
    });
  return saveChain;
}
