import { existsSync, readdirSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dir, ".."),
  modules = resolve(root, "node_modules"),
  output = resolve(root, "licenses");
mkdirSync(output, { recursive: true });
for (const entry of readdirSync(modules, { withFileTypes: true })) {
  if (entry.name.startsWith(".")) continue;
  const names = entry.name.startsWith("@")
    ? readdirSync(resolve(modules, entry.name)).map(
        (name) => entry.name + "/" + name,
      )
    : [entry.name];
  for (const name of names) {
    const dir = resolve(modules, name);
    if (!existsSync(resolve(dir, "package.json"))) continue;
    for (const file of readdirSync(dir)) {
      if (!/^(LICENSE|LICENCE|COPYING|NOTICE)(\.|$)/i.test(file)) continue;
      const target = resolve(output, name.replaceAll("/", "__"));
      mkdirSync(target, { recursive: true });
      try {
        copyFileSync(resolve(dir, file), resolve(target, file));
      } catch {}
    }
  }
}
