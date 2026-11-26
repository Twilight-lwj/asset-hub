/* 资产管理中枢 v1.0.0 真实 DOM 回归（puppeteer-core + 真实 Chrome，268 项）：
   覆盖账页/资产页几何、dock 独立边框、账单页去外框、备份双写、明暗主题、紧凑选项弹层。
   运行前需设置 AMHUB_FIXTURE 指向脱敏备份 JSON（缺省查找同级 ledger_fixture_v110.json）。 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const HTML = 'file://' + path.resolve(__dirname, '..', '资产管理中枢_浏览器版.html');
const SHOT = process.env.AMHUB_SHOT_DIR || require('os').tmpdir();
const FIXTURE_PATH = process.env.AMHUB_FIXTURE || path.join(__dirname, 'ledger_fixture_v110.json');
const FIXTURE = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
};
const wait = ms => new Promise(r => setTimeout(r, ms));
const box = e => { const r = e.getBoundingClientRect(); return {left:+r.left.toFixed(1),right:+r.right.toFixed(1),top:+r.top.toFixed(1),bottom:+r.bottom.toFixed(1),width:+r.width.toFixed(1),height:+r.height.toFixed(1)}; };

const NATIVE_STUB = () => {
  window.__nsCalls = [];
  window.PnlAndroid = {
    nsRequest: function(){ window.__nsCalls.push([...arguments]); },
    exportBackup: function(n, j){ window.__export = {name:n, json:j}; },
    toast: function(){}, quitApp: function(){}, setSystemBars: function(){ (window.__bars = window.__bars || []).push([...arguments]); }
  };
};
const FETCH_STUB = () => {
  window.__nsFetch = [];
  const orig = window.fetch;
  window.fetch = function(url, opt){
    if(String(url) === '/ns'){
      window.__nsFetch.push({url:String(url), method:(opt&&opt.method)||'', headers:(opt&&opt.headers)||{}, body:(opt&&opt.body)||null});
      return Promise.resolve({ok:true, status:200, json:()=>Promise.resolve({ok:true})});
    }
    return orig.apply(this, arguments);
  };
};

(async () => {
  const browser = await puppeteer.launch({
    executablePath:'/usr/bin/google-chrome', headless:'new',
    args:['--no-sandbox','--disable-dev-shm-usage','--allow-file-access-from-files']
  });

  /* ================= p：桌面/浏览器通道（无原生桥，fetch 打桩） ================= */
  const p = await browser.newPage();
  await p.setViewport({width:470, height:1000, deviceScaleFactor:2});
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.evaluateOnNewDocument(FETCH_STUB);
  await p.goto(HTML, {waitUntil:'load'});
  await p.evaluate(() => { try { localStorage.clear(); } catch(e){} });
  await p.reload({waitUntil:'load'});

  console.log('\n===== A) 出厂空数据 / 版本 / 脱敏 =====');
  /* v1.3.7：开屏页是「总览」—— 先量开屏态，再切到账单页量「无流水」空态 */
  const OVA = await p.evaluate(() => ({
    tab: S.tab,
    ovActive: document.getElementById('tabOv').classList.contains('active'),
    calHidden: document.getElementById('cal').hidden,
    dateHidden: document.getElementById('dateBar').hidden,
    cards: document.querySelectorAll('#flow .card').length,
    labels: [...document.querySelectorAll('#flow .card .lab')].map(e => e.textContent),
    ids: [...document.querySelectorAll('.bottombar>button')].map(e => e.id),
    cells: document.querySelectorAll('#flow .ov-cell').length,
    entries: document.querySelectorAll('#flow [data-ov-page]').length,
    entryKeys: [...document.querySelectorAll('#flow [data-ov-page]')].map(e => e.dataset.ovPage),
    entryVals: [...document.querySelectorAll('#flow .ov-entry .val')].map(e => e.textContent),
    blocks: document.querySelectorAll('#flow .ov-block').length,
    heats: document.querySelectorAll('#flow .ov-heat').length,
    titles: [...document.querySelectorAll('#flow .ov-heat-title')].map(e => e.textContent),
    emptyTip: (document.querySelector('#flow .asset-empty') || {}).textContent || ''
  }));
  ok('A0 开屏页就是总览：六卡（资产 3 + 本月 3）+ 三块本年网格（36 格），无入口卡 / 无独立页，日历与日期条隐藏、dock 四项',
     OVA.tab === 'overview' && OVA.ovActive && OVA.calHidden && OVA.dateHidden
     && OVA.cards === 6 && OVA.entries === 0 && OVA.heats === 3 && OVA.cells === 36
     && JSON.stringify(OVA.labels) === JSON.stringify(['总资产','资产账户','信贷账户','本月支出','本月收入','本月结余'])
     && JSON.stringify(OVA.ids) === JSON.stringify(['tabOv','tabBill','tabAsset','btnAdd'])
     && OVA.blocks === 0, OVA);
  ok('A0b v1.3.9 入口卡 / 返回键与 v1.3.8 两榜零残留；三块标题为结余 / 收入 / 支出',
     OVA.blocks === 0 && OVA.emptyTip === '' && OVA.entries === 0
     && OVA.entryKeys.length === 0 && OVA.entryVals.length === 0
     && JSON.stringify(OVA.titles) === JSON.stringify(['本年结余','本年收入','本年支出']), OVA);
  await p.evaluate(() => document.getElementById('tabBill').click());
  const A = await p.evaluate(() => ({
    ver:document.querySelector('.app').dataset.version,
    title:document.title,
    tx:DB.tx.length, accounts:DB.accounts.length,
    types:DB.accountTypes.map(x=>x.mode),
    empty:document.querySelector('.empty') ? document.querySelector('.empty').textContent : '',
    stubs:document.querySelectorAll('[data-stub]').length,
    hasBackup:!!document.getElementById('btnBackup'),
    hasRestore:!!document.getElementById('btnRestore'),
    html:(()=>{const s=document.documentElement.outerHTML; return {
      secret:/[0-9A-Za-z._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(s),
      oldData:s.includes('便利店')||s.includes('t13tibezl')
    };})()
  }));
  ok('A1 页面版本 v1.0.0', A.ver === '1.0.0' && A.title === '资产管理中枢 v1.0.0', A);
  ok('A2 出厂无内置流水', A.tx === 0, A.tx);
  ok('A3 出厂无内置资产', A.accounts === 0, A.accounts);
  ok('A4 保留 asset/credit 两类账户型', JSON.stringify(A.types) === '["asset","credit"]', A.types);
  ok('A5 账单页显示无流水空态', A.empty.includes('无流水'), A.empty);
  ok('A6 占位按钮已全部启用', A.stubs === 0 && A.hasBackup && A.hasRestore, A);
  ok('A7 成品零凭据', A.html.secret === false, A.html);
  ok('A8 成品零内置业务数据', A.html.oldData === false, A.html);
  ok('A9 初始无运行时错误', errors.length === 0, errors);

  console.log('\n===== B) 需求1 标签文本对齐账户文本（真实计算样式） =====');
  const B = await p.evaluate(() => {
    const sample = {id:'probe', type:'expense', date:S.date, time:'12:30', category:'便利店',
      tag:'餐饮', note:'测试备注', amount:100, discount:4, off:1, cashback:0.5, fee:0.2,
      reimbursed:0, from:'微信', to:''};
    const holder = document.createElement('div');
    holder.innerHTML = '<div class="flow-list">' + rowHTML(sample) + '</div>';
    holder.style.cssText = 'position:absolute;left:0;top:0;width:412px;visibility:hidden';
    document.body.appendChild(holder);
    /* v1.3.5 起标签在第一行金额前，第二行只剩账户；v1.3.1 的两槽（.tag / .acct）已停用 */
    const cell = holder.querySelector('.line1 .r.has-tag');
    const tag = cell && cell.querySelector('.tag');
    const sep = cell && cell.querySelector('.sep');
    const amt = cell && cell.querySelector('.amt');
    const cs = tag ? getComputedStyle(tag) : {}, csC = getComputedStyle(cell);
    const out = {
      found:!!tag, vertical:cs.verticalAlign || '', tagLH:cs.lineHeight || '',
      tagFS:cs.fontSize || '', amtFS:amt ? getComputedStyle(amt).fontSize : '',
      border:cs.borderTopWidth || '', marginRight:cs.marginRight || '',
      firstIsTag:!!tag && cell.firstElementChild === tag,
      sepAfterTag:!!sep && sep.previousElementSibling === tag,
      inLine1:!!holder.querySelector('.line1 .r .tag'),
      inLine2:!!holder.querySelector('.line2 .r .tag'),
      acctSlot:!!holder.querySelector('.line2 .r .acct'),
      display:csC.display, alignItems:csC.alignItems,
      hasTagCls:cell.classList.contains('has-tag'),
      tagTextAlign:cs.textAlign || '',
      tagTop:tag ? +tag.getBoundingClientRect().top.toFixed(1) : 0,
      cellTop:cell ? +cell.getBoundingClientRect().top.toFixed(1) : 0
    };
    holder.remove();
    return out;
  });
  ok('B0 构造带标签的流水条成功（防假阳性）', B.found === true, B);
  /* vertical-align 的初始值就是 baseline，读计算值判不出「有没有写」——
     改为在样式表里查 .tag 规则是否还带 vertical-align（v1.3.6 已拆掉这个陷阱）。 */
  const cssAll = await p.evaluate(() => [...document.styleSheets]
    .map(sh => [...sh.cssRules].map(r => r.cssText).join('\n')).join('\n'));
  ok('B1 .tag 规则不再写 vertical-align（中线对齐由 flex 接管）',
     !/\.line1 \.r\.has-tag \.tag\s*\{[^}]*vertical-align/.test(cssAll), B.vertical);
  /* v1.3.6：行内齐平改由 .line1 .r.has-tag 的 flex 中线对齐负责（inline-block+overflow
     的基线陷阱已拆），故这里按新语义重算，不是放宽断言。grid item 会被 Chrome 块化成 flex。 */
  ok('B2 标签与金额按 flex 中线对齐（align-items:center），字号仍一致',
     (B.display === 'flex' || B.display === 'inline-flex') && B.alignItems === 'center'
     && B.tagFS === B.amtFS, B);
  ok('B3 标签仍无黑框', B.border === '0px', B);
  /* v1.3.5：标签随金额浮动，形成「标签|金额」连续串，不再有第二行的独立账户槽 */
  ok('B4 「标签|金额」成串：标签是右列首元素、其后紧跟分隔符，第二行无标签 / 无 .acct 槽',
     B.hasTagCls && B.firstIsTag && B.sepAfterTag && !B.inLine2 && !B.acctSlot
     && B.marginRight === '0px', B);
  ok('B5 标签字号与金额一致', B.tagFS === B.amtFS, B);

  console.log('\n===== C) 需求3/4/5 资产页灰线 · dock 固定 · 滚动条 =====');
  const C = await p.evaluate(() => {
    document.getElementById('tabAsset').click();
    const sub = document.querySelector('.asset-row.subtotal');
    const csSub = getComputedStyle(sub);
    const dock = document.querySelector('.bottombar');
    const cs = getComputedStyle(dock);
    const all = [...document.styleSheets[0].cssRules].map(r=>r.cssText).join('\n');
    return {
      subBorder:csSub.borderBottomWidth, subStyle:csSub.borderBottomStyle,
      docScroll:getComputedStyle(document.body).scrollbarWidth,
      htmlScroll:getComputedStyle(document.documentElement).scrollbarWidth,
      webkitRule:/::-webkit-scrollbar\s*\{[^}]*display:\s*none/.test(all),
      dockPosition:cs.position, dockBottom:cs.bottom, dockZ:cs.zIndex,
      dockBorderTop:cs.borderTopWidth, dockBg:cs.backgroundColor,
      btnH:+document.querySelector('#tabBill').getBoundingClientRect().height.toFixed(1),
      bodyPad:getComputedStyle(document.body).paddingBottom,
      addBtn:!!document.getElementById('btnAddAccount'),
      emptyTip:!!document.querySelector('.asset-empty'),
      totalRowGone:!document.querySelector('.asset-row.total'),
      summaryTotal:(document.querySelector('#assetSummary .card .val')||{}).textContent||'',
      running:getComputedStyle(document.documentElement).getPropertyValue('--fs').trim()
    };
  });
  ok('C1 账户合计下方灰线去除', C.subBorder === '0px', C);
  ok('C2 滚动条隐藏（标准属性）', C.docScroll === 'none' && C.htmlScroll === 'none', C);
  ok('C3 滚动条隐藏（webkit）', C.webkitRule === true, C.webkitRule);
  ok('C4 dock 固定定位', C.dockPosition === 'fixed' && C.dockBottom === '0px', C);
  ok('C5 dock 层级高于正文', +C.dockZ >= 30, C.dockZ);
  ok('C6 dock 顶部无分隔线（v1.2.5 撤线；按钮外框仍 2px）', C.dockBorderTop === '0px', C.dockBorderTop);
  ok('C7 dock 按钮高度优化为 36px', Math.abs(C.btnH - 36) < 1, C.btnH);
  ok('C8 body 预留 dock 空间（v1.3.0：46px ＝ dock 45px + 呼吸 8px − .app 底 7px）',
     Math.abs(parseFloat(C.bodyPad) - 46) < 0.6, C.bodyPad);
  ok('C9 资产页可新增账户', C.addBtn === true, C);
  ok('C10 空资产有引导文案', C.emptyTip === true, C);
  ok('C11 底部总资产行已移除、顶部汇总卡仍在且为 0.00', C.totalRowGone === true && C.summaryTotal.includes('0.00'), C);

  console.log('\n===== D) 需求2 资产新增 / 修改 / 删除 + 持久化 =====');
  await p.evaluate(() => document.getElementById('btnAddAccount').click());
  const D0 = await p.evaluate(() => ({
    open:acctOpen(), title:document.getElementById('acctTitle').textContent,
    delHidden:document.getElementById('aDel').hidden,
    limitHidden:document.getElementById('aLimitItem').hidden
  }));
  ok('D1 点新增打开「新增账户」弹层', D0.open && D0.title === '新增账户', D0);
  ok('D2 新增态隐藏删除按钮', D0.delHidden === true, D0);
  ok('D3 资产账户隐藏信用额度', D0.limitHidden === true, D0);
  await p.evaluate(() => {
    document.getElementById('aName').value = '测试银行卡';
    document.getElementById('aBalance').value = '1234.56';
    document.getElementById('aSave').click();
  });
  const D1 = await p.evaluate(() => ({
    n:DB.accounts.length, name:DB.accounts[0].name, opening:DB.accounts[0].opening,
    kind:DB.accounts[0].kind, bal:balanceOf(DB.accounts[0]),
    row:document.querySelector('[data-acct]') ? document.querySelector('[data-acct]').textContent : '',
    stored:JSON.parse(localStorage.getItem('amhub_v100_db')||'{}').accounts.length
  }));
  ok('D4 新增账户写入 DB', D1.n === 1 && D1.name === '测试银行卡', D1);
  ok('D5 填写余额反推期初正确', D1.opening === 1234.56 && D1.bal === 1234.56, D1);
  ok('D6 资产账户 kind 映射正确', D1.kind === 'asset', D1);
  ok('D7 资产页渲染可点击账户行', D1.row.includes('测试银行卡') && D1.row.includes('1234.56'), D1.row);
  ok('D8 改动已落 localStorage', D1.stored === 1, D1);
  await p.evaluate(() => document.querySelector('[data-acct]').click());
  const D2 = await p.evaluate(() => ({
    title:document.getElementById('acctTitle').textContent,
    name:document.getElementById('aName').value,
    bal:document.getElementById('aBalance').value,
    delHidden:document.getElementById('aDel').hidden
  }));
  ok('D9 点账户行进入「修改账户」', D2.title === '修改账户' && D2.name === '测试银行卡', D2);
  ok('D10 修改态回填余额', D2.bal === '1234.56', D2);
  ok('D11 修改态显示删除按钮', D2.delHidden === false, D2);
  await p.evaluate(() => {
    document.getElementById('aKind').value = 'credit';
    document.getElementById('aKind').dispatchEvent(new Event('change'));
    document.getElementById('aLimit').value = '30000';
    document.getElementById('aBalance').value = '-14000';
    document.getElementById('aSave').click();
  });
  const D3 = await p.evaluate(() => ({
    kind:DB.accounts[0].kind, mode:modeOfKind(DB.accounts[0].kind), limit:DB.accounts[0].limit,
    bal:balanceOf(DB.accounts[0]),
    creditMeta:document.querySelector('.credit-meta') ? document.querySelector('.credit-meta').textContent : '',
    cards:[...document.querySelectorAll('.asset-summary .card .val')].map(x=>x.textContent)
  }));
  ok('D12 信贷类型映射正确', D3.kind === 'credit' && D3.mode === 'credit', D3);
  ok('D13 余额与额度修改生效', D3.bal === -14000 && D3.limit === 30000, D3);
  ok('D14 信贷已用/可用行仍渲染', D3.creditMeta.includes('已用14000.00/30000.00') && D3.creditMeta.includes('可用16000.00'), D3.creditMeta);
  ok('D15 顶部三卡片金额两位小数', D3.cards.every(x=>/^-?\d+\.\d{2}$/.test(x)), D3.cards);
  await p.reload({waitUntil:'load'});
  const D4 = await p.evaluate(() => {
    document.getElementById('tabAsset').click();
    return {n:DB.accounts.length, kind:modeOfKind(DB.accounts[0].kind), bal:balanceOf(DB.accounts[0])};
  });
  ok('D16 刷新后账户修改不丢', D4.n === 1 && D4.kind === 'credit' && D4.bal === -14000, D4);
  await p.evaluate(() => {
    document.querySelector('[data-acct]').click();
    document.getElementById('aDel').click();
  });
  const D5 = await p.evaluate(() => ({armed:document.getElementById('aDel').textContent, n:DB.accounts.length}));
  ok('D17 删除需二次确认', D5.armed.includes('再点一次') && D5.n === 1, D5);
  await p.evaluate(() => document.getElementById('aDel').click());
  const D6 = await p.evaluate(() => ({n:DB.accounts.length}));
  ok('D18 二次确认后删除账户', D6.n === 0, D6);

  console.log('\n===== E) 需求6/7/9 导入导出、恢复备份、清空 =====');
  const bad = JSON.parse(JSON.stringify(FIXTURE));
  bad.settings.backup = {user:'evil@example.com', pass:'evil-app-pass'};
  const E = await p.evaluate(d => {
    const o = applyDB(d);
    return {tx:o.tx.length, accounts:o.accounts.length, hasBackup:!!DB.settings.backup,
            secret:JSON.stringify(DB).includes('evil-app-pass'),
            stored:JSON.parse(localStorage.getItem('amhub_v100_db')||'{}'),
            rows:document.querySelectorAll('.flow-row').length};
  }, bad);
  ok('E1 导入 70 笔流水', E.tx === 70, E.tx);
  ok('E2 导入 11 个账户', E.accounts === 11, E.accounts);
  ok('E3 导入剔除 settings.backup 凭据', E.hasBackup === false && E.secret === false, E);
  ok('E4 导入后落盘且不含凭据', E.stored.tx.length === 70 && !JSON.stringify(E.stored).includes('evil-app-pass'), Object.keys(E.stored));
  ok('E5 导入后当天流水渲染', E.rows > 0, E.rows);
  const E2 = await p.evaluate(() => {
    const o = dataForSync();
    return {app:o.__app, ver:o.__ver, hasBackup:!!o.settings.backup, hasNutstore:('nutstore' in o),
            hasSecret:JSON.stringify(o).includes('evil-app-pass'), tx:o.tx.length};
  });
  ok('E6 导出标记产品与版本', E2.app === '资产管理中枢' && E2.ver === 'v1.0.0', E2);
  ok('E7 导出数据剔除凭据', !E2.hasBackup && !E2.hasNutstore && !E2.hasSecret, E2);
  ok('E8 导出含全部流水', E2.tx === 70, E2.tx);
  const E3 = await p.evaluate(() => {
    document.getElementById('btnSettings').click();
    const ios = [...document.querySelectorAll('#settingsBody [data-io]')].map(x=>x.dataset.io);
    const nss = [...document.querySelectorAll('#settingsBody [data-ns]')].map(x=>x.dataset.ns);
    return {ios, nss, nsUser:!!document.getElementById('nsUser'), nsPass:document.getElementById('nsPass').type,
            nsPath:document.getElementById('nsPath').value, nsKeep:document.getElementById('nsKeep').value};
  });
  ok('E9 设置页有导出/导入/清空三项', JSON.stringify(E3.ios) === '["export","import","clear"]', E3.ios);
  ok('E10 设置页有坚果云四项操作', JSON.stringify(E3.nss) === '["save","test","up","down"]', E3.nss);
  ok('E11 坚果云账号/密码/目录/份数齐备', E3.nsUser && E3.nsPass === 'password' && E3.nsPath === '资产管理中枢' && E3.nsKeep === '30', E3);
  await p.evaluate(() => document.getElementById('settingsClose').click());
  const E4 = await p.evaluate(() => {
    document.getElementById('btnBackup').click();
    return {name:(window.__exportName||''), html:document.body.innerHTML.includes('blob:')};
  });
  ok('E12 顶部「备份」可点击且无异常', errors.length === 0, errors);
  const E5 = await p.evaluate(() => {
    localStorage.removeItem('amhub_v100_autobackup');
    document.getElementById('btnRestore').click();
    const sh = document.getElementById('restoreSheet');
    const opened = sh.classList.contains('on');
    const opts = [...document.querySelectorAll('#restoreBtns [data-restore]')].map(x => x.dataset.restore);
    let clicks = 0;
    const f = document.getElementById('importFile');
    const rec = () => clicks++;
    f.addEventListener('click', rec);
    document.querySelector('[data-restore="local"]').click();
    f.removeEventListener('click', rec);
    return {file:!!f, opened, opts, closed:!sh.classList.contains('on'), clicks};
  });
  ok('E13 顶部「恢复」弹来源选择框；无自动备份时选本地回退文件选择器并收起弹层',
     E5.file && E5.opened && JSON.stringify(E5.opts) === '["local","cloud"]'
     && E5.closed && E5.clicks === 1, E5);

  console.log('\n===== F) 需求8 坚果云 · 桌面 /ns 通道契约 =====');
  const F = await p.evaluate(async () => {
    NS.user = 'u@example.com'; NS.pass = 'app-pass'; NS.path = '资产管理中枢';
    await nsCall('GET', false, null);
    await nsCall('PUT', false, '{"a":1}');
    return window.__nsFetch.map(x => ({url:x.url, method:x.method, path:x.headers['X-NS-Path'],
      user:x.headers['X-NS-User'], keep:x.headers['X-NS-Keep'], probe:!!x.headers['X-NS-Probe']}));
  });
  ok('F1 桌面走同源 /ns', F.length === 2 && F.every(x=>x.url === '/ns'), F);
  ok('F2 桌面 X-NS-Path 只传目录名', F.every(x=>x.path === '%E8%B4%A6%E6%9C%AC'), F.map(x=>x.path));
  ok('F3 桌面凭据按头传递', F.every(x=>x.user === 'u@example.com'), F);
  ok('F4 桌面 PUT 带 keep', F[1].keep === '30', F[1]);
  ok('F5 桌面 GET 不带 probe', F[0].probe === false, F[0]);
  const F2 = await p.evaluate(() => {
    const b = nsBridgePath('资产管理中枢'), d = nsDirPath('/资产管理中枢/'), already = nsBridgePath('资产管理中枢/backup.json');
    return {b, d, already, old:nsBridgePath('资产管理中枢备份')};
  });
  ok('F6 原生桥 path 补 backup.json', F2.b === '资产管理中枢/backup.json', F2);
  ok('F7 桌面 path 归一化去斜杠', F2.d === '资产管理中枢', F2);
  ok('F8 已是完整路径不重复拼', F2.already === '资产管理中枢/backup.json', F2);
  ok('F9 旧目录回退路径正确', F2.old === '资产管理中枢备份/backup.json', F2);

  console.log('\n===== N) v1.1.5 起：顶部备份双写 / 恢复来源（桌面 /ns 通道） =====');
  const N1 = await p.evaluate(async () => {
    window.__nsFetch.length = 0;
    document.getElementById('btnBackup').click();
    await new Promise(r => setTimeout(r, 150));
    return {puts:window.__nsFetch.filter(x => x.method === 'PUT').length,
            paths:window.__nsFetch.map(x => x.headers['X-NS-Path']),
            status:NS.status, toast:document.getElementById('toast').textContent};
  });
  ok('N1 顶部「备份」在桌面通道发起云端 PUT（与本地导出并行）', N1.puts === 1, N1);
  ok('N2 云端 PUT 的 X-NS-Path 仍为「资产管理中枢」目录',
     N1.paths.length === 1 && N1.paths[0] === '%E8%B4%A6%E6%9C%AC', N1.paths);
  ok('N3 双写结果写入 NS.status（设置页可查详情）',
     /本地 已备份到固定备份区 资产管理中枢_备份_/.test(N1.status) && /云端 已备份到坚果云/.test(N1.status), N1.status);
  ok('N4 双写完成给出汇总提示', N1.toast === '本地 + 云端备份完成', N1.toast);
  const N2 = await p.evaluate(async () => {
    window.__nsFetch.length = 0;
    document.getElementById('btnRestore').click();
    const opened = document.getElementById('restoreSheet').classList.contains('on');
    document.querySelector('[data-restore="cloud"]').click();
    await new Promise(r => setTimeout(r, 150));
    return {opened, closed:!document.getElementById('restoreSheet').classList.contains('on'),
            gets:window.__nsFetch.filter(x => x.method === 'GET').length};
  });
  ok('N5 选「云端备份」关闭选择框并发起 GET 恢复', N2.opened && N2.closed && N2.gets >= 1, N2);
  const N3 = await p.evaluate(async () => {
    NS.user = ''; NS.pass = ''; persistNS();
    window.__nsFetch.length = 0;
    document.getElementById('btnBackup').click();
    await new Promise(r => setTimeout(r, 100));
    const out = {puts:window.__nsFetch.length, status:NS.status,
                 toast:document.getElementById('toast').textContent};
    NS.user = 'u@example.com'; NS.pass = 'app-pass'; persistNS();
    return out;
  });
  ok('N6 未配置坚果云时只做本地备份、不阻断、给出提示',
     N3.puts === 0 && /本地 已备份到固定备份区/.test(N3.status) && /未配置坚果云/.test(N3.status)
     && N3.toast === '本地已备份 · 云端未配置', N3);

  console.log('\n===== G) 需求8 坚果云 · 原生桥 8 参数（APK 通道） =====');
  const pn = await browser.newPage();
  await pn.setViewport({width:470, height:1000, deviceScaleFactor:2});
  const nErrors = [];
  pn.on('pageerror', e => nErrors.push(e.message));
  await pn.evaluateOnNewDocument(NATIVE_STUB);
  await pn.goto(HTML, {waitUntil:'load'});
  const G = await pn.evaluate(async () => {
    NS.user = 'u@example.com'; NS.pass = 'app-pass'; NS.path = '资产管理中枢'; NS.keep = 30;
    let r;
    const pr = nsCall('PUT', false, '{"x":1}');
    const c = window.__nsCalls[0];
    window.__pnlNsDone(c[0], 201, '{"ok":true}');
    r = await pr;
    return {argc:c.length, method:c[1], user:c[2], pass:c[3], path:c[4], probe:c[5], body:c[6], keep:c[7], r};
  });
  ok('G1 nsRequest 恰好 8 个 String 实参', G.argc === 8, G);
  ok('G2 方法 / 凭据正确', G.method === 'PUT' && G.user === 'u@example.com' && G.pass === 'app-pass', G);
  ok('G3 原生桥 path 为完整文件路径', G.path === '资产管理中枢/backup.json', G.path);
  ok('G4 body 非空串（不传 null）', G.body === '{"x":1}', G.body);
  ok('G5 keep 传字符串', G.keep === '30', G.keep);
  ok('G6 回调解析状态', G.r.ok === true && G.r.status === 201, G.r);
  const G2 = await pn.evaluate(() => {
    const o = dataForSync();
    return {hasNutstore:'nutstore' in o, hasPass:JSON.stringify(o).includes('app-pass'), tx:o.tx.length};
  });
  ok('G7 上传内容剔除本机坚果云配置', !G2.hasNutstore && !G2.hasPass, G2);
  const G3 = await pn.evaluate(() => {
    exportBackup();
    return window.__export ? {name:window.__export.name, hasPass:window.__export.json.includes('app-pass')} : null;
  });
  ok('G8 APK 导出走原生 exportBackup', G3 && G3.name.startsWith('资产管理中枢_备份_'), G3);
  ok('G9 原生导出内容无凭据', G3 && !G3.hasPass, G3);
  const G4 = await pn.evaluate(async () => {
    window.__nsCalls.length = 0;
    const pr = nsCall('GET', false, null);
    const c = window.__nsCalls[0];
    window.__pnlNsDone(c[0], 404, '{"error":"not found"}');
    await pr.catch(()=>{});
    return window.__nsCalls.map(x => ({path:x[4], method:x[1]}));
  });
  ok('G10 409/404 触发旧目录回退（前端兜）', G4.length === 1 && G4[0].path === '资产管理中枢/backup.json', G4);
  ok('G11 原生页无运行时错误', nErrors.length === 0, nErrors);
  const Gbars = await pn.evaluate(() => window.__bars || []);
  ok('G12 APK 原生桥启动即刷深色（不透明深色 / 深色系）', Gbars.length > 0
     && Gbars.every(x => x[0] === '#ff0d1117' && x[1] === false), Gbars.slice(0, 3));

  console.log('\n===== O) v1.1.5 起：顶部备份双写 / 云端恢复（原生桥通道） =====');
  const O1 = await pn.evaluate(async () => {
    NS.user = 'u@example.com'; NS.pass = 'app-pass'; NS.path = '资产管理中枢';
    window.__nsCalls.length = 0; window.__export = null;
    document.getElementById('btnBackup').click();
    const c = window.__nsCalls[0];
    if(c) window.__pnlNsDone(c[0], 201, '{"ok":true}');
    await new Promise(r => setTimeout(r, 100));
    return {argc:c && c.length, method:c && c[1], path:c && c[4],
            localBak:!!localStorage.getItem('amhub_v100_autobackup'),
            exportCalled:!!window.__export, status:NS.status,
            toast:document.getElementById('toast').textContent};
  });
  ok('O1 顶部「备份」静默写固定备份区 + 原生桥 PUT（8 参），不调 SAF 导出桥',
     O1.localBak && !O1.exportCalled && O1.method === 'PUT' && O1.argc === 8, O1);
  ok('O2 原生桥 path 仍为 资产管理中枢/backup.json', O1.path === '资产管理中枢/backup.json', O1.path);
  ok('O3 双写完成提示与详情',
     O1.toast === '本地 + 云端备份完成' && /云端 已备份到坚果云/.test(O1.status), O1);
  const O2 = await pn.evaluate(async () => {
    window.__nsCalls.length = 0;
    const backup = JSON.stringify(dataForSync());
    document.getElementById('btnRestore').click();
    const opened = document.getElementById('restoreSheet').classList.contains('on');
    document.querySelector('[data-restore="cloud"]').click();
    const c = window.__nsCalls[0];
    if(c) window.__pnlNsDone(c[0], 200, backup);
    await new Promise(r => setTimeout(r, 100));
    return {opened, method:c && c[1], path:c && c[4],
            closed:!document.getElementById('restoreSheet').classList.contains('on'),
            toast:document.getElementById('toast').textContent};
  });
  ok('O4 选「云端备份」在 APK 通道发起 GET 并关闭选择框',
     O2.opened && O2.method === 'GET' && O2.closed, O2);
  ok('O5 云端恢复成功并提示', O2.toast === '云端恢复完成', O2);
  const O3 = await pn.evaluate(() => {
    document.getElementById('btnRestore').click();
    const before = document.getElementById('restoreSheet').classList.contains('on');
    document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
    return {before, after:document.getElementById('restoreSheet').classList.contains('on')};
  });
  ok('O6 Escape 可关闭恢复选择框', O3.before && !O3.after, O3);
  ok('O7 原生页全程无运行时错误', nErrors.length === 0, nErrors);
  await pn.close();

  console.log('\n===== H) 旧版式 / 金额口径不回退 =====');
  const H = await p.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const row = document.querySelector('.flow-row');
    const cs = getComputedStyle(row);
    const l1 = row.querySelector('.line1 .l'), l2 = row.querySelector('.line2 .l');
    const a = l1.querySelector('.piece:first-child'), b = l2.querySelector('.piece:first-child');
    const rows = [...document.querySelectorAll('.flow-row')];
    /* 当天渲染的流水未必带标签/调整项，用构造样本做真实布局，避免假阴性 */
    const sample = {id:'probe2', type:'expense', date:S.date, time:'12:30', category:'便利店',
      tag:'餐饮', note:'测试备注', amount:100, discount:4, off:1, cashback:0.5, fee:0.2,
      reimbursed:0, from:'微信', to:''};
    const holder = document.createElement('div');
    holder.innerHTML = '<div class="flow-list">' + rowHTML(sample) + '</div>';
    holder.style.cssText = 'position:absolute;left:0;top:0;width:412px;visibility:hidden';
    document.body.appendChild(holder);
    const pr = holder.querySelector('.flow-row');
    const pl1 = pr.querySelector('.line1 .l');
    const adj = pl1.querySelector('.piece.adj');
    const r = pr.querySelector('.line2 .r');
    const tag = r.querySelector('.tag');
    const out = {
      fs:root.getPropertyValue('--fs').trim(), bd:root.getPropertyValue('--bd').trim(), gap:root.getPropertyValue('--flow-gap').trim(),
      rowBorder:cs.borderBottomWidth, rowCursor:cs.cursor,
      lastBorder:getComputedStyle(rows[rows.length-1]).borderBottomWidth,
      badgeH:+pr.querySelector('.badge').getBoundingClientRect().height.toFixed(1),
      bodyH:+pr.querySelector('.body').getBoundingClientRect().height.toFixed(1),
      gapPx:getComputedStyle(l1).gap, aLeft:+a.getBoundingClientRect().left.toFixed(1), bLeft:+b.getBoundingClientRect().left.toFixed(1),
      adjWrap:getComputedStyle(pl1).flexWrap, adjText:adj ? adj.textContent : '',
      tagInLine2:!!tag, tagInLine1:!!pr.querySelector('.line1 .r .tag'),
      tagBorder:tag ? getComputedStyle(tag).borderTopWidth : 'none',
      timeColor:getComputedStyle(l2.querySelector('.sub')).color,
      bodyColor:getComputedStyle(document.body).color,
      outerBorder:getComputedStyle(document.querySelector('.app')).borderTopWidth
    };
    holder.remove();
    return out;
  });
  ok('H1 全站字号变量仍在', H.fs.includes('clamp'), H.fs);
  ok('H2 v1.0.0 全站边框 1px（对齐同类持仓项目）/ 间距 3px', H.bd === '1px' && H.gap === '3px', H);
  ok('H3 v1.0.0 流水行边框 1px 且最后一条也画 1px（末条开口已修）',
     H.rowBorder === '1px' && H.lastBorder === '1px', H);
  ok('H4 流水条仍可点击编辑', H.rowCursor === 'pointer', H.rowCursor);
  ok('H5 徽标与两行等高', Math.abs(H.badgeH - H.bodyH) < 1.5, H);
  ok('H6 分类↔时间左缘对齐', H.aLeft === H.bLeft, H);
  ok('H7 第一行不折行', H.adjWrap === 'nowrap', H.adjWrap);
  ok('H8 调整项用 | 单行连接且立减并入优惠', H.adjText === '优惠+5|返现+0.5|手续费-0.2', H.adjText);
  /* v1.3.5 起标签移到第一行金额前（第二行只剩账户），v1.3.7 沿用 */
  ok('H9 标签在第一行金额前、第二行只剩账户', !H.tagInLine2 && H.tagInLine1, H);
  ok('H10 标签无边框', H.tagBorder === '0px' || H.tagBorder === 'none', H.tagBorder);
  ok('H11 时间颜色与正文一致', H.timeColor === H.bodyColor, H);
  ok('H12 无最外圈黑边', H.outerBorder === '0px', H.outerBorder);
  const K = await p.evaluate(() => {
    const t = {type:'expense', amount:100, discount:4, cashback:0.5, fee:0.2, off:0, reimbursed:0};
    const m = {type:'transfer', amount:100, off:2, recv:99, discount:1, cashback:0, fee:0, from:'付款账户', to:'收款账户'};
    return {netOut:netOut(t), outOf:outOf(m), recvOf:recvOf(m), reimNet:reimNet({reimbursed:20,fee:1}),
            diffOf:diffOf(m), delta:deltaOf(t), money:money(-25186.7),
            adjust:adjustParts({discount:4,off:1,cashback:.5,fee:.2,reimbursed:6})};
  });
  ok('H13 netOut 口径未改', K.netOut === 95.5, K);
  ok('H14 outOf / recvOf / diffOf 口径未改', K.outOf === 98 && K.recvOf === 99 && K.diffOf === 1, K);
  ok('H15 reimNet / deltaOf 口径未改', K.reimNet === 19 && K.delta === -95.5, K);
  ok('H16 money() 两位小数', K.money === '-25186.70', K.money);
  ok('H17 立减并入优惠、调整项不拆块', K.adjust[0] === '优惠+5' && K.adjust.length === 4, K.adjust);
  const R = await p.evaluate(() => {
    document.getElementById('btnAdd').click();
    const r = {type:S_ADD.type, fromDisabled:document.getElementById('fFrom').disabled, toDisabled:document.getElementById('fTo').disabled,
               rows:document.querySelectorAll('#fieldGrid .frow').length,
               note:!!document.getElementById('fNote')};
    document.getElementById('sheetClose').click();
    return r;
  });
  ok('H18 记账四行字段 + 备注仍在', R.rows === 4 && R.note, R);
  ok('H19 支出禁用收入账户', !R.fromDisabled && R.toDisabled, R);
  ok('H20 无致命运行时错误（全程）', errors.length === 0, errors);

  console.log('\n===== I) 刷新持久化（流水改删） =====');
  const I0 = await p.evaluate(() => {
    const t = DB.tx[0];
    const before = t.note || '';
    DB.tx[0].note = '回归标记';
    persistDB();
    return {id:t.id, before};
  });
  await p.reload({waitUntil:'load'});
  const I1 = await p.evaluate(id => {
    const t = DB.tx.find(x=>x.id === id);
    return {note:t ? t.note : null, n:DB.tx.length, accounts:DB.accounts.length};
  }, I0.id);
  ok('I1 刷新后流水修改不丢', I1.note === '回归标记', I1);
  ok('I2 刷新后导入的 70 笔 / 11 账户完整', I1.n === 70 && I1.accounts === 11, I1);


  console.log('\n===== L) dock 下移（v1.1.4 起）+ 底部取色区 =====');
  const L = await p.evaluate(() => {
    const cs = e => getComputedStyle(e);
    const bar = document.querySelector('.bottombar');
    /* v1.3.7：dock 变成四项，逐个量外框与位置（等宽 = 矩形框一样大的硬证据） */
    const btns = [...document.querySelectorAll('.bottombar>button')];
    const b1 = btns[0];
    const four = e => [cs(e).borderTopWidth, cs(e).borderRightWidth, cs(e).borderBottomWidth, cs(e).borderLeftWidth];
    const dr = bar.getBoundingClientRect();
    return {
      dockTop: cs(bar).borderTopWidth,
      four: btns.map(four),
      rect: btns.map(e => { const r = e.getBoundingClientRect();
        return {id:e.id, l:+r.left.toFixed(2), r:+r.right.toFixed(2), w:+r.width.toFixed(2), h:+r.height.toFixed(2)}; }),
      dockL: +dr.left.toFixed(2), dockR: +dr.right.toFixed(2),
      sheetPb: parseFloat(cs(document.getElementById('sheet')).paddingBottom),
      dockPb: parseFloat(cs(bar).paddingBottom),
      btnTop: cs(b1).top,
      bodyPb: parseFloat(cs(document.body).paddingBottom),
      dockGap: +(window.innerHeight - b1.getBoundingClientRect().bottom).toFixed(1),
      htmlBg: cs(document.documentElement).backgroundColor,
      scheme: cs(document.documentElement).colorScheme,
       sheetBorderBottom: cs(document.getElementById('sheet')).borderBottomColor,
      metaDark: !!document.querySelector('meta[name="theme-color"][media*="dark"]'),
      fn: typeof forceWhiteBars, soon: typeof forceWhiteBarsSoon
    };
  });
  ok('L1 dock 顶部分隔线已撤掉（v1.2.5：border-top 0），按钮外框仍 2px', L.dockTop === '0px', L.dockTop);
  ok('L2 v1.0.0 四个按钮拆独立边框，四边均 1px（每个按钮都是完整矩形）',
     L.four.length === 4 && L.four.every(f => f.every(x => x === '1px')), L.four);
  ok('L3 四块矩形框等宽等高（用户要求「四类所在的矩形框相同大小」）',
     new Set(L.rect.map(r => r.w)).size === 1 && L.rect.every(r => r.h === 36), L.rect);
  ok('L4 v1.0.0 四块独立边框以 6px gap 分隔（后一块左缘 = 前一块右缘 + 6px）',
     L.rect.slice(1).every((r, i) => Math.abs(r.l - (L.rect[i].r + 6)) < 0.6), L.rect);
  ok('L5 折叠未破坏 dock 内距：首块左缘 = dock 左 + 10px，末块右缘 = dock 右 − 10px',
     Math.abs(L.rect[0].l - (L.dockL + 10)) < 0.02
     && Math.abs(L.rect[3].r - (L.dockR - 10)) < 0.02, {dock:[L.dockL, L.dockR], rect:L.rect});
  ok('L6 弹层底部内边距抬高到 20px', L.sheetPb >= 20, L.sheetPb);
  ok('L7 dock 底部内边距 4→2px（v1.2.10 把按钮下边框到屏幕底边的间距再减半）',
     Math.abs(L.dockPb - 2) < 0.01, L.dockPb);
  ok('L8 body 底部预留 46px（v1.3.0：dock 45px + 呼吸 8px − .app 底 7px）',
     Math.abs(L.bodyPb - 46) < 0.6, L.bodyPb);
  ok('L9 html 默认深色纸底 + color-scheme:dark',
     L.htmlBg === 'rgb(13, 17, 23)' && L.scheme === 'dark', {bg:L.htmlBg, scheme:L.scheme});
  ok('L10 深色模式 theme-color 兜底', L.metaDark === true, L.metaDark);
  ok('L11 forceWhiteBars / forceWhiteBarsSoon 可用', L.fn === 'function' && L.soon === 'function', L);
  ok('L12 弹层四周均为 2px 实线（v1.4.5 深色态取边框色 --edge）',
     L.sheetBorderBottom === 'rgb(45, 58, 82)', L.sheetBorderBottom);
  ok('L13 v1.4.1 四个框上移 6px（按钮底边距视口底 2→8px；dock 内距仍 2px 未动）',
     Math.abs(L.dockGap - 8) < 0.01 && Math.abs(L.dockPb - 2) < 0.01, L.dockGap);

  ok('L14 v1.4.1 四框上移由相对定位实现（top:-6px），dock 内距 2px 与盒高 45px 不变',
     L.btnTop === '-6px' && Math.abs(L.dockPb - 2) < 0.01, L.btnTop);

  console.log('\n===== M) 系统栏不透明白 + 关对比度强制（v1.1.4 起）（生命周期 + 弹层） =====');
  const M = await p.evaluate(async () => {
    window.__bars = [];
    window.PnlAndroid = Object.assign(window.PnlAndroid || {}, {
      setSystemBars: (c, d) => window.__bars.push([c, d])
    });
    forceWhiteBars();
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('resize'));
    openSheet();
    await new Promise(r => setTimeout(r, 700));
    closeSheet();
    await new Promise(r => setTimeout(r, 700));
    return {total:window.__bars.length, uniq:[...new Set(window.__bars.map(x => x.join('|')))]};
  });
  ok('M1 刷白调用被记录', M.total > 0, M);
  ok('M2 生命周期 + 弹层开关均补刷（含延迟重试）', M.total >= 8, M);
  ok('M3 参数恒为 #ff0d1117 / false（不透明深色 + 浅色手势图标）', M.uniq.length === 1 && M.uniq[0] === '#ff0d1117|false', M);

  /* ================= 截图 ================= */
  const shots = async (page, name, prep) => {
    if (prep) await page.evaluate(prep);
    await wait(260);
    await page.screenshot({path:path.join(SHOT, name), fullPage:false});
  };
  await shots(p, '资产管理中枢_v1.2.8_账单页.png', () => { document.getElementById('tabBill').click(); setDate('2026-11-01'); });
  await shots(p, '资产管理中枢_v1.2.8_资产页.png', () => { document.getElementById('tabAsset').click(); });
  await shots(p, '资产管理中枢_v1.2.8_设置页.png', () => { document.getElementById('btnSettings').click(); });
  await shots(p, '资产管理中枢_v1.2.8_账户修改.png', () => {
    document.getElementById('settingsClose').click();
    document.querySelector('[data-acct]').click();
  });
  await shots(p, '资产管理中枢_v1.2.8_空数据.png', () => {
    document.getElementById('acctClose').click();
    applyDB({version:'1.2.8',accounts:[],categories:{},tags:{},tx:[],settings:{},meta:{},accountTypes:[{id:'asset',name:'资产账户',mode:'asset'},{id:'credit',name:'信贷账户',mode:'credit'}]});
    document.getElementById('tabBill').click();
  });
  console.log('\n截图: 5 张已输出到工作区');


  console.log('\n===== P) v1.1.6 起：明暗主题 + 固定备份闭环（独立页面，零污染） =====');
  const pq = await browser.newPage();
  await pq.setViewport({width:360, height:780});
  await pq.evaluateOnNewDocument(() => {
    window.__bars = []; window.__export = null;
    window.PnlAndroid = {
      setSystemBars:(c,l)=>window.__bars.push([c,l]),
      nsRequest:()=>{}, exportBackup:(n,j)=>{window.__export={name:n,json:j};},
      toast:()=>{}, quitApp:()=>{}
    };
  });
  const qErrors = [];
  pq.on('pageerror', e => qErrors.push(e.message));
  await pq.goto(HTML, {waitUntil:'load'});
  await pq.evaluate(() => { try{localStorage.clear();}catch(e){} });
  await pq.reload({waitUntil:'load'});
  const P1 = await pq.evaluate(() => ({
    theme:document.documentElement.getAttribute('data-theme'),
    bg:getComputedStyle(document.documentElement).backgroundColor,
    scheme:getComputedStyle(document.documentElement).colorScheme,
    pressed:document.getElementById('btnTheme').getAttribute('aria-pressed'),
    text:document.getElementById('btnTheme').textContent.trim(),
    meta:document.querySelector('meta[name="theme-color"]').getAttribute('content'),
    bars:window.__bars.slice(-1)[0]
  }));
  ok('P1 默认深色态：data-theme=dark / 深色纸底 / dark / 按钮名为「明暗」',
     P1.theme === 'dark' && P1.bg === 'rgb(13, 17, 23)' && P1.scheme === 'dark'
     && P1.pressed === 'true' && P1.text === '明暗' && P1.meta === '#0d1117', P1);
  ok('P2 默认系统栏为不透明深色 + 浅色图标（v1.1.4 修复零回退）',
     P1.bars && P1.bars[0] === '#ff0d1117' && P1.bars[1] === false, P1.bars);
  const P2 = await pq.evaluate(() => {
    window.__bars.length = 0;
    document.getElementById('btnTheme').click();
    return {theme:document.documentElement.getAttribute('data-theme'),
            bg:getComputedStyle(document.documentElement).backgroundColor,
            bodyBg:getComputedStyle(document.body).backgroundColor,
            scheme:getComputedStyle(document.documentElement).colorScheme,
            pressed:document.getElementById('btnTheme').getAttribute('aria-pressed'),
            meta:document.querySelector('meta[name="theme-color"]').getAttribute('content'),
            key:localStorage.getItem('amhub_v100_theme'),
            bars:window.__bars.slice(-1)[0]};
  });
  ok('P3 点「明暗」切到白天：变量反转 / color-scheme=light / 持久化 / meta 同步',
     P2.theme === null && P2.bg === 'rgb(244, 246, 250)' && P2.bodyBg === 'rgb(244, 246, 250)'
     && P2.scheme === 'light' && P2.pressed === 'false' && P2.meta === '#f4f6fa'
     && P2.key === 'light', P2);
  ok('P4 白天系统栏为不透明浅色 + 深色图标（明确信号，不触发动态取色）',
     P2.bars && P2.bars[0] === '#fff4f6fa' && P2.bars[1] === true, P2.bars);
  await pq.reload({waitUntil:'load'});
  const P3 = await pq.evaluate(() => ({
    theme:document.documentElement.getAttribute('data-theme'),
    bg:getComputedStyle(document.documentElement).backgroundColor,
    pressed:document.getElementById('btnTheme').getAttribute('aria-pressed')
  }));
  ok('P5 刷新后亮色持久化（head 内联脚本首帧前应用，无闪白）',
     P3.theme === null && P3.bg === 'rgb(244, 246, 250)' && P3.pressed === 'false', P3);
  const P4 = await pq.evaluate(() => {
    window.__bars.length = 0;
    document.getElementById('btnTheme').click();
    return {theme:document.documentElement.getAttribute('data-theme'),
            meta:document.querySelector('meta[name="theme-color"]').getAttribute('content'),
            key:localStorage.getItem('amhub_v100_theme'),
            bars:window.__bars.slice(-1)[0]};
  });
  ok('P6 再点切回黑夜，系统栏同步回到不透明深色',
     P4.theme === 'dark' && P4.meta === '#0d1117' && P4.key === 'dark'
     && P4.bars && P4.bars[0] === '#ff0d1117' && P4.bars[1] === false, P4);
  // 360px 窄屏：顶栏新增第 4 个按钮后不能溢出
  const P5 = await pq.evaluate(() => {
    const app = document.querySelector('.app').getBoundingClientRect();
    const bs = [...document.querySelectorAll('.topbar .bx')].map(b => {
      const r = b.getBoundingClientRect();
      return {left:+r.left.toFixed(1), right:+r.right.toFixed(1)};
    });
    return {appRight:+app.right.toFixed(1), maxRight:Math.max(...bs.map(b => b.right)),
            count:bs.length, gap:+(bs[1].left - bs[0].right).toFixed(1)};
  });
  ok('P7 360px 窄屏顶栏 5 个按钮不溢出（v1.4.5 起「资产管理中枢」移除，四键等分后间距仍 6px）',
     P5.count === 5 && P5.maxRight <= P5.appRight + 0.5 && P5.gap >= 0 && P5.gap <= 8, P5);
  // 固定备份区闭环：备份 → 清零 → 恢复，且全程不调 SAF 导出桥
  const Q1 = await pq.evaluate(() => {
    window.__export = null;
    DB.tx.push({id:'q1',type:'expense',date:'2026-11-10',time:'10:00',amount:12.5,from:'微信'});
    persistDB(); renderAll();
    const before = DB.tx.length;
    document.getElementById('btnBackup').click();
    const bak = JSON.parse(localStorage.getItem('amhub_v100_autobackup') || 'null');
    applyDB({version:'1.2.8',accounts:[],categories:{},tags:{},tx:[],settings:{},meta:{},
             accountTypes:[{id:'asset',name:'资产账户',mode:'asset'},{id:'credit',name:'信贷账户',mode:'credit'}]});
    const cleared = DB.tx.length;
    document.getElementById('btnRestore').click();
    document.querySelector('[data-restore="local"]').click();
    return {before, cleared, after:DB.tx.length, name:bak && bak.name,
            hasJson:!!(bak && bak.json), exportCalled:!!window.__export,
            closed:!document.getElementById('restoreSheet').classList.contains('on'),
            toast:document.getElementById('toast').textContent};
  });
  ok('Q1 点「备份」静默写固定备份区，不调用会弹 SAF 的 exportBackup 桥',
     Q1.hasJson && /^资产管理中枢_备份_/.test(Q1.name) && !Q1.exportCalled, Q1);
  ok('Q2 「恢复 → 本地备份」从固定备份区读回，数据闭环（无需选文件）',
     Q1.before === 1 && Q1.cleared === 0 && Q1.after === 1 && Q1.closed
     && /已从本地备份恢复/.test(Q1.toast), Q1);
  const Q2 = await pq.evaluate(() => {
    localStorage.removeItem('amhub_v100_autobackup');
    let clicks = 0;
    const f = document.getElementById('importFile');
    const rec = () => clicks++;
    f.addEventListener('click', rec);
    document.getElementById('btnRestore').click();
    document.querySelector('[data-restore="local"]').click();
    f.removeEventListener('click', rec);
    return {clicks, closed:!document.getElementById('restoreSheet').classList.contains('on')};
  });
  ok('Q3 无自动备份时回退文件选择器（兼容旧版 JSON 文件）',
     Q2.clicks === 1 && Q2.closed, Q2);
  ok('Q4 明暗 / 固定备份全程无运行时错误', qErrors.length === 0, qErrors);

  /* ===== R) v1.1.7 起（v1.1.9 沿用）紧凑选项弹层：替代系统绘制的全屏 select 单选框 ===== */
  const qErrBase = qErrors.length;
  const R1 = await pq.evaluate(() => {
    const sels = [...document.querySelectorAll('select')];
    return {
      count:sels.length,
      hits:document.querySelectorAll('.sel-hit').length,
      pe:sels.map(s => getComputedStyle(s).pointerEvents),
      labels:sels.filter(s => s.parentElement.tagName === 'LABEL').length,
      bound:[...document.querySelectorAll('.sel-hit')].map(h => h.dataset.sel).sort().join(',')
    };
  });
  ok('R1 5 个原生 select 各有命中层、均禁用直接点击、且不再被 label 包裹',
     R1.count === 5 && R1.hits === 5 && R1.pe.every(x => x === 'none') && R1.labels === 0
     && R1.bound === 'aKind,fCategory,fFrom,fTag,fTo', R1);

  const R2 = await pq.evaluate(() => {
    DB.accounts = [
      {id:'r1', name:'微信', kind:'asset', balance:0},
      {id:'r2', name:'建设银行', kind:'asset', balance:0},
      {id:'r3', name:'农业银行信用卡', kind:'credit', balance:0}
    ];
    persistDB(); renderAll();
    document.getElementById('btnAdd').click();
    document.querySelector('.sel-hit[data-sel="fFrom"]').click();
    const sh = document.getElementById('pickerSheet');
    const rows = [...document.querySelectorAll('.picker-row')];
    const r0 = rows[0] && rows[0].getBoundingClientRect();
    const sr = sh.getBoundingClientRect();
    return {
      on:sh.classList.contains('on'),
      mask:document.getElementById('pickerMask').classList.contains('on'),
      title:document.getElementById('pickerTitle').textContent,
      rows:rows.length, texts:rows.map(x => x.textContent),
      rowH:r0 ? +r0.height.toFixed(1) : 0,
      sheetH:+sr.height.toFixed(1), vh:window.innerHeight,
      listMax:getComputedStyle(document.getElementById('pickerList')).maxHeight,
      cur:document.querySelectorAll('.picker-row.cur').length,
      zSheet:getComputedStyle(sh).zIndex,
      zMask:getComputedStyle(document.getElementById('pickerMask')).zIndex
    };
  });
  ok('R2 点「支出账户」弹出网页紧凑弹层（标题 / 选项 / 当前值高亮）',
     R2.on && R2.mask && R2.title === '支出账户' && R2.rows === 4 && R2.cur === 1, R2);
  ok('R3 弹层明显变小：行高 36px、列表 ≤46vh、整体 < 半屏，层级高于记账页',
     R2.rowH <= 40 && R2.sheetH < R2.vh * 0.5 && R2.listMax !== 'none'
     && +R2.zSheet > 41 && +R2.zMask >= 60, R2);

  const R4 = await pq.evaluate(() => {
    let changes = 0;
    const sel = document.getElementById('fFrom');
    const rec = () => changes++;
    sel.addEventListener('change', rec);
    [...document.querySelectorAll('.picker-row')].find(x => x.textContent === '农业银行信用卡').click();
    sel.removeEventListener('change', rec);
    return {value:sel.value, changes,
            closed:!document.getElementById('pickerSheet').classList.contains('on')};
  });
  ok('R4 选中后写回 select.value 并派发 change（原有业务逻辑零改动）',
     R4.value === '农业银行信用卡' && R4.changes === 1 && R4.closed, R4);

  const R5 = await pq.evaluate(() => {
    const out = {}, hit = document.querySelector('.sel-hit[data-sel="fFrom"]');
    const sh = document.getElementById('pickerSheet');
    hit.click(); out.escBefore = sh.classList.contains('on');
    document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
    out.escAfter = !sh.classList.contains('on');
    hit.click(); document.getElementById('pickerMask').click();
    out.mask = !sh.classList.contains('on');
    hit.click(); document.getElementById('pickerClose').click();
    out.close = !sh.classList.contains('on');
    return out;
  });
  ok('R5 Escape / 遮罩 / × 三种方式都能关闭选择器',
     R5.escBefore && R5.escAfter && R5.mask && R5.close, R5);

  const R6 = await pq.evaluate(() => {
    document.querySelector('.sel-hit[data-sel="aKind"]').click();
    const rows = [...document.querySelectorAll('.picker-row')];
    rows.find(x => x.dataset.v === 'credit').click();
    return {kind:document.getElementById('aKind').value,
            limitShown:!document.getElementById('aLimitItem').hidden,
            texts:rows.map(x => x.textContent)};
  });
  ok('R6 账户类型选「信贷账户」触发 syncAcctLimit（change 派发链路有效）',
     R6.kind === 'credit' && R6.limitShown === true, R6);

  const R7 = await pq.evaluate(() => {
    setAddType('expense');
    const to = document.getElementById('fTo'), before = to.disabled;
    document.querySelector('.sel-hit[data-sel="fTo"]').click();
    return {before, opened:document.getElementById('pickerSheet').classList.contains('on')};
  });
  ok('R7 类型联动禁用的「收入账户」点击不弹选择器', R7.before === true && R7.opened === false, R7);

  const R8 = await pq.evaluate(() => {
    /* v1.4.5 默认即深色：无需先点按钮切黑夜；量完保持深色供 S/T 段使用 */
    document.querySelector('.sel-hit[data-sel="fFrom"]').click();
    const sh = document.getElementById('pickerSheet');
    const st = getComputedStyle(document.querySelector('.picker-row'));
    const out = {theme:document.documentElement.getAttribute('data-theme'),
                 rowColor:st.color, sheetBg:getComputedStyle(sh).backgroundColor,
                 border:st.borderBottomColor};
    document.getElementById('pickerMask').click();
    return out;
  });
  ok('R8 黑夜模式下选择器文字 / 底色 / 分隔线由暗色令牌接管',
     R8.theme === 'dark' && R8.rowColor === 'rgb(230, 237, 243)'
     && R8.sheetBg === 'rgb(13, 17, 23)', R8);
  ok('R9 紧凑弹层全程无运行时错误', qErrors.length === qErrBase, qErrors.slice(qErrBase));

  /* ===== S) v1.1.8 白天黑边纯白底 / 夜晚白边纯黑底（v1.1.9 沿用） ===== */
  const sErrBase = qErrors.length;
  await pq.evaluate(() => {
    document.querySelectorAll('.sheet.on').forEach(x => x.classList.remove('on'));
    document.querySelectorAll('.sheet-mask.on, .picker-mask.on').forEach(x => x.classList.remove('on'));
    /* v1.4.5 默认深色：先显式切到白天，使本段「白天→夜晚」顺序与断言语义一致 */
    if(document.documentElement.getAttribute('data-theme') === 'dark') document.getElementById('btnTheme').click();
    if(!document.querySelector('.day.sel')){
      const b = document.querySelector('.day[data-day]');
      if(b) b.click();
    }
    if(!document.querySelector('.tab.active')) document.getElementById('tabBill').click();
  });
  const sProbe = () => pq.evaluate(() => {
    const probe = sel => {
      const el = document.querySelector(sel);
      if(!el) return null;
      const st = getComputedStyle(el);
      return {bg:st.backgroundColor, color:st.color, border:st.borderTopColor,
              style:st.borderTopStyle, weight:st.fontWeight, shadow:st.boxShadow,
              fs:st.fontSize};
    };
    const root = getComputedStyle(document.documentElement);
    return {
      theme:document.documentElement.getAttribute('data-theme'),
      ink:root.getPropertyValue('--ink').trim(), paper:root.getPropertyValue('--paper').trim(),
      themeBtn:probe('#btnTheme'), daySel:probe('.day.sel'), tabActive:probe('.tab.active'),
      tabIdle:probe('.tab:not(.active)'),
      today:probe('.day.today:not(.sel)'),
      meta:document.querySelector('meta[name="theme-color"]').getAttribute('content'),
      bars:window.__bars.slice(-1)[0],
      pressed:document.getElementById('btnTheme').getAttribute('aria-pressed')
    };
  });
  const trio = x => [x.themeBtn, x.daySel, x.tabActive];
  const S1 = await sProbe();
  ok('S1 白天：明暗 / 日历选中日 / dock 选中态一律纸色底 + 边框色边 + ink 字',
     S1.theme === null && trio(S1).every(e => e && e.bg === 'rgb(244, 246, 250)'
       && e.color === 'rgb(18, 22, 29)' && e.border === 'rgb(201, 214, 232)'), S1);
  await pq.evaluate(() => document.getElementById('btnTheme').click());
  const S2 = await sProbe();
  ok('S2 夜晚：三处一律纸色底 + 边框色边 + ink 字',
     S2.theme === 'dark' && trio(S2).every(e => e && e.bg === 'rgb(13, 17, 23)'
       && e.color === 'rgb(230, 237, 243)' && e.border === 'rgb(45, 58, 82)'), S2);
  ok('S3 主题令牌归一：白天 #12161d/#f4f6fa，夜晚 #e6edf3/#0d1117',
     S1.ink === '#12161d' && S1.paper === '#f4f6fa'
     && S2.ink === '#e6edf3' && S2.paper === '#0d1117',
     {light:[S1.ink, S1.paper], dark:[S2.ink, S2.paper]});
  ok('S4 v1.4.1 日历选中日仍加粗；dock 选中页签与未选页签同字重 / 同字号 / 同字色，只靠悬浮指示条区分',
     S2.daySel.weight === '700' && S2.tabActive.weight === '400'
     && S2.tabActive.weight === S2.tabIdle.weight
     && S2.tabActive.fs === S2.tabIdle.fs && S2.tabActive.color === S2.tabIdle.color
     && S2.tabActive.shadow === 'none' && S2.themeBtn.weight === '700'
     && S1.themeBtn.weight !== '700',
     {day:S2.daySel.weight, tab:S2.tabActive.weight, idle:S2.tabIdle.weight,
      fs:[S2.tabActive.fs,S2.tabIdle.fs], color:[S2.tabActive.color,S2.tabIdle.color],
      shadow:S2.tabActive.shadow, btnLight:S1.themeBtn.weight, btnDark:S2.themeBtn.weight});
  const S5 = await pq.evaluate(() => {
    let light = null, dark = null;
    for(const r of document.styleSheets[0].cssRules){
      if(r.selectorText === '.day.today:not(.sel)') light = r.cssText;
      if(r.selectorText === 'html[data-theme="dark"] .day.today:not(.sel)') dark = r.cssText;
    }
    return {light, dark};
  });
  ok('S5 「今天」虚线框按主题取色（白天 var(--ink) 虚线 / 夜晚 var(--edge) 边框色）',
     /dashed var\(--ink\)/.test(S5.light || '') && /var\(--edge\)/.test(S5.dark || ''), S5);
  const S6 = await pq.evaluate(() => {
    const hit = [...document.styleSheets[0].cssRules].map(r => r.cssText || '')
      .filter(t => /:hover|:active/.test(t) && /\.bx|\.tab|\.mini|\.date-label|\.month-label/.test(t));
    return {count:hit.length,
            allVar:hit.every(t => /background:\s*var\(--paper\)/.test(t)),
            bad:hit.filter(t => !/background:\s*var\(--paper\)/.test(t))};
  });
  ok('S6 三处控件的悬停/按压规则一律 background:var(--paper)（无灰底）',
     S6.count >= 3 && S6.allVar, S6);
  ok('S7 系统栏与 meta 归一：白天 #fff4f6fa/true/#f4f6fa，夜晚 #ff0d1117/false/#0d1117',
     S1.bars && S1.bars[0] === '#fff4f6fa' && S1.bars[1] === true && S1.meta === '#f4f6fa'
     && S2.bars && S2.bars[0] === '#ff0d1117' && S2.bars[1] === false && S2.meta === '#0d1117',
     {lightBar:S1.bars, darkBar:S2.bars, lightMeta:S1.meta, darkMeta:S2.meta});
  await pq.hover('#btnTheme');
  const S8 = await pq.evaluate(() => getComputedStyle(document.getElementById('btnTheme')).backgroundColor);
  ok('S8 真实鼠标悬停「明暗」仍为纸色底（夜晚），不出灰底', S8 === 'rgb(13, 17, 23)', S8);
  const S9 = await pq.evaluate(() => {
    document.querySelector('.sel-hit[data-sel="fFrom"]').click();
    const sh = document.getElementById('pickerSheet');
    const out = {on:sh.classList.contains('on'),
                 rows:document.querySelectorAll('.picker-row').length,
                 sheetBg:getComputedStyle(sh).backgroundColor};
    document.getElementById('pickerMask').click();
    return out;
  });
  ok('S9 v1.1.7 紧凑选项弹层零回退（仍弹出、仍为纸色底）',
     S9.on && S9.rows > 0 && S9.sheetBg === 'rgb(13, 17, 23)', S9);
  ok('S10 纯色主题全程无运行时错误', qErrors.length === sErrBase, qErrors.slice(sErrBase));
  /* ===== T) v1.1.9 dock 底部黑边不再重叠（真实 DOM + 几何量测） ===== */
  const tErrBase = qErrors.length;
  const tProbe = () => pq.evaluate(() => {
    const bar = document.querySelector('.bottombar');
    const act = document.querySelector('.tab.active');
    const idle = document.querySelector('.tab:not(.active)');
    const bs = getComputedStyle(bar), as = getComputedStyle(act), is = getComputedStyle(idle);
    const af = getComputedStyle(act, '::after'), bf = getComputedStyle(bar, '::before');
    const ar = act.getBoundingClientRect(), br = bar.getBoundingClientRect();
    return {
      theme:document.documentElement.getAttribute('data-theme'),
      barShadow:bs.boxShadow, barBorderTop:bs.borderTopWidth, barBg:bs.backgroundColor,
      actShadow:as.boxShadow, actBorderBottom:as.borderBottomWidth, actBg:as.backgroundColor,
      idleShadow:is.boxShadow, idleBorderBottom:is.borderBottomWidth,
      after:{content:af.content, width:af.width, height:af.height, bottom:af.bottom,
             bg:af.backgroundColor, position:af.position},
      before:{content:bf.content, height:bf.height, top:bf.top, bg:bf.backgroundColor},
      btnBottom:+ar.bottom.toFixed(1), barTop:+br.top.toFixed(1),
      dockHeight:+br.height.toFixed(1)
    };
  });
  /* 当前为夜晚主题 */
  const T1 = await tProbe();
  ok('T1 夜晚：dock 与选中 tab 均无投影（灰晕不再压在 2px 黑边上）',
     T1.theme === 'dark' && T1.barShadow === 'none' && T1.actShadow === 'none'
     && T1.idleShadow === 'none', T1);
  ok('T2 v1.0.0 选中 tab 与未选 tab 下边框同为 1px（不再出现粗黑边）',
     T1.actBorderBottom === T1.idleBorderBottom && T1.actBorderBottom === '1px',
     {active:T1.actBorderBottom, idle:T1.idleBorderBottom});
  ok('T3 选中标记改为 ::after 悬浮短条：24×3px、距底 5px、主题 ink 色',
     T1.after.content !== 'none' && T1.after.width === '24px' && T1.after.height === '3px'
     && T1.after.bottom === '5px' && T1.after.position === 'absolute'
     && T1.after.bg === 'rgb(230, 237, 243)', T1.after);
  ok('T4 指示条与 2px 下边框之间留 5px 主题底色（几何上不相连）',
     parseFloat(T1.after.bottom) - parseFloat(T1.actBorderBottom) >= 3,
     {gap:parseFloat(T1.after.bottom) - parseFloat(T1.actBorderBottom)});
  ok('T5 dock 顶部不再有分隔线（v1.2.5：border-top 0），底色仍纸色（夜晚）',
     T1.barBorderTop === '0px' && T1.barBg === 'rgb(13, 17, 23)', T1);
  ok('T6 dock 顶部 6px 纯色缓冲带改 top:-6px（撤线后要盖到 dock 顶边，不留 2px 缝）',
     T1.before.content !== 'none' && T1.before.height === '6px'
     && T1.before.top === '-6px' && T1.before.bg === 'rgb(13, 17, 23)', T1.before);
  await pq.evaluate(() => document.getElementById('btnTheme').click());   // 切回白天
  const T7 = await tProbe();
  ok('T7 白天：同样无投影、指示条变 ink 色、缓冲带变纸色',
     T7.theme === null && T7.barShadow === 'none' && T7.actShadow === 'none'
     && T7.after.bg === 'rgb(18, 22, 29)' && T7.before.bg === 'rgb(244, 246, 250)'
     && T7.barBg === 'rgb(244, 246, 250)', T7);
  ok('T8 dock 高度/按钮位置未变（v1.1.4 下移 8px 契约不回退）',
     T7.dockHeight === T1.dockHeight && T7.dockHeight < 60 && T7.btnBottom <= 780, T7);
  ok('T9 v1.1.9 dock 修复全程无运行时错误', qErrors.length === tErrBase, qErrors.slice(tErrBase));
  /* ===== U) v1.2.0 剩余三处反色高亮归一（真实 DOM 计算样式 + CSSOM 规则） ===== */
  const uErrBase = qErrors.length;
  const uAll = async () => {
    const reset = () => pq.evaluate(() => {
      document.querySelectorAll('.sheet.on').forEach(x => x.classList.remove('on'));
      document.querySelectorAll('.sheet-mask.on, .picker-mask.on').forEach(x => x.classList.remove('on'));
      document.getElementById('btnSettings').click();     // 顺带把 clearArmed 归零
      document.querySelectorAll('.sheet.on').forEach(x => x.classList.remove('on'));
      document.querySelectorAll('.sheet-mask.on, .picker-mask.on').forEach(x => x.classList.remove('on'));
      DB.accounts = [
        {id:'u1', name:'微信', kind:'asset', balance:0},
        {id:'u2', name:'银行卡', kind:'asset', balance:0}
      ];
      persistDB(); renderAll();
    });
    await reset();
    const type = await pq.evaluate(() => {
      document.getElementById('btnAdd').click();
      const el = document.querySelector('.type-row button.active');
      const st = getComputedStyle(el);
      const idle = getComputedStyle(document.querySelector('.type-row button:not(.active)'));
      return {bg:st.backgroundColor, color:st.color, weight:st.fontWeight,
              border:st.borderTopWidth, height:st.height,
              idleBg:idle.backgroundColor, idleColor:idle.color, idleWeight:idle.fontWeight};
    });
    const picker = await pq.evaluate(() => {
      const sel = document.getElementById('fFrom');
      if(sel && sel.options.length) sel.value = sel.options[0].value;
      document.querySelector('.sel-hit[data-sel="fFrom"]').click();
      const cur = document.querySelector('.picker-row.cur');
      const st = getComputedStyle(cur);
      const idle = getComputedStyle(document.querySelector('.picker-row:not(.cur)'));
      return {bg:st.backgroundColor, color:st.color, weight:st.fontWeight, height:st.height,
              idleBg:idle.backgroundColor, idleColor:idle.color, idleWeight:idle.fontWeight,
              rows:document.querySelectorAll('.picker-row').length};
    });
    const sw = await pq.evaluate(() => {
      document.getElementById('pickerMask').click();
      document.getElementById('btnSettings').click();
      const c = document.querySelector('[data-io="clear"]');
      if(c && !c.classList.contains('on')) c.click();
      const on = document.querySelector('.set-btns .bx.on');
      const st = getComputedStyle(on);
      const idle = getComputedStyle(document.querySelector('.set-btns .bx:not(.on)'));
      return {bg:st.backgroundColor, color:st.color, weight:st.fontWeight, height:st.height,
              idleBg:idle.backgroundColor, idleColor:idle.color, idleWeight:idle.fontWeight};
    });
    const theme = await pq.evaluate(() => document.documentElement.getAttribute('data-theme'));
    return {theme, type, picker, sw};
  };
  const trioU = x => [x.type, x.picker, x.sw];
  const U1 = await uAll();                                   // T 段末尾已切回白天
  ok('U1 白天：类型按钮 / 选项选中行 / 设置页开关一律纸色底 + ink 字 + 加粗',
     U1.theme === null && trioU(U1).every(e => e.bg === 'rgb(244, 246, 250)'
       && e.color === 'rgb(18, 22, 29)' && e.weight === '700'), U1);
  ok('U2 白天：三处未选中态同为纸色底 ink 字，且未加粗（选中仍可辨）',
     trioU(U1).every(e => e.idleBg === 'rgb(244, 246, 250)' && e.idleColor === 'rgb(18, 22, 29)'
       && e.idleWeight !== '700'), trioU(U1).map(e => ({bg:e.idleBg, w:e.idleWeight})));
  await pq.evaluate(() => document.getElementById('btnTheme').click());
  const U2 = await uAll();
  ok('U3 夜晚：三处一律纸色底 + ink 字 + 加粗（无反色块）',
     U2.theme === 'dark' && trioU(U2).every(e => e.bg === 'rgb(13, 17, 23)'
       && e.color === 'rgb(230, 237, 243)' && e.weight === '700'), U2);
  ok('U4 夜晚：三处未选中态同为纸色底 ink 字',
     trioU(U2).every(e => e.idleBg === 'rgb(13, 17, 23)' && e.idleColor === 'rgb(230, 237, 243)'),
     trioU(U2).map(e => ({bg:e.idleBg, color:e.idleColor})));
  const U5 = await pq.evaluate(() => {
    const rules = [...document.styleSheets[0].cssRules].map(r => (r.cssText || '').replace(/\s*\{/, '{'));
    const find = s => rules.find(t => t.trim().startsWith(s + '{')) || '';
    return {
      type:find('.type-row button.active'), cur:find('.picker-row.cur'), on:find('.set-btns .bx.on'),
      press:find('.picker-row:active'), darkPress:find('html[data-theme="dark"] .picker-row:active'),
      row:find('.picker-row'),
      reverse:rules.filter(t => /background:\s*(var\(--ink\)|rgb\(0, 0, 0\))/.test(t)
        && /color:\s*(var\(--paper\)|rgb\(255, 255, 255\))/.test(t)
        && /(button\.active|\.picker-row\.cur|\.bx\.on)/.test(t))
    };
  });
  ok('U5 CSSOM 中三处选中规则不再含 --ink 底 / --paper 字',
     !/background:\s*var\(--ink\)/.test(U5.type + U5.cur + U5.on)
     && U5.reverse.length === 0, U5);
  ok('U6 选项行显式主题底色，亮/暗按压规则均为 var(--paper)（无 #e8e8e8 / #2b2b2b）',
     /background:\s*(var\(--paper\)|rgb\(0, 0, 0\)|rgb\(255, 255, 255\))/.test(U5.row)
     && /background:\s*(var\(--paper\)|rgb\(0, 0, 0\)|rgb\(255, 255, 255\))/.test(U5.press)
     && /background:\s*(var\(--paper\)|rgb\(0, 0, 0\)|rgb\(255, 255, 255\))/.test(U5.darkPress)
     && !/#e8e8e8|#2b2b2b/.test(U5.press + U5.darkPress), U5);
  ok('U7 v1.0.0 三处控件几何零回归（29/36/29px 高、边框统一 1px）',
     U1.type.height === '29px' && U1.picker.height === '36px' && U1.sw.height === '29px'
     && U1.type.border === '1px' && U1.picker.rows > 0,
     {type:U1.type.height, picker:U1.picker.height, sw:U1.sw.height, border:U1.type.border});
  const U8 = await pq.evaluate(() => {
    document.querySelectorAll('.sheet.on').forEach(x => x.classList.remove('on'));
    document.querySelectorAll('.sheet-mask.on, .picker-mask.on').forEach(x => x.classList.remove('on'));
    document.getElementById('btnAdd').click();
    const btns = [...document.querySelectorAll('.type-row button')];
    btns[1].click();
    const switched = btns[1].classList.contains('active') && !btns[0].classList.contains('active');
    document.getElementById('sheetClose').click();
    return {switched};
  });
  ok('U8 类型按钮切换功能不受配色改动影响', U8.switched, U8);
  ok('U9 v1.2.0 三处归一全程无运行时错误', qErrors.length === uErrBase, qErrors.slice(uErrBase));

  /* ===== V) v1.2.1 平板 / 大屏等比适配（多视口真实 DOM + 昼夜 + 手机零回归） ===== */
  const vpErrors = [];
  const padCases = [
    {tag:'手机360',   w:360,  h:780,  pad:false},
    {tag:'手机470',   w:470,  h:1000, pad:false},
    {tag:'平板竖768', w:768,  h:1024, pad:true},
    {tag:'平板横1024',w:1024, h:768,  pad:true},
    {tag:'平板横1280',w:1280, h:800,  pad:true}
  ];
  const vMeas = [];
  for (const c of padCases) {
    for (const theme of ['light','dark']) {
      const vp = await browser.newPage();
      vp.on('pageerror', e => vpErrors.push(c.tag + '/' + theme + ': ' + e.message));
      await vp.setViewport({width:c.w, height:c.h, deviceScaleFactor:1});
      await vp.evaluateOnNewDocument(NATIVE_STUB);
      await vp.goto(HTML, {waitUntil:'load'});
      // file:// 的 localStorage 在同一 browser 内跨 page 共享：v1.4.5 无记忆默认深色，
      // 故 light 也必须显式写定，不能只 clear（clear 会落到深色默认）
      await vp.evaluate(t => {
        try { localStorage.clear(); } catch(e){}
        localStorage.setItem('amhub_v100_theme', t);
      }, theme);
      await vp.reload({waitUntil:'load'});
      await vp.evaluate(j => { applyDB(j); document.getElementById('tabBill').click(); }, FIXTURE);
      await wait(240);
      const m = await vp.evaluate(() => {
        const R = s => { const e = document.querySelector(s); const r = e.getBoundingClientRect();
          return {w:+r.width.toFixed(1), h:+r.height.toFixed(1), left:+r.left.toFixed(1), top:+r.top.toFixed(2)}; };
        const hOf = s => { const e = document.querySelector(s);
          return e ? (parseFloat(getComputedStyle(e).height) || 0) : 0; };
        const fs = parseFloat(getComputedStyle(document.body).fontSize);
        const barCS = getComputedStyle(document.querySelector('.bottombar'));
        return {
          vw: document.documentElement.clientWidth,
          vh: document.documentElement.clientHeight,
          scrollW: document.documentElement.scrollWidth,
          fs, app:R('.app'), dock:R('.bottombar'), day:R('.day'), bx:R('.bx'),
          // '.fitem input' 的首个匹配是 1×1px 的隐藏日期 input（hidden-picker2），
          // 必须取可见 select / 可见金额框来与命中层比较
          selH: hOf('.fitem select'), inpVisH: hOf('.fitem input.keypad-field'),
          hitH: hOf('.sel-hit'),
          flowMin: parseFloat(getComputedStyle(document.querySelector('.flow')).minHeight) || 0,
          bg: getComputedStyle(document.body).backgroundColor,
          barBorder: barCS.borderTopWidth,
          barBorderRight: barCS.borderRightWidth,
          barFlexDir: barCS.flexDirection
        };
      });
      vMeas.push(Object.assign({tag:c.tag, theme, pad:c.pad}, m));
      await vp.close();
    }
  }
  const vm = (tag, theme) => vMeas.find(x => x.tag === tag && x.theme === theme);
  const v360 = vm('手机360','light'), v470 = vm('手机470','light');
  const v768 = vm('平板竖768','light'), v1024 = vm('平板横1024','light'), v1280 = vm('平板横1280','light');
  const padM = vMeas.filter(x => x.pad);

  ok('V1 360px 手机端（v1.2.8：app 340→352 左右各外扩 6px；dock=360 / day=29 / bx=32 / fs=12.24 不变）',
     v360.app.w === 352 && v360.dock.w === 360 && v360.day.h === 29 && v360.bx.h === 32
     && Math.abs(v360.fs - 12.24) < 0.15,
     {app:v360.app.w, dock:v360.dock.w, day:v360.day.h, bx:v360.bx.h, fs:v360.fs});
  ok('V2 470px 手机端零回归（app=430 / fs=15 / day=29，平板块不命中）',
     v470.app.w === 430 && Math.abs(v470.fs - 15) < 0.1 && v470.day.h === 29
     && v470.dock.w === 430,
     {app:v470.app.w, fs:v470.fs, day:v470.day.h, dock:v470.dock.w});
  ok('V3 三档平板视口内容占屏比均 >=60%（改前实测 56% / 42% / 33.6%）',
     padM.every(x => x.app.w / x.vw >= 0.60),
     [v768,v1024,v1280].map(x => x.tag + ':' + (x.app.w/x.vw*100).toFixed(1) + '%'));
  ok('V4 内容列在侧栏右侧剩余区居中（左间隙≈右间隙，误差<2px）',
     padM.every(x => Math.abs((x.app.left - x.dock.w) - (x.vw - x.app.left - x.app.w)) < 2),
     padM.map(x => x.tag + ':L' + (x.app.left - x.dock.w).toFixed(1) + '/R' + (x.vw - x.app.left - x.app.w).toFixed(1)));
  ok('V5 平板 dock 为左侧竖栏（left=0、栏宽<vw、满高、竖排 column、无右侧竖线）',
     padM.every(x => Math.abs(x.dock.left) < 0.5 && x.dock.w > 0 && x.dock.w < x.vw * 0.25
                  && Math.abs(x.dock.h - x.vh) < 1 && x.barFlexDir === 'column'
                  && x.barBorderRight === '0px' && x.barBorder === '0px'),
     padM.map(x => x.tag + ':w' + x.dock.w + '/h' + x.dock.h + '/vh' + x.vh + '/' + x.barFlexDir
                + '/bR' + x.barBorderRight + '/bT' + x.barBorder));
  ok('V6 平板无横向溢出（scrollWidth <= clientWidth）',
     padM.every(x => x.scrollW <= x.vw), padM.map(x => x.tag + ':' + x.scrollW + '/' + x.vw));
  ok('V7 字号随视口连续放大，不再被 15px 上限锁死',
     v768.fs >= 19 && v1024.fs > v768.fs && v1280.fs >= 30,
     {v768:v768.fs, v1024:v1024.fs, v1280:v1280.fs});
  /* v1.2.6：day 高度 1.93em 跟的是内容区字号 --fs-c（= 0.88×--fs），bx 高度跟的是 --fs；
     故按 1.93×0.88=1.70 倍顶栏字号校验，bx 仍 2.13 倍。 */
  ok('V8 控件高度与字号等比（day = 1.93×内容字号 = 1.70×顶栏字号 / bx = 2.13×顶栏字号）',
     padM.every(x => x.day.h/(x.fs*0.88) > 1.85 && x.day.h/(x.fs*0.88) < 2.0
                  && x.bx.h/x.fs > 2.0 && x.bx.h/x.fs < 2.3),
     padM.map(x => x.tag + ':day' + (x.day.h/(x.fs*0.88)).toFixed(2) + '/bx' + (x.bx.h/x.fs).toFixed(2)));
  ok('V9 选项命中层 / 可见 select / 金额输入框三者同步放大（点击不错位）',
     padM.every(x => x.selH > 0 && Math.abs(x.hitH - x.selH) < 1
                  && x.inpVisH > 0 && Math.abs(x.hitH - x.inpVisH) < 1),
     padM.map(x => x.tag + ':hit' + x.hitH + '/sel' + x.selH + '/inp' + x.inpVisH));
  ok('V10 流水区不再按视口算最小高（v1.2.8：面板 flex:1 撑满，min-height 归 0）',
     padM.every(x => x.flowMin === 0), padM.map(x => x.tag + ':' + x.flowMin));
  ok('V11 昼夜背景纯色正确 / 侧栏无竖分隔线（v1.2.5 两端 dock 都不留线）',
     padM.filter(x=>x.theme==='light').every(x => x.bg === 'rgb(244, 246, 250)')
     && padM.filter(x=>x.theme==='dark').every(x => x.bg === 'rgb(13, 17, 23)')
     && padM.every(x => x.barBorderRight === '0px' && x.barBorder === '0px'),
     padM.map(x => x.tag + '/' + x.theme + ':' + x.bg + '/bR' + x.barBorderRight));
  ok('V13 平板竖屏首行按钮顶到 0（贴状态栏、露出资产管理中枢顶上黑边）；横屏与手机端不动',
     Math.abs(v768.bx.top) < 0.01 && v360.bx.top > 5 && v360.bx.top < 6.5 && v1024.bx.top > 20,
     {竖768:v768.bx.top, 手机360:v360.bx.top, 横1024:v1024.bx.top});
  ok('V12 平板全流程零运行时错误', vpErrors.length === 0, vpErrors);

  /* ===== W) v1.2.2 手机端上移 + v1.2.4 平板侧边 dock（真实 DOM） ===== */
  // 真机截图反推：OPPO 手机 1080×2374 @3x → 360×791；资产页内容几乎正好一屏，
  // v1.2.1 未滚动时 panel 底 ≈704 CSS，「总资产」行落进 dock 白色缓冲带被切开
  const wp = await browser.newPage();
  wp.on('pageerror', e => vpErrors.push('W: ' + e.message));
  await wp.setViewport({width:360, height:791, deviceScaleFactor:3});
  await wp.evaluateOnNewDocument(NATIVE_STUB);
  await wp.goto(HTML, {waitUntil:'load'});
  await wp.evaluate(j => { try{localStorage.clear();}catch(e){} applyDB(j); }, FIXTURE);
  await wait(260);
  await wp.evaluate(() => { document.getElementById('tabAsset').click(); window.scrollTo(0,0); });
  await wait(260);
  const wM = await wp.evaluate(() => {
    const R = s => { const r = document.querySelector(s).getBoundingClientRect();
      return {top:+r.top.toFixed(1), bottom:+r.bottom.toFixed(1), w:+r.width.toFixed(1), left:+r.left.toFixed(1)}; };
    const dock = document.querySelector('.bottombar');
    const cs = getComputedStyle(document.body);
    return { padTop:cs.paddingTop, padBottom:cs.paddingBottom,
             appPT:getComputedStyle(document.querySelector('.app')).paddingTop,
             tbTop:+document.querySelector('.topbar').getBoundingClientRect().top.toFixed(2),
             panel:R('.panel'), dock:R('.bottombar'),
             vw:document.documentElement.clientWidth,
             borderTop:getComputedStyle(dock).borderTopWidth,
             beforeLeft:getComputedStyle(dock,'::before').left,
             beforeRight:getComputedStyle(dock,'::before').right,
             beforeDisplay:getComputedStyle(dock,'::before').display };
  });
  ok('W1 body 顶 0px / 底 46px（v1.3.0）/ .app 顶 5.67px（顶距沿用 v1.2.4）',
     wM.padTop === '0px' && wM.padBottom === '46px' && wM.appPT === '5.67px',
     {t:wM.padTop, b:wM.padBottom, a:wM.appPT});
  ok('W7 v1.2.4 内容再上移 5.33px（按钮行顶 =5.67px＝真机 137 物理px@3x，对齐图二）',
     Math.abs(wM.tbTop - 5.67) < 0.01, wM.tbTop);
  /* v1.3.0：判据改成「面板底边不进入 dock 的 6px 缓冲带」——.bottombar::before 是 top:-6px/height:6px，
     挡的正是 dock 顶上方 6px。v1.3.0 呼吸位为 8px，仍在带外（余量 2px）；
     这里不写死 8 而是用缓冲带高度 6，避免以后微调呼吸位又要改断言。 */
  ok('W2 360×791 资产页免滚动即见全「总资产」（panel 底边在 dock 6px 缓冲带上方，实测间隙 8px）',
     wM.panel.bottom <= wM.dock.top - 6, {panelBottom:wM.panel.bottom, dockTop:wM.dock.top});
  ok('W3 手机端 dock 仍贴底全宽 360、顶部无分隔线、缓冲带仍在（不受平板断点影响）',
     wM.dock.w === 360 && wM.borderTop === '0px' && wM.beforeDisplay === 'block',
     {w:wM.dock.w, border:wM.borderTop, before:wM.beforeDisplay});
  await wp.setViewport({width:962, height:601, deviceScaleFactor:1});
  await wait(260);
  const wP = await wp.evaluate(() => {
    const R = s => { const r = document.querySelector(s).getBoundingClientRect();
      return {w:+r.width.toFixed(1), h:+r.height.toFixed(1), left:+r.left.toFixed(1), top:+r.top.toFixed(1)}; };
    const bar = document.querySelector('.bottombar');
    const cs = getComputedStyle(bar);
    const btnRects = [...document.querySelectorAll('.bottombar>button')].map(b => {
      const r = b.getBoundingClientRect(); return {w:+r.width.toFixed(1), top:+r.top.toFixed(1)};
    });
    return { vw:document.documentElement.clientWidth, vh:document.documentElement.clientHeight,
             sw:document.documentElement.scrollWidth,
             dock:R('.bottombar'), app:R('.app'),
             barBorderRight:cs.borderRightWidth, barBorderTop:cs.borderTopWidth,
             barFlexDir:cs.flexDirection, beforeDisplay:getComputedStyle(bar,'::before').display,
             btnRects };
  });
  ok('W4 962×601（OPPO 平板 3:2 横屏）dock 改为左侧竖栏（left=0、栏宽、满高、column、无竖线）',
     Math.abs(wP.dock.left) < 0.5 && wP.dock.w > 0 && wP.dock.w < wP.vw * 0.25
     && Math.abs(wP.dock.h - wP.vh) < 1 && wP.barFlexDir === 'column'
     && wP.barBorderRight === '0px' && wP.barBorderTop === '0px',
     {dock:wP.dock, vw:wP.vw, vh:wP.vh, dir:wP.barFlexDir, bR:wP.barBorderRight, bT:wP.barBorderTop});
  ok('W5 侧栏模式顶部缓冲带已隐藏（::before display:none）且无横向溢出',
     wP.beforeDisplay === 'none' && wP.sw <= wP.vw,
     {before:wP.beforeDisplay, sw:wP.sw, vw:wP.vw});
  ok('W6 内容列在侧栏右侧剩余区居中、限宽 <=900px（左间隙≈右间隙）',
     wP.app.w <= 900 && Math.abs((wP.app.left - wP.dock.w) - (wP.vw - wP.app.left - wP.app.w)) < 2,
     {appW:wP.app.w, L:+(wP.app.left - wP.dock.w).toFixed(1), R:+(wP.vw - wP.app.left - wP.app.w).toFixed(1)});
  ok('W8 侧栏四按钮竖排（top 递增）、同宽等高且不超出栏宽',
     wP.btnRects.length === 4
     && wP.btnRects.every((r, i) => i === 0 || r.top > wP.btnRects[i - 1].top)
     && new Set(wP.btnRects.map(r => r.w)).size === 1
     && new Set(wP.btnRects.map(r => r.h)).size === 1
     && wP.btnRects[0].w <= wP.dock.w,
     wP.btnRects);

  /* ===== X) v1.2.5：平板竖屏贴顶 + 弹层垂直居中（真实 DOM） ===== */
  await wp.setViewport({width:768, height:1024, deviceScaleFactor:1});
  await wait(320);
  const xP = await wp.evaluate(() => {
    /* v1.4.5：「资产管理中枢」按键已移除，首行锚点改用顶栏第一个按键 */
    const app = document.querySelector('.app'), firstBx = document.querySelector('.topbar>.bx');
    return {vw:document.documentElement.clientWidth, vh:document.documentElement.clientHeight,
            bodyPT:getComputedStyle(document.body).paddingTop,
            appPT:getComputedStyle(app).paddingTop,
            appTop:+app.getBoundingClientRect().top.toFixed(2),
            bxTop:+firstBx.getBoundingClientRect().top.toFixed(2),
            railRight:getComputedStyle(document.querySelector('.bottombar')).borderRightWidth};
  });
  ok('W9 平板竖屏 768×1024：body/.app 顶部留白归 0、首行按钮 top=0（黑边贴状态栏）',
     xP.bodyPT === '0px' && xP.appPT === '0px' && xP.appTop === 0 && Math.abs(xP.bxTop) < 0.01,
     xP);
  ok('W10 平板竖屏侧栏也不画竖分隔线（右边界 0px）', xP.railRight === '0px', xP.railRight);
  await wp.click('#btnAdd');
  await wait(460);
  const sP = await wp.evaluate(() => {
    const r = document.getElementById('sheet').getBoundingClientRect();
    return {top:+r.top.toFixed(2), bottom:+r.bottom.toFixed(2), h:+r.height.toFixed(2),
            vh:document.documentElement.clientHeight};
  });
  ok('W11 平板竖屏记账弹层垂直居中（上间隙≈下间隙，误差<2px）',
     Math.abs(sP.top - (sP.vh - sP.bottom)) < 2 && sP.top > 10 && sP.bottom < sP.vh - 10, sP);
  await wp.evaluate(() => document.getElementById('sheetClose').click());
  await wait(360);
  await wp.setViewport({width:360, height:791, deviceScaleFactor:3});
  await wait(320);
  await wp.click('#btnAdd');
  await wait(460);
  const sM2 = await wp.evaluate(() => {
    const e = document.getElementById('sheet'); const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    return {top:+r.top.toFixed(2), bottom:+r.bottom.toFixed(2), h:+r.height.toFixed(2),
            vh:document.documentElement.clientHeight,
            bb:cs.borderBottomWidth, bbc:cs.borderBottomColor, btc:cs.borderTopColor};
  });
  ok('W12 v1.0.0 手机端记账弹层同样垂直居中，四周均 1px 实线（底边与顶边同色）',
     Math.abs(sM2.top - (sM2.vh - sM2.bottom)) < 2 && sM2.bb === '1px'
     && sM2.bbc === sM2.btc, sM2);
  await wp.evaluate(() => document.getElementById('sheetClose').click());
  await wait(300);

  /* ===== Y) v1.2.6：内容区字号分级 --fs-c（账单+资产变小；顶栏五项与记账弹层不变） ===== */
  const readFS = () => wp.evaluate(() => {
    const f = s => { const e = document.querySelector(s); return e ? +parseFloat(getComputedStyle(e).fontSize).toFixed(2) : null; };
    return {
      vw: document.documentElement.clientWidth,
      topbar: f('.bx'),            // 最顶上五项功能
      rail: f('.bottombar>button'),
      month: f('.month-label'),
      kpi: f('.kpi'),
      day: f('.day'),
      flow: f('.line .l') || f('.empty'),
      sheetHead: f('.sheet-head'), // 记账弹层
      flab: f('.flab'),
      numpad: f('.numpad button'),
    };
  });
  const near = (a, b, tol) => a !== null && b !== null && Math.abs(a - b) <= tol;

  await wp.setViewport({width:768, height:1024, deviceScaleFactor:1});
  await wait(340);
  const yP = await readFS();
  const yExp = +(yP.topbar * 0.88).toFixed(2);
  /* v1.3.8：.kpi 在 --fs-c 基础上再缩 .86em（19×.88×.86 ≈ 14.38），其余仍是 16.72 */
  const yKpi = +(yExp * 0.86).toFixed(2);
  ok('Y1 平板竖屏 768：正文/日历/汇总 = 顶栏×0.88（16.72），KPI 再缩 .86em（14.38）',
     near(yP.month, yExp, 0.02) && near(yP.kpi, yKpi, 0.02)
     && near(yP.day, yExp, 0.02)
     && (yP.flow === null || near(yP.flow, yExp, 0.02)), {got: yP, exp: yExp, kpiExp: yKpi});
  ok('Y2 平板竖屏：顶栏五项 / 侧栏按钮 / 记账弹层标题·标签·键盘仍是原字号 --fs（19，一个字没小）',
     yP.topbar === 19 && yP.rail === 19 && yP.sheetHead === 19
     && yP.flab === 19 && yP.numpad === 19, yP);

  await wp.evaluate(() => document.querySelector('#tabAsset').click());
  await wait(340);
  const yA = await wp.evaluate(() => {
    const f = s => { const e = document.querySelector(s); return e ? +parseFloat(getComputedStyle(e).fontSize).toFixed(2) : null; };
    return {card: f('.asset-summary .card'), row: f('.asset-row'),
            meta: f('.credit-meta'), tools: f('.asset-tools button')};
  });
  ok('Y3 平板竖屏：资产页汇总卡片 / 账户行 / 信贷明细 / 新增账户按钮同样降到 16.72',
     near(yA.card, yExp, 0.02) && near(yA.row, yExp, 0.02)
     && (yA.meta === null || near(yA.meta, yExp, 0.02))
     && (yA.tools === null || near(yA.tools, yExp, 0.02)), {got: yA, exp: yExp});
  await wp.evaluate(() => document.querySelector('#tabBill').click());
  await wait(300);

  await wp.setViewport({width:962, height:601, deviceScaleFactor:1});
  await wait(340);
  const yL = await readFS();
  ok('Y4 平板横屏 962：内容区仍为顶栏的 88%（等比规则与视口无关）',
     Math.abs(yL.month / yL.topbar - 0.88) < 0.002 && yL.topbar > 23, yL);

  await wp.setViewport({width:360, height:791, deviceScaleFactor:3});
  await wait(340);
  const yM = await readFS();
  ok('Y5 手机 360：内容区字号 = 顶栏（--fs-c 默认等于 --fs，手机端零变化，12.24）',
     yM.month === yM.topbar && yM.day === yM.topbar
     && (yM.flow === null || yM.flow === yM.topbar)
     && Math.abs(yM.topbar - 12.24) < 0.02, yM);

  /* ===== Z) v1.2.7：记账页四类选项按字数排序 + 资产页账户长按拖拽排序 ===== */
  await wp.setViewport({width:360, height:791, deviceScaleFactor:3});
  await wait(300);

  const ZDB = {
    version:'1.2.8',
    accounts:[
      {id:'a1', name:'招商银行储蓄卡', kind:'asset', opening:1000},
      {id:'a2', name:'微信', kind:'asset', opening:200},
      {id:'a3', name:'支付宝余额宝', kind:'asset', opening:300},
      {id:'a4', name:'现金', kind:'asset', opening:50},
      {id:'c1', name:'中信信用卡', kind:'credit', opening:-300, limit:5000},
      {id:'c2', name:'花呗', kind:'credit', opening:-100, limit:2000}
    ],
    categories:{expense:['餐饮','宠物','交通费','日用','数码电器'], income:['工资','奖金','红包'],
                transfer:[], repay:[], reimburse:[]},
    tags:{expense:['出差','报销','家庭','朋友聚会'], income:[], transfer:[], repay:[], reimburse:[]},
    tx:[], settings:{}, meta:{},
    accountTypes:[{id:'asset',name:'资产账户',mode:'asset'},{id:'credit',name:'信贷账户',mode:'credit'}]
  };
  await wp.evaluate(d => { applyDB(d); openSheet(); }, ZDB);
  await wait(220);

  const Z1 = await wp.evaluate(() => {
    const val = id => [...document.getElementById(id).options].map(o => o.value);
    const len = id => val(id).slice(1).map(v => [...v].length);
    const asc = a => a.every((x, i) => i === 0 || a[i-1] <= x);
    const cat = val('fCategory'), tag = val('fTag'), from = val('fFrom'), to = val('fTo');
    return {
      cat:cat.slice(1), catAsc:asc(len('fCategory')),
      tag:tag.slice(1), tagAsc:asc(len('fTag')),
      from:from.slice(1), to:to.slice(1),
      fromAsc:asc(len('fFrom')), toAsc:asc(len('fTo')),
      emptyFirst:cat[0]==='' && tag[0]==='' && from[0]==='' && to[0]==='',
      catRaw:DB.categories.expense.slice(), tagRaw:DB.tags.expense.slice()
    };
  });
  ok('Z1 分类按字数由少到多（餐饮/宠物/日用 2字 → 交通费 3字 → 数码电器 4字）',
     Z1.catAsc && JSON.stringify(Z1.cat) === JSON.stringify(['餐饮','宠物','日用','交通费','数码电器']), Z1);
  ok('Z2 标签按字数由少到多（出差/报销/家庭 2字 → 朋友聚会 4字）',
     Z1.tagAsc && JSON.stringify(Z1.tag) === JSON.stringify(['出差','报销','家庭','朋友聚会']), Z1);
  ok('Z3 支出账户 / 收入账户同序（微信·现金·花呗 2字 → 中信信用卡 → 支付宝余额宝 → 招商银行储蓄卡）',
     Z1.fromAsc && Z1.toAsc && JSON.stringify(Z1.from) === JSON.stringify(Z1.to)
     && JSON.stringify(Z1.from) === JSON.stringify(['微信','现金','花呗','中信信用卡','支付宝余额宝','招商银行储蓄卡']), Z1);
  ok('Z4 四类选项的空项仍固定在最前，不参与排序', Z1.emptyFirst === true, Z1);
  ok('Z5 只改显示顺序：DB.categories / DB.tags 原始顺序一字未动（设置页照旧）',
     JSON.stringify(Z1.catRaw) === JSON.stringify(['餐饮','宠物','交通费','日用','数码电器'])
     && JSON.stringify(Z1.tagRaw) === JSON.stringify(['出差','报销','家庭','朋友聚会']), Z1);

  const Z6 = await wp.evaluate(() => {
    document.querySelector('[data-sel="fCategory"]').click();
    const rows = [...document.querySelectorAll('#pickerList .picker-row')].map(x => x.textContent.trim());
    const open = document.getElementById('pickerSheet').classList.contains('on');
    closePicker();
    return {rows:rows, open:open};
  });
  ok('Z6 紧凑选项弹层顺序与编号下拉完全一致（同一份 options 渲染，含最前面的「（无）」）',
     Z6.open === true
     && JSON.stringify(Z6.rows) === JSON.stringify(['（无）','餐饮','宠物','日用','交通费','数码电器']), Z6);

  const Z7 = await wp.evaluate(() => {
    setSelectValue('fCategory', '早午晚餐');    /* 4 字，历史值不在选项里 → 临时补项 */
    setSelectValue('fCategory', '饭');          /* 1 字 */
    const v = [...document.getElementById('fCategory').options].map(o => o.value);
    return {v:v, asc:v.slice(1).map(x => [...x].length).every((x, i, a) => i === 0 || a[i-1] <= x)};
  });
  ok('Z7 回填历史值时临时补的项也守住「字少在上」（1字「饭」插到第 1 位，4字补在末尾）',
     Z7.asc && Z7.v[1] === '饭' && Z7.v[Z7.v.length-1] === '早午晚餐', Z7);

  /* ---- v1.2.8：长按高亮（鼠标路径） ---- */
  await wp.evaluate(() => { closeSheet(); document.getElementById('tabAsset').click(); });
  await wait(320);

  const hlAt = (gi, n) => wp.evaluate((g, k) => {
    const els = [...document.querySelectorAll('.asset-list .asset-group')[g].querySelectorAll('.asset-item[data-acct]')];
    const r = els[k].getBoundingClientRect();
    return {id:els[k].dataset.acct, name:els[k].querySelector('.asset-row span').textContent,
            x:r.left + r.width/2, y:r.top + r.height/2};
  }, gi, n);
  const hlDom = () => wp.evaluate(() => ({
    asset:[...document.querySelectorAll('.asset-list .asset-group')[0].querySelectorAll('.asset-item[data-acct]')].map(e => e.dataset.acct),
    credit:[...document.querySelectorAll('.asset-list .asset-group')[1].querySelectorAll('.asset-item[data-acct]')].map(e => e.dataset.acct),
    hl:[...document.querySelectorAll('.asset-item.hl')].map(e => e.dataset.acct),
    store:(DB.settings.acctHl || []).slice(),
    stored:(() => { try { return (JSON.parse(localStorage.getItem('amhub_v100_db')).settings.acctHl || []).slice(); } catch(e) { return null; } })(),
    sheet:document.getElementById('acctSheet').classList.contains('on'),
    ghost:!!document.querySelector('.asset-item.dragging') || !!document.querySelector('.asset-ph')
  }));
  const hold = async (x, y, ms) => { await wp.mouse.move(x, y); await wp.mouse.down(); await wait(ms || 640); await wp.mouse.up(); await wait(320); };

  /* Z8 长按资产账户 → 高亮 */
  const hp0 = await hlAt(0, 0);
  await hold(hp0.x, hp0.y);
  const z8 = await hlDom();
  const z8bg = await wp.evaluate(() => {
    const e = document.querySelector('.asset-item.hl');
    return e ? getComputedStyle(e).backgroundColor : '';
  });
  ok('Z8 长按资产账户 450ms → 该行高亮为 #999，且不弹「修改账户」',
     JSON.stringify(z8.hl) === JSON.stringify([hp0.id]) && z8.sheet === false && z8bg === 'rgb(153, 153, 153)',
     {hl:z8.hl, sheet:z8.sheet, bg:z8bg, name:hp0.name});

  /* Z9 长按信贷账户 → 两类账户都能高亮（多选） */
  const hp1 = await hlAt(1, 0);
  await hold(hp1.x, hp1.y);
  const z9 = await hlDom();
  ok('Z9 长按信贷账户同样高亮，两类账户可同时标记（2 个）',
     JSON.stringify(z9.hl.slice().sort()) === JSON.stringify([hp0.id, hp1.id].sort()) && z9.sheet === false,
     {hl:z9.hl, creditName:hp1.name});

  /* Z10 再长按同一行 → 取消该行高亮（切换） */
  await hold(hp1.x, hp1.y);
  const z10 = await hlDom();
  ok('Z10 再长按同一账户取消该行高亮（其余不受影响）',
     JSON.stringify(z10.hl) === JSON.stringify([hp0.id]) && JSON.stringify(z10.store) === JSON.stringify([hp0.id]), z10);

  /* Z11 换设备：刷新页面后高亮原样保留（写进数据 settings.acctHl 并回读） */
  await wp.reload({waitUntil:'load'});
  await wait(320);
  await wp.evaluate(() => document.getElementById('tabAsset').click());
  await wait(260);
  const z11 = await hlDom();
  ok('Z11 刷新（＝换设备后恢复数据）高亮原样保留：settings.acctHl 落盘并回读',
     JSON.stringify(z11.hl) === JSON.stringify([hp0.id])
     && JSON.stringify(z11.store) === JSON.stringify([hp0.id])
     && JSON.stringify(z11.stored) === JSON.stringify([hp0.id]), z11);

  /* Z12 长按底部「资产」→ 一次清除全部高亮 */
  const hpTab = await wp.evaluate(() => { const r = document.getElementById('tabAsset').getBoundingClientRect(); return {x:r.left + r.width/2, y:r.top + r.height/2}; });
  await hold(hpTab.x, hpTab.y);
  const z12 = await hlDom();
  ok('Z12 长按底部「资产」按钮 → 清除全部高亮（并落盘），且不切页',
     z12.hl.length === 0 && z12.store.length === 0 && z12.stored.length === 0 && z12.sheet === false, z12);

  /* Z13 轻点仍走原来的「点击修改账户」 */
  await wait(420);
  const hTap = await hlAt(0, 0);
  await wp.mouse.click(hTap.x, hTap.y);
  await wait(280);
  const z13 = await hlDom();
  ok('Z13 轻点（未满 450ms）仍打开「修改账户」，轻点路径零变化',
     z13.sheet === true && z13.hl.length === 0, {sheet:z13.sheet, hl:z13.hl, name:hTap.name});
  await wp.evaluate(() => document.getElementById('acctClose').click());
  await wait(240);

  /* Z14 黑夜模式：高亮仍是中灰 #999，文字改黑 */
  const hDark = await hlAt(0, 1);
  await hold(hDark.x, hDark.y);
  const z14 = await wp.evaluate(() => {
    applyTheme(true, false);
    const e = document.querySelector('.asset-item.hl');
    const cs = e ? getComputedStyle(e) : null;
    return {bg:cs ? cs.backgroundColor : '', color:cs ? cs.color : '', n:document.querySelectorAll('.asset-item.hl').length};
  });
  await wp.evaluate(() => applyTheme(false, false));
  ok('Z14 黑夜高亮同为中灰 #999、文字改黑（白字压中灰对比度只有 2.9）',
     z14.n === 1 && z14.bg === 'rgb(153, 153, 153)' && z14.color === 'rgb(0, 0, 0)', z14);

  /* Z15 竖屏资产页不滚动（flow 锁住 + 页面本身不可滚动） */
  const z15 = await wp.evaluate(() => {
    const f = document.getElementById('flow');
    return {ov:getComputedStyle(f).overflowY, bodyOv:getComputedStyle(document.body).overflowY,
            docH:document.documentElement.scrollHeight, vh:innerHeight,
            cls:document.body.className, flowOver:f.scrollHeight - f.clientHeight};
  });
  ok('Z15 竖屏资产页不滚动：flow 锁死、页面不可整页滚动、无溢出幽灵滚动',
     z15.ov === 'hidden' && z15.bodyOv === 'hidden' && z15.cls.includes('tab-asset')
     && z15.docH <= z15.vh + 1 && z15.flowOver <= 1, z15);

  /* Z16 资产页两组自动排序（字数升序 → 同字数按资产 / 已用金额升序） */
  const z16 = await wp.evaluate(() => {
    const g = i => [...document.querySelectorAll('.asset-list .asset-group')[i].querySelectorAll('.asset-item[data-acct]')].map(e => ({
      id:e.dataset.acct,
      name:e.querySelector('.asset-row span').textContent,
      bal:parseFloat(e.querySelector('.asset-row span:last-child').textContent.replace(/,/g, '')),
      used:e.querySelector('.credit-meta') ? parseFloat(e.querySelector('.credit-meta span').textContent.replace(/[^0-9.]/g, '')) : null
    }));
    return {asset:g(0), credit:g(1), db:DB.accounts.map(x => x.id)};
  });
  ok('Z16 资产账户：名称字数升序，同字数资产少的在前（现金 50 → 微信 200 → 支付宝余额宝 300 → 招商银行储蓄卡 1000）',
     JSON.stringify(z16.asset.map(x => x.name)) === JSON.stringify(['现金','微信','支付宝余额宝','招商银行储蓄卡'])
     && z16.asset[0].bal <= z16.asset[1].bal, z16.asset);
  ok('Z17 信贷账户：名称字数升序，同字数已用金额少的在前（花呗 100 → 中信信用卡 300）',
     JSON.stringify(z16.credit.map(x => x.name)) === JSON.stringify(['花呗','中信信用卡'])
     && z16.credit[0].used <= z16.credit[1].used, z16.credit);
  ok('Z18 排序只改显示：DB.accounts 存储顺序一字未动（备份导出不受影响）',
     JSON.stringify(z16.db) === JSON.stringify(['a1','a2','a3','a4','c1','c2']), z16.db);

  /* Z19 账单页：下方流水区自己滚，上方日历与日期条不动 */
  await wp.evaluate(() => {
    const mk = i => ({id:'tx' + i, type:'expense', date:'2026-11-08', time:'0' + (i % 10) + ':00',
                      amount:10 + i, from:'微信', fromId:'a2', category:'餐饮', note:''});
    DB.tx = Array.from({length:18}, (_, i) => mk(i));
    persistDB(); setDate('2026-11-08');
    document.getElementById('tabBill').click();
  });
  await wait(300);
  const z19 = await wp.evaluate(() => {
    const f = document.getElementById('flow');
    const c0 = document.querySelector('.cal').getBoundingClientRect().top;
    const d0 = document.getElementById('dateBar').getBoundingClientRect().top;
    const sh = f.scrollHeight, ch = f.clientHeight, ov = getComputedStyle(f).overflowY;
    f.scrollTop = 240;
    const c1 = document.querySelector('.cal').getBoundingClientRect().top;
    const d1 = document.getElementById('dateBar').getBoundingClientRect().top;
    return {ov:ov, sh:sh, ch:ch, cal:[c0, c1], bar:[d0, d1], st:f.scrollTop, win:window.scrollY,
            rows:document.querySelectorAll('.flow-row').length};
  });
  ok('Z19 账单页：流水区独立滚动（overflow auto、内容高于容器），上方日历与日期条位置不变、窗口不滚动',
     z19.ov === 'auto' && z19.sh > z19.ch && z19.st > 0
     && Math.abs(z19.cal[1] - z19.cal[0]) < 0.5 && Math.abs(z19.bar[1] - z19.bar[0]) < 0.5
     && z19.win === 0, z19);

  /* Z20 触摸路径：合成 pointerType=touch 的长按同样能高亮 */
  await wp.evaluate(() => {
    DB.settings.acctHl = []; persistDB();      /* 先清干净，只验 Z20 自己这一下 */
    document.getElementById('tabAsset').click();
  });
  await wait(260);
  const z20 = await wp.evaluate(async () => {
    const w2 = ms => new Promise(r => setTimeout(r, ms));
    const el = document.querySelectorAll('.asset-list .asset-group')[1].querySelectorAll('.asset-item[data-acct]')[0];
    const r = el.getBoundingClientRect();
    const id = el.dataset.acct;
    const fire = (tgt, type, y, extra) => tgt.dispatchEvent(new PointerEvent(type, Object.assign({
      bubbles:true, cancelable:true, clientX:0, clientY:y,
      pointerId:7, pointerType:'touch', isPrimary:true, button:0, buttons:1
    }, extra || {})));
    fire(el, 'pointerdown', r.top + r.height / 2);
    await w2(640);
    fire(document, 'pointerup', r.top + r.height / 2, {buttons:0});
    await w2(200);
    return {id:id, hl:[...document.querySelectorAll('.asset-item.hl')].map(e => e.dataset.acct),
            store:(DB.settings.acctHl || []).slice(), ghost:!!document.querySelector('.asset-item.dragging')};
  });
  ok('Z20 触摸长按同样可高亮（合成 pointerType=touch），且不再有拖拽残留',
     JSON.stringify(z20.hl) === JSON.stringify([z20.id]) && z20.ghost === false
     && JSON.stringify(z20.store) === JSON.stringify([z20.id]), z20);

  /* Z21 顶栏五项功能大小不变（外扩只吃中间空档） */
  const z21 = await wp.evaluate(() => [...document.querySelectorAll('.topbar .bx')].map(e => ({
    t:e.textContent.trim(), w:+e.getBoundingClientRect().width.toFixed(2), h:+e.getBoundingClientRect().height.toFixed(2),
    fs:getComputedStyle(e).fontSize
  })));
  /* v1.4.5：顶栏改五格，「资产管理中枢」整格移除（v1.2.8 的逐项尺寸与 v1.4.3 的六格等分随之作废，
     等宽量在 AC2）。这里只验「四个功能键彼此等宽 + 五格同高 32px + 字号未变」。 */
  ok('Z21 顶栏四功能键宽度彼此一致（v1.4.5：资产管理中枢一格让出，四键各 73.8 / 360px 下 59.8），高 32、字号 12.24 不变',
     z21.length === 5
     && Math.max(...z21.slice(0, 4).map(x => x.w)) - Math.min(...z21.slice(0, 4).map(x => x.w)) < 0.05
     && z21.every(x => x.h === 32 && x.fs === '12.24px'), z21);

  /* Z22 v1.2.9：页脚版本行移除 → 面板下边框随 flex 自动下延（账单页 / 资产页都验） */
  const z22measure = () => wp.evaluate(() => {
    const app = document.querySelector('.app'), panel = document.querySelector('.panel');
    const dock = document.querySelector('.bottombar');
    const ar = app.getBoundingClientRect(), pr = panel.getBoundingClientRect(), dr = dock.getBoundingClientRect();
    const appPadB = parseFloat(getComputedStyle(app).paddingBottom);
    const r = v => Math.round(v * 100) / 100;
    return {
      hasVer: !!document.querySelector('.ver'),
      verRules: [...document.querySelectorAll('style')].some(s => /(^|\n)\s*\.ver\s*\{/.test(s.textContent)),
      text: (document.body.innerText.match(/资产管理中枢\s*v\d+\.\d+\.\d+/g) || []),
      gapPanelToAppInnerBottom: r(ar.bottom - appPadB - pr.bottom),
      gapPanelToDock: r(dr.top - pr.bottom),
      panelBottom: r(pr.bottom), flowH: r(document.getElementById('flow').clientHeight),
      appPadB: appPadB, bodyPadB: getComputedStyle(document.body).paddingBottom,
      tab: (document.querySelector('.tab.active') || {}).textContent
    };
  });
  /* Z20 的长按会设 HL_SUPPRESS（抬手后 500ms 内吞掉 click），先等它过期再切页，
     否则点在「账单」上会被静默拦掉、后面量到的仍是资产页的几何 */
  await wait(620);
  await wp.evaluate(() => document.getElementById('tabBill').click());
  await wait(260);
  const z22bill = await z22measure();
  await wp.evaluate(() => document.getElementById('tabAsset').click());
  await wait(240);
  const z22asset = await z22measure();
  await wp.evaluate(() => document.getElementById('tabBill').click());
  await wait(180);
  ok('Z22 v1.2.9 页脚版本行已移除：无 .ver 节点、无 .ver 规则、正文不再出现「资产管理中枢 vX.Y.Z」',
     !z22bill.hasVer && !z22bill.verRules && z22bill.text.length === 0
     && !z22asset.hasVer && z22asset.text.length === 0, {bill:z22bill, asset:z22asset});
  ok('Z22b 面板成为 .app 最后一块：底边正好落在 .app 内容区下沿（间隙 0），不再被页脚顶住',
     Math.abs(z22bill.gapPanelToAppInnerBottom) < 0.5 && Math.abs(z22asset.gapPanelToAppInnerBottom) < 0.5, z22bill);
  ok('Z22c 面板底边框与 dock 顶留 8px（v1.3.0：body 46 + .app 底 7 − dock 45），不贴边',
     Math.abs(z22bill.gapPanelToDock - 8) < 0.5 && Math.abs(z22asset.gapPanelToDock - 8) < 0.5
     && z22bill.bodyPadB === '46px' && Math.abs(z22bill.appPadB - 7) < 0.01, z22bill);
  ok('Z22d v1.0.0 六项视觉改动后流水区几何（账单 491 / 资产 633）',
     z22bill.tab === '账单' && z22asset.tab === '资产'
     && Math.abs(z22bill.flowH - 491) < 0.6 && Math.abs(z22asset.flowH - 633) < 0.6,
     {bill:{tab:z22bill.tab, flow:z22bill.flowH}, asset:{tab:z22asset.tab, flow:z22asset.flowH}});

  /* Z23 v1.2.10：dock 底部内距 4→2px —— 三个按钮的下边框到屏幕底边原来留 4px，本版减半为 2px；
     dock 盒高 47→45px，body 让位同步 56→54px，面板↔dock 的 16px 呼吸与按钮尺寸全部不变。 */
  const z23 = await wp.evaluate(() => {
    const dock = document.querySelector('.bottombar');
    const cs = getComputedStyle(dock);
    const btns = [...dock.querySelectorAll('button')];
    const R = v => Math.round(v * 100) / 100;
    const btnBottom = Math.max(...btns.map(e => e.getBoundingClientRect().bottom));
    const dr = dock.getBoundingClientRect();
    return {
      vh: innerHeight,
      gapBtnToVH: R(innerHeight - btnBottom),
      dockH: R(dr.height), dockTop: R(dr.top),
      padTop: cs.paddingTop, padLeft: cs.paddingLeft, padRight: cs.paddingRight, padB: cs.paddingBottom,
      btnH: btns.map(e => R(e.getBoundingClientRect().height)),
      btnW: btns.map(e => R(e.getBoundingClientRect().width)),
      panelBottom: R(document.querySelector('.panel').getBoundingClientRect().bottom),
      bodyScrollable: document.documentElement.scrollHeight > innerHeight
    };
  });
  ok('Z23 v1.2.10 dock 内距 2px 不变；v1.4.1 四框上移后按钮底边距屏幕底 8px，盒高仍 45px',
     Math.abs(z23.gapBtnToVH - 8) < 0.01 && Math.abs(z23.dockH - 45) < 0.01, z23);
  ok('Z23b dock 顶部 7px / 左右 10px / 底部 2px 内距（v1.4.5 左右 9→10）；按钮四项等分 × 36',
     z23.padTop === '7px' && z23.padLeft === '10px' && z23.padRight === '10px' && z23.padB === '2px'
     && z23.btnH.length === 4 && z23.btnH.every(h => h === 36)
     && new Set(z23.btnW).size === 1, z23);

  ok('Z23c 面板与 dock 均未动（面板底 738 / dock 顶 746，v1.3.0 只让面板多长 8px），页面本体仍不滚动',
     Math.abs(z23.panelBottom - 738) < 0.6 && Math.abs(z23.vh - z23.dockTop - z23.dockH) < 0.01
     && !z23.bodyScrollable, z23);
  /* Z24 v1.3.0：面板↔dock 呼吸位 16→8px —— 只把 body 让位 54→46px，
     dock 盒高 45px 与 .app 底内距 7px 一个字不动（不是靠把面板拽下去、也不是贴边）。 */
  ok('Z24 v1.3.0 面板↔dock 呼吸位 16→8px（dock 顶 − 面板底 = 8），dock 盒高仍 45px',
     Math.abs(z23.dockTop - z23.panelBottom - 8) < 0.01 && Math.abs(z23.dockH - 45) < 0.01,
     {gap:Math.round((z23.dockTop - z23.panelBottom) * 100) / 100, dockH:z23.dockH});

  /* ---- Z25 v1.3.5：标签移到金额前、自适应金额长度 ----------------------
     v1.3.1 曾把标签与账户拆两个固定槽、把标签左缘钉死；v1.3.5 标签移到第一行
     金额前、随金额长度浮动，第二行回归纯账户单串。用真实 DOM 量坐标与结构。 */
  const Z25TX = [
    {id:'a',type:'expense',date:'2026-11-08',time:'22:23',category:'奶茶',note:'爷爷不泡茶',from:'支付宝',to:'',tag:'淘宝闪购',amount:1.97},
    {id:'b',type:'expense',date:'2026-11-08',time:'22:22',category:'便利店',note:'',from:'微信',to:'',tag:'淘宝闪购',amount:0.30},
    {id:'c',type:'expense',date:'2026-11-08',time:'22:37',category:'水果',note:'小吃谷·芒草鲜果',from:'中信银行信用卡',to:'',tag:'淘宝闪购',amount:5.71},
    {id:'d',type:'expense',date:'2026-11-08',time:'22:16',category:'便利店',note:'',from:'支付宝',to:'',tag:'',amount:1.00},
    {id:'e',type:'reimburse',date:'2026-11-08',time:'22:08',category:'',note:'手续费-0.04|回款+11',from:'宁波银行信用卡',to:'微信',tag:'',amount:0.04}
  ];
  const z25measure = () => wp.evaluate(tx => {
    DB.tx = tx; S.date = '2026-11-08'; S.tab = 'bill'; renderFlow();
    const R = e => e.getBoundingClientRect();
    const rows = [...document.querySelectorAll('.flow-row')];
    const tagged = rows.filter(r => r.querySelector('.line1 .r.has-tag'));
    const plain  = rows.filter(r => !r.querySelector('.line1 .r.has-tag'));
    return {
      amtR:  rows.map(r => +R(r.querySelector('.line1 .r')).right.toFixed(2)),
      tagBeforeAmt: tagged.every(r => {
        const t = r.querySelector('.line1 .r .tag'), a = r.querySelector('.line1 .r .amt');
        return t && a && R(t).right < R(a).left;
      }),
      taggedN: tagged.length, plainN: plain.length,
      r2HTML: tagged.map(r => r.querySelector('.line2 .r').outerHTML),
      r2HasTag: tagged.some(r => r.querySelector('.line2 .r.has-tag')),
      noOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      noOld: typeof measureTagSlots !== 'function'
        && !getComputedStyle(document.getElementById('flow')).getPropertyValue('--tag-w').trim()
    };
  }, Z25TX);

  await wp.setViewport({width:360, height:791, deviceScaleFactor:1});
  const z25m = await z25measure();
  const rng = a => Math.max.apply(null, a) - Math.min.apply(null, a);
  ok('Z25a v1.3.5 手机档：3 条带标签流水标签均在金额左侧、金额右边缘贴齐（跨度 0）',
     z25m.taggedN === 3 && z25m.tagBeforeAmt && rng(z25m.amtR) < 0.01 && z25m.noOld, z25m);
  ok('Z25b 第二行仅纯账户串（不拆槽），无标签行仍是 v1.3.0 单串',
     !z25m.r2HasTag && z25m.r2HTML.every(h => h.indexOf('<span class="r" title="账户">') === 0), z25m);
  ok('Z25c 标签在金额前不撑破 360px 视口（无横向溢出）',
     z25m.noOverflow, z25m);

  /* 标签随金额长度浮动：同一标签、金额长短不同时，标签左边缘应跟着移动（不再钉死） */
  const z25float = await wp.evaluate(() => {
    DB.tx = [
      {id:'L',type:'repay',date:S.date,time:'10:00',from:'银行卡',to:'证券',tag:'吉吉',amount:11000,discount:1000},
      {id:'S',type:'repay',date:S.date,time:'10:01',from:'银行卡',to:'证券',tag:'吉吉',amount:110,discount:10}
    ]; renderFlow();
    const R = e => e.getBoundingClientRect();
    const tL = R(document.querySelector('[data-id="L"] .line1 .r .tag')).left;
    const tS = R(document.querySelector('[data-id="S"] .line1 .r .tag')).left;
    const aL = document.querySelector('[data-id="L"] .line1 .r .amt').textContent;
    const aS = document.querySelector('[data-id="S"] .line1 .r .amt').textContent;
    return {tL:+tL.toFixed(2), tS:+tS.toFixed(2), aL, aS};
  });
  ok('Z25d 自适应金额长度：金额越短标签越靠右（长金额 10000→11000 / 短金额 100→110）',
     z25float.aL === '10000→11000' && z25float.aS === '100→110' && z25float.tS > z25float.tL, z25float);

  /* 标签变化的流水行仍可点击打开「修改流水」弹层 */
  const z25click = await wp.evaluate(() => {
    DB.tx = [{id:'z',type:'expense',date:'2026-11-08',time:'22:23',category:'奶茶',
              note:'爷爷不泡茶',from:'支付宝',to:'',tag:'淘宝闪购',amount:1.97}];
    renderFlow();
    const before = document.querySelectorAll('.sheet.on').length;
    document.querySelector('.flow-row').click();
    return {before, after:document.querySelectorAll('.sheet.on').length,
            title:document.getElementById('sheetTitle').textContent};
  });
  ok('Z25e 带标签行仍可点击打开「修改流水」弹层（事件委托未受结构改动影响）',
     z25click.after > z25click.before && z25click.title === '修改流水', z25click);

  /* 平板档（≥560px，dock 是左侧竖栏）同样要对齐 */
  await wp.setViewport({width:768, height:1024, deviceScaleFactor:1});
  const z25t = await z25measure();
  ok('Z25h 平板 768×1024：金额右边缘零漂移、无横向溢出（标签随金额浮动是预期，不量左缘）',
     z25t.taggedN === 3 && rng(z25t.amtR) < 0.01 && z25t.noOverflow && z25t.noOld, z25t);

  /* v1.3.6：真实 DOM 验证「标签|金额」三者垂直中线齐平 + 全流水条字号颜色统一 */
  const z25flat = await wp.evaluate(() => {
    DB.tx = [
      {id:'F',type:'repay',date:S.date,time:'10:00',from:'银行卡',to:'证券',tag:'吉吉',amount:11000,discount:1000},
      {id:'G',type:'income',date:S.date,time:'09:00',to:'银行卡',tag:'工资',amount:8000,noCount:true}
    ]; renderFlow();
    const cell = document.querySelector('[data-id="F"] .line1 .r');
    const tag = cell.querySelector('.tag'), sep = cell.querySelector('.sep'), amt = cell.querySelector('.amt');
    const R = e => e.getBoundingClientRect();
    const mid = e => R(e).top + R(e).height / 2;
    const grow = document.querySelector('[data-id="G"]');
    const nc = grow.querySelector('.piece.nc'), body = grow.querySelector('.line2 .l');
    return {
      display: getComputedStyle(cell).display, align: getComputedStyle(cell).alignItems,
      tagMid: +mid(tag).toFixed(2), sepMid: +mid(sep).toFixed(2), amtMid: +mid(amt).toFixed(2),
      sepColor: getComputedStyle(sep).color, amtColor: getComputedStyle(amt).color,
      ncFont: getComputedStyle(nc).fontSize, bodyFont: getComputedStyle(body).fontSize,
      ncColor: getComputedStyle(nc).color, bodyColor: getComputedStyle(body).color
    };
  });
  /* 注：.r 是 .body 的 grid item，Chrome 会把 inline-flex 块化成 flex，
     故计算值读作 'flex' —— 判据取「flex 系 + 中线对齐」而不是死磕字面量。 */
  ok('Z25f v1.3.6 flex 中线对齐（grid item 会块化 inline-flex）：标签 / | / 金额三者垂直中线差 < 1px',
     (z25flat.display === 'flex' || z25flat.display === 'inline-flex') && z25flat.align === 'center'
     && Math.abs(z25flat.tagMid - z25flat.amtMid) < 1
     && Math.abs(z25flat.sepMid - z25flat.amtMid) < 1, z25flat);
  ok('Z25g v1.3.6 标签|与金额同色、不计入小字与正文同字号同色（缺账户 --warn 例外）',
     z25flat.sepColor === z25flat.amtColor
     && z25flat.ncFont === z25flat.bodyFont
     && z25flat.ncColor === z25flat.bodyColor, z25flat);


  /* ===== AA) v1.3.8：12 月金额格真实布局 / KPI 不截断 / 末条底边不叠黑边 ===== */
  console.log('\n===== AA) v1.3.8 月份金额格 · KPI · 末条底边 =====');
  const hp = await browser.newPage();
  await hp.setViewport({width:430, height:900});
  await hp.evaluateOnNewDocument(fx => {
    const tx = [];
    for (let mo = 1; mo <= 12; mo++) {
      fx.tx.slice(0, 4).forEach((t, i) => {
        const c = Object.assign({}, t);
        c.id = 'aa' + mo + '_' + i;
        c.date = '2026-' + String(mo).padStart(2, '0') + '-' + String(2 + i * 4).padStart(2, '0');
        c.amount = (mo === 11 && i === 0) ? 20095.3 : 10 + mo;
        if (mo === 11 && i === 3) {   /* 给 11 月补一笔收入，让「收入」切换键有数可看 */
          c.type = 'income'; c.to = c.from; c.toId = c.fromId; c.from = ''; c.fromId = '';
          c.amount = 1336.66;
        }
        tx.push(c);
      });
    }
    localStorage.clear();
    localStorage.setItem('amhub_v100_db', JSON.stringify(Object.assign({}, fx, {tx:tx})));
  }, FIXTURE);
  await hp.goto(HTML, {waitUntil:'load'});
  await wait(250);
  /* v1.4.0 起三块本年网格直出总览页，不再有 hub 入口卡 / 独立页 / 返回键。
     v1.4.1 在此补量「三块都真的画出 2px 顶边」与竖线 / 页签 / 四框上移的计算样式。 */
  const HV = await hp.evaluate(() => {
    const R = e => e.getBoundingClientRect();
    const blocks = [...document.querySelectorAll('#flow .ov-heat')];
    const cells = [...document.querySelectorAll('#flow .ov-cell')];
    const kpiSpans = sel => [...document.querySelectorAll(sel + ' span')]
      .map(x => ({t:x.textContent, sw:x.scrollWidth, cw:x.clientWidth}));
    const sep = blocks[0].querySelector('.ov-sep');
    const tabA = document.querySelector('.tab.active');
    const tabI = document.querySelector('.tab:not(.active)');
    const bar = document.querySelector('.bottombar');
    const btns = [...bar.querySelectorAll('button')];
    return {
      nBlocks: blocks.length, kinds: blocks.map(b => b.dataset.ovKind),
      titles: blocks.map(b => b.querySelector('.ov-heat-title').textContent),
      borderTop: blocks.map(b => getComputedStyle(b).borderTopWidth),
      borderAll: blocks.map(b => {
        const st = getComputedStyle(b);
        return [st.borderTopWidth,st.borderRightWidth,st.borderBottomWidth,st.borderLeftWidth].join('/');
      }),
      gaps: blocks.slice(1).map((b,i) => +(R(b).top - R(blocks[i]).bottom).toFixed(2)),
      nCells: cells.length,
      mos: cells.slice(0,12).map(c => c.querySelector('.ov-mo').textContent),
      widths: cells.slice(0,12).map(c => +R(c).width.toFixed(1)),
      rowTops: blocks.map(b => [...new Set([...b.querySelectorAll('.ov-cell')].map(c => Math.round(R(c).top)))].length),
      inlineBg: cells.filter(c => c.hasAttribute('style')).length,
      bg: [...new Set(cells.map(c => getComputedStyle(c).backgroundColor))],
      back: !!document.querySelector('[data-ov-back]'),
      toggles: document.querySelectorAll('[data-ov-metric],.ov-metric').length,
      sepFs: getComputedStyle(sep).fontSize, sepColor: getComputedStyle(sep).color,
      titleFs: getComputedStyle(blocks[0].querySelector('.ov-heat-title')).fontSize,
      tabFsA: getComputedStyle(tabA).fontSize, tabFsI: getComputedStyle(tabI).fontSize,
      tabWeightA: getComputedStyle(tabA).fontWeight, tabWeightI: getComputedStyle(tabI).fontWeight,
      tabColorA: getComputedStyle(tabA).color, tabColorI: getComputedStyle(tabI).color,
      btnTop: btns.map(b => getComputedStyle(b).top),
      btnGapToVH: +(innerHeight - Math.max(...btns.map(b => R(b).bottom))).toFixed(2),
      dockH: +R(bar).height.toFixed(2), dockPadB: getComputedStyle(bar).paddingBottom,
      bodyPadB: getComputedStyle(document.body).paddingBottom,
      monthKpi: kpiSpans('#monthKpi'), dayKpi: kpiSpans('#dayKpi'),
      kpiFs: parseFloat(getComputedStyle(document.querySelector('#dayKpi')).fontSize),
      panelFs: parseFloat(getComputedStyle(document.querySelector('.panel')).fontSize)
    };
  });
  ok('AA0 三块直出总览：结余 / 收入 / 支出，12 格 × 3 = 36 格，无返回键 / 无切换键',
     HV.nBlocks === 3 && JSON.stringify(HV.kinds) === JSON.stringify(['bal','inc','exp'])
     && JSON.stringify(HV.titles) === JSON.stringify(['本年结余','本年收入','本年支出'])
     && HV.nCells === 36 && HV.back === false && HV.toggles === 0, HV);
  ok('AA1 v1.0.0 三块的顶边都画出 1px（收入 / 支出不再开口），四边齐全',
     HV.borderTop.every(w => w === '1px') && HV.borderAll.every(x => x === '1px/1px/1px/1px'), HV.borderAll);
  ok('AA2 块间仍是 6px 白隙（两条独立的 2px 线，不叠成 4px 粗线）',
     HV.gaps.length === 2 && HV.gaps.every(g => Math.abs(g - 6) < 0.6), HV.gaps);
  ok('AA3 12 个月格 1~12 折成两行、严格等宽、无热力深浅',
     HV.mos.join(',') === '1,2,3,4,5,6,7,8,9,10,11,12'
     && HV.rowTops.length === 3 && HV.rowTops.every(n => n === 2) && HV.widths.every(w => w === HV.widths[0])
     && HV.inlineBg === 0 && HV.bg.length === 1, HV);
  ok('AA4 v1.4.1 竖线与标题同字号、颜色为主题正文色（默认深色 ink）',
     HV.sepFs === HV.titleFs && HV.sepColor === 'rgb(230, 237, 243)',
     {sepFs:HV.sepFs, titleFs:HV.titleFs, color:HV.sepColor});
  ok('AA5 v1.4.1 选中页签与未选页签同字号同字色同字重（选中态只靠指示条）',
     HV.tabFsA === HV.tabFsI && HV.tabColorA === HV.tabColorI && HV.tabWeightA === HV.tabWeightI,
     {a:[HV.tabFsA,HV.tabColorA,HV.tabWeightA], i:[HV.tabFsI,HV.tabColorI,HV.tabWeightI]});
  ok('AA6 v1.4.1 四个框整体上移 6px（top:-6px / 底边距视口 8px），dock 盒高与内距不变',
     HV.btnTop.every(t => t === '-6px') && Math.abs(HV.btnGapToVH - 8) < 0.05
     && Math.abs(HV.dockH - 45) < 0.05 && HV.dockPadB === '2px' && HV.bodyPadB === '46px', HV);
  ok('AA7 KPI 缩到面板字号的 86%，三格都不被省略（含 -20095.30 这种长数）',
     Math.abs(HV.kpiFs / HV.panelFs - 0.86) < 0.01
     && HV.monthKpi.every(x => x.sw <= x.cw) && HV.dayKpi.every(x => x.sw <= x.cw),
     {fs:HV.kpiFs, panel:HV.panelFs});
  /* v1.4.2：全站小圆弧 —— 量真实计算样式，不只看 CSS 文本。
     必须在切到账单页之前量：总览的三块 / 格网只存在于总览页。 */
  const RD = await hp.evaluate(() => {
    const cs = e => getComputedStyle(e);
    const q = s => document.querySelector(s);
    const blocks = [...document.querySelectorAll('#flow .ov-heat')];
    const cells = [...document.querySelectorAll('#flow .ov-cell')];
    const btns = [...document.querySelectorAll('.bottombar>button')];
    const px = v => parseFloat(v);
    return {
      rTok: cs(document.documentElement).getPropertyValue('--r').trim(),
      rsTok: cs(document.documentElement).getPropertyValue('--r-s').trim(),
      panel: cs(q('.panel')).borderTopLeftRadius,
      panelOv: cs(q('.panel')).overflow,
      heat: blocks.map(b => px(cs(b).borderTopLeftRadius)),
      heatCorner: blocks.map(b => [cs(b).borderTopLeftRadius, cs(b).borderTopRightRadius,
                                   cs(b).borderBottomRightRadius, cs(b).borderBottomLeftRadius].join('/')),
      cell: [...new Set(cells.map(c => cs(c).borderTopLeftRadius))],
      bx: px(cs(q('.bx')).borderTopLeftRadius),
      // dock：首块左两角 / 末块右两角有半径，中间接缝必须仍是 0
      btn: btns.map(b => [cs(b).borderTopLeftRadius, cs(b).borderTopRightRadius,
                          cs(b).borderBottomRightRadius, cs(b).borderBottomLeftRadius]),
      // 圆角不能改变几何：三块仍 6px 白隙、dock 盒高 45、按钮 top -6px
      gaps: blocks.slice(1).map((b, i) => +(b.getBoundingClientRect().top - blocks[i].getBoundingClientRect().bottom).toFixed(2)),
      dockH: +q('.bottombar').getBoundingClientRect().height.toFixed(2),
      btnTop: cs(btns[0]).top
    };
  });
  const pxN = v => parseFloat(v);          // Node 侧取数值（页面里的 px 只活在 evaluate 内）
  /* v1.0.0：总览 / 资产 / 账单三页面板全部去外框（radius 0）。
     三态依次切页量 .panel 的左上半径，量完回到总览，不影响后续基于 RD 的断言。 */
  const PR = await hp.evaluate(() => {
    const r = () => parseFloat(getComputedStyle(document.querySelector('.panel')).borderTopLeftRadius);
    const out = {overview:r()};
    document.getElementById('tabAsset').click(); out.asset = r();
    document.getElementById('tabBill').click();   out.bill = r();
    document.getElementById('tabOv').click();     out.back = r();
    return out;
  });
  ok('AB1 v1.4.2 半径令牌落到计算样式：--r 8px / --r-s 4px',
     RD.rTok === '8px' && RD.rsTok === '4px', {r:RD.rTok, rs:RD.rsTok});
  ok('AB2 v1.0.0 三页面板全部去外框（0px），本年卡片仍 8px 且父容器裁切',
     PR.overview === 0 && PR.asset === 0 && PR.bill === 0 && PR.back === 0
     && pxN(RD.panel) === 0 && RD.heat.length === 3 && RD.heat.every(v => v === 8)
     && RD.heatCorner.every(s => s === '8px/8px/8px/8px') && RD.panelOv === 'hidden',
     {panelR:PR, panel:RD.panel, heat:RD.heat, corner:RD.heatCorner, ov:RD.panelOv});
  ok('AB3 v1.4.2 控件级 4px 生效（顶栏按钮），月份格仍是直角',
     RD.bx === 4 && RD.cell.length === 1 && pxN(RD.cell[0]) === 0,
     {bx:RD.bx, cell:RD.cell});
  ok('AB4 v1.0.0 dock 四块独立边框后四角全圆 8px（不再只圆首尾）',
     RD.btn.length === 4 && RD.btn.every(b => b.join('/') === '8px/8px/8px/8px'), RD.btn);
  ok('AB5 v1.4.2 圆角没有撬动任何几何：三块 6px 白隙 / dock 盒高 45 / 四框仍 top:-6px',
     RD.gaps.length === 2 && RD.gaps.every(g => Math.abs(g - 6) < 0.6)
     && Math.abs(RD.dockH - 45) < 0.05 && RD.btnTop === '-6px', RD);
  /* 滚到底：末条底边 vs 面板底边，必须留出 >2px 的空隙，不叠成 4px 大黑边 */
  const SC = await hp.evaluate(fx => {
    document.getElementById('tabBill').click();
    const t = [];
    for (let i = 0; i < 30; i++) {
      const c = Object.assign({}, fx.tx[0]);
      c.id = 'aa_scroll_' + i;
      c.date = S.date;
      c.time = String(8 + Math.floor(i / 6)).padStart(2, '0') + ':' + String((i % 6) * 10).padStart(2, '0');
      c.amount = 10 + i;
      t.push(c);
    }
    DB.tx = t; renderAll();
    const f = document.getElementById('flow');
    f.scrollTop = f.scrollHeight;
    const last = document.querySelector('.flow-list .flow-row:last-child');
    const panel = document.querySelector('.panel');
    return {
      border: getComputedStyle(last).borderBottomWidth,
      lastBottom: +last.getBoundingClientRect().bottom.toFixed(1),
      panelInner: +(panel.getBoundingClientRect().bottom - parseFloat(getComputedStyle(panel).borderBottomWidth)).toFixed(1),
      listPad: getComputedStyle(document.querySelector('.flow-list')).paddingBottom,
      atBottom: f.scrollTop >= f.scrollHeight - f.clientHeight - 1
    };
  }, FIXTURE);
  const gap = +(SC.panelInner - SC.lastBottom).toFixed(1);
  ok('AA8 v1.0.0 滚到底时末条流水有 1px 底边，且与面板底边留 ' + gap + 'px 空隙',
     SC.atBottom && SC.border === '1px' && SC.listPad === '8px' && gap > 2 && gap < 20,
     Object.assign({}, SC, {gap:gap}));

  /* v1.0.0：账单页（已切过去、已滚到底）量「列表内的控件」圆角。
     徽标 / 日期格是 4px，流水行升级为四边独立边框的卡片、同样 4px 圆角，
     面板已去整页大外框（0px）。 */
  const RB = await hp.evaluate(() => {
    const cs = e => getComputedStyle(e);
    const px = v => parseFloat(v);
    const q = s => document.querySelector(s);
    const rows = [...document.querySelectorAll('.flow-row')];
    return {
      badge: px(cs(q('.badge')).borderTopLeftRadius),
      badgeCorner: [cs(q('.badge')).borderTopLeftRadius, cs(q('.badge')).borderBottomRightRadius].join('/'),
      day: px(cs(q('.day')).borderTopLeftRadius),
      row: [...new Set(rows.map(r => cs(r).borderTopLeftRadius))],
      rowHasRadius: rows.some(r => ['borderTopLeftRadius','borderTopRightRadius',
        'borderBottomLeftRadius','borderBottomRightRadius']
        .some(k => px(cs(r)[k]) > 0)),
      panel: px(cs(q('.panel')).borderTopLeftRadius),
      list: cs(q('.flow-list')).borderTopLeftRadius
    };
  });
  ok('AB6 v1.0.0 账单页徽标/日期格 4px，流水条为独立卡片四角 4px，面板去外框 0',
     RB.badge === 4 && RB.badgeCorner === '4px/4px' && RB.day === 4
     && RB.row.length === 1 && pxN(RB.row[0]) === 4 && RB.rowHasRadius === true
     && RB.panel === 0, RB);
  /* v1.4.3：顶栏六格（前五格等宽）+ 总览金额带正负号 —— 真实 Chrome 量计算样式 */
  await hp.evaluate(() => document.getElementById('tabOv').click());   // AB6 量完账单页停在那里，先切回总览
  await wait(350);
  const TB = await hp.evaluate(() => {
    const R = e => e.getBoundingClientRect();
    const cs = e => getComputedStyle(e);
    const bar = document.querySelector('.topbar');
    const btns = [...bar.querySelectorAll('button')];
    const cells = [...document.querySelectorAll('.ov-val')];
    const cards = [...document.querySelectorAll('.ov-cards')].map(g =>
      [...g.querySelectorAll('.card')].map(c =>
        c.querySelector('.lab').textContent + '=' + c.querySelector('.val').textContent));
    return {
      ids: btns.map(b => b.id),
      w: btns.map(b => +R(b).width.toFixed(2)),
      h: btns.map(b => +R(b).height.toFixed(2)),
      barW: +R(bar).width.toFixed(2),
      barScroll: bar.scrollWidth, barClient: bar.clientWidth,
      pageOverX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      spacer: bar.querySelectorAll('.spacer').length,
      barTop: +R(bar).top.toFixed(2),
      panelTop: +R(document.querySelector('.panel')).top.toFixed(2),
      cards: cards,
      sums: [...document.querySelectorAll('.ov-heat-sum')].map(e => e.textContent.trim()),
      cellSigns: [...new Set(cells.map(c => c.textContent.trim()[0]))],
      cellBad: cells.filter(c => {
        const v = c.textContent.trim();
        return !(v === '0.00' || v[0] === '+' || v[0] === '-');
      }).length,
      cellN: cells.length,
      cellEllipsis: cells.filter(c => c.scrollWidth > c.clientWidth + 1).length,
      wide: cells.map(c => c.textContent.trim()).sort((a, b) => b.length - a.length)[0],
      kpi: document.getElementById('monthKpi').textContent
    };
  });
  ok('AC1 v1.4.5 顶栏五格顺序 = 设置 / 备份 / 恢复 / 明暗 / 新增账户（「资产管理中枢」已移除）',
     TB.ids.join(',') === 'btnSettings,btnBackup,btnRestore,btnTheme,btnAddAccount', TB.ids);
  ok('AC2 v1.4.5 四功能键等宽（最大最小差 < 0.6px），五格同高 32px',
     Math.max(...TB.w.slice(0, 4)) - Math.min(...TB.w.slice(0, 4)) < 0.6
     && TB.h.every(x => Math.abs(x - 32) < 0.6), {w:TB.w, h:TB.h});
  ok('AC3 v1.4.3 顶栏一行放得下六格（无横向溢出，也不挤压面板宽度）',
     TB.spacer === 0 && TB.barScroll <= TB.barClient + 1 && TB.pageOverX <= 0, TB);
  ok('AC4 v1.4.3 本月三卡带号（非 0 必带 +/-，支出取负）、资产三卡不加号（余额性质）',
     (() => {
       const CV = TB.cards.map(g => g.map(x => x.split('=')[1]));
       const sg = v => v === '0.00' || v[0] === '+' || v[0] === '-';
       return CV.length === 2
         && CV[1].length === 3 && CV[1].every(sg) && CV[1].some(v => v[0] === '-')
         && CV[0].length === 3 && CV[0].every(v => /^[+\-\d]/.test(v));
     })(), TB.cards);
  ok('AC5 v1.4.3 三块合计与 36 个月份格：非 0 必带 +/-，0 仍是 0.00，无一被省略号截断',
     TB.sums.length === 3 && TB.sums.every(v => v === '0.00' || v[0] === '+' || v[0] === '-')
     && TB.sums.some(v => v !== '0.00')
     && TB.cellN === 36 && TB.cellBad === 0 && TB.cellEllipsis === 0,
     {sums:TB.sums, signs:TB.cellSigns, bad:TB.cellBad, ell:TB.cellEllipsis, wide:TB.wide});
  ok('AC6 v1.4.3 六格顶栏没有撬动纵向几何（顶栏仍是 32px 高，面板顶边位置不变）',
     Math.abs(TB.barTop - 0) < 20 && TB.panelTop > TB.barTop, TB);
  await hp.close();

  await wp.close();

  await pq.close();
  await browser.close();
  console.log(`\n========== ${pass} PASS / ${fail} FAIL ==========`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
