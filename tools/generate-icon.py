"""Package the selected paper icon master into Windows ICO sizes; requires Pillow."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
sizes = (16, 18, 20, 24, 27, 32, 36, 40, 48, 54, 64, 96, 128, 256)
with Image.open(root / "design/icon-paper-source.png") as source:
    image = source.convert("RGBA")
    if image.width != image.height:
        raise ValueError("Icon master must be square")
    image.save(root / "assets/Ziban-paper.ico", sizes=[(s, s) for s in sizes])
    image.resize((256, 256), Image.Resampling.LANCZOS).save(root / "design/icon.png")
with Image.open(root / "assets/Ziban-paper.ico") as icon:
    if icon.ico.sizes() != {(s, s) for s in sizes}:
        raise ValueError("Missing ICO sizes")
    for size in icon.ico.sizes():
        icon.ico.getimage(size).load()
print(f"Packaged and decoded {len(sizes)} icon sizes")
