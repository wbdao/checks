/* إدراج مجموعة شيكات من جدول منسوخ (Excel / Google Sheets)
   نفس النافذة تخدم أكتر من شيت: كل شيت ليه «هدف» (target) بيحدد أعمدته وقواعده وطريقة الحفظ */
(function () {
  'use strict';
  const App = window.App, { $, esc, F } = App;
  const CHUNK = 300;                                   // عدد الشيكات في كل طلب

  // توحيد كتابة العناوين: أ/إ/آ→ا، ة→ه، ى→ي، وإزالة المسافات الزائدة
  const norm = s => String(s ?? '').trim().replace(/\s+/g, ' ')
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').toLowerCase();

  // ===== هدف شيت الشيكات الرئيسي =====
  const MAIN = {
    title: 'إدراج شيكات من جدول',
    labels: F,
    aliases: {
      'اسم العميل': 'name', 'العميل': 'name', 'الكود': 'code', 'رقم شيك': 'checkNo', 'بنك': 'bank', 'القيمة': 'amount',
      'المبلغ': 'amount', 'الاستحقاق': 'due', 'تاريخ الاستلام': 'recv', 'الاستلام': 'recv', 'الحالة': 'status',
      'المورد': 'supplier', 'اسم صاحب الشيك': 'drawer', 'صافي الشيك': 'net', 'الصافي': 'net', 'ملاحظات': 'note',
    },
    computed: ['net', 'month', 'year', 'dueState', 'id'],
    required: ['code', 'name', 'checkNo', 'bank', 'amount', 'due'],
    dates: ['recv', 'due', 'outDate'],
    numbers: ['amount', 'paid'],
    minus: 'paid',
    show: ['code', 'name', 'wh', 'checkNo', 'bank', 'amount', 'paid', 'recv', 'due', 'status'],
    action: 'addMany',
    ready: () => App.state.loaded,
    headers: () => App.state.headers,
    existing: () => new Set(App.state.records.map(r => r.checkNo + '|' + r.bank)),
    complete(rec, warns, today) {
      const cust = rec.code ? App.customers.get(rec.code) : [...App.customers.values()].find(c => c.name === rec.name);
      if (cust) {
        if (!rec.code) rec.code = cust.code;
        if (!rec.name) rec.name = cust.name;
        if (!rec.wh) rec.wh = cust.wh || '';
        if (!rec.mm) rec.mm = cust.mm || '';
      } else if (rec.code) warns.push('عميل جديد');
      if (!rec.recv) rec.recv = today;
      if (rec.paid === undefined || rec.paid === '') rec.paid = 0;
    },
    check(rec, errors) { if (App.num(rec.paid) > App.num(rec.amount)) errors.push('الدفعات أكبر من قيمة الشيك'); },
    async send(records) {
      const res = await App.api('addMany', { records });
      const idx = App.colIndex();
      return res.rows.map(r => { const rec = App.toRecord(r, idx); App.state.records.push(rec); return rec.id; });
    },
    finish(ids) {
      App.buildIndexes();
      App.toast(`تم إدراج ${ids.length} شيك ✓ (${ids[0]} → ${ids[ids.length - 1]})`, 4000);
      App.render();
    },
  };

  let T = MAIN;
  let KEY_BY_LABEL = {};
  function useTarget(t) {
    T = t;
    KEY_BY_LABEL = {};
    for (const k in T.labels) KEY_BY_LABEL[norm(T.labels[k])] = k;
    for (const a in T.aliases) if (!KEY_BY_LABEL[norm(a)]) KEY_BY_LABEL[norm(a)] = T.aliases[a];
    $('#importDlg .dlg-head h2').textContent = T.title;
  }

  // قراءة TSV مع دعم الخلايا بين علامات تنصيص (التي تحتوي على أسطر جديدة)
  function parseTSV(text) {
    const rows = []; let row = [], cell = '', q = false;
    text = text.replace(/\r\n?/g, '\n');
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') q = false;
        else cell += ch;
      } else if (ch === '"' && cell === '') q = true;
      else if (ch === '\t') { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim() !== ''));
  }

  const SHORT_DATE = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/;

  // التاريخ: yyyy-mm-dd، أو أرقام مفصولة بـ / حسب الصيغة (dmy = يوم/شهر، mdy = شهر/يوم)، أو رقم سيريال إكسل
  function parseDate(v, order) {
    const s = String(v ?? '').trim();
    if (!s) return '';
    let m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
    if (m) return valid(+m[1], +m[2], +m[3]);
    m = s.match(SHORT_DATE);
    if (m) {
      let y = +m[3];
      if (y < 100) y += 2000;
      return order === 'mdy' ? valid(y, +m[1], +m[2]) : valid(y, +m[2], +m[1]);
    }
    if (/^\d{5}(\.\d+)?$/.test(s)) return App.iso(App.parseDate(Number(s)));
    return null;
  }

  // تحديد صيغة التاريخ من الجدول كله: لو فيه رقم أول > 12 فهي يوم/شهر، ولو رقم ثاني > 12 فهي شهر/يوم
  function detectOrder(data, cols) {
    let dmy = 0, mdy = 0;
    data.forEach(cells => cols.forEach((k, i) => {
      if (!T.dates.includes(k)) return;
      const m = String(cells[i] ?? '').trim().match(SHORT_DATE);
      if (!m) return;
      if (+m[1] > 12) dmy++;
      if (+m[2] > 12) mdy++;
    }));
    if (dmy && !mdy) return 'dmy';
    if (mdy && !dmy) return 'mdy';
    return dmy && mdy ? 'conflict' : '';
  }
  function valid(y, mo, d) {
    const dt = new Date(y, mo - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? App.iso(dt) : null;
  }
  function parseNum(v) {
    const s = String(v ?? '').replace(/[,\s]|ج\.?م\.?|جنيه/g, '');
    if (s === '' || s === '-') return '';
    const n = Number(s);
    return isFinite(n) ? n : null;
  }

  let parsed = []; // [{rec, errors, warns}]

  function analyse() {
    const L = T.labels;
    const text = $('#impText').value;
    const rows = parseTSV(text);
    parsed = [];
    if (!rows.length) { draw([], []); return; }

    // تحديد الأعمدة
    const hits = rows[0].map(c => KEY_BY_LABEL[norm(c)]);
    const hasHeader = hits.filter(Boolean).length >= 2;
    const cols = hasHeader ? hits : T.headers().map(h => KEY_BY_LABEL[norm(h)]);
    const labels = hasHeader ? rows[0] : T.headers();
    const data = hasHeader ? rows.slice(1) : rows;

    // صيغة التاريخ: اختيار المستخدم، أو المكتشفة من الجدول
    const choice = $('#impDateFmt').value;
    const detected = detectOrder(data, cols);
    const order = choice !== 'auto' ? choice : (detected === 'mdy' ? 'mdy' : 'dmy');
    const FMT = { dmy: 'يوم/شهر/سنة', mdy: 'شهر/يوم/سنة' };
    $('#impDateInfo').innerHTML = choice !== 'auto' ? `مستخدم: <b>${FMT[order]}</b>`
      : detected === 'conflict' ? '<span style="color:var(--bad)">⚠ الجدول فيه صيغتين مختلفتين للتاريخ — راجع التواريخ أو اختار الصيغة</span>'
      : detected ? `تم اكتشاف: <b>${FMT[order]}</b>`
      : `<span style="color:var(--warn)">⚠ لم يمكن تحديد الصيغة من الجدول — تم افتراض <b>${FMT[order]}</b>، راجع التواريخ أو اختار الصيغة</span>`;

    const today = App.iso(App.today());
    const existing = T.existing();
    const inBatch = new Map();

    data.forEach(cells => {
      const rec = {}, errors = [], warns = [], bad = new Set();
      cols.forEach((k, i) => { if (k && !T.computed.includes(k) && cells[i] !== undefined) rec[k] = String(cells[i]).trim(); });

      for (const k of T.numbers) if (k in rec) {
        const n = parseNum(rec[k]);
        if (n === null) { bad.add(k); errors.push(`${L[k]} غير رقمي "${rec[k]}"`); rec[k] = ''; } else rec[k] = n;
      }
      for (const k of T.dates) if (k in rec) {
        const d = parseDate(rec[k], order);
        if (d === null) { bad.add(k); errors.push(`${L[k]} غير مفهوم "${rec[k]}"`); rec[k] = ''; } else rec[k] = d;
      }

      T.complete(rec, warns, today);

      for (const k of T.required) if (!bad.has(k) && (rec[k] === undefined || rec[k] === '')) errors.push(`${L[k]} مطلوب`);
      if (rec.amount !== '' && rec.amount !== undefined && !(rec.amount > 0)) errors.push('قيمة الشيك يجب أن تكون أكبر من صفر');
      T.check(rec, errors);
      if (rec.due && rec.recv && rec.due < rec.recv) warns.push('الاستحقاق قبل تاريخ الاستلام — راجع صيغة التاريخ');

      const key = String(rec.checkNo ?? '') + '|' + String(rec.bank ?? '');
      if (rec.checkNo && existing.has(key)) errors.push('رقم الشيك موجود بالفعل في الشيت لنفس البنك');
      else if (rec.checkNo && inBatch.has(key)) errors.push(`مكرر في الجدول (صف ${inBatch.get(key)})`);
      else if (rec.checkNo) inBatch.set(key, parsed.length + 1);

      parsed.push({ rec, errors, warns });
    });
    draw(labels, cols, hasHeader);
  }

  function draw(labels, cols, hasHeader) {
    const L = T.labels;
    const ok = parsed.filter(p => !p.errors.length);
    // الأعمدة المتعرف عليها
    $('#impMap').innerHTML = labels.length ? `<span class="muted">${hasHeader ? 'الأعمدة:' : 'بدون عناوين — بترتيب أعمدة الشيت:'}</span> ` +
      labels.map((l, i) => {
        const k = cols[i]; if (!String(l).trim()) return '';
        if (!k) return `<span class="badge bad" title="عمود غير معروف — سيتم تجاهله">${esc(l)} ✕</span>`;
        if (T.computed.includes(k)) return `<span class="badge" title="يُحسب تلقائياً — سيتم تجاهله">${esc(l)} ⚙</span>`;
        return `<span class="badge ok">${esc(l)}</span>`;
      }).join(' ') : '';

    const has = parsed.length > 0;
    $('#impSummary').classList.toggle('hidden', !has);
    $('#impPreviewWrap').classList.toggle('hidden', !has);
    const total = ok.reduce((s, p) => s + App.num(p.rec.amount) - App.num(p.rec[T.minus]), 0);
    $('#impSummary').innerHTML = [
      ['عدد الصفوف', parsed.length, ''], ['جاهز للإدراج', ok.length, 'ok'],
      ['بها أخطاء (لن تُدرج)', parsed.length - ok.length, parsed.length - ok.length ? 'bad' : ''], ['صافي القيمة', App.fmt(total), ''],
    ].map(([l, v, c]) => `<div class="kpi ${c}"><div class="lbl">${l}</div><div class="val">${v}</div></div>`).join('');

    const show = T.show;
    $('#impPreview thead').innerHTML = `<tr><th>#</th><th></th>${show.map(k => `<th>${esc(L[k])}</th>`).join('')}<th>ملاحظات</th></tr>`;
    $('#impPreview tbody').innerHTML = parsed.map((p, i) => `
      <tr class="${p.errors.length ? 'row-bad' : p.warns.length ? 'row-warn' : ''}">
        <td>${i + 1}</td><td>${p.errors.length ? '❌' : '✅'}</td>
        ${show.map(k => `<td class="${T.numbers.includes(k) ? 'num' : ''}">${T.numbers.includes(k) && p.rec[k] !== '' && p.rec[k] !== undefined ? App.fmt(p.rec[k]) : esc(T.display ? T.display(k, p.rec[k]) : p.rec[k] ?? '')}</td>`).join('')}
        <td class="errs">${[...p.errors.map(esc), ...p.warns.map(w => `<span style="color:var(--warn)">${esc(w)}</span>`)].join('<br>')}</td>
      </tr>`).join('');

    const btn = $('#impSave');
    btn.disabled = !ok.length;
    btn.textContent = ok.length ? `إدراج ${ok.length} شيك` : 'إدراج';
    $('#impMsg').textContent = ''; $('#impMsg').className = 'small';
  }

  async function save(ev) {
    ev.preventDefault();
    const ok = parsed.filter(p => !p.errors.length);
    if (!ok.length) return;
    const records = ok.map(p => { const o = {}; for (const k in p.rec) if (T.labels[k]) o[T.labels[k]] = p.rec[k]; return o; });
    const btn = $('#impSave'), msg = $('#impMsg');
    btn.disabled = true;
    const added = [];
    try {
      for (let i = 0; i < records.length; i += CHUNK) {
        msg.textContent = `جاري الإدراج في الشيت… ${added.length} / ${records.length}`; msg.className = 'small';
        added.push(...await T.send(records.slice(i, i + CHUNK)));
      }
      $('#impText').value = ''; analyse();
      $('#importDlg').close();
      T.finish(added);
    } catch (e) {
      const outdated = new RegExp(T.action).test(e.message);
      msg.textContent = outdated
        ? '⚠ كود Apps Script المنشور قديم — الصق Code.gs الجديد وانشر «إصدار جديد» (لم يتم إدراج أي شيك)'
        : `⚠ ${e.message}` + (added.length ? ` — تم إدراج ${added.length} شيك قبل الخطأ، اضغط ⟳ تحديث قبل المحاولة مرة أخرى` : '');
      msg.className = 'small err';
      if (added.length) T.finish(added);
    } finally {
      btn.disabled = false;
    }
  }

  function open(target) {
    const t = target || MAIN;
    if (!t.ready()) { App.toast('حمّل البيانات أولاً'); return; }
    if (t !== T) $('#impText').value = '';   // جدول شيت تاني — نبدأ من جديد
    useTarget(t);
    $('#importDlg').showModal();
    analyse();
    $('#impText').focus();
  }

  App.importer = { open, MAIN };

  document.addEventListener('DOMContentLoaded', () => {
    useTarget(MAIN);
    $('#importBtn').addEventListener('click', () => open(MAIN));
    $('#impText').addEventListener('input', App.debounce(analyse, 250));
    $('#impDateFmt').addEventListener('change', analyse);
    $('#impClear').addEventListener('click', () => { $('#impText').value = ''; analyse(); $('#impText').focus(); });
    $('#importForm').addEventListener('submit', save);
  });
})();
