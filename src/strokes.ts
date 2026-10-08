import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
export interface StrokeData {
  strokes: string[];
  medians: number[][][];
}
const base =
  basename(process.execPath).toLowerCase() === "bun.exe"
    ? resolve(import.meta.dir, "../assets/strokes")
    : resolve(dirname(process.execPath), "assets/strokes");
const cache = new Map<string, StrokeData | null>();
export function loadStrokes(character: string): StrokeData | null {
  if (!/^\p{Script=Han}$/u.test(character)) return null;
  if (cache.has(character)) return cache.get(character)!;
  const path = resolve(base, `${character.codePointAt(0)!.toString(16)}.json`);
  let data: StrokeData | null = null;
  try {
    if (existsSync(path)) {
      const v = JSON.parse(readFileSync(path, "utf8"));
      if (
        Array.isArray(v.strokes) &&
        Array.isArray(v.medians) &&
        v.strokes.length === v.medians.length
      )
        data = v;
    }
  } catch {}
  if (cache.size > 64) cache.delete(cache.keys().next().value!);
  cache.set(character, data);
  return data;
}
export function strokeSvg(
  data: StrokeData,
  completed: number,
  fraction: number,
  ink: string,
  guide: string,
  active: string,
): string {
  const paths = data.strokes
    .map((d, i) => `<path d="${d}" fill="${i < completed ? ink : guide}"/>`)
    .join("");
  let current = "";
  if (completed < data.strokes.length && fraction > 0) {
    const points = data.medians[completed]!;
    let total = 0;
    const lengths = points.slice(1).map((p, i) => {
      const a = points[i]!;
      const l = Math.hypot(p[0]! - a[0]!, p[1]! - a[1]!);
      total += l;
      return l;
    });
    let remaining = total * fraction;
    let d = `M ${points[0]![0]} ${points[0]![1]}`;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!,
        b = points[i]!,
        l = lengths[i - 1]!;
      const ratio = Math.min(1, remaining / (l || 1));
      d += ` L ${a[0]! + (b[0]! - a[0]!) * ratio} ${a[1]! + (b[1]! - a[1]!) * ratio}`;
      remaining -= l;
      if (remaining <= 0) break;
    }
    current = `<defs><clipPath id="s"><path d="${data.strokes[completed]}"/></clipPath></defs><path d="${d}" fill="none" stroke="${active}" stroke-width="150" stroke-linecap="round" stroke-linejoin="round" clip-path="url(#s)"/><circle cx="${points[0]![0]}" cy="${points[0]![1]}" r="18" fill="${active}" stroke="white" stroke-width="7"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-50 -70 1124 1124"><g transform="translate(0,900) scale(1,-1)">${paths}${current}</g></svg>`;
}
