import {
  createSignal,
  createMemo,
  createEffect,
  onCleanup,
  onMount,
  For,
  Show,
} from "solid-js";
import { motion, useGpuixRequired, type NativeRenderer } from "@gpuix/solid";
import {
  preferences,
  updatePreferences,
  ready,
  workerError,
  setWorkerError,
  request,
  subscribe,
  flushPreferences,
  summonLabel,
  hideLabel,
  passLabel,
  hotkeys,
  listSystemFonts,
} from "./companion";
import * as native from "./platform/window";
import { FONT_UI, PALETTES, type Palette } from "./theme";
import { Label, Icon, Button, Toggle, row, col, ease, reduced } from "./ui";
import { loadStrokes, strokeSvg } from "./strokes";
import { glyphOutline } from "./glyphs";
import { offscreen } from "./runtime";
import type { EventPayload } from "@gpuix/native";
let keyHandler: ((event: EventPayload) => void) | undefined;
export function windowKeyDown(event: EventPayload) {
  keyHandler?.(event);
}

const WIDTH = 560;
const HEADER = 36,
  FOOTER = 42,
  EDITOR = 50,
  DETAIL = 176;
const FONT_NAMES: Record<string, string> = {
  "Noto Serif SC": "思源宋体",
  "LXGW WenKai": "霞鹜文楷",
  "MiSans VF": "MiSans 黑体",
};
const fontName = (name: string) => FONT_NAMES[name] ?? name;
const isHan = (char: string) => /\p{Script=Han}/u.test(char);
// Keep closing punctuation with the preceding character, and opening marks
// with the next one. Explicit rows also let the viewport end at a whole row.
function copybookLines(chars: string[], columns: number): number[][] {
  const lines: number[][] = [];
  const closing = /[，。！？；：、）》】」』〉〕”’.,!?;:…]/u;
  const opening = /[（《【「『〈〔“‘]/u;
  let start = 0;
  while (start < chars.length) {
    const newline = chars.indexOf("\n", start);
    const limit = newline < 0 ? chars.length : newline;
    if (start === limit) {
      lines.push([]);
      start++;
      continue;
    }
    let end = Math.min(start + columns, limit);
    const fallback = end;
    if (end < limit) {
      while (
        end > start &&
        (closing.test(chars[end]) || opening.test(chars[end - 1]))
      )
        end--;
      if (end === start) end = fallback;
    }
    lines.push(Array.from({ length: end - start }, (_, i) => start + i));
    start = end === limit && newline >= 0 ? end + 1 : end;
  }
  return lines;
}
type Panel = "settings" | "fonts" | "history" | null;
export let inspection:
  | {
      renderer: NativeRenderer;
      setText: (s: string) => void;
      getState: () => unknown;
      action: (s: string) => void;
    }
  | undefined;

function Glyph(p: { char: string; font: string; size: number; color: string }) {
  const outline = createMemo(() =>
    isHan(p.char) ? glyphOutline(p.font, p.char) : null,
  );
  return (
    <Show
      when={outline()}
      fallback={
        <text
          style={{
            fontFamily: p.font,
            fontSize: p.size,
            color: p.color,
            lineHeight: p.size + 8,
          }}
        >
          {p.char}
        </text>
      }
    >
      <svg
        source={outline()!}
        style={{
          width: p.size,
          height: p.size,
          color: p.color,
          pointerEvents: "none",
          flexShrink: 0,
        }}
      />
    </Show>
  );
}
function Setting(p: {
  title: string;
  value: boolean;
  change: () => void;
  palette: Palette;
  note?: string;
}) {
  return (
    <div
      style={{
        ...row,
        minHeight: 43,
        gap: 16,
        justifyContent: "space-between",
        flexShrink: 0,
      }}
    >
      <div style={{ ...col, gap: 1, flexGrow: 1 }}>
        <Label color={p.palette.ink} size={13}>
          {p.title}
        </Label>
        <Show when={p.note}>
          <Label color={p.palette.inkMuted} size={11}>
            {p.note!}
          </Label>
        </Show>
      </div>
      <Toggle
        value={p.value}
        onChange={p.change}
        palette={p.palette}
        label={p.title}
      />
    </div>
  );
}

