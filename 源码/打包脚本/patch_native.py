#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""资产管理中枢 v1.3.8 · 原生层等长二进制补丁（补丁算法源自 v1.3.1，本版沿用未改）。
本版原生层零改动：v1.2.5 只改前端 CSS（dock 去分隔线 / 平板竖屏贴顶 / 弹层居中），
dex / arsc 补丁与 v1.1.4、v1.1.5 逐字节完全相同（同一份 base.apk、同一组等长指令）。
以下叙述中的 v1.1.4 指补丁来源版本。

本版纠正 v1.1.3 的透明导航栏方案（用户反馈「手势条取色依旧错误，是不是取色到黑边了」）：

真机截图 1080x2374 逐行取色：
  y=0..96     状态栏纯白 #ffffff
  y=2320..2373 手势区全宽 RGB(17,17,17)=#111111，中间浅色手势条 RGB(174,174,174)
  y=2254..2258 页面底部黑色横线同色 #111111（--ink）
  WebView 视口止于 y=2319，手势区由系统绘制，不在网页内。
透明 navigationBarColor 让系统失去明确的背景色信号，只能按窗口底部内容「动态取色 /
对比度强制」决定手势区配色；取到的正是紧贴手势区的页面黑边（--ink）。结果就是
「黑底 + 浅色手势条」，且 windowLightNavigationBar=true 被忽略。

v1.1.4 三层修复：
  1) resources.arsc：Theme.PnlBoard 的 navigationBarColor 由 #00000000 改回
     #ffffffff（不透明白），给系统明确的浅色信号；其余 6 条同 v1.1.2/v1.1.3。
  2) classes.dex：在 applySystemBars$lambda$9 内、setNavigationBarColor 之后
     **运行时**调用 Window.setNavigationBarContrastEnforced(false)。这是与
     arsc 主题属性 enforceNavigationBarContrast=false 不同的关键一步：主题属性
     只在窗口创建时读一次，而前端每次 setSystemBars / 弹层开关都会触发系统重绘，
     ROM 会重新按内容取色；运行时显式关闭才能压住。等长复用两条冗余指令：
       原 0015 invoke-virtual {v2}, getWindow() (6B) + 0018 move-result-object v0 (2B)
       新      const/4 v1, #0 (2B) + invoke-virtual {v0,v1},
              Window.setNavigationBarContrastEnforced(Z)V (6B) = method@0b83
     v0 此时仍是 000e/0011 取到的 Window，v1 随后被 0019/001c 重新赋值为 Window，
     后续 getDecorView / getInsetsController / setAppearanceLight* 全不受影响。
     该 lambda 整体在 runCatching 内，API 24-28 若遇 NoSuchMethodError 会被吞掉，
     低版本无手势导航、主题已是白底深色图标，不受影响。
  3) 前端 setSystemBars('#ffffffff', true)：不再把 WebView 背景刷成透明。

沿用 v1.1.2/v1.1.3 的两处 dex 补丁：
     onCreate 的 const v2,#ff0d1117（WebView 背景）→ const v2,#ffffffff
     onCreate 的 invoke-direct applySystemBars("#0d1117", false) → 3 个 nop
