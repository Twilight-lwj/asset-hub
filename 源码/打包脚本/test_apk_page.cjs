/* APK 内嵌页面真跑冒烟：从【本版 APK】抽出 assets/index.html，用假 PnlAndroid 模拟 WebView。
   v1.4.1：旧脚本把 PAGE 写死成 /tmp/ledger_apk_page_v138.html（v1.3.8 的遗留页），
   于是测的永远是旧页面 —— 改为运行时按 __dirname 向上找当版 APK 自行解包，归档形态也能复跑。 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const APK = path.resolve(__dirname, '..', '..', '发布版', '资产管理中枢-发布版1.0.0.apk');
function apkPage() {
  const buf = fs.readFileSync(APK);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效 APK: ' + APK);
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('central directory 损坏');
    const method = buf.readUInt16LE(off + 10), csize = buf.readUInt32LE(off + 20);
    const nlen = buf.readUInt16LE(off + 28), xlen = buf.readUInt16LE(off + 30), clen = buf.readUInt16LE(off + 32);
    const name = buf.toString('utf8', off + 46, off + 46 + nlen);
    const loff = buf.readUInt32LE(off + 42);
    const ln = buf.readUInt16LE(loff + 26), lx = buf.readUInt16LE(loff + 28);
    const start = loff + 30 + ln + lx;
    if (name === 'assets/index.html') {
      const raw = buf.slice(start, start + csize);
      const data = method === 0 ? raw : zlib.inflateRawSync(raw);
      const out = '/tmp/ledger_apk_page.html';
      fs.writeFileSync(out, data);
      return 'file://' + out;
    }
    off += 46 + nlen + xlen + clen;
  }
  throw new Error('APK 缺 assets/index.html');
}
const PAGE = apkPage();
let pass = 0, fail = 0;
const ok = (n, c, e) => { if(c){pass++;console.log('PASS  '+n);} else {fail++;console.log('FAIL  '+n+(e!==undefined?'  → '+JSON.stringify(e):''));} };

(async () => {
  const b = await puppeteer.launch({executablePath:'/usr/bin/google-chrome', headless:'new',
    args:['--no-sandbox','--disable-dev-shm-usage','--allow-file-access-from-files']});
  const p = await b.newPage();
  await p.setViewport({width:470, height:1000});
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.evaluateOnNewDocument(() => {
    window.__bars = []; window.__ns = []; window.__export = null;
    window.PnlAndroid = {
      setSystemBars:(c,l)=>window.__bars.push([c,l]),
      nsRequest:function(){ window.__ns.push([...arguments]); },
      exportBackup:(n,j)=>{ window.__export={name:n,len:j.length}; },
      toast:()=>{}, quitApp:()=>{}
    };
  });
  await p.goto(PAGE, {waitUntil:'load'});
  await p.evaluate(() => { try{localStorage.clear();}catch(e){} });
  await p.reload({waitUntil:'load'});

  const A = await p.evaluate(() => ({
    app:!!document.querySelector('.app'), ver:document.querySelector('.app').dataset.version,
    db:typeof DB === 'object' && Array.isArray(DB.tx), native:!!PNL_NATIVE,
    bars:window.__bars, tx:DB.tx.length, accounts:DB.accounts.length
  }));
  ok('A1 内嵌页启动、DB 就绪', A.app && A.db && A.ver === '1.0.0', A);
  ok('A2 捕获到原生桥 PNL_NATIVE', A.native === true, A);
  ok('A3 出厂无内置数据', A.tx === 0 && A.accounts === 0, A);
  ok('A4 导航栏用不透明深色（v1.4.5 默认黑夜，杜绝系统动态取色）', A.bars.length >= 1 && A.bars[0][0] === '#ff0d1117' && A.bars[0][1] === false, A.bars);
  const A5 = await p.evaluate(async () => {
    window.__bars.length = 0;
    document.getElementById('btnAdd').click();
    await new Promise(r => setTimeout(r, 700));
    document.getElementById('sheetClose').click();
    await new Promise(r => setTimeout(r, 700));
    return {n:window.__bars.length, uniq:[...new Set(window.__bars.map(x=>x.join('|')))]};
  });
  ok('A5 弹层开关重复刷深色（含延迟重试）', A5.n >= 8 && A5.uniq.length === 1 && A5.uniq[0] === '#ff0d1117|false', A5);
  const A6 = await p.evaluate(() => {
    const cs = e => getComputedStyle(e);
    const btns = [...document.querySelectorAll('.bottombar>button')];
    return {top:cs(document.querySelector('.bottombar')).borderTopWidth,
            sides:btns.map(e => [cs(e).borderLeftWidth, cs(e).borderRightWidth]),
            w:btns.map(e => Math.round(e.getBoundingClientRect().width * 100) / 100),
            n:btns.length};
  });
  /* v1.0.0：dock 四项，每个按钮都是独立边框的完整矩形（四周 1px），以 6px gap 分隔 */
  ok('A6 v1.0.0 dock 顶部分隔线已撤（0px）；四个按钮独立边框四周 1px、等宽不叠加',
     A6.top === '0px' && A6.n === 4
     && A6.sides.every(x => x[0] === '1px' && x[1] === '1px')
     && new Set(A6.w).size === 1, A6);

  // 顶部四个按钮确实绑定（不是静态字符串）
  const B = await p.evaluate(() => {
    window.__export = null;
    document.getElementById('btnBackup').click();
    return {exported:window.__export,
            bak:JSON.parse(localStorage.getItem('amhub_v100_autobackup') || 'null')};
  });
  ok('B1 「备份」零弹窗：不调 SAF 导出桥，静默写固定备份区',
     !B.exported && B.bak && B.bak.name.startsWith('资产管理中枢_备份_') && B.bak.json.length > 100,
     {exported:B.exported, name:B.bak && B.bak.name, len:B.bak && B.bak.json.length});
  await p.evaluate(() => document.getElementById('btnSettings').click());
  const C = await p.evaluate(() => ({
    on:document.getElementById('settings').classList.contains('on'),
    io:document.querySelectorAll('[data-io]').length, ns:document.querySelectorAll('[data-ns]').length
  }));
  ok('C1 「设置」点击打开面板且功能齐全', C.on && C.io === 3 && C.ns === 4, C);
  await p.evaluate(() => {
    document.getElementById('settingsClose').click();
    document.getElementById('btnAdd').click();
  });
  const D = await p.evaluate(() => document.getElementById('sheet').classList.contains('on'));
  ok('D1 dock「记账」点击打开记账弹层', D === true, D);
  await p.evaluate(() => {
    document.getElementById('sheetClose').click();
    document.getElementById('tabAsset').click();
  });
  const E = await p.evaluate(() => ({
    asset:!!document.getElementById('btnAddAccount'),
    dock:getComputedStyle(document.querySelector('.bottombar')).position
  }));
  ok('E1 dock「资产」切换且 dock 仍固定', E.asset && E.dock === 'fixed', E);

  // 坚果云：点「立即备份」应产生 8 参原生请求
  await p.evaluate(() => {
    document.getElementById('btnSettings').click();
    document.getElementById('nsUser').value = 'u@example.com';
    document.getElementById('nsPass').value = 'app-pass';
    document.querySelector('[data-ns="save"]').click();
    document.querySelector('[data-ns="up"]').click();
  });
  await new Promise(r=>setTimeout(r,120));
  const F = await p.evaluate(() => ({
    calls:window.__ns.length,
    argc:window.__ns[0] ? window.__ns[0].length : 0,
    path:window.__ns[0] ? window.__ns[0][4] : '',
    stored:JSON.parse(localStorage.getItem('amhub_v100_nutstore')||'{}').user
  }));
  ok('F1 「立即备份」触发原生 nsRequest 8 参', F.calls >= 1 && F.argc === 8, F);
  ok('F2 原生 path 为 资产管理中枢/backup.json', F.path === '资产管理中枢/backup.json', F);
  ok('F3 配置写入本机 localStorage', F.stored === 'u@example.com', F);

  // file:// 下 localStorage 持久化（APK WebView 同理）
  await p.evaluate(() => {
    document.getElementById('settingsClose').click();
    document.getElementById('btnAddAccount').click();
    document.getElementById('aName').value = 'APK测试账户';
    document.getElementById('aBalance').value = '88.50';
    document.getElementById('aSave').click();
  });
  await p.reload({waitUntil:'load'});
  const G = await p.evaluate(() => ({n:DB.accounts.length, name:DB.accounts[0] && DB.accounts[0].name, bal:DB.accounts[0] && balanceOf(DB.accounts[0])}));
  ok('G1 刷新后新增账户仍在（WebView 存储可用）', G.n === 1 && G.name === 'APK测试账户' && G.bal === 88.5, G);
  ok('G2 全程无致命运行时错误', errors.length === 0, errors);

  // v1.1.5 起：顶部「备份」双写 + 「恢复」来源选择框（APK 内嵌页真跑）
  const H1 = await p.evaluate(async () => {
    window.__ns.length = 0; window.__export = null;
    document.getElementById('btnBackup').click();
    await new Promise(r => setTimeout(r, 80));
    return {bak:!!localStorage.getItem('amhub_v100_autobackup'),
            exportCalled:!!window.__export,
            methods:window.__ns.map(x => x[1]),
            argc:window.__ns[0] ? window.__ns[0].length : 0,
            path:window.__ns[0] ? window.__ns[0][4] : ''};
  });
  ok('H1 顶部「备份」固定备份区 + 云端原生 PUT，不调 SAF 桥',
     H1.bak && !H1.exportCalled && H1.methods.includes('PUT') && H1.argc === 8, H1);
  ok('H2 双写云端 path 为 资产管理中枢/backup.json', H1.path === '资产管理中枢/backup.json', H1.path);
  const H2 = await p.evaluate(() => {
    document.getElementById('btnRestore').click();
    return {on:document.getElementById('restoreSheet').classList.contains('on'),
            opts:[...document.querySelectorAll('#restoreBtns [data-restore]')].map(x => x.textContent.trim())};
  });
  ok('H3 顶部「恢复」弹出「本地备份 | 云端备份」选择框',
     H2.on && JSON.stringify(H2.opts) === '["本地备份","云端备份"]', H2);
  const H3 = await p.evaluate(() => {
    localStorage.removeItem('amhub_v100_autobackup');
    let clicks = 0;
    const f = document.getElementById('importFile');
    const rec = () => clicks++;
    f.addEventListener('click', rec);
    document.querySelector('[data-restore="local"]').click();
    f.removeEventListener('click', rec);
    return {clicks, closed:!document.getElementById('restoreSheet').classList.contains('on')};
  });
  ok('H4 无自动备份时选「本地备份」关闭选择框并回退文件选择器', H3.closed && H3.clicks === 1, H3);
  const H4 = await p.evaluate(async () => {
    window.__ns.length = 0;
    document.getElementById('btnRestore').click();
    document.querySelector('[data-restore="cloud"]').click();
    await new Promise(r => setTimeout(r, 80));
    return {methods:window.__ns.map(x => x[1]),
            closed:!document.getElementById('restoreSheet').classList.contains('on')};
  });
  ok('H5 选「云端备份」关闭选择框并发起原生 GET', H4.methods.includes('GET') && H4.closed, H4);


  // v1.1.6 起：明暗切换 + 系统栏颜色同步 + 固定备份区闭环（APK 内嵌页真跑）
  // v1.4.5：无记忆时默认深色；以下 I/J/K 断言沿用「切到黑夜 → 回白天」的方向语义，
  // 故段首显式置回亮色并持久化，使起点确定（点击 btnTheme 才会切到黑夜）。
  await p.evaluate(() => window.applyTheme(false, true));
  const I1 = await p.evaluate(() => {
    window.__bars.length = 0;
    document.getElementById('btnTheme').click();
    return {theme:document.documentElement.getAttribute('data-theme'),
            bg:getComputedStyle(document.documentElement).backgroundColor,
            key:localStorage.getItem('amhub_v100_theme'),
            bars:window.__bars.slice(-1)[0]};
  });
  ok('I1 「明暗」切到黑夜：暗色变量 + 持久化 + 系统栏不透明深 + 浅图标',
     I1.theme === 'dark' && I1.bg === 'rgb(13, 17, 23)' && I1.key === 'dark'
     && I1.bars && I1.bars[0] === '#ff0d1117' && I1.bars[1] === false, I1);
  const I2 = await p.evaluate(() => {
    window.__bars.length = 0;
    document.getElementById('btnTheme').click();
    return {theme:document.documentElement.getAttribute('data-theme'),
            bars:window.__bars.slice(-1)[0]};
  });
  ok('I2 再点回白天，系统栏回到不透明浅色 + 深图标（v1.1.4 修复保留）',
     I2.theme === null && I2.bars && I2.bars[0] === '#fff4f6fa' && I2.bars[1] === true, I2);
  const I3 = await p.evaluate(() => {
    window.__export = null;
    DB.tx.push({id:'i1',type:'expense',date:'2026-11-10',time:'10:00',amount:7.5,from:'微信'});
    persistDB(); renderAll();
    document.getElementById('btnBackup').click();
    const saved = DB.tx.length;
    applyDB({version:'1.2.8',accounts:[],categories:{},tags:{},tx:[],settings:{},meta:{},
             accountTypes:[{id:'asset',name:'资产账户',mode:'asset'},{id:'credit',name:'信贷账户',mode:'credit'}]});
    document.getElementById('btnRestore').click();
    document.querySelector('[data-restore="local"]').click();
    return {saved, after:DB.tx.length, exportCalled:!!window.__export,
            toast:document.getElementById('toast').textContent};
  });
  ok('I3 固定备份区闭环：备份不弹窗，恢复从固定区读回',
     I3.saved >= 1 && I3.after === I3.saved && !I3.exportCalled
     && /已从本地备份恢复/.test(I3.toast), I3);
  /* ===== J) v1.1.7 起：紧凑选项弹层（APK 内嵌页，带原生桥） ===== */
  const J1 = await p.evaluate(() => {
    DB.accounts = [{id:'j1',name:'微信',kind:'asset',balance:0},
                   {id:'j2',name:'建设银行',kind:'asset',balance:0}];
    persistDB(); renderAll();
    document.getElementById('btnAdd').click();
    document.querySelector('.sel-hit[data-sel="fFrom"]').click();
    const sh = document.getElementById('pickerSheet');
    const rows = [...document.querySelectorAll('.picker-row')];
    const r0 = rows[0] && rows[0].getBoundingClientRect();
    return {on:sh.classList.contains('on'), rows:rows.length,
            rowH:r0 ? +r0.height.toFixed(1) : 0,
            sheetH:+sh.getBoundingClientRect().height.toFixed(1),
            vh:window.innerHeight, title:document.getElementById('pickerTitle').textContent};
  });
  ok('J1 内嵌页点「支出账户」走网页紧凑弹层（行高 36px、整体 < 半屏）',
     J1.on && J1.rows === 3 && J1.rowH <= 40 && J1.sheetH < J1.vh * 0.5
     && J1.title === '支出账户', J1);
  const J2 = await p.evaluate(() => {
    [...document.querySelectorAll('.picker-row')].find(x => x.textContent === '建设银行').click();
    return {value:document.getElementById('fFrom').value,
            closed:!document.getElementById('pickerSheet').classList.contains('on'),
            bars:window.__bars.slice(-1)[0]};
  });
  ok('J2 选中写回并关闭；系统栏仍为不透明明确色（v1.1.4 修复零回退）',
     J2.value === '建设银行' && J2.closed && J2.bars
     && J2.bars[0] === '#fff4f6fa' && J2.bars[1] === true, J2);
  const J3 = await p.evaluate(() => {
    document.querySelector('.sel-hit[data-sel="fFrom"]').click();
    const before = document.getElementById('pickerSheet').classList.contains('on');
    document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
    return {before, pickerClosed:!document.getElementById('pickerSheet').classList.contains('on'),
            addStillOpen:S_ADD.open};
  });
  ok('J3 Escape 只关选择器，不误关底层记账弹层（层级语义正确）',
     J3.before && J3.pickerClosed && J3.addStillOpen, J3);
  /* ===== K) v1.1.8 纯色主题（v1.1.9 沿用） / v1.1.9 dock 黑边（内嵌页 + 原生桥） ===== */
  const kProbe = () => p.evaluate(() => {
    const probe = sel => {
      const el = document.querySelector(sel);
      if(!el) return null;
      const st = getComputedStyle(el);
      return {bg:st.backgroundColor, color:st.color, border:st.borderTopColor, weight:st.fontWeight};
    };
    return {theme:document.documentElement.getAttribute('data-theme'),
            btn:probe('#btnTheme'), day:probe('.day.sel'), tab:probe('.tab.active'),
            meta:document.querySelector('meta[name="theme-color"]').getAttribute('content'),
            bars:window.__bars.slice(-1)[0]};
  });
  await p.evaluate(() => {
    document.querySelectorAll('.sheet.on').forEach(x => x.classList.remove('on'));
    document.querySelectorAll('.sheet-mask.on, .picker-mask.on').forEach(x => x.classList.remove('on'));
    if(!document.querySelector('.day.sel')){
      const b = document.querySelector('.day[data-day]');
      if(b) b.click();
    }
    if(!document.querySelector('.tab.active')) document.getElementById('tabBill').click();
  });
  const K1 = await kProbe();
  ok('K1 白天：明暗 / 日历选中日 / dock 选中态纸底 ink 字 edge 边，系统栏不透明浅色',
     K1.theme === null
     && [K1.btn, K1.day, K1.tab].every(e => e && e.bg === 'rgb(244, 246, 250)'
       && e.color === 'rgb(18, 22, 29)' && e.border === 'rgb(201, 214, 232)')
     && K1.bars && K1.bars[0] === '#fff4f6fa' && K1.meta === '#f4f6fa', K1);
  const K2 = await p.evaluate(() => { document.getElementById('btnTheme').click(); return true; });
  const K2p = await kProbe();
  ok('K2 夜晚：三处深纸底 ink 边 ink 字，系统栏不透明深色、meta 同步',
     K2 && K2p.theme === 'dark'
     && [K2p.btn, K2p.day, K2p.tab].every(e => e && e.bg === 'rgb(13, 17, 23)'
       && e.color === 'rgb(230, 237, 243)' && e.border === 'rgb(45, 58, 82)')
     && K2p.bars && K2p.bars[0] === '#ff0d1117' && K2p.meta === '#0d1117', K2p);
  const K3 = await p.evaluate(() => { document.getElementById('btnTheme').click(); return true; });
  const K3p = await kProbe();
  ok('K3 切回白天无残留，三处恢复纸底（系统栏回 #fff4f6fa）',
     K3 && K3p.theme === null
     && [K3p.btn, K3p.day, K3p.tab].every(e => e && e.bg === 'rgb(244, 246, 250)')
     && K3p.bars && K3p.bars[0] === '#fff4f6fa', K3p);
  const K4 = await p.evaluate(() => {
    const bar = document.querySelector('.bottombar');
    const act = document.querySelector('.tab.active');
    const bs = getComputedStyle(bar), as = getComputedStyle(act);
    const af = getComputedStyle(act, '::after'), bf = getComputedStyle(bar, '::before');
    return {barShadow:bs.boxShadow, barBorderTop:bs.borderTopWidth,
            actShadow:as.boxShadow, actBorderBottom:as.borderBottomWidth,
            afterW:af.width, afterH:af.height, afterBottom:af.bottom, afterBg:af.backgroundColor,
            beforeH:bf.height, beforeTop:bf.top, beforeBg:bf.backgroundColor};
  });
  ok('K4 v1.0.0 APK 内嵌页 dock 黑边分离 + 已撤顶部分隔线（边框 1px，无投影/悬浮短条/6px 缓冲带）',
     K4.barShadow === 'none' && K4.actShadow === 'none'
     && K4.actBorderBottom === '1px' && K4.barBorderTop === '0px'
     && K4.afterW === '24px' && K4.afterH === '3px' && K4.afterBottom === '5px'
     && K4.afterBg === 'rgb(18, 22, 29)'
     && K4.beforeH === '6px' && K4.beforeTop === '-6px' && K4.beforeBg === 'rgb(244, 246, 250)', K4);
  /* ===== K5) v1.2.0 三处反色高亮归一（APK 内嵌页） ===== */
  const K5 = await p.evaluate(() => {
    const rules = [...document.styleSheets[0].cssRules].map(r => (r.cssText || '').replace(/\s*\{/, '{'));
    const find = s => rules.find(t => t.trim().startsWith(s + '{')) || '';
    return {
      typeRule:find('.type-row button.active'),
      curRule:find('.picker-row.cur'),
      onRule:find('.set-btns .bx.on'),
      pressRule:find('.picker-row:active'),
      darkPressRule:find('html[data-theme="dark"] .picker-row:active'),
      rowRule:find('.picker-row')
    };
  });
  ok('K5 APK 内嵌页三处选中态＝纯底 + 纯字 + 加粗，选项行按压无灰底',
     /background:\s*(var\(--paper\)|rgb\(255, 255, 255\))/.test(K5.typeRule)
     && /font-weight:\s*700/.test(K5.typeRule)
     && /font-weight:\s*700/.test(K5.curRule)
     && /font-weight:\s*700/.test(K5.onRule)
     && !/background:\s*var\(--ink\)/.test(K5.typeRule + K5.curRule + K5.onRule)
     && /background:\s*(var\(--paper\)|rgb\(255, 255, 255\))/.test(K5.pressRule)
     && /background:\s*(var\(--paper\)|rgb\(255, 255, 255\))/.test(K5.darkPressRule), K5);
  /* ===== K6) v1.2.1 平板等比适配（APK 内嵌页 CSSOM + 真实视口） ===== */
  const K6 = await p.evaluate(() => {
    const rules = [...document.styleSheets[0].cssRules];
    const media = rules.find(r => /@media\s*\(min-width:\s*560px\)/.test(r.cssText || ''));
    return {has:!!media, text:media ? media.cssText : ''};
  });
  // CSSOM cssText 会把 clamp() 的逗号后补空格（2.45vw, 31px），先归一化再比对
  const K6norm = K6.text.replace(/\s+/g, '');
  ok('K6 APK 内嵌页含 >=560px 平板断点与等比令牌',
     K6.has && K6norm.includes('clamp(19px,2.45vw,31px)')
     && K6norm.includes('--pad-w:clamp(620px,73vw,950px)'),
     {has:K6.has, head:K6.text.slice(0,120)});
  await p.setViewport({width:900, height:1200});
  await new Promise(r => setTimeout(r, 240));
  const K6b = await p.evaluate(() => {
    const R = s => { const r = document.querySelector(s).getBoundingClientRect();
      return {w:+r.width.toFixed(1), h:+r.height.toFixed(1), left:+r.left.toFixed(1)}; };
    return {vw:document.documentElement.clientWidth, vh:document.documentElement.clientHeight,
            sw:document.documentElement.scrollWidth,
            fs:parseFloat(getComputedStyle(document.body).fontSize),
            app:R('.app'), dock:R('.bottombar'),
            flexDir:getComputedStyle(document.querySelector('.bottombar')).flexDirection};
  });
  ok('K6b 900px 平板视口：占屏>=60% / 内容在侧栏右侧居中 / 左侧竖栏 / 字号>15 / 无横向溢出',
     K6b.app.w/K6b.vw >= 0.60
     && Math.abs((K6b.app.left - K6b.dock.w) - (K6b.vw - K6b.app.left - K6b.app.w)) < 2
     && Math.abs(K6b.dock.left) < 0.5 && K6b.dock.w < K6b.vw * 0.25
     && Math.abs(K6b.dock.h - K6b.vh) < 1 && K6b.flexDir === 'column'
     && K6b.fs > 15 && K6b.sw <= K6b.vw, K6b);
  /* ===== K7) v1.2.5 手机端上移 + 平板 dock 左侧竖栏（APK 内嵌页） ===== */
  // 900px 命中平板断点：body padding 被 em 值覆盖，4px/112px 固定值须切回 360px 手机视口验证
  const K7 = await p.evaluate(() => {
    const bar = document.querySelector('.bottombar');
    return {
      dockW:+bar.getBoundingClientRect().width.toFixed(1),
      dockLeft:+bar.getBoundingClientRect().left.toFixed(1),
      borderRight:getComputedStyle(bar).borderRightWidth,
      borderTop:getComputedStyle(bar).borderTopWidth,
      vw:document.documentElement.clientWidth
    };
  });
  ok('K7a 900px 平板视口 dock 改为左侧竖栏（left=0、栏宽<vw、无竖分隔线、无顶分隔线）',
     Math.abs(K7.dockLeft) < 0.5 && K7.dockW < K7.vw * 0.25
     && K7.borderRight === '0px' && K7.borderTop === '0px', K7);
  await p.setViewport({width:360, height:791});
  await new Promise(r => setTimeout(r, 240));
  const K7b = await p.evaluate(() => ({
    padTop:getComputedStyle(document.body).paddingTop,
    padBottom:getComputedStyle(document.body).paddingBottom,
    appPT:getComputedStyle(document.querySelector('.app')).paddingTop,
    tbTop:+document.querySelector('.topbar').getBoundingClientRect().top.toFixed(2),
    dockW:+document.querySelector('.bottombar').getBoundingClientRect().width.toFixed(1),
    vw:document.documentElement.clientWidth
  }));
  ok('K7b 360px 手机视口 body 顶 0px / .app 顶 5.67px / 底 46px（v1.3.0）/ dock 全宽 360',
     K7b.padTop === '0px' && K7b.appPT === '5.67px' && K7b.padBottom === '46px'
     && K7b.dockW === 360 && Math.abs(K7b.tbTop - 5.67) < 0.01, K7b);
  /* ===== K8) v1.2.5：平板竖屏贴顶 + 弹层垂直居中（APK 内嵌页） ===== */
  await p.setViewport({width:768, height:1024});
  await new Promise(r => setTimeout(r, 260));
  const K8 = await p.evaluate(() => {
    /* v1.4.5：「资产管理中枢」按键已移除，首行锚点改用顶栏第一个按键 */
    const app = document.querySelector('.app'), firstBx = document.querySelector('.topbar>.bx');
    return {bodyPT:getComputedStyle(document.body).paddingTop,
            appPT:getComputedStyle(app).paddingTop,
            appTop:+app.getBoundingClientRect().top.toFixed(2),
            bxTop:+firstBx.getBoundingClientRect().top.toFixed(2),
            railRight:getComputedStyle(document.querySelector('.bottombar')).borderRightWidth};
  });
  ok('K8 平板竖屏：body/.app 顶留白 0、首行按钮 top=0（黑边贴状态栏）、侧栏无竖线',
     K8.bodyPT === '0px' && K8.appPT === '0px' && K8.appTop === 0
     && Math.abs(K8.bxTop) < 0.01 && K8.railRight === '0px', K8);
  await p.click('#btnAdd');
  await new Promise(r => setTimeout(r, 460));
  const K8s = await p.evaluate(() => {
    const e = document.getElementById('sheet'); const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    return {top:+r.top.toFixed(2), bottom:+r.bottom.toFixed(2), vh:document.documentElement.clientHeight,
            bb:cs.borderBottomWidth, bbc:cs.borderBottomColor, btc:cs.borderTopColor};
  });
  ok('K8b v1.0.0 平板竖屏记账弹层垂直居中且四周 1px 实线',
     Math.abs(K8s.top - (K8s.vh - K8s.bottom)) < 2 && K8s.bb === '1px' && K8s.bbc === K8s.btc, K8s);
  await p.evaluate(() => document.getElementById('sheetClose').click());
  await new Promise(r => setTimeout(r, 240));
  /* ===== K9) v1.2.6：内容区字号分级 --fs-c（APK 内嵌页） ===== */
  const K9 = await p.evaluate(() => {
    const f = s => { const e = document.querySelector(s); return e ? +parseFloat(getComputedStyle(e).fontSize).toFixed(2) : null; };
    return {topbar:f('.bx'), rail:f('.bottombar>button'), month:f('.month-label'),
            kpi:f('.kpi'), day:f('.day'), sheet:f('.sheet-head'), numpad:f('.numpad button')};
  });
  /* v1.3.8：.kpi 在 --fs-c 基础上再缩 .86em → 19×0.88×0.86 ≈ 14.38 */
  ok('K9 平板竖屏：内容区字号 = 顶栏 × 0.88（16.72 vs 19），KPI 再缩 .86em，顶栏/侧栏/弹层仍 19',
     Math.abs(K9.month / K9.topbar - 0.88) < 0.002
     && Math.abs(K9.kpi / K9.topbar - 0.88 * 0.86) < 0.002
     && Math.abs(K9.day / K9.topbar - 0.88) < 0.002
     && K9.topbar === K9.rail && K9.topbar === K9.sheet && K9.topbar === K9.numpad, K9);
  await p.setViewport({width:360, height:791});
  await new Promise(r => setTimeout(r, 260));
  const K9b = await p.evaluate(() => {
    const f = s => +parseFloat(getComputedStyle(document.querySelector(s)).fontSize).toFixed(2);
    return {topbar:f('.bx'), month:f('.month-label'), day:f('.day')};
  });
  ok('K9b 手机 360：内容区字号与顶栏一致（--fs-c 默认=--fs，手机端零变化）',
     K9b.month === K9b.topbar && K9b.day === K9b.topbar, K9b);
  /* ===== K10) v1.2.7：记账页四类选项按字数排序 ===== */
  const KDB = {version:'1.2.8',
    accounts:[{id:'a1',name:'招商银行储蓄卡',kind:'asset',opening:900},
              {id:'a2',name:'微信',kind:'asset',opening:200},
              {id:'a3',name:'支付宝余额宝',kind:'asset',opening:300},
              {id:'a4',name:'现金',kind:'asset',opening:50},
              {id:'c1',name:'中信信用卡',kind:'credit',opening:-300,limit:5000},
              {id:'c2',name:'花呗',kind:'credit',opening:-100,limit:2000}],
    categories:{expense:['餐饮','宠物','交通费','日用','数码电器'],income:[],transfer:[],repay:[],reimburse:[]},
    tags:{expense:['出差','报销','聚会AA'],income:[],transfer:[],repay:[],reimburse:[]},
    tx:[],settings:{},meta:{},
    accountTypes:[{id:'asset',name:'资产账户',mode:'asset'},{id:'credit',name:'信贷账户',mode:'credit'}]};
  await p.evaluate(d => { applyDB(d); openSheet(); }, KDB);
  await new Promise(r => setTimeout(r, 220));
  const K10 = await p.evaluate(() => {
    const val = id => [...document.getElementById(id).options].map(o => o.value);
    const asc = a => a.slice(1).map(v => [...v].length).every((x,i,arr) => i === 0 || arr[i-1] <= x);
    return {cat:val('fCategory'), tag:val('fTag'), from:val('fFrom'), to:val('fTo'),
            ok:['fCategory','fTag','fFrom','fTo'].every(id => asc(val(id)))};
  });
  ok('K10 内嵌页四类选项按字数由少到多（空项仍在最前）',
     K10.ok && JSON.stringify(K10.cat) === JSON.stringify(['','餐饮','宠物','日用','交通费','数码电器'])
     && JSON.stringify(K10.tag) === JSON.stringify(['','出差','报销','聚会AA'])
     && JSON.stringify(K10.from) === JSON.stringify(['','微信','现金','花呗','中信信用卡','支付宝余额宝','招商银行储蓄卡']), K10);

  /* ===== K11) v1.2.8：资产页长按高亮（真实指针事件）+ 拖拽已下线 ===== */
  await p.evaluate(() => { closeSheet(); document.getElementById('tabAsset').click(); });
  await new Promise(r => setTimeout(r, 320));
  const kAt = (g, i) => p.evaluate((gg, n) => {
    const els = [...document.querySelectorAll('.asset-list .asset-group')[gg].querySelectorAll('.asset-item[data-acct]')];
    const r = els[n].getBoundingClientRect();
    return {id:els[n].dataset.acct, x:r.left + r.width/2, y:r.top + r.height/2};
  }, g, i);
  const k0 = await kAt(0, 0);
  await p.mouse.move(k0.x, k0.y);
  await p.mouse.down();
  await new Promise(r => setTimeout(r, 640));
  const kHold = await p.evaluate(() => ({d:!!document.querySelector('.asset-item.dragging'), ph:!!document.querySelector('.asset-ph')}));
  await p.mouse.up();
  await new Promise(r => setTimeout(r, 320));
  const K11 = await p.evaluate(() => ({
    order:[...document.querySelectorAll('.asset-list .asset-group')[0].querySelectorAll('.asset-item[data-acct]')].map(e => e.dataset.acct),
    hl:[...document.querySelectorAll('.asset-item.hl')].map(e => e.dataset.acct),
    bg:(() => { const e = document.querySelector('.asset-item.hl'); return e ? getComputedStyle(e).backgroundColor : ''; })(),
    store:(DB.settings.acctHl || []).slice(),
    stored:((JSON.parse(localStorage.getItem('amhub_v100_db') || '{}').settings || {}).acctHl || []).slice(),
    acct:document.getElementById('acctSheet').classList.contains('on')
  }));
  ok('K11 内嵌页长按 → 中灰高亮并落盘（不再有拖拽态、不误弹修改账户；顺序按 v1.2.8 排序规则：现金 50 → 微信 200 → 支付宝余额宝 300 → 招商银行储蓄卡 900）',
     !kHold.d && !kHold.ph && !K11.acct && K11.bg === 'rgb(153, 153, 153)'
     && JSON.stringify(K11.hl) === JSON.stringify([k0.id])
     && JSON.stringify(K11.store) === JSON.stringify([k0.id])
     && JSON.stringify(K11.stored) === JSON.stringify([k0.id])
     && JSON.stringify(K11.order) === JSON.stringify(['a4','a2','a3','a1']), {hold:kHold, got:K11});

  /* 长按「资产」清除全部高亮（APK 内嵌页同一套手势） */
  const kTab = await p.evaluate(() => { const r = document.getElementById('tabAsset').getBoundingClientRect(); return {x:r.left + r.width/2, y:r.top + r.height/2}; });
  await p.mouse.move(kTab.x, kTab.y);
  await p.mouse.down();
  await new Promise(r => setTimeout(r, 640));
  await p.mouse.up();
  await new Promise(r => setTimeout(r, 320));
  const K11b = await p.evaluate(() => ({
    hl:document.querySelectorAll('.asset-item.hl').length,
    store:(DB.settings.acctHl || []).length,
    tab:document.getElementById('tabAsset').classList.contains('active')
  }));
  ok('K11b 内嵌页长按「资产」清除全部高亮（并保持停在资产页）',
     K11b.hl === 0 && K11b.store === 0 && K11b.tab === true, K11b);

  /* ===== K12) v1.2.9：页脚版本行移除，面板底边直落到 .app 内容区下沿 ===== */
  const K12 = await p.evaluate(() => {
    const app = document.querySelector('.app'), panel = document.querySelector('.panel');
    const ar = app.getBoundingClientRect(), pr = panel.getBoundingClientRect();
    const appPadB = parseFloat(getComputedStyle(app).paddingBottom);
    return {
      hasVer: !!document.querySelector('.ver'),
      verRules: [...document.querySelectorAll('style')].some(s => /(^|\n)\s*\.ver\s*\{/.test(s.textContent)),
      text: (document.body.innerText.match(/资产管理中枢\s*v\d+\.\d+\.\d+/g) || []),
      gap: Math.round((ar.bottom - appPadB - pr.bottom) * 100) / 100,
      appPadB: appPadB
    };
  });
  ok('K12 内嵌页无页脚版本行（无 .ver 节点 / 无 .ver 规则 / 正文无「资产管理中枢 vX.Y.Z」），面板底边贴到 .app 内容区下沿',
     !K12.hasVer && !K12.verRules && K12.text.length === 0
     && Math.abs(K12.gap) < 0.5 && Math.abs(K12.appPadB - 7) < 0.01, K12);

  /* ===== K13) v1.2.10：dock 底部内距 4→2px（按钮下边框到屏幕底边的间距减半） ===== */
  await p.setViewport({width:360, height:791});
  await new Promise(r => setTimeout(r, 240));
  const K13 = await p.evaluate(() => {
    const dock = document.querySelector('.bottombar');
    const cs = getComputedStyle(dock);
    const btns = [...dock.querySelectorAll('button')];
    const R = v => Math.round(v * 100) / 100;
    const btnBottom = Math.max(...btns.map(e => e.getBoundingClientRect().bottom));
    const dr = dock.getBoundingClientRect();
    return {
      vh: innerHeight, gapBtnToVH: R(innerHeight - btnBottom),
      dockH: R(dr.height), dockTop: R(dr.top),
      padTop: cs.paddingTop, padLeft: cs.paddingLeft, padB: cs.paddingBottom,
      btnH: btns.map(e => R(e.getBoundingClientRect().height)),
      btnW: btns.map(e => R(e.getBoundingClientRect().width)),
      panelBottom: R(document.querySelector('.panel').getBoundingClientRect().bottom)
    };
  });
  ok('K13 v1.4.1 内嵌页四框上移 6px（按钮底边距屏幕底 2→8px），dock 盒高仍 45px',
     Math.abs(K13.gapBtnToVH - 8) < 0.01 && Math.abs(K13.dockH - 45) < 0.01, K13);
  ok('K13b dock 内距 7 / 10 / 10 / 2（左右 9→10），按钮改四项等分 × 36（86.5 起算，四块同宽）；面板底 738、与 dock 顶留 8px',
     K13.padTop === '7px' && K13.padLeft === '10px' && K13.padB === '2px'
     && K13.btnH.length === 4 && K13.btnH.every(h => h === 36)
     && new Set(K13.btnW).size === 1
     && Math.abs(K13.panelBottom - 738) < 0.6
     && Math.abs(K13.dockTop - K13.panelBottom - 8) < 0.6, K13);

  /* ---- K14 v1.3.1：产物内嵌页的标签列对齐（不只是源码，APK 里也要生效） ---- */
  const K14 = await p.evaluate(() => {
    const tx = [
      {id:'a',type:'expense',date:'2026-11-08',time:'22:23',category:'奶茶',note:'爷爷不泡茶',from:'支付宝',to:'',tag:'淘宝闪购',amount:1.97},
      {id:'b',type:'expense',date:'2026-11-08',time:'22:22',category:'便利店',note:'',from:'微信',to:'',tag:'淘宝闪购',amount:0.30},
      {id:'c',type:'expense',date:'2026-11-08',time:'22:37',category:'水果',note:'小吃谷·芒草鲜果',from:'中信银行信用卡',to:'',tag:'淘宝闪购',amount:5.71},
      {id:'d',type:'expense',date:'2026-11-08',time:'22:16',category:'便利店',note:'',from:'支付宝',to:'',tag:'',amount:1.00}
    ];
    DB.tx = tx; S.date = '2026-11-08'; S.tab = 'bill'; renderFlow();
    const R = e => e.getBoundingClientRect();
    const rows = [...document.querySelectorAll('.flow-row')];
    const tagged = rows.filter(r => r.querySelector('.line1 .r.has-tag'));
    const plain  = rows.filter(r => !r.querySelector('.line1 .r.has-tag'));
    const src = document.documentElement.outerHTML;
    return {
      amtR: rows.map(r => +R(r.querySelector('.line1 .r')).right.toFixed(2)),
      tagBeforeAmt: tagged.every(r => {
        const t = r.querySelector('.line1 .r .tag'), a = r.querySelector('.line1 .r .amt');
        return t && a && R(t).right < R(a).left;
      }),
      taggedN: tagged.length, plainN: plain.length,
      r2HTML: tagged.map(r => r.querySelector('.line2 .r').outerHTML),
      r2HasTag: tagged.some(r => r.querySelector('.line2 .r.has-tag')),
      hasNewCss: src.indexOf('.line1 .r.has-tag .tag{display:inline-block;') >= 0
        && src.indexOf('<span class="sep">|</span><span class="amt">') >= 0,
      hasV136Css: src.indexOf('.line1 .r.has-tag{display:inline-flex;align-items:center;justify-content:flex-end}') >= 0
        && src.indexOf('.line1 .r.has-tag .sep{color:inherit}') >= 0
        && src.indexOf('.line .l .piece.nc{color:inherit;font-size:inherit;white-space:nowrap}') >= 0,
      noOldCss: !/grid-template-columns:var\(--tag-w/.test(src)
        && !/\.line2 \.r\.has-tag/.test(src) && !/class="acct"/.test(src)
        && typeof measureTagSlots !== 'function'
    };
  });
  const krng = a => Math.max.apply(null, a) - Math.min.apply(null, a);
  ok('K14 内嵌页含 v1.3.5 金额前标签 CSS，两槽机制 / 测量函数零残留',
     K14.hasNewCss && K14.noOldCss, K14);
  ok('K14b 内嵌页真实 DOM：3 条带标签流水的标签均在金额左侧、金额右边缘零漂移',
     K14.taggedN === 3 && K14.tagBeforeAmt && krng(K14.amtR) < 0.01, K14);
  ok('K14c v1.3.6 内嵌页含 inline-flex 中线对齐 + 标签|正文色 + 不计入正文色 CSS',
     K14.hasV136Css, K14);
  ok('K14c 内嵌页第二行仅纯账户串（不再拆槽），无标签行仍是 v1.3.0 单串',
     K14.plainN === 1 && !K14.r2HasTag
     && K14.r2HTML.every(h => h.indexOf('<span class="r" title="账户">') === 0), K14);


  /* ===== K15) v1.4.1：APK 内嵌页三块直出 + 顶边 / 竖线 / 页签 / 四框上移 + 末条底边 / KPI ===== */
  const K15 = await p.evaluate(() => {
    document.getElementById('tabOv').click();
    const src = document.documentElement.outerHTML;
    const R = e => e.getBoundingClientRect();
    const st = e => getComputedStyle(e);
    const blocks = [...document.querySelectorAll('#flow .ov-heat')];
    const cells = [...document.querySelectorAll('#flow .ov-cell')];
    const sep = blocks[0].querySelector('.ov-sep');
    const tabA = document.querySelector('.tab.active'), tabI = document.querySelector('.tab:not(.active)');
    const bar = document.querySelector('.bottombar'), btns = [...bar.querySelectorAll('button')];

    /* v1.4.1：总览侧所有节点的量测必须在切到账单页之前完成——切页后它们脱离 #flow，
       getComputedStyle 会返回空串、getBoundingClientRect 会归零。先缓存成局部量。 */
    const nBlocks = blocks.length, kinds = blocks.map(b => b.dataset.ovKind),
      titles = blocks.map(b => b.querySelector('.ov-heat-title').textContent);
    const borderTop = blocks.map(b => st(b).borderTopWidth);
    const gaps = blocks.slice(1).map((b, i) => +(R(b).top - R(blocks[i]).bottom).toFixed(2));
    const nCells = cells.length,
      labels = cells.slice(0, 12).map(c => c.querySelector('.ov-mo').textContent),
      entries = document.querySelectorAll('.ov-entry,[data-ov-back],[data-ov-page]').length;
    const sepFs = st(sep).fontSize, sepColor = st(sep).color,
      titleFs = st(blocks[0].querySelector('.ov-heat-title')).fontSize;
    const tabW = st(tabA).fontWeight, tabWI = st(tabI).fontWeight,
      tabFs = st(tabA).fontSize, tabFsI = st(tabI).fontSize;
    const btnTop = btns.map(b => st(b).top),
      btnGap = +(innerHeight - Math.max(...btns.map(b => R(b).bottom))).toFixed(2),
      dockH = +R(bar).height.toFixed(2), dockPadB = st(bar).paddingBottom;

    document.getElementById('tabBill').click();       // 再切账单，量末条底边 / KPI
    const last = document.querySelector('.flow-list .flow-row:last-child');
    return {
      src: src,
      nBlocks, kinds, titles, borderTop, gaps, nCells, labels, entries,
      sepFs, sepColor, titleFs, tabW, tabWI, tabFs, tabFsI,
      btnTop, btnGap, dockH, dockPadB,
      lastBorder: last ? st(last).borderBottomWidth : null,
      listPad: st(document.querySelector('.flow-list') || document.body).paddingBottom,
      kpiFs: parseFloat(st(document.querySelector('#dayKpi')).fontSize),
      panelFs: parseFloat(st(document.querySelector('.panel')).fontSize)
    };
  });
  ok('K15 v1.0.0 APK 内嵌页：末条流水 1px 底边，列表底部留 8px 不叠大黑边',
     (K15.lastBorder === null || K15.lastBorder === '1px')
     && K15.src.indexOf('.flow-list .flow-row:last-child{border-bottom:0}') < 0
     && K15.src.indexOf('gap:var(--flow-gap);padding-bottom:8px}') >= 0, K15.lastBorder);
  ok('K15b APK 内嵌页：KPI 缩到面板字号 86%',
     Math.abs(K15.kpiFs / K15.panelFs - 0.86) < 0.01
     && K15.src.indexOf('gap:2px;font-size:.86em;white-space:nowrap}') >= 0,
     {kpi:K15.kpiFs, panel:K15.panelFs});
  ok('K15c APK 内嵌页：三块直出（结余 / 收入 / 支出）12 格 × 3 = 36 格，入口卡 / 返回键零残留',
     K15.nBlocks === 3 && JSON.stringify(K15.kinds) === JSON.stringify(['bal','inc','exp'])
     && JSON.stringify(K15.titles) === JSON.stringify(['本年结余','本年收入','本年支出'])
     && K15.nCells === 36 && K15.entries === 0
     && K15.labels.join(',') === '1,2,3,4,5,6,7,8,9,10,11,12'
     && K15.src.indexOf('<span>分类支出</span>') < 0, K15);
  ok('K15d v1.0.0 三块顶边都画出 1px（收入 / 支出不再开口），块间仍是 6px 白隙',
     K15.borderTop.every(w => w === '1px') && K15.gaps.length === 2
     && K15.gaps.every(g => Math.abs(g - 6) < 0.6), {tops:K15.borderTop, gaps:K15.gaps});
  ok('K15e v1.4.1 竖线与标题同字号且为正文色；选中页签与未选页签同字重同字号',
     K15.sepFs === K15.titleFs && K15.sepColor === 'rgb(18, 22, 29)'
     && K15.tabW === K15.tabWI && K15.tabFs === K15.tabFsI,
     {sep:[K15.sepFs,K15.sepColor], title:K15.titleFs, tab:[K15.tabW,K15.tabWI]});
  ok('K15f v1.4.1 四个框上移 6px（top:-6px / 底边距视口 8px），dock 盒高与内距不变',
     K15.btnTop.every(t => t === '-6px') && Math.abs(K15.btnGap - 8) < 0.05
     && Math.abs(K15.dockH - 45) < 0.05 && K15.dockPadB === '2px', K15);
  ok('K15g 6 列网格、本年格已取消、无深浅、月份格不可点',
     K15.src.indexOf('grid-template-columns:repeat(6,minmax(0,1fr))') >= 0
     && K15.src.indexOf('ov-year') < 0
     && K15.src.indexOf('data-ov-month') < 0 && K15.src.indexOf('--heat') < 0, K15.nCells);

  /* ===== K16) v1.4.2：APK 内嵌页全站小圆弧（真机壳里同样是 WebView，量的是同一套 CSS） ===== */
  const K16 = await p.evaluate(() => {
    document.getElementById('tabOv').click();
    const cs = e => getComputedStyle(e);
    const px = v => parseFloat(v);
    const q = s => document.querySelector(s);
    const blocks = [...document.querySelectorAll('#flow .ov-heat')];
    const cells = [...document.querySelectorAll('#flow .ov-cell')];
    const btns = [...document.querySelectorAll('.bottombar>button')];
    // 先取总览侧所有样式：切到账单页会重绘 #flow，旧节点引用会失效
    const ovPanel = px(cs(q('.panel')).borderTopLeftRadius);   // 总览/资产面板已去外框
    const panelOv = cs(q('.panel')).overflow;
    const heat = blocks.map(b => cs(b).borderTopLeftRadius);
    const heatOv = cs(blocks[0]).overflow;
    const cell = [...new Set(cells.map(c => cs(c).borderTopLeftRadius))];
    document.getElementById('tabBill').click();
    const billPanel = px(cs(q('.panel')).borderTopLeftRadius); // 账单页 .panel 仍四角
    document.getElementById('tabOv').click();
    return {
      rTok: cs(document.documentElement).getPropertyValue('--r').trim(),
      rsTok: cs(document.documentElement).getPropertyValue('--r-s').trim(),
      panel: ovPanel, billPanel,
      panelOv,
      heat, heatOv, cell,
      bx: px(cs(q('.bx')).borderTopLeftRadius),
      btn: btns.map(b => [cs(b).borderTopLeftRadius, cs(b).borderTopRightRadius,
                          cs(b).borderBottomRightRadius, cs(b).borderBottomLeftRadius])
    };
  });
  ok('K16 v1.0.0 半径令牌 8px / 4px：三页面板全去外框 0、本年卡片四角 8px 并裁切内层',
     K16.rTok === '8px' && K16.rsTok === '4px' && K16.panel === 0 && K16.billPanel === 0
     && K16.panelOv === 'hidden'
     && K16.heat.length === 3 && K16.heat.every(v => v === '8px') && K16.heatOv === 'hidden', K16);
  const pxN = v => parseFloat(v);          // Node 侧取数值
  ok('K16b v1.0.0 控件 4px（顶栏按钮）、月份格保持直角、dock 四块全圆 8px',
     K16.bx === 4 && K16.cell.length === 1 && pxN(K16.cell[0]) === 0
     && K16.btn.length === 4 && K16.btn.every(b => b.join('/') === '8px/8px/8px/8px'), K16);

  /* ===== K17) v1.4.3：内嵌页顶栏六格 + 总览 0 值不加号 ===== */
  const K17 = await p.evaluate(() => {
    document.getElementById('tabOv').click();
    const R = e => e.getBoundingClientRect();
    const bar = document.querySelector('.topbar');
    const btns = [...bar.querySelectorAll('button')];
    const cells = [...document.querySelectorAll('.ov-val')];
    return {
      ids: btns.map(b => b.id),
      w: btns.map(b => +R(b).width.toFixed(2)),
      h: btns.map(b => +R(b).height.toFixed(2)),
      barScroll: bar.scrollWidth, barClient: bar.clientWidth,
      spacer: bar.querySelectorAll('.spacer').length,
      sums: [...document.querySelectorAll('.ov-heat-sum')].map(e => e.textContent.trim()),
      vals: cells.map(c => c.textContent.trim()),
      cards: [...document.querySelectorAll('.ov-cards .card')].map(c => c.querySelector('.val').textContent.trim()),
      cellEllipsis: cells.filter(c => c.scrollWidth > c.clientWidth + 1).length,
      cssSigned: document.documentElement.outerHTML.indexOf('function signedMoney(kind, v){') > -1,
      hasAdd: document.querySelectorAll('#flow #btnAddAccount').length
    };
  });
  const kr17 = a => Math.max.apply(null, a) - Math.min.apply(null, a);
  ok('K17 v1.4.5 内嵌页顶栏五格顺序正确、四功能键等宽、五格同高（「资产管理中枢」已移除）',
     K17.ids.join(',') === 'btnSettings,btnBackup,btnRestore,btnTheme,btnAddAccount'
     && kr17(K17.w.slice(0, 4)) < 0.6
     && Math.abs(K17.w[4] - K17.w[0]) > 0.5
     && K17.h.every(v => Math.abs(v - 32) < 0.6), K17);
  ok('K17b v1.4.3 内嵌页无弹性空档、无横向溢出，资产页内已无新增账户按钮',
     K17.spacer === 0 && K17.barScroll <= K17.barClient + 1 && K17.hasAdd === 0, K17);
  ok('K17c v1.4.3 内嵌页金额带号：非 0 值必带 +/-，0 仍是 0.00，36 格无一被截断',
     K17.cssSigned
     && K17.vals.length === 36
     && K17.vals.every(v => v === '0.00' || v[0] === '+' || v[0] === '-')
     && K17.sums.length === 3
     && K17.sums.every(v => v === '0.00' || v[0] === '+' || v[0] === '-')
     && K17.sums.some(v => v !== '0.00')
     && K17.cards.length === 6 && K17.cards.every(v => /^[+\-\d]/.test(v))
     && K17.cellEllipsis === 0, K17);

  await b.close();
  console.log(`\n========== APK 内嵌页冒烟: ${pass} PASS / ${fail} FAIL ==========`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
