import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { resolve } from "node:path";
const input = resolve(import.meta.dir, "../node_modules/hanzi-writer-data"),
  output = resolve(import.meta.dir, "../assets/strokes");
mkdirSync(output, { recursive: true });
let count = 0;
for (const file of readdirSync(input)) {
  if (!/^\p{Script=Han}\.json$/u.test(file)) continue;
  const value = JSON.parse(readFileSync(resolve(input, file), "utf8"));
  writeFileSync(
    resolve(output, `${file.codePointAt(0)!.toString(16)}.json`),
    JSON.stringify({ strokes: value.strokes, medians: value.medians }),
  );
  count++;
}
copyFileSync(resolve(input, "ARPHICPL.TXT"), resolve(output, "ARPHICPL.TXT"));
console.log(`Prepared ${count} offline characters`);
