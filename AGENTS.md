# 字伴

Solid 1 + TypeScript own the native GPUIX surface. Rust owns Windows input-mode detection, hotkeys, focus restoration, and persisted preferences. No browser or webview in the product. Pin @gpuix/solid and @gpuix/native together. Rizum Glass tokens are centralized in src/theme.ts, adapted from the user's vrc-bili-relay-gpuix app.

Never read text from other apps. Automatic activation observes only input mode and focused-control capabilities; fail closed on unknown controls. Do not install keyboard logging hooks. Preserve foreground application and restore it only after a user action in 字伴.

Use builds, type checking, and manual application inspection. Do not run functional test suites. Do not modify the reference app. Keep stdout of the Rust worker protocol-only.

The user continues using this computer during development. Do not take foreground focus, switch system input methods, or synthesize keyboard/mouse input while they are working. Use read-only observations and application-local inspection; arrange any real desktop interaction only when the user explicitly agrees to an idle period. Do not assume exclusive control of the desktop.
