import { openSync, type Font } from "fontkit";
import { dirname, resolve, basename } from "node:path";
const root =
  basename(process.execPath).toLowerCase() === "bun.exe"
    ? resolve(import.meta.dir, "../assets/fonts")
    : resolve(dirname(process.execPath), "assets/fonts");
const files: Record<string, string> = {
  "Noto Serif SC": "NotoSerifSC-VF.ttf",
  "LXGW WenKai": "LXGWWenKai-Regular.ttf",
  "MiSans VF": "MiSansVF.ttf",
};
const fonts = new Map<string, Font>();
const outlines = new Map<string, string>();
export function glyphOutline(family: string, character: string): string | null {
  if (!files[family]) return null;
  const key = family + character;
  if (outlines.has(key)) return outlines.get(key)!;
  try {
    let font = fonts.get(family);
    if (!font) {
      font = openSync(resolve(root, files[family]!)) as Font;
      fonts.set(family, font);
    }
    const glyph = font.glyphForCodePoint(character.codePointAt(0)!);
    if (glyph.id === 0) return null;
    const em = font.unitsPerEm,
      b = glyph.bbox;
    const x = em / 2 - (b.minX + b.maxX) / 2,
      y = em / 2 + (b.minY + b.maxY) / 2;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${em} ${em}"><path transform="translate(${x} ${y}) scale(1 -1)" d="${glyph.path.toSVG()}" fill="currentColor"/></svg>`;
    if (outlines.size > 256) outlines.delete(outlines.keys().next().value!);
    outlines.set(key, svg);
    return svg;
  } catch {
    return null;
  }
}
