import {
  setupProcess,
  TITLE,
  revealExisting,
  preparePreview,
} from "./platform/window";
import { registerBundledFonts } from "./platform/fonts";
import { offscreen } from "./runtime";

setupProcess();
if (revealExisting()) process.exit(0);
console.log("Bundled fonts registered:", registerBundledFonts());
const { render } = await import("@gpuix/solid");
const appModule = await import("./app");
const { App } = appModule;
const { startWorker, request, updatePreferences } = await import("./companion");
render(() => <App />, {
  title: TITLE,
  appName: "字伴",
  width: 560,
  height: offscreen ? Number(process.env.ZIBAN_PREVIEW_HEIGHT ?? 196) : 196,
  resizable: false,
  titlebarTransparent: true,
  windowBackground: "blurred",
  focus: !offscreen && process.env.ZIBAN_BACKGROUND !== "1",
  show: !offscreen,
  onKeyDown: (event, renderer) => {
    appModule.windowKeyDown(event);
    if (event.key === "tab") {
      if (event.modifiers?.shift) renderer.focusPrevious?.();
      else renderer.focusNext?.();
    }
  },
});
if (offscreen) preparePreview();
startWorker();

// Opt-in local inspection endpoint for manual development. No server in a normal launch.
if (process.env.ZIBAN_INSPECT === "1") {
  const token = process.env.ZIBAN_INSPECT_TOKEN;
  if (!token) throw new Error("Inspection requires ZIBAN_INSPECT_TOKEN");
  if (process.env.ZIBAN_PAUSE_ENTRY === "1")
    (appModule.inspection?.renderer as any)?.clockPause();
  Bun.serve({
    hostname: "127.0.0.1",
    port: 18747,
    fetch: async (req) => {
      if (req.headers.get("authorization") !== `Bearer ${token}`)
        return new Response("Unauthorized", { status: 401 });
      const inspection = appModule.inspection;
      if (!inspection) return new Response("Starting", { status: 503 });
      const url = new URL(req.url);
      if (url.pathname === "/state")
        return Response.json(inspection.getState());
      if (url.pathname === "/geometry")
        return Response.json({
          size: inspection.renderer.getWindowSize?.(),
          insets: inspection.renderer.getWindowInsets?.(),
        });
      if (url.pathname === "/tree") {
        const r = inspection.renderer as any;
        return Response.json(
          r.toJSON?.() ?? JSON.parse(r.getAutomationTree?.() ?? "{}"),
        );
      }
      if (url.pathname === "/painted")
        return Response.json(
          (inspection.renderer as any).getPaintedText?.() ?? [],
        );
      if (url.pathname === "/probe")
        return Response.json(await request("probe"));
      if (req.method !== "POST")
        return new Response("Method not allowed", { status: 405 });
      const body = (await req.json()) as Record<string, any>;
      if (url.pathname === "/preferences") updatePreferences(body);
      if (url.pathname === "/input") inspection.setText(String(body.text));
      if (url.pathname === "/action") inspection.action(String(body.action));
      if (url.pathname === "/screenshot")
        (inspection.renderer as any).captureScreenshot(String(body.path));
      if (url.pathname === "/click")
        (inspection.renderer as any).simulateClick(
          Number(body.x),
          Number(body.y),
        );
      if (url.pathname === "/hover")
        (inspection.renderer as any).simulateMouseMove(
          Number(body.x),
          Number(body.y),
        );
      if (url.pathname === "/focus")
        inspection.renderer.focusElement?.(Number(body.id));
      if (url.pathname === "/key")
        (inspection.renderer as any).simulateKeystrokes(String(body.key));
      if (url.pathname === "/scroll")
        (inspection.renderer as any).simulateScrollWheel(
          Number(body.x),
          Number(body.y),
          Number(body.deltaX ?? 0),
          Number(body.deltaY),
        );
      if (url.pathname === "/mouseDown")
        (inspection.renderer as any).simulateMouseDown(
          Number(body.x),
          Number(body.y),
        );
      if (url.pathname === "/mouseUp")
        (inspection.renderer as any).simulateMouseUp(
          Number(body.x),
          Number(body.y),
        );
      if (url.pathname === "/clock") {
        const r = inspection.renderer as any;
        if (body.action === "pause") r.clockPause();
        if (body.action === "advance") r.clockFastForward(Number(body.ms));
        if (body.action === "resume") r.clockResume();
      }
      return Response.json(inspection.getState());
    },
  });
}
