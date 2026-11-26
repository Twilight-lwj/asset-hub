#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""资产管理中枢 v1.0.0 · Android APK 打包（模式 B：换内嵌页 + 改清单 + 同密钥重签）。
基础包：通用 WebView 壳（dex 内含坚果云 WebDAV 原生桥
PnlAndroid.nsRequest / exportBackup / setSystemBars，单文件 assets/index.html）。
`classes.dex` / `resources.arsc` 与基础包逐字节相同；清单只改
package（com.amhub.app）、label、versionName=1.0.0、versionCode=1。
注意：包名与 versionCode 均与旧项目不同，属**独立新应用**，不能覆盖安装旧包。
签名口令不入库：由环境变量 AMHUB_KS_PASS 或 密钥/keystore.pass 提供（该目录已被 .gitignore 排除）。"""
import glob
import hashlib
import os
import re
import shutil
import struct
import subprocess
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
def _find_root():
    d = HERE
    for _ in range(5):
        if os.path.isdir(os.path.join(d, '源码')) or os.path.isdir(os.path.join(d, 'dist')):
            return d
        d = os.path.dirname(d)
    return os.path.dirname(os.path.dirname(HERE))
ROOT = _find_root()
sys.path.insert(0, HERE)
from axml import Axml  # noqa: E402
from patch_native_v100 import patch_dex, patch_arsc, verify as verify_native  # noqa: E402

TOOLS = os.environ.get('ANDROID_TOOLS', '')
if not TOOLS:
    for _cand in (os.path.expanduser('~/.workbuddy/binaries/android-tools'),
                  os.path.expanduser('~/android-tools'),
                  '/opt/android-tools'):
        if os.path.isdir(_cand):
            TOOLS = _cand
            break
if not TOOLS:
    raise SystemExit('未找到 Android 工具链：请设环境变量 ANDROID_TOOLS'
                     ' 指向含 android-14/ 与 jdk-*/ 的目录')
BT = os.path.join(TOOLS, 'android-14')
_JDKS = sorted(glob.glob(os.path.join(TOOLS, 'jdk*', 'bin')))
JDK = _JDKS[-1] if _JDKS else os.path.join(TOOLS, 'jdk-17.0.21+9', 'bin')
AAPT2 = os.path.join(BT, 'aapt2')
ZIPALIGN = os.path.join(BT, 'zipalign')
APKSIGNER = os.path.join(BT, 'apksigner')
KEYTOOL = os.path.join(JDK, 'keytool')

APP = 'amhub'
LABEL = '资产管理中枢'
PKG = 'com.amhub.app'
OLD_PKG = 'com.pnlboard.app'
VERSION_NAME = '1.0.0'
VERSION_CODE = 1
KS = os.path.join(ROOT, '密钥', LABEL + '_Android签名密钥_v' + VERSION_NAME + '.jks')
_PASS_FILE = os.path.join(ROOT, '密钥', 'keystore.pass')
KS_PASS = os.environ.get('AMHUB_KS_PASS', '')
if not KS_PASS and os.path.exists(_PASS_FILE):
    with open(_PASS_FILE, encoding='utf-8') as _f:
        KS_PASS = _f.read().strip()
if not KS_PASS:
    raise SystemExit('缺少签名口令：请设环境变量 AMHUB_KS_PASS，或写入 %s（该目录已被 .gitignore 排除）' % _PASS_FILE)
KS_ALIAS = os.environ.get('AMHUB_KS_ALIAS', 'ledger')
BASE_CANDIDATES = [os.path.join(ROOT, 'base.apk'),
                   os.path.join(ROOT, '源码', '打包脚本', 'base.apk')]
BASE = next((p for p in BASE_CANDIDATES if os.path.exists(p)), BASE_CANDIDATES[0])
PAGE = os.path.join(ROOT, '源码', LABEL + '_浏览器版_v' + VERSION_NAME + '.html')
DIST = os.environ.get('DIST', ROOT)   # 默认落在版本目录（与成品同目录），.gitignore 已排除 *.apk
OUT = os.path.join(DIST, LABEL + '_Android安装包_v' + VERSION_NAME + '.apk')
DROP = ('.SF', '.RSA', '.DSA', '.MF', '.EC')
# v1.2.5 沿用：adaptive-icon 的 5 张前景 PNG（黑底白 ¥；背景色在 arsc 里已是纯黑，不改）
ICON_DIR = os.path.join(ROOT, '源码', '图标')
ICON_FILES = ['res/pd_fg_%d.png' % d for d in (108, 162, 216, 324, 432)]

ENV = dict(os.environ)
ENV['PATH'] = JDK + os.pathsep + BT + os.pathsep + ENV.get('PATH', '')
ENV['JAVA_TOOL_OPTIONS'] = '-Xmx256m -XX:MaxMetaspaceSize=128m -XX:ReservedCodeCacheSize=32m'


def run(cmd, **kw):
    r = subprocess.run(cmd, env=ENV, capture_output=True, text=True, **kw)
    if r.returncode != 0:
        raise RuntimeError('命令失败: %s\n%s\n%s' % (' '.join(map(str, cmd)), r.stdout, r.stderr))
    return r.stdout + r.stderr


def sha(b):
    return hashlib.sha256(b).hexdigest()


def ensure_key():
    if os.path.exists(KS):
        print('[密钥] 已存在，复用（长期签名身份，证书字节不变）:', KS)
        return
    os.makedirs(os.path.dirname(KS), exist_ok=True)
    run([KEYTOOL, '-genkeypair', '-keystore', KS, '-storetype', 'PKCS12',
         '-alias', KS_ALIAS, '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
         '-dname', 'CN=账本, OU=Ledger, O=WorkBuddy, L=CN, ST=CN, C=CN',
         '-storepass', KS_PASS, '-keypass', KS_PASS])
    print('[密钥] 新建长期密钥:', KS)


def patched_manifest(data):
    a = Axml(data)
    edits = []
    for name, _off, attrs in a.elements():
        for an, aoff in attrs:
            cur = a.read_attr(aoff).get('raw') or ''
            if name == 'manifest' and an == 'package':
                assert cur == OLD_PKG, '基础包 package 与预期不符: ' + cur
                edits.append((aoff, PKG))
            elif name == 'manifest' and an == 'versionName':
                edits.append((aoff, VERSION_NAME))
            elif name == 'manifest' and an == 'versionCode':
                edits.append((aoff, VERSION_CODE))
            elif name == 'application' and an == 'label':
                edits.append((aoff, LABEL))
            elif name in ('permission', 'uses-permission') and an == 'name' and 'DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION' in cur:
                edits.append((aoff, PKG + '.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'))
            elif name == 'provider' and an == 'authorities' and cur.startswith(OLD_PKG):
                edits.append((aoff, PKG + '.androidx-startup'))
    need = {'package', 'versionName', 'versionCode', 'label'}
    got = {a.read_attr(off).get('name') for off, _ in edits}
    assert need <= got, '清单缺少必要属性: ' + str(need - got)
    a.patch_offsets(edits)
    print('[清单] 改写属性数:', len(edits))
    return bytes(a.raw)


def repack():
    page = open(PAGE, 'rb').read()
    assert b'__LEDGER_DATA__' not in page, '源页面未构建'
    assert b'data-version="1.0.0"' in page, '源页面版本不符'
    zin = zipfile.ZipFile(BASE, 'r')
    names = zin.namelist()
    assert 'assets/index.html' in names and 'classes.dex' in names and 'resources.arsc' in names
    assert all(n in names for n in ICON_FILES), '基础包缺少 adaptive-icon 前景条目'
    icons = {n: open(os.path.join(ICON_DIR, os.path.basename(n)), 'rb').read() for n in ICON_FILES}
    assert all(len(v) > 500 for v in icons.values()), '图标素材为空'
    manifest = patched_manifest(zin.read('AndroidManifest.xml'))
    dex_new = patch_dex(zin.read('classes.dex'))
    arsc_new = patch_arsc(zin.read('resources.arsc'))
    verify_native(dex_new, arsc_new)
    print('[原生层] classes.dex / resources.arsc 不透明白导航栏 + 关闭对比度强制补丁已生成并静态自检通过')

    work = OUT + '.unsigned.apk'
    kept, dropped = 0, 0
    with zipfile.ZipFile(work, 'w') as zout:
        for info in zin.infolist():
            n = info.filename
            if n.startswith('META-INF/') and n.upper().endswith(DROP):
                dropped += 1
                continue
            if n == 'AndroidManifest.xml':
                data = manifest
            elif n == 'assets/index.html':
                data = page
            elif n == 'classes.dex':
                data = dex_new
            elif n == 'resources.arsc':
                data = arsc_new
            elif n in icons:
                data = icons[n]
            else:
                data = zin.read(n)
            zi = zipfile.ZipInfo(n, date_time=info.date_time)
            zi.compress_type = info.compress_type
            zi.external_attr = info.external_attr
            zi.internal_attr = info.internal_attr
            zi.create_system = info.create_system
            zi.flag_bits = info.flag_bits & ~0x08
            zout.writestr(zi, data)
            kept += 1
    zin.close()
    print('[重打包] 保留条目 %d / 丢弃旧签名 %d' % (kept, dropped))

    aligned = OUT + '.aligned.apk'
    run([ZIPALIGN, '-f', '-p', '4', work, aligned])
    run([APKSIGNER, 'sign', '--ks', KS, '--ks-pass', 'pass:' + KS_PASS,
         '--ks-key-alias', KS_ALIAS, '--key-pass', 'pass:' + KS_PASS,
         '--v1-signing-enabled', 'true', '--v2-signing-enabled', 'true',
         '--v4-signing-enabled', 'false', '--min-sdk-version', '24',
         '--out', OUT, aligned])
    os.remove(work)
    os.remove(aligned)
    print('[产物]', OUT, os.path.getsize(OUT), 'bytes')
    return page, dex_new, arsc_new


def verify(page, dex_new, arsc_new):
    print('\n========== APK 验证 ==========')
    badging = run([AAPT2, 'dump', 'badging', OUT])
    head = [l for l in badging.splitlines() if l.startswith('package:') or l.startswith('application-label:')
            or l.startswith('sdkVersion') or 'launchable-activity' in l]
    for l in head:
        print(' ', l.split('  ')[0])
    assert ("package: name='%s' versionCode='%d' versionName='%s'" % (PKG, VERSION_CODE, VERSION_NAME)) in badging
    assert "application-label:'%s'" % LABEL in badging
    assert 'launchable-activity' in badging
    print('  [PASS] package / versionCode / versionName / label / 启动 Activity')

    certs = run([APKSIGNER, 'verify', '--print-certs', OUT])
    print(' ', [l.strip() for l in certs.splitlines() if 'Signer #1 certificate DN' in l
                or 'certificate SHA-256 digest' in l or 'Verified using v' in l])
    assert 'CN=账本' in certs, '证书 DN 不符'
    print('  [PASS] apksigner 证书 DN')

    run([ZIPALIGN, '-c', '4', OUT])
    print('  [PASS] zipalign -c 4')
    z = zipfile.ZipFile(OUT)
    assert z.testzip() is None
    print('  [PASS] ZIP 完整性')

    zb = zipfile.ZipFile(BASE)
    bn, on = set(zb.namelist()), set(z.namelist())
    print('  条目数: 基础包 %d / 产物 %d' % (len(bn), len(on)))
    assert len(bn) == len(on), 'ZIP 条目数变化'
    assert z.read('classes.dex') == dex_new, 'classes.dex 与原生补丁输出不一致'
    assert z.read('resources.arsc') == arsc_new, 'resources.arsc 与原生补丁输出不一致'
    assert z.read('assets/index.html') == page, '内嵌页面与源码不一致'
    print('  [PASS] dex / arsc 与原生补丁逐字节一致；内嵌页面与源码同哈希')

    changed = sorted(n for n in (bn & on) if sha(zb.read(n)) != sha(z.read(n)))
    print('  内容变化的条目:', changed)
    expected = {'AndroidManifest.xml', 'assets/index.html', 'classes.dex',
                'resources.arsc', 'META-INF/MANIFEST.MF'} | set(ICON_FILES)
    assert set(changed) <= expected, '出现了预期外的条目改动: ' + str(set(changed) - expected)
    assert {'AndroidManifest.xml', 'assets/index.html', 'classes.dex', 'resources.arsc'} <= set(changed), \
        '清单/页面/dex/arsc 没有真正替换'
    assert not [n for n in on if n.startswith('META-INF/') and 'PNLBOARD' in n.upper()], '残留旧签名文件'
    print('  [PASS] 清单 / 页面 / dex / arsc 四处业务变化（MANIFEST.MF 由 v1 重签重建）')
    # ---- v1.2.5 沿用图标：黑底 + 白 ¥，与 v1.1.8 逐字节相同（本版不改图标） ----
    for n in ICON_FILES:
        src = open(os.path.join(ICON_DIR, os.path.basename(n)), 'rb').read()
        assert z.read(n) == src, 'adaptive-icon 前景未替换: ' + n
        assert src[:8] == b'\x89PNG\r\n\x1a\n', '图标不是合法 PNG: ' + n
    print('  [PASS] 5 张 adaptive-icon 前景与 源码/图标/ 素材逐字节一致（黑底白 ¥）')
    old_dir = os.path.join(os.path.dirname(ROOT), '资产管理中枢_v1.2.0_20261110', '源码', '图标')
    if os.path.isdir(old_dir):
        for n in ICON_FILES:
            old = os.path.join(old_dir, os.path.basename(n))
            if os.path.exists(old):
                assert z.read(n) == open(old, 'rb').read(), 'v1.2.5 不应改图标: ' + n
        print('  [PASS] 5 张图标与 v1.2.0 逐字节相同（本版图标零改动）')
    res = run([AAPT2, 'dump', 'resources', OUT])
    want = ['0x01010054=#ffffffff', '0x01010450=true', '0x01010451=#ffffffff',
            '0x01010452=#ffffffff', '0x010104e0=true', '0x0101056c=true', '0x01010605=false']
    for x in want:
        assert x in res, '主题属性缺失: ' + x
    print('  [PASS] Theme.PnlBoard 7 条系统栏属性（导航栏=不透明白 / 状态栏=白 / 关对比度强制）')
    rlines = res.splitlines()
    ri = next(i for i, l in enumerate(rlines) if 'color/ic_launcher_background' in l)
    assert '#ff000000' in rlines[ri + 1], 'adaptive-icon 背景色不是纯黑'
    print('  [PASS] adaptive-icon 背景仍是 #ff000000 纯黑（黑底白 ¥ 的底色）')
    p = z.read('assets/index.html').decode('utf-8')
    assert not re.search(r'[0-9A-Za-z._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', p), '内嵌页含邮箱形态串'
    assert '"accounts":[]' in p and '"tx":[]' in p
    print('  [PASS] 内嵌页无凭据、无内置账单')
    # v1.1.7：紧凑选项弹层确实进了 APK 内嵌页
    assert 'class="sel-hit"' in p and 'id="pickerSheet"' in p, '内嵌页缺少紧凑选项弹层'
    assert '.fitem select{pointer-events:none}' in p, '原生 select 未禁用点击'
    assert 'max-height:min(46vh,340px)' in p and 'height:36px;line-height:36px' in p, '选项行/列表未收紧'
    print('  [PASS] 内嵌页含紧凑选项弹层（行高 36px / 列表最高 46vh）')
    # v1.1.8：白天黑边纯白底 / 夜晚白边纯黑底；v1.1.9：dock 黑边不再重叠
    assert '  --ink:#12161d;' in p and '  --paper:#f4f6fa;' in p, '白天令牌不是纯黑白'
    assert '  --ink:#e6edf3;' in p and '  --paper:#0d1117;' in p, '夜晚令牌不是纯黑白'
    assert '.day.sel{background:var(--paper);color:var(--ink);border-color:var(--edge);font-weight:700}' in p, \
        '日历选中日期框仍是反色块'
    assert '.tab.active{background:var(--paper);color:var(--ink)}' in p, \
        'dock 选中态仍是反色块'
    assert '#btnTheme[aria-pressed="true"]{background:var(--paper);color:var(--ink);font-weight:700}' in p, \
        '「明暗」按钮仍是反色块'
    assert "isDark() ? '#ff0d1117' : '#fff4f6fa', !isDark()" in p, '夜间系统栏未归一为纯黑'
    print('  [PASS] 内嵌页含 v1.1.8 纯色主题（三处反色块已消除 / 系统栏纯黑）')
    # ---- v1.1.9：dock 底部黑边分离（新增 4 条内嵌页契约） ----
    assert '.tab.active::after{content:"";position:absolute;left:50%;bottom:5px;transform:translateX(-50%);width:24px;height:3px;background:var(--ink)}' in p, \
        '内嵌页缺少悬浮短指示条'
    assert 'box-shadow:inset 0 -3px 0 var(--ink)' not in p, '内嵌页仍用贴边框的 inset 指示条'
    assert '.bottombar::before{content:"";position:absolute;left:0;right:0;top:-6px;height:6px;background:var(--paper)}' in p, \
        '内嵌页缺少 dock 顶边纯色缓冲带（v1.2.5 起 top:-6px）'
    assert 'box-shadow:0 -3px 10px rgba(0,0,0,.06)' not in p and 'box-shadow:0 -3px 10px rgba(0,0,0,.55)' not in p, \
        '内嵌页 dock 灰晕投影未移除'
    print('  [PASS] 内嵌页含 v1.1.9 dock 黑边分离（选中条悬浮 / 无投影 / 缓冲带）')
    # ---- v1.2.0：剩余三处反色高亮归一（新增 5 条内嵌页契约） ----
    assert '.type-row button.active{background:var(--paper);color:var(--ink);font-weight:700}' in p, \
        '内嵌页类型按钮仍是反色块'
    assert '.picker-row.cur{background:var(--paper);color:var(--ink);font-weight:700}' in p, \
        '内嵌页选项选中行仍是反色块'
    assert '.set-btns .bx.on{background:var(--paper);color:var(--ink);font-weight:700}' in p, \
        '内嵌页设置页开关仍是反色块'
    assert '.picker-row:active{background:#e8e8e8}' not in p \
        and 'html[data-theme="dark"] .picker-row:active{background:#2b2b2b}' not in p, \
        '内嵌页选项行按压灰底未清除'
    assert 'data-version="1.0.0"' in p, '内嵌页版本号不是 1.0.0'
    print('  [PASS] 内嵌页含 v1.2.0 三处归一（纯底 + 纯字 + 加粗 / 无按压灰底）')
    # ---- v1.2.1：平板响应式适配（新增 5 条内嵌页契约） ----
    assert '@media (min-width:560px){' in p, '内嵌页缺失平板断点'
    assert '--fs:clamp(19px,2.45vw,31px)' in p and '--pad-w:clamp(620px,73vw,950px)' in p, \
        '内嵌页平板字号/容器宽度不对（v1.2.8 起外扩为 620/73vw/950）'
    assert '.app{max-width:var(--pad-w)' in p and '.sheet{max-width:var(--pad-w)' in p, \
        '内嵌页顶层容器未同步放宽'
    assert '.sel-hit{height:1.8em}' in p, '内嵌页选项命中层未随输入框同步放大'
    assert 'max-width:430px' in p and '--fs:clamp(12px,3.4vw,15px)' in p, \
        '手机端基础规则被破坏'
    print('  [PASS] 内嵌页含 v1.2.1 平板等比适配（手机端基础规则原样保留）')
    # ---- v1.2.4：平板 dock 改左侧竖栏 ----
    assert '--rail-w:5.3em' in p, '内嵌页缺侧栏宽度变量'
    assert 'flex-direction:column;justify-content:center;gap:.6em;' in p, '内嵌页 dock 未竖排'
    assert 'border-top:0;border-right:0;' in p, '内嵌页侧栏仍有竖分隔线（v1.2.5 要求撤掉）'
    assert 'padding:.93em .45em 1.1em calc(var(--rail-w) + .45em)' in p, '内嵌页 body 未给侧栏让位（v1.2.8：.45em）'
    assert '.bottombar::before{display:none}' in p, '内嵌页侧栏缓冲带未隐藏'
    print('  [PASS] 内嵌页含 v1.2.4 平板侧边 dock（手机端 dock 基础规则原样保留）')
    # ---- v1.2.5：两端 dock 去分隔线 + 平板竖屏贴顶 + 弹层垂直居中 ----
    assert 'background:var(--paper);border-top:0;' in p, '内嵌页手机端 dock 顶部分隔线未撤掉'
    assert 'position:fixed;left:50%;top:50%;bottom:auto;' in p, '内嵌页弹层未垂直居中'
    assert '.sheet.on{visibility:visible;transform:translate(-50%,-50%)}' in p, '内嵌页弹层 on 态未归到居中位置'
    assert 'border-bottom-color:var(--paper)' not in p, '内嵌页弹层底边仍染纸色'
    assert '@media (min-width:560px) and (orientation:portrait){' in p, '内嵌页缺平板竖屏断点'
    _por = p.split('@media (min-width:560px) and (orientation:portrait){', 1)[1]
    assert 'body{padding-top:0}' in _por and '.app{padding-top:0}' in _por, '内嵌页竖屏顶部留白未归 0'
    print('  [PASS] 内嵌页含 v1.2.5 三处改动（去线 / 竖屏贴顶 / 弹层居中）')
    # ---- v1.2.6：内容区字号分级 --fs-c（账单/资产页变小，顶栏与记账不变） ----
    assert '--fs-c:var(--fs);' in p and '--fs-c:calc(var(--fs) * .88);' in p, \
        '内嵌页缺内容区字号分级变量'
    assert '.panel{border:var(--line);font-size:var(--fs-c);display:flex;flex-direction:column;flex:1 1 auto;min-height:0}' in p, \
        '内嵌页面板未承接内容区字号 / 未改为竖向 flex 容器'
    assert '.month-label,.date-label{font-size:var(--fs-c);' in p, '内嵌页账单页月份未改用 --fs-c'
    assert '.asset-row{display:grid;grid-template-columns:minmax(0,1fr) 96px;' in p \
        and 'border-bottom:var(--bd) solid #dde3ec;font-size:var(--fs-c);align-items:baseline}' in p, \
        '内嵌页资产账户行未改用 --fs-c'
    assert '.bx{border:var(--line);height:32px;min-width:60px;padding:0 8px;font-size:var(--fs);' in p, \
        '内嵌页顶栏按钮字号被改动（应保持 --fs）'
    assert '.sheet-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;font-size:var(--fs)}' in p \
        and '.numpad button,.ops button,.opcol>.act{border:var(--line);height:34px;font-size:var(--fs)}' in p, \
        '内嵌页记账弹层字号被改动（应保持 --fs）'
    print('  [PASS] 内嵌页含 v1.2.6 内容区字号分级（顶栏五项与记账弹层不变）')
    # ---- v1.2.7 沿用：选项按字数排序 ----
    assert 'const charLen = s => [...String(s)].length;' in p, '内嵌页缺字数排序工具'
    assert '+ byCharLen(list).map(x =>' in p, '内嵌页四类下拉未走字数排序'
    assert "const after = [...el.options].slice(1).find(o => charLen(o.value) > nv);" in p, \
        '内嵌页历史值补项未插到字数位置'
    print('  [PASS] 内嵌页含 v1.2.7 选项字数排序')
    # ---- v1.2.8：固定外框 + 左右外扩 + 移除拖拽 + 长按高亮 + 资产排序 ----
    assert 'height:100vh;height:100dvh;overflow:hidden;' in p, '内嵌页未锁视口高度（页面仍会整页滚动）'
    assert '.cal,.datebar,.asset-summary{flex:0 0 auto}' in p, '内嵌页上方固定区未声明不伸缩'
    assert 'overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}' in p, '内嵌页流水区未独立滚动'
    assert 'padding:0 4px calc(46px + env(safe-area-inset-bottom,0px))' in p, \
        '内嵌页 body 底部让位不是 46px（v1.3.0 起；v1.2.8 引入固定外框时是 112px，v1.2.10 为 54px）'
    assert '.bx.brand{' not in p, '内嵌页仍残留「资产管理中枢」的 26% 定宽声明'
    assert 'const HL_HOLD_MS = 450;' in p and 'DB.settings.acctHl' in p \
        and 'function toggleHl(id){' in p and 'function clearHl(){' in p, '内嵌页缺长按高亮'
    assert '.asset-item.hl,\n.asset-item.hl:hover{background:#999}' in p, '内嵌页缺中灰高亮样式'
    assert 'body.tab-asset .flow{overflow:hidden;overscroll-behavior:none}' in p, '内嵌页竖屏资产页未锁滚动'
    assert 'groups.asset.sort((a, b) => (charLen(a.name) - charLen(b.name)) || (a.bal - b.bal));' in p, '内嵌页资产账户未按字数/资产排序'
    assert 'groups.credit.sort((a, b) => (charLen(a.name) - charLen(b.name)) || (a.used - b.used));' in p, '内嵌页信贷账户未按字数/已用排序'
    for _dead in ('dragBegin', 'commitAccountOrder', 'asset-ph', 'DRAG_SUPPRESS'):
        assert _dead not in p, '内嵌页仍残留长按拖拽: ' + _dead
    print('  [PASS] 内嵌页含 v1.2.8（固定外框 / 左右外扩 / 去拖拽 / 长按高亮 / 资产排序）')
    # ---- v1.2.9：去掉页脚版本行，面板下边框随 flex 下延 ----
    assert 'class="ver"' not in p, '内嵌页仍有页脚版本行节点'
    assert '资产管理中枢 v1.3.8</div>' not in p, '内嵌页仍在页面上显示「资产管理中枢 v1.3.6」字样'
    assert not re.search(r'(^|\n)\s*\.ver\s*\{', p), '内嵌页仍残留 .ver 样式规则'
    assert 'data-version="1.0.0"' in p, '内嵌页 data-version 不是 1.0.0'
    print('  [PASS] 内嵌页含 v1.2.9（页脚版本行已移除，面板底边随 flex 下延）')

    # ---- v1.2.10：dock 底部内距 4→2px（按钮下边框到屏幕底边的间距减半），body 让位 56→54px ----
    assert 'padding:7px 10px calc(2px + env(safe-area-inset-bottom,0px))' in p, \
        '内嵌页 dock 底部内距不是 2px（v1.2.10 要求把 4px 间距再减半）'
    assert 'calc(4px + env(safe-area-inset-bottom,0px))' not in p, '内嵌页 dock 底部内距仍有 4px 残留'
    print('  [PASS] 内嵌页含 v1.2.10（dock 底部间距 4→2px，dock 盒高 45px）')

    # ---- v1.3.0：面板↔dock 呼吸位 16→8px（只调 body 让位 54→46px）----
    assert 'padding:0 4px calc(46px + env(safe-area-inset-bottom,0px))' in p, \
        '内嵌页 body 底部让位不是 46px（v1.3.0：dock 45 + 呼吸 8 − .app 底 7）'
    assert 'calc(54px + env' not in p and 'calc(56px + env' not in p, \
        '内嵌页 body 底部让位仍有旧值残留（54/56px）'
    assert '.app{padding:5.67px 6px 7px}' in p and 'padding:7.67px 6px 7px' in p, \
        '内嵌页 .app 底内距 7px 被改动（呼吸位算式依赖它）'
    print('  [PASS] 内嵌页含 v1.3.0（面板↔dock 呼吸位 16→8px，body 让位 54→46px）')

    # ---- v1.3.5：标签移到金额前、自适应金额长度（停用 v1.3.1 两槽） ----
    assert '.line1 .r.has-tag .tag{display:inline-block;max-width:5.5em;' in p, \
        '内嵌页缺 v1.3.5 金额前标签 CSS'
    assert '<span class="sep">|</span><span class="amt">' in p, '内嵌页缺「标签|金额」连续串'
    for _slot in ('measureTagSlots', '--tag-w', '--acct-w', '.line2 .r.has-tag',
                  'class="acct"', 'title="标签与账户"'):
        assert _slot not in p, '内嵌页仍有 v1.3.1 两槽残留: ' + _slot
    assert p.count('class="r has-tag"') == 1, '内嵌页金额前标签分支数量异常'
    assert "'<span class=\"r\" title=\"账户\">' + esc(acct) + '</span>'" in p, \
        '内嵌页第二行不是纯账户单串'
    assert '.line1 .r.has-tag{display:inline-flex;align-items:center;justify-content:flex-end}' in p, \
        '内嵌页缺 v1.3.6 标签|金额 inline-flex 中线对齐 CSS'
    assert '.line1 .r.has-tag .sep{color:inherit}' in p, '内嵌页标签 | 未统一为正文色'
    assert '.line .l .piece.nc{color:inherit;font-size:inherit;white-space:nowrap}' in p, \
        '内嵌页不计入小字未统一为正文大小正文色'
    assert '.flow-row.lack .line2 .r{color:var(--warn)}' in p, '内嵌页缺账户 --warn 警示色被误统一'
    print('  [PASS] 内嵌页含 v1.3.6（标签|金额中线对齐 / 全流水条正文色 / 两槽零残留 / --warn 保留）')

    # ---- v1.3.7：总览开屏页 + dock 四项等宽（内嵌页契约） ----
    assert "tab:'overview'" in p and '<button class="tab active" id="tabOv">总览</button>' in p, \
        '内嵌页开屏不是总览 / dock 缺第一项'
    assert 'flex:1 1 0;min-width:0;margin-left:0}' in p, \
        '内嵌页 dock 未四项等分（v1.0.0 独立边框 margin-left:0）'
    assert '.tab{width:92px}' not in p and 'width:66px' not in p, '内嵌页仍残留旧固定宽'
    assert '.bottombar>button{flex:0 0 auto;margin-left:0}' in p, '内嵌页竖排 dock 未撤销 flex-basis 0'
    print('  [PASS] 内嵌页含 v1.3.7（总览开屏 / dock 四项等宽等序 / 竖排不压扁）')

    # ---- v1.3.8：末条底边 + KPI 字号 + 12 月金额格（用户 2026-11-12 四条反馈） ----
    assert '.flow-list .flow-row:last-child{border-bottom:0}' not in p, '内嵌页末条流水仍无底边'
    assert 'gap:var(--flow-gap);padding-bottom:8px}' in p and '.flow-list{padding-bottom:.53em}' in p, \
        '内嵌页流水列表底部未留白（滚到底会与面板底边叠成大黑边）'
    assert 'gap:2px;font-size:.86em;white-space:nowrap}' in p, '内嵌页 KPI 未缩到 .86em'
    for _dead in ('const OV_TOP = 5;', '<span>分类支出</span>', '<span>最近流水</span>', 'ov-block'):
        assert _dead not in p, '内嵌页仍有 v1.3.7 两榜: ' + _dead
    assert '.ov-heat{border:var(--line);margin:6px 0}' in p, '内嵌页缺独立月份金额格'
    assert '.ov-heat-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr))}' in p, \
        '内嵌页月份格不是 6 列（12 格应折成 1~6 / 7~12 两行）'
    assert '.ov-cell:nth-child(6n){border-right:0}' in p, '内嵌页 6 列末列未去右边框'
    assert '.ov-heat-grid>.ov-cell:nth-last-child(-n+6){border-bottom:0}' in p, \
        '内嵌页末行（7~12 月）未去下边框'
    assert 'ov-year' not in p, '内嵌页仍有「本年」格（合计应上提到第一行）'
    assert "'<i class=\"ov-sep\">|</i>'" in p, '内嵌页第一行缺「|」竖线'
    assert '.ov-heat-sum{' in p, '内嵌页第一行缺本年合计'
    assert 'const sum = signedMoney(k, yv);' in p, \
        '内嵌页三类合计未走 signedMoney（v1.4.3 起一律带正负号）'
    assert "const OV_METRICS = {bal:'结余', inc:'收入', exp:'支出'};" in p, '内嵌页缺三指标名称表'
    assert 'function ovBlockHTML(k, d){' in p, '内嵌页缺三块共用的渲染器'
    assert "ovBlockHTML('bal', d) + ovBlockHTML('inc', d) + ovBlockHTML('exp', d)" in p, \
        '内嵌页未把三块本年网格同时铺出来（还是入口卡）'
    assert 'data-ov-kind="' in p and '.ov-heat+.ov-heat{margin-top:0;border-top:var(--line)}' in p, \
        '内嵌页缺三块定位标记 / 块间去边框规则'
    assert 'data-ov-metric="' not in p and "ovMetric:'bal'" not in p, '内嵌页仍有 v1.3.8 切换键'
    assert 'data-ov-page' not in p and 'data-ov-back' not in p and 'ovPage' not in p, \
        '内嵌页仍有 v1.3.9 入口卡 / 返回键 / 子页状态位'
    assert 'data-ov-month' not in p and '--heat' not in p, '内嵌页月份格可点 / 出现热力深浅'
    print('  [PASS] 内嵌页含 v1.4.0（末条底边+留白 / KPI .86em / 三块三行 · 6 列 × 2 行 / 年份|本年X 合计 / 入口卡零残留）')

    # ---- v1.4.1：三处视觉修正（内嵌页契约） ----
    assert '.ov-heat+.ov-heat{margin-top:0;border-top:var(--line)}' in p, '内嵌页后两块仍缺顶边'
    assert '.ov-heat+.ov-heat{margin-top:0;border-top:0}' not in p, '内嵌页旧去顶边规则残留'
    assert '.ov-sep{font-style:normal;font-size:var(--fs-c);line-height:1;color:var(--ink)}' in p, '内嵌页竖线仍是淡化灰'
    assert '.tab.active{background:var(--paper);color:var(--ink)}' in p, '内嵌页选中页签未归一'
    assert '.tab.active{background:var(--paper);color:var(--ink);font-weight:700}' not in p, '内嵌页选中页签仍加粗'
    assert '.bottombar>button{top:-6px}' in p and '.bottombar>button{top:0}' in p, '内嵌页四框未上移 / 平板未复位'
    print('  [PASS] 内嵌页含 v1.4.1（三块补顶边 / 竖线·页签同字号同色 / 四框上移 6px）')

    # ---- v1.4.2：全站小圆弧（内嵌页契约） ----
    assert ':root{--r:8px;--r-s:4px}' in p, '内嵌页半径令牌缺失'
    assert '.panel{border-radius:var(--r);overflow:hidden}' in p, '内嵌页面板未圆角'
    assert '.ov-heat{border-radius:var(--r);overflow:hidden}' in p, '内嵌页三块未圆角'
    assert '.bottombar>button,\n.bottombar>button:first-child,\n.bottombar>button:last-child{border-radius:var(--r)}' in p, \
        '内嵌页 dock 四块未各自四角全圆（v1.0.0 拆分独立边框）'
    print('  [PASS] 内嵌页含 v1.4.2（容器 8px / 控件 4px / dock 四块全圆(v1.0.0)）')

    # ---- v1.0.0：六项视觉改动（内嵌页契约，纯样式层） ----
    assert '--bd:1px' in p and '--bd:2px' not in p, '内嵌页边框粗细不是 1px'
    assert 'display:flex;justify-content:center;gap:6px' in p, '内嵌页 dock 未用 gap:6px 分隔'
    assert 'body:not(.tab-asset):not(.tab-overview) .flow-row{' in p, '内嵌页账单流水条独立边框缺失'
    assert 'body:not(.tab-asset):not(.tab-overview) .panel{' in p, '内嵌页账单去外框缺失'
    assert 'body.tab-asset .asset-row.subtotal{' in p, '内嵌页资产去合计缺失'
    assert 'body.tab-asset .asset-group > .asset-item:nth-last-child(2) .asset-row,' in p, '内嵌页账户卡去末尾横线缺失'
    assert '预览' not in p, '内嵌页残留「预览」标识'
    print('  [PASS] 内嵌页含 v1.0.0（1px / dock 独立 / 流水条 / 去外框 / 去合计 / 去末尾横线）')

    # ---- v1.4.3：顶栏六格 + 总览金额带正负号（内嵌页契约） ----
    for _bid in ('btnSettings', 'btnBackup', 'btnRestore', 'btnTheme', 'btnAddAccount'):
        assert 'id="%s"' % _bid in p, '内嵌页顶栏缺 ' + _bid
    assert 'btnBrand' not in p and 'class="bx brand"' not in p, '内嵌页仍留着「资产管理中枢」按键'
    assert '.topbar>.bx.stub{flex:1 1 0;min-width:0;padding:0 .28em;letter-spacing:.13em}' in p, \
        '内嵌页四个功能键未等分'
    _tb = p[p.index('<div class="topbar">'):]
    _tb = _tb[:_tb.index('</div>')]
    assert 'class="spacer"' not in _tb, '内嵌页顶栏仍留着弹性空档'
    assert 'function signedMoney(kind, v){' in p, '内嵌页缺金额带号函数'
    print('  [PASS] 内嵌页含 v1.0.0（顶栏五格 / 「资产管理中枢」按键下线）')
    print('  [PASS] 内嵌页含 v1.4.3（新增账户上移 / 金额带号）')

    dex = z.read('classes.dex')
    for kw in [b'nsRequest', b'exportBackup', b'setSystemBars', b'__pnlNsDone']:
        assert kw in dex, '原生桥缺失: ' + kw.decode()
    print('  [PASS] 坚果云 / 导出 / 状态栏原生桥在位')
    print('  APK SHA256:', sha(open(OUT, 'rb').read()))
    print('==============================')


if __name__ == '__main__':
    os.makedirs(DIST, exist_ok=True)
    ensure_key()
    page, dex_new, arsc_new = repack()
    verify(page, dex_new, arsc_new)
