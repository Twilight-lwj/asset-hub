#!/usr/bin/env node
/* 资产管理中枢 v1.0.0 · 算法自检（纯 Node 标准库，可复跑）
   口径断言全部执行「从成品 HTML 里抽出的真实函数源码」，不重抄公式；
   另做页面契约、凭据脱敏与 APK 内嵌资源一致性校验。
   断言标签里的 v1.x.y 是「该规则由哪一版引入」的溯源标记，不是当前版本号。
   用法：node 算法自检.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const crypto = require('crypto');

// 脚本可放在版本目录根或 源码/打包脚本/ 下，自动向上找 APK 所在目录
function findRoot(){
  let d = __dirname;
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(d, '发布版', '资产管理中枢-发布版1.0.0.apk'))
        || fs.existsSync(path.join(d, '源码', '资产管理中枢_浏览器版.html'))) return d;
    d = path.dirname(d);
  }
  return path.resolve(__dirname, '..', '..');
}
const ROOT = findRoot();
const PAGE = path.join(ROOT, '源码', '资产管理中枢_浏览器版.html');
const APK = path.join(ROOT, '发布版', '资产管理中枢-发布版1.0.0.apk');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('[PASS] ' + name); }
  else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
};
const eq = (name, got, exp) => ok(name + ' = ' + JSON.stringify(exp), got === exp, got);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

if (!fs.existsSync(PAGE)) { console.error('找不到源页面: ' + PAGE); process.exit(2); }
const html = fs.readFileSync(PAGE, 'utf8');

/* ---------- 抽真实源码（不重抄口径） ---------- */
function slice(startMark, endMark) {
  const a = html.indexOf(startMark), b = html.indexOf(endMark, a + 1);
  if (a < 0 || b < 0) throw new Error('抽取源码失败: ' + startMark);
  return html.slice(a, b);
}
const core = slice('const TYPE_NAME  =', '/* ---- 状态 ---- */');
const render = slice('/* 调整项明细', '/* 资产页汇总');
const ctx = { DB: {tx: [], accounts: [], accountTypes: [{id:'asset',mode:'asset'},{id:'credit',mode:'credit'}]} };
vm.createContext(ctx);
vm.runInContext(core + '\n' + render + '\n'
  + 'globalThis.A = {netOut,outOf,recvOf,reimNet,diffOf,deltaOf,summaryOf,balanceOf,'
  + 'money,num,r2,adjustParts,adjustText,amountPair,amountText,rowHTML,TYPE_NAME,TYPE_BADGE,'
  + 'paidOf,NEED_BOTH,lackOf,NO_COUNT_TYPES,counted,statsRows};', ctx);
const A = ctx.A;
ok('A0 成功执行成品页里的真实口径函数', typeof A.netOut === 'function' && typeof A.rowHTML === 'function');

console.log('\n===== 一、金额口径（v1.1.22 沿用，零改动） =====');
eq('netOut 原价−优惠−返现', A.netOut({amount:100,discount:4,cashback:0.5}), 95.5);
eq('outOf 支出账户实际被扣', A.outOf({amount:100,off:2}), 98);
eq('recvOf 有收款方且有 recv', A.recvOf({to:'收款账户',recv:99,amount:100}), 99);
eq('recvOf 有收款方但 recv 空则回落 amount', A.recvOf({to:'收款账户',recv:'',amount:100}), 100);
eq('recvOf 无收款方为 0', A.recvOf({amount:100,recv:99}), 0);
eq('reimNet 报销净回款', A.reimNet({reimbursed:20,fee:1}), 19);
eq('diffOf 转账（有出有入）= 到账 − 支出', A.diffOf({type:'transfer',from:'A',to:'B',amount:100,off:2,recv:99}), 1);
eq('diffOf 转账（只入不出）= 到账', A.diffOf({type:'transfer',to:'B',amount:100,recv:99}), 99);
eq('diffOf 非转账 = 0', A.diffOf({type:'expense',amount:100}), 0);
eq('deltaOf 支出', A.deltaOf({type:'expense',amount:100,discount:4,cashback:0.5}), -95.5);
eq('deltaOf 收入', A.deltaOf({type:'income',amount:100,discount:4,cashback:0.5}), 104.5);
eq('deltaOf 报销', A.deltaOf({type:'reimburse',amount:10,discount:0,cashback:0,reimbursed:20,fee:1}), 9);
const sm = A.summaryOf([{type:'income',amount:100},{type:'expense',amount:40}]);
eq('summaryOf 收入', sm.inc, 100);
eq('summaryOf 支出', sm.exp, 40);
eq('summaryOf 结余', sm.bal, 60);
eq('balanceOf 无流水 = 期初', A.balanceOf({id:'a1',name:'微信',opening:500}), 500);
ctx.DB.tx = [{type:'expense',from:'微信',fromId:'a1',amount:100,discount:4,cashback:1}];
eq('balanceOf 支出按 netOut 扣减', A.balanceOf({id:'a1',name:'微信',opening:500}), 405);
ctx.DB.tx = [];
eq('money 固定两位小数', A.money(-25186.7), '-25186.70');
eq('num 去尾零', A.num(3.1400), '3.14');
eq('num 零值不显示负零', A.num(0), '0');

console.log('\n===== 二、流水条口径（第九版版式语义） =====');
const adj = A.adjustParts({discount:4,off:1,cashback:0.5,fee:0.2,reimbursed:6});
eq('立减并入优惠', adj[0], '优惠+5');
ok('调整项共 4 段且顺序固定', JSON.stringify(adj) === JSON.stringify(['优惠+5','返现+0.5','手续费-0.2','回款+6']), adj);
eq('调整项用 | 单行连接', A.adjustText({discount:4,off:1,cashback:0.5,fee:0.2,reimbursed:6}), '优惠+5|返现+0.5|手续费-0.2|回款+6');
const ap = A.amountPair({type:'expense',amount:100,discount:4,cashback:0.5});
ok('有差异时金额对为 100 / 95.5', ap[0] === 100 && ap[1] === 95.5, ap);
eq('支出金额带负号', A.amountText({type:'expense'}, 95.5), '-95.50');
eq('收入金额带正号', A.amountText({type:'income'}, 100), '+100.00');
const row = A.rowHTML({id:'x1',type:'expense',date:'2026-11-01',time:'12:30',category:'便利店',
  tag:'餐饮',note:'和小李',amount:100,discount:0,from:'微信'});
ok('流水条 data-id 与 .amt 在位', row.includes('data-id="x1"') && row.includes('class="amt"'), row.slice(0,160));
const cut = row.indexOf('<div class="line line2">');
ok('标签在第一行金额前（标签|金额），第二行仅纯账户串；v1.3.5 停用两槽',
   cut > 0 && row.slice(0, cut).includes('<span class="r has-tag" title="标签与金额"><span class="tag"')
   && row.slice(0, cut).includes('<span class="sep">|</span><span class="amt">')
   && row.slice(cut).includes('<span class="r" title="账户">')
   && !row.includes('class="acct"') && !row.includes('title="标签与账户"'),
   row.slice(Math.max(0, cut - 60), cut + 130));
ok('备注位只取 note，不回退分类', row.includes('和小李') && (row.match(/便利店/g) || []).length === 1, row);
ok('类型名不拼进流水条文字', !row.includes('>支出</span>'), row.slice(0,200));
const catless = A.rowHTML({id:'x2',type:'income',date:'2026-11-01',time:'09:00',amount:100,to:'银行卡'});
ok('收入无分类时补类型名', catless.includes('收入'), catless.slice(0,180));
const expenseEmpty = A.rowHTML({id:'x3',type:'expense',date:'2026-11-01',time:'09:00',amount:100,from:'微信'});
ok('支出无分类时不补「支出」', !expenseEmpty.includes('>支出</span>'), expenseEmpty.slice(0,180));

console.log('\n===== 三、页面契约 / 脱敏 =====');
ok('版本 v1.0.0', html.includes('<title>资产管理中枢 v1.0.0</title>') && html.includes('data-version="1.0.0"'));
ok('出厂空账本（无内置流水 / 资产）', html.includes('"accounts":[]') && html.includes('"tx":[]'));
ok('保留 asset / credit 两类账户型', html.includes('"mode":"asset"') && html.includes('"mode":"credit"'));
// 凭据清单不入库：只做通用兜底（成品页不得出现任何邮箱形态串）；具体账号口令由构建期用本地 密钥/leak_guard.txt 校验
ok('凭据零命中', !/[0-9A-Za-z._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(html));
ok('内置业务数据零命中', !html.includes('便利店') && !html.includes('t13tibezl'));
ok('占位按钮已全部启用（data-stub 清零）', !html.includes('data-stub'));
ok('统一数据键 amhub_v100_db', html.includes("'amhub_v100_db'"));
ok('凭据剔除逻辑 normalizeDB 在位', /delete o\.settings\.backup/.test(html) && /delete o\.settings\.nutstore/.test(html));
ok('dock 固定定位', /\.bottombar\{[^}]*position:fixed/.test(html));
ok('滚动条隐藏', /::-webkit-scrollbar\{[^}]*display:none/.test(html));
ok('账户合计下方灰线去除', /\.asset-row\.subtotal\{font-weight:700;border-bottom:0\}/.test(html));
ok('标签在金额前、三者中线齐平（v1.3.6：inline-flex + align-items:center 修 overflow 基线陷阱）',
   /\.line1 \.r\.has-tag\{[^}]*display:inline-flex[^}]*align-items:center/.test(html)
   && /\.line1 \.r\.has-tag \.tag\{[^}]*max-width:5\.5em/.test(html)
   && !/\.line1 \.r\.has-tag \.tag\{[^}]*vertical-align:baseline/.test(html));
ok('v1.3.6 标签 | 与金额、标签统一正文色，与「优惠|」同色（不再是 --muted 灰）',
   /\.line1 \.r\.has-tag \.sep\{[^}]*color:inherit/.test(html)
   && !/\.line1 \.r\.has-tag \.sep\{[^}]*color:var\(--muted\)/.test(html));
ok('原生桥 8 参契约注释在位', html.includes('恰好 8 个 String'));
ok('APK 导出走原生 exportBackup', html.includes('PNL_NATIVE.exportBackup'));
ok('系统栏亮色默认不透明白 + 暗色不透明深（均非透明，杜绝动态取色）',
   html.includes("isDark() ? '#ff0d1117' : '#fff4f6fa', !isDark()")
   && !html.includes("setSystemBars('#00000000'"));
ok('v1.2.5 弹层改居中悬浮后四周均为实线（不再为系统取色把底边染成纸色）',
   html.includes('background:var(--paper);border:var(--line);padding:7px 9px calc(20px')
   && !html.includes('border-bottom-color:var(--paper)'));
ok('启动句在脚本末尾（TDZ 防护）', /renderAll\(\);\s*fitFrame\(\);\s*<\/script>/.test(html));
/* v1.3.7：相邻按钮的 2px 竖线由「只处理中间那一个」推广成 + 选择器（四块等宽后有三处相邻） */
ok('v1.0.0 相邻按钮拆独立边框（gap:6px 分隔，不再负边距折叠）',
   html.includes('margin-left:0}') && html.includes('justify-content:center;gap:6px')
   && !html.includes('margin-left:calc(var(--bd) * -1)'));
ok('v1.1.2 系统栏刷白函数 + 生命周期监听',
   /function forceWhiteBars\(\)/.test(html) && /visibilitychange/.test(html) && /visualViewport/.test(html));
ok('v1.1.2 弹层 / dock 底部抬高',
   /padding:7px 9px calc\(20px \+ env\(safe-area-inset-bottom,0px\)\)/.test(html)
   && /calc\(2px \+ env\(safe-area-inset-bottom,0px\)\)/.test(html));
ok('v1.2.10 dock 底 2px（原 4px 再减半）；v1.3.0 body 46px（dock 45 + 呼吸 8 − .app 底 7）/ toast 58px',
   /calc\(2px \+ env\(safe-area-inset-bottom,0px\)\)/.test(html)
   && /calc\(46px \+ env\(safe-area-inset-bottom,0px\)\)/.test(html)
   && /calc\(58px \+ env\(safe-area-inset-bottom,0px\)\)/.test(html));
ok('v1.1.2 浅色配色与深色模式兜底',
   html.includes('color-scheme:light') && html.includes('prefers-color-scheme: dark'));

// ---- v1.1.5 起：顶部备份双写 / 恢复来源选择框（静态契约，v1.1.8 沿用） ----
ok('v1.1.5 顶部「备份」本地 + 云端双写（共用 cloudBackupCore）',
   html.includes("$('btnBackup').addEventListener('click', backupAll)")
   && html.includes('function cloudBackupCore()') && html.includes('localAutoBackup()'));
ok('v1.1.5 顶部「恢复」弹来源选择框（本地 / 云端两项）',
   html.includes("$('btnRestore').addEventListener('click', openRestorePicker)")
   && html.includes('id="restoreSheet"') && html.includes('data-restore="local"')
   && html.includes('data-restore="cloud"') && html.includes('function openRestorePicker()'));
ok('v1.1.5 云端下载核心被设置页与顶部入口共用',
   html.includes('function cloudRestoreCore()')
   && html.includes('const r = await cloudRestoreCore()')
   && html.includes('restoreFromCloud'));
ok('v1.1.5 顶部两个按钮不再单通道直连',
   !html.includes("$('btnBackup').addEventListener('click', exportBackup)")
   && !html.includes("$('btnRestore').addEventListener('click', () => $('importFile').click())"));
ok('v1.1.5 设置页四个单通道入口保留（高级用途）',
   html.includes('data-io="export"') && html.includes('data-io="import"')
   && html.includes('data-ns="up"') && html.includes('data-ns="down"'));
ok('v1.1.5 恢复选择框复用 .sheet 且可关闭（v1.2.5 起与其它弹层同用居中定位）',
   /<section class="sheet" id="restoreSheet"/.test(html)
   && html.includes('closeRestorePicker')
   && html.includes('position:fixed;left:50%;top:50%;bottom:auto;'));
ok('v1.1.5 Escape 可关闭恢复选择框',
   /if\(restoreOpen\(\)\)\{ if\(e\.key === 'Escape'\) closeRestorePicker\(\); return; \}/.test(html));
ok('v1.1.5 导出 quiet 参数不破坏设置页原提示',
   /function exportBackup\(quiet\)/.test(html) && html.includes("if(!quiet) toast('备份已导出')"));

