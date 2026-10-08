from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent
image = Image.new("RGBA", (1024, 1024))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((8, 8, 1016, 1016), radius=64, fill="#F5F7F6", outline="#D8DEDB", width=6)
draw.line((512, 132, 512, 892), fill="#DFE7E3", width=4)
draw.line((132, 512, 892, 512), fill="#DFE7E3", width=4)
font = ImageFont.truetype(str(root / "assets/fonts/LXGWWenKai-Regular.ttf"), 740)
draw.text((512, 510), "字", font=font, fill="#205F56", anchor="mm")
image.save(root / "assets/Ziban.ico", sizes=[(s,s) for s in (16,18,24,27,32,36,48,54,64,128,256)])
image.resize((256,256),Image.Resampling.LANCZOS).save(root / "design/icon.png")
