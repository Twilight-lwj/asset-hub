#!/usr/bin/env node
/* 资产管理中枢 v1.4.5 · 真实 DOM 行为验证（jsdom，纯 Node，可复跑）
   本机 node 受 ulimit -v 4GB 限制，undici 的 llhttp wasm 无法实例化、Chrome 也起不来，
   puppeteer / CDP 两条路都不可用；jsdom 不需要 wasm，能真实执行页面脚本、派发真实
   DOM 事件，足以验证本版诉求（表单高亮移除 / 流水条缺账户高亮 / 跨设备保留）
   以及 v1.3.2 的四项沿用（金额两端口径 / 缺账户单值 / 物理键盘）。

   用法：NODE_PATH=<node_modules> node dom_test_v138.js
*/
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const PAGE = path.resolve(__dirname, '..', '资产管理中枢_浏览器版.html');
const HTML = fs.readFileSync(PAGE, 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('[PASS] ' + name); }
  else { fail++; console.log('[FAIL] ' + name + (extra === undefined ? '' : '  → ' + JSON.stringify(extra))); }
};

const jsErrors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => jsErrors.push(String(e && e.message ? e.message : e)));

const dom = new JSDOM(HTML, {
  runScripts: 'dangerously',
  url: 'http://localhost/ledger/index.html',
  pretendToBeVisual: true,
  virtualConsole: vc,
});
const w = dom.window;
const d = w.document;
const ev = expr => w.eval(expr);
const $ = id => d.getElementById(id);

/* 页面脚本是同步执行的（renderAll 在末尾），jsdom 里 DOMContentLoaded 后即可用 */
function boot() {
  ok('页面脚本执行无运行时异常', jsErrors.length === 0, jsErrors.slice(0, 2));
  ok('页面版本 1.0.0', d.querySelector('.app').dataset.version === '1.0.0',
     d.querySelector('.app').dataset.version);
  ok('renderAll 跑完（日历日格 >= 28）', d.querySelectorAll('#days .day').length >= 28);
  ev(`
    DB.accounts = [
      {id:'a1', name:'招商银行储蓄卡', kind:'asset',  opening:1000, limit:0},
      {id:'b1', name:'中信信用卡',     kind:'credit', opening:0,    limit:5000}
    ];
    DB.accountTypes = [{id:'asset',name:'资产账户',mode:'asset'},{id:'credit',name:'信贷账户',mode:'credit'}];
    DB.categories = {expense:[],income:[],transfer:[],repay:[],reimburse:[]};
    DB.tags = {expense:[],income:[],transfer:[],repay:[],reimburse:[]};
    DB.tx = [];
    persistDB(); renderAll(); true;
  `);
}

/* 真实键盘：向 document 派发 keydown（与浏览器里焦点在 body 时同一条路径） */
const KEY = (key, extra) => {
  const e = new w.KeyboardEvent('keydown', Object.assign({ key, bubbles: true, cancelable: true }, extra || {}));
  d.dispatchEvent(e);
  return e;
};
const TYPE = s => { for (const ch of s) KEY(ch); };

function section(t) { console.log('\n===== ' + t + ' ====='); }

