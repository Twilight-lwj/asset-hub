#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""资产管理中枢 页面构建：把「空数据骨架」注入模板，产出单文件浏览器版。

输入：与本脚本同级的上一级目录（`源码/`）里的 `资产管理中枢_模板.html`；
输出：`源码/资产管理中枢_浏览器版.html`，与 APK 的 `assets/index.html` 同哈希。
本脚本只做占位符替换 + 静态契约断言，不改任何金额函数、统计口径与数据结构；
出厂为全 0 空态（无内置流水与资产）。"""
import json
import os
import pathlib
import re

HERE = pathlib.Path(__file__).resolve().parent
SRC_DIR = HERE.parent                                   # 归档/工作树的「源码/」
TPL = SRC_DIR / '资产管理中枢_模板.html'
if not TPL.exists():
    raise SystemExit('缺少模板：%s' % TPL)
OUT = SRC_DIR / '资产管理中枢_浏览器版.html'
# 回归用 fixture（可选）：由环境变量指定本地脱敏备份 JSON；不给就跳过，测试脚本自备
FIXTURE = pathlib.Path(os.environ['AMHUB_FIXTURE']) if os.environ.get('AMHUB_FIXTURE') else None
# 凭据清单不入库：构建机本地 密钥/leak_guard.txt，每行一个串
GUARD = SRC_DIR.parent / '密钥' / 'leak_guard.txt'

TYPES = ['expense', 'income', 'transfer', 'repay', 'reimburse']
EMPTY = {
    'version': '1.0.0',
    'accounts': [],
    'categories': {k: [] for k in TYPES},
    'tags': {k: [] for k in TYPES},
    'tx': [],
    'settings': {},
    'meta': {},
    'accountTypes': [
        {'id': 'asset', 'name': '资产账户', 'mode': 'asset'},
        {'id': 'credit', 'name': '信贷账户', 'mode': 'credit'},
    ],
}

raw = json.dumps(EMPTY, ensure_ascii=False, separators=(',', ':'))
raw = (raw.replace('<', '\\u003c').replace('>', '\\u003e')
          .replace('\u2028', '\\u2028').replace('\u2029', '\\u2029'))

html = TPL.read_text(encoding='utf-8')
assert html.count('__LEDGER_DATA__') == 1, '模板占位符数量异常'
final = html.replace('__LEDGER_DATA__', raw)
OUT.write_text(final, encoding='utf-8')

# 凭据零命中：优先用构建机本地清单（不入库），并始终做通用邮箱兜底
if GUARD.exists():
    for i, secret in enumerate([s.strip() for s in GUARD.read_text(encoding='utf-8').splitlines() if s.strip()], 1):
        assert secret not in final, '凭据泄漏：命中本地清单第 %d 条' % i
assert not re.search(r'[0-9A-Za-z._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', final), '成品页含邮箱形态串'
# 内置账单与资产已清除
assert '"accounts":[]' in final and '"tx":[]' in final, '空骨架未生效'
assert '便利店' not in final and 't13tibezl' not in final, '内置业务数据残留'
assert 'data-version="1.0.0"' in final and '<title>资产管理中枢 v1.0.0</title>' in final
# v1.1.4 系统栏修复 + v1.1.5 备份恢复 + v1.1.6 明暗/固定备份区的静态契约（v1.1.8 沿用）
assert '.bottombar>button.plus{' in final and 'function forceWhiteBars()' in final
assert 'calc(20px + env(safe-area-inset-bottom,0px))' in final
# v1.2.5：弹层改垂直居中悬浮，底边不再是「纸色遮掉」的贴底样式，改为四周实线框
assert 'background:var(--paper);border:var(--line);padding:7px 9px calc(20px' in final, \
    '弹层边框/内边距被改动（应为四周 2px 实线 + 底 20px）'
# v1.2.10：dock 底部内距 4→2px（按钮下边框到屏幕底边的间距减半），body 让位 56→54px
assert 'padding:7px 10px calc(2px + env(safe-area-inset-bottom,0px))' in final, \
    'dock 底部内距不是 2px（v1.2.10 要求把 4px 间距再减半）'
assert 'calc(4px + env(safe-area-inset-bottom,0px))' not in final, 'dock 底部内距仍有 4px 残留'
assert 'padding:0 4px calc(46px + env(safe-area-inset-bottom,0px))' in final, \
    'body 底部让位不是 46px（v1.3.0：dock 45 + 呼吸 8 − .app 底 7）'
assert 'calc(54px + env' not in final, 'body 底部让位仍有 54px 残留（v1.2.10 的旧值）'
# v1.3.0：面板↔dock 呼吸位 16→8px —— 只调 body 让位，dock / .app 的底内距一个字不动
assert 'padding:7px 10px calc(2px + env(safe-area-inset-bottom,0px))' in final, \
    'dock 盒高被改动（v1.3.0 只动 body 让位，dock 内距 7/9/9/2 应原样保留）'
assert '.app{padding:5.67px 6px 7px}' in final and 'padding:7.67px 6px 7px' in final, \
    '.app 底内距 7px 被改动（呼吸位算式依赖它）'
assert 46 + 7 - 45 == 8, '呼吸位算式应为 8px（body 让位 + .app 底内距 − dock 盒高）'
assert '.app{padding:5.67px 6px 7px}' in final and 'padding:7.67px 6px 7px' in final
assert 'color-scheme:light' in final
assert "isDark() ? '#ff0d1117' : '#fff4f6fa', !isDark()" in final, '系统栏未随明暗主题同步'
# ---- v1.1.5 新增：顶部备份双写 / 恢复来源选择框 ----
assert "$('btnBackup').addEventListener('click', backupAll)" in final, '顶部「备份」未改为双写'
assert "$('btnRestore').addEventListener('click', openRestorePicker)" in final, '顶部「恢复」未弹选择框'
assert 'function cloudBackupCore()' in final and 'function cloudRestoreCore()' in final, '云端核心函数缺失'
assert 'function backupAll()' in final and 'localAutoBackup()' in final, '备份双写编排缺失'
assert 'id="restoreSheet"' in final and 'data-restore="local"' in final and 'data-restore="cloud"' in final, '来源选择框两项缺失'
assert "$('btnBackup').addEventListener('click', exportBackup)" not in final, '顶部备份仍是单通道'
assert "$('btnRestore').addEventListener('click', () => $('importFile').click())" not in final, '顶部恢复仍是单通道'
assert 'data-io="export"' in final and 'data-ns="down"' in final, '设置页单通道入口不应被移除'
assert 'position:fixed;left:50%;top:50%;bottom:auto;' in final, '所有弹层应共用居中定位（v1.2.5）'
# ---- v1.1.6 新增：固定备份区（零弹窗）/ 明暗切换 ----
assert "const AUTOBAK_KEY = 'amhub_v100_autobackup'" in final, '固定备份区键缺失'
assert 'const name = localAutoBackup()' in final, '顶部备份未改走固定备份区'
assert 'const name = exportBackup(true)' not in final, '顶部备份仍在调用会弹 SAF 的原生导出桥'
assert 'function restoreFromLocal()' in final and "if(b.dataset.restore === 'local') restoreFromLocal()" in final, \
    '恢复「本地备份」未改读固定备份区'
assert 'function toggleTheme()' in final and 'function applyTheme(' in final, '明暗切换函数缺失'
assert "const THEME_KEY = 'amhub_v100_theme'" in final, '主题持久化键缺失'
assert 'id="btnTheme"' in final and '>明暗</button>' in final, '标题栏「明暗」按钮缺失'
assert 'html[data-theme="dark"]' in final and '--paper:#0d1117' in final, '暗色变量覆盖缺失'
assert "const _t = localStorage.getItem('amhub_v100_theme')" in final, 'head 防闪白脚本缺失'
assert "if(_t !== 'light') document.documentElement.setAttribute('data-theme','dark')" in final, '默认深色防闪白逻辑缺失'
assert 'applyTheme(isDark(), false)' in final, '启动句未同步主题态'
assert 'PNL_NATIVE.exportBackup' in final and 'function exportBackup(quiet)' in final, \
    '设置页手动「导出备份」不应被移除'
assert "isDark() ? '#ff0d1117' : '#fff4f6fa', !isDark()" in final, '系统栏颜色未随主题同步'
# ---- v1.1.7 新增：紧凑选项弹层替代原生 select 的全屏系统对话框（v1.1.8 沿用） ----
assert final.count('class="sel-hit"') == 5, '5 个下拉缺少透明命中层'
assert '.fitem select{pointer-events:none}' in final, '原生 select 仍可点击（会弹系统全屏单选框）'
assert 'id="pickerSheet"' in final and 'id="pickerList"' in final and 'id="pickerMask"' in final, '紧凑弹层结构缺失'
assert '.picker-mask{z-index:60}' in final and '.sheet.picker{z-index:61' in final, '弹层层级必须高于记账/账户页'
assert 'max-height:min(46vh,340px)' in final and 'height:36px;line-height:36px' in final, '选项行/列表未收紧'
assert 'function openPicker(sel, title)' in final and 'function closePicker()' in final, '弹层函数缺失'
assert "sel.dispatchEvent(new Event('change', {bubbles:true}))" in final, '选中后未派发 change（aKind 联动会失效）'
assert 'if(!sel || sel.disabled) return;' in final, '禁用的账户下拉未拦截'
assert "if(pickerOpen()){ if(e.key === 'Escape') closePicker(); return; }" in final, 'Escape 未优先关闭选择器'
assert '<label class="fitem" id="fCatItem">' not in final and '<label class="fitem" id="fTagItem">' not in final, \
    '含 select 的 label 未改 div（label 会激活原生 select）'
assert 'data-sel="fFrom"' in final and 'data-sel="aKind"' in final, '命中层未绑定目标 select'
assert '<option value="asset">资产账户</option>' in final, '账户类型选项不应被改动'
# ---- v1.1.8 新增：白天/夜晚纯色归一，三处反色块与灰底按压态全部消除 ----
assert '.bx{border:var(--line);' in final and 'white-space:nowrap;background:var(--paper)}' in final, \
    '顶栏按钮未显式设主题底色（透明继承不算纯白/纯黑底）'
assert '.month-label,.date-label{font-size:var(--fs-c);letter-spacing:1px;padding:2px 1px;background:var(--paper)}' in final, \
    '日期选择区未显式设主题底色'
assert '  --ink:#12161d;' in final and '  --paper:#f4f6fa;' in final, '白天令牌不是纯黑边/纯白底'
assert '  --ink:#e6edf3;' in final and '  --paper:#0d1117;' in final, '夜晚令牌不是纯白边/纯黑底'
assert '.day.sel{background:var(--paper);color:var(--ink);border-color:var(--edge);font-weight:700}' in final, \
    '日历选中日期框仍是反色实心块'
assert '.day.sel.has::after{background:var(--ink)}' in final, '选中日的数据圆点未跟随主题'
assert '.day.today:not(.sel){border:var(--bd) dashed var(--ink)}' in final, '「今天」虚线框未归一'
assert 'html[data-theme="dark"] .day.today:not(.sel){border-color:var(--edge)}' in final, '暗色「今天」虚线框未归一'
assert '.tab.active{background:var(--paper);color:var(--ink)}' in final, \
    'dock 选中态仍是反色块'
assert '#btnTheme[aria-pressed="true"]{background:var(--paper);color:var(--ink);font-weight:700}' in final, \
    '「明暗」按钮在黑夜态仍是反色块'
assert '.bx:active,.tab:active,.mini:active{background:var(--paper)}' in final, '按压态仍会出灰底'
assert '.bx:hover,.tab:hover,.plus:hover,.mini:hover,.date-label:hover,.month-label:hover{background:var(--paper)}' in final, \
    '悬停态仍会出灰底'
assert 'html[data-theme="dark"] .mini:active{background:var(--paper)}' in final, '暗色按压态仍会出灰底'
# 只禁止「三处控件」的灰底；设置页禁用输入框 / v1.1.7 选项弹层按压态不在本次范围
assert 'html[data-theme="dark"] .month-label:hover,\nhtml[data-theme="dark"] .bx:active,' in final, \
    '暗色悬停/按压未合并为同一条主题底色规则'
assert 'background:#f0f0f0}' not in final.split('/* ---------- 主面板')[0], '亮色悬停仍有浅灰底'
assert "m.setAttribute('content', dark ? '#0d1117' : '#f4f6fa')" in final, 'meta theme-color 未归一'
assert 'data-version="1.0.0"' in final, '页面版本号不是 1.0.0'


# ---- v1.1.9：dock 底部黑边不再重叠（新增静态契约 6 条） ----
assert '.tab.active::after{content:"";position:absolute;left:50%;bottom:5px;transform:translateX(-50%);width:24px;height:3px;background:var(--ink)}' in final, \
    '选中态悬浮短指示条缺失'
assert 'box-shadow:inset 0 -3px 0 var(--ink)' not in final, '仍在用贴边框的 inset 指示条（会与 2px 下边框叠成 5px）'
assert '.bottombar>button{position:relative;' in final, '按钮未给 ::after 建立定位上下文'
assert '.bottombar::before{content:"";position:absolute;left:0;right:0;top:-6px;height:6px;background:var(--paper)}' in final, \
    'dock 顶边上方 6px 纯色缓冲带缺失（v1.2.5 起 top:-6px，须盖到 dock 顶边）'
assert 'box-shadow:0 -3px 10px rgba(0,0,0,.06)' not in final and 'box-shadow:0 -3px 10px rgba(0,0,0,.55)' not in final, \
    'dock 灰晕投影未移除（会把 2px 顶边糊成粗边）'
assert 'html[data-theme="dark"] .bottombar{box-shadow' not in final, '暗色 dock 投影未移除'

# ---- v1.2.0：剩余三处反色高亮归一（新增静态契约 8 条） ----
assert '.type-row button{border:var(--line);height:29px;font-size:var(--fs);background:var(--paper)}' in final, \
    '类型按钮未显式设主题底色'
assert '.type-row button.active{background:var(--paper);color:var(--ink);font-weight:700}' in final, \
    '记账页类型按钮选中态仍是反色实心块'
assert '.picker-row.cur{background:var(--paper);color:var(--ink);font-weight:700}' in final, \
    '选项弹层选中行仍是反色实心块'
assert '.set-btns .bx.on{background:var(--paper);color:var(--ink);font-weight:700}' in final, \
    '设置页开关选中态仍是反色实心块'
assert 'background:var(--paper);color:var(--ink);' in final, '选项行未显式设主题底色/字色'
assert '.picker-row:active{background:var(--paper)}' in final \
    and 'html[data-theme="dark"] .picker-row:active{background:var(--paper)}' in final, \
    '选项行按压态仍会出灰底'
assert '.picker-row:active{background:#e8e8e8}' not in final \
    and 'html[data-theme="dark"] .picker-row:active{background:#2b2b2b}' not in final, \
    '亮/暗按压灰底未清除'
for _sel in ('.type-row button.active{background:var(--ink)',
             '.picker-row.cur{background:var(--ink)',
             '.set-btns .bx.on{background:var(--ink)'):
    assert _sel not in final, '仍有反色实心块: ' + _sel


# ---- v1.2.1：平板 / 大屏等比适配（新增静态契约 9 条） ----
assert '@media (min-width:560px){' in final, '平板断点缺失'
assert '--fs:clamp(19px,2.45vw,31px)' in final, '平板字号未按视口放大'
assert '--pad-w:clamp(620px,73vw,950px)' in final, '平板容器宽度未按视口放大（v1.2.8 外扩为 620/73vw/950）'
assert '.app{max-width:var(--pad-w)' in final and '.sheet{max-width:var(--pad-w)' in final, \
    '内容列未同步放宽'
# ---- v1.2.4：平板 dock 由底部改为左侧竖排导航栏（手机端基础规则不改） ----
assert '--rail-w:5.3em' in final, '侧栏宽度变量缺失'
assert 'left:0;right:auto;top:0;bottom:0;transform:none;' in final, 'dock 未改为左侧贴边满高'
assert 'flex-direction:column;justify-content:center;gap:.6em;' in final, 'dock 未竖排居中'
assert 'width:var(--rail-w);max-width:none;' in final, 'dock 未用固定栏宽'
assert 'border-top:0;border-right:0;' in final, 'dock 侧栏仍有右侧竖分隔线（v1.2.5 要求撤掉）'
assert '.bottombar::before{display:none}' in final, '侧栏模式顶部缓冲带未隐藏'
assert '.tab.active::after{left:auto;right:.35em;top:50%;bottom:auto;transform:translateY(-50%)' in final, \
    '选中指示条未改为竖条'
assert '.bottombar>button{width:100%;height:2.4em;letter-spacing:.13em}' in final, '侧栏按钮未占满栏宽'
assert 'padding:.93em .45em 1.1em calc(var(--rail-w) + .45em)' in final, 'body 未给侧栏让出左侧空间（左右对称）'
assert '.toast{padding:.53em .93em;bottom:calc(1.4em + env(safe-area-inset-bottom,0px));left:calc(50% + var(--rail-w) / 2)}' in final, \
    'toast 未居中到右侧内容区'
# 手机端 dock 基础规则必须原样保留（底部贴底；v1.2.5 起不再有顶边黑线）
assert '.bottombar{\n  position:fixed;left:50%;bottom:0;transform:translateX(-50%);' in final, \
    '手机端 dock 基础定位被改动'
assert 'background:var(--paper);border-top:0;' in final, '手机端 dock 顶部分隔线未撤掉（v1.2.5 要求两端都无线）'
# ---- v1.2.5：弹层垂直居中悬浮（原 bottom:0 贴底） ----
assert 'position:fixed;left:50%;top:50%;bottom:auto;' in final, '弹层未改为垂直居中（仍是 bottom:0 贴底）'
assert 'visibility:hidden;transform:translate(-50%,-50%) translateY(2.5em);' in final, \
    '弹层进场位移未改（应从居中位置下浮 2.5em 再归位）'
assert '.sheet.on{visibility:visible;transform:translate(-50%,-50%)}' in final, '弹层 on 态未归到居中位置'
assert 'border-bottom-color:var(--paper)' not in final, '弹层底边仍被纸色遮掉（居中后应为实线框）'
# ---- v1.2.5：平板竖屏整体上移到状态栏下方 ----
assert '@media (min-width:560px) and (orientation:portrait){' in final, '缺平板竖屏专用断点'
_portrait = final.split('@media (min-width:560px) and (orientation:portrait){', 1)[1]
assert 'body{padding-top:0}' in _portrait, '平板竖屏 body 顶部留白未归 0'
assert '.app{padding-top:0}' in _portrait, '平板竖屏 .app 顶部留白未归 0'
assert '.flow{min-height:0;padding:0;flex:1 1 auto;overflow-y:auto' in final, '流水区未成为唯一滚动容器'
assert '.fitem input,.fitem select{height:1.8em' in final and '.sel-hit{height:1.8em}' in final, \
    '输入框与选项命中层高度未同步放大（会导致点击错位）'
assert '--bd:1px' in final and '--bd:2px' not in final, '边框粗细应为 1px（v1.0.0 对齐同类持仓项目）'
# 手机端基础规则必须原样保留，平板规则只在媒体查询内生效
assert '.app{\n  width:100%;max-width:430px;background:var(--paper);' in final, \
    '手机端 .app 基础规则被改动'
assert '--fs:clamp(12px,3.4vw,15px)' in final, '手机端基础字号被改动'
assert final.index('@media (min-width:560px)') > final.index('--fs:clamp(12px,3.4vw,15px)'), \
    '平板块必须放在基础规则之后才能生效'

# ---- v1.2.6：内容区字号分级 --fs-c（账单页 / 资产页变小，顶栏五项与记账弹层不变） ----
assert '--fs-c:var(--fs);' in final, '缺内容区字号变量（默认应等于 --fs）'
assert '--fs-c:calc(var(--fs) * .88);' in final, '平板/桌面断点内内容区字号未降到 88%'
assert '.panel{border:var(--line);font-size:var(--fs-c);display:flex;flex-direction:column;flex:1 1 auto;min-height:0}' in final, '面板未承接内容区字号/未改为 flex 容器'
for _sel in ('.month-label,.date-label{font-size:var(--fs-c);',
             '.mini{font-size:var(--fs-c);',
             # v1.3.8：.kpi 由 var(--fs-c) 缩为 .86em（em 仍以父级 .panel 的 --fs-c 为基准），
             # 见下方 v1.3.8 契约；此处随本版改写，避免把「移动端显示不全」当回归失败。
             '.kpi{display:flex;flex:1;min-width:0;justify-content:space-between;gap:2px;font-size:.86em;',
             '.day{position:relative;height:29px;display:grid;place-items:center;font-size:var(--fs-c);',
             '.badge{width:26px;height:auto;min-height:26px;border:var(--line);display:grid;place-items:center;font-size:var(--fs-c);',
             '.line .r{font-size:var(--fs-c);',
             '.line2 .l{font-size:var(--fs-c)}',
             '.empty{padding:26px 8px;text-align:center;color:var(--muted);font-size:var(--fs-c)}',
             '.asset-summary .card{border:var(--line);min-width:0;padding:5px 3px;text-align:center;font-size:var(--fs-c);',
             '.asset-row{display:grid;grid-template-columns:minmax(0,1fr) 96px;gap:var(--flow-gap);padding:var(--flow-gap) 2px;border-bottom:var(--bd) solid #dde3ec;font-size:var(--fs-c);',
             '.credit-meta{display:flex;justify-content:space-between;gap:var(--flow-gap);padding:0 2px var(--flow-gap);border-bottom:var(--bd) solid #dde3ec;font-size:var(--fs-c);',
             '.asset-tools button{border:var(--line);padding:3px 8px;font-size:var(--fs-c)}',
             '.asset-empty{padding:14px 2px;text-align:center;color:var(--muted);font-size:var(--fs-c)}'):
    assert _sel in final, '账单/资产页元素未改用内容区字号: ' + _sel
assert '.line .l{display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--flow-gap);min-width:0;font-size:var(--fs-c);' in final, \
    '流水正文未改用内容区字号'
# 顶栏五项功能、侧栏按钮、记账弹层必须仍用 --fs（一个字都不许变小）
assert '.bx{border:var(--line);height:32px;min-width:60px;padding:0 8px;font-size:var(--fs);letter-spacing:2px' in final, \
    '顶栏按钮字号被改动（应保持 --fs）'
assert '.bottombar>button{position:relative;border:var(--line);height:36px;font-size:var(--fs);' in final, \
    '侧栏/底栏按钮字号被改动（应保持 --fs）'
assert '.sheet-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;font-size:var(--fs)}' in final, \
    '记账弹层标题字号被改动（应保持 --fs）'
assert '.flab{display:block;font-size:var(--fs);' in final, '记账弹层字段标签字号被改动'
assert '.numpad button,.ops button,.opcol>.act{border:var(--line);height:34px;font-size:var(--fs)}' in final, \
    '记账数字键盘字号被改动'


# ---- v1.3.5：标签移到金额前、自适应金额长度（构建期契约） ----
assert '.line1 .r.has-tag .tag{display:inline-block;max-width:5.5em;' in final, \
    'v1.3.5 第一行金额前标签样式缺失（inline-block + 5.5em 省略上限）'
assert '.line1 .r.has-tag .sep{color:inherit}' in final, \
    '标签与金额之间的「|」未统一为正文色（v1.3.6：与调整项「优惠|」同色）'
assert '.line1 .r.has-tag{display:inline-flex;align-items:center;justify-content:flex-end}' in final, \
    'v1.3.6 标签|金额未改 inline-flex 中线对齐（修复行内基线错位）'
assert 'vertical-align:baseline' not in final and '.line1 .r.has-tag .sep{display:inline;' not in final, \
    'v1.3.5 的 inline-block baseline 旧规则仍有残留（会导致标签下沉）'
assert '<span class="sep">|</span><span class="amt">' in final, \
    '标签|金额 连续串结构缺失（标签必须在金额前）'
for _dead in ('measureTagSlots', '--tag-w', '--acct-w', '.line2 .r.has-tag',
              'class="acct"', 'title="标签与账户"'):
    assert _dead not in final, 'v1.3.1 两槽机制仍有残留: ' + _dead
assert 'class="r has-tag" title="标签与金额"' in final \
    and "'<span class=\"r has-tag\" title=\"标签与金额\"><span class=\"tag\" title=\"标签\">' + esc(t.tag)" in final, \
    '带标签行未把标签挂到金额前'
assert "'<span class=\"r\" title=\"账户\">' + esc(acct) + '</span>'" in final, \
    '第二行不是 v1.3.0 的纯账户原串'
assert "'<span class=\"r\" title=\"该笔金额\"><span class=\"amt\">' + esc(amt) + '</span></span>'" in final, \
    '无标签行金额串被改动（零改动契约破了）'
assert final.count('class="r has-tag"') == 1, 'has-tag 分支应只有 1 处（第一行金额列）'
print('  [PASS] v1.3.5 金额前标签契约（CSS / 分隔符 / 槽机制零残留 / 第二行纯账户 / 无标签行原串）')


# ---- v1.3.2 沿用：转账还款金额区间 / Linux 物理键盘（构建期契约） ----
assert 'const NEED_BOTH = {transfer:true, repay:true, reimburse:true};' in final, \
    '需两端账户的类型表缺失（转账 / 还款 / 报销）'
assert 'function paidOf(t){ return r2(n(t.amount) - n(t.off) - n(t.discount) - n(t.cashback)); }' in final, \
    '支出账户实际被扣的口径缺失（须与 balanceOf 借方一致）'
assert "    case 'repay':     return [paidOf(t), recvOf(t)];" in final, \
    '转账 / 还款的金额两端没换成「被扣 → 到账」'
assert 'r2(recvOf(t) + n(t.discount) + n(t.cashback) - n(t.fee))' not in final, \
    '旧口径（优惠堆到到账侧，还款 40/优惠 10 会显示 40→50）仍有残留'
assert 'const twoSided = !NEED_BOTH[t.type] || !!(t.from && t.to);' in final, \
    '缺一端账户仍会渲染「0→500」半截区间'
assert 'const single = NEED_BOTH[t.type] ? ((t.from || !t.to) ? nom : eff) : eff;' in final, \
    '缺一端账户时的单值取值规则缺失'
assert 'function handleSheetKey(e){' in final and 'handleSheetKey(e);' in final, \
    'v1.3.2 物理键盘入口缺失'
assert "if(e.key === 'Enter'){" in final and "$('btnSave').click();" in final, \
    '物理键盘 Enter 未接保存'
assert "if(e.key === 'Backspace' || e.key === 'Delete'){ e.preventDefault(); keyInput('del'); return true; }" in final, \
    '物理键盘退格未接数字键盘'
assert "const SHIFT_OP = {'*':'×', '/':'÷', 'x':'×', 'X':'×'};" in final, '物理键盘运算符映射缺失'
assert "document.querySelectorAll('.keypad-field').forEach(el => {\n  el.addEventListener('focus', () => setActiveField(el));" in final, \
    '键盘聚焦未联动活动金额字段（Tab 切换会写错格）'
print('  [PASS] v1.3.2 沿用契约（金额两端 / 缺账户单值 / 物理键盘）')


# ---- v1.3.3：移除表单「·必填」高亮，改做流水条缺账户高亮（构建期契约） ----
assert '  --warn:#a00;' in final and '  --warn:#f85149;' in final, \
    'v1.3.3 警示色变量缺失（亮 #a00 / 暗 #ff6f6f）'
# ① 表单高亮零残留：支出账户不是必填项，不该在录入时催用户补齐
for dead in ('.fitem.need', '·必填', 'syncAccountNeed', "classList.toggle('need'"):
    assert dead not in final, 'v1.3.2 表单「必填」高亮仍有残留：' + dead
# ② 判定纯数据：函数体不碰 localStorage / DOM / UI 状态，故换设备后结果一致
import re
m = re.search(r'function lackOf\(t\)\{[^\n]*\}', final)
assert m, '缺 lackOf() 判定函数'
assert 'function lackOf(t){ return !!NEED_BOTH[t.type] && (!t.from || !t.to); }' in final, \
    '缺账户判定口径不对（应只认 NEED_BOTH 三类且缺任一端）'
for forbidden in ('localStorage', 'sessionStorage', 'document', 'S_ADD', 'settings'):
    assert forbidden not in m.group(0), 'lackOf 不应依赖本机状态：' + forbidden
assert 'const lack = lackOf(t);' in final, 'rowHTML 未调用 lackOf'
assert "'<div class=\"flow-row' + (lack ? ' lack' : '') + '\" data-id=\"'" in final, \
    '流水条没有按 lack 挂 class'
# ③ 三条高亮 CSS，且刻意不用 border-left（会挤动 grid 列造成整列参差）
assert '.flow-row.lack{box-shadow:inset 3px 0 0 var(--warn)}' in final, \
    '缺左侧红条；必须用 inset box-shadow 而非 border，否则高亮行内容会右移 3px'
assert '.flow-row.lack .badge{border-color:var(--warn);color:var(--warn)}' in final, '缺红徽标'
assert '.flow-row.lack .line2 .r{color:var(--warn)}' in final, \
    '缺账户位红字（v1.3.5 第二行统一纯账户单串）'
assert not re.search(r'\.flow-row\.lack\{[^}]*border-left', final), '红条误用 border-left'
# ④ 不新增 DOM / 不改文本：v1.3.5 金额前标签与 v1.3.3 缺账户红条零回归
assert "const acct = (t.from && t.to) ? (t.from + '→' + t.to) : (t.from || t.to || '');" in final, \
    'rowHTML 的账户文本被改动'
assert 'const r1 = t.tag' in final and 'const r2 =' in final, \
    'rowHTML 未把第一行金额（r1）与第二行账户（r2）分开渲染'
# ⑤ 保存口径一字未动（只提示，不拦截）
assert not re.search(r'function collectTx\(\)[\s\S]{0,600}lack', final), '保存逻辑被高亮判定污染'
print('  [PASS] v1.3.3 契约（表单高亮零残留 / 流水条 lack / 纯数据判定 / 零布局影响）')


# ---- v1.3.4：支出 / 收入「不计入」（构建期契约） ----
assert 'const NO_COUNT_TYPES = {expense:true, income:true};' in final, \
    'v1.3.4 可标记类型表缺失（应只有支出 / 收入）'
assert 'function counted(t){ return !(NO_COUNT_TYPES[t.type] && !!t.noCount); }' in final, \
    '计入判定口径不对（应只读记录自身 noCount，且只对支出 / 收入生效）'
assert 'function statsRows(rows){ return rows.filter(counted); }' in final, '统计取数过滤函数缺失'
# ① 只从月 / 日 KPI 剔除，计算引擎零改动
# v1.3.7：第三处出现在 renderOverview（本月三张卡）—— 同样是「先过滤再汇总」，
# 故条数由 2 变 3；漏掉过滤就会把「不计入」的支出算进总览。
assert final.count('summaryOf(statsRows(') == 3, \
    'renderHead 的月 / 日或总览页的本月取数未走 statsRows'
_summary_src = final[final.index('function summaryOf(rows){'):final.index('/* v1.3.4：「不计入」')]
assert 'noCount' not in _summary_src and 'statsRows' not in _summary_src, \
    'summaryOf 口径被「不计入」污染（应只在取数处过滤）'
_delta_src = final[final.index('function deltaOf(t){'):final.index('function summaryOf(rows){')]
assert 'noCount' not in _delta_src, 'deltaOf 口径被污染'
_bal_src = final[final.index('function balanceOf(a){'):final.index('/* ---- 状态 ---- */')]
assert 'noCount' not in _bal_src and 'counted' not in _bal_src, \
    '账户余额被「不计入」污染（用户确认余额照常按真实资金增减）'
# ② 表单：备注行切分 + 仅支出 / 收入可见
assert '<div class="note-line no-nc" id="noteLine">' in final, '备注行未切分（初始应为单列）'
assert 'id="fNoCountItem" hidden' in final and 'id="fNoCount"' in final and 'id="fNoCountBox"' in final, \
    '「不计入」勾选框结构缺失'
assert '.note-line{display:grid;grid-template-columns:minmax(0,1fr) 5.8em;' in final, '备注行未切出右侧一格'
assert '.note-line.no-nc{grid-template-columns:minmax(0,1fr)}' in final, '隐藏勾选框时未切回单列'
assert '.nc-item .nc-box input{' in final and 'width:auto;height:auto' in final, \
    '复选框未被覆盖回自身尺寸（会被 .fitem input 撑成 27px 整宽）'
assert 'html[data-theme="dark"] .nc-item .nc-box{border-color:#30363d}' in final, '暗色边框未与输入框同色'
assert '.nc-item .nc-box{height:1.8em;padding:0 .13em}' in final, '窄屏断点未跟随输入框高度'
assert "const ncOn = !!NO_COUNT_TYPES[tp];" in final and "$('fNoCountItem').hidden = !ncOn;" in final, \
    '类型联动未限制只对支出 / 收入显示'
assert "if(!ncOn) $('fNoCount').checked = false;" in final, '切到其它类型时未清掉隐藏的勾选状态'
assert "function updateNoCountBox(){" in final and "$('fNoCount').addEventListener('change', updateNoCountBox);" in final, \
    '选中态外框或 change 绑定缺失'
# ③ 数据落盘（跨设备）：formValues 写字段；编辑回填；新增 / 再记清空
assert "noCount: !!(NO_COUNT_TYPES[S_ADD.type] && $('fNoCount').checked)" in final, '表单未写 noCount'
assert "$('fNoCount').checked = !!(NO_COUNT_TYPES[t.type] && t.noCount);" in final, '编辑未回填勾选'
assert final.count("$('fNoCount').checked = false; updateNoCountBox();") == 2, \
    '新增 / 再记两处未清空勾选'
assert "if(e.target && e.target.id === 'fNoCount') return false;" in final, \
    '物理键盘未避开勾选框（Enter 会误触发保存）'
# ④ 流水条显示「不计入」，且不碰 v1.3.5 金额前标签 / v1.3.3 红条
assert "const nc = (NO_COUNT_TYPES[t.type] && t.noCount) ? piece('不计入', 'nc') : '';" in final, \
    '流水条未显示「不计入」'
assert '.line .l .piece.nc{color:inherit;font-size:inherit;white-space:nowrap}' in final, \
    '不计入小字未统一为正文大小正文色（v1.3.6：--warn 仍专用于缺账户）'
assert 'class="r has-tag" title="标签与金额"' in final, '金额前标签串被改动'
assert '.flow-row.lack{box-shadow:inset 3px 0 0 var(--warn)}' in final, '缺账户红条被改动'
print('  [PASS] v1.3.4 契约（仅支出/收入 / 只剔 KPI 不动余额 / 备注行切分 / 跨设备落盘 / 流水条小字）')


# ---- v1.3.5：标签移到金额前的收口契约（金额口径 / 引擎零改动） ----
assert "const amt = changed ? (num(nom) + '→' + num(eff)) : amountText(t, single);" in final, \
    '金额区间分隔符被改动（用户确认保留 →，不改成 -）'
# v1.3.7：三处（日历月 KPI / 日 KPI / 总览本月卡）—— v1.3.4 的两处照旧，第三处同样是先过滤后汇总
assert final.count('summaryOf(statsRows(') == 3, 'v1.3.5 不得影响 v1.3.4 的 KPI 取数'
for _eng in ('function summaryOf(rows){', 'function deltaOf(t){', 'function balanceOf(a){'):
    assert _eng in final, '计算引擎缺失: ' + _eng
print('  [PASS] v1.3.5 收口契约（金额区间保留 → / 计算引擎零改动）')

# ---- v1.3.6：标签|金额行内对齐 + 全流水条字号颜色统一（构建期契约） ----
assert '.line1 .r.has-tag{display:inline-flex;align-items:center;justify-content:flex-end}' in final, \
    'v1.3.6 金额前标签串未改 inline-flex 中线对齐'
assert '.line1 .r.has-tag .sep{color:inherit}' in final, '标签 | 未统一为正文色（优惠|色）'
assert '.line .l .piece.nc{color:inherit;font-size:inherit;white-space:nowrap}' in final, \
    '不计入小字未统一为正文大小正文色'
assert '.line .l .piece.sub{color:inherit}' in final, '时间未与正文同色'
assert '.line .r{font-size:var(--fs-c);white-space:nowrap;text-align:right;' in final, '右列字号/右对齐被改动'
assert '.flow-row.lack .line2 .r{color:var(--warn)}' in final, '缺账户 --warn 警示色被误统一掉'
print('  [PASS] v1.3.6 契约（标签|金额中线对齐 / 全流水条 --fs-c·--ink 统一 / --warn 保留）')


# ---- v1.3.7：总览开屏页 + dock 四项等宽（构建期契约，用户 2026-11-12 要求） ----
assert "tab:'overview'" in final, '开屏页不是总览（S.tab 默认值未改）'
assert '<button class="tab active" id="tabOv">总览</button>' in final, 'dock 缺「总览」页签'
assert '<button class="plus" id="btnAdd" title="记一笔" aria-label="记一笔">记账</button>' in final, \
    '「记账」按钮标记被改动（应为 .plus 且四边同样式）'
# 顺序必须逐字是 总览 / 账单 / 资产 / 记账
_pos = [final.index('id="tabOv"'), final.index('id="tabBill"'),
        final.index('id="tabAsset"'), final.index('id="btnAdd"')]
assert _pos == sorted(_pos), 'dock 顺序不是 总览/账单/资产/记账'
# 四块矩形框等宽：flex:1 1 0 等分 + 独立边框（v1.0.0 拆分，不再负边距折叠）；旧的 92/66 固定宽零残留
assert '.bottombar>button{position:relative;border:var(--line);height:36px;font-size:var(--fs);letter-spacing:2px;background:var(--paper);flex:1 1 0;min-width:0;margin-left:0}' in final, \
    'dock 按钮未等分宽度（缺 flex:1 1 0 / 独立边框 margin-left:0）'
assert '.tab{width:92px}' not in final and 'width:66px' not in final, '旧的 .tab / .plus 固定宽度仍残留'
assert '.bottombar>button:first-child{margin-left:0}' in final, '首块 margin-left 未归 0（v1.0.0 独立边框）'
# 平板左侧竖排 dock：主轴转纵向，必须改回 flex:0 0 auto，否则 flex-basis 0 会把按钮压扁
assert '.bottombar>button{flex:0 0 auto;margin-left:0}' in final, \
    '竖排 dock 未撤销 flex-basis 0 / 负左边距（按钮会被压扁或横向错位）'
# 总览页：独立渲染函数 + 复用既有取数口径（不新增统计函数）
assert 'function renderOverview(){' in final, '总览页渲染函数缺失'
assert "$('flow').innerHTML = renderOverview();" in final, \
    '总览页未接入 renderFlow（单层直出，无子页）'
assert "$('cal').hidden = isAsset || isOv;" in final and "$('dateBar').hidden = isAsset || isOv;" in final, \
    '总览页未隐藏日历 / 日期条'
assert 'summaryOf(statsRows(' in final and 'netOut(t)' in final, '总览页取数未复用既有口径'
assert 'function ovSummary' not in final and 'function ovBalance' not in final, \
    '总览页另起了统计函数（应复用 summaryOf / assetSummary）'
print('  [PASS] v1.3.7 契约（总览开屏页 / dock 四项等宽等序 / 竖排不压扁 / 取数复用口径）')


# ---- v1.3.8：末条流水底边 / KPI 字号 / 总览月份金额格（构建期契约，用户 2026-11-12 四条反馈） ----
# ① 末条流水要有底边，且滚到底时不能与 .panel 底边叠成 4px 大黑边
assert '.flow-list .flow-row:last-child{border-bottom:0}' not in final, \
    '末条流水的下边框仍被去掉（截图里最后一条是开口的）'
assert '.flow-list{display:flex;flex-direction:column;gap:var(--flow-gap);padding-bottom:8px}' in final, \
    '流水列表底部未留 8px，滚到底会与面板底边贴成大黑边'
assert '.flow-list{padding-bottom:.53em}' in final, '平板断点未同步留白'
# ② 账单页日期 / 月份旁边的三格 KPI 缩小，移动端不再省略
assert '.kpi{display:flex;flex:1;min-width:0;justify-content:space-between;gap:2px;font-size:.86em;white-space:nowrap}' in final, \
    'KPI 未缩到 .86em（移动端支出/收入/结余会被省略）'
# ③ v1.3.7 两榜已删（只查代码标记，注释里的沿革说明不算残留）
for _gone in ('const OV_TOP = 5;', '<span>分类支出</span>', '<span>最近流水</span>',
              'rank.map(x =>', 'recent.map(rowHTML)', 'ov-block'):
    assert _gone not in final, 'v1.3.7 榜单代码仍在: ' + _gone
# ④ v1.4.0：三块本年网格直出总览页（v1.3.9 的入口卡 / 独立页 / 返回键全部收回）
assert '.ov-heat{border:var(--line);margin:6px 0}' in final, '月份金额格缺独立外框'
assert '.ov-heat+.ov-heat{margin-top:0;border-top:var(--line)}' in final, \
    '三块之间未去掉上边框（两块各自的 2px 边会叠成 4px 粗线，与格线不一致）'
# 每块三行：第一行「年份 | 本年X 合计」，第二行 1~6 月，第三行 7~12 月
assert '.ov-heat-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr))}' in final, \
    '月份格不是 6 列（应为 1~6 / 7~12 两行）'
assert '.ov-cell:nth-child(6n){border-right:0}' in final, '6 列网格的末列未去右边框'
assert '.ov-heat-grid>.ov-cell:nth-last-child(-n+6){border-bottom:0}' in final, \
    '末行（7~12 月）未去下边框，会与外框贴成 4px 粗线'
assert 'ov-year' not in final, '「本年」格应取消（合计已上提到第一行）'
assert final.count('ovCell("') != 0 or 'for(const m of d.months) g += ovCell(m.mo, m[k], k);' in final, \
    '12 个月格未逐月渲染'
assert "'<i class=\"ov-sep\">|</i>'" in final, '第一行缺「|」竖线分隔'
assert 'ov-heat-sum' in final, '第一行缺本年合计'
assert "'<span class=\"ov-heat-year\">' + d.year + ' 年</span>'" in final, '第一行缺年份'
assert 'const sum = signedMoney(k, yv);' in final, \
    '三类合计未走 signedMoney（v1.4.3 起结余 / 收入 / 支出一律带正负号）'
assert "const OV_METRICS = {bal:'结余', inc:'收入', exp:'支出'};" in final, '三指标名称表缺失'
# v1.3.8 的切换控件必须彻底消失：状态位 / data-ov-metric / 单框重渲一个都不许留
assert "ovMetric:'bal'" not in final, 'v1.3.8 的 ovMetric 状态位仍有残留'
assert 'data-ov-metric="' not in final, '切换键的 data-ov-metric 仍有残留'
assert 'function renderHeat()' not in final and 'function heatHTML()' not in final, \
    'v1.3.8 的「只重渲一个框」路径仍有残留（本版整页渲染）'
assert 'S.ovMetric = om.dataset.ovMetric; renderHeat();' not in final, '切换键事件委托仍有残留'
# v1.3.9 的入口卡 / 返回键 / 状态位 也必须彻底消失（本版把它们全部收回成直出）
assert 'data-ov-page="' not in final and 'data-ov-back' not in final, \
    'v1.3.9 的入口卡 / 返回键仍有残留'
assert 'ovPage' not in final, 'v1.3.9 的 ovPage 状态位仍有残留'
assert 'ov-entry' not in final and 'ov-back' not in final, 'v1.3.9 的入口卡 / 返回键样式仍有残留'
assert "const S = {date:LAST_DATE, month:LAST_DATE.slice(0,7), tab:'overview'};" in final, \
    '状态里仍有残留字段（本版总览只有一页，无子页状态）'
# 新结构：三块由同一个渲染器产出，且三块同时出现在总览页
assert 'function ovBlockHTML(k, d){' in final, '三块的共用渲染器缺失'
assert final.count('function ovBlockHTML(') == 1, '渲染器应只有一个（三块结构必须相同）'
assert "ovBlockHTML('bal', d) + ovBlockHTML('inc', d) + ovBlockHTML('exp', d)" in final, \
    '总览页未把三块（结余 / 收入 / 支出）同时铺出来'
assert 'data-ov-kind="' in final, '三块缺少定位标记（data-ov-kind）'
# 三块不得各带 id：同页三个 id 会重复，HTML 非法
assert 'id="ovHeat"' not in final, '三块仍在用同一个 id（同页重复 id）'
assert "for(let mo = 1; mo <= 12; mo++)" in final and 'yearSum.bal = r2(yearSum.bal + s.bal);' in final, \
    '12 个月 / 本年累加缺失'
assert 'function heatData(){' in final, '月份格数据函数缺失'
# ⑤ 用户明确的三条边界：不要热力深浅、月份格不可点、不新增金额公式
_heat_css = final[final.index('.ov-heat{'):final.index('.ov-val{')]
assert 'rgba(' not in _heat_css and 'linear-gradient' not in _heat_css and '--heat' not in _heat_css, \
    '出现了热力渐变/透明度底色（用户要求只显示金额）'
assert 'data-ov-month' not in final and 'class="ov-cell" data-' not in final, \
    '月份格带了点击属性（用户要求纯展示不可点）'
assert "const monthStats = key => summaryOf(statsRows(DB.tx.filter(t => t.date.slice(0,7) === key)));" in final, \
    '月度取数不是既有 KPI 路径的纯包装（可能另起了新口径）'
assert final.count('summaryOf(statsRows(') == 3, '月度取数点数量异常（月 KPI / 日 KPI / monthStats）'
assert 'function ovSummary' not in final and 'function ovBalance' not in final, '另起了统计函数'
print('  [PASS] v1.4.0 契约（三块三行 · 6 列 × 2 行 / 年份|本年X 合计 / 单一渲染器 / 本年格已取消 / 无深浅 · 不可点 · 零新公式）')


# ---- v1.4.1：三处视觉修正（构建期契约；口径 / 数据 / 原生层零改动） ----
# ① 本年收入 / 本年支出两块补回顶边，三块都是完整矩形
assert '.ov-heat+.ov-heat{margin-top:0;border-top:var(--line)}' in final, '后两块仍缺顶边'
assert '.ov-heat+.ov-heat{margin-top:0;border-top:0}' not in final, '旧「去顶边」规则仍有残留'
assert '.ov-heat{border:var(--line);margin:6px 0}' in final, '月份格外框被误改'
# ② 总览竖线 / dock 选中页签与账单页同字号同字色
assert '.ov-sep{font-style:normal;font-size:var(--fs-c);line-height:1;color:var(--ink)}' in final, \
    '总览竖线仍是 opacity:.45 的淡化灰'
assert 'opacity:.45' not in final, '竖线淡化透明度仍有残留'
assert '.line1 .r.has-tag .sep{color:inherit}' in final, '账单页竖线正文色基线被改动'
assert '.tab.active{background:var(--paper);color:var(--ink)}' in final, '选中页签未归一'
assert '.tab.active{background:var(--paper);color:var(--ink);font-weight:700}' not in final, '选中页签仍加粗'
assert '.tab.active::after{content:"";position:absolute;left:50%;bottom:5px;transform:translateX(-50%);width:24px;height:3px;background:var(--ink)}' in final, \
    '选中态唯一指示条被误删'
# ③ 手机端四个框上移 6px，平板侧栏不动；dock 盒高 / body 让位 / 呼吸位逐字守恒
assert '.bottombar>button{top:-6px}' in final, '四个框未上移'
assert '.bottombar>button{top:0}' in final, '平板竖排侧栏未复位'
assert 'padding:7px 10px calc(2px + env(safe-area-inset-bottom,0px))' in final, 'dock 内距被误改'
assert 'padding:0 4px calc(46px + env(safe-area-inset-bottom,0px))' in final, 'body 让位被误改'
assert 7 + 36 + 2 == 45 and 46 + 7 - 45 == 8, 'dock 盒高 / 呼吸位算式不自洽'
print('  [PASS] v1.4.1 契约（三块补顶边 / 竖线·页签与账单同字号同色 / 四框上移 6px 且几何守恒）')

# ---- v1.4.2：全站小圆弧（纯样式层；DOM / 口径 / 原生层零改动） ----
assert ':root{--r:8px;--r-s:4px}' in final, '半径令牌缺失'
assert '.panel{border-radius:var(--r);overflow:hidden}' in final, '面板未圆角 / 未裁切'
assert '.ov-heat{border-radius:var(--r);overflow:hidden}' in final, '三块卡片未圆角 / 未裁切'
assert '.sheet{border-radius:var(--r)}' in final and '.set-sec{border-radius:var(--r)}' in final, \
    '弹层 / 设置区块未圆角'
assert '.bx,' in final and '.badge,' in final and '.day{border-radius:var(--r-s)}' in final, \
    '控件级圆角组缺失'
assert '.fitem input,.fitem select,.set-add input{border-radius:var(--r-s)}' in final, '输入框未圆角'
assert '.toast{border-radius:var(--r-s)}' in final, 'toast 未统一到 4px'
# v1.0.0：dock 四块拆分独立边框，四角全圆、彼此 gap 分隔（三选择器并列）
assert '.bottombar>button,\n.bottombar>button:first-child,\n.bottombar>button:last-child{border-radius:var(--r)}' in final, \
    'dock 四块未各自四角全圆（v1.0.0 拆分独立边框）'
assert 'display:flex;justify-content:center;gap:6px' in final, 'dock 未用 gap:6px 分隔独立按钮'
# 网格件 / 列表行必须仍是直角（避免接缝露缺口）
assert '.ov-cell{' in final and 'border-radius' not in final.split('.ov-cell{')[1].split('}')[0], \
    '月份格被误加圆角，接缝会露缺口'
assert '.flow-row{' in final and 'border-radius' not in final.split('.flow-row{')[1].split('}')[0], \
    '流水行被误加圆角'
# 平板断点三选择器并列，压得住首尾两块的 0,2,1 特异性
assert '@media (min-width:560px){\n  :root{--r:.4em;--r-s:.2em}' in final, '平板半径未按 --fs 换算'
assert '.bottombar>button:last-child{border-radius:var(--r)}\n}' in final, '平板四角未全圆'
print('  [PASS] v1.4.2 契约（容器 8px / 控件 4px / 网格件·列表行直角 / dock 四块全圆(v1.0.0) / 平板 em 换算）')

# ---- v1.4.5/v1.0.0：顶栏五格（「资产管理中枢」按键移除，四功能键等分） ----
assert '.topbar>.bx.stub{flex:1 1 0;min-width:0;padding:0 .28em;letter-spacing:.13em}' in final, \
    '四个功能键未改成 flex:1 等分'
assert '.topbar>.bx.add{flex:0 0 auto;padding:0 .55em;letter-spacing:0}' in final, \
    '末格「+ 新增账户」未按内容定宽'
assert 'class="bx brand"' not in final and 'btnBrand' not in final, \
    '「资产管理中枢」按键标记 / 事件监听未清干净'
assert '.bx.brand{' not in final, '「资产管理中枢」的 26% 定宽声明仍残留（v1.2.8 的三档 calc 应已删除）'
# ---- v1.4.3：新增账户上移 + 总览金额带正负号 ----
_tb_html = final[final.index('<div class="topbar">'):]
_tb_html = _tb_html[:_tb_html.index('</div>')]
assert _tb_html.count('<button') == 5, '顶栏应为 5 个按键（设置/备份/恢复/明暗/新增账户）'
assert 'class="spacer"' not in _tb_html, '顶栏仍留着弹性空档 .spacer'
assert 'id="btnAddAccount"' in final, '顶栏缺「+ 新增账户」'
assert '<div class="asset-tools"><button id="btnAddAccount">' not in final, \
    '「+ 新增账户」仍留在资产页内（应已上移）'
assert "$('btnAddAccount').addEventListener('click', () => openAccount(null));" in final, \
    '顶栏新增账户未绑定点击'
assert 'function signedMoney(kind, v){' in final, '金额带号函数缺失'
assert 'if(x === 0) return a;' in final, '0 值应保持不加号'
assert 'const sum = signedMoney(k, yv);' in final, '三块合计未带号'
assert 'g += ovCell(m.mo, m[k], k);' in final, '12 个月格未带号'
assert "card('本月支出', m.exp, 'exp')" in final and "card('本月结余', m.bal, 'bal')" in final, \
    '本月三卡未带号'
assert "card('总资产', s.total) + card('资产账户', s.asset) + card('信贷账户', s.credit)" in final, \
    '资产三卡被误加正负号（余额性质，保持绝对值）'
print('  [PASS] v1.4.5/v1.0.0 契约（顶栏五格四键等分 / 「资产管理中枢」按键全量下线）')
print('  [PASS] v1.4.3 契约（新增账户上移 / 总览金额带正负号）')


# ---- v1.0.0：六项视觉改动（纯样式层；DOM / 口径 / 原生层零改动） ----
# ① 边框 1px（已在上文 --bd 断言）
# ② dock 四按钮独立边框（已在 v1.4.2 段断言全圆 + gap）
# ③ 账单页流水条独立边框（四边 + 圆角，仅账单页 body 无类）
assert 'body:not(.tab-asset):not(.tab-overview) .flow-row{' in final, '账单页流水条独立边框覆盖层缺失'
_fr = final.split('body:not(.tab-asset):not(.tab-overview) .flow-row{')[1].split('}')[0]
assert 'border:var(--line)' in _fr and 'border-radius:var(--r-s)' in _fr, '流水条未四边框+圆角'
# ④ 账单页去整页大外框 + 日期框圆角 + 首条离日期 8px
_assert_panel = final.split('body:not(.tab-asset):not(.tab-overview) .panel{')[1].split('}')[0]
assert 'border:0' in _assert_panel and 'border-radius:0' in _assert_panel, '账单页大外框未去掉'
assert 'body:not(.tab-asset):not(.tab-overview) .cal{' in final, '日期框 cal 规则缺失'
assert 'body:not(.tab-asset):not(.tab-overview) .datebar{' in final, '日期框 datebar 规则缺失'
_fl = final.split('body:not(.tab-asset):not(.tab-overview) .flow-list{')
assert len(_fl) >= 3 and 'padding-top:8px' in _fl[-1].split('}')[0], '首条流水与日期栏未拉开 8px'
# ⑤ 资产页两条合计行隐藏
assert 'body.tab-asset .asset-row.subtotal{' in final, '合计行隐藏规则缺失'
assert 'display:none' in final.split('body.tab-asset .asset-row.subtotal{')[1].split('}')[0], '合计行未隐藏'
assert "row('资产账户合计', s.asset, 'subtotal')" in final and "row('信贷账户合计', s.credit, 'subtotal')" in final, \
    '合计行渲染函数被误删（应仅隐藏显示，数值口径不变）'
# ⑥ 账户卡末尾残留横线去掉（nth-last-child(2)+last-child 双兜底）
assert 'body.tab-asset .asset-group > .asset-item:nth-last-child(2) .asset-row,' in final, '末尾横线规则缺失'
assert 'border-bottom:0' in final.split('body.tab-asset .asset-group > .asset-item:nth-last-child(2) .asset-row,')[1].split('}')[0], \
    '末尾横线未去掉'
# 预览标识零残留（正式版不得含「预览」字样）
assert '预览' not in final, '正式页残留「预览」标识'
print('  [PASS] v1.0.0 契约（1px 边框 / dock 独立 / 流水条独立 / 账单去外框+日期圆角+8px / 资产去合计 / 去末尾横线）')

# 回归用 fixture：由环境变量 AMHUB_FIXTURE 指向本地脱敏备份 JSON，仅做脱敏校验，不写回任何业务数据
d = None
if FIXTURE is not None:
    assert FIXTURE.exists(), 'AMHUB_FIXTURE 指向的文件不存在：%s' % FIXTURE
    d = json.loads(FIXTURE.read_text(encoding='utf-8'))
    assert 'backup' not in d.get('settings', {}), 'fixture 未脱敏：settings.backup 仍在'

print('成品:', OUT)
print('字节:', OUT.stat().st_size, '| 内嵌流水: 0 | 内嵌账户: 0')
print('脱敏: 凭据零命中（本地清单 + 邮箱兜底）')
print('测试 fixture:', str(FIXTURE) if d is not None else '（未提供，回归用 fixture 由测试脚本自备）')
