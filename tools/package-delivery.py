"""Package an existing Windows build. Run after `bun run build`. Python 3 only."""

from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parents[1]
version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
output = root / "release"
output.mkdir(exist_ok=True)

required = ["Ziban.exe", "ziban-companion.exe", "gpuix-native.win32-x64-msvc.node"]
for name in required:
    if not (root / "dist" / name).is_file():
        raise RuntimeError(f"Missing dist/{name}; build before packaging")

portable = output / f"ziban-v{version}-windows-x64.zip"
with zipfile.ZipFile(portable, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for file in sorted((root / "dist").rglob("*")):
        if file.is_file():
            archive.write(file, Path("Ziban") / file.relative_to(root / "dist"))

with zipfile.ZipFile(portable) as archive:
    bad_file = archive.testzip()
    if bad_file:
        raise RuntimeError(f"Corrupt archive member: {bad_file}")

digest = hashlib.sha256(portable.read_bytes()).hexdigest()
(output / "SHA256SUMS.txt").write_text(f"{digest}  {portable.name}\n", encoding="utf-8")
print(f"{portable.name}: {portable.stat().st_size / 1024 / 1024:.1f} MiB; verified")