export function App() {
  const renderer = useGpuixRequired();
  const palette = () => PALETTES[preferences().dark ? "dark" : "light"];
  const [text, setText] = createSignal("");
  const [editing, setEditing] = createSignal(true);
  const [inputFocused, setInputFocused] = createSignal(false);
  const [panel, setPanel] = createSignal<Panel>(null);
  const [fontTarget, setFontTarget] = createSignal<"fontLeft" | "fontRight">(
    "fontRight",
  );
  const [fontSearch, setFontSearch] = createSignal("");
  const [selected, setSelected] = createSignal(-1);
  const [detail, setDetail] = createSignal(false);
  const [playing, setPlaying] = createSignal(false);
  const [completed, setCompleted] = createSignal(0);
  const [fraction, setFraction] = createSignal(0);
  const [speed, setSpeed] = createSignal(1);
  const [passed, setPassed] = createSignal(false);
  const [hidden, setHidden] = createSignal(false);
  const [lastActivation, setLastActivation] = createSignal("");
  let input: { id: number } | undefined;
  let sentenceScroll: { id: number } | undefined;
  const [scrollY, setScrollY] = createSignal(0);
  const readScroll = () => {
    if (sentenceScroll)
      setScrollY(-(renderer.getScrollOffset?.(sentenceScroll.id)?.[1] ?? 0));
  };
  let historyTimer: ReturnType<typeof setTimeout> | undefined;
  let loadedPreferences = false;
  let lastRemembered = "";
  const glyphRefs = new Map<number, number>();
  const bundledFonts = ["LXGW WenKai", "Noto Serif SC", "MiSans VF"];
  const [fonts, setFonts] = createSignal(bundledFonts);
  const [fontError, setFontError] = createSignal("");
  let loadingFonts = false,
    disposed = false;
  async function refreshFonts() {
    if (loadingFonts) return;
    loadingFonts = true;
    setFontError("");
    try {
      const system = await listSystemFonts();
      if (!disposed) setFonts([...new Set([...bundledFonts, ...system])]);
    } catch {
      if (!disposed) setFontError("未能读取本机字体，请重试");
    } finally {
      loadingFonts = false;
    }
  }
  const chars = createMemo(() =>
    Array.from(text().trim().replace(/\r\n?/g, "\n")),
  );
  const hanIndices = createMemo(() =>
    chars().flatMap((c, i) => (isHan(c) ? [i] : [])),
  );
  const character = () => chars()[selected()] ?? "";
  const data = createMemo(() => (detail() ? loadStrokes(character()) : null));
  const cell = () => preferences().size + 8;
  const columns = () => Math.max(1, Math.floor((WIDTH - 32) / cell()));
  const lines = createMemo(() => copybookLines(chars(), columns()));
  const rows = () => Math.max(1, lines().length);
  const rowHeight = () => cell() * (preferences().compare ? 2 : 1);
  const visibleRows = () =>
    Math.max(1, Math.floor((detail() ? 210 : 320) / rowHeight()));
  const sheetHeight = () =>
    chars().length ? Math.min(rows(), visibleRows()) * rowHeight() + 24 : 68;
  const bodyHeight = () =>
    panel()
      ? 310 + (panel() === "settings" && preferences().compare ? 40 : 0)
      : sheetHeight();
  const footerHeight = () =>
    !panel() || (panel() === "history" && preferences().history.length)
      ? FOOTER
      : 0;
  const windowHeight = () =>
    HEADER +
    footerHeight() +
    (editing() && !panel() ? EDITOR : 0) +
    bodyHeight() +
    (detail() && !panel() ? DETAIL : 0) +
    (workerError() ? 30 : 0);

  function remember() {
    const value = text().trim();
    updatePreferences({
      lastText: value,
      history:
        value !== lastRemembered && value && /\p{Script=Han}/u.test(value)
          ? [value, ...preferences().history.filter((x) => x !== value)].slice(
              0,
              18,
            )
          : preferences().history,
    });
    lastRemembered = value;
  }
  function changeText(value: string) {
    setText(Array.from(value).slice(0, 512).join(""));
    if (sentenceScroll) renderer.scrollTo?.(sentenceScroll.id, 0, 0);
    setScrollY(0);
    if (selected() >= Array.from(value.trim()).length) {
      setSelected(-1);
      setDetail(false);
    }
    clearTimeout(historyTimer);
    historyTimer = setTimeout(remember, 1200);
  }
  function returnToCanvas() {
    remember();
    if (text().trim()) setEditing(false);
    setInputFocused(false);
    setPlaying(false);
    renderer.blur?.();
    if (!offscreen)
      void request("return").catch((e) => setWorkerError(e.message));
  }
  function edit(clear = false) {
    if (clear) {
      remember();
      setText("");
      setSelected(-1);
      setDetail(false);
    }
    setPanel(null);
    setEditing(true);
    setTimeout(() => input && renderer.focusElement?.(input.id), 20);
  }
  function summon() {
    setPassed(false);
    setHidden(false);
    native.passThrough(false);
    native.reveal(true);
    if (!offscreen) renderer.activateWindow?.();
    edit(true);
  }
  function openCharacter(index: number) {
    if (!isHan(chars()[index] ?? "")) return;
    setSelected(index);
    setDetail(true);
    setPanel(null);
    setInputFocused(false);
    renderer.blur?.();
    setCompleted(0);
    setFraction(0);
    setPlaying(!reduced);
    const id = glyphRefs.get(index);
    if (id) renderer.scrollIntoView?.(id);
    setTimeout(readScroll, 0);
  }
  function nextCharacter(direction: number) {
    const indices = hanIndices();
    if (!indices.length) return;
    const position = indices.indexOf(selected());
    openCharacter(
      indices[Math.max(0, Math.min(indices.length - 1, position + direction))]!,
    );
  }
  function closeDetail() {
    setDetail(false);
    setPlaying(false);
  }
  function choosePanel(value: Panel) {
    setPanel(value);
    setPlaying(false);
    setInputFocused(false);
    renderer.blur?.();
  }
  function chooseFont(target: "fontLeft" | "fontRight") {
    void refreshFonts();
    setFontTarget(target);
    setFontSearch("");
    choosePanel("fonts");
  }
  function togglePass() {
    if (!hotkeys().pass || !hotkeys().summon) return;
    const value = !passed();
    setPassed(value);
    native.passThrough(value);
    if (value) returnToCanvas();
  }
  function hide() {
    returnToCanvas();
    setHidden(true);
    native.hide();
  }
  async function quit() {
    remember();
    await flushPreferences();
    native.endDrag();
    process.exit(0);
  }
  function replay() {
    setCompleted(0);
    setFraction(0);
    setPlaying(true);
  }
  const strokeImage = createMemo(() => {
    const strokes = data();
    if (!strokes) return "";
    return (
      "data:image/svg+xml;base64," +
      Buffer.from(
        strokeSvg(
          strokes,
          completed(),
          Math.min(1, Math.round(fraction() * 18) / 18),
          palette().ink,
          preferences().dark ? "#9A9AA5" : "#8B8B95",
          "#269F90",
        ),
      ).toString("base64")
    );
  });
  createEffect(() => {
    if (ready() && !loadedPreferences) {
      loadedPreferences = true;
      lastRemembered = preferences().lastText;
      setText(preferences().lastText);
      setEditing(!preferences().lastText);
    }
    if (ready()) native.pin(preferences().pinned);
  });
  createEffect(() => native.resize(WIDTH, windowHeight()));
  createEffect(() => {
    character();
    setCompleted(0);
    setFraction(0);
  });
  createEffect(() => {
    if (!playing() || !detail() || !data()) return;
    let previous = performance.now();
    const timer = setInterval(() => {
      const now = performance.now(),
        delta = Math.min(80, now - previous);
      previous = now;
      const strokes = data();
      if (!strokes || completed() >= strokes.strokes.length) {
        setPlaying(false);
        return;
      }
      const next = fraction() + (delta * speed()) / 650;
      if (next >= 1.18) {
        setCompleted((c) => c + 1);
        setFraction(0);
      } else setFraction(next);
    }, 32);
    onCleanup(() => clearInterval(timer));
  });
  onMount(() => {
    void refreshFonts();
    native.decorate();
    native.resize(WIDTH, windowHeight());
    native.setIcon();
    const attach = () => {
      const h = native.handle();
      if (h)
        void request("attach", { hwnd: Number(h) }).catch((e) =>
          setWorkerError(e.message),
        );
    };
    if (ready()) attach();
    const unsubscribe = subscribe((event) => {
      if (event.event === "ready") attach();
      if (event.event === "activate") {
        setLastActivation(event.reason);
        summon();
      }
      if (event.event === "togglePass") togglePass();
      if (event.event === "toggleHidden") hidden() ? summon() : hide();
    });
    inspection = {
      renderer,
      setText: changeText,
      getState: () => ({
        fontCount: fonts().length,
        fontError: fontError(),
        text: text(),
        character: character(),
        selected: selected(),
        editing: editing(),
        detail: detail(),
        panel: panel(),
        width: WIDTH,
        height: windowHeight(),
        columns: columns(),
        rows: rows(),
        completed: completed(),
        playing: playing(),
        ready: ready(),
        preferences: preferences(),
        error: workerError(),
        passed: passed(),
        lastActivation: lastActivation(),
        summonLabel: summonLabel(),
        hideLabel: hideLabel(),
        passLabel: passLabel(),
      }),
      action: (action) => {
        if (action === "settings") choosePanel("settings");
        if (action === "fonts") chooseFont("fontRight");
        if (action === "back") choosePanel(null);
        if (action === "history") choosePanel("history");
        if (action === "commit") {
          remember();
          setEditing(false);
          setInputFocused(false);
          renderer.blur?.();
        }
        if (action === "edit") edit();
        if (action === "stroke") openCharacter(hanIndices()[0] ?? -1);
        if (action === "next") nextCharacter(1);
        if (action === "previous") nextCharacter(-1);
        if (action === "closeDetail") closeDetail();
        if (action === "pause") setPlaying(false);
        if (action === "play") replay();
        if (action === "dark") updatePreferences({ dark: !preferences().dark });
        if (action === "quit") void quit();
      },
    };
    keyHandler = (event) => {
      if (inputFocused()) return;
      if (event.key === "escape") {
        if (panel()) choosePanel(null);
        else if (detail()) closeDetail();
        else returnToCanvas();
      }
      if (panel()) return;
      if (event.key === "left") nextCharacter(-1);
      if (event.key === "right") nextCharacter(1);
      if (
        event.key === "space" &&
        detail() &&
        !renderer.getFocusedElementId?.()
      )
        completed() >= (data()?.strokes.length ?? 0)
          ? replay()
          : setPlaying(!playing());
    };
    onCleanup(() => {
      disposed = true;
      unsubscribe();
      clearTimeout(historyTimer);
      native.endDrag();
      inspection = undefined;
      keyHandler = undefined;
    });
  });

  return (
    <div
      testId="copybook"
      style={{
        ...col,
        width: "100%",
        height: windowHeight(),
        backgroundColor: palette().panel,
        userSelect: "none",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          ...row,
          height: HEADER,
          flexShrink: 0,
          paddingLeft: 10,
          paddingRight: 6,
          gap: 2,
        }}
      >
        <Show when={panel()}>
          <Button
            icon="back"
            iconOnly
            label="返回字帖"
            onClick={() => choosePanel(null)}
            palette={palette()}
          />
        </Show>
        <div
          testId="window-drag-area"
          onMouseDown={(e) => {
            if (e.button === undefined || e.button === 0) native.drag();
          }}
          onMouseUp={native.endDrag}
          style={{
            ...row,
            height: HEADER,
            flexGrow: 1,
            gap: 7,
            cursor: "grab",
          }}
        >
          <Icon name="grip" color={palette().caption} size={12} />
          <Label color={palette().inkMuted} size={12}>
            {panel() === "settings"
              ? "设置"
              : panel() === "fonts"
                ? "选择字体"
                : panel() === "history"
                  ? "最近输入"
                  : "字伴"}
          </Label>
        </div>
        <Button
          icon="pin"
          iconOnly
          label={preferences().pinned ? "取消置顶" : "置顶"}
          selected={preferences().pinned}
          palette={palette()}
          onClick={() => updatePreferences({ pinned: !preferences().pinned })}
        />
        <Button
          icon="settings"
          iconOnly
          label="设置"
          selected={panel() === "settings"}
          palette={palette()}
          onClick={() =>
            choosePanel(panel() === "settings" ? null : "settings")
          }
        />
        <Button
          icon="minus"
          iconOnly
          label={`隐藏 · ${hideLabel()}`}
          palette={palette()}
          onClick={hide}
          disabled={!hotkeys().summon}
        />
        <Button
          icon="close"
          iconOnly
          label="退出"
          palette={palette()}
          onClick={() => void quit()}
        />
      </div>
      <Show when={editing() && !panel()}>
        <div
          style={{
            ...row,
            height: EDITOR,
            flexShrink: 0,
            paddingLeft: 16,
            paddingRight: 16,
            paddingBottom: 8,
            gap: 4,
          }}
        >
          <input
            testId="sentence-input"
            ref={(el) => {
              input = el;
            }}
            value={text()}
            placeholder="输入要临摹的文字"
            onChange={(e) => changeText(e.value ?? "")}
            onSubmit={returnToCanvas}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            theme={{
              appearance: preferences().dark ? "dark" : "light",
              caret: "#269F90",
            }}
            style={{
              flexGrow: 1,
              minWidth: 0,
              height: 36,
              fontFamily: FONT_UI,
              fontSize: 14,
              padding: 7,
              color: palette().ink,
              borderBottomWidth: 1,
              borderColor: inputFocused() ? "#269F90" : palette().surfaceLine,
            }}
          />
          <Button
            label="完成"
            icon="return"
            palette={palette()}
            onClick={returnToCanvas}
            disabled={!text().trim()}
            testId="commit"
          />
        </div>
      </Show>
      <Show when={!panel()}>
        <div
          style={{ position: "relative", height: bodyHeight(), flexShrink: 0 }}
        >
          <div
            testId="sentence-scroll"
            ref={(el) => {
              sentenceScroll = el;
              setTimeout(readScroll, 0);
            }}
            onScroll={() => setTimeout(readScroll, 0)}
            style={{
              height: bodyHeight() - 24,
              marginTop: 10,
              marginBottom: 14,
              flexShrink: 0,
              overflow: "scroll",
              paddingLeft: 16,
              paddingRight: 16,
            }}
          >
            <Show
              when={chars().length}
              fallback={
                <div style={{ ...row, height: 44, paddingLeft: 7 }}>
                  <Label color={palette().inkMuted} size={12}>
                    整句显示，点字看笔顺。
                  </Label>
                </div>
              }
            >
              <motion.div
                initial={reduced ? false : { opacity: 0, top: 7 }}
                animate={{ opacity: 1, top: 0 }}
                transition={{ duration: reduced ? 0 : 0.24, ease: "easeOut" }}
                style={{
                  ...col,
                  position: "relative",
                  alignItems: "flex-start",
                }}
              >
                <For each={lines()}>
                  {(line) => (
                    <div style={{ ...row, height: rowHeight(), flexShrink: 0 }}>
                      <For each={line}>
                        {(charIndex) => {
                          const index = () => charIndex;
                          const char = chars()[charIndex];
                          return (
                            <div
                              ref={(el) => glyphRefs.set(index(), el.id)}
                              testId={`character-${index()}`}
                              role={isHan(char) ? "button" : undefined}
                              aria-label={
                                isHan(char) ? `${char}的笔顺` : undefined
                              }
                              onClick={() => openCharacter(index())}
                              style={{
                                ...col,
                                position: "relative",
                                width: cell(),
                                height:
                                  cell() * (preferences().compare ? 2 : 1),
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                                cursor: isHan(char) ? "pointer" : "default",
                                borderRadius: 5,
                                backgroundColor:
                                  selected() === index() && detail()
                                    ? palette().surfaceActive
                                    : "transparent",
                                hover: {
                                  backgroundColor: isHan(char)
                                    ? palette().surfaceActive
                                    : "transparent",
                                },
                              }}
                            >
                              <Show when={preferences().grid}>
                                <For
                                  each={preferences().compare ? [0, 1] : [0]}
                                >
                                  {(rowIndex) => (
                                    <svg
                                      source='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="0.5"><rect x="1" y="1" width="98" height="98"/><path d="M50 1v98M1 50h98M1 1l98 98M99 1 1 99" stroke-dasharray="3 3"/></svg>'
                                      style={{
                                        position: "absolute",
                                        width: cell() - 4,
                                        height: cell() - 4,
                                        top: rowIndex * cell() + 2,
                                        left: 2,
                                        color: palette().guideLine,
                                        pointerEvents: "none",
                                      }}
                                    />
                                  )}
                                </For>
                              </Show>
                              <Show when={preferences().compare}>
                                <div
                                  style={{
                                    ...row,
                                    height: cell(),
                                    justifyContent: "center",
                                  }}
                                >
                                  <Glyph
                                    char={char}
                                    font={preferences().fontLeft}
                                    size={preferences().size}
                                    color={palette().inkSoft}
                                  />
                                </div>
                              </Show>
                              <div
                                style={{
                                  ...row,
                                  height: cell(),
                                  justifyContent: "center",
                                }}
                              >
                                <Glyph
                                  char={char}
                                  font={preferences().fontRight}
                                  size={preferences().size}
                                  color={palette().ink}
                                />
                              </div>
                              <motion.div
                                animate={{
                                  width:
                                    selected() === index() && detail() ? 20 : 0,
                                  opacity:
                                    selected() === index() && detail() ? 1 : 0,
                                }}
                                transition={ease}
                                style={{
                                  position: "absolute",
                                  bottom: 0,
                                  height: 2,
                                  borderRadius: 1,
                                  backgroundColor: "#269F90",
                                  pointerEvents: "none",
                                }}
                              />
                            </div>
                          );
                        }}
                      </For>
                    </div>
                  )}
                </For>
              </motion.div>
            </Show>
          </div>
          <Show when={rows() > visibleRows()}>
            <div
              style={{
                position: "absolute",
                right: 5,
                top: 10,
                width: 3,
                height: bodyHeight() - 24,
                borderRadius: 2,
                backgroundColor: palette().surfaceDivider,
                pointerEvents: "none",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  width: 3,
                  borderRadius: 2,
                  height: ((bodyHeight() - 24) * visibleRows()) / rows(),
                  top:
                    (Math.min(
                      scrollY(),
                      (rows() - visibleRows()) * rowHeight(),
                    ) /
                      (rows() * rowHeight())) *
                    (bodyHeight() - 24),
                  backgroundColor: palette().scrollbarThumb,
                  pointerEvents: "none",
                }}
              />
            </div>
          </Show>
        </div>
        <Show when={detail()}>
          <motion.div
            testId="stroke-panel"
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: DETAIL, opacity: 1 }}
            transition={{ duration: reduced ? 0 : 0.22, ease: "easeOut" }}
            style={{
              ...row,
              alignItems: "flex-start",
              flexShrink: 0,
              overflow: "hidden",
              borderTopWidth: 1,
              borderColor: palette().surfaceDivider,
              paddingLeft: 16,
              paddingRight: 16,
              paddingTop: 10,
              gap: 18,
            }}
          >
            <div
              style={{
                ...row,
                width: 156,
                height: 156,
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Show
                when={data()}
                fallback={
                  <Glyph
                    char={character()}
                    font={preferences().fontRight}
                    size={110}
                    color={palette().ink}
                  />
                }
              >
                <img src={strokeImage()} style={{ width: 156, height: 156 }} />
              </Show>
            </div>
            <div
              style={{
                ...col,
                flexGrow: 1,
                height: 156,
                justifyContent: "space-between",
              }}
            >
              <div style={{ ...row, height: 36, flexShrink: 0, gap: 3 }}>
                <Label
                  color={palette().ink}
                  size={13}
                >{`${character()} · 笔顺`}</Label>
                <div style={{ flexGrow: 1 }} />
                <Label
                  color={palette().inkSoft}
                  size={12}
                >{`${hanIndices().indexOf(selected()) + 1} / ${hanIndices().length}`}</Label>
                <Button
                  icon="back"
                  iconOnly
                  label="上一个字 · ←"
                  palette={palette()}
                  onClick={() => nextCharacter(-1)}
                  disabled={hanIndices().indexOf(selected()) <= 0}
                />
                <Button
                  icon="next"
                  iconOnly
                  label="下一个字 · →"
                  palette={palette()}
                  onClick={() => nextCharacter(1)}
                  disabled={
                    hanIndices().indexOf(selected()) >= hanIndices().length - 1
                  }
                />
                <Button
                  icon="close"
                  iconOnly
                  label="收起笔顺 · Esc"
                  palette={palette()}
                  onClick={closeDetail}
                />
              </div>
              <Show
                when={data()}
                fallback={
                  <Label color={palette().inkMuted} size={12}>
                    这个字暂时没有笔顺数据
                  </Label>
                }
              >
                <div style={{ ...row, height: 42, flexShrink: 0, gap: 7 }}>
                  <Button
                    icon="back"
                    iconOnly
                    height={36}
                    label="上一笔"
                    palette={palette()}
                    disabled={completed() === 0}
                    onClick={() => {
                      setPlaying(false);
                      setFraction(0);
                      setCompleted((c) => Math.max(0, c - 1));
                    }}
                  />
                  <Button
                    icon={playing() ? "pause" : "play"}
                    label={playing() ? "暂停" : "播放"}
                    width={80}
                    height={36}
                    selected
                    palette={palette()}
                    onClick={() =>
                      completed() >= (data()?.strokes.length ?? 0)
                        ? replay()
                        : setPlaying(!playing())
                    }
                    testId="stroke-play"
                  />
                  <Button
                    icon="next"
                    iconOnly
                    height={36}
                    label="下一笔"
                    palette={palette()}
                    disabled={completed() >= (data()?.strokes.length ?? 0)}
                    onClick={() => {
                      setPlaying(false);
                      setFraction(0);
                      setCompleted((c) =>
                        Math.min(data()?.strokes.length ?? 0, c + 1),
                      );
                    }}
                  />
                  <Label
                    color={palette().inkSoft}
                    size={13}
                  >{`${Math.min(data()?.strokes.length ?? 0, completed() + (fraction() > 0 ? 1 : 0))} / ${data()?.strokes.length ?? 0} 笔`}</Label>
                </div>
                <div style={{ ...row, gap: 6, height: 32 }}>
                  <Label color={palette().inkSoft} size={12}>
                    ← → 换字
                  </Label>
                  <div style={{ flexGrow: 1 }} />
                  <Button
                    label={`${speed()}×`}
                    palette={palette()}
                    onClick={() =>
                      setSpeed((s) => (s === 1 ? 1.5 : s === 1.5 ? 0.5 : 1))
                    }
                  />
                  <Button
                    icon="replay"
                    iconOnly
                    label="重播"
                    palette={palette()}
                    onClick={replay}
                  />
                </div>
              </Show>
            </div>
          </motion.div>
        </Show>
      </Show>
      <Show when={panel()}>
        <div
          testId="options-scroll"
          style={{
            ...col,
            height: bodyHeight(),
            flexShrink: 0,
            overflow: "scroll",
            paddingLeft: 22,
            paddingRight: 22,
            paddingTop: 10,
            paddingBottom: 12,
          }}
        >
          <Show when={panel() === "settings"}>
            <Setting
              title="双字体对照"
              value={preferences().compare}
              change={() =>
                updatePreferences({ compare: !preferences().compare })
              }
              palette={palette()}
            />
            <Show when={preferences().compare}>
              <div
                style={{
                  ...row,
                  justifyContent: "space-between",
                  height: 40,
                  flexShrink: 0,
                }}
              >
                <Label color={palette().inkMuted} size={12}>
                  对照字体
                </Label>
                <Button
                  label={fontName(preferences().fontLeft)}
                  trailingIcon="chevron"
                  palette={palette()}
                  onClick={() => chooseFont("fontLeft")}
                />
              </div>
            </Show>
            <Setting
              title="米字格"
              value={preferences().grid}
              change={() => updatePreferences({ grid: !preferences().grid })}
              palette={palette()}
            />
            <Setting
              title="深色外观"
              value={preferences().dark}
              change={() => updatePreferences({ dark: !preferences().dark })}
              palette={palette()}
            />
            <Setting
              title="切换中文时唤起"
              note="不在文本框中时生效"
              value={preferences().automatic}
              change={() =>
                updatePreferences({ automatic: !preferences().automatic })
              }
              palette={palette()}
            />
            <div
              style={{
                ...row,
                height: 43,
                justifyContent: "space-between",
                flexShrink: 0,
              }}
            >
              <Label color={palette().ink} size={13}>
                最近输入
              </Label>
              <Button
                icon="history"
                label="查看"
                palette={palette()}
                onClick={() => choosePanel("history")}
              />
            </div>
            <div
              style={{
                ...row,
                height: 38,
                justifyContent: "space-between",
                flexShrink: 0,
                borderTopWidth: 1,
                borderColor: palette().surfaceDivider,
              }}
            >
              <Label color={palette().inkMuted} size={12}>
                唤起快捷键
              </Label>
              <Label color={palette().inkSoft} size={12}>
                {summonLabel()}
              </Label>
            </div>
            <div
              style={{
                ...row,
                height: 34,
                justifyContent: "space-between",
                flexShrink: 0,
              }}
            >
              <Label color={palette().inkMuted} size={12}>
                穿透 / 恢复
              </Label>
              <Label color={palette().inkSoft} size={12}>
                {passLabel()}
              </Label>
            </div>
          </Show>
          <Show when={panel() === "fonts"}>
            <Show when={fontError()}>
              <div
                style={{
                  ...row,
                  justifyContent: "space-between",
                  flexShrink: 0,
                }}
              >
                <Label color={palette().inkMuted} size={12}>
                  {fontError()}
                </Label>
                <Button
                  label="重试"
                  palette={palette()}
                  onClick={() => void refreshFonts()}
                />
              </div>
            </Show>
            <input
              testId="font-search"
              value={fontSearch()}
              onChange={(e) => setFontSearch(e.value ?? "")}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              placeholder="搜索字体"
              theme={{ appearance: preferences().dark ? "dark" : "light" }}
              style={{
                height: 36,
                flexShrink: 0,
                fontFamily: FONT_UI,
                fontSize: 13,
                color: palette().ink,
                padding: 6,
                borderBottomWidth: 1,
                borderColor: palette().surfaceLine,
              }}
            />
            <For
              each={fonts().filter((font) =>
                `${font} ${fontName(font)}`
                  .toLowerCase()
                  .includes(fontSearch().toLowerCase()),
              )}
            >
              {(font) => (
                <div
                  testId={`font:${font}`}
                  style={{
                    ...row,
                    minHeight: 37,
                    flexShrink: 0,
                    justifyContent: "space-between",
                    borderRadius: 5,
                    hover: { backgroundColor: palette().surfaceActive },
                  }}
                  role="button"
                  onClick={() => {
                    updatePreferences({ [fontTarget()]: font });
                    choosePanel(null);
                  }}
                >
                  <Label color={palette().inkSoft} size={13}>
                    {fontName(font)}
                  </Label>
                  <Show when={preferences()[fontTarget()] === font}>
                    <Icon name="check" color="#269F90" />
                  </Show>
                </div>
              )}
            </For>
          </Show>
          <Show when={panel() === "history"}>
            <Show
              when={preferences().history.length}
              fallback={
                <Label color={palette().inkMuted}>还没有输入记录</Label>
              }
            >
              <For each={preferences().history}>
                {(value) => (
                  <div
                    role="button"
                    onClick={() => {
                      changeText(value);
                      setEditing(false);
                      setSelected(-1);
                      closeDetail();
                      choosePanel(null);
                    }}
                    style={{
                      paddingTop: 10,
                      paddingBottom: 10,
                      borderBottomWidth: 1,
                      borderColor: palette().surfaceDivider,
                      flexShrink: 0,
                      hover: { backgroundColor: palette().surfaceActive },
                    }}
                  >
                    <Label
                      color={palette().ink}
                      size={14}
                      style={{ whiteSpace: "normal" }}
                    >
                      {value}
                    </Label>
                  </div>
                )}
              </For>
            </Show>
          </Show>
        </div>
      </Show>
      <Show when={workerError()}>
        <div style={{ ...row, height: 30, flexShrink: 0, paddingLeft: 16 }}>
          <Label color={palette().inkMuted} size={11}>
            {workerError()}
          </Label>
        </div>
      </Show>
      <Show when={footerHeight()}>
        <div
          testId="toolbar"
          style={{
            ...row,
            height: FOOTER,
            flexShrink: 0,
            gap: 2,
            paddingLeft: 9,
            paddingRight: 10,
            borderTopWidth: 1,
            borderColor: palette().surfaceDivider,
          }}
        >
          <Show
            when={!panel()}
            fallback={
              <>
                <div style={{ flexGrow: 1 }} />
                <Button
                  label="清空记录"
                  palette={palette()}
                  onClick={() => updatePreferences({ history: [] })}
                />
              </>
            }
          >
            <Show when={preferences().compare}>
              <Button
                label={`上：${fontName(preferences().fontLeft)}`}
                trailingIcon="chevron"
                width={128}
                palette={palette()}
                onClick={() => chooseFont("fontLeft")}
              />
            </Show>
            <Button
              label={`${preferences().compare ? "下：" : ""}${fontName(preferences().fontRight)}`}
              trailingIcon="chevron"
              width={preferences().compare ? 128 : 132}
              palette={palette()}
              onClick={() => chooseFont("fontRight")}
            />
            <Button
              icon="minus"
              iconOnly
              label="缩小字"
              palette={palette()}
              disabled={preferences().size <= 40}
              onClick={() =>
                updatePreferences({ size: preferences().size - 8 })
              }
            />
            <Label color={palette().inkMuted} size={11}>
              {String(preferences().size)}
            </Label>
            <Button
              icon="plus"
              iconOnly
              label="放大字"
              palette={palette()}
              disabled={preferences().size >= 88}
              onClick={() =>
                updatePreferences({ size: preferences().size + 8 })
              }
            />
            <div style={{ flexGrow: 1 }} />
            <Show when={!editing()}>
              <Button
                icon="edit"
                label="编辑"
                palette={palette()}
                onClick={() => edit()}
              />
            </Show>
            <Button
              icon="pass"
              iconOnly
              label={
                passed()
                  ? `恢复操作 · ${passLabel()}`
                  : `鼠标穿透 · ${passLabel()}`
              }
              palette={palette()}
              selected={passed()}
              onClick={togglePass}
              disabled={!hotkeys().pass || !hotkeys().summon}
            />
          </Show>
        </div>
      </Show>
    </div>
  );
}
