#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""资产管理中枢 v1.0.0 · Linux 程序图标（黑底白 ¥，与 Android 图标同款）。

Android 侧是 adaptive-icon：arsc 背景 #ff000000 + 5 张透明底白 ¥ 前景。
桌面端需要一个「不透明方形」图标，故这里把同样的黑底 + 白 ¥ 合成为 512² PNG：
  · 输出 ledger.png（AppImage 内 AppDir/ledger.png 与 .DirIcon）
  · 同时输出 资产管理中枢_程序图标.png 供工作区复核
白色 ¥ 高度占比沿用手机前景的 ~46%，在 512² 上观感与手机启动图标一致。
"""
import pathlib
import tempfile
from PIL import Image, ImageDraw, ImageFont

HERE = pathlib.Path(__file__).resolve().parent
FONT = '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf'
S = 512
MASTER = 1024
GLYPH = '\u00a5'


def build():
    # 先用大画布画白 ¥（透明底），再缩到目标尺寸抗锯齿
    im = Image.new('RGBA', (MASTER, MASTER), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    lo, hi, best = 8, MASTER, 8
    target = MASTER * 0.46
    while lo <= hi:
        mid = (lo + hi) // 2
        f = ImageFont.truetype(FONT, mid)
        bb = d.textbbox((0, 0), GLYPH, font=f)
        h = bb[3] - bb[1]
        if h <= target:
            best, lo = mid, mid + 1
        else:
            hi = mid - 1
    f = ImageFont.truetype(FONT, best)
    bb = d.textbbox((0, 0), GLYPH, font=f)
    x = (MASTER - (bb[2] - bb[0])) / 2 - bb[0]
    y = (MASTER - (bb[3] - bb[1])) / 2 - bb[1]
    d.text((x, y), GLYPH, font=f, fill=(255, 255, 255, 255))
    fg = im.resize((S, S), Image.LANCZOS)

    bg = Image.new('RGBA', (S, S), (0, 0, 0, 255))
    out = Image.alpha_composite(bg, fg).convert('RGB')

    # 断言：四角纯黑、中心区有足够白像素（¥ 确实画上了）
    px = out.load()
    for c in ((0, 0), (S - 1, 0), (0, S - 1), (S - 1, S - 1)):
        assert px[c] == (0, 0, 0), '四角必须纯黑: %s' % (c,)
    white = sum(1 for yy in range(0, S, 3) for xx in range(0, S, 3)
                if px[xx, yy][0] > 240 and px[xx, yy][1] > 240 and px[xx, yy][2] > 240)
    assert white > 300, '白色 ¥ 像素过少: %d' % white
    return out


if __name__ == '__main__':
    icon = build()
    icon.save(HERE / 'ledger.png', 'PNG', optimize=True)
    print('ledger.png', icon.size, (HERE / 'ledger.png').stat().st_size, 'B')
    dst = pathlib.Path(tempfile.mkdtemp(prefix='amhub_icon_')) / '资产管理中枢_程序图标.png'
    icon.save(dst, 'PNG', optimize=True)
    print('复核图', dst)
