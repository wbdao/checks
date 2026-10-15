/* شاشة شيكات المخازن — عرض وإضافة وتعديل في شيت «شيكات المخازن» */
(function () {
  'use strict';
  const App = window.App, { $, esc } = App;
  // أسماء الأعمدة في شيت المخازن
  const H = {
    wh: 'المخزن', recv: 'تاريخ الاستلام', bank: 'البنك', code: 'كود العميل', name: 'اسم العميل',
    drawer: 'اسم صاحب الشيك', payee: 'اسم المستفيد', checkNo: 'رقم الشيك', amount: 'قيمة الشيك',
    collected: 'التحصيل', net: 'الصافي', due: 'تاريخ الاستحقاق', note1: 'ملاحظات', note: 'بيان',
    state: 'mm', note2: 'ملاحظات2', nature: 'طبيعه الشيك', place: 'مكان الشيك',
    dueState: 'حالة الشيك', lookup: 'Column1', whId: 'WH',
  };
  const COMPUTED = ['net', 'dueState', 'lookup', 'whId'];   // معادلات أو كود تلقائي — لا تُكتب من الموقع
  const PAID = 'خالص';
  let loading = false, list = [], whName = new Map(), raw = null;

  const isPaid = r => r.state === PAID;
  const isReturned = r => /رد/.test(r.state);
  const isOpen = r => !isPaid(r) && !isReturned(r);
  const sumBy = (a, k) => a.reduce((s, r) => s + r[k], 0);

  // اسم المخزن من كود mm: الأكثر تكراراً لنفس الكود في شيت الشيكات الرئيسي
  function buildWhNames() {
    const cnt = new Map();
    App.state.records.forEach(r => {
      const mm = String(r.mm ?? '').trim(); if (!mm || !r.wh) return;
      if (!cnt.has(mm)) cnt.set(mm, new Map());
      const m = cnt.get(mm); m.set(r.wh, (m.get(r.wh) || 0) + 1);
    });
    whName = new Map([...cnt].map(([mm, m]) => [mm, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]]));
  }
  const whLabel = code => { const n = whName.get(code); return n ? `${code} — ${n}` : (code || 'بدون مخزن'); };

  function toRecords(d) {
    const h = d.headers.map(x => String(x).trim());
    const idx = {}; for (const k in H) idx[k] = h.indexOf(H[k]);
    const regNos = new Set(App.state.records.map(r => r.checkNo));
    return d.rows.map((row, i) => {
      const r = { _i: i, _rowNum: d.rowNums ? d.rowNums[i] : null, _row: row };
      for (const k in H) r[k] = idx[k] >= 0 ? row[idx[k]] : '';
      for (const k of ['wh', 'code', 'name', 'bank', 'state', 'checkNo', 'drawer'])
        r[k] = String(r[k] ?? '').trim();
      r.whId = String(r.whId ?? '').trim();
      r.id = r.whId || 'W' + (r._rowNum ?? 'i' + i);   // للتحديد الجماعي: كود WH، أو رقم الصف لو لسه مالوش كود
      r.amountN = App.num(r.amount);
      r.collectedN = App.num(r.collected);
      r.netN = r.net !== '' && typeof r.net === 'number' ? r.net : r.amountN - r.collectedN;
      r.recvD = App.parseDate(r.recv);
      r.dueD = App.parseDate(r.due);
      r.dueState = r.dueD ? (r.dueD <= App.today() ? 'مستحق' : 'تحت التحصيل') : '';
      r.registered = !!r.checkNo && regNos.has(r.checkNo);
      r.notes = [r.note1, r.note, r.note2].map(x => String(x ?? '').trim()).filter(x => x && x !== '#N/A');
      r.search = [r.whId, r.code, r.name, r.drawer, r.payee, r.checkNo, r.bank, whLabel(r.wh), r.state, ...r.notes].join(' ').toLowerCase();
      return r;
    }).filter(r => r.code || r.checkNo || r.amountN);
  }

  async function load() {
    if (loading) return;
    loading = true;
    App.setStatus('جاري تحميل شيت شيكات المخازن…');
    try {
      raw = await App.api('listWh');
      App.state.wh = true;
      App.setStatus('');
      refresh();
    } catch (e) {
      App.state.wh = false;   // فشل — شاشة العملاء ما تعيدش المحاولة لحد ⟳ تحديث
      App.setStatus('⚠ ' + esc(/listWh/.test(e.message)
        ? 'كود Apps Script المنشور قديم — الصق Code.gs الجديد وانشر «إصدار جديد» علشان شيت شيكات المخازن يتقري'
        : 'شيت شيكات المخازن: ' + e.message) + ' <button type="button" class="btn" data-retry="wh">⟳ حاول تاني</button>', true);
      App.statusOwner = App.currentView();
    } finally {
      loading = false;
    }
  }

  function idNotice(all) {
    const hasCol = raw.headers.some(h => String(h).trim() === H.whId);
    const missing = all.filter(r => !r.whId).length;
    const box = $('#whIdNotice');
    if (hasCol && !missing) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    box.innerHTML = hasCol
      ? `<span>🏷 فيه <b>${missing}</b> شيك لسه مالوش كود WH. التعديل عليهم شغال برقم الصف، بس الأفضل يبقى لكل شيك كود ثابت.</span>
         <span class="grow"></span><button class="btn primary" id="whFillBtn">إعطاء كود للشيكات دي</button>`
      : `<span>🏷 عمود <b>WH</b> مش موجود في الصف التاني من شيت المخازن — ضيفه علشان كل شيك ياخد كود ثابت.</span>`;
  }

  async function fillIds() {
    const btn = $('#whFillBtn'); if (btn) btn.disabled = true;
    try {
      const res = await App.api('whFillIds');
      App.toast(`تم إعطاء كود لـ ${res.filled} شيك ✓${res.duplicates && res.duplicates.length ? ' — ⚠ أكواد مكررة: ' + res.duplicates.slice(0, 5).join('، ') : ''}`, 5000);
      App.state.wh = null; render();     // إعادة تحميل الشيت بالأكواد الجديدة
    } catch (e) {
      App.toast('⚠ ' + (/whFillIds/.test(e.message) ? 'كود Apps Script المنشور قديم — الصق Code.gs الجديد وانشر «إصدار جديد»' : e.message), 6000);
      if (btn) btn.disabled = false;
    }
  }

  function kpis(all) {
    const open = all.filter(isOpen), od = open.filter(r => r.dueD && r.dueD <= App.today()), ret = all.filter(isReturned);
    $('#whKpis').innerHTML = [
      ['إجمالي قيمة الشيكات', App.fmt(sumBy(all, 'amountN')), `${all.length} شيك`, ''],
      ['التحصيل', App.fmt(sumBy(all, 'collectedN')), `${all.filter(isPaid).length} شيك خالص`, 'ok'],
      ['الصافي (المتبقي)', App.fmt(sumBy(all, 'netN')), `${open.length} شيك غير خالص`, 'warn'],
      ['متأخر (مستحق وغير خالص)', App.fmt(sumBy(od, 'netN')), `${od.length} شيك`, od.length ? 'bad' : ''],
      ['تم رد الشيك', ret.length, App.fmt(sumBy(ret, 'amountN')), ret.length ? 'warn' : ''],
      ['غير مسجل في شيت الشيكات', all.filter(r => !r.registered).length, 'برقم الشيك', ''],
    ].map(([l, v, s, c]) => `<div class="kpi ${c}"><div class="lbl">${l}</div><div class="val">${v}</div><div class="sub">${s}</div></div>`).join('');
  }

  function summary(all) {
    const t = App.today(), by = new Map();
    all.forEach(r => { if (!by.has(r.wh)) by.set(r.wh, []); by.get(r.wh).push(r); });
    const rows = [...by.entries()].map(([wh, l]) => ({
      wh, n: l.length, amount: sumBy(l, 'amountN'), col: sumBy(l, 'collectedN'), net: sumBy(l, 'netN'),
      open: l.filter(isOpen).length, od: sumBy(l.filter(r => isOpen(r) && r.dueD && r.dueD <= t), 'netN'),
      ret: l.filter(isReturned).length,
    })).sort((a, b) => b.net - a.net || b.amount - a.amount);
    const cur = $('#wWh').value;
    $('#whSumTable thead').innerHTML = '<tr><th>المخزن</th><th>عدد الشيكات</th><th>قيمة الشيكات</th><th>التحصيل</th><th>الصافي</th><th>غير خالص</th><th>متأخر</th><th>تم رد</th></tr>';
    $('#whSumTable tbody').innerHTML = rows.map(x => `
      <tr data-wh="${esc(x.wh)}" style="${x.wh === cur ? 'background:var(--primary-weak)' : ''}">
        <td><b>${esc(whLabel(x.wh))}</b></td><td class="num">${x.n}</td><td class="num">${App.fmt(x.amount)}</td>
        <td class="num">${App.fmt(x.col)}</td><td class="num"><b>${App.fmt(x.net)}</b></td>
        <td>${x.open ? `<span class="badge warn">${x.open}</span>` : ''}</td>
        <td>${x.od ? `<span class="badge bad num">${App.fmt(x.od)}</span>` : ''}</td>
        <td>${x.ret ? `<span class="badge">${x.ret}</span>` : ''}</td></tr>`).join('');
    const keep = $('#wWh').value;
    $('#wWh').innerHTML = '<option value="">كل المخازن</option>' + rows.map(x => `<option value="${esc(x.wh)}">${esc(whLabel(x.wh))}</option>`).join('');
    $('#wWh').value = keep;
  }

  const stateBadge = r => !r.state ? '' :
    `<span class="badge ${isPaid(r) ? 'ok' : isReturned(r) ? 'warn' : r.dueState === 'مستحق' ? 'bad' : 'info'}">${esc(r.state)}</span>`;

  function table(all) {
    const q = $('#wSearch').value.trim().toLowerCase(), terms = q ? q.split(/\s+/) : [];
    const wh = $('#wWh').value, st = $('#wState').value, due = $('#wDue').value;
    const open = $('#wOpen').checked, unreg = $('#wUnreg').checked;
    list = all.filter(r => (!wh || r.wh === wh) && (!st || r.state === st) && (!due || r.dueState === due) &&
      (!open || isOpen(r)) && (!unreg || !r.registered) && terms.every(t => r.search.includes(t)))
      .sort((a, b) => (b.dueD || 0) - (a.dueD || 0));
    $('#whTable thead').innerHTML = `<tr>${App.sel.head()}<th>WH</th><th>المخزن</th><th>العميل</th><th>صاحب الشيك</th><th>البنك / رقم الشيك</th><th>الاستلام</th><th>الاستحقاق</th>
      <th>قيمة الشيك</th><th>التحصيل</th><th>الصافي</th><th>الموقف (mm)</th><th>شيت الشيكات</th><th>ملاحظات / بيان</th></tr>`;
    $('#whTable tbody').innerHTML = list.map(r => `<tr data-i="${r._i}">${App.sel.cell(r)}
      <td class="num">${r.whId ? esc(r.whId) : '<span class="muted small">—</span>'}</td>
      <td>${esc(whLabel(r.wh))}</td>
      <td>${esc(r.name)}<span class="sub">${esc(r.code)}</span></td>
      <td class="small">${esc(r.drawer)}</td>
      <td>${esc(r.bank)}<span class="sub num">${esc(r.checkNo)}</span></td>
      <td class="num">${esc(App.iso(r.recvD) || r.recv)}</td>
      <td><span class="num">${esc(App.iso(r.dueD) || r.due)}</span><span class="sub">${esc(r.dueState)}</span></td>
      <td class="num">${App.fmt(r.amountN)}</td>
      <td class="num">${r.collectedN ? App.fmt(r.collectedN) : ''}</td>
      <td class="num"><b>${r.netN ? App.fmt(r.netN) : '—'}</b></td>
      <td>${stateBadge(r)}</td>
      <td>${r.registered ? '<span class="badge ok">✓ مسجل</span>' : '<span class="badge">غير مسجل</span>'}</td>
      <td class="wrap small">${r.notes.map(esc).join('<br>')}</td></tr>`).join('')
      || '<tr><td colspan="14" class="muted" style="text-align:center;padding:30px">لا توجد شيكات</td></tr>';
    App.sel.sync($('#whTable'), list);
    $('#whFoot').innerHTML = `<span>${list.length} شيك</span><b class="num">قيمة: ${App.fmt(sumBy(list, 'amountN'))} — تحصيل: ${App.fmt(sumBy(list, 'collectedN'))} — صافي: ${App.fmt(sumBy(list, 'netN'))}</b>`;
    $('#whPrintTitle').innerHTML = `<h2>شيكات المخازن${wh ? ' — ' + esc(whLabel(wh)) : ''}</h2>
      <div class="muted">بتاريخ ${App.iso(App.today())} — ${list.length} شيك — صافي ${App.fmt(sumBy(list, 'netN'))}</div>`;
  }

  let records = [];
  // لو الشيت رجّع صفوف ومتقريش منها ولا شيك — نوضح السبب بدل جدول فاضي
  function diagnose() {
    const hs = raw.headers.map(h => String(h).trim()).filter(Boolean);
    const need = ['رقم الشيك', 'كود العميل', 'قيمة الشيك', 'تاريخ الاستحقاق'];
    const missing = need.filter(h => !hs.includes(h));
    const where = raw.headerRow ? `صف العناوين اللي اتقرا: ${raw.headerRow}` : 'الكود المنشور قديم (بيقرا العناوين من الصف التاني دايماً)';
    if (!raw.rows.length) {
      App.setStatus(`⚠ شيت «شيكات المخازن» رجع <b>0 صف</b>. ${where}.`, true); App.statusOwner = 'warehouses';
    } else if (!records.length || missing.length) {
      App.setStatus(`⚠ شيت «شيكات المخازن» رجع <b>${raw.rows.length}</b> صف لكن ${missing.length ? `ناقص أعمدة: <b>${esc(missing.join('، '))}</b>` : 'مفيش ولا شيك اتقرا'}.
        ${where}. العناوين اللي اتقرت: <span class="small">${esc(hs.slice(0, 25).join(' | ') || '(فاضية)')}</span>.
        ${raw.headerRow ? '' : '<br>الحل: الصق Code.gs الجديد وانشر «إصدار جديد» — النسخة الجديدة بتدوّر على صف العناوين لوحدها.'}`, true);
      App.statusOwner = 'warehouses';
    } else if (App.statusOwner === 'warehouses') {
      App.setStatus(''); App.statusOwner = null;
    }
  }

  function prepare() { buildWhNames(); records = toRecords(raw); }
  // بعد التحميل أو الحفظ: لو الشاشة المفتوحة مش شاشة المخازن (زي تحليل العملاء) نحدّثها هي
  const refresh = () => { if (App.currentView() === 'warehouses') render(); else { prepare(); App.render(); } };

  function render() {
    if (!App.state.wh) { load(); return; }
    prepare();
    diagnose();
    const states = [...new Set(records.map(r => r.state).filter(Boolean))];
    App.fillSelect($('#wState'), states);
    idNotice(records); kpis(records); summary(records); table(records); datalists();
  }

  function exportCsv() {
    const head = ['WH', 'المخزن', 'اسم المخزن', 'كود العميل', 'اسم العميل', 'صاحب الشيك', 'البنك', 'رقم الشيك', 'تاريخ الاستلام', 'تاريخ الاستحقاق', 'قيمة الشيك', 'التحصيل', 'الصافي', 'حالة الشيك', 'mm', 'مسجل في شيت الشيكات', 'ملاحظات'];
    const lines = [head, ...list.map(r => [r.whId, r.wh, whName.get(r.wh) || '', r.code, r.name, r.drawer, r.bank, r.checkNo, App.iso(r.recvD), App.iso(r.dueD),
      r.amountN, r.collectedN, r.netN, r.dueState, r.state, r.registered ? 'نعم' : 'لا', r.notes.join(' | ')])];
    const csv = '﻿' + lines.map(l => l.map(v => { const x = String(v ?? ''); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; }).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `warehouse-checks-${App.iso(new Date())}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ===== إضافة / تعديل =====
  const FORM = [
    ['بيانات العميل', [
      ['code', 'text', { req: true, list: 'dl-codes' }], ['name', 'text', { req: true, list: 'dl-names' }],
      ['wh', 'text', { req: true, list: 'dl-whcodes', hint: 'كود المخزن' }],
    ]],
    ['بيانات الشيك', [
      ['checkNo', 'text', { req: true }], ['bank', 'text', { req: true, list: 'dl-bank' }],
      ['amount', 'number', { req: true }], ['collected', 'number', {}], ['net', 'text', { readonly: true, hint: 'يُحسب تلقائياً' }],
      ['recv', 'date', { req: true }], ['due', 'date', { req: true }], ['dueState', 'text', { readonly: true, hint: 'يُحسب تلقائياً' }],
      ['drawer', 'text', { list: 'dl-drawer' }], ['payee', 'text', { list: 'dl-payee' }],
    ]],
    ['المتابعة', [
      ['state', 'text', { list: 'dl-whstate', hint: 'خالص / NN / تم رد الشيك' }], ['nature', 'text', {}], ['place', 'text', {}],
    ]],
    ['ملاحظات', [['note1', 'textarea', { wide: true }], ['note', 'textarea', { wide: true }], ['note2', 'textarea', { wide: true }]]],
  ];
  let editing = null;
  const el = k => $('#whForm').elements[k];
  const asInput = (k, type, r) => {
    if (type === 'date') return App.iso(App.parseDate(r[k])) || '';
    if (type === 'number') return r[k] === '' || r[k] == null ? '' : App.num(r[k]);
    return String(r[k] ?? '').trim() === '#N/A' ? '' : String(r[k] ?? '');
  };

  function buildForm() {
    $('#whFormBody').innerHTML = FORM.map(([title, fields]) => `
      <fieldset class="fieldset"><legend>${title}</legend><div class="fgrid">
        ${fields.map(([k, type, o]) => {
          const attrs = `name="${k}" ${o.list ? `list="${o.list}"` : ''} ${o.readonly ? 'readonly tabindex="-1"' : ''} ${o.req ? 'required' : ''} autocomplete="off"`;
          const input = type === 'textarea' ? `<textarea ${attrs}></textarea>` : `<input type="${type}" ${type === 'number' ? 'step="any" min="0"' : ''} ${attrs}>`;
          return `<label class="field ${o.req ? 'req' : ''} ${o.wide ? 'wide' : ''}"><span>${esc(H[k])}${o.hint ? ` <i class="muted">(${o.hint})</i>` : ''}</span>${input}</label>`;
        }).join('')}
      </div></fieldset>`).join('');
    const recalc = () => {
      el('net').value = App.fmt(App.num(el('amount').value) - App.num(el('collected').value));
      const d = App.parseDate(el('due').value);
      el('dueState').value = d ? (d <= App.today() ? 'مستحق' : 'تحت التحصيل') : '';
    };
    ['amount', 'collected', 'due'].forEach(k => el(k).addEventListener('input', recalc));
    el('code').addEventListener('change', () => {
      const c = App.customers.get(el('code').value.trim()); if (!c) return;
      el('name').value = c.name;
      if (!el('wh').value && c.mm) el('wh').value = c.mm;
    });
    el('name').addEventListener('change', () => {
      if (el('code').value) return;
      const c = [...App.customers.values()].find(c => c.name === el('name').value.trim());
      if (c) { el('code').value = c.code; if (!el('wh').value && c.mm) el('wh').value = c.mm; }
    });
    recalcForm = recalc;
  }
  let recalcForm = () => {};

  function datalists() {
    const host = $('#datalists'); if (!host) return;
    ['dl-whcodes', 'dl-whstate'].forEach(id => host.querySelector('#' + id)?.remove());
    const codes = [...new Set([...whName.keys(), ...records.map(r => r.wh)].filter(Boolean))].sort((a, b) => a - b);
    const states = [...new Set(['خالص', 'NN', 'تم رد الشيك', ...records.map(r => r.state)].filter(Boolean))];
    host.insertAdjacentHTML('beforeend',
      `<datalist id="dl-whcodes">${codes.map(c => `<option value="${esc(c)}">${esc(whName.get(c) || '')}</option>`).join('')}</datalist>` +
      `<datalist id="dl-whstate">${states.map(c => `<option value="${esc(c)}"></option>`).join('')}</datalist>`);
  }

  function openForm(rec, preset) {
    editing = rec || null;
    const f = $('#whForm'); f.reset();
    $('#whFormMsg').textContent = ''; $('#whFormMsg').className = 'small';
    const src = rec || preset || {};
    for (const [, fields] of FORM) for (const [k, type] of fields) el(k).value = asInput(k, type, src);
    if (!rec) { if (!src.recv) el('recv').value = App.iso(App.today()); if (!src.state) el('state').value = 'NN'; }
    recalcForm();
    $('#whDlgTitle').textContent = rec ? `تعديل ${rec.whId || 'شيك'} — رقم الشيك ${rec.checkNo}${rec.whId ? '' : ` (صف ${rec._rowNum})`}` : 'إضافة شيك — شيكات المخازن (الكود هيتولد تلقائياً)';
    $('#whDupBtn').classList.toggle('hidden', !rec);
    $('#whHistBtn').classList.toggle('hidden', !(rec && rec.whId));
    $('#whDlg').showModal();
    (rec ? el('state') : el('code')).focus();
  }

  function readForm() {
    const out = {};
    for (const [, fields] of FORM) for (const [k, type, o] of fields) {
      if (o.readonly) continue;
      let v = el(k).value.trim();
      if (type === 'number') v = v === '' ? '' : Number(v);
      out[k] = v;
    }
    return out;
  }

  // رقم الشيك زي ما هو في الشيت (السيرفر بيتأكد إن الصف لسه فيه نفس الرقم قبل التعديل)
  const sheetCheckNo = r => String(r._row[raw.headers.map(h => String(h).trim()).indexOf(H.checkNo)] ?? '').trim();

  // الشيك اللي ليه كود بيتعدّل بالكود؛ اللي لسه مالوش بيتعدّل برقم الصف بعد التأكد من رقم الشيك
  const whTarget = (r, record) => r.whId ? { id: r.whId, record } : { row: r._rowNum, match: sheetCheckNo(r), record };

  async function saveForm(ev) {
    ev.preventDefault();
    const data = readForm(), msg = $('#whFormMsg');
    if (!(data.amount > 0)) { msg.textContent = 'قيمة الشيك يجب أن تكون أكبر من صفر'; msg.className = 'small err'; return; }
    if (App.num(data.collected) > App.num(data.amount)) { msg.textContent = 'التحصيل أكبر من قيمة الشيك'; msg.className = 'small err'; return; }
    const dup = records.find(r => r !== editing && r.checkNo === String(data.checkNo) && r.bank === data.bank);
    if (dup && msg.dataset.confirmDup !== String(dup._rowNum)) {
      msg.textContent = `⚠ رقم الشيك موجود بالفعل لنفس البنك (صف ${dup._rowNum} — ${dup.name}). اضغط حفظ مرة أخرى للتأكيد.`;
      msg.className = 'small warn'; msg.dataset.confirmDup = dup._rowNum; return;
    }
    delete msg.dataset.confirmDup;

    // في التعديل نبعت الخانات اللي اتغيرت بس (علشان معادلات زي «التحصيل = 50000+300000» ما تتحولش لأرقام من غير داعي)
    const record = {};
    for (const [, fields] of FORM) for (const [k, type, o] of fields) {
      if (o.readonly) continue;
      if (editing && String(asInput(k, type, editing)) === String(data[k])) continue;
      record[H[k]] = data[k];
    }
    if (editing && !Object.keys(record).length) { $('#whDlg').close(); return; }
    const btn = $('#whSaveBtn'); btn.disabled = true; msg.textContent = 'جاري الحفظ في الشيت…'; msg.className = 'small';
    try {
      const res = editing
        ? await App.api('whUpdate', { updates: [whTarget(editing, record)] })
        : await App.api('whAdd', { records: [record] });
      applyResult(res);
      $('#whDlg').close();
      App.toast(editing ? `تم حفظ التعديل (صف ${res.rowNums[0]}) ✓` : `تمت إضافة الشيك في صف ${res.rowNums[0]} ✓`);
      refresh();
    } catch (e) {
      msg.textContent = /whAdd|whUpdate/.test(e.message)
        ? '⚠ كود Apps Script المنشور قديم — الصق Code.gs الجديد وانشر «إصدار جديد»'
        : '⚠ ' + e.message;
      msg.className = 'small err';
    } finally { btn.disabled = false; }
  }

  // تحديث النسخة المحلية من الشيت بالصفوف اللي رجعت من السيرفر
  function applyResult(res) {
    if (!raw.rowNums) raw.rowNums = [];
    res.rowNums.forEach((n, j) => {
      const at = raw.rowNums.indexOf(n);
      if (at >= 0) raw.rows[at] = res.rows[j];
      else { raw.rows.push(res.rows[j]); raw.rowNums.push(n); }
    });
  }

  // هدف الإدراج من جدول لشيت المخازن
  const IMPORT = {
    title: 'إدراج شيكات من جدول — شيكات المخازن',
    labels: H,
    aliases: {
      'اسم العميل سيستم': 'name', 'العميل': 'name', 'الكود': 'code', 'رقم شيك': 'checkNo', 'بنك': 'bank', 'القيمة': 'amount',
      'المبلغ': 'amount', 'الاستحقاق': 'due', 'الاستلام': 'recv', 'شيك بأسم': 'drawer', 'صاحب الشيك': 'drawer',
      'الموقف': 'state', 'دفعات شيكات': 'collected', 'صافى الشيك': 'net', 'صافي الشيك': 'net',
    },
    computed: COMPUTED,
    required: ['code', 'name', 'wh', 'checkNo', 'bank', 'amount', 'due'],
    dates: ['recv', 'due'],
    numbers: ['amount', 'collected'],
    minus: 'collected',
    show: ['wh', 'code', 'name', 'drawer', 'checkNo', 'bank', 'amount', 'collected', 'recv', 'due', 'state'],
    display: (k, v) => k === 'wh' ? whLabel(String(v ?? '')) : (v ?? ''),
    action: 'whAdd',
    ready: () => !!App.state.wh,
    headers: () => raw.headers,
    existing: () => new Set(records.map(r => r.checkNo + '|' + r.bank)),
    complete(rec, warns, today) {
      const cust = rec.code ? App.customers.get(rec.code) : [...App.customers.values()].find(c => c.name === rec.name);
      if (cust) {
        if (!rec.code) rec.code = cust.code;
        if (!rec.name) rec.name = cust.name;
        if (!rec.wh && cust.mm) rec.wh = String(cust.mm);
      } else if (rec.code) warns.push('عميل جديد');
      if (!rec.recv) rec.recv = today;
      if (!rec.state) rec.state = 'NN';
      if (rec.checkNo !== undefined) rec.checkNo = String(rec.checkNo);
    },
    check(rec, errors) { if (App.num(rec.collected) > App.num(rec.amount)) errors.push('التحصيل أكبر من قيمة الشيك'); },
    async send(recs) {
      const res = await App.api('whAdd', { records: recs });
      applyResult(res);
      return res.rowNums;
    },
    finish(rows) {
      App.toast(`تم إدراج ${rows.length} شيك في شيت المخازن ✓ (صفوف ${rows[0]} → ${rows[rows.length - 1]})`, 4000);
      render();
    },
  };

  // سياق التعديل الجماعي لشيت المخازن
  App.sel.register('warehouses', {
    title: 'شيكات المخازن',
    labels: H,
    display: { state: 'mm (الموقف)' },
    fields: [
      ['state', 'text', 'dl-whstate'], ['note', 'text'], ['note1', 'text'], ['note2', 'text'],
      ['place', 'text'], ['nature', 'text'], ['due', 'date'], ['wh', 'text', 'dl-whcodes'],
      ['payee', 'text', 'dl-payee'], ['bank', 'text', 'dl-bank'],
    ],
    texts: ['note', 'note1', 'note2'],
    first: () => 'state',
    idHead: 'WH / رقم الشيك',
    idOf: r => `${r.whId || 'صف ' + r._rowNum} / ${r.checkNo}`,
    action: 'whUpdate',
    byId: id => records.find(r => r.id === id),
    async send(items) {
      const res = await App.api('whUpdate', { updates: items.map(u => whTarget(u.r, u.record)) });
      applyResult(res);
      return res.rows.length;
    },
    finish: () => render(),
  });

  App.views.warehouses = {
    render,
    // لشاشة تحليل العملاء: شيكات المخازن جاهزة للقراءة + فتح نافذة التعديل
    shared: {
      state: () => App.state.wh === true ? 'ready' : App.state.wh === false ? 'failed' : 'loading',
      ensure: () => { if (App.state.wh == null) load(); },
      records: () => records,
      whName: code => whName.get(code) || '',
      isPaid, isReturned, isOpen, stateBadge, openForm,
    },
    init() {
      const re = () => { summary(records); table(records); };
      $('#wSearch').addEventListener('input', App.debounce(re));
      ['#wWh', '#wState', '#wDue', '#wOpen', '#wUnreg'].forEach(s => $(s).addEventListener('change', re));
      $('#wReset').addEventListener('click', () => {
        ['#wSearch', '#wWh', '#wState', '#wDue'].forEach(s => $(s).value = '');
        $('#wOpen').checked = false; $('#wUnreg').checked = false; re();
      });
      $('#whSumTable tbody').addEventListener('click', e => {
        const tr = e.target.closest('tr[data-wh]'); if (!tr) return;
        $('#wWh').value = $('#wWh').value === tr.dataset.wh ? '' : tr.dataset.wh; re();
      });
      $('#wExport').addEventListener('click', exportCsv);
      $('#wPrint').addEventListener('click', () => window.print());
      const shareCfg = () => ({
        title: $('#wWh').value ? `شيكات المخازن — ${whLabel($('#wWh').value)}` : 'شيكات المخازن', file: 'warehouse-checks', rows: list,
        cols: [
          ['WH', r => r.whId], ['المخزن', r => whLabel(r.wh)], ['العميل', r => r.name], ['البنك', r => r.bank], ['رقم الشيك', r => r.checkNo],
          ['قيمة الشيك', r => App.fmt(r.amountN), { sum: r => r.amountN, num: true }], ['الصافي', r => App.fmt(r.netN), { sum: r => r.netN, num: true }],
          ['الاستحقاق', r => App.iso(r.dueD) || r.due], ['الموقف (mm)', r => r.state],
        ],
      });
      $('#wShare').addEventListener('click', () => App.share.open(shareCfg()));
      $('#wCopy').addEventListener('click', () => App.share.copyTable(shareCfg()));
      buildForm();
      $('#whForm').addEventListener('submit', saveForm);
      $('#whDupBtn').addEventListener('click', () => { const d = readForm(); d.checkNo = ''; openForm(null, d); });
      $('#whHistBtn').addEventListener('click', () => editing && editing.whId && App.showHistory(editing.whId, `${editing.whId} — ${editing.name} — رقم الشيك ${editing.checkNo}`));
      $('#wAdd').addEventListener('click', () => App.state.wh ? openForm(null) : App.toast('حمّل البيانات أولاً'));
      $('#wImport').addEventListener('click', () => App.importer.open(IMPORT));
      App.sel.bind($('#whTable'), () => list);
      $('#whIdNotice').addEventListener('click', e => { if (e.target.id === 'whFillBtn') fillIds(); });
      $('#whTable tbody').addEventListener('click', e => {
        const i = e.target.closest('tr')?.dataset.i; if (i === undefined) return;
        const r = records.find(x => x._i === +i); if (r) openForm(r);
      });
    },
  };
})();
