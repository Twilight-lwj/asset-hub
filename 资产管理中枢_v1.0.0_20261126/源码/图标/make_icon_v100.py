#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""资产管理中枢 v1.3.3 · 启动图标（沿袭 v1.1.8，本版图标零改动）：黑底白 ¥（adaptive-icon 前景层）。

APK 用的 `res/pd_icon.xml` 已是 adaptive-icon：
    background = @color/ic_launcher_background = #ff000000（纯黑，本版不改）
    foreground = @drawable/pd_fg_* → res/pd_fg_{108,162,216,324,432}.png
所以「黑底白 ¥」只需把 5 张前景 PNG 换成透明底 + 纯白 ¥，ZIP 条目集合不变。

前景按 108dp 画布出图。v1.1.7 应用户要求把 ¥ 改小（v1.1.9 图标零改动）：可见 bbox 高度从画布 ~62%
降到 ~46%（线性缩小约 26%），仍在 72dp 安全区内；四角必须全透明，
保证圆形/方形启动器遮罩下都不被裁、且不与黑底叠成灰边。
"""
import io
import pathlib
import tempfile
from PIL import Image, ImageDraw, ImageFont

OUT = pathlib.Path(__file__).resolve().parent
FONT = '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf'
SIZES = [108, 162, 216, 324, 432]
MASTER = 864                      # 432 * 2，先高分辨率抗锯齿再逐档缩
NAME = 'pd_fg_{}.png'
GLYPH = '\u00a5'                  # ¥ U+00A5（半角，用户原文用的字符）


def build_master():
    im = Image.new('RGBA', (MASTER, MASTER), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    # 二分找字号：让 ¥ 可见高度 ≈ 画布 46%（v1.1.7 缩小）
    lo, hi, best = 8, MASTER, 8
    while lo <= hi:
        mid = (lo + hi) // 2
        f = ImageFont.truetype(FONT, mid)
        bb = d.textbbox((0, 0), GLYPH, font=f)
        h = bb[3] - bb[1]
        if h <= MASTER * 0.46:
            best, lo = mid, mid + 1
        else:
            hi = mid - 1
    f = ImageFont.truetype(FONT, best)
    bb = d.textbbox((0, 0), GLYPH, font=f)
    x = (MASTER - (bb[2] - bb[0])) / 2 - bb[0]
    y = (MASTER - (bb[3] - bb[1])) / 2 - bb[1]
    d.text((x, y), GLYPH, font=f, fill=(255, 255, 255, 255))
    return im


def verify(im, size):
    w, h = im.size
    assert im.mode == 'RGBA' and (w, h) == (size, size)
    a = im.getchannel('A')
    for corner in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        assert a.getpixel(corner) == 0, '四角必须透明'
    bb = a.getbbox()
    assert bb, '前景为空'
    frac = (bb[3] - bb[1]) / h
    assert 0.40 <= frac <= 0.52, 'v1.1.7 ¥ 高度占比必须落在缩小后的安全区: %.3f' % frac
    px = im.load()
    opaque = white = 0
    for yy in range(0, h, 2):
        for xx in range(0, w, 2):
            r, g, b, al = px[xx, yy]
            if al > 16:
                opaque += 1
                if r > 240 and g > 240 and b > 240:
                    white += 1
    ratio = opaque / ((h + 1) // 2 * ((w + 1) // 2))
    assert ratio < 0.35, '不透明率过高（把底色画进前景了）: %.3f' % ratio
    assert white / max(opaque, 1) > 0.99, '前景必须是纯白'
    return bb, round(frac, 3), round(ratio * 100, 1)


def preview(master_108):
    """黑底 + 圆形启动器遮罩的合成预览，供人工复核（不进 APK）。"""
    S = 512
    bg = Image.new('RGBA', (S, S), (0, 0, 0, 255))
    fg = master_108.resize((S, S), Image.LANCZOS)
    comp = Image.alpha_composite(bg, fg)
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, S - 1, S - 1), fill=255)
    out = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    out.paste(comp, (0, 0), mask)
    return out.convert('RGB')


if __name__ == '__main__':
    m = build_master()
    print('母版', m.size, '字体', FONT)
    for s in SIZES:
        im = m.resize((s, s), Image.LANCZOS)
        bb, frac, ratio = verify(im, s)
        p = OUT / NAME.format(s)
        im.save(p, 'PNG', optimize=True)
        print('  %-16s bbox=%s 高度占比=%.3f 不透明率=%.1f%%  %d B'
              % (p.name, bb, frac, ratio, p.stat().st_size))
    prev = preview(m.resize((108, 108), Image.LANCZOS))
    dest = pathlib.Path(tempfile.mkdtemp(prefix='amhub_icon_')) / '图标预览.png'
    prev.save(dest, 'PNG')
    print('预览图:', dest)