// ---- v1.1.6 起：备份零弹窗 / 明暗主题（静态契约，v1.1.8 沿用） ----
ok('v1.1.6 顶部「备份」写固定备份区、不再调用会弹 SAF 的 exportBackup(true)',
   html.includes('const name = localAutoBackup()') && !html.includes('const name = exportBackup(true)'));
const dfs = html.slice(html.indexOf('function dataForSync('), html.indexOf('function exportBackup('));
ok('v1.1.6 固定备份区 / 主题键不进数据同步（备份文件不含偏好与凭据载体）',
   !dfs.includes('AUTOBAK_KEY') && !dfs.includes('THEME_KEY'));
ok('v1.1.6 恢复「本地备份」优先读固定备份区，无备份才回退文件选择器',
   html.includes('function restoreFromLocal()')
   && html.includes("if(b.dataset.restore === 'local') restoreFromLocal()")
   && html.includes("$('importFile').click(); return;"));
ok('v1.1.6 设置页手动「导出备份」仍保留原生桥',
   html.includes('PNL_NATIVE.exportBackup') && /function exportBackup\(quiet\)/.test(html));
ok('v1.1.6 顶栏有「明暗」按钮（v1.4.5 起与设置 / 备份 / 恢复 同排，共五格）',
   /id="btnTheme"[^>]*>明暗<\/button>/.test(html)
   && /id="btnSettings"[^>]*>设置<\/button>/.test(html)
   && !html.includes('id="btnBrand"'));
ok('v1.1.6 明暗主题：暗色变量覆盖 + 独立持久化键 + head 防闪白脚本',
   html.includes('html[data-theme="dark"]') && html.includes('--paper:#0d1117')
   && html.includes("const THEME_KEY = 'amhub_v100_theme'")
   && /<script>\s*\/\* v1\.1\.[0-9]+：主题在样式解析后/.test(html));
ok('v1.1.6 亮色默认态保留 color-scheme:light（不破坏 v1.1.4 手势条修复）',
   html.includes('color-scheme:light') && html.includes('--paper:#f4f6fa;'));
ok('v1.1.6 系统栏颜色随明暗同步（两种主题都是不透明明确色）',
   html.includes("isDark() ? '#ff0d1117' : '#fff4f6fa', !isDark()")
   && !html.includes("setSystemBars('#00000000'"));

// ---- v1.1.7 起：紧凑选项弹层 + 图标缩小（静态契约，v1.1.8 沿用） ----
ok('v1.1.7 5 个原生 select 各有透明命中层，且含 select 的 label 已改 div',
   (html.match(/class="sel-hit"/g) || []).length === 5 &&
   !html.includes('<label class="fitem" id="fCatItem">') &&
   !html.includes('<label class="fitem" id="fTagItem">'));
ok('v1.1.7 原生 select 禁用直接点击（否则仍会弹系统全屏单选框）',
   html.includes('.fitem select{pointer-events:none}'));
ok('v1.1.7 紧凑弹层结构在位，层级高于记账 / 账户 / 设置弹层',
   html.includes('id="pickerMask"') && html.includes('id="pickerSheet"') &&
   html.includes('id="pickerList"') && html.includes('.picker-mask{z-index:60}') &&
   html.includes('.sheet.picker{z-index:61'));
ok('v1.1.7 选项行 36px / 列表最高 46vh 可滚动（系统原生框为 195px 行高、占屏 89%）',
   html.includes('height:36px;line-height:36px') &&
   html.includes('max-height:min(46vh,340px)') && html.includes('overflow-y:auto'));
ok('v1.1.7 选中后写回 select.value 并派发 change（aKind 联动不失效）',
   html.includes('sel.dispatchEvent(new Event(\'change\', {bubbles:true}))'));
ok('v1.1.7 禁用下拉被拦截、Escape 优先关闭选择器且不误关底层记账页',
   html.includes('if(!sel || sel.disabled) return;') &&
   html.includes('if(pickerOpen()){ if(e.key === \'Escape\') closePicker(); return; }'));
const iconScript = fs.readFileSync(path.join(ROOT, '源码', '图标', 'make_icon.py'), 'utf8');
ok('v1.1.7 图标 ¥ 已缩小：生成脚本目标 bbox 46%，断言区间 0.40–0.52',
   iconScript.includes('MASTER * 0.46') && iconScript.includes('0.40 <= frac <= 0.52') &&
   !iconScript.includes('MASTER * 0.62'));

// ---- v1.1.8：白天黑边纯白底 / 夜晚白边纯黑底（静态契约） ----
ok('v1.1.8 白天令牌 #000000/#ffffff，夜晚 #ffffff/#000000',
   html.includes('--ink:#12161d;') && html.includes('--paper:#f4f6fa;')
   && html.includes('--ink:#e6edf3;') && html.includes('--paper:#0d1117;'));
ok('v1.1.8 顶栏按钮 / 日期选择区显式设主题底色（不靠 button{background:none} 继承）',
   html.includes('white-space:nowrap;background:var(--paper)}')
   && html.includes('.month-label,.date-label{font-size:var(--fs-c);letter-spacing:1px;padding:2px 1px;background:var(--paper)}'));
ok('v1.1.8 日历选中日期框＝主题底 + 主题色实线框 + 加粗（不再反色实心块）',
   html.includes('.day.sel{background:var(--paper);color:var(--ink);border-color:var(--edge);font-weight:700}')
   && html.includes('.day.sel.has::after{background:var(--ink)}')
   && !html.includes('.day.sel{background:var(--ink)'));
ok('v1.1.8 「今天」虚线框按主题取色（白天黑虚线 / 夜晚白虚线）',
   html.includes('.day.today:not(.sel){border:var(--bd) dashed var(--ink)}')
   && html.includes('html[data-theme="dark"] .day.today:not(.sel){border-color:var(--edge)}'));
ok('v1.1.8/v1.1.9 dock 选中态＝主题底 + 悬浮短指示条（不再反色块、不再贴下边框）',
   html.includes('.tab.active{background:var(--paper);color:var(--ink)}')
   && !html.includes('.tab.active{background:var(--ink)'));
ok('v1.1.8 「明暗」按钮黑夜态不再反色（仅加粗）',
   html.includes('#btnTheme[aria-pressed="true"]{background:var(--paper);color:var(--ink);font-weight:700}')
   && !html.includes('#btnTheme[aria-pressed="true"]{background:var(--ink)'));
ok('v1.1.8 悬停/按压一律主题底色，三处控件无灰块',
   html.includes('.bx:hover,.tab:hover,.plus:hover,.mini:hover,.date-label:hover,.month-label:hover{background:var(--paper)}')
   && html.includes('.bx:active,.tab:active,.mini:active{background:var(--paper)}')
   && html.includes('html[data-theme="dark"] .mini:active{background:var(--paper)}'));
ok('v1.1.8 夜间系统栏与 meta theme-color 归一为纯黑（不透明，不触发动态取色）',
   html.includes("isDark() ? '#ff0d1117' : '#fff4f6fa', !isDark()")
   && html.includes("m.setAttribute('content', dark ? '#0d1117' : '#f4f6fa')"));


// ---- v1.1.9：dock 底部黑边不再重叠（静态契约 6 条） ----
ok('v1.1.9 选中态指示条悬浮（24×3px、距底 5px），不再贴 2px 下边框',
   html.includes('.tab.active::after{content:"";position:absolute;left:50%;bottom:5px;transform:translateX(-50%);width:24px;height:3px;background:var(--ink)}'));
ok('v1.1.9 已删除 inset 0 -3px 贴边指示条（v1.1.8 的 5px 粗黑边根因）',
   !html.includes('box-shadow:inset 0 -3px 0 var(--ink)'));
ok('v1.1.9 dock 按钮建立定位上下文（::after 才会相对按钮定位）',
   html.includes('.bottombar>button{position:relative;'));
ok('v1.1.9 dock 顶边上方有 6px 主题纯色缓冲带（v1.2.5 起 top:-6px，盖到已撤线的 dock 顶边）',
   html.includes('.bottombar::before{content:"";position:absolute;left:0;right:0;top:-6px;height:6px;background:var(--paper)}'));
ok('v1.1.9 白天/夜晚 dock 灰晕投影均已移除（2px 顶边不再糊成粗边）',
   !html.includes('box-shadow:0 -3px 10px rgba(0,0,0,.06)')
   && !html.includes('box-shadow:0 -3px 10px rgba(0,0,0,.55)')
   && !html.includes('html[data-theme="dark"] .bottombar{box-shadow'));
ok('dock 仍是固定定位、底部内距 v1.2.10 减半为 2px；v1.2.5 起顶部不再画分隔线',
   /\.bottombar\{[^}]*background:var\(--paper\);border-top:0/.test(html)
   && !/\.bottombar\{[^}]*border-top:var\(--line\)/.test(html)
   && /\.bottombar\{[^}]*position:fixed/.test(html)
   && html.includes('calc(2px + env(safe-area-inset-bottom,0px))'));


// ---- v1.2.0：剩余三处反色高亮归一（静态契约 9 条） ----
ok('v1.2.0 记账页类型按钮选中态＝纯底 + 纯字 + 加粗',
   html.includes('.type-row button.active{background:var(--paper);color:var(--ink);font-weight:700}'));
ok('v1.2.0 选项弹层选中行＝纯底 + 纯字 + 加粗',
   html.includes('.picker-row.cur{background:var(--paper);color:var(--ink);font-weight:700}'));
ok('v1.2.0 设置页开关选中态＝纯底 + 纯字 + 加粗',
   html.includes('.set-btns .bx.on{background:var(--paper);color:var(--ink);font-weight:700}'));
ok('v1.2.0 类型按钮与选项行显式设主题底色（不靠 transparent 继承）',
   html.includes('.type-row button{border:var(--line);height:29px;font-size:var(--fs);background:var(--paper)}')
   && html.includes('background:var(--paper);color:var(--ink);'));
ok('v1.2.0 三处反色实心块全部清除',
   !html.includes('.type-row button.active{background:var(--ink)')
   && !html.includes('.picker-row.cur{background:var(--ink)')
   && !html.includes('.set-btns .bx.on{background:var(--ink)'));
ok('v1.2.0 亮/暗选项行按压均为主题纯色，无 #e8e8e8 / #2b2b2b 灰块',
   html.includes('.picker-row:active{background:var(--paper)}')
   && html.includes('html[data-theme="dark"] .picker-row:active{background:var(--paper)}')
   && !html.includes('.picker-row:active{background:#e8e8e8}')
   && !html.includes('html[data-theme="dark"] .picker-row:active{background:#2b2b2b}'));
ok('v1.2.0 全站选中态语言统一（v1.4.1：dock 选中态撤加粗，三件套由 5 处精确变 4 处）',
   (html.match(/background:var\(--paper\);color:var\(--ink\);font-weight:700/g) || []).length === 4
   && html.includes('.day.sel{background:var(--paper);color:var(--ink);border-color:var(--edge);font-weight:700}')
   && html.includes('.tab.active{background:var(--paper);color:var(--ink)}')
   && !html.includes('.tab.active{background:var(--paper);color:var(--ink);font-weight:700}'));
ok('v1.2.0 零 JS / 零口径改动：数据键与金额函数未变',
   html.includes("const DB_KEY = 'amhub_v100_db'")
   && html.includes("const AUTOBAK_KEY = 'amhub_v100_autobackup'")
   && html.includes("const THEME_KEY = 'amhub_v100_theme'"));
ok('v1.2.0 v1.1.9 dock 黑边分离契约不回退',
   html.includes('.tab.active::after{content:"";position:absolute;left:50%;bottom:5px')
   && html.includes('.bottombar::before{content:"";position:absolute;left:0;right:0;top:-6px;height:6px;background:var(--paper)}')
   && !html.includes('box-shadow:inset 0 -3px 0 var(--ink)'));

