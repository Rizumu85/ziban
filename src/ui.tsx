import { createSignal, type JSX } from "solid-js";
import { motion, type StyleDesc } from "@gpuix/solid";

import * as Tooltip from "@gpuix/solid/tooltip";
import { FONT_UI, FONT_SERIF, MOTION, type Palette } from "./theme";
import { prefersReducedMotion } from "./platform/window";

export const reduced = prefersReducedMotion();
export const ease = { duration: reduced ? 0 : 0.18, ease: MOTION.easeOut };
export const row: StyleDesc = {
  display: "flex",
  flexDirection: "row",
  alignItems: "center",
};
export const col: StyleDesc = { display: "flex", flexDirection: "column" };
export function Label(p: {
  children: string;
  color: string;
  size?: number;
  serif?: boolean;
  style?: StyleDesc;
}) {
  return (
    <text
      style={{
        fontFamily: p.serif ? FONT_SERIF : FONT_UI,
        fontSize: p.size ?? 13,
        lineHeight: (p.size ?? 13) + 7,
        color: p.color,
        ...p.style,
      }}
    >
      {p.children}
    </text>
  );
}
const paths: Record<string, string> = {
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  edit: '<path d="m15 4 5 5-10 10-6 1 1-6ZM13 6l5 5"/>',
  grip: '<path d="M8 6h8M8 12h8M8 18h8"/>',
  pin: '<path d="m9 3 6 0-1 6 4 4v2H6v-2l4-4-1-6ZM12 15v6"/>',
  settings:
    '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  back: '<path d="m14 6-6 6 6 6"/>',
  next: '<path d="m10 6 6 6-6 6"/>',
  play: '<path d="m9 5 11 7-11 7Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  replay: '<path d="M4 9a8 8 0 1 1 0 6M4 3v6h6"/>',
  grid: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 4v16M4 12h16"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  return: '<path d="M19 5v9H5m5-5-5 5 5 5"/>',
  pass: '<path d="m6 3 13 10-7 1-3 7-3-18Z"/>',
  history: '<path d="M4 9a8 8 0 1 1 0 6M4 3v6h6M12 8v5l3 2"/>',
  compare:
    '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14"/>',
  book: '<path d="M4 4h7a3 3 0 0 1 3 3v14a3 3 0 0 0-3-3H4ZM14 7a3 3 0 0 1 3-3h3v14h-3a3 3 0 0 0-3 3"/>',
};
export function Icon(p: { name: string; color: string; size?: number }) {
  return (
    <svg
      source={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round">${paths[p.name] ?? paths.book}</svg>`}
      style={{
        width: p.size ?? 16,
        height: p.size ?? 16,
        color: p.color,
        flexShrink: 0,
        pointerEvents: "none",
      }}
    />
  );
}
export function Button(p: {
  label: string;
  onClick: () => void;
  palette: Palette;
  icon?: string;
  trailingIcon?: string;
  selected?: boolean;
  iconOnly?: boolean;
  width?: number;
  height?: number;
  disabled?: boolean;
  testId?: string;
}) {
  const [pressed, setPressed] = createSignal(false);
  const [focused, setFocused] = createSignal(false);
  const action = () => {
    if (!p.disabled) p.onClick();
  };
  const content = (
    <motion.div
      role="button"
      aria-label={p.label}
      aria-selected={p.selected}
      tabIndex={p.disabled ? -1 : 0}
      testId={p.testId}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onClick={action}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      onKeyDown={(e) => {
        if (e.key === "enter" || e.key === "space") action();
      }}
      animate={{
        opacity: p.disabled ? 0.38 : pressed() ? 0.72 : 1,
        top: pressed() ? 2 : 0,
      }}
      transition={{ duration: reduced ? 0 : 0.08 }}
      style={{
        ...row,
        position: "relative",
        height: p.height ?? 32,
        width: p.iconOnly ? (p.height ?? 32) : p.width,
        justifyContent: "center",
        gap: 6,
        paddingLeft: p.iconOnly ? 0 : p.width && p.width <= 36 ? 4 : 10,
        paddingRight: p.iconOnly ? 0 : p.width && p.width <= 36 ? 4 : 10,
        borderRadius: 8,
        backgroundColor: pressed()
          ? p.palette.segmentedTrack
          : p.selected
            ? p.palette.segmentedThumb
            : "transparent",
        borderWidth: 1,
        borderColor: pressed()
          ? p.palette.guideLine
          : focused()
            ? p.palette.inkMuted
            : p.selected
              ? p.palette.surfaceLine
              : "transparent",
        cursor: p.disabled ? "default" : "pointer",
        hover: { backgroundColor: p.palette.surfaceActive },
        flexShrink: 0,
      }}
    >
      {p.icon && (
        <Icon
          name={p.icon}
          color={p.selected ? p.palette.ink : p.palette.inkSoft}
        />
      )}
      {!p.iconOnly && (
        <Label
          color={p.selected ? p.palette.ink : p.palette.inkSoft}
          size={12}
          style={{
            minWidth: 0,
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          {p.label}
        </Label>
      )}
      {p.trailingIcon && (
        <Icon name={p.trailingIcon} color={p.palette.inkMuted} size={13} />
      )}
    </motion.div>
  );
  return p.iconOnly ? (
    <Tooltip.Root delayDuration={520}>
      <Tooltip.Trigger asChild>{content}</Tooltip.Trigger>
      <Tooltip.Content
        side="bottom"
        sideOffset={6}
        style={{
          padding: 7,
          borderRadius: 7,
          backgroundColor: p.palette.floatingSurface,
          borderWidth: 1,
          borderColor: p.palette.surfaceLine,
        }}
      >
        <Label color={p.palette.inkSoft} size={11}>
          {p.label}
        </Label>
      </Tooltip.Content>
    </Tooltip.Root>
  ) : (
    content
  );
}
export function Toggle(p: {
  value: boolean;
  onChange: () => void;
  palette: Palette;
  label: string;
}) {
  return (
    <div
      role="switch"
      aria-label={p.label}
      aria-valuetext={p.value ? "开" : "关"}
      tabIndex={0}
      onClick={p.onChange}
      onKeyDown={(e) => {
        if (e.key === "enter" || e.key === "space") p.onChange();
      }}
      style={{
        width: 36,
        height: 22,
        backgroundColor: p.value ? "#269F90" : p.palette.surfaceLine,
        borderRadius: 999,
        position: "relative",
        cursor: "pointer",
      }}
    >
      <motion.div
        animate={{ left: p.value ? 17 : 3 }}
        transition={ease}
        style={{
          position: "absolute",
          top: 3,
          width: 16,
          height: 16,
          borderRadius: 999,
          backgroundColor: "#FFFFFF",
        }}
      />
    </div>
  );
}
