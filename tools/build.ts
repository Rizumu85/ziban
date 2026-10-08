import solidPlugin from "@gpuix/solid/bun-plugin";
import "./collect-licenses";
import {
  mkdirSync,
  cpSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dir, "..");
const output = resolve(root, "dist");
mkdirSync(output, { recursive: true });
const result = await Bun.build({
  entrypoints: [resolve(root, "src/bootstrap.ts")],
  target: "bun",
  plugins: [solidPlugin],
  minify: true,
  compile: {
    outfile: resolve(output, "Ziban.exe"),
    windows: {
      hideConsole: true,
      icon: resolve(root, "assets/Ziban-paper.ico"),
      title: "字伴",
      description: "字伴 · Windows 悬浮汉字字帖",
      publisher: "Rizum",
      version: "0.2.6.0",
    },
  },
  define: { "process.env.ZIBAN_INSPECT": '"0"' },
});
if (!result.success) {
  console.error(result.logs);
  process.exit(1);
}
const executable = resolve(output, "Ziban.exe"),
  bytes = readFileSync(executable);
const pe = bytes.readUInt32LE(0x3c);
if (bytes.readUInt32LE(pe) !== 0x4550) throw new Error("Invalid PE");
bytes.writeUInt16LE(2, pe + 24 + 68);
writeFileSync(executable, bytes);
copyFileSync(
  resolve(root, "target/release/ziban-companion.exe"),
  resolve(output, "ziban-companion.exe"),
);
copyFileSync(
  resolve(
    root,
    "node_modules/@gpuix/native-win32-x64-msvc/gpuix-native.win32-x64-msvc.node",
  ),
  resolve(output, "gpuix-native.win32-x64-msvc.node"),
);
cpSync(resolve(root, "assets"), resolve(output, "assets"), { recursive: true });
cpSync(resolve(root, "licenses"), resolve(output, "licenses"), {
  recursive: true,
});
copyFileSync(resolve(root, "LICENSE"), resolve(output, "LICENSE.txt"));
copyFileSync(
  resolve(root, "THIRD_PARTY_NOTICES.md"),
  resolve(output, "THIRD_PARTY_NOTICES.md"),
);
copyFileSync(resolve(root, "README.md"), resolve(output, "使用说明.md"));
mkdirSync(resolve(output, "design"), { recursive: true });
copyFileSync(
  resolve(root, "design/v2-sentence.png"),
  resolve(output, "design/v2-sentence.png"),
);
console.log("Built Windows portable app:", executable);