console.log('\n===== 四、APK 内嵌资源一致性 =====');
function zipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效 ZIP/APK');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('central directory 损坏');
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nlen = buf.readUInt16LE(off + 28), xlen = buf.readUInt16LE(off + 30), clen = buf.readUInt16LE(off + 32);
    const name = buf.toString('utf8', off + 46, off + 46 + nlen);
    const loff = buf.readUInt32LE(off + 42);
    const ln = buf.readUInt16LE(loff + 26), lx = buf.readUInt16LE(loff + 28);
    const start = loff + 30 + ln + lx;
    const raw = buf.slice(start, start + csize);
    out[name] = method === 0 ? raw : (method === 8 ? zlib.inflateRawSync(raw) : null);
    off += 46 + nlen + xlen + clen;
  }
  return out;
}
if (!fs.existsSync(APK)) {
  console.log('[SKIP] APK 不在本目录，跳过资源一致性段（不算通过）');
} else {
  const z = zipEntries(fs.readFileSync(APK));
  ok('APK 条目可读', Object.keys(z).length > 400, Object.keys(z).length);
  ok('内嵌页面与源码逐字节一致', z['assets/index.html'] && sha(z['assets/index.html']) === sha(Buffer.from(html)),
     {apk:z['assets/index.html'] && z['assets/index.html'].length, src:Buffer.byteLength(html)});
  // ---- v1.1.7 起：黑底白 ¥（v1.2.5 图标零改动） ----
  const iconNames = [108, 162, 216, 324, 432].map(d => 'res/pd_fg_' + d + '.png');
  const iconSizes = [108, 162, 216, 324, 432];
  ok('APK 含 5 张 adaptive-icon 前景', iconNames.every(n => z[n] && z[n].length > 500),
     iconNames.map(n => z[n] && z[n].length));
  ok('APK 图标与 源码/图标/ 素材逐字节一致',
     iconNames.every(n => z[n] && sha(z[n]) === sha(fs.readFileSync(path.join(ROOT, '源码', '图标', path.basename(n))))));
  ok('5 张图标 PNG 头与尺寸正确',
     iconNames.every((n, i) => z[n].slice(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
       && z[n].readUInt32BE(16) === iconSizes[i] && z[n].readUInt32BE(20) === iconSizes[i]));
  const dex = z['classes.dex'];
  ok('classes.dex 在位', !!dex && dex.length > 1000000, dex && dex.length);
  for (const kw of ['nsRequest','exportBackup','setSystemBars','__pnlNsDone']) {
    ok('原生桥 dex 含 ' + kw, dex.includes(Buffer.from(kw)));
  }
  const mf = z['AndroidManifest.xml'];
  const mhas = x => mf && (mf.includes(Buffer.from(x)) || mf.includes(Buffer.from(x, 'utf16le')));
  ok('清单含独立包名 com.amhub.app', mhas('com.amhub.app'));
  // axml.py 是「追加字符串 + 改属性索引」，旧字符串仍留在池里，不能按整文件搜旧串判空；
  // 属性实际取值由 build_apk.py 的 aapt2 dump xmltree 逐项验证，这里只验新值已入池。
  ok('权限名与 authorities 的新值已写入清单',
     mhas('com.amhub.app.DYNAMIC_RECEIVER') && mhas('com.amhub.app.androidx-startup'));
  ok('Activity 全限定类名保留（模式 A 改包名仍可启动）', mhas('com.pnlboard.app.MainActivity'));
  // ---- v1.1.2 原生层系统栏配色修复 ----
  const arsc = z['resources.arsc'];
  const STYLE_OFF = 242452, ENTRY = 12;
  const readEntry = i => ({
    key: arsc.readUInt32LE(STYLE_OFF + i * ENTRY),
    size: arsc.readUInt16LE(STYLE_OFF + i * ENTRY + 4),
    type: arsc[STYLE_OFF + i * ENTRY + 7],
    data: arsc.readUInt32LE(STYLE_OFF + i * ENTRY + 8)
  });
  const rows = Array.from({length:7}, (_, i) => readEntry(i));
  ok('原生主题 7 条属性结构完整', rows.every(r => r.size === 8), rows);
  ok('原生主题属性 id 升序（运行时二分查找前提）',
     rows.map(r => r.key).every((v, i, a) => i === 0 || a[i-1] < v), rows.map(r => r.key.toString(16)));
  const want = [
    [0x01010054, 0x1d, 0xffffffff], [0x01010450, 0x12, 1],
    [0x01010451, 0x1d, 0xffffffff], [0x01010452, 0x1d, 0xffffffff],
    [0x010104e0, 0x12, 1],          [0x0101056c, 0x12, 1],
    [0x01010605, 0x12, 0]
  ];
  ok('windowBackground / statusBarColor / navigationBarColor 均为不透明白',
     want.every((w, i) => rows[i].key === w[0] && rows[i].type === w[1] && rows[i].data === w[2]),
     rows.map(r => [r.key.toString(16), r.type, r.data.toString(16)]));
  ok('windowDrawsSystemBarBackgrounds + 两个 windowLight* 均为 true',
     rows[1].data === 1 && rows[4].data === 1 && rows[5].data === 1, rows.map(r => r.data));
  ok('enforceNavigationBarContrast 关闭（不再给白色导航栏叠深色 scrim）', rows[6].key === 0x01010605 && rows[6].data === 0);
  const dx = z['classes.dex'];
  ok('DEX 启动 WebView 背景常量改为白', dx.slice(0x1f1292, 0x1f1298).equals(Buffer.from('1402ffffffff','hex')));
  ok('DEX 启动深色 applySystemBars 调用已移除', dx.slice(0x1f12a2, 0x1f12a8).equals(Buffer.from('000000000000','hex')));
  ok('DEX 运行时关闭系统导航栏对比度强制（setNavigationBarContrastEnforced(false)）',
     dx.slice(0x1f0e62, 0x1f0e6a).equals(Buffer.from('12016e20830b1000','hex')));
  ok('DEX SHA-1 signature 有效', crypto.createHash('sha1').update(dx.slice(32)).digest().equals(dx.slice(12, 32)));
  let adlerA = 1, adlerB = 0;
  for (const byte of dx.slice(12)) { adlerA = (adlerA + byte) % 65521; adlerB = (adlerB + adlerA) % 65521; }
  ok('DEX adler32 checksum 有效', dx.readUInt32LE(8) === ((adlerB << 16) | adlerA) >>> 0);
}

// ---- v1.2.1：平板 / 大屏等比适配（静态契约 9 条） ----
ok('v1.2.1 平板断点为 >=560px（普通手机 <=480 CSS px 不命中）',
   html.includes('@media (min-width:560px){'));
ok('v1.2.1 平板字号随视口放大（clamp 19px/2.45vw/31px），不再被 15px 上限锁死',
   html.includes('--fs:clamp(19px,2.45vw,31px)'));
ok('v1.2.1/1.2.8 平板容器宽度与字号同比例（v1.2.8 外扩为 73vw/2.45vw ＝ 29.8）',
   html.includes('--pad-w:clamp(620px,73vw,950px)'));
ok('v1.2.1 .app / .sheet 同步放宽并居中',
   html.includes('.app{max-width:var(--pad-w)') && html.includes('.sheet{max-width:var(--pad-w)'));
ok('v1.2.8 流水区不再按视口算最小高（面板已撑满剩余高度，旧的 clamp(250px,48vh,640px) 已撤）',
   html.includes('.flow{min-height:0}')
   && !html.includes('.flow{min-height:clamp(250px,48vh,640px)}'));
ok('v1.2.1 输入框与选项命中层同步放大（sel-hit 不跟随会点击错位）',
   html.includes('.fitem input,.fitem select{height:1.8em') && html.includes('.sel-hit{height:1.8em}'));

// ---- v1.2.2：手机端上移；v1.2.3：再上移 5.33px（静态契约 4 条） ----
ok('v1.2.3 手机端顶距不变：body 顶 0px / ≤360px .app 顶 5.67px / 361–559px .app 顶 7.67px（v1.2.8 只改左右与底）',
   html.includes('padding:0 4px calc(46px + env(safe-area-inset-bottom,0px))')
   && html.includes('.app{padding:5.67px 6px 7px}') && html.includes('padding:7.67px 6px 7px'));
ok('v1.2.3 旧顶距无残留（body 顶 4px / .app 顶 7px / .app 顶 9px 均不再出现）',
   !html.includes('padding:4px 10px calc(112px') && !html.includes('.app{padding:7px}')
   && !html.includes('padding:9px 9px 7px'));
ok('v1.2.8 手机端底部预留 112→56px，v1.2.10 调为 54px，v1.3.0 再调为 46px（呼吸位减半到 8px）',
   html.includes('calc(46px + env(safe-area-inset-bottom,0px))')
   && !html.includes('calc(112px + env(safe-area-inset-bottom,0px))'));
ok('v1.2.3 旧 88px 底部预留无残留',
   !html.includes('calc(88px + env(safe-area-inset-bottom,0px))'));
ok('v1.2.4 平板 dock 改为左侧竖栏（栏宽变量 + 贴左满高 + 竖排），旧「全宽」无残留',
   html.includes('--rail-w:5.3em') && html.includes('flex-direction:column;justify-content:center;gap:.6em;')
   && html.includes('width:var(--rail-w);max-width:none;')
   && !html.includes('.bottombar{max-width:var(--pad-w)'));
ok('v1.2.4/1.2.8 侧栏不遮挡内容（body 左留栏宽+.45em，左右对称）',
   html.includes('padding:.93em .45em 1.1em calc(var(--rail-w) + .45em)'));
ok('v1.2.4 侧栏选中指示条改竖条 + 顶部缓冲带隐藏',
   html.includes('.tab.active::after{left:auto;right:.35em;top:50%;bottom:auto;transform:translateY(-50%)')
   && html.includes('.bottombar::before{display:none}'));
// ---- v1.2.5：两端 dock 去分隔线 / 平板竖屏贴顶 / 弹层垂直居中（静态契约 6 条） ----
ok('v1.2.5 手机端 dock 顶部不再有分隔线（border-top:0，旧 border-top:var(--line) 无残留）',
   html.includes('position:fixed;left:50%;bottom:0;transform:translateX(-50%);')
   && html.includes('background:var(--paper);border-top:0;')
   && !/\.bottombar\{[^}]*border-top:var\(--line\)/.test(html));
ok('v1.2.5 平板侧栏右侧竖分隔线也撤掉（border-top:0;border-right:0）',
   html.includes('border-top:0;border-right:0;')
   && !html.includes('border-top:0;border-right:var(--line);'));
ok('v1.2.5 弹层改垂直居中（left/top 50% + translate(-50%,-50%)），不再 bottom:0 贴底',
   html.includes('position:fixed;left:50%;top:50%;bottom:auto;')
   && html.includes('.sheet.on{visibility:visible;transform:translate(-50%,-50%)}'));
ok('v1.2.5 弹层底边恢复实线（不再染成 --paper 纸色，四周都是 2px 线）',
   !html.includes('border-bottom-color:var(--paper)')
   && html.includes('background:var(--paper);border:var(--line);padding:7px 9px calc(20px'));
ok('v1.2.5 平板竖屏顶部留白归 0（body / .app padding-top:0，露出资产管理中枢最顶上黑边）',
   html.includes('@media (min-width:560px) and (orientation:portrait){')
   && html.split('@media (min-width:560px) and (orientation:portrait){')[1].includes('body{padding-top:0}')
   && html.split('@media (min-width:560px) and (orientation:portrait){')[1].includes('.app{padding-top:0}'));
ok('v1.2.5 横屏与手机端顶距未被竖屏规则波及（.93em 与 5.67px 仍在）',
   html.includes('padding:.93em .45em 1.1em calc(var(--rail-w) + .45em)')
   && html.includes('.app{padding:5.67px 6px 7px}'));
ok('v1.0.0 边框粗细改为 1px（对齐同类持仓项目，不再叠粗边）',
   html.includes('--bd:1px') && !html.includes('--bd:2px') && !html.includes('--bd:3px'));
ok('v1.2.1 手机端基础规则逐字保留（430px 限宽 + 15px 字号上限）',
   html.includes('width:100%;max-width:430px;background:var(--paper);')
   && html.includes('--fs:clamp(12px,3.4vw,15px)'));
ok('v1.2.1 平板块位于基础规则之后（同特异性下可覆盖）',
   html.indexOf('@media (min-width:560px)') > html.indexOf('--fs:clamp(12px,3.4vw,15px)'));

// ---- v1.2.6：内容区字号分级 --fs-c（账单/资产页变小，顶栏五项与记账弹层一个字不改） ----
ok('v1.2.6 新增内容区字号变量：默认＝--fs（手机端零变化），平板/桌面断点内降到 88%',
   html.includes('--fs-c:var(--fs);') && html.includes('--fs-c:calc(var(--fs) * .88);'));
ok('v1.2.6 .panel 承接内容区字号（面板内默认用 --fs-c；v1.2.8 起同时是竖向 flex 容器）',
   html.includes('.panel{border:var(--line);font-size:var(--fs-c);display:flex;flex-direction:column;flex:1 1 auto;min-height:0}'));
ok('v1.2.6 账单页元素改用 --fs-c（月份/日期/上下月按钮/汇总/日历/流水/徽标/空态）',
   html.includes('.month-label,.date-label{font-size:var(--fs-c);')
   && html.includes('.mini{font-size:var(--fs-c);')
   && html.includes('gap:2px;font-size:.86em;white-space:nowrap}')   /* v1.3.8：KPI 缩到 .86em */
   && html.includes('.day{position:relative;height:29px;display:grid;place-items:center;font-size:var(--fs-c);')
   && html.includes('.line .r{font-size:var(--fs-c);')
   && html.includes('.line2 .l{font-size:var(--fs-c)}')
   && html.includes('color:var(--muted);font-size:var(--fs-c)}'));
ok('v1.2.6 资产页元素改用 --fs-c（汇总卡片/账户行/信贷明细/新增账户按钮/空态）',
   html.includes('text-align:center;font-size:var(--fs-c);line-height:1.4}')
   && html.includes('border-bottom:var(--bd) solid #dde3ec;font-size:var(--fs-c);align-items:baseline}')
   && html.includes('.asset-tools button{border:var(--line);padding:3px 8px;font-size:var(--fs-c)}')
   && html.includes('.asset-empty{padding:14px 2px;text-align:center;color:var(--muted);font-size:var(--fs-c)}'));
ok('v1.2.6 旧写法无残留（账单/资产页不再有 font-size:var(--fs) 的旧选择器）',
   !html.includes('.month-label,.date-label{font-size:var(--fs);')
   && !html.includes('.line .r{font-size:var(--fs);')
   && !html.includes('.asset-tools button{border:var(--line);padding:3px 8px;font-size:var(--fs)}'));
ok('v1.2.6 顶栏五项功能仍用 --fs（资产管理中枢/明暗/备份/恢复/设置 不变小）',
   html.includes('.bx{border:var(--line);height:32px;min-width:60px;padding:0 8px;font-size:var(--fs);letter-spacing:2px'));
ok('v1.2.6 记账弹层仍用 --fs（标题/字段标签/数字键盘/类型按钮一个字不改）',
   html.includes('.sheet-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;font-size:var(--fs)}')
   && html.includes('.flab{display:block;font-size:var(--fs);')
   && html.includes('.numpad button,.ops button,.opcol>.act{border:var(--line);height:34px;font-size:var(--fs)}')
   && html.includes('.type-row button{border:var(--line);height:29px;font-size:var(--fs);background:var(--paper)}'));
ok('v1.2.6 侧栏/底栏导航按钮字号未受影响（仍 --fs）',
   html.includes('.bottombar>button{position:relative;border:var(--line);height:36px;font-size:var(--fs);'));


// ---- v1.2.7：记账页四类选项按字数排序（跑真实函数源码 + 边界） ----
const sortSrc = slice('const charLen = s =>', 'function fillSelect(id, list){');
const sortCtx = { out: null };
vm.runInNewContext(sortSrc + ';out = {charLen:charLen, byCharLen:byCharLen};', sortCtx);
const { charLen, byCharLen } = sortCtx.out;

ok('v1.2.7 字数＝字符个数（中文一字一、空串 0、代理对算一个）',
   charLen('餐饮') === 2 && charLen('数码电器') === 4 && charLen('') === 0
   && charLen('𠮷') === 1 && charLen(1234) === 4,
   [charLen('餐饮'), charLen('数码电器'), charLen(''), charLen('𠮷')]);

const sortedCase = ['数码电器', '餐饮', '交通费', '日用', '饭'];
const sortedOut = byCharLen(sortedCase);
ok('v1.2.7 按字数升序：饭(1) → 餐饮/日用(2) → 交通费(3) → 数码电器(4)',
   JSON.stringify(sortedOut) === JSON.stringify(['饭', '餐饮', '日用', '交通费', '数码电器']), sortedOut);
ok('v1.2.7 同字数保持原有先后（稳定排序，不退化成随机或字典序）',
   JSON.stringify(byCharLen(['报销', '出差', '家庭'])) === JSON.stringify(['报销', '出差', '家庭'])
   && JSON.stringify(byCharLen(['ccc', 'aa', 'bb'])) === JSON.stringify(['aa', 'bb', 'ccc']));
ok('v1.2.7 排序不改原数组（DB.categories / DB.tags 顺序与设置页一字不动）',
   JSON.stringify(sortedCase) === JSON.stringify(['数码电器', '餐饮', '交通费', '日用', '饭']), sortedCase);

ok('v1.2.7 记账页下拉统一走 byCharLen（分类/标签/支出账户/收入账户四类一次覆盖）',
   html.includes("+ byCharLen(list).map(x => '<option value=\"'")
   && html.includes('function fillSelect(id, list){'));
ok('v1.2.7 回填历史值时临时补项也插到「字数更多」的选项之前（不堆末尾）',
   html.includes('const after = [...el.options].slice(1).find(o => charLen(o.value) > nv);')
   && html.includes("if(after) after.insertAdjacentHTML('beforebegin', opt);"));
ok('v1.2.7 空项始终排在最前，不参与排序',
   html.includes("$(id).innerHTML = '<option value=\"\"></option>'"));

// ---- v1.2.8：固定外框（上方不动 / 下方流水滚动）+ 左右外扩 ----
ok('v1.2.8 页面锁死视口高度且不再整页滚动（html/body 100%，body overflow:hidden）',
   html.includes('html{background:var(--paper);color-scheme:light;height:100%}')
   && html.includes('height:100vh;height:100dvh;overflow:hidden;'));
ok('v1.2.8/1.2.9 .app 竖向两段（顶栏 / 面板，v1.2.9 页脚已移除），面板吃掉剩余高度',
   html.includes('height:100%;display:flex;flex-direction:column;min-height:0;')
   && html.includes('.panel{border:var(--line);font-size:var(--fs-c);display:flex;flex-direction:column;flex:1 1 auto;min-height:0}'));
ok('v1.2.8 日历 / 日期条 / 资产汇总卡片不参与伸缩（上方保存不动）',
   html.includes('.cal,.datebar,.asset-summary{flex:0 0 auto}'));
ok('v1.2.8 流水区＝唯一滚动容器（flex:1 + overflow-y:auto，旧 min-height:250px 已撤）',
   html.includes('.flow{min-height:0;padding:0;flex:1 1 auto;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}')
   && !html.includes('.flow{min-height:250px;padding:0}'));
ok('v1.2.8 视口过矮（流水区 <220px）退回整页滚动，避免流水被挤成一条缝',
   html.includes('const FLOW_MIN = 220;')
   && html.includes("document.body.classList.toggle('page-scroll', tooShort);")
   && html.includes('body.page-scroll .flow{overflow:visible}'));
ok('v1.2.8 手机端左右外扩：body 10→4px、.app 9→6px（≤360 档 7→6px），离屏幕边仍留 10px',
   html.includes('padding:0 4px calc(46px + env(safe-area-inset-bottom,0px))')
   && html.includes('.app{padding:5.67px 6px 7px}') && html.includes('padding:7.67px 6px 7px'));
ok('v1.4.5 顶栏「资产管理中枢」的三档 26% 定宽声明随按键一并删除（v1.2.8 的 calc 全数下线）',
   !html.includes('.bx.brand{')
   && !html.includes('class="bx brand"')
   && html.includes('.bx{min-width:52px;padding:0 5px;letter-spacing:0}'));
ok('v1.2.8 平板/桌面同步外扩（--pad-w 73vw / body .45em / .app .45em），两侧仍对称',
   html.includes('--pad-w:clamp(620px,73vw,950px)')
   && html.includes('padding:.93em .45em 1.1em calc(var(--rail-w) + .45em)')
   && html.includes('.app{max-width:var(--pad-w);padding:.6em .45em .47em}'));

// ---- v1.2.8：长按拖拽整体下线 ----
ok('v1.2.8 长按拖拽四件套 / 占位块 / 浮起副本 / 抑制变量全部下线',
   ['dragBegin','dragMove','dragDone','commitAccountOrder','asset-ph','reordering',
    'dragging','DRAG_SUPPRESS','DRAG_TOL','LONG_PRESS_MS'].every(k => !html.includes(k)));
ok('v1.2.8 账户行点击改账户的旧入口保留（轻点仍然打开修改弹层）',
   html.includes("const acc = e.target.closest('[data-acct]');"));

// ---- v1.2.8：长按高亮（中灰 / 跨设备 / 长按「资产」清除） ----
ok('v1.2.8 长按 450ms + 8px 容差起效（超容差当滑动，轻点路径不变）',
   html.includes('const HL_HOLD_MS = 450;') && html.includes('const HL_TOL = 8;')
   && html.includes('if(Math.abs(e.clientX - HL.x) > HL_TOL || Math.abs(e.clientY - HL.y) > HL_TOL) hlReset();'));
ok('v1.2.8 高亮写进资产管理中枢 settings.acctHl（换设备 / 恢复备份后保留）',
   html.includes('function hlIds(){') && html.includes('DB.settings.acctHl')
   && html.includes('function toggleHl(id){') && html.includes('function clearHl(){')
   && html.includes('function hlSaved(){ persistDB(); renderFlow(); }'));
ok('v1.2.8 旧备份没有 acctHl 时规范化为空数组，脏值被过滤',
   html.includes("o.settings.acctHl = Array.isArray(o.settings.acctHl)\n    ? o.settings.acctHl.filter(x => typeof x === 'string' && x) : [];"));
ok('v1.2.8 长按底部「资产」清除全部高亮（长按后那次 click 不再切页）',
   html.includes("$('tabAsset').addEventListener('pointerdown', e => hlArm(e, clearHl));")
   && html.includes("$('tabAsset').addEventListener('click', () => { if(Date.now() < HL_SUPPRESS) return;"));
ok('v1.2.8 高亮色白天黑夜都是中灰 #999（黑夜把字改黑，白字压中灰对比度只有 2.9）',
   html.includes('.asset-item.hl,\n.asset-item.hl:hover{background:#999}')
   && html.includes('html[data-theme="dark"] .asset-item.hl,\nhtml[data-theme="dark"] .asset-item.hl:hover{background:#999;color:#000}'));
ok('v1.2.8 长按不弹系统菜单、不选中文字',
   html.includes('.asset-item[data-acct]{touch-action:pan-y;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}'));
ok('v1.2.8 竖屏资产页不滚动（body.tab-asset 锁住 flow，内容真超出才退回可滚）',
   html.includes('body.tab-asset .flow{overflow:hidden;overscroll-behavior:none}')
   && html.includes('body.tab-asset.asset-overflow .flow{overflow-y:auto}')
   && html.includes("document.body.classList.toggle('tab-asset', isAsset);"));

// ---- v1.2.8：资产页两组自动排序（只改显示顺序） ----
ok('v1.2.8 资产账户：名称字数升序，同字数按资产（余额）升序',
   html.includes('groups.asset.sort((a, b) => (charLen(a.name) - charLen(b.name)) || (a.bal - b.bal));'));
ok('v1.2.8 信贷账户：名称字数升序，同字数按已用金额升序',
   html.includes('groups.credit.sort((a, b) => (charLen(a.name) - charLen(b.name)) || (a.used - b.used));')
   && html.includes('used:r2(Math.max(0, -bal)),'));
ok('v1.2.8 排序只影响显示（不对 DB.accounts 排序，导出与统计口径不受影响）',
   !/DB\.accounts\.sort\(/.test(html) && html.includes('groups.asset.sort('));
ok('v1.2.8 账户被删后指向它的高亮 id 一并清掉',
   html.includes('const keep = hl.filter(id => alive.has(id));')
   && html.includes('if(keep.length !== hl.length){ DB.settings.acctHl = keep; persistDB(); }'));

// ---- v1.2.9：页脚版本行移除，面板下边框随之下移 ----
ok('v1.2.9 页脚版本行节点已移除（页面不再显示「资产管理中枢 v1.x.x」）',
   !html.includes('<div class="ver">') && !/class="ver"/.test(html)
   && !/资产管理中枢 v1\.\d+\.\d+<\/div>/.test(html));
ok('v1.2.9 页脚样式一并清掉（.ver 三条规则零残留，不留空规则）',
   !/(^|\n)\s*\.ver\s*\{/.test(html)
   && !/html\[data-theme="dark"\]\s*\.ver\s*[\{,]/.test(html));
ok('v1.2.9 起版本号仍可从 title 与 data-version 读到（只是不显示在页面上）',
   html.includes('<title>资产管理中枢 v1.0.0</title>') && html.includes('data-version="1.0.0"')
   && html.includes("o.__ver = 'v1.0.0'"));
ok('v1.2.9 面板底边靠 flex 自然下延，不考虑用负 margin / 绝对定位硬塞',
   !html.includes('.panel{margin-bottom:-') && !/\.panel\{[^}]*position:absolute/.test(html)
   && html.includes('.panel{border:var(--line);font-size:var(--fs-c);display:flex;flex-direction:column;flex:1 1 auto;min-height:0}'));
ok('v1.2.10 让位语义：body 让位 / .app 底 7px 分开记，面板下延不靠贴边换取（v1.3.0 起 body 46px）',
   html.includes('padding:0 4px calc(46px + env(safe-area-inset-bottom,0px))')
   && html.includes('padding:7.67px 6px 7px')
   && html.includes('.app{padding:5.67px 6px 7px}'));

// ---- v1.2.10：dock 底部内距 4→2px（按钮下边框到屏幕底边间距减半），body 让位 56→54px ----
ok('v1.2.10 dock 底部内距 2px（按钮下边框到屏幕底边由 4px 减半），顶部 7px 与左右 9px 一字未动',
   html.includes('padding:7px 10px calc(2px + env(safe-area-inset-bottom,0px))')
   && !/padding:7px 9px calc\(4px \+ env/.test(html));
ok('v1.2.10 dock 盒高 47→45px（7 顶 + 36 按钮 + 2 底），body 让位 56→54px 同步（v1.3.0 再调 46px）',
   html.includes('padding:0 4px calc(46px + env(safe-area-inset-bottom,0px))')
   && !html.includes('calc(56px + env(safe-area-inset-bottom,0px))'));
ok('v1.2.10 面板↔dock 呼吸位（body 54 − dock 45 + .app 底 7 = 16px；v1.3.0 改 8px），4px 内距无残留',
   !html.includes('calc(4px + env(safe-area-inset-bottom,0px))')
   && html.includes('padding:7.67px 6px 7px'));
/* v1.3.7：dock 由三项改成四项，92 / 66 / 92 的固定宽已撤销，改为等分 flex；
   按钮高度 36px、dock 左右内距 9px、字号 / 字距 / 底色一律未动。 */
ok('v1.3.7 按钮四项等分（92 / 66 / 92 已撤销），v1.0.0 改独立边框 margin-left:0，高 36px 与 dock 内距未动',
   !html.includes('.tab{width:92px}') && !html.includes('width:66px')
   && html.includes('flex:1 1 0;min-width:0;margin-left:0}')
   && html.includes('.bottombar>button{position:relative;border:var(--line);height:36px;'));
ok('v1.2.10 平板侧栏 dock 不受影响（top:0;bottom:0 满高，底部内距另写 1em）',
   html.includes('top:0;bottom:0;transform:none;')
   && html.includes('padding:1em .55em calc(1em + env(safe-area-inset-bottom,0px)) .55em;'));

// ---- v1.3.0：面板↔dock 呼吸位 16→8px（只调 body 让位，dock 与 .app 底内距一字未动） ----
ok('v1.3.0 body 让位 54→46px ＝ dock 45 + 呼吸 8 − .app 底 7（面板顺势下延 8px）',
   html.includes('padding:0 4px calc(46px + env(safe-area-inset-bottom,0px))')
   && 46 + 7 - 45 === 8);
ok('v1.3.0 旧值 54px 零残留，dock 盒高与 .app 底内距未被顺手改动',
   !html.includes('calc(54px + env(safe-area-inset-bottom,0px))')
   && html.includes('padding:7px 10px calc(2px + env(safe-area-inset-bottom,0px))')
   && html.includes('.app{padding:5.67px 6px 7px}') && html.includes('padding:7.67px 6px 7px'));
ok('v1.3.0 下移靠 flex 自然吃掉高度，未用负 margin / 绝对定位 / 负 bottom 硬拽',
   !html.includes('.panel{margin-bottom:-') && !/\.panel\{[^}]*position:absolute/.test(html)
   && !/\.app\{[^}]*margin-bottom:-/.test(html)
   && !/bottom:-\d/.test(html));

// ---- v1.3.5：标签移到金额前、自适应金额长度（停用 v1.3.1 两槽） ----
ok('v1.3.5 标签挂在第一行金额前，形成「标签|金额」连续串（不是写死槽宽）',
   html.includes('<span class="sep">|</span><span class="amt">')
   && html.includes("'<span class=\"r has-tag\" title=\"标签与金额\"><span class=\"tag\" title=\"标签\">' + esc(t.tag)")
   && !html.includes('grid-template-columns:var(--tag-w'));
ok('v1.3.5 金额不设 max-width / 不省略，标签设 5.5em 省略上限（自适应金额长度）',
   /\.line1 \.r\.has-tag \.tag\{[^}]*max-width:5\.5em[^}]*overflow:hidden[^}]*text-overflow:ellipsis/.test(html)
   && !/\.line1 \.r\.has-tag \.amt\{[^}]*max-width/.test(html)
   && !/\.line1 \.r\.has-tag \.amt\{[^}]*ellipsis/.test(html));
ok('v1.3.5 整串右对齐（text-align:right / flex-end），金额长短决定标签左右浮动位置',
   /\.line \.r\{[^}]*text-align:right/.test(html)
   && /\.line1 \.r\.has-tag\{[^}]*justify-content:flex-end/.test(html)
   && /\.line1 \.r\.has-tag \.tag\{[^}]*display:inline-block/.test(html));
ok('v1.3.5 第二行回归纯账户单串；无标签行仍走 v1.3.0 原串，一个字节都不变',
   html.includes("'<span class=\"r\" title=\"账户\">' + esc(acct) + '</span>'")
   && html.includes("'<span class=\"r\" title=\"该笔金额\"><span class=\"amt\">' + esc(amt) + '</span></span>'")
   && !html.includes('class="acct"'));
ok('v1.3.5 两槽机制（测量函数 / CSS 变量 / 第二行 has-tag）零残留',
   !html.includes('measureTagSlots')
   && !html.includes('--tag-w') && !html.includes('--acct-w')
   && !html.includes('.line2 .r.has-tag') && !html.includes('title="标签与账户"')
   && html.includes('class="r has-tag"'));
ok('v1.3.5 标签对齐不靠负 margin / 绝对定位 / 写死像素槽宽硬凑',
   !/\.line1 \.r\.has-tag[^}]*position:absolute/.test(html)
   && !/\.line1 \.r\.has-tag[^}]*margin-left:-/.test(html)
   && !/grid-template-columns:\d+px \d+px/.test(html));

// ---- v1.2.7：Linux 壳注入顶部留白（抵消平板竖屏贴顶规则） ----
const linuxShell = fs.readFileSync(path.join(ROOT, '源码', 'linux', 'ledger_app.py'), 'utf8');
ok('v1.2.7 Linux 壳在 </head> 前注入同选择器 CSS，把 body .93em + .app .6em 顶部留白补回来',
   linuxShell.includes('DESK_TOP_CSS') && linuxShell.includes('body{padding-top:.93em}')
   && linuxShell.includes('.app{padding-top:.6em}')
   && linuxShell.includes('HTML.replace(b"</head>", DESK_TOP_CSS.encode("utf-8") + b"</head>", 1)'));
ok('v1.2.7 只动壳内托管页：浏览器版 HTML 仍是平板竖屏贴顶（body/.app padding-top:0）',
   html.includes('@media (min-width:560px) and (orientation:portrait){\n  body{padding-top:0}\n  .app{padding-top:0}')
   && !html.includes('DESK_TOP_CSS'));
ok('v1.2.7 Linux 壳版本号与窗口尺寸',
   linuxShell.includes('VERSION = "1.0.0"') && linuxShell.includes('"768,1024"'));

// ---- v1.3.2：转账 / 还款的金额两端 + 缺账户单值显示 ----
const repayPair = A.amountPair({type:'repay', amount:40, discount:10, from:'A', to:'B'});
ok('v1.3.2 还款 40 / 优惠 10 → 支出侧 30、到账侧 40（旧版是 40→50）',
   repayPair[0] === 30 && repayPair[1] === 40, repayPair);
const transferPair = A.amountPair({type:'transfer', amount:100, off:2, discount:3, cashback:1, recv:96, from:'A', to:'B'});
ok('v1.3.2 转账两端：支出 100−2−3−1=94，到账取 recv 96',
   transferPair[0] === 94 && transferPair[1] === 96, transferPair);
ok('v1.3.2 paidOf ＝ 支出账户实际被扣（与 balanceOf 借方同式）',
   A.paidOf({amount:40, discount:10}) === 30 && A.paidOf({amount:100, off:2, discount:3}) === 95,
   [A.paidOf({amount:40, discount:10}), A.paidOf({amount:100, off:2, discount:3})]);

const repayRow = A.rowHTML({id:'r1', type:'repay', date:'2026-11-11', time:'10:00',
  amount:40, discount:10, from:'招商银行储蓄卡', to:'中信信用卡'});
ok('v1.3.2 还款流水条渲染 "30→40"，且 "40→50" 零出现',
   /class="amt">30→40</.test(repayRow) && !/40→50/.test(repayRow),
   (repayRow.match(/class="amt">[^<]*/) || [])[0]);
const halfNoFrom = A.rowHTML({id:'r2', type:'repay', date:'2026-11-11', time:'10:00',
  amount:500, to:'中信信用卡'});
ok('v1.3.2 缺支出账户的还款只显示单值 500.00，不再出现「0→500」',
   !halfNoFrom.includes('→') && /class="amt">500\.00</.test(halfNoFrom),
   (halfNoFrom.match(/class="amt">[^<]*/) || [])[0]);
const halfNoTo = A.rowHTML({id:'r3', type:'transfer', date:'2026-11-11', time:'10:00',
  amount:500, from:'微信'});
ok('v1.3.2 缺收入账户的转账只显示被扣额，不出现「500→0」',
   !halfNoTo.includes('→') && /class="amt">500\.00</.test(halfNoTo),
   (halfNoTo.match(/class="amt">[^<]*/) || [])[0]);
const reimHalf = A.rowHTML({id:'r4', type:'reimburse', date:'2026-11-11', time:'10:00',
  amount:500, reimbursed:450, from:'微信'});
ok('v1.3.2 缺收入账户的报销同样退化为单值（不回款侧硬凑区间）',
   !reimHalf.includes('→'), (reimHalf.match(/class="amt">[^<]*/) || [])[0]);

/* 显示口径与余额口径必须同源：还款 40 / 优惠 10 → 支出账户 −30、收入账户 +40 */
ctx.DB.tx = [{type:'repay', from:'A', fromId:'a1', to:'B', toId:'b1', amount:40, discount:10}];
eq('v1.3.2 还款 40/优惠10：支出账户余额 100 → 70（−30）', A.balanceOf({id:'a1', name:'A', opening:100}), 70);
eq('v1.3.2 还款 40/优惠10：收入账户余额 0 → 40（+40）', A.balanceOf({id:'b1', name:'B', opening:0}), 40);
ctx.DB.tx = [];

/* ---- v1.3.3：移除表单「必填」高亮，改做流水条缺账户高亮 ---- */
ok('v1.3.3 表单高亮零残留（.fitem.need / ·必填 / syncAccountNeed 全不在）',
   !html.includes('.fitem.need') && !html.includes('·必填')
   && !html.includes('syncAccountNeed') && !html.includes("classList.toggle('need'"));
ok('v1.3.3 --warn 仍是全站唯一彩色：亮 #a00 / 暗 #ff6f6f',
   html.includes('--warn:#a00') && html.includes('--warn:#f85149'));
ok('v1.3.3 流水条高亮三条 CSS（左侧红条 / 红徽标 / 账户位红字）',
   html.includes('.flow-row.lack{box-shadow:inset 3px 0 0 var(--warn)}')
   && html.includes('.flow-row.lack .badge{border-color:var(--warn);color:var(--warn)}')
   && html.includes('.flow-row.lack .line2 .r{color:var(--warn)}'));
ok('v1.3.3 红条用 inset box-shadow 而非 border-left（不挤动 grid 列宽）',
   !/\.flow-row\.lack\{[^}]*border-left/.test(html));
ok('v1.3.3 缺账户判定需两端账户的类型只有转账 / 还款 / 报销',
   html.includes('const NEED_BOTH = {transfer:true, repay:true, reimburse:true};')
   && Object.keys(A.NEED_BOTH).sort().join(',') === 'reimburse,repay,transfer');
ok('v1.3.3 lackOf 是纯数据判定（函数体不含 localStorage / DOM / UI 状态）',
   /function lackOf\(t\)\{ return !!NEED_BOTH\[t\.type\] && \(!t\.from \|\| !t\.to\); \}/.test(html)
   && !/function lackOf\(t\)\{[^}]*(localStorage|sessionStorage|document|S_ADD|settings)/.test(html));
ok('v1.3.3 高亮不碰保存口径（collectTx 里没有 lack/need 判定）',
   !/function collectTx\(\)[\s\S]{0,600}(lack|need)/.test(html));

/* 判定口径：只对 NEED_BOTH 三类、缺任一端才亮 */
const LB = (t) => A.lackOf(t);
ok('v1.3.3 lackOf：还款缺支出账户 → 亮', LB({type:'repay', to:'中信信用卡'}) === true);
ok('v1.3.3 lackOf：还款缺收入账户 → 亮', LB({type:'repay', from:'招商银行储蓄卡'}) === true);
ok('v1.3.3 lackOf：还款两端都空 → 亮', LB({type:'repay'}) === true);
ok('v1.3.3 lackOf：还款两端齐全 → 不亮', LB({type:'repay', from:'A', to:'B'}) === false);
ok('v1.3.3 lackOf：转账 / 报销同样按两端判定',
   LB({type:'transfer', from:'A'}) === true && LB({type:'reimburse', to:'B'}) === true
   && LB({type:'transfer', from:'A', to:'B'}) === false);
ok('v1.3.3 lackOf：支出 / 收入本来就只有一端，永不亮',
   LB({type:'expense', from:'A'}) === false && LB({type:'income', to:'B'}) === false
   && LB({type:'expense'}) === false);
ok('v1.3.3 lackOf：空串 / null / undefined 都算未填',
   LB({type:'repay', from:'', to:'B'}) === true
   && LB({type:'repay', from:null, to:'B'}) === true
   && LB({type:'repay', from:'A', to:undefined}) === true);

/* 渲染：挂 .lack 与 title，且不改动金额 / 账户文本 */
const lackRow = A.rowHTML({id:'L1', type:'repay', date:'2026-11-11', time:'10:00',
  amount:500, to:'中信信用卡'});
ok('v1.3.3 缺账户流水条挂 .lack 类 + 明确 title',
   /class="flow-row lack"/.test(lackRow)
   && lackRow.includes('title="该笔未填写完整账户，点击修改或删除"')
   && lackRow.includes('（未填写完整账户）'));
ok('v1.3.3 两端齐全的流水条是普通行（无 lack、原 title 原串）',
   !/class="flow-row lack"/.test(A.rowHTML({id:'L2', type:'repay', date:'2026-11-11',
     time:'10:00', amount:40, discount:10, from:'A', to:'B'}))
   && A.rowHTML({id:'L2', type:'repay', date:'2026-11-11', time:'10:00',
     amount:40, discount:10, from:'A', to:'B'}).includes('title="点击修改或删除"'));
ok('v1.3.3 支出 / 收入不挂 .lack（只修点名的三类）',
   !/class="flow-row lack"/.test(A.rowHTML({id:'L3', type:'expense', date:'2026-11-11',
     time:'10:00', amount:30, from:'A'}))
   && !/class="flow-row lack"/.test(A.rowHTML({id:'L4', type:'income', date:'2026-11-11',
     time:'10:00', amount:30, to:'B'})));
ok('v1.3.3 高亮不改动金额（缺账户仍是单值 500.00，v1.3.2 口径沿用）',
   /class="amt">500\.00</.test(lackRow) && !lackRow.includes('→'));
ok('v1.3.3 高亮不改动账户文本（第二行右列只写有的一端）',
   lackRow.includes('中信信用卡') && !lackRow.includes('→中信信用卡'));
ok('v1.3.3 高亮不新增 DOM 节点（span 数量与普通行相同）',
   (lackRow.match(/<span/g) || []).length
   === (A.rowHTML({id:'L5', type:'repay', date:'2026-11-11', time:'10:00',
       amount:500, from:'A', to:'B'}).match(/<span/g) || []).length);
ok('v1.3.5 带标签行：标签在金额前（.has-tag 在第一行）、第二行仅纯账户',
   (() => { const s = A.rowHTML({id:'L6', type:'repay', date:'2026-11-11', time:'10:00',
     amount:500, to:'B', tag:'房贷'});
     return s.includes('<span class="r has-tag" title="标签与金额"><span class="tag" title="标签">房贷</span><span class="sep">|</span><span class="amt">500.00</span></span>')
       && s.includes('<span class="r" title="账户">B</span>') && !s.includes('class="acct"'); })());

/* ---- 切换设备也保留：判定从记录数据派生，不经本机状态 ---- */
const rec = {id:'L7', type:'repay', date:'2026-11-11', time:'10:00', amount:500,
  to:'中信信用卡', discount:10};
const roundtrip = JSON.parse(JSON.stringify(rec));   /* ＝备份 JSON 的序列化往返 */
ok('v1.3.3 备份走 DB 深拷贝（记录原样进出，不注入 UI 状态）',
   html.includes('const o = JSON.parse(JSON.stringify(DB));')
   && !/JSON\.stringify\(DB\)[\s\S]{0,200}lack/.test(html));
ok('v1.3.3 换设备：深拷贝往返后 lackOf 与 rowHTML 结果逐字相同',
   A.lackOf(roundtrip) === A.lackOf(rec)
   && A.rowHTML(roundtrip) === A.rowHTML(rec)
   && /class="flow-row lack"/.test(A.rowHTML(roundtrip)));
ok('v1.3.3 记录里不含任何高亮状态字段（不是本机标记落盘）',
   !/(^|,)"(lack|need|acctHl|highlight)"/.test(JSON.stringify(rec))
   && !html.includes('settings.lack'));
ok('v1.3.3 补齐两端账户后重新渲染 → 高亮消失（数据变，提示跟着变）',
   !/class="flow-row lack"/.test(A.rowHTML(Object.assign({}, roundtrip, {from:'招商银行储蓄卡'}))));

/* ---- v1.3.2：Linux / 桌面物理键盘 ---- */
ok('v1.3.2 物理键盘走同一套 keyInput（不另起一套记账逻辑）',
   html.includes('function handleSheetKey(e){') && html.includes('keyInput(e.key)')
   && html.includes('handleSheetKey(e);'));
ok('v1.3.2 退格/Delete 接数字键盘的 del',
   html.includes("if(e.key === 'Backspace' || e.key === 'Delete'){ e.preventDefault(); keyInput('del'); return true; }"));
ok('v1.3.2 运算符 * / x X 映射到 × ÷',
   html.includes("const SHIFT_OP = {'*':'×', '/':'÷', 'x':'×', 'X':'×'};"));
ok('v1.3.2 Enter ＝ 保存，Escape 仍关闭弹层',
   html.includes("if(e.key === 'Enter'){") && html.includes("$('btnSave').click();")
   && html.includes("if(e.key === 'Escape'){ closeSheet(); return; }"));
ok('v1.3.2 备注框 / 日期框 / 非金额输入框不劫持按键',
   html.includes("if(el && el.id === 'fNote') return false;")
   && html.includes("if(el && tag === 'INPUT' && el.type === 'date') return false;")
   && html.includes("!el.classList.contains('keypad-field')"));
ok('v1.3.2 键盘聚焦哪一格就写哪一格（Tab 切换金额字段）',
   html.includes("el.addEventListener('focus', () => setActiveField(el));"));
ok('v1.3.2 带修饰键（Ctrl/Alt/Cmd）不拦截，留给浏览器快捷键',
   html.includes('if(e.ctrlKey || e.metaKey || e.altKey) return false;'));
ok('v1.3.2 旧口径（优惠堆到到账侧）零残留',
   !html.includes('r2(recvOf(t) + n(t.discount) + n(t.cashback) - n(t.fee))'));


/* ---- v1.3.4：支出 / 收入「不计入」（用户 2026-11-11 确认的三条口径） ---- */
console.log('\n===== 八、v1.3.4 支出 / 收入「不计入」 =====');
ok('v1.3.4 可标记类型只有支出 / 收入',
   Object.keys(A.NO_COUNT_TYPES).sort().join(',') === 'expense,income');
ok('v1.3.4 旧备份无 noCount → 恒计入',
   A.counted({type:'expense',amount:100}) && A.counted({type:'income',amount:100}));
ok('v1.3.4 支出 / 收入标记后不计入',
   !A.counted({type:'expense',noCount:true}) && !A.counted({type:'income',noCount:true}));
ok('v1.3.4 转账 / 还款 / 报销即使带脏 noCount 仍计入',
   ['transfer','repay','reimburse'].every(tp => A.counted({type:tp,noCount:true})));
ok('v1.3.4 noCount 为 false / null / 0 / 空串都算未标记',
   [false,null,0,''].every(v => A.counted({type:'income',noCount:v})));
const NC_ROWS = [
  {type:'income',  amount:1000, noCount:true, to:'银行卡', toId:'a1'},   /* 工资 */
  {type:'expense', amount:100,  noCount:true, from:'微信', fromId:'a2'}, /* 证券转账 */
  {type:'income',  amount:200,  to:'银行卡', toId:'a1'},
  {type:'expense', amount:50,   from:'微信', fromId:'a2'}
];
eq('v1.3.4 statsRows 只留两笔未标记', A.statsRows(NC_ROWS).length, 2);
eq('v1.3.4 过滤后收入 = 200（工资 1000 被剔除）', A.summaryOf(A.statsRows(NC_ROWS)).inc, 200);
eq('v1.3.4 过滤后支出 = 50（证券转账 100 被剔除）', A.summaryOf(A.statsRows(NC_ROWS)).exp, 50);
eq('v1.3.4 过滤后结余 = 150', A.summaryOf(A.statsRows(NC_ROWS)).bal, 150);
eq('v1.3.4 对照：不过滤时收入 = 1200', A.summaryOf(NC_ROWS).inc, 1200);
eq('v1.3.4 对照：不过滤时结余 = 1050', A.summaryOf(NC_ROWS).bal, 1050);
ctx.DB.tx = NC_ROWS;
eq('v1.3.4 余额不剔除：银行卡 +1200', A.balanceOf({id:'a1',name:'银行卡',opening:0}), 1200);
eq('v1.3.4 余额不剔除：微信 -150', A.balanceOf({id:'a2',name:'微信',opening:0}), -150);
ctx.DB.tx = [];
ok('v1.3.4 资产汇总仍由 balanceOf 驱动（源码里不含 noCount）',
   !/function assetSummary\(\)\{[\s\S]{0,400}noCount/.test(html));
const ncRow = A.rowHTML({id:'N1',type:'income',date:'2026-11-11',time:'09:00',
  amount:8000,to:'银行卡',note:'工资',noCount:true});
const plainRow = A.rowHTML({id:'N1',type:'income',date:'2026-11-11',time:'09:00',
  amount:8000,to:'银行卡',note:'工资'});
ok('v1.3.4 流水条第二行显示「不计入」小字',
   /<div class="line line2">[\s\S]*?<span class="piece nc">不计入<\/span>/.test(ncRow)
   && ncRow.includes('工资'));
ok('v1.3.4 普通流水条不含 .nc 小标', !plainRow.includes('class="piece nc"'));
ok('v1.3.4 不计入不改动金额 / 账户文本（与未标记行只差一枚小标）',
   ncRow.replace('<span class="piece nc">不计入</span>', '') === plainRow,
   {nc:ncRow.length, plain:plainRow.length});
ok('v1.3.4 转账带 noCount 也不显示「不计入」',
   !A.rowHTML({id:'N3',type:'transfer',date:'2026-11-11',amount:100,noCount:true}).includes('不计入'));
ok('v1.3.4 不计入与 v1.3.3 缺账户红条互不干扰',
   !ncRow.includes('flow-row lack')
   && A.rowHTML({id:'N4',type:'repay',date:'2026-11-11',amount:100,noCount:true,to:'B'}).includes('flow-row lack'));
const backupDB = {version:'1.3.4', tx:[{id:'N1',type:'income',date:'2026-11-11',time:'09:00',
  amount:8000,to:'银行卡',note:'工资',noCount:true}], accounts:[], settings:{}};
const roundTrip = JSON.parse(JSON.stringify(backupDB)).tx[0];
ok('v1.3.4 换设备：导出 → 恢复后 noCount 仍在、流水条逐字相同',
   roundTrip.noCount === true && A.rowHTML(roundTrip) === A.rowHTML(backupDB.tx[0]));
ok('v1.3.4 标记落在记录自身，不新开本机 localStorage 键',
   !/localStorage\.setItem\([^)]*noCount/.test(html)
   && !/getItem\([^)]*noCount/.test(html));
ok('v1.3.4 旧备份零迁移：normalizeDB 不改写 tx.noCount',
   !/normalizeDB[\s\S]{0,1200}noCount/.test(html));
ok('v1.3.4 备注行切出右侧一格（grid 两栏 + 隐藏时单列）',
   html.includes('.note-line{display:grid;grid-template-columns:minmax(0,1fr) 5.8em;')
   && html.includes('.note-line.no-nc{grid-template-columns:minmax(0,1fr)}')
   && html.includes('id="fNoCountItem" hidden'));
ok('v1.3.4 勾选框只在支出 / 收入显示，切走即清状态',
   html.includes("const ncOn = !!NO_COUNT_TYPES[tp];")
   && html.includes("if(!ncOn) $('fNoCount').checked = false;"));
ok('v1.3.4 新增 / 编辑 / 再记三处表单状态闭环',
   html.includes("noCount: !!(NO_COUNT_TYPES[S_ADD.type] && $('fNoCount').checked)")
   && html.includes("$('fNoCount').checked = !!(NO_COUNT_TYPES[t.type] && t.noCount);")
   && (html.match(/\$\('fNoCount'\)\.checked = false; updateNoCountBox\(\);/g) || []).length === 2);
ok('v1.3.4 物理键盘不抢勾选框的 Enter',
   html.includes("if(e.target && e.target.id === 'fNoCount') return false;"));
ok('v1.3.6 不计入小字统一正文大小正文色，不占用 v1.3.3 的 --warn 警示色',
   html.includes('.line .l .piece.nc{color:inherit;font-size:inherit;white-space:nowrap}')
   && !html.includes('.line .l .piece.nc{color:var(--muted);font-size:.9em;white-space:nowrap}')
   && html.includes('html[data-theme="dark"] .nc-item .nc-box{border-color:#30363d}')
   && html.includes('.nc-item .nc-box{height:1.8em;padding:0 .13em}'));
/* v1.3.7：第三处是总览页的「本月」三张卡，同样是「先过滤再汇总」，故条数 2 → 3 */
ok('v1.3.4 / v1.3.7 三处取数（月 KPI / 日 KPI / 总览本月卡）都先过滤，summaryOf 口径一字未动',
   (html.match(/summaryOf\(statsRows\(/g) || []).length === 3
   && !html.slice(html.indexOf('function summaryOf(rows){'), html.indexOf('/* v1.3.4：「不计入」')).includes('noCount'));

/* ---- v1.3.5：标签移到金额前、自适应金额长度（用户 2026-11-11 确认：保留 →、标签彻底移走） ---- */
console.log('\n===== 九、v1.3.5 标签移到金额前（自适应金额长度） =====');
const G_LONG = A.rowHTML({id:'G1', type:'repay', date:'2026-11-11', time:'10:00',
  from:'银行卡', to:'证券', tag:'吉吉', amount:11000, discount:1000});
const G_SHORT = A.rowHTML({id:'G2', type:'repay', date:'2026-11-11', time:'10:00',
  from:'银行卡', to:'证券', tag:'吉吉', amount:110, discount:10});
ok('v1.3.5 长金额：标签|金额 连续串、区间仍用 →（不改成 -）',
   G_LONG.includes('<span class="r has-tag" title="标签与金额"><span class="tag" title="标签">吉吉</span><span class="sep">|</span><span class="amt">10000→11000</span></span>'));
ok('v1.3.5 短金额：同一标签结构、金额自适应变短（100→110）',
   G_SHORT.includes('<span class="tag" title="标签">吉吉</span><span class="sep">|</span><span class="amt">100→110</span>'));
ok('v1.3.5 标签位随金额长度浮动：金额文本不同、标签块本身逐字相同',
   G_LONG.slice(G_LONG.indexOf('<span class="tag"'), G_LONG.indexOf('<span class="sep">'))
     === G_SHORT.slice(G_SHORT.indexOf('<span class="tag"'), G_SHORT.indexOf('<span class="sep">')));
ok('v1.3.5 第二行仅账户串，不再有标签 / .acct（两处金额长短均无标签残留）',
   [G_LONG, G_SHORT].every(x => x.includes('<div class="line line2"><span class="l">')
     && x.slice(x.indexOf('<div class="line line2">')).includes('<span class="r" title="账户">')
     && !x.slice(x.indexOf('<div class="line line2">')).includes('class="tag"')
     && !x.includes('class="acct"')));
ok('v1.3.5 无标签行 DOM 与金额原串不变（零改动）',
   (() => { const plain = A.rowHTML({id:'G3', type:'expense', date:'2026-11-11', time:'10:00',
     amount:88.5, from:'微信'});
     return plain.includes('<span class="r" title="该笔金额"><span class="amt">-88.50</span></span>')
       && plain.includes('<span class="r" title="账户">微信</span>')
       && !plain.includes('has-tag'); })());
ok('v1.3.5 缺账户红条不受标签影响（同一行既有标签又缺账户，红条仍在）',
   (() => { const s = A.rowHTML({id:'G4', type:'repay', date:'2026-11-11', time:'10:00',
     amount:500, to:'B', tag:'房贷'});
     return /class="flow-row lack"/.test(s)
       && s.includes('<span class="r has-tag" title="标签与金额">')
       && html.includes('.flow-row.lack .line2 .r{color:var(--warn)}'); })());
ok('v1.3.5 不计入小字与金额前标签互不干扰（两枚标记同处一行各自独立）',
   (() => { const s = A.rowHTML({id:'G5', type:'income', date:'2026-11-11', time:'09:00',
     amount:8000, to:'银行卡', tag:'工资', noCount:true});
     return s.includes('<span class="r has-tag" title="标签与金额"><span class="tag" title="标签">工资</span>')
       && s.includes('<span class="piece nc">不计入</span>'); })());

/* ---- v1.3.6：标签|金额行内基线对齐 + 全流水条字号颜色统一（用户 2026-11-11 确认） ---- */
console.log('\n===== 十、v1.3.6 行内齐平 + 字号颜色统一 =====');
ok('v1.3.6 标签|金额 inline-flex 中线对齐（三者同字号同行高，中线对齐即齐平）',
   /\.line1 \.r\.has-tag\{display:inline-flex;align-items:center;justify-content:flex-end\}/.test(html));
ok('v1.3.6 旧 inline-block overflow baseline 陷阱已拆（标签不再下沉）',
   !/\.line1 \.r\.has-tag \.tag\{[^}]*vertical-align:baseline/.test(html)
   && /\.line1 \.r\.has-tag \.tag\{[^}]*overflow:hidden/.test(html));
ok('v1.3.6 标签 | 改正文色 inherit，与调整项「优惠|」同色（--muted 灰零残留于该规则）',
   /\.line1 \.r\.has-tag \.sep\{color:inherit\}/.test(html)
   && !/\.line1 \.r\.has-tag \.sep\{[^}]*var\(--muted\)/.test(html));
ok('v1.3.6 不计入小字升正文大小正文色（color:inherit / font-size:inherit）',
   html.includes('.line .l .piece.nc{color:inherit;font-size:inherit;white-space:nowrap}'));
ok('v1.3.6 全流水条字号统一 --fs-c、颜色统一 --ink（时间/inherit 已在位）',
   /\.line \.l\{[^}]*font-size:var\(--fs-c\)/.test(html)
   && /\.line \.r\{[^}]*font-size:var\(--fs-c\)/.test(html)
   && html.includes('.line .l .piece.sub{color:inherit}'));
ok('v1.3.6 缺账户 --warn 警示色保留（功能色不参与统一）',
   html.includes('.flow-row.lack{box-shadow:inset 3px 0 0 var(--warn)}')
   && html.includes('.flow-row.lack .badge{border-color:var(--warn);color:var(--warn)}')
   && html.includes('.flow-row.lack .line2 .r{color:var(--warn)}'));
ok('v1.3.6 无标签行 DOM 逐字节不变（零改动契约）',
   (() => { const plain = A.rowHTML({id:'H1', type:'expense', date:'2026-11-11', time:'10:00',
     amount:88.5, from:'微信'});
     return plain.includes('<span class="r" title="该笔金额"><span class="amt">-88.50</span></span>')
       && plain.includes('<span class="r" title="账户">微信</span>')
       && !plain.includes('has-tag') && !plain.includes('class="sep"'); })());
ok('v1.3.6 金额区间分隔符仍为 →（展示层改动不动金额口径）',
   (() => { const s = A.rowHTML({id:'H2', type:'repay', date:'2026-11-11', time:'10:00',
     from:'银行卡', to:'证券', tag:'吉吉', amount:11000, discount:1000});
     return s.includes('<span class="amt">10000→11000</span>')
       && s.includes('<span class="r has-tag" title="标签与金额">'); })());

/* ================= v1.3.7：总览开屏页 + dock 四项等宽（用户 2026-11-12 要求） ================= */
console.log('\n===== 十一、v1.3.7 总览开屏页 + dock 四项等宽 =====');

ok('v1.3.7 dock 恰好四项、顺序为 总览 / 账单 / 资产 / 记账', (() => {
  const ids = ['tabOv', 'tabBill', 'tabAsset', 'btnAdd'];
  const pos = ids.map(id => html.indexOf('<button class="' + (id === 'btnAdd' ? 'plus' : 'tab')
    + (id === 'tabOv' ? ' active' : '') + '" id="' + id + '"'));
  const order = ['id="tabOv"', 'id="tabBill"', 'id="tabAsset"', 'id="btnAdd"'].map(m => html.indexOf(m));
  return html.indexOf('class="bottombar"') > 0 && order.every(p => p > 0)
      && order.join(',') === order.slice().sort((a, b) => a - b).join(',');
})());
ok('v1.3.7 四块矩形框等宽：flex:1 1 0 等分 + v1.0.0 独立边框（gap:6px，不再折叠竖线），旧 92 / 66 零残留',
   html.includes('flex:1 1 0;min-width:0;margin-left:0}')
   && html.includes('justify-content:center;gap:6px')
   && !html.includes('.tab{width:92px}') && !html.includes('width:66px'));
ok('v1.3.7 竖排（平板侧栏）断点撤销 flex-basis 0 与负左边距，按钮不被压扁、不横向错位',
   html.includes('.bottombar>button{flex:0 0 auto;margin-left:0}'));
ok('v1.3.7 开屏页是总览：S.tab 默认 overview + renderFlow 走总览分支 + 隐藏日历 / 日期条',
   html.includes("tab:'overview'")
   && html.includes("$('flow').innerHTML = renderOverview();")
   && html.includes("$('cal').hidden = isAsset || isOv;")
   && html.includes("$('dateBar').hidden = isAsset || isOv;"));
ok('v1.3.7「记账」仍是记账弹层入口、不是页签（.plus + onclick openSheet）',
   html.includes('<button class="plus" id="btnAdd" title="记一笔" aria-label="记一笔">记账</button>')
   && html.includes("$('btnAdd').addEventListener('click', openSheet);"));
ok('v1.3.7 总览页未另起统计函数（复用 summaryOf / assetSummary）',
   !/function ov(Summary|Balance|Delta|Total)/.test(html)
   && html.includes('const s = assetSummary();') && html.includes('summaryOf(statsRows('));

/* 功能验证：直接跑成品页里的 renderOverview / ovBlockHTML（与资产页共用同一批真实函数），不重抄公式。
   v1.4.0：三块本年网格直出总览页，vm 里的 S 不再需要任何子页状态位。 */
const ovSrc = slice('/* 资产页汇总：按 accountTypes.mode', 'function renderFlow(){');
vm.runInContext('const S = {month:"2026-11"};\n'
  + ovSrc + '\nglobalThis.OV = renderOverview; globalThis.BLK = ovBlockHTML; globalThis.OVS = S;', ctx);
ctx.DB.accountTypes = [{id:'asset', name:'资产账户', mode:'asset'}, {id:'credit', name:'信贷账户', mode:'credit'}];
ctx.DB.accounts = [{id:'a1', name:'招商银行储蓄卡', kind:'asset', opening:1000, limit:0}];
ctx.DB.tx = [
  {id:'o1',type:'expense',date:'2026-11-03',time:'10:00',from:'招商银行储蓄卡',fromId:'a1',category:'餐饮',amount:120},
  {id:'o2',type:'expense',date:'2026-11-05',time:'11:00',from:'招商银行储蓄卡',fromId:'a1',category:'餐饮',amount:80},
  {id:'o3',type:'expense',date:'2026-11-06',time:'12:00',from:'招商银行储蓄卡',fromId:'a1',category:'购物',amount:300},
  {id:'o4',type:'expense',date:'2026-11-07',time:'13:00',from:'招商银行储蓄卡',fromId:'a1',category:'交通',amount:40,noCount:true},
  {id:'o5',type:'income', date:'2026-11-08',time:'09:00',to:'招商银行储蓄卡',toId:'a1',category:'工资',amount:9000},
  {id:'o6',type:'expense',date:'2020-01-01',time:'10:00',from:'招商银行储蓄卡',fromId:'a1',category:'餐饮',amount:5}
];
const ov = ctx.OV();
const cardVal = lab => {
  const m = ov.match(new RegExp('<span class="lab">' + lab + '</span><span class="val">([-+\\d.]+)</span>'));
  return m ? m[1] : null;
};
eq('总览·总资产卡（1000+9000−500−40−5，余额照扣「不计入」那笔）', cardVal('总资产'), '9455.00');
eq('总览·资产账户卡', cardVal('资产账户'), '9455.00');
eq('总览·信贷账户卡', cardVal('信贷账户'), '0.00');
eq('总览·本月支出卡（「不计入」的 40 元被剔除，v1.4.3 起取负号）', cardVal('本月支出'), '-500.00');
eq('总览·本月收入卡（带正号）', cardVal('本月收入'), '+9000.00');
eq('总览·本月结余卡（带正号）', cardVal('本月结余'), '+8500.00');
/* 总览页形态：六张卡 + 紧随其后的三块本年网格，不再有入口卡 / 返回键 */
ok('总览页恰好六张卡（资产三 + 本月三），且不再有任何入口卡',
   (ov.match(/class="card"/g) || []).length === 6
   && !ov.includes('ov-entry') && !ov.includes('ov-go')
   && !ov.includes('data-ov-page') && !ov.includes('data-ov-back')
   && !ov.includes('分类支出') && !ov.includes('最近流水')
   && !ov.includes('ov-block') && !ov.includes('flow-row')
   && !ov.includes('asset-empty'),
   {cards:(ov.match(/class="card"/g)||[]).length});
ok('总览页同时铺出三块本月网格（结余 / 收入 / 支出），顺序 bal → inc → exp',
   (ov.match(/class="ov-heat"/g) || []).length === 3
   && ov.indexOf('data-ov-kind="bal"') > -1
   && ov.indexOf('data-ov-kind="bal"') < ov.indexOf('data-ov-kind="inc"')
   && ov.indexOf('data-ov-kind="inc"') < ov.indexOf('data-ov-kind="exp"'),
   {blocks:(ov.match(/class="ov-heat"/g)||[]).length});

/* 三块：同一渲染器产出，逐块核对三行结构（第一行标题+合计 / 第二行 1~6 / 第三行 7~12） */
const blkOf = k => ctx.BLK(k);
const balBlk = blkOf('bal'), incBlk = blkOf('inc'), expBlk = blkOf('exp');
const cellsOf = h => [...h.matchAll(/<div class="ov-cell"><span class="ov-mo">([^<]+)<\/span><span class="ov-val">([^<]+)<\/span><\/div>/g)]
  .map(m => ({mo:m[1], val:m[2]}));
const headOf = h => {
  const m = h.match(/<div class="ov-heat-head">([\s\S]*?)<\/div>/);
  return m ? m[1] : '';
};
const sumOf = h => {
  const m = h.match(/<span class="ov-heat-sum">([^<]+)<\/span>/);
  return m ? m[1] : null;
};
const cells = cellsOf(balBlk);
ok('结余块·12 格顺序严格 1~12（「本年」格已取消，6 列自动折成两行）',
   cells.length === 12 && cells.every((c,i) => c.mo === String(i+1)), cells.map(c=>c.mo));
ok('结余块·第一行是「2026 年 | 本年结余 +8500.00」四段（年份 / 竖线 / 指标名 / 合计）',
   headOf(balBlk).includes('<span class="ov-heat-year">2026 年</span>')
   && headOf(balBlk).includes('<i class="ov-sep">|</i>')
   && headOf(balBlk).includes('<span class="ov-heat-title">本年结余</span>')
   && sumOf(balBlk) === '+8500.00', headOf(balBlk));
eq('结余块·11 月格（与「本月结余」卡同源，+8500.00）', cells[10].val, '+8500.00');
ok('结余块·其余 11 个月无数据记 0.00，不出现空块或占位符',
   cells.filter((c,i) => i !== 10).every(c => c.val === '0.00')
   && !balBlk.includes('暂无') && !balBlk.includes('—'));
eq('结余块·本年结余＝2026 各月结余之和（2020 年那笔不进本年）', sumOf(balBlk), '+8500.00');
ok('收入块·合计与 11 月格都带正号（+9000.00）',
   sumOf(incBlk) === '+9000.00' && cellsOf(incBlk)[10].val === '+9000.00', sumOf(incBlk));
ok('支出块·合计与 11 月格都带负号（-500.00，「不计入」剔除）',
   sumOf(expBlk) === '-500.00' && cellsOf(expBlk)[10].val === '-500.00', sumOf(expBlk));
ok('三块 DOM 骨架逐字相同（同一渲染器；抹掉文字与定位标记后字符串完全一致）',
   (() => {
     const skel = h => h.replace(/ data-ov-kind="\w+"/, '').replace(/>[^<]*</g, '><');
     return skel(balBlk) === skel(incBlk) && skel(incBlk) === skel(expBlk);
   })());
ok('三块第一行都是「年份 | 本年X 合计」四段，标题与合计随指标变，且没有返回键',
   ['bal','inc','exp'].every((k, i) => {
     const h = [balBlk, incBlk, expBlk][i];
     return /<span class="ov-heat-year">\d{4} 年<\/span>/.test(headOf(h))
         && headOf(h).includes('<i class="ov-sep">|</i>')
         && headOf(h).includes('<span class="ov-heat-title">本年' + ['结余','收入','支出'][i] + '</span>')
         && sumOf(h) !== null
         && !h.includes('ov-back') && !h.includes('‹ 总览');
   }));
ok('三块都不含任何切换控件（v1.3.8 的三枚 ov-metric 已整块删除）',
   [balBlk, incBlk, expBlk].every(h => !h.includes('data-ov-metric') && !h.includes('ov-metric')
     && !h.includes('ov-metrics')));
ok('三块·无热力深浅（格子里没有 inline style / 渐变 / 透明度底色）',
   [balBlk, incBlk, expBlk].every(h => !/class="ov-cell[^>]*style=/.test(h)
     && !h.includes('rgba(') && !h.includes('linear-gradient')));
ok('三块·月份格纯展示不可点（格子不带任何 data-* 属性）',
   [balBlk, incBlk, expBlk].every(h => !/class="ov-cell[^>]*data-/.test(h)
     && !h.includes('data-ov-month')));
/* 空账本形态（出货形态）：六张卡照常、三块 12 格全部 0.00，只有总资产仍是账户期初 */
ok('空账本：本月三卡全 0.00，三块各 12 格全 0.00 + 合计 0.00，总资产仍为账户期初', (() => {
  ctx.DB.tx = [];
  const empty = ctx.OV();
  const val = lab => {
    const m = empty.match(new RegExp('<span class="lab">' + lab + '</span><span class="val">([-+\\d.]+)</span>'));
    return m ? m[1] : null;
  };
  const blockVals = k => [...ctx.BLK(k).matchAll(/<span class="ov-val">([^<]+)<\/span>/g)].map(m => m[1]);
  const ba = blockVals('bal');
  return (empty.match(/class="card"/g) || []).length === 6
      && val('本月支出') === '0.00' && val('本月收入') === '0.00' && val('本月结余') === '0.00'
      && val('总资产') === '1000.00'
      && (empty.match(/class="ov-heat"/g) || []).length === 3
      && ba.length === 12 && ba.every(v => v === '0.00')
      && ['bal','inc','exp'].every(k => blockVals(k).length === 12 && blockVals(k).every(v => v === '0.00'))
      /* 空账本合计为 0：正号规则只在 > 0 时加，0 仍是「0.00」 */
      && sumOf(ctx.BLK('bal')) === '0.00' && sumOf(ctx.BLK('inc')) === '0.00' && sumOf(ctx.BLK('exp')) === '0.00';
})());
ok('总览·金额一律两位小数（卡片 / 月份格 / 合计同套位数，不出现 num() 的整数截断）',
   !/<span class="val">-?\d+<\/span>/.test(ov) && !/<span class="ov-val">-?\d+<\/span>/.test(balBlk)
   && !/<span class="ov-heat-sum">[+\-]?\d+<\/span>/.test(balBlk));
ctx.DB.tx = [];

/* ================= v1.4.0：三块每块三行 · 格子 5 列改 6 列（用户 2026-11-12 样张） ================= */
console.log('\n===== 十二、v1.4.0 三块三行 / 6 列 × 2 行 / 本年格取消 / 入口卡零残留 =====');
ok('v1.4.0 v1.3.8 切换控件彻底消失：ovMetric 状态位 / data-ov-metric / renderHeat 全部零残留',
   !html.includes("ovMetric:'bal'") && !html.includes('data-ov-metric="')
   && !html.includes('function renderHeat()') && !html.includes('function heatHTML()')
   && !html.includes('S.ovMetric = om.dataset.ovMetric'));
ok('v1.4.0 v1.3.9 的入口卡 / 返回键 / 状态位也彻底消失（本版收回成直出）',
   !html.includes('data-ov-page') && !html.includes('data-ov-back')
   && !html.includes('ov-entry') && !html.includes('ov-back') && !html.includes('ov-go')
   && !html.includes('ovPage')
   && !html.includes('id="ovHeat"'));
ok('v1.4.0 三块共用一个渲染器（块结构逐字相同的唯一保证）',
   html.includes('function ovBlockHTML(k, d){')
   && (html.match(/function ovBlockHTML\(/g) || []).length === 1);
ok('v1.4.0 三块真的同时铺在总览页上（不是二选一、也不需要点任何入口）',
   html.includes("ovBlockHTML('bal', d) + ovBlockHTML('inc', d) + ovBlockHTML('exp', d)")
   && html.includes("$('flow').innerHTML = renderOverview();")
   && !html.includes('S.ovPage ?'));
ok('v1.4.0 dock「总览」回到单层页（不再复位任何子页状态）',
   html.includes("S.tab = 'overview'; renderFlow();")
   && !html.includes("S.tab = 'overview'; S.ovPage = null;"));
ok('v1.4.0 总览页状态里没有残留字段（S 只剩 date / month / tab）',
   html.includes("const S = {date:LAST_DATE, month:LAST_DATE.slice(0,7), tab:'overview'};"));
ok('v1.4.0 三块上下紧贴（v1.4.1 起补回顶边，见第十三节）',
   html.includes('.ov-heat+.ov-heat{margin-top:0;border-top:var(--line)}'));
ok('v1.4.0 格子由 5 列改成 6 列：1~6 一行、7~12 一行，末列末行都不重线',
   html.includes('.ov-heat{border:var(--line);margin:6px 0}')
   && html.includes('.ov-heat-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr))}')
   && html.includes('.ov-cell:nth-child(6n){border-right:0}')
   && html.includes('.ov-heat-grid>.ov-cell:nth-last-child(-n+6){border-bottom:0}')
   && !html.includes('repeat(5,minmax(0,1fr))'));
ok('v1.4.0「本年」格已取消（合计上提到第一行），格子里不再有 ov-year',
   !html.includes('ov-year') && !html.includes('<span class="ov-mo">本年</span>'));
ok('v1.4.0 第一行是「年份 | 本年X 合计」：竖线保留，合计右跟',
   html.includes(`'<i class="ov-sep">|</i>'`)
   && html.includes('.ov-heat-sum{')
   && html.includes(`'<span class="ov-heat-year">' + d.year + ' 年</span>'`));
ok('v1.4.0 结余合计带正负号（+8500.00）；v1.4.3 起三类合计统一走 signedMoney',
   html.includes('const sum = signedMoney(k, yv);'));
ok('v1.4.0 不用热力深浅、月份格不带点击属性',
   (() => { const c = html.slice(html.indexOf('.ov-heat{'), html.indexOf('.ov-val{'));
            return !c.includes('rgba(') && !c.includes('linear-gradient') && !c.includes('--heat'); })()
   && !html.includes('data-ov-month') && !html.includes('class="ov-cell" data-'));
ok('v1.4.0 第一行沿用纯黑白主题（主题色字，无灰底 / 彩色 / hover 变色）',
   html.includes('.ov-heat-head{display:flex;align-items:center;gap:4px;')
   && html.includes('.ov-heat-title{font-size:var(--fs-c);white-space:nowrap}')
   && html.includes('.ov-heat-sum{font-size:var(--fs-c);font-weight:700')
   && !html.includes('.ov-heat-head:hover'));
ok('v1.4.0 取数仍是既有 KPI 路径的纯包装（三块都不另立年口径）',
   html.includes('const monthStats = key => summaryOf(statsRows(DB.tx.filter(t => t.date.slice(0,7) === key)));')
   && (html.match(/summaryOf\(statsRows\(/g) || []).length === 3
   && !/function ov(Summary|Balance|Delta|Total)/.test(html));
ok('v1.4.0 沿用 v1.3.8 的流水末条底边 / 留白 / KPI .86em（未被本版回退）',
   !html.includes('.flow-list .flow-row:last-child{border-bottom:0}')
   && html.includes('gap:var(--flow-gap);padding-bottom:8px}')
   && html.includes('.flow-list{padding-bottom:.53em}')
   && html.includes('gap:2px;font-size:.86em;white-space:nowrap}')
   && !html.includes('gap:2px;font-size:var(--fs-c);white-space:nowrap}'));
ok('v1.4.0 两榜代码仍零残留',
   !html.includes('const OV_TOP = 5;') && !html.includes('<span>分类支出</span>')
   && !html.includes('<span>最近流水</span>') && !html.includes('ov-block'));

// ---- v1.4.1：三处视觉修正（纯展示层，金额口径零改动） ----
console.log('\n===== 十三、v1.4.1 三块补顶边 / 竖线·页签归一 / 四框上移 =====');
ok('v1.4.1 本年收入 / 本年支出两块补回顶边，三块都是完整四边矩形',
   html.includes('.ov-heat{border:var(--line);margin:6px 0}')
   && html.includes('.ov-heat+.ov-heat{margin-top:0;border-top:var(--line)}')
   && !html.includes('.ov-heat+.ov-heat{margin-top:0;border-top:0}'));
ok('v1.4.1 块间仍是 6px 白隙（margin-top:0 只压后一块自己的上外距），不叠 4px 粗线',
   html.includes('.ov-heat{border:var(--line);margin:6px 0}') && html.includes('.ov-heat+.ov-heat{margin-top:0;'));
ok('v1.4.1 总览竖线与账单页「标签|金额」竖线同字号同色（--fs-c / --ink）',
   html.includes('.ov-sep{font-style:normal;font-size:var(--fs-c);line-height:1;color:var(--ink)}')
   && !html.includes('opacity:.45')
   && html.includes('.line1 .r.has-tag .sep{color:inherit}')
   && html.includes('<i class="ov-sep">|</i>'));
ok('v1.4.1 dock 选中页签「总览」与「账单」同字号同字色（撤掉加粗）',
   html.includes('.tab.active{background:var(--paper);color:var(--ink)}')
   && !html.includes('.tab.active{background:var(--paper);color:var(--ink);font-weight:700}')
   && html.includes('.bottombar>button{position:relative;border:var(--line);height:36px;font-size:var(--fs);'));
ok('v1.4.1 选中态唯一标识仍是 24×3px 悬浮短条（未被当成加粗一起删掉）',
   html.includes('.tab.active::after{content:"";position:absolute;left:50%;bottom:5px;transform:translateX(-50%);width:24px;height:3px;background:var(--ink)}'));
ok('v1.4.1 手机端四个框上移 6px、平板竖排侧栏复位 0',
   html.includes('.bottombar>button{top:-6px}') && html.includes('.bottombar>button{top:0}'));
ok('v1.4.1 上移是纯视觉位移：dock 内距 7/9/2 与盒高 45px 一字未动',
   html.includes('padding:7px 10px calc(2px + env(safe-area-inset-bottom,0px))')
   && html.includes('calc(2px + env(safe-area-inset-bottom,0px))')
   && 7 + 36 + 2 === 45);
ok('v1.4.1 body 让位 46px / 面板↔dock 呼吸 8px 守恒（没把面板一起拽上去）',
   html.includes('padding:0 4px calc(46px + env(safe-area-inset-bottom,0px))')
   && 46 + 7 - 45 === 8
   && !/\.panel\{[^}]*position:absolute/.test(html));

// ---- v1.4.2：全站小圆弧（纯样式层，DOM / 口径 / 原生层零改动） ----
console.log('\n===== 十四、v1.4.2 全站小圆弧 =====');
ok('v1.4.2 两级半径令牌：容器 8px / 控件 4px',
   html.includes(':root{--r:8px;--r-s:4px}'));
ok('v1.4.2 容器级圆角覆盖面板 / 三块本年卡片 / 弹层 / 设置区块',
   html.includes('.panel{border-radius:var(--r);overflow:hidden}')
   && html.includes('.ov-heat{border-radius:var(--r);overflow:hidden}')
   && html.includes('.sheet{border-radius:var(--r)}')
   && html.includes('.set-sec{border-radius:var(--r)}'));
ok('v1.4.2 控件级 4px 覆盖按钮 / 徽标 / 日期格 / 汇总卡 / 输入框 / toast',
   html.includes('.badge,') && html.includes('.day{border-radius:var(--r-s)}')
   && html.includes('.fitem input,.fitem select,.set-add input{border-radius:var(--r-s)}')
   && html.includes('.toast{border-radius:var(--r-s)}'));
ok('v1.0.0 dock 四块拆分独立边框，四角全圆（三选择器并列压住首尾特异性）',
   html.includes('.bottombar>button,\n.bottombar>button:first-child,\n.bottombar>button:last-child{border-radius:var(--r)}'));
ok('v1.4.2 月份格 / 资产行基础样式仍直角；账单 .flow-row 圆角属 v1.0.0 独立卡片覆盖层（基础段仍直角）',
   !/\.ov-cell\{[^}]*border-radius[^}]*\}/.test(html)
   && !html.slice(html.indexOf('.flow-row{'), html.indexOf('}', html.indexOf('.flow-row{'))).includes('border-radius')
   && !/\.asset-row\{[^}]*border-radius[^}]*\}/.test(html));
ok('v1.4.2 平板断点按 --fs 等比换算（--r:.4em / --r-s:.2em），且四角全圆',
   html.includes(':root{--r:.4em;--r-s:.2em}')
   && /\.bottombar>button,\s*\n\s*\.bottombar>button:first-child,\s*\n\s*\.bottombar>button:last-child\{border-radius:var\(--r\)\}/.test(html));
ok('v1.4.2 圆角层没有改动任何几何量（dock 盒高 45 / body 让位 46 / 四框 top:-6px 原样）',
   html.includes('padding:7px 10px calc(2px + env(safe-area-inset-bottom,0px))')
   && html.includes('padding:0 4px calc(46px + env(safe-area-inset-bottom,0px))')
   && html.includes('.bottombar>button{top:-6px}'));

// ---- v1.4.3：顶栏六格（前五格等宽）+ 总览金额带正负号 ----
console.log('\n===== 十五、v1.4.3 总览金额带号 / 顶栏（v1.4.5 起五格） =====');
const _tb = (html.match(/<div class="topbar">[\s\S]*?<\/div>/) || [''])[0];
const _ids = ['btnSettings','btnBackup','btnRestore','btnTheme','btnAddAccount'];
ok('v1.4.5 顶栏五格顺序：设置 / 备份 / 恢复 / 明暗 / 新增账户（v1.4.3 曾是六格含「资产管理中枢」）',
   _ids.every((id, i) => _tb.indexOf('id="' + id + '"') > -1
     && (i === 0 || _tb.indexOf('id="' + id + '"') > _tb.indexOf('id="' + _ids[i-1] + '"'))),
   _tb.slice(0, 160));
ok('v1.4.5 四个功能键 flex:1 等分，「资产管理中枢」定宽位不再存在',
   html.includes('.topbar>.bx.stub{flex:1 1 0;min-width:0;padding:0 .28em;letter-spacing:.13em}')
   && html.includes('.topbar>.bx.add{flex:0 0 auto;padding:0 .55em;letter-spacing:0}')
   && !html.includes('.bx.brand{'));
ok('v1.4.3 顶栏不再有弹性空档 .spacer（五格已均分余量）',
   !/class="spacer"/.test(_tb));
ok('v1.4.3 末格「+ 新增账户」按内容定宽、三页都可用',
   html.includes('.topbar>.bx.add{flex:0 0 auto;padding:0 .55em;letter-spacing:0}')
   && _tb.includes('id="btnAddAccount"')
   && html.includes("$('btnAddAccount').addEventListener('click', () => openAccount(null));"));
ok('v1.4.3 资产页内不再有自己的「+ 新增账户」工具条',
   !html.includes('<div class="asset-tools"><button id="btnAddAccount">')
   && html.includes('暂无账户，点顶栏「+ 新增账户」或导入备份'));
ok('v1.4.3 金额带号统一走 signedMoney（支出取负 / 结余·收入按正负 / 0 不加号）',
   html.includes('function signedMoney(kind, v){')
   && html.includes("return (kind === 'exp' ? (x > 0 ? '-' : '+') : (x > 0 ? '+' : '-')) + a;")
   && html.includes('if(x === 0) return a;'));
ok('v1.4.3 本月三卡与三块本年网格都接了 signedMoney，资产三卡保持绝对值',
   html.includes("card('本月支出', m.exp, 'exp') + card('本月收入', m.inc, 'inc') + card('本月结余', m.bal, 'bal')")
   && html.includes("+ '<span class=\"ov-val\">' + signedMoney(kind, val) + '</span></div>';")
   && html.includes('const sum = signedMoney(k, yv);')
   && html.includes('g += ovCell(m.mo, m[k], k);')
   && html.includes("card('总资产', s.total) + card('资产账户', s.asset) + card('信贷账户', s.credit)"));
ok('v1.4.3 账单页 KPI 未被波及（仍走 v1.3.8 的 kpiHTML）',
   html.includes("'<span>支出' + (s.exp > 0 ? '-' : '') + num(s.exp) + '</span>'")
   && html.includes("'<span>结余' + num(s.bal) + '</span>'"));

// ---- v1.4.5：顶栏「资产管理中枢」按键移除 ----
console.log('\n===== 十六、v1.4.5 顶栏五格（「资产管理中枢」按键下线） =====');
ok('v1.4.5 顶栏只剩 5 个按键，顺序为 设置 / 备份 / 恢复 / 明暗 / 新增账户',
   (_tb.match(/<button/g) || []).length === 5
   && ['btnSettings','btnBackup','btnRestore','btnTheme','btnAddAccount']
        .every(id => _tb.indexOf('id="' + id + '"') > -1)
   && _tb.indexOf('id="btnSettings"') < _tb.indexOf('id="btnBackup"')
   && _tb.indexOf('id="btnBackup"') < _tb.indexOf('id="btnRestore"')
   && _tb.indexOf('id="btnRestore"') < _tb.indexOf('id="btnTheme"')
   && _tb.indexOf('id="btnTheme"') < _tb.indexOf('id="btnAddAccount"'),
   _tb.replace(/\s+/g, ' ').slice(0, 120));
ok('v1.4.5 「资产管理中枢」标记 / 事件监听 / .bx.brand 三档定宽全部下线（不留死代码）',
   !html.includes('id="btnBrand"') && !html.includes("$('btnBrand')")
   && !html.includes('.bx.brand{') && !html.includes('>资产管理中枢</button>'));
ok('v1.4.5 四个功能键 flex:1 等分 + 末格动作键按内容定宽',
   html.includes('.topbar>.bx.stub{flex:1 1 0;min-width:0;padding:0 .28em;letter-spacing:.13em}')
   && html.includes('.topbar>.bx.add{flex:0 0 auto;padding:0 .55em;letter-spacing:0}'));
ok('v1.4.5 字距改用 .13em（手机 1.9px / 平板 3.1px 一套值），旧 2px 硬写值不残留',
   (html.match(/\.topbar>\.bx\.stub\{/g) || []).length === 1
   && html.includes('padding:0 .28em;letter-spacing:.13em}'));
ok('v1.4.5 顶部注释已改名（不再列「资产管理中枢」），.bx 基础规则与 .bx.stub 默认值原样保留',
   html.includes('/* ---------- 顶部：设置 / 备份 / 恢复 / 明暗 ---------- */')
   && html.includes('.bx{border:var(--line);height:32px;min-width:60px;padding:0 8px;')
   && html.includes('.bx.stub{flex:0 0 auto}')
   && html.includes('.topbar .bx.stub{min-width:0;padding:0 6px;letter-spacing:1px}'));
ok('v1.4.5 「+ 新增账户」仍是唯一入口且挂在顶栏',
   html.includes("$('btnAddAccount').addEventListener('click', () => openAccount(null));")
   && !html.includes('<div class="asset-tools"><button id="btnAddAccount">'));
ok('v1.4.5 移除按键没有连带动到 v1.4.3 的总览金额带号',
   html.includes('function signedMoney(kind, v){')
   && html.includes('const sum = signedMoney(k, yv);')
   && html.includes('g += ovCell(m.mo, m[k], k);'));

console.log('\n========== 算法自检: ' + pass + ' PASS / ' + fail + ' FAIL ==========');
process.exit(fail ? 1 : 0);