最后重算 DEX header 的 SHA-1 signature 与 adler32 checksum。
所有补丁等长，字符串池、资源 id 顺序、方法表均不变。
"""
import hashlib
import struct
import sys
import zlib

# ---- resources.arsc -------------------------------------------------------
STYLE_ENTRIES_OFF = 242452
STYLE_COUNT = 7
ENTRY_SIZE = 12
TYPE_COLOR = 0x1D
TYPE_BOOL = 0x12

ORIGINAL = [
    (0x01010054, TYPE_COLOR, 0xFF0D1117),
    (0x01010451, TYPE_COLOR, 0xFF0D1117),
    (0x01010452, TYPE_COLOR, 0xFF0D1117),
    (0x010104E0, TYPE_BOOL, 0),
    (0x0101056C, TYPE_BOOL, 0),
    (0x7F030051, TYPE_COLOR, 0xFF58A6FF),
    (0x7F030058, TYPE_COLOR, 0xFF58A6FF),
]
TARGET = [
    (0x01010054, TYPE_COLOR, 0xFFFFFFFF),   # windowBackground
    (0x01010450, TYPE_BOOL, 1),             # windowDrawsSystemBarBackgrounds
    (0x01010451, TYPE_COLOR, 0xFFFFFFFF),   # statusBarColor
    (0x01010452, TYPE_COLOR, 0xFFFFFFFF),   # navigationBarColor = 不透明白（本版关键）
    (0x010104E0, TYPE_BOOL, 1),             # windowLightStatusBar
    (0x0101056C, TYPE_BOOL, 1),             # windowLightNavigationBar
    (0x01010605, TYPE_BOOL, 0),             # enforceNavigationBarContrast
]


def _entry(buf, off):
    key, size, res0, dtype, data = struct.unpack_from('<IHBBI', buf, off)
    assert size == 8 and res0 == 0, (off, size, res0)
    return (key, dtype, data)


def pack_entries(rows):
    assert len(rows) == STYLE_COUNT
    keys = [r[0] for r in rows]
    assert keys == sorted(keys), 'style 属性必须按 id 升序'
    out = bytearray()
    for key, dtype, data in rows:
        out += struct.pack('<IHBBI', key, 8, 0, dtype, data)
    assert len(out) == STYLE_COUNT * ENTRY_SIZE
    return bytes(out)


def patch_arsc(buf):
    b = bytearray(buf)
    got = [_entry(b, STYLE_ENTRIES_OFF + i * ENTRY_SIZE) for i in range(STYLE_COUNT)]
    assert got == ORIGINAL, 'resources.arsc 不是预期的原版：\n%s' % (
        '\n'.join('  %08x %02x %08x' % g for g in got),)
    b[STYLE_ENTRIES_OFF:STYLE_ENTRIES_OFF + STYLE_COUNT * ENTRY_SIZE] = pack_entries(TARGET)
    assert len(b) == len(buf), 'arsc 长度不可变'
    return bytes(b)


# ---- classes.dex ----------------------------------------------------------
WEBVIEW_BG_OFF = 0x1F1292
WEBVIEW_BG_OLD = bytes.fromhex('140217110dff')
WEBVIEW_BG_NEW = bytes.fromhex('1402ffffffff')
APPLY_CALL_OFF = 0x1F12A2
APPLY_CALL_OLD = bytes.fromhex('7030765b6503')
APPLY_CALL_NEW = bytes.fromhex('000000000000')

# v1.1.4 新增：applySystemBars$lambda$9 内冗余 getWindow() 复用为关对比度强制
CONTRAST_OFF = 0x1F0E62
CONTRAST_OLD = bytes.fromhex('6e107f5b02000c00')   # getWindow() + move-result-object v0
CONTRAST_NEW = bytes.fromhex('12016e20830b1000')   # const/4 v1,#0 + setNavigationBarContrastEnforced(false)
                                                      # 12n 格式：高 4 位=立即数，低 4 位=寄存器


def patch_dex(buf):
    b = bytearray(buf)
    assert b[:4] == b'dex\n', '不是 DEX'
    for off, old, new, tag in (
        (WEBVIEW_BG_OFF, WEBVIEW_BG_OLD, WEBVIEW_BG_NEW, 'WebView 背景'),
        (APPLY_CALL_OFF, APPLY_CALL_OLD, APPLY_CALL_NEW, '启动 applySystemBars'),
        (CONTRAST_OFF, CONTRAST_OLD, CONTRAST_NEW, '关对比度强制'),
    ):
        assert bytes(b[off:off + len(old)]) == old, tag + ' 指令不匹配 @%08x' % off
        b[off:off + len(old)] = new
    # DEX header: signature = sha1(data[32:]), checksum = adler32(data[12:])
    b[12:32] = hashlib.sha1(bytes(b[32:])).digest()
    b[8:12] = struct.pack('<I', zlib.adler32(bytes(b[12:])) & 0xFFFFFFFF)
    assert len(b) == len(buf), 'dex 长度不可变'
    return bytes(b)


def verify(dex, arsc):
    assert hashlib.sha1(dex[32:]).digest() == dex[12:32], 'DEX SHA-1 signature 错误'
    assert struct.unpack_from('<I', dex, 8)[0] == zlib.adler32(dex[12:]) & 0xFFFFFFFF, 'DEX checksum 错误'
    assert struct.unpack_from('<I', dex, 32)[0] == len(dex), 'DEX file_size 错误'
    for off, new in ((WEBVIEW_BG_OFF, WEBVIEW_BG_NEW),
                     (APPLY_CALL_OFF, APPLY_CALL_NEW),
                     (CONTRAST_OFF, CONTRAST_NEW)):
        assert bytes(dex[off:off + len(new)]) == new, '@%08x 补丁丢失' % off
    got = [_entry(arsc, STYLE_ENTRIES_OFF + i * ENTRY_SIZE) for i in range(STYLE_COUNT)]
    assert got == TARGET, 'arsc 主题属性不符合目标：%s' % got
    for kw in (b'nsRequest', b'exportBackup', b'setSystemBars', b'openLedger', b'PnlAndroid',
               b'setNavigationBarContrastEnforced'):
        assert kw in dex, '原生桥 / 方法丢失: %s' % kw
    return True


if __name__ == '__main__':
    import os
    import tempfile
    import zipfile
    here = os.path.dirname(os.path.abspath(__file__))
    base = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, 'base.apk')
    z = zipfile.ZipFile(base)
    d0, a0 = z.read('classes.dex'), z.read('resources.arsc')
    d1, a1 = patch_dex(d0), patch_arsc(a0)
    verify(d1, a1)
    print('[PASS] arsc 改动 %d 字节，dex 改动 %d 字节（总长均不变）' % (
        sum(x != y for x, y in zip(a0, a1)), sum(x != y for x, y in zip(d0, d1))))
    print('       arsc: navigationBarColor=#ffffffff；dex: 3 处等长指令补丁')
    out = tempfile.mkdtemp(prefix='amhub_patch_')
    open(os.path.join(out, 'classes.dex'), 'wb').write(d1)
    open(os.path.join(out, 'resources.arsc'), 'wb').write(a1)
    print('       产物:', out)