function main() {
  boot();

  /* ---------------- 1. v1.3.3：表单移除必填高亮，改在流水条高亮 ---------------- */
  section('1. 需求① 表单移除「必填」高亮 / 流水条缺账户高亮');
  ev("openSheet(); setAddType('repay'); true;");
  ok('切到「还款」且两端都空 → 记账表单零高亮格（支出账户不是必填）',
     d.querySelectorAll('.fitem.need').length === 0);
  ok('页面里 .fitem.need /「·必填」/ syncAccountNeed 全部移除',
     !HTML.includes('.fitem.need') && !HTML.includes('·必填')
     && !HTML.includes('syncAccountNeed'));
  ok('警示色改供流水条用（亮 #a00 / 暗 #ff6f6f，仍是唯一彩色）',
     HTML.includes('--warn:#a00') && HTML.includes('--warn:#f85149')
     && HTML.includes('.flow-row.lack{box-shadow:inset 3px 0 0 var(--warn)}'));
  ok('高亮三条 CSS 在位（红条 / 红徽标 / 账户位红字）',
     /\.flow-row\.lack \.badge\{border-color:var\(--warn\);color:var\(--warn\)\}/.test(HTML)
     && HTML.includes('.flow-row.lack .line2 .r{color:var(--warn)}'));
  ok('红条用 inset box-shadow 而非 border（不挤动 grid 列）',
     !/\.flow-row\.lack\{[^}]*border-left/.test(HTML));

  /* 用真实 UI 存一条只填收入账户的还款 */
  ev(`
    closeSheet(); DB.tx = []; renderFlow();
    openSheet(); setAddType('repay');
    $('fFrom').value=''; $('fFrom').dispatchEvent(new Event('change',{bubbles:true}));
    $('fTo').value='中信信用卡'; $('fTo').dispatchEvent(new Event('change',{bubbles:true}));
    setActiveField(numInput('amount')); true;
  `);
  TYPE('500');
  ev("setActiveField(numInput('amount')); true;");
  KEY('Enter');
  const L1 = ev(`(() => {
    const t = DB.tx[DB.tx.length - 1];
    const row = document.querySelector('.flow-row[data-id="' + t.id + '"]');
    return {id:t.id, from:t.from, to:t.to, lack:row.classList.contains('lack'),
            title:row.title, badgeTitle:row.querySelector('.badge').title,
            amt:row.querySelector('.amt').textContent,
            acct:row.querySelector('.line2 .r').textContent,
            spans:row.querySelectorAll('span').length};
  })()`);
  ok('缺账户流水仍可正常保存（只提示、不拦截）',
     L1.from === '' && L1.to === '中信信用卡', L1);
  ok('缺支出账户 → 流水条挂 .lack（表单里已不再高亮）', L1.lack === true, L1);
  ok('流水条 title 写明「该笔未填写完整账户」',
     L1.title === '该笔未填写完整账户，点击修改或删除', L1.title);
  ok('徽标 title 也带「（未填写完整账户）」',
     L1.badgeTitle.indexOf('（未填写完整账户）') >= 0, L1.badgeTitle);
  ok('高亮不改动金额（仍是单值 500.00，v1.3.2 口径沿用）', L1.amt === '500.00', L1.amt);
  ok('高亮不改动账户位文本（只写有的一端）', L1.acct === '中信信用卡', L1.acct);

  const fullProbe = ev(`(() => {
    const t = DB.tx[DB.tx.length - 1];
    const h = document.createElement('div');
    h.innerHTML = rowHTML(Object.assign({}, t, {id:'FULL', from:'招商银行储蓄卡'}));
    const row = h.firstChild;
    return {lack:row.classList.contains('lack'), spans:row.querySelectorAll('span').length,
            title:row.title, amt:row.querySelector('.amt').textContent};
  })()`);
  ok('两端齐全的对照行不挂 .lack', fullProbe.lack === false, fullProbe);
  ok('普通行 title 仍是原串「点击修改或删除」',
     fullProbe.title === '点击修改或删除', fullProbe.title);
  ok('高亮零 DOM 增量（span 数与对照行相同，不碰 v1.3.5 金额前标签）',
     fullProbe.spans === L1.spans, [L1.spans, fullProbe.spans]);

  /* 判定口径：各类 / 各种缺法 */
  const lackMap = ev(`(() => {
    const cases = [
      ['repay缺支出',    {type:'repay', to:'B'}],
      ['repay缺收入',    {type:'repay', from:'A'}],
      ['repay两端空',    {type:'repay'}],
      ['repay两端齐',    {type:'repay', from:'A', to:'B'}],
      ['transfer缺一端', {type:'transfer', from:'A'}],
      ['transfer两端齐', {type:'transfer', from:'A', to:'B'}],
      ['reimburse缺一端',{type:'reimburse', to:'B'}],
      ['reimburse两端齐',{type:'reimburse', from:'A', to:'B'}],
      ['expense',        {type:'expense', from:'A'}],
      ['income',         {type:'income', to:'B'}]
    ];
    const out = {};
    cases.forEach(c => {
      const h = document.createElement('div');
      h.innerHTML = rowHTML(Object.assign({id:'X', date:S.date, time:'10:00', amount:100}, c[1]));
      out[c[0]] = h.firstChild.classList.contains('lack');
    });
    return out;
  })()`);
  ok('还款 / 转账 / 报销 缺任一端都高亮（含两端都空）',
     lackMap['repay缺支出'] && lackMap['repay缺收入'] && lackMap['repay两端空']
     && lackMap['transfer缺一端'] && lackMap['reimburse缺一端'], lackMap);
  ok('两端齐全的三类都不高亮',
     !lackMap['repay两端齐'] && !lackMap['transfer两端齐'] && !lackMap['reimburse两端齐'], lackMap);
  ok('支出 / 收入本来就只有一端，永不亮',
     !lackMap.expense && !lackMap.income, lackMap);
  ok('lackOf 是纯数据判定（函数体不碰 localStorage / DOM / S_ADD）',
     ev("(function(){var s=lackOf.toString(); return !/localStorage|sessionStorage|document|S_ADD|settings/.test(s);})()")
     && ev("lackOf({type:'repay', from:'', to:'B'})") === true);

  /* ---- 切换设备也保留：走真实的 dataForSync() → JSON 往返 → applyDB() ---- */
  ev("window.__bak = JSON.stringify(dataForSync()); true;");
  const bak = ev("window.__bak");
  /* 注意：settings.acctHl 是资产页「长按高亮」的既有落盘字段（v1.2.8 起，用户主动标记），
     与本版无关，不能算进来。这里只查本版可能注入的流水条状态字段。 */
  ok('备份 JSON 里没有流水条高亮状态字段（不是本机标记落盘）',
     !/"\w*(lack|need|highlight)\w*"\s*:/.test(bak)
     && JSON.parse(bak).tx.every(t => !('lack' in t) && !('need' in t)));
  ok('备份 JSON 里缺账户记录原样导出（from 为空、to 有值）',
     JSON.parse(bak).tx.some(t => t.type === 'repay' && !t.from && t.to === '中信信用卡'));
  ev("DB.tx = []; renderFlow(); true;");       /* 模拟另一台设备：本机流水清空 */
  ok('恢复前：本机零流水',
     d.querySelectorAll('.flow-row').length === 0);
  ev("applyDB(JSON.parse(window.__bak)); true;");   /* 与「导入备份 / 云恢复」同一入口 */
  ok('换设备：从备份恢复后缺账户流水条照样高亮',
     d.querySelectorAll('.flow-row.lack').length === 1
     && d.querySelector('.flow-row.lack .amt').textContent === '500.00',
     d.querySelectorAll('.flow-row.lack').length);
  ok('换设备：高亮判定不依赖 localStorage（清掉本机存储键后仍在）',
     ev("(function(){ try{ localStorage.removeItem('amhub_v100_db'); }catch(e){} renderFlow(); return document.querySelectorAll('.flow-row.lack').length; })()") === 1);
  ok('补齐支出账户 → 高亮立即消失（数据变，提示跟着变）',
     ev("(function(){var t=DB.tx.find(x=>x.type==='repay'); t.from='招商银行储蓄卡'; renderFlow(); return document.querySelectorAll('.flow-row.lack').length;})()") === 0);

  /* 不污染后面几节（第 2 节 Enter 保存后期望恰好 1 条流水） */
  ev("DB.tx = []; persistDB(); renderFlow(); closeSheet(); true;");

  /* ---------------- 2. 需求④：物理键盘输入 ---------------- */
  section('2. 需求④ 物理键盘输入（Linux / 桌面）');
  ev("closeSheet(); openSheet(); setAddType('expense'); setActiveField(numInput('amount')); true;");
  TYPE('123');
  ok('敲 1 2 3 → 活动金额框 = 123', ev("numInput('amount').value") === '123',
     ev("numInput('amount').value"));
  KEY('Backspace');
  ok('退格删一位 → 12', ev("numInput('amount').value") === '12', ev("numInput('amount').value"));
  TYPE('.5'); KEY('+'); TYPE('7');
  ok('小数点与 + 可用（12.5+7，表达式行同步 19.5）',
     ev("numInput('amount').value") === '12.5+7'
     && ev("$('exprLine').textContent").indexOf('19.5') >= 0, ev("$('exprLine').textContent"));
  KEY('*'); TYPE('2');
  ok('* 映射成 ×（12.5+7×2 = 26.5，先乘后加）',
     ev("numInput('amount').value") === '12.5+7×2'
     && ev("$('exprLine').textContent").indexOf('26.5') >= 0, ev("$('exprLine').textContent"));
  KEY('/'); TYPE('5');
  ok('/ 映射成 ÷（12.5 + 7×2÷5 = 12.5 + 2.8 = 15.3）',
     ev("numInput('amount').value") === '12.5+7×2÷5'
     && ev("$('exprLine').textContent").indexOf('15.3') >= 0, ev("$('exprLine').textContent"));

  /* 备注框 / 日期框 / 非金额输入不劫持 */
  const before = ev("numInput('amount').value");
  $('fNote').dispatchEvent(new w.KeyboardEvent('keydown', { key: '9', bubbles: true }));
  $('fNote').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
  ok('备注框里的数字 / 退格不写进金额框', ev("numInput('amount').value") === before,
     [before, ev("numInput('amount').value")]);
  $('fDate').dispatchEvent(new w.KeyboardEvent('keydown', { key: '7', bubbles: true }));
  ok('日期框里的数字不写进金额框', ev("numInput('amount').value") === before);

  ev("setActiveField(numInput('cashback')); true;");
  TYPE('3');
  ok('活动字段切到「返现」后键盘写进返现', ev("numInput('cashback').value") === '3',
     ev("numInput('cashback').value"));
  ev("numInput('cashback').focus(); true;");
  ok('聚焦哪一格＝活动字段（键盘 Tab / 点击都对齐）', ev("S_ADD.field") === 'cashback',
     ev("S_ADD.field"));
  ev("numInput('amount').focus(); true;");
  ok('聚焦回金额框，活动字段跟着回来', ev("S_ADD.field") === 'amount', ev("S_ADD.field"));

  /* Enter 保存 */
  ev("closeSheet(); openSheet(); setAddType('expense'); numInput('amount').value='8'; numInput('cashback').value=''; setActiveField(numInput('amount')); true;");
  KEY('Enter');
  ok('Enter 直接保存（弹层关闭、流水 +1）',
     ev("S_ADD.open") === false && ev("document.querySelectorAll('.flow-row').length") === 1,
     [ev("S_ADD.open"), ev("document.querySelectorAll('.flow-row').length")]);
  ok('Ctrl / Alt / Cmd 组合键不拦截（留给浏览器）',
     ev("(function(){var n=DB.tx.length; var e=new KeyboardEvent('keydown',{key:'5',ctrlKey:true,bubbles:true}); document.dispatchEvent(e); return DB.tx.length===n;})()"));

  /* ---------------- 3. 需求⑤：还款 40 / 优惠 10 → 30→40 ---------------- */
  section('3. 需求⑤ 还款 40 / 优惠 10 显示 30→40');
  ev(`
    DB.tx = []; renderFlow();
    openSheet(); setAddType('repay');
    $('fFrom').value='招商银行储蓄卡'; $('fFrom').dispatchEvent(new Event('change',{bubbles:true}));
    $('fTo').value='中信信用卡';      $('fTo').dispatchEvent(new Event('change',{bubbles:true}));
    setActiveField(numInput('amount')); true;
  `);
  TYPE('40');
  ev("setActiveField(numInput('discount')); true;");
  TYPE('10');
  ev("setActiveField(numInput('amount')); true;");
  KEY('Enter');
  const r5 = ev(`(() => {
    const t = DB.tx[DB.tx.length - 1];
    const row = document.querySelector('.flow-row[data-id="' + t.id + '"]');
    return {type:t.type, amount:t.amount, discount:t.discount, from:t.from, to:t.to,
            amt: row.querySelector('.amt').textContent,
            line1: row.querySelector('.line1 .l').textContent,
            acct: row.querySelector('.line2 .r').textContent};
  })()`);
  ok('还款流水条金额 = 30→40（不是 40→50）', r5.amt === '30→40', r5.amt);
  ok('保存的原始字段零改动（amount 40 / discount 10）',
     r5.amount === 40 && r5.discount === 10, r5);
  ok('第一行调整项仍是「优惠+10」', r5.line1.indexOf('优惠+10') >= 0, r5.line1);
  ok('第二行账户仍是「招商银行储蓄卡→中信信用卡」',
     r5.acct === '招商银行储蓄卡→中信信用卡', r5.acct);

  /* ---------------- 4. 需求②：缺一端账户只给单值 ---------------- */
  section('4. 需求② 缺账户不再显示「0→500」');
  ev(`
    openSheet(); setAddType('repay');
    $('fFrom').value=''; $('fFrom').dispatchEvent(new Event('change',{bubbles:true}));
    $('fTo').value='中信信用卡'; $('fTo').dispatchEvent(new Event('change',{bubbles:true}));
    setActiveField(numInput('amount')); true;
  `);
  TYPE('500');
  ev("setActiveField(numInput('amount')); true;");
  KEY('Enter');
  const r2a = ev(`(() => {
    const t = DB.tx[DB.tx.length - 1];
    const row = document.querySelector('.flow-row[data-id="' + t.id + '"]');
    return {from:t.from, to:t.to, amt:row.querySelector('.amt').textContent,
            acct:row.querySelector('.line2 .r').textContent};
  })()`);
  ok('缺支出账户：金额单值 500.00，无箭头（不再 0→500）',
     r2a.amt === '500.00' && r2a.amt.indexOf('→') < 0, r2a.amt);
  ok('缺支出账户：账户位只写收入账户，不写「→中信信用卡」',
     r2a.acct === '中信信用卡', r2a.acct);

  ev(`
    openSheet(); setAddType('transfer');
    $('fFrom').value='招商银行储蓄卡'; $('fFrom').dispatchEvent(new Event('change',{bubbles:true}));
    $('fTo').value=''; $('fTo').dispatchEvent(new Event('change',{bubbles:true}));
    setActiveField(numInput('amount')); true;
  `);
  TYPE('300');
  ev("setActiveField(numInput('amount')); true;");
  KEY('Enter');
  const r2b = ev(`(() => {
    const t = DB.tx[DB.tx.length - 1];
    const row = document.querySelector('.flow-row[data-id="' + t.id + '"]');
    return {amt:row.querySelector('.amt').textContent, acct:row.querySelector('.line2 .r').textContent};
  })()`);
  ok('缺收入账户：转账金额单值 300.00（不显示 300→0）',
     r2b.amt === '300.00' && r2b.amt.indexOf('→') < 0, r2b);
  ok('缺收入账户：账户位只写支出账户', r2b.acct === '招商银行储蓄卡', r2b.acct);

  ev(`
    openSheet(); setAddType('reimburse');
    $('fFrom').value='招商银行储蓄卡'; $('fFrom').dispatchEvent(new Event('change',{bubbles:true}));
    $('fTo').value=''; $('fTo').dispatchEvent(new Event('change',{bubbles:true}));
    setActiveField(numInput('amount')); true;
  `);
  TYPE('200');
  ev("setActiveField(numInput('reimbursed')); true;");
  TYPE('180');
  ev("setActiveField(numInput('amount')); true;");
  KEY('Enter');
  const r2c = ev(`(() => {
    const t = DB.tx[DB.tx.length - 1];
    const row = document.querySelector('.flow-row[data-id="' + t.id + '"]');
    return {amt:row.querySelector('.amt').textContent};
  })()`);
  ok('缺收入账户：报销金额单值 200.00（不显示 200→180）',
     r2c.amt === '200.00', r2c.amt);

  /* 两端齐全的报销仍显示区间 */
  ev(`
    openSheet(); setAddType('reimburse');
    $('fFrom').value='招商银行储蓄卡'; $('fFrom').dispatchEvent(new Event('change',{bubbles:true}));
    $('fTo').value='中信信用卡';      $('fTo').dispatchEvent(new Event('change',{bubbles:true}));
    setActiveField(numInput('amount')); true;
  `);
  TYPE('200');
  ev("setActiveField(numInput('reimbursed')); setActiveField(numInput('reimbursed')); true;");
  TYPE('180');
  ev("setActiveField(numInput('amount')); true;");
  KEY('Enter');
  const r2d = ev(`(() => {
    const t = DB.tx[DB.tx.length - 1];
    return document.querySelector('.flow-row[data-id="' + t.id + '"]').querySelector('.amt').textContent;
  })()`);
  ok('两端齐全的报销仍显示「垫付→回款」200→180', r2d === '200→180', r2d);

  /* ---------------- 5. 口径一致性：显示变了，余额 / 汇总不许变 ---------------- */
  section('5. 口径一致性（余额 / 汇总 / 结余）');
  ev(`
    DB.tx = [
      {id:'t1', type:'repay', date:S.date, time:'10:00', amount:40, discount:10,
       from:'招商银行储蓄卡', to:'中信信用卡', fromId:'a1', toId:'b1', recv:null}
    ];
    persistDB(); renderAll(); true;
  `);
  const bal = ev(`(() => {
    const a = DB.accounts.find(x => x.id === 'a1');
    const b = DB.accounts.find(x => x.id === 'b1');
    const day = summaryOf(DB.tx);
    return {a:balanceOf(a), b:balanceOf(b), bal:day.bal, inc:day.inc, exp:day.exp};
  })()`);
  ok('支出账户 1000 − 30 = 970（还款按实际被扣 30 扣）', bal.a === 970, bal);
  ok('收入账户 0 + 40 = 40（到账 40，优惠不重复加）', bal.b === 40, bal);
  ok('当日结余 = +10（到账 40 − 被扣 30，等于优惠额）', bal.bal === 10, bal);
  ok('流水条金额与余额同源（30→40 ⇄ 970 / 40）',
     ev(`document.querySelector('.flow-row .amt').textContent`) === '30→40', bal);

  /* ---------------- 6. 编辑既有流水：回填 + 流水条高亮联动 ---------------- */
  section('6. 编辑既有流水（高亮跟着记录数据走）');
  ev("openEdit('t1'); true;");
  const ed = ev(`({amount:numInput('amount').value, discount:numInput('discount').value,
     from:$('fFrom').value, to:$('fTo').value, formNeed:document.querySelectorAll('.fitem.need').length,
     rowLack:document.querySelector('.flow-row[data-id="t1"]').classList.contains('lack'),
     title:$('sheetTitle').textContent})`);
  ok('编辑回填：40 / 10 / 两端账户原样', ed.amount === '40' && ed.discount === '10'
     && ed.from === '招商银行储蓄卡' && ed.to === '中信信用卡', ed);
  ok('两端齐全的老流水：表单零高亮、流水条也不亮',
     ed.formNeed === 0 && ed.rowLack === false, ed);
  ev("$('fTo').value=''; $('fTo').dispatchEvent(new Event('change',{bubbles:true})); true;");
  ok('编辑中清空收入账户 → 表单仍不高亮（支出账户不是必填）',
     ev("document.querySelectorAll('.fitem.need').length") === 0);
  KEY('Enter');
  const ed2 = ev(`(() => {
    const t = DB.tx.find(x => x.id === 't1');
    const row = document.querySelector('.flow-row[data-id="t1"]');
    return {to:t.to, amt:row.querySelector('.amt').textContent,
            lack:row.classList.contains('lack'), title:row.title};
  })()`);
  ok('保存后只剩支出账户 → 流水条单值 30.00（不是 30→0）',
     ed2.to === '' && ed2.amt === '30.00' && ed2.amt.indexOf('→') < 0, ed2);
  ok('保存后这条流水条挂上 .lack（事后提醒，不在录入时催）',
     ed2.lack === true && ed2.title.indexOf('未填写完整账户') >= 0, ed2);

  /* ---------------- 7. 安卓侧联动零回归 ---------------- */
  section('7. 类型联动 / 保存校验零回归');
  ev("openSheet(); setAddType('transfer'); true;");
  ok('转账：分类与标签都隐藏（第八版联动不变）',
     ev("$('fCatItem').hidden && $('fTagItem').hidden"));
  ok('转账：两端账户都可选', ev("!$('fFrom').disabled && !$('fTo').disabled"));
  ev("setAddType('expense'); true;");
  ok('支出：收入账户禁用且清空', ev("$('fTo').disabled && $('fTo').value === ''"));
  ev("setAddType('income'); true;");
  ok('收入：支出账户禁用且清空', ev("$('fFrom').disabled && $('fFrom').value === ''"));
  ev("setAddType('expense'); numInput('amount').value=''; true;");
  const n0 = ev("DB.tx.length");
  ev("$('btnSave').click(); true;");
  ok('金额为空时保存被拦截（沿用既有校验）', ev("DB.tx.length") === n0, [n0, ev("DB.tx.length")]);
  ev("closeSheet(); true;");


  /* ---------------- 8. v1.3.4：支出 / 收入「不计入」 ---------------- */
  section('8. 需求③ 不计入（仅支出/收入 / 只剔 KPI / 跨设备保留）');
  ev(`
    closeSheet();
    DB.accounts = [
      {id:'a1', name:'招商银行储蓄卡', kind:'asset', opening:1000, limit:0},
      {id:'a2', name:'微信',           kind:'asset', opening:0,    limit:0}
    ];
    DB.tx = []; persistDB(); renderAll();
    openSheet(); setAddType('expense'); true;
  `);
  ok('支出：勾选框可见、备注行切成两栏、默认未勾选',
     ev("!$('fNoCountItem').hidden && !$('noteLine').classList.contains('no-nc') && !$('fNoCount').checked")
     && d.querySelectorAll('#noteLine > .fitem').length === 2);
  ok('备注 label / input 原样保留（只追加一格，不改原结构）',
     ev("!!document.querySelector('#noteLine > label.fitem > input#fNote')"));

  ev("setAddType('income'); true;");
  ok('收入：勾选框同样可见', ev("!$('fNoCountItem').hidden"));
  ev("setAddType('transfer'); true;");
  ok('转账：勾选框隐藏且备注行回单列',
     ev("$('fNoCountItem').hidden && $('noteLine').classList.contains('no-nc')"));
  ev("setAddType('repay'); true;");
  ok('还款：勾选框仍隐藏', ev("$('fNoCountItem').hidden"));
  ev("setAddType('reimburse'); true;");
  ok('报销：勾选框仍隐藏', ev("$('fNoCountItem').hidden"));

  ev("setAddType('expense'); $('fNoCount').checked = true; $('fNoCount').dispatchEvent(new Event('change',{bubbles:true})); true;");
  ok('勾选后外框挂 .on（纯视觉，数据源仍是 checkbox）',
     ev("$('fNoCountBox').classList.contains('on')"));
  ev("setAddType('transfer'); true;");
  ok('切到转账：隐藏的勾选状态被清零',
     ev("!$('fNoCount').checked && !$('fNoCountBox').classList.contains('on')"));
  ev("setAddType('expense'); true;");
  ok('切回支出：仍是未勾选（状态不串）', ev("!$('fNoCount').checked"));

  /* 焦点在勾选框上时按 Enter，不应被物理键盘抢去保存 */
  const nBefore = ev("DB.tx.length");
  $('fNoCount').dispatchEvent(new w.KeyboardEvent('keydown', {key:'Enter', bubbles:true, cancelable:true}));
  ok('焦点在勾选框上按 Enter 不触发保存', ev("DB.tx.length") === nBefore);

  /* 用真实 UI 存一笔「不计入」的支出 500（证券转账场景） */
  ev(`
    closeSheet(); DB.tx = []; renderFlow();
    openSheet(); setAddType('expense');
    $('fFrom').value = '微信'; $('fFrom').dispatchEvent(new Event('change',{bubbles:true}));
    $('fNote').value = '证券转账';
    $('fNoCount').checked = true; $('fNoCount').dispatchEvent(new Event('change',{bubbles:true}));
    setActiveField(numInput('amount')); true;
  `);
  TYPE('500');
  ev("setActiveField(numInput('amount')); true;");
  KEY('Enter');
  const C1 = ev(`(() => {
    const t = DB.tx[DB.tx.length - 1];
    const row = document.querySelector('.flow-row[data-id="' + t.id + '"]');
    return {noCount:t.noCount, note:t.note, amount:t.amount,
            nc:row.querySelector('.piece.nc') ? row.querySelector('.piece.nc').textContent : null,
            amt:row.querySelector('.amt').textContent,
            kpi:$('dayKpi').textContent,
            bal:balanceOf(DB.accounts[1])};
  })()`);
  ok('保存后记录写入 noCount:true', C1.noCount === true, C1);
  ok('流水条第二行显示「不计入」', C1.nc === '不计入', C1);
  ok('流水条金额仍是 -500.00（标记不改金额显示）', C1.amt === '-500.00', C1);
  ok('日 KPI 支出 = 0（该笔被剔除）', C1.kpi.indexOf('支出0') >= 0, C1.kpi);
  ok('账户余额仍扣 500（余额按真实资金增减）', C1.bal === -500, C1.bal);

  /* 再存一笔未标记的支出 200，KPI 应只算这一笔 */
  ev(`
    openSheet(); setAddType('expense');
    $('fFrom').value = '微信'; $('fFrom').dispatchEvent(new Event('change',{bubbles:true}));
    setActiveField(numInput('amount')); true;
  `);
  TYPE('200'); KEY('Enter');
  const C2 = ev(`({kpi:$('dayKpi').textContent, bal:balanceOf(DB.accounts[1]),
                  nc:document.querySelectorAll('.piece.nc').length})`);
  ok('两笔里只有未标记那笔进 KPI（支出 200 / 结余 -200）',
     C2.kpi.indexOf('支出-200') >= 0 && C2.kpi.indexOf('结余-200') >= 0, C2.kpi);
  ok('余额累计 -700（两笔都进余额）', C2.bal === -700, C2.bal);
  ok('页面里只有一枚「不计入」小标', C2.nc === 1, C2.nc);

  /* 编辑回填 + 取消标记 */
  const editId = ev("DB.tx[0].id");
  ev("openEdit('" + editId + "'); true;");
  ok('编辑回填：勾选框为选中、备注为「证券转账」',
     ev("$('fNoCount').checked && $('fNoCountBox').classList.contains('on') && $('fNote').value === '证券转账'"));
  ev("$('fNoCount').checked = false; $('fNoCount').dispatchEvent(new Event('change',{bubbles:true})); $('btnSave').click(); true;");
  const C3 = ev(`({kpi:$('dayKpi').textContent, nc:document.querySelectorAll('.piece.nc').length,
                  flag:DB.tx[0].noCount})`);
  ok('取消标记并保存后：记录 noCount:false、小标消失', C3.flag === false && C3.nc === 0, C3);
  ok('取消标记后 KPI 把 500 算回来（支出 700 / 结余 -700）',
     C3.kpi.indexOf('支出-700') >= 0 && C3.kpi.indexOf('结余-700') >= 0, C3.kpi);

  /* 收入侧同样可标记（工资场景） */
  ev(`
    openSheet(); setAddType('income');
    $('fTo').value = '招商银行储蓄卡'; $('fTo').dispatchEvent(new Event('change',{bubbles:true}));
    $('fNote').value = '工资';
    $('fNoCount').checked = true; $('fNoCount').dispatchEvent(new Event('change',{bubbles:true}));
    setActiveField(numInput('amount')); true;
  `);
  TYPE('8000'); KEY('Enter');
  const C4 = ev(`(() => {
    const t = DB.tx[DB.tx.length - 1];
    return {type:t.type, flag:t.noCount,
            nc:document.querySelector('.flow-row[data-id="' + t.id + '"] .piece.nc').textContent,
            kpi:$('dayKpi').textContent, bal:balanceOf(DB.accounts[0])};
  })()`);
  ok('收入「工资」可标记且显示「不计入」', C4.type === 'income' && C4.flag === true && C4.nc === '不计入', C4);
  ok('工资 8000 不进当日收入 KPI', C4.kpi.indexOf('收入+0') >= 0, C4.kpi);
  ok('工资 8000 仍进银行卡余额（1000 → 9000）', C4.bal === 9000, C4.bal);

  /* 跨设备：导出 → 恢复，标记与流水条小标都保留 */
  const exported = JSON.parse(JSON.stringify(ev("dataForSync()")));
  ok('导出备份里保留 noCount（且带本版 __ver）',
     exported.tx.some(t => t.noCount === true) && exported.__ver === 'v1.0.0');
  ev("applyDB(" + JSON.stringify(exported) + "); true;");
  const C5 = ev(`({flags:DB.tx.filter(t => t.noCount === true).length,
                  nc:document.querySelectorAll('.piece.nc').length,
                  kpi:$('dayKpi').textContent})`);
  ok('云恢复（换设备）后标记仍在、流水条仍显示「不计入」', C5.flags === 1 && C5.nc === 1, C5);
  ok('恢复后 KPI 仍剔除该笔（收入+0）', C5.kpi.indexOf('收入+0') >= 0, C5.kpi);

  /* 旧备份（无 noCount 字段）零迁移：恒计入、无小标 */
  /* S / DB 都活在 jsdom realm 里，Node 侧要经 ev() 取值，不能直接引用 */
  const legacy = {version:'1.2.0',
                  tx:[{id:'old1', type:'income', date:ev("S.date"), time:'08:00',
                       amount:300, to:'招商银行储蓄卡'}],
                  accounts:JSON.parse(JSON.stringify(ev("DB.accounts"))),
                  categories:{}, tags:{}, settings:{}, meta:{}};
  ev("applyDB(" + JSON.stringify(legacy) + "); true;");
  const C6 = ev(`({kpi:$('dayKpi').textContent, nc:document.querySelectorAll('.piece.nc').length,
                  raw:('noCount' in DB.tx[0])})`);
  ok('旧备份无 noCount：恒计入且 normalizeDB 不擅自补字段',
     C6.nc === 0 && C6.raw === false && C6.kpi.indexOf('收入+300') >= 0, C6);

  /* 再记：清空勾选，不串到下一笔 */
  ev(`
    openSheet(); setAddType('expense');
    $('fNoCount').checked = true; $('fNoCount').dispatchEvent(new Event('change',{bubbles:true}));
    setActiveField(numInput('amount')); true;
  `);
  TYPE('10');
  ev("$('btnAgain').click(); true;");
  ok('再记后勾选框已清空（与金额 / 备注同批清空）',
     ev("!$('fNoCount').checked && !$('fNoCountBox').classList.contains('on') && numInput('amount').value === ''"));
  ev("closeSheet(); true;");

  /* ---------------- 9. v1.3.5：标签移到金额前 / 自适应金额长度 ---------------- */
  section('9. v1.3.5 标签移到金额前（保留 → / 标签彻底移走 / 随金额浮动）');
  const G = ev(`(() => {
    DB.tx = [
      {id:'g1',type:'repay',date:S.date,time:'10:00',from:'银行卡',to:'证券',tag:'吉吉',amount:11000,discount:1000},
      {id:'g2',type:'repay',date:S.date,time:'10:01',from:'银行卡',to:'证券',tag:'吉吉',amount:110,discount:10},
      {id:'g3',type:'expense',date:S.date,time:'10:02',from:'微信',amount:88.5}
    ];
    renderFlow();
    const row = id => document.querySelector('.flow-row[data-id="'+id+'"]');
    const r1 = id => row(id).querySelector('.line1 .r');
    const r2 = id => row(id).querySelector('.line2 .r');
    return {
      longR1: r1('g1').innerHTML, shortR1: r1('g2').innerHTML,
      longAmt: r1('g1').querySelector('.amt').textContent,
      shortAmt: r1('g2').querySelector('.amt').textContent,
      longTag: r1('g1').querySelector('.tag') ? r1('g1').querySelector('.tag').textContent : null,
      shortTag: r1('g2').querySelector('.tag') ? r1('g2').querySelector('.tag').textContent : null,
      longHasTag: r1('g1').classList.contains('has-tag'),
      r2Long: r2('g1').innerHTML, r2Short: r2('g2').innerHTML,
      r2LongHasTag: r2('g1').classList.contains('has-tag'),
      plainR1: r1('g3').innerHTML, plainHasTag: r1('g3').classList.contains('has-tag'),
      sepInLong: !!r1('g1').querySelector('.sep')
    };
  })()`);
  ok('v1.3.5 长金额流水：标签在金额前、区间保留 →',
     G.longHasTag && G.longTag === '吉吉' && G.longAmt === '10000→11000' && G.sepInLong, G);
  ok('v1.3.5 短金额流水：同一标签、金额自适应变短',
     G.shortTag === '吉吉' && G.shortAmt === '100→110', G);
  ok('v1.3.5 第二行仅纯账户串、不再挂 has-tag / 标签',
     G.r2Long === '银行卡→证券' && G.r2Long === G.r2Short && !G.r2LongHasTag
     && G.r2Long.indexOf('tag') < 0, G);
  ok('v1.3.5 无标签行仍是 v1.3.0 金额原串、不挂 has-tag',
     !G.plainHasTag && G.plainR1.indexOf('<span class="amt">-88.50</span>') >= 0, G);

  /* ---------------- 10. v1.3.6：行内齐平 + 全流水条字号颜色统一 ---------------- */
  section('10. v1.3.6 标签|金额中线对齐 / 全流水条 --fs-c·--ink 统一 / --warn 保留');
  const H = ev(`(() => {
    DB.tx = [
      {id:'h1',type:'repay',date:S.date,time:'10:00',from:'银行卡',to:'证券',tag:'吉吉',amount:11000,discount:1000},
      {id:'h2',type:'income',date:S.date,time:'09:00',to:'银行卡',tag:'工资',amount:8000,noCount:true},
      {id:'h3',type:'repay',date:S.date,time:'10:02',to:'证券',amount:500,tag:'房贷'},
      {id:'h4',type:'expense',date:S.date,time:'10:03',from:'微信',amount:88.5}
    ];
    renderFlow();
    const row = id => document.querySelector('.flow-row[data-id="'+id+'"]');
    const r1 = id => row(id).querySelector('.line1 .r');
    return {
      h1R1: r1('h1').innerHTML,
      h1Flex: getComputedStyle(r1('h1')).display,
      h1Align: getComputedStyle(r1('h1')).alignItems,
      h2Nc: !!row('h2').querySelector('.piece.nc'),
      h2NcText: row('h2').querySelector('.piece.nc') ? row('h2').querySelector('.piece.nc').textContent : null,
      h2Tag: r1('h2').querySelector('.tag') ? r1('h2').querySelector('.tag').textContent : null,
      h3Lack: row('h3').classList.contains('lack'),
      h3HasTag: r1('h3').classList.contains('has-tag'),
      h4Plain: r1('h4').innerHTML, h4HasTag: r1('h4').classList.contains('has-tag')
    };
  })()`);
  /* CSS 文本从源文件读，不取运行时 style.textContent —— 主题切换会改写后者的字节，
     导致同一条规则在「源文件里在、运行时 style 里不在」的假失败（v1.3.6 实测踩中）。 */
  const css = HTML.slice(0, HTML.indexOf('</style>'));
  const cssFlex = /\.line1 \.r\.has-tag\{display:inline-flex;align-items:center;justify-content:flex-end\}/.test(css);
  const cssNoBaseline = !/\.line1 \.r\.has-tag \.tag\{[^}]*vertical-align:baseline/.test(css);
  const cssSepInherit = /\.line1 \.r\.has-tag \.sep\{color:inherit\}/.test(css);
  const cssNcInherit = /\.line \.l \.piece\.nc\{color:inherit;font-size:inherit;white-space:nowrap\}/.test(css);
  const cssLFont = /\.line \.l\{[^}]*font-size:var\(--fs-c\)/.test(css);
  const cssRFont = /\.line \.r\{[^}]*font-size:var\(--fs-c\)/.test(css);
  const cssWarn = /\.flow-row\.lack \.line2 \.r\{color:var\(--warn\)\}/.test(css);
  ok('v1.3.6 带标签行右列计算样式为 inline-flex + align-items:center（三者中线齐平）',
     H.h1Flex === 'inline-flex' && H.h1Align === 'center' && cssFlex, H);
  ok('v1.3.6 旧 overflow baseline 规则已拆（标签不再下沉）', cssNoBaseline, H);
  ok('v1.3.6 标签 | 改正文色 inherit（与优惠|同色），不再 --muted 灰', cssSepInherit, H);
  ok('v1.3.6 不计入小字升正文大小正文色，DOM 仍在', H.h2Nc && H.h2NcText === '不计入' && cssNcInherit, H);
  ok('v1.3.6 全流水条左右列字号统一 --fs-c', cssLFont && cssRFont, H);
  ok('v1.3.6 缺账户 --warn 警示色保留（功能色不参与统一）', H.h3Lack && H.h3HasTag && cssWarn, H);
  ok('v1.3.6 无标签行 DOM 逐字节不变、不挂 has-tag / sep',
     !H.h4HasTag && H.h4Plain.indexOf('<span class="amt">-88.50</span>') >= 0
     && H.h4Plain.indexOf('class="sep"') < 0, H);

  /* ---------------- 11. v1.3.7：总览开屏页 + dock 四项等宽 ---------------- */
  section('11. v1.3.7 总览开屏页 / dock 四项等宽等序 / 取数复用既有口径');

  /* 11.1 dock：四项、顺序、等宽前提（jsdom 不算布局，等宽用计算 flex 值 + CSS 文本双证） */
  const D = ev(`(() => {
    const btns = [...document.querySelectorAll('.bottombar>button')];
    const g = b => { const c = getComputedStyle(b); return c.flexGrow + ' ' + c.flexShrink + ' ' + c.flexBasis; };
    return {
      n: btns.length,
      ids: btns.map(b => b.id),
      texts: btns.map(b => b.textContent),
      flex: btns.map(g),
      plusHasTab: document.getElementById('btnAdd').classList.contains('tab'),
      activeTabs: [...document.querySelectorAll('.bottombar>button.tab.active')].map(b => b.id)
    };
  })()`);
  ok('11.1 dock 恰好四项（总览 / 账单 / 资产 / 记账）',
     D.n === 4 && D.ids.join(',') === 'tabOv,tabBill,tabAsset,btnAdd' && D.texts.join('/') === '总览/账单/资产/记账', D);
  ok('11.2 四块矩形框等宽：四个按钮的计算 flex 完全一致（1 1 0）',
     D.flex.every(x => x === D.flex[0]) && D.flex[0] === '1 1 0px', D.flex);
  ok('11.3 旧的 92px / 66px 固定宽零残留',
     css.indexOf('.tab{width:92px}') < 0 && css.indexOf('width:66px') < 0);
  ok('11.4 v1.0.0 相邻按钮拆独立边框（gap:6px，不再负边距折叠）',
     css.indexOf('margin-left:0}') >= 0
     && css.indexOf('justify-content:center;gap:6px') >= 0
     && css.indexOf('margin-left:calc(var(--bd) * -1)') < 0);
  ok('11.5 平板左侧竖排断点里撤销 flex-basis 0 与负左边距（否则按钮被压扁 / 错位）',
     css.indexOf('.bottombar>button{flex:0 0 auto;margin-left:0}') >= 0);
  ok('11.6「记账」不是页签（不参与 active 切换、点击弹记账页）',
     D.plusHasTab === false && D.activeTabs.length === 1, D);

  /* 11.7 开屏页即总览：默认值写在状态初始化处，且首屏 renderFlow 走总览分支 */
  ok('11.7 开屏页是总览（S.tab 默认 overview、S 里无子页状态位、renderFlow 单层直出）',
     HTML.indexOf("tab:'overview'") >= 0 && HTML.indexOf('ovPage') < 0
     && HTML.indexOf("$('flow').innerHTML = renderOverview();") >= 0);

  /* 11.8 总览取数：本月卡三格 = summaryOf(statsRows(本月))，「不计入」照旧剔除 */
  const O = ev(`(() => {
    closeSheet();
    DB.accounts = [
      {id:'a1', name:'招商银行储蓄卡', kind:'asset', opening:1000, limit:0},
      {id:'b1', name:'中信信用卡', kind:'credit', opening:0, limit:5000}
    ];
    DB.tx = [
      {id:'o1',type:'expense',date:S.month+'-03',time:'10:00',from:'招商银行储蓄卡',category:'餐饮',amount:120},
      {id:'o2',type:'expense',date:S.month+'-05',time:'11:00',from:'招商银行储蓄卡',category:'餐饮',amount:80},
      {id:'o3',type:'expense',date:S.month+'-06',time:'12:00',from:'招商银行储蓄卡',category:'购物',amount:300},
      {id:'o4',type:'expense',date:S.month+'-07',time:'13:00',from:'招商银行储蓄卡',category:'交通',amount:40,noCount:true},
      {id:'o5',type:'income', date:S.month+'-08',time:'09:00',to:'招商银行储蓄卡',category:'工资',amount:9000},
      {id:'o6',type:'expense',date:'2020-01-01',time:'10:00',from:'招商银行储蓄卡',category:'餐饮',amount:5}
    ];
    S.tab = 'overview'; persistDB(); renderAll();
    const flow = document.getElementById('flow');
    return {
      cards: [...flow.querySelectorAll('.card')].map(c => c.querySelector('.lab').textContent + '=' + c.querySelector('.val').textContent),
      cells: [...flow.querySelectorAll('.ov-cell')].map(c => c.querySelector('.ov-mo').textContent + '=' + c.querySelector('.ov-val').textContent),
      yearCls: flow.querySelector('.ov-cell.ov-year') ? flow.querySelector('.ov-cell.ov-year').className : '',
      blocks: flow.querySelectorAll('.ov-block').length,
      /* v1.4.0：三块逐块抓（第一行四段 / 12 格 / 定位标记 / 「本年」格应已不存在） */
      ovBlocks: [...flow.querySelectorAll('.ov-heat')].map(b => ({
        kind: b.getAttribute('data-ov-kind'),
        title: b.querySelector('.ov-heat-title').textContent,
        year: b.querySelector('.ov-heat-year').textContent,
        sep: b.querySelector('.ov-sep') ? b.querySelector('.ov-sep').textContent : '',
        sum: b.querySelector('.ov-heat-sum').textContent,
        headKids: b.querySelector('.ov-heat-head').children.length,
        cells: [...b.querySelectorAll('.ov-cell')].map(c => c.querySelector('.ov-mo').textContent + '=' + c.querySelector('.ov-val').textContent),
        yearCell: (() => { const y = b.querySelector('.ov-cell.ov-year'); return y ? y.querySelector('.ov-val').textContent : null; })()
      })),
      rows: flow.querySelectorAll('.flow-row').length,
      text: flow.textContent,
      calHidden: document.getElementById('cal').hidden,
      dateHidden: document.getElementById('dateBar').hidden,
      assetHidden: document.getElementById('assetSummary').hidden,
      ovActive: document.getElementById('tabOv').classList.contains('active'),
      total: assetSummary().total
    };
  })()`);
  ok('11.8 总览恰好六张卡：资产三张 + 本月三张（入口卡已删）',
     O.cards.length === 6 && O.cards[0] === '总资产=9455.00' && O.cards[1] === '资产账户=9455.00'
     && O.cards[2] === '信贷账户=0.00', O.cards);
  ok('11.9 本月三格走 statsRows：「不计入」的 40 元支出不进总览，且三格都带正负号（-500 / +9000 / +8500）',
     O.cards[3] === '本月支出=-500.00' && O.cards[4] === '本月收入=+9000.00' && O.cards[5] === '本月结余=+8500.00', O.cards);
  /* 余额口径：1000 + 9000 − 120 − 80 − 300 − 40（交通虽标记不计入，余额照扣）− 5 = 9455。 */
  ok('11.10 总资产仍是真实余额（1000+9000−500−40−5 = 9455，「不计入」只剔 KPI 不动余额）',
     O.total === 9455, O.total);
  ok('11.11 三块第一行标题 = 本年结余 / 本年收入 / 本年支出，合计 = +8500.00 / +9000.00 / -500.00',
     O.ovBlocks.length === 3
     && O.ovBlocks.map(b => b.title).join('|') === '本年结余|本年收入|本年支出'
     && O.ovBlocks.map(b => b.sum).join('|') === '+8500.00|+9000.00|-500.00', O.ovBlocks.map(b => b.title + ':' + b.sum));
  ok('11.12 三块各 12 格（1~12，无「本年」格），合计 36 格，顺序 bal → inc → exp',
     O.ovBlocks.every(b => b.cells.length === 12)
     && O.ovBlocks.map(b => b.kind).join('|') === 'bal|inc|exp'
     && O.cells.length === 36
     && O.ovBlocks.every(b => b.yearCell === null) && O.yearCls === '',
     {blocks: O.ovBlocks.length, cells: O.cells.length});
  ok('11.13 两榜已删：无 ov-block / flow-row / 空态文案 / 榜标题',
     O.blocks === 0 && O.rows === 0 && O.text.indexOf('分类支出') < 0
     && O.text.indexOf('最近流水') < 0 && O.text.indexOf('暂无') < 0, O.text.slice(0, 200));
  ok('11.14 总览页隐藏日历 / 日期条 / 资产汇总条，dock 选中「总览」',
     O.calHidden === true && O.dateHidden === true && O.assetHidden === true && O.ovActive === true, O);

  /* 11.15 三个页签互切：显隐与选中态逐项正确 */
  const T = ev(`(() => {
    const read = () => ({
      cal: document.getElementById('cal').hidden,
      date: document.getElementById('dateBar').hidden,
      asset: document.getElementById('assetSummary').hidden,
      active: [...document.querySelectorAll('.bottombar>button.tab.active')].map(b => b.id).join(','),
      cards: document.querySelectorAll('#flow .card').length,
      assetRows: document.querySelectorAll('#flow .asset-item[data-acct]').length
    });
    document.getElementById('tabBill').click();
    const bill = read();
    document.getElementById('tabAsset').click();
    const asset = read();
    document.getElementById('tabOv').click();
    const ov = read();
    return {bill:bill, asset:asset, ov:ov, tab:S.tab};
  })()`);
  ok('11.15 点「账单」：日历/日期条回来、总览卡片消失、选中账单',
     T.bill.cal === false && T.bill.date === false && T.bill.cards === 0 && T.bill.active === 'tabBill', T.bill);
  ok('11.16 点「资产」：汇总条 + 账户列表、日历隐藏、选中资产',
     T.asset.cal === true && T.asset.asset === false && T.asset.assetRows === 2 && T.asset.active === 'tabAsset', T.asset);
  ok('11.17 点「总览」：回到六卡 + 三块本年网格、日历与汇总条都隐藏',
     T.ov.cal === true && T.ov.asset === true && T.ov.cards === 6 && T.ov.active === 'tabOv' && T.tab === 'overview', T.ov);

  /* ---------------- 12. v1.4.0：三块每块三行 / 格子 6 列 × 2 行 / 纯展示 ---------------- */
  section('12. v1.4.0 三块三行（年份|本年X 合计 / 1~6 / 7~12）、6 列、结构一致、不可点');
  /* 12.1 三块直接渲在总览页上，不需要任何点击 */
  const HUB = ev(`(() => {
    S.tab = 'overview'; renderAll();
    const box = document.getElementById('flow');
    const blocks = [...box.querySelectorAll('.ov-heat')];
    const ys = heatData().yearSum;
    return {
      kinds: blocks.map(b => b.getAttribute('data-ov-kind')),
      titles: blocks.map(b => b.querySelector('.ov-heat-title').textContent),
      years: blocks.map(b => b.querySelector('.ov-heat-year').textContent),
      seps: blocks.map(b => b.querySelector('.ov-sep').textContent),
      sums: blocks.map(b => b.querySelector('.ov-heat-sum').textContent),
      headKids: blocks.map(b => b.querySelector('.ov-heat-head').children.length),
      n: blocks.map(b => b.querySelectorAll('.ov-cell').length),
      yearCells: box.querySelectorAll('.ov-cell.ov-year').length,
      sum: [ys.bal, ys.inc, ys.exp],
      sumStr: [money(ys.bal), money(ys.inc), money(ys.exp)],
      entryCards: box.querySelectorAll('[data-ov-page]').length,
      backKeys: box.querySelectorAll('[data-ov-back]').length
    };
  })()`);
  ok('12.1 总览页上直接出现三块（结余 / 收入 / 支出），顺序 bal → inc → exp，无需点击',
     HUB.kinds.join(',') === 'bal,inc,exp'
     && HUB.titles.join('/') === '本年结余/本年收入/本年支出', HUB);
  ok('12.2 三块第一行合计与 heatData().yearSum 同源（零新增公式）；三类都带正负号',
     HUB.sums.join(',') === '+8500.00,+9000.00,-500.00'
     && HUB.sums.every((s, i) => Math.abs(parseFloat(s)) === Math.abs(parseFloat(HUB.sumStr[i]))), HUB);
  ok('12.3 每块 12 格、第一行 4 个子节点（年份 / 竖线 / 本年X / 合计）；入口卡与返回键彻底消失',
     HUB.n.join(',') === '12,12,12' && HUB.headKids.join(',') === '4,4,4'
     && HUB.years.every(y => /^\d{4} 年$/.test(y))
     && HUB.seps.every(s => s === '|') && HUB.yearCells === 0
     && HUB.entryCards === 0 && HUB.backKeys === 0, HUB);

  /* 12.4 逐块读取：12 格 / 标签 / 第一行四段 / 有无切换控件 / 是否带 data-* / DOM 指纹 */
  const P = ev(`(() => {
    const grab = k => {
      S.tab = 'overview'; renderFlow();
      const box = [...document.querySelectorAll('#flow .ov-heat')].find(b => b.getAttribute('data-ov-kind') === k);
      const cells = [...box.querySelectorAll('.ov-cell')];
      const head = box.querySelector('.ov-heat-head');
      return {
        title: box.querySelector('.ov-heat-title').textContent,
        year: box.querySelector('.ov-heat-year').textContent,
        sep: box.querySelector('.ov-sep').textContent,
        sum: box.querySelector('.ov-heat-sum').textContent,
        headKids: head.children.length,
        n: cells.length,
        labels: cells.map(c => c.querySelector('.ov-mo').textContent),
        vals: cells.map(c => c.querySelector('.ov-val').textContent),
        hasYearCell: !!box.querySelector('.ov-cell.ov-year'),
        m11: cells[10].querySelector('.ov-val').textContent,
        toggles: box.querySelectorAll('[data-ov-metric],.ov-metric,.ov-metrics').length,
        dataHits: cells.filter(c => [...c.attributes].some(a => a.name.indexOf('data-') === 0)).length,
        styleHits: cells.filter(c => c.hasAttribute('style')).length,
        /* 结构指纹：第一行 4 个子节点 + 每格两个 span 的 tag/class 序列（三块必须完全一致） */
        fingerprint: [...head.children, ...box.querySelectorAll('.ov-heat-grid > .ov-cell, .ov-heat-grid > .ov-cell > span')]
          .map(e => e.tagName + '.' + e.className).join('|')
      };
    };
    const bal = grab('bal'), inc = grab('inc'), exp = grab('exp');
    return {bal:bal, inc:inc, exp:exp};
  })()`);
  ok('12.4 结余块：12 格（1~12，无本年格）、第一行「2026 年 | 本年结余 +8500.00」、11 月 +8500.00',
     P.bal.n === 12 && P.bal.hasYearCell === false && P.bal.sum === '+8500.00'
     && P.bal.m11 === '+8500.00' && P.bal.title === '本年结余' && P.bal.sep === '|'
     && P.bal.headKids === 4, P.bal);
  ok('12.5 收入块：12 格、合计 +9000.00（带正号）、11 月 +9000.00、标题「本年收入」',
     P.inc.n === 12 && P.inc.sum === '+9000.00' && P.inc.m11 === '+9000.00'
     && P.inc.title === '本年收入' && P.inc.hasYearCell === false, P.inc);
  ok('12.6 支出块：12 格、合计 -500.00（不计入剔除，取负号）、11 月 -500.00、标题「本年支出」',
     P.exp.n === 12 && P.exp.sum === '-500.00' && P.exp.m11 === '-500.00'
     && P.exp.title === '本年支出' && P.exp.hasYearCell === false, P.exp);
  ok('12.7 三块结构逐字相同：DOM 指纹（第一行 4 子节点 + 每格 2 个 span）完全一致',
     P.bal.fingerprint === P.inc.fingerprint && P.inc.fingerprint === P.exp.fingerprint
     && P.bal.fingerprint.length > 0, P.bal.fingerprint.slice(0, 140));
  ok('12.8 三块月份格标签都是 1~12（第 1~6 格在第一行、7~12 在第二行），且无任何切换控件',
     P.bal.labels.join(',') === '1,2,3,4,5,6,7,8,9,10,11,12'
     && P.inc.labels.join(',') === P.bal.labels.join(',') && P.exp.labels.join(',') === P.bal.labels.join(',')
     && P.bal.toggles === 0 && P.inc.toggles === 0 && P.exp.toggles === 0, P.bal.labels);
  ok('12.9 月份格纯展示：不带 data-*、不带 inline style（没有热力深浅）',
     P.bal.dataHits === 0 && P.bal.styleHits === 0 && P.inc.dataHits === 0 && P.exp.dataHits === 0, P.bal);

  /* 12.10 交互：点月份格 / 点整块都无反应；账单→总览 直接回来 */
  const NAV = ev(`(() => {
    S.tab = 'overview'; renderFlow();
    const read = () => ({
      tab: S.tab, sheet: sheetOpen(), cards: document.querySelectorAll('#flow .card').length,
      heat: document.querySelectorAll('#flow .ov-cell').length,
      blocks: document.querySelectorAll('#flow .ov-heat').length
    });
    const before = read();
    const cell = document.querySelector('#flow .ov-cell');
    if(cell) cell.click();
    const afterCell = read();
    const blk = document.querySelector('#flow .ov-heat');
    if(blk) blk.click();
    const afterBlock = read();
    document.getElementById('tabBill').click(); const bill = read();
    document.getElementById('tabOv').click(); const backOv = read();
    return {before:before, afterCell:afterCell, afterBlock:afterBlock, bill:bill, backOv:backOv};
  })()`);
  ok('12.10 总览页一次给齐：六卡 + 三块 + 36 格（无需要再点的入口）',
     NAV.before.cards === 6 && NAV.before.blocks === 3 && NAV.before.heat === 36, NAV.before);
  ok('12.11 点月份格 / 点整块都无任何反应（纯展示，不弹层、不改页）',
     NAV.afterCell.tab === 'overview' && NAV.afterCell.sheet === false && NAV.afterCell.blocks === 3
     && NAV.afterCell.heat === 36
     && NAV.afterBlock.tab === 'overview' && NAV.afterBlock.sheet === false && NAV.afterBlock.blocks === 3,
     {afterCell:NAV.afterCell, afterBlock:NAV.afterBlock});
  ok('12.12 账单 → 总览：六卡与三块原样回来（无残留状态、无需二次点击）',
     NAV.bill.cards === 0 && NAV.backOv.cards === 6 && NAV.backOv.blocks === 3
     && NAV.backOv.heat === 36 && NAV.backOv.tab === 'overview', NAV.backOv);

  /* 12.13 沿用 v1.3.8 / v1.3.9 的样式/布局契约（未因本版收回而回退） */
  ok('12.13 三块各画完整四边：块间仍是 6px 白隙，但后两块补回顶边（v1.4.1）',
     css.indexOf('.ov-heat{border:var(--line);margin:6px 0}') >= 0
     && css.indexOf('.ov-heat+.ov-heat{margin-top:0;border-top:var(--line)}') >= 0
     && css.indexOf('.ov-heat+.ov-heat{margin-top:0;border-top:0}') < 0,
     '后两块仍缺顶边 / 或又叠成 4px 粗线');
  ok('12.14 末条流水恢复下边框（last-child 去边规则已删），列表底部留 8px 防大黑边',
     css.indexOf('.flow-list .flow-row:last-child{border-bottom:0}') < 0
     && css.indexOf('gap:var(--flow-gap);padding-bottom:8px}') >= 0
     && css.indexOf('.flow-list{padding-bottom:.53em}') >= 0);
  ok('12.15 账单页 KPI 仍缩到 .86em（日历行与日期条共用同一套 .kpi）',
     css.indexOf('gap:2px;font-size:.86em;white-space:nowrap}') >= 0
     && css.indexOf('gap:2px;font-size:var(--fs-c);white-space:nowrap}') < 0);
  ok('12.16 格子 6 列（12 格 → 1~6 / 7~12 两行）、末列末行不重线、无本年格（三块共用同一套 CSS）',
     css.indexOf('grid-template-columns:repeat(6,minmax(0,1fr))') >= 0
     && css.indexOf('.ov-cell:nth-child(6n){border-right:0}') >= 0
     && css.indexOf('.ov-heat-grid>.ov-cell:nth-last-child(-n+6){border-bottom:0}') >= 0
     && css.indexOf('repeat(5,minmax(0,1fr))') < 0
     && css.indexOf('ov-year') < 0);
  ok('12.17 切换控件零残留（.ov-metric / .ov-metrics / data-ov-metric 一个都没有）',
     css.indexOf('.ov-metric{') < 0 && css.indexOf('.ov-metrics{') < 0
     && HTML.indexOf('data-ov-metric="') < 0 && HTML.indexOf("ovMetric:'bal'") < 0);
  ok('12.18 v1.3.9 的入口卡 / 返回键 / 状态位零残留（本版全部收回成直出）',
     css.indexOf('.ov-entry{') < 0 && css.indexOf('.ov-back{') < 0
     && HTML.indexOf('data-ov-page') < 0 && HTML.indexOf('data-ov-back') < 0
     && HTML.indexOf('ovPage') < 0);
  ok('12.19 三块第一行沿用纯黑白主题：不出现灰底 / 彩色 / hover 变色，竖线现在是正文色',
     css.indexOf('.ov-heat-head{display:flex;align-items:center;gap:4px;') >= 0
     && css.indexOf('.ov-heat-head:hover') < 0
     && css.indexOf('.ov-heat-sum{font-size:var(--fs-c);font-weight:700') >= 0
     && css.indexOf('.ov-sep{font-style:normal;font-size:var(--fs-c);line-height:1;color:var(--ink)}') >= 0
     && css.indexOf('.ov-heat-title{font-size:var(--fs-c);white-space:nowrap}') >= 0);

  /* ---------------- 13. v1.4.1：三处视觉修正 ---------------- */
  ok('13.1 三块都画完整四边：后两块补回顶边（收入 / 支出不再开口）',
     css.indexOf('.ov-heat{border:var(--line);margin:6px 0}') >= 0
     && css.indexOf('.ov-heat+.ov-heat{margin-top:0;border-top:var(--line)}') >= 0
     && css.indexOf('.ov-heat+.ov-heat{margin-top:0;border-top:0}') < 0);
  ok('13.2 总览竖线与账单页竖线同为 --fs-c / --ink，不再淡化',
     css.indexOf('.ov-sep{font-style:normal;font-size:var(--fs-c);line-height:1;color:var(--ink)}') >= 0
     && css.indexOf('opacity:.45') < 0
     && css.indexOf('.line1 .r.has-tag .sep{color:inherit}') >= 0);
  ok('13.3 dock 选中页签撤加粗，与未选页签同字号同色；指示条仍在',
     css.indexOf('.tab.active{background:var(--paper);color:var(--ink)}') >= 0
     && css.indexOf('.tab.active{background:var(--paper);color:var(--ink);font-weight:700}') < 0
     && css.indexOf('.tab.active::after{') >= 0);
  ok('13.4 手机端四框上移 6px、平板侧栏复位 0，dock 内距与 body 让位不动',
     css.indexOf('.bottombar>button{top:-6px}') >= 0
     && css.indexOf('.bottombar>button{top:0}') >= 0
     && css.indexOf('padding:7px 10px calc(2px + env(safe-area-inset-bottom,0px))') >= 0
     && css.indexOf('padding:0 4px calc(46px + env(safe-area-inset-bottom,0px))') >= 0);

  /* ---------------- 14. v1.4.2：全站小圆弧 ---------------- */
  ok('14.1 两级半径令牌存在：容器 8px / 控件 4px',
     css.indexOf(':root{--r:8px;--r-s:4px}') >= 0);
  ok('14.2 面板与三块本年卡片用容器级圆角，并用 overflow:hidden 裁出内层四角',
     css.indexOf('.panel{border-radius:var(--r);overflow:hidden}') >= 0
     && css.indexOf('.ov-heat{border-radius:var(--r);overflow:hidden}') >= 0);
  ok('14.3 v1.0.0 dock 四块拆分独立边框，四角全圆',
     css.indexOf('.bottombar>button,\n.bottombar>button:first-child,\n.bottombar>button:last-child{border-radius:var(--r)}') >= 0);
  ok('14.4 月份格 / 资产行基础样式仍直角；账单 .flow-row 圆角属 v1.0.0 独立卡片覆盖层',
     !/\.ov-cell\{[^}]*border-radius/.test(css)
     && !css.slice(css.indexOf('.flow-row{'), css.indexOf('}', css.indexOf('.flow-row{'))).includes('border-radius')
     && !/\.asset-row\{[^}]*border-radius/.test(css));

  /* ---------------- 15. v1.4.3：顶栏六格 + 总览金额带正负号 ---------------- */
  /* v1.4.5 起「资产管理中枢」整格移除，六格→五格，原「前五格等分」变「四键等分」 */
  ok('15.1 顶栏五格顺序：设置 / 备份 / 恢复 / 明暗 / 新增账户',
     [...d.querySelectorAll('.topbar>button')].map(b => b.id).join(',')
       === 'btnSettings,btnBackup,btnRestore,btnTheme,btnAddAccount',
     [...d.querySelectorAll('.topbar>button')].map(b => b.id));
  ok('15.2 顶栏弹性空档已删，功能键 flex:1 等分、末格按内容定宽',
     d.querySelectorAll('.topbar>.spacer').length === 0
     && css.indexOf('.topbar>.bx.stub{flex:1 1 0;min-width:0;padding:0 .28em;letter-spacing:.13em}') >= 0
     && css.indexOf('.topbar>.bx.add{flex:0 0 auto;padding:0 .55em;letter-spacing:0}') >= 0);
  ok('15.3 「+ 新增账户」只在顶栏出现一次，资产页内已无同名按钮',
     d.querySelectorAll('#btnAddAccount').length === 1
     && d.querySelector('#btnAddAccount').closest('.topbar') !== null
     && d.querySelectorAll('#flow #btnAddAccount').length === 0);
  const ovh = ev(`(function(){
    const bak = DB.tx;
    DB.tx = [
      {id:'z1',type:'expense',date:'2026-11-03',time:'10:00',from:'招商银行储蓄卡',fromId:'a1',category:'餐饮',amount:120},
      {id:'z2',type:'income', date:'2026-11-08',time:'09:00',to:'招商银行储蓄卡',toId:'a1',category:'工资',amount:9000}
    ];
    const h = renderOverview();
    DB.tx = bak; return h;
  })()`);
  const cv = lab => {
    const m = ovh.match(new RegExp('<span class="lab">' + lab + '</span><span class="val">([^<]+)</span>'));
    return m ? m[1] : null;
  };
  ok('15.4 本月三卡带号（支出 -120.00 / 收入 +9000.00 / 结余 +8880.00），资产三卡不加号',
     cv('本月支出') === '-120.00' && cv('本月收入') === '+9000.00' && cv('本月结余') === '+8880.00'
     && cv('总资产') === '9880.00' && cv('资产账户') === '9880.00' && cv('信贷账户') === '0.00',
     [cv('本月支出'), cv('本月收入'), cv('本月结余'), cv('总资产')]);
  ok('15.5 三块合计与 12 格都带号：非 0 必带 +/-，0 仍是 0.00',
     (() => {
       const sums = [...ovh.matchAll(/<span class="ov-heat-sum">([^<]+)<\/span>/g)].map(m => m[1]);
       const vals = [...ovh.matchAll(/<span class="ov-val">([^<]+)<\/span>/g)].map(m => m[1]);
       return sums.join(',') === '+8880.00,+9000.00,-120.00'
         && vals.length === 36
         && vals.every(v => v === '0.00' || v[0] === '+' || v[0] === '-')
         && vals.indexOf('+8880.00') > -1 && vals.indexOf('-120.00') > -1;
     })());
  ok('15.6 账单页 KPI 未被波及（仍是 v1.3.8 的 kpiHTML：支出条件负号 / 收入恒 + / 结余原样）',
     ev('typeof kpiHTML') === 'function'
     && ev('kpiHTML({exp:500,inc:9000,bal:8500})').indexOf('支出-500') > -1
     && ev('kpiHTML({exp:500,inc:9000,bal:8500})').indexOf('收入+9000') > -1
     && ev('kpiHTML({exp:0,inc:0,bal:0})').indexOf('结余0') > -1);

  /* ---------------- 16. v1.4.5：顶栏「资产管理中枢」按键移除 ---------------- */
  const tbBtns = [...d.querySelectorAll('.topbar>button')];
  ok('16.1 顶栏不再有「资产管理中枢」：无 #btnBrand、无 .bx.brand 节点、无同名文案',
     tbBtns.length === 5
     && d.querySelectorAll('#btnBrand, .bx.brand').length === 0
     && tbBtns.every(b => b.textContent.trim() !== '资产管理中枢'),
     tbBtns.map(b => b.id));
  ok('16.2 「资产管理中枢」的 26% 定宽三档声明全删，样式表里不再有 .bx.brand',
     css.indexOf('.bx.brand{') < 0 && css.indexOf('id="btnBrand"') < 0);
  ok('16.3 「回到最新有流水的日期」的点击监听随按键一起下线（源码里不再出现 btnBrand）',
     !/btnBrand/.test(d.documentElement.outerHTML));
  tbBtns.find(b => b.id === 'btnAddAccount').click();
  ok('16.4 顶栏新增账户在总览页也能开弹层（三页共用同一入口）',
     d.getElementById('acctSheet').classList.contains('on')
     && d.getElementById('acctTitle').textContent === '新增账户');

  console.log('\n页面运行时异常: ' + (jsErrors.length ? JSON.stringify(jsErrors.slice(0, 3)) : '0 条'));
  console.log('\n========== jsdom 实测: ' + pass + ' PASS / ' + fail + ' FAIL ==========');
  return fail === 0 ? 0 : 1;
}

process.exitCode = main();
