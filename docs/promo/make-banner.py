"""生成 GitHub 社交预览图（1280×640）。用法：python docs/promo/make-banner.py"""
from PIL import Image, ImageDraw, ImageFont

W, H = 1280, 640
BG = "#0F1115"
BG2 = "#151821"
FG = "#F4F6FB"
MUTED = "#9AA0AC"
ACCENT = "#4D6BFE"
CARD = "#1B1B1F"
STROKE = "#2C2C2E"

FONT_DIR = "C:/Windows/Fonts"
def font(name, size):
    return ImageFont.truetype(f"{FONT_DIR}/{name}", size)

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

# 背景微渐变
for y in range(H):
    t = y / H
    r = int(15 + (21 - 15) * t)
    g = int(17 + (24 - 17) * t)
    b = int(21 + (33 - 21) * t)
    d.line([(0, y), (W, y)], fill=(r, g, b))

# 左侧文案
x = 80
d.text((x, 96), "dsh-ctxedit", font=font("msyhbd.ttc", 76), fill=FG)
d.text((x, 196), "DeepSeek Harness · 上下文编辑插件", font=font("msyh.ttc", 30), fill=MUTED)

lines = [
    ("改写回复", "模型下一轮读新版，原日志不动"),
    ("就地回退", "这条及之后移出模型视野，界面同步隐藏"),
    ("还原原稿", "血统回溯到最初版本"),
]
y = 272
for title, desc in lines:
    d.ellipse([x, y + 9, x + 12, y + 21], fill=ACCENT)
    d.text((x + 26, y), title, font=font("msyhbd.ttc", 30), fill=FG)
    d.text((x + 26 + 132, y + 4), desc, font=font("msyh.ttc", 24), fill=MUTED)
    y += 56

d.text((x, 520), "github.com/AtinyFurina/dsh-ctxedit", font=font("msyh.ttc", 24), fill="#6E7480")

# 右侧示意卡片
cx, cy, cw, ch = 790, 150, 410, 340
d.rounded_rectangle([cx, cy, cx + cw, cy + ch], radius=20, fill=CARD, outline=STROKE, width=1)

# 用户气泡
bx, by, bw, bh = cx + 96, cy + 36, 286, 92
d.rounded_rectangle([bx, by, bx + bw, by + bh], radius=18, fill="#25304A")
d.text((bx + 20, by + 16), "把上一轮的回答改短一点", font=font("msyh.ttc", 20), fill="#DCE4FF")
d.text((bx + 20, by + 50), "别动原始日志", font=font("msyh.ttc", 20), fill="#9FB0E8")

# 助手回复
d.text((cx + 28, cy + 168), "助手回复", font=font("msyh.ttc", 18), fill=MUTED)
d.rounded_rectangle([cx + 28, cy + 196, cx + cw - 28, cy + 262], radius=12, fill="#232326")
d.text((cx + 44, cy + 210), "已改写：模型下一轮读到新版", font=font("msyh.ttc", 19), fill=FG)
d.text((cx + 44, cy + 236), "界面保留原文，可随时还原", font=font("msyh.ttc", 19), fill=MUTED)

# 回溯图标
ix, iy, ir = cx + 40, cy + 300, 16
d.ellipse([ix - ir, iy - ir, ix + ir, iy + ir], outline=ACCENT, width=2)
d.arc([ix - 8, iy - 8, ix + 8, iy + 8], 200, 340, fill=FG, width=2)
d.polygon([(ix - 8, iy - 4), (ix - 4, iy - 9), (ix - 1, iy - 3)], fill=FG)
d.text((cx + 68, cy + 288), "用户消息左侧：就地回退", font=font("msyh.ttc", 18), fill=MUTED)

img.save("docs/promo/social-preview.png", "PNG")
print("saved docs/promo/social-preview.png")
