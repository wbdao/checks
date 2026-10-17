/* شاشة مراجعة البيانات (قراءة فقط): مشاكل في الشيتين علشان الفرع ينضّف الشيت —
   تكرار، شيك في الشيتين بحالة أو قيمة مختلفة، mm غلط، بيانات ناقصة، شيكات من غير كود WH، كود عميل بأكتر من اسم.
   الدوال الصافية (من غير DOM) بتتصدّر لـ Node علشان الاختبارات: tests/review.test.js */
(function (root) {
  'use strict';

  // ===== الدوال الصافية =====
  // سجل الشيكات: { id, code, name, checkNo, bank, amountN, paidN, dueD, due, status, recvD }
  // سجل المخازن: { whId, _rowNum, code, name, checkNo, bank, amountN, collectedN, dueD, due, state, recvD }
  const PAID = 'خالص';
  const WH_STATES = [PAID, 'تم رد الشيك', 'NN'];
  const EPS = 0.005;
  const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();
  // رقم الشيك للمقارنة: من غير مسافات ولا أصفار على الشمال (الشيت ساعات بيحوّل «00123» لرقم 123)
  const normNo = s => String(s ?? '').replace(/\s+/g, '').replace(/^0+(?=\d)/, '');
  const normBank = s => norm(s).toLowerCase();
  const noName = s => !s || s === '#N/A';
  const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  const fmt = n => nf.format(Math.round((Number(n) || 0) * 100) / 100);
  const isPaidMain = r => norm(r.status) === PAID;
  const isPaidWh = x => norm(x.state) === PAID;
  const ref = (sheet, r) => sheet === 'wh' ? (r.whId || 'صف ' + r._rowNum) : r.id;

  // نفس رقم الشيك + نفس البنك أكتر من مرة في نفس الشيت
  function duplicates(recs, sheet) {
    const by = new Map();
    for (const r of recs) {
      const no = normNo(r.checkNo); if (!no) continue;
      const k = no + '|' + normBank(r.bank);
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(r);
    }
    const out = [];
    [...by.entries()].filter(([, l]) => l.length > 1)
      .sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }))
      .forEach(([k, l]) => l.forEach(r => out.push({ sheet, rec: r, key: k, reason: l.length === 2 ? 'متكرر مرتين' : `متكرر ${l.length} مرات` })));
    return out;
  }

  // نفس الشيك (كود العميل + رقم الشيك) في الشيتين، والحالة (خالص / مش خالص) أو القيمة مختلفة
  function crossConflicts(main, wh) {
    const idx = new Map();
    for (const x of wh) {
      const no = normNo(x.checkNo), code = norm(x.code); if (!no || !code) continue;
      const k = code + '|' + no;
      if (!idx.has(k)) idx.set(k, []);
      idx.get(k).push(x);
    }
    const out = [];
    for (const m of main) {
      const no = normNo(m.checkNo), code = norm(m.code); if (!no || !code) continue;
      for (const x of idx.get(code + '|' + no) || []) {
        const reasons = [];
        if (isPaidMain(m) !== isPaidWh(x))
          reasons.push(`الحاله «${norm(m.status) || 'فاضي'}» في الشيكات و mm «${norm(x.state) || 'فاضي'}» في المخازن`);
        if (Math.abs((m.amountN || 0) - (x.amountN || 0)) > EPS)
          reasons.push(`القيمة ${fmt(m.amountN)} في الشيكات و ${fmt(x.amountN)} في المخازن`);
        if (reasons.length) out.push({ sheet: 'main', rec: m, twin: x, reason: reasons.join('، ') });
      }
    }
    return out;
  }

  // mm في شيت المخازن لازم تكون خالص / تم رد الشيك / NN
  function badStates(wh) {
    return wh.filter(x => !WH_STATES.includes(norm(x.state))).map(x => {
      const v = norm(x.state);
      return { sheet: 'wh', rec: x, reason: !v ? 'mm فاضي' : /^\d{4,}$/.test(v) ? `mm = ${v} (شكله رقم شيك)` : `mm = «${v}»` };
    });
  }

  // تاريخ استحقاق / بنك / رقم شيك ناقص، قيمة ≤ صفر، الدفعات أو التحصيل أكبر من القيمة
  function fieldProblems(recs, sheet) {
    const paidKey = sheet === 'wh' ? 'collectedN' : 'paidN';
    const paidLbl = sheet === 'wh' ? 'التحصيل' : 'دفعات شيكات';
    const out = [];
    for (const r of recs) {
      const why = [];
      if (!r.dueD) why.push(norm(r.due) ? `تاريخ الاستحقاق مش مفهوم «${norm(r.due)}»` : 'مفيش تاريخ استحقاق');
      if (!norm(r.bank)) why.push('مفيش بنك');
      if (!normNo(r.checkNo)) why.push('مفيش رقم شيك');
      if (!((r.amountN || 0) > 0)) why.push('قيمة الشيك صفر أو بالسالب');
      else if ((r[paidKey] || 0) > r.amountN + EPS) why.push(`${paidLbl} (${fmt(r[paidKey])}) أكبر من قيمة الشيك`);
      if (why.length) out.push({ sheet, rec: r, reason: why.join('، ') });
    }
    return out;
  }

  const missingWhId = wh => wh.filter(x => !norm(x.whId)).map(x => ({ sheet: 'wh', rec: x, reason: 'مالوش كود WH' }));

  // كود عميل واحد مكتوب بأكتر من اسم (في الشيتين مع بعض). صف لكل اسم، ومعاه آخر شيك بالاسم ده علشان يتعدّل
  function multiNames(main, wh) {
    const by = new Map();
    const add = (sheet, r) => {
      const code = norm(r.code), name = norm(r.name); if (!code || noName(name)) return;
      if (!by.has(code)) by.set(code, new Map());
      const m = by.get(code);
      if (!m.has(name)) m.set(name, { name, list: [] });
      m.get(name).list.push({ sheet, rec: r });
    };
    main.forEach(r => add('main', r));
    wh.forEach(r => add('wh', r));
    const out = [];
    [...by.entries()].filter(([, m]) => m.size > 1)
      .sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }))
      .forEach(([code, m]) => {
        const names = [...m.values()].sort((a, b) => b.list.length - a.list.length);
        names.forEach(v => {
          const last = v.list.slice().sort((a, b) => (b.rec.recvD || 0) - (a.rec.recvD || 0))[0];
          const sheets = new Set(v.list.map(x => x.sheet));
          out.push({
            sheet: last.sheet, rec: last.rec, code, name: v.name, count: v.list.length,
            sheets: [...sheets].map(s => s === 'wh' ? 'المخازن' : 'الشيكات').join(' + '),
            reason: `${names.length} أسماء للكود ده`,
          });
        });
      });
    return out;
  }

  // كل المجموعات. wh = null لو شيت المخازن لسه ما اتحملش: المجموعات اللي محتاجاه بتبقى pending
  const GROUPS = [
    ['dupMain', 'رقم شيك + بنك متكرر في «الشيكات (2)»', 'نفس رقم الشيك لنفس البنك موجود أكتر من مرة في شيت الشيكات.', false],
    ['dupWh', 'رقم شيك + بنك متكرر في «شيكات المخازن»', 'نفس رقم الشيك لنفس البنك موجود أكتر من مرة في شيت المخازن.', true],
    ['cross', 'شيك في الشيتين بحالة أو قيمة مختلفة', 'نفس كود العميل ونفس رقم الشيك في الشيتين، بس واحد خالص والتاني لأ، أو القيمة مش زي بعض.', true],
    ['mm', 'mm غلط في «شيكات المخازن»', 'mm لازم تكون خالص أو تم رد الشيك أو NN — أي قيمة تانية (زي رقم شيك اتكتب غلط) بتبوّظ الحسابات.', true],
    ['fields', 'بيانات ناقصة أو غلط', 'مفيش تاريخ استحقاق أو بنك أو رقم شيك، أو القيمة صفر، أو الدفعات/التحصيل أكبر من قيمة الشيك.', false],
    ['noWh', 'شيكات مخازن من غير كود WH', 'الشيكات دي بتتعدّل برقم الصف. ادّيها كود من شاشة شيكات المخازن («إعطاء كود للشيكات دي»).', true],
    ['names', 'كود عميل بأكتر من اسم', 'نفس كود العميل مكتوب بأسماء مختلفة (في الشيت الواحد أو بين الشيتين).', false],
  ];
  function findIssues(main, wh) {
    const w = wh || [];
    const items = {
      dupMain: duplicates(main, 'main'),
      dupWh: duplicates(w, 'wh'),
      cross: crossConflicts(main, w),
      mm: badStates(w),
      fields: fieldProblems(main, 'main').concat(fieldProblems(w, 'wh')),
      noWh: missingWhId(w),
      names: multiNames(main, w),
    };
    return GROUPS.map(([key, title, hint, needsWh]) => ({ key, title, hint, needsWh, pending: needsWh && !wh, items: needsWh && !wh ? [] : items[key] }));
  }

  const R = { PAID, WH_STATES, norm, normNo, normBank, ref, duplicates, crossConflicts, badStates, fieldProblems, missingWhId, multiNames, findIssues, GROUPS };
  if (typeof module === 'object' && module.exports) { module.exports = R; return; }

  // ===== الشاشة =====
  const App = root.App, { $, esc } = App;
  const MAX_ROWS = 300;   // أكتر من كده في الشاشة تقيلة — «نسخ كجدول» بينسخهم كلهم
  const WH = () => App.views.warehouses && App.views.warehouses.shared;
  let groups = [];

  const sheetBadge = s => s === 'wh' ? '<span class="badge info">المخازن</span>' : '<span class="badge">الشيكات</span>';
  const dueTxt = r => App.iso(r.dueD) || norm(r.due);
  const stateTxt = i => i.sheet === 'wh' ? norm(i.rec.state) : norm(i.rec.status);
  const sheetTxt = i => i.sheet === 'wh' ? 'المخازن' : 'الشيكات';
  const refTxt = i => ref(i.sheet, i.rec);
  const money = (k = 'amountN') => [r => App.fmt(r[k]), { sum: r => r[k], num: true }];

  // أعمدة كل مجموعة: [العنوان، i => نص، { sum, num, html }] — نفس الأعمدة للشاشة وللنسخ
  const C = {
    sheet: ['الشيت', sheetTxt, { html: i => sheetBadge(i.sheet) }],
    ref: ['NN / WH', refTxt],
    code: ['كود العميل', i => i.rec.code],
    name: ['العميل', i => i.rec.name],
    bank: ['البنك', i => i.rec.bank],
    no: ['رقم الشيك', i => i.rec.checkNo],
    amount: ['قيمة الشيك', i => App.fmt(i.rec.amountN), { sum: i => i.rec.amountN, num: true }],
    due: ['الاستحقاق', i => dueTxt(i.rec)],
    state: ['الحاله / mm', stateTxt],
    reason: ['المشكلة', i => i.reason, { cls: 'wrap' }],
  };
  const COLS = {
    dupMain: [C.no, C.bank, C.ref, C.code, C.name, C.amount, C.due, C.state, C.reason],
    dupWh: [C.no, C.bank, C.ref, C.code, C.name, C.amount, C.due, C.state, C.reason],
    cross: [C.code, C.name, C.no, ['NN', i => i.rec.id], ['الحاله (الشيكات)', i => norm(i.rec.status)],
      ['قيمة (الشيكات)', i => App.fmt(i.rec.amountN), { num: true, sum: i => i.rec.amountN }],
      ['WH', i => ref('wh', i.twin), { html: i => `<button type="button" class="btn ghost small" data-open="twin" title="فتح شيك المخازن">${esc(ref('wh', i.twin))}</button>` }],
      ['mm (المخازن)', i => norm(i.twin.state)],
      ['قيمة (المخازن)', i => App.fmt(i.twin.amountN), { num: true, sum: i => i.twin.amountN }], C.reason],
    mm: [C.ref, ['المخزن', i => i.rec.wh], C.code, C.name, C.bank, C.no, C.amount, C.due, ['mm', i => i.rec.state], C.reason],
    fields: [C.sheet, C.ref, C.code, C.name, C.bank, C.no, C.amount, C.due, C.state, C.reason],
    noWh: [['الصف', i => i.rec._rowNum], ['المخزن', i => i.rec.wh], C.code, C.name, C.bank, C.no, C.amount, C.due, ['mm', i => i.rec.state]],
    names: [['كود العميل', i => i.code], ['الاسم', i => i.name], ['عدد الشيكات', i => i.count], ['الشيت', i => i.sheets],
      ['آخر شيك بالاسم ده', i => `${sheetTxt(i)} ${refTxt(i)}`]],
  };

  function cardHtml(g, w) {
    const cols = COLS[g.key];
    const n = g.items.length;
    const head = `<div class="section-title"><h3>${esc(g.title)}</h3>
      ${g.pending ? '<span class="badge">…</span>' : `<span class="badge ${n ? 'bad' : 'ok'}">${n ? n : '✓'}</span>`}
      <span class="grow"></span>${n ? `<button type="button" class="btn ghost" data-copy="${g.key}" title="نسخ الجدول علشان تلصقه في Excel أو Google Sheets">📋 نسخ كجدول</button>` : ''}</div>
      <p class="muted small" style="margin:0 0 8px">${esc(g.hint)}</p>`;
    if (g.pending) {
      const st = w ? w.state() : 'failed';
      return `<div class="card rv-group" id="rv-${g.key}">${head}<p class="muted small">${st === 'failed' ? '⚠ شيت المخازن ما اتحملش — اضغط ⟳ تحديث' : 'جاري تحميل شيت المخازن…'}</p></div>`;
    }
    if (!n) return `<div class="card rv-group" id="rv-${g.key}">${head}<p class="small" style="color:var(--ok);margin:0">✓ مفيش مشاكل</p></div>`;
    const shown = g.items.slice(0, MAX_ROWS);
    const body = shown.map((i, j) => `<tr data-g="${g.key}" data-i="${j}" title="اضغط لفتح الشيك وتعديله">${cols.map(c => {
      const o = c[2] || {};
      return `<td class="${o.num ? 'num' : ''} ${o.cls || ''}">${o.html ? o.html(i) : esc(c[1](i))}</td>`;
    }).join('')}</tr>`).join('');
    return `<div class="card rv-group" id="rv-${g.key}">${head}
      <div class="table-wrap" style="max-height:420px"><table class="grid review-table"><thead><tr>${cols.map(c => `<th>${esc(c[0])}</th>`).join('')}</tr></thead>
      <tbody>${body}</tbody></table></div>
      ${n > MAX_ROWS ? `<div class="pager"><span class="muted small">ظاهر أول ${MAX_ROWS} من ${n} — «نسخ كجدول» بينسخهم كلهم</span></div>` : ''}</div>`;
  }

  function render() {
    const w = WH();
    w?.ensure();   // شيت المخازن بيتحمّل في الخلفية، ولما يخلص الشاشة بتترسم تاني بيه
    const whRecs = w && w.state() === 'ready' ? w.records() : null;
    groups = findIssues(App.state.records, whRecs);
    const total = groups.reduce((s, g) => s + g.items.length, 0);
    $('#rvKpis').innerHTML = groups.map(g => {
      const n = g.items.length;
      return `<button type="button" class="kpi rv-kpi ${g.pending ? '' : n ? 'bad' : 'ok'}" data-jump="${g.key}">
        <div class="lbl">${esc(g.title)}</div><div class="val">${g.pending ? '…' : n}</div></button>`;
    }).join('');
    $('#rvSummary').innerHTML = `${App.state.records.length.toLocaleString('en-US')} شيك في «الشيكات (2)»${whRecs ? ` • ${whRecs.length.toLocaleString('en-US')} شيك في «شيكات المخازن»` : ''}
      • <b>${total.toLocaleString('en-US')}</b> مشكلة${groups.some(g => g.pending) ? ' (لسه بنستنى شيت المخازن)' : ''}. اضغط على أي صف لفتح الشيك وتعديله.`;
    $('#rvGroups').innerHTML = groups.map(g => cardHtml(g, w)).join('');
  }

  function open(item, twin) {
    const w = WH();
    if (twin) { w && w.openForm(item.twin); return; }
    if (item.sheet === 'wh') { if (w) w.openForm(item.rec); return; }
    App.openForm(item.rec);
  }

  App.views.review = {
    render,
    init() {
      $('#rvGroups').addEventListener('click', e => {
        const cp = e.target.closest('[data-copy]');
        if (cp) {
          const g = groups.find(x => x.key === cp.dataset.copy); if (!g) return;
          // id مختلف عن أكواد الشيكات علشان التحديد في الشاشات التانية ما يأثرش على النسخ
          const rows = g.items.map((i, j) => Object.assign({ id: 'rv:' + g.key + ':' + j }, i));
          App.share.copyTable({ title: 'مراجعة البيانات — ' + g.title, unit: g.key === 'names' ? 'اسم' : 'شيك', file: 'review-' + g.key, rows,
            cols: COLS[g.key].map(([t, f, o]) => [t, f, o && o.sum ? { sum: o.sum, num: o.num } : undefined]) });
          return;
        }
        const tr = e.target.closest('tr[data-g]'); if (!tr) return;
        const g = groups.find(x => x.key === tr.dataset.g), item = g && g.items[+tr.dataset.i];
        if (item) open(item, !!e.target.closest('[data-open="twin"]'));
      });
      $('#rvKpis').addEventListener('click', e => {
        const b = e.target.closest('[data-jump]'); if (!b) return;
        document.getElementById('rv-' + b.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
