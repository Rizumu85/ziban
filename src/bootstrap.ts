import { dirname, resolve } from "node:path";

// NAPI-RS resolves optional native packages with createRequire. In a compiled
// Bun executable, give its official loader the portable sidecar's real path.
process.env.NAPI_RS_NATIVE_LIBRARY_PATH = resolve(
  dirname(process.execPath),
  "gpuix-native.win32-x64-msvc.node",
);

await import("./main");
