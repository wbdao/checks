/* شاشة الشيكات: بحث وفلاتر وجدول وتعديل */
(function () {
  'use strict';
  const App = window.App, { $, esc, F } = App;
  const PAGE = 50;

  const COLS = [
    { k: 'id', t: 'NN', v: r => esc(r.id), sort: r => r.id },
    { k: 'due', t: 'الاستحقاق', v: r => `<span class="num">${esc(App.iso(r.dueD) || r.due)}</span><span class="sub">${esc(r.dueState)}</span>`, sort: r => r.dueD ? +r.dueD : 0 },
    { k: 'name', t: 'العميل', v: r => `${esc(r.name)}<span class="sub">${esc(r.code)}</span>`, sort: r => r.name },
    { k: 'wh', t: 'المخزن', v: r => esc(r.wh), sort: r => r.wh },
    { k: 'bank', t: 'البنك / رقم الشيك', v: r => `${esc(r.bank)}<span class="sub num">${esc(r.checkNo)}</span>`, sort: r => r.bank },
    { k: 'net', t: 'الصافي', v: r => `<b class="num">${App.fmt(r.netN)}</b>${r.paidN ? `<span class="sub num">من ${App.fmt(r.amountN)}</span>` : ''}`, sort: r => r.netN },
    { k: 'cashState', t: 'حالة الصرف', v: r => App.cashBadge(r), sort: r => r.cashState },
    { k: 'status', t: 'الحاله', v: r => App.statusBadge(r), sort: r => r.status },
    { k: 'position', t: 'موقف الشيك', v: r => esc(r.position), sort: r => r.position },
    { k: 'note', t: 'بيان / تذكير', v: r => `<span class="small">${esc(String(r.note || '').slice(0, 80))}</span>${r.remind ? `<span class="sub">🔔 ${esc(String(r.remind).slice(0, 60))}</span>` : ''}`, cls: 'wrap' },
  ];

  let sortKey = 'due', sortAsc = false, page = 0, filtered = [];
  const colF = {};   // فلتر الشيت: مفتاح العمود → Set من القيم المسموحة
  const EMPTY = '(فارغ)';
  const DATE_KEYS = ['recv', 'due', 'outDate'];
  const valOf = (r, k) => {
    const v = DATE_KEYS.includes(k) ? (App.iso(App.parseDate(r[k])) || String(r[k] ?? '').trim()) : String(r[k] ?? '').trim();
    return v || EMPTY;
  };
  const passCols = (r, except) => Object.keys(colF).every(k => k === except || colF[k].has(valOf(r, k)));

  function readFilters() {
    return {
      q: $('#fSearch').value.trim().toLowerCase(), wh: $('#fWh').value, status: $('#fStatus').value,
      cash: $('#fCash').value, due: $('#fDue').value, from: App.parseDate($('#fFrom').value), to: App.parseDate($('#fTo').value),
      open: $('#fOpen').checked,
    };
  }

  function apply() {
    const f = readFilters();
    const terms = f.q ? f.q.split(/\s+/) : [];
    filtered = App.state.records.filter(r =>
      (!f.wh || r.wh === f.wh) && (!f.status || r.status === f.status) && (!f.cash || r.cashState === f.cash) &&
      (!f.due || r.dueState === f.due) && (!f.open || !r.isPaid) &&
      (!f.from || (r.dueD && r.dueD >= f.from)) && (!f.to || (r.dueD && r.dueD <= f.to)) &&
      terms.every(t => r.search.includes(t)) && passCols(r));
    const col = COLS.find(c => c.k === sortKey);
    if (col && col.sort) {
      filtered.sort((a, b) => { const x = col.sort(a), y = col.sort(b); return (x > y ? 1 : x < y ? -1 : 0) * (sortAsc ? 1 : -1); });
    }
  }

  function kpis() {
    const t = App.today(), open = filtered.filter(r => !r.isPaid);
    const overdue = open.filter(r => r.dueD && r.dueD <= t);
    const week = new Date(t); week.setDate(week.getDate() + 7);
    const soon = open.filter(r => r.dueD && r.dueD > t && r.dueD <= week);
    const sum = a => a.reduce((s, r) => s + r.netN, 0);
    $('#checksKpis').innerHTML = [
      ['عدد الشيكات', filtered.length.toLocaleString('en-US'), `إجمالي ${App.fmtShort(sum(filtered))}`, ''],
      ['رصيد غير خالص', App.fmt(sum(open)), `${open.length} شيك`, 'warn'],
      ['متأخر (مستحق وغير خالص)', App.fmt(sum(overdue)), `${overdue.length} شيك`, 'bad'],
      ['يستحق خلال 7 أيام', App.fmt(sum(soon)), `${soon.length} شيك`, ''],
    ].map(([l, v, s, c]) => `<div class="kpi ${c}"><div class="lbl">${l}</div><div class="val">${v}</div><div class="sub">${s}</div></div>`).join('');
  }

  function table() {
    const th = App.sel.head() + COLS.map(c => `<th data-k="${c.k}" class="${c.k === sortKey ? 'sorted' + (sortAsc ? ' asc' : '') : ''}">${c.t}</th>`).join('');
    $('#checksTable thead').innerHTML = `<tr>${th}</tr>`;
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
    if (page >= pages) page = pages - 1;
    const slice = filtered.slice(page * PAGE, page * PAGE + PAGE);
    $('#checksTable tbody').innerHTML = slice.length
      ? slice.map(r => `<tr data-id="${esc(r.id)}">${App.sel.cell(r)}${COLS.map(c => `<td class="${c.cls || ''}">${c.v(r)}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${COLS.length + 1}" class="muted" style="text-align:center;padding:30px">لا توجد نتائج</td></tr>`;
    // الإجمالي: كل الشيكات بعد الفلتر (مش الصفحة الظاهرة بس)، تحت عمود الصافي
    const ni = COLS.findIndex(c => c.k === 'net');
    const net = filtered.reduce((s, r) => s + r.netN, 0), amount = filtered.reduce((s, r) => s + r.amountN, 0);
    $('#checksTable tfoot').innerHTML = filtered.length ? `<tr class="total-row">
      <td colspan="${ni + 1}" data-label="">الإجمالي <span class="muted small">(${filtered.length.toLocaleString('en-US')} شيك${filtered.length > PAGE ? ' — كل الصفحات' : ''})</span></td>
      <td data-label="الصافي"><b class="num">${App.fmt(net)}</b>${Math.round(amount) !== Math.round(net) ? `<span class="sub num">من ${App.fmt(amount)}</span>` : ''}</td>
      <td colspan="${COLS.length - ni - 1}" data-label=""></td></tr>` : '';
    $('#checksPager').innerHTML = `<span>${filtered.length ? `${page * PAGE + 1}–${Math.min(filtered.length, (page + 1) * PAGE)} من ${filtered.length.toLocaleString('en-US')}` : ''}</span>
      <span class="btns"><button class="btn ghost" data-p="-1" ${page ? '' : 'disabled'}>السابق</button>
      <span>صفحة ${page + 1} / ${pages}</span>
      <button class="btn ghost" data-p="1" ${page < pages - 1 ? '' : 'disabled'}>التالي</button></span>`;
    App.sel.sync($('#checksTable'), filtered);
  }

  function render() {
    App.fillSelect($('#fWh'), App.lists.wh);
    App.fillSelect($('#fStatus'), App.lists.status);
    App.fillSelect($('#fCash'), App.lists.cash);
    apply(); kpis(); table(); chips();
  }

  // ===== فلتر الشيت =====
  function chips() {
    const ks = Object.keys(colF);
    $('#colChips').classList.toggle('hidden', !ks.length);
    $('#colChips').innerHTML = ks.map(k => {
      const vals = [...colF[k]];
      return `<span class="chip" data-k="${k}" title="تعديل الفلتر"><span><b>${esc(F[k])}:</b> ${esc(vals.slice(0, 2).join('، '))}${vals.length > 2 ? ` +${vals.length - 2}` : ''}</span><button type="button" class="rm" data-rm="${k}" title="إزالة">✕</button></span>`;
    }).join('');
  }

  let cfDraft = new Set(), cfLast = 'position';   // آخر عمود تم اختياره
  function cfOpen(k) {
    const sel = $('#cfCol');
    if (!sel.options.length) sel.innerHTML = Object.keys(F).map(x => `<option value="${x}">${esc(F[x])}</option>`).join('');
    sel.value = k || cfLast;
    cfLoad();
    $('#colFilterDlg').showModal();
    $('#cfSearch').focus();
  }
  function cfLoad() {
    const k = cfLast = $('#cfCol').value;
    cfDraft = new Set(colF[k] || []);
    $('#cfSearch').value = '';
    cfList();
  }
  // القيم المتاحة = من الشيكات اللي بتعدي باقي الفلاتر (زي فلتر إكسل)
  function cfValues() {
    const k = $('#cfCol').value, keep = colF[k];
    delete colF[k];
    const saved = filtered; apply(); const base = filtered.filter(r => passCols(r, k)); filtered = saved;
    if (keep) colF[k] = keep;
    const m = new Map();
    base.forEach(r => { const v = valOf(r, k); m.set(v, (m.get(v) || 0) + 1); });
    cfDraft.forEach(v => { if (!m.has(v)) m.set(v, 0); });
    return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'ar'));
  }
  function cfList() {
    const q = $('#cfSearch').value.trim().toLowerCase();
    const all = cfValues(), vals = all.filter(([v]) => !q || String(v).toLowerCase().includes(q));
    const LIMIT = 400;
    $('#cfList').innerHTML = vals.slice(0, LIMIT).map(([v, n]) =>
      `<label><input type="checkbox" value="${esc(v)}" ${cfDraft.has(v) ? 'checked' : ''}> <span>${esc(v)}</span><span class="cnt">${n}</span></label>`).join('')
      || '<div class="muted small" style="padding:10px">لا توجد قيم</div>';
    $('#cfInfo').textContent = `${all.length} قيمة مختلفة${vals.length > LIMIT ? ` — يظهر أول ${LIMIT}، استخدم البحث` : ''} — محدد ${cfDraft.size}`;
  }
  function cfApply(ev) {
    ev.preventDefault();
    const k = $('#cfCol').value;
    if (cfDraft.size) colF[k] = new Set(cfDraft); else delete colF[k];
    $('#colFilterDlg').close();
    page = 0; apply(); kpis(); table(); chips();
  }

  function exportCsv() {
    const H = App.state.headers;
    const idx = App.colIndex();
    const lines = [H.map(h => String(h).trim())].concat(filtered.map(r => {
      const row = r._row.slice();
      if (idx.dueState >= 0) row[idx.dueState] = r.dueState;
      return row;
    }));
    const csv = '﻿' + lines.map(l => l.map(v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `checks-${App.iso(new Date())}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  App.views.checks = {
    render,
    init() {
      const rerender = () => { page = 0; apply(); kpis(); table(); };
      $('#fSearch').addEventListener('input', App.debounce(rerender));
      ['#fWh', '#fStatus', '#fCash', '#fDue', '#fFrom', '#fTo', '#fOpen'].forEach(s => $(s).addEventListener('change', rerender));
      $('#fReset').addEventListener('click', () => {
        Object.keys(colF).forEach(k => delete colF[k]); chips();
        ['#fSearch', '#fWh', '#fStatus', '#fCash', '#fDue', '#fFrom', '#fTo'].forEach(s => $(s).value = '');
        $('#fOpen').checked = false; rerender();
      });
      $('#checksTable thead').addEventListener('click', e => {
        const k = e.target.closest('th')?.dataset.k; if (!k || !COLS.find(c => c.k === k).sort) return;
        if (k === sortKey) sortAsc = !sortAsc; else { sortKey = k; sortAsc = k !== 'net' && k !== 'due'; }
        apply(); table();
      });
      $('#checksTable tbody').addEventListener('click', e => {
        const id = e.target.closest('tr')?.dataset.id; if (!id) return;
        App.openForm(App.state.records.find(r => r.id === id));
      });
      $('#checksPager').addEventListener('click', e => {
        const d = +e.target.dataset.p; if (!d) return; page += d; table();
        $('#checksTable').closest('.table-wrap').scrollTop = 0;
      });
      $('#addBtn').addEventListener('click', () => App.openForm(null));
      App.sel.bind($('#checksTable'), () => filtered);
      $('#colFilterBtn').addEventListener('click', () => cfOpen());
      $('#cfCol').addEventListener('change', cfLoad);
      $('#cfSearch').addEventListener('input', App.debounce(cfList, 120));
      $('#cfList').addEventListener('change', e => { const v = e.target.value; e.target.checked ? cfDraft.add(v) : cfDraft.delete(v); $('#cfInfo').textContent = $('#cfInfo').textContent.replace(/محدد \d+/, 'محدد ' + cfDraft.size); });
      $('#cfAll').addEventListener('click', () => { $('#cfList').querySelectorAll('input').forEach(i => { i.checked = true; cfDraft.add(i.value); }); cfList(); });
      $('#cfNone').addEventListener('click', () => { cfDraft.clear(); cfList(); });
      $('#cfRemove').addEventListener('click', () => { delete colF[$('#cfCol').value]; $('#colFilterDlg').close(); page = 0; apply(); kpis(); table(); chips(); });
      $('#colFilterForm').addEventListener('submit', cfApply);
      $('#colChips').addEventListener('click', e => {
        const rm = e.target.closest('[data-rm]');
        if (rm) { delete colF[rm.dataset.rm]; page = 0; apply(); kpis(); table(); chips(); return; }
        const c = e.target.closest('.chip'); if (c) cfOpen(c.dataset.k);
      });
      $('#exportBtn').addEventListener('click', exportCsv);
      const shareCfg = () => ({
        title: 'الشيكات', file: 'checks', rows: filtered,
        cols: [
        ['NN', r => r.id], ['العميل', r => r.name], ['البنك', r => r.bank], ['رقم الشيك', r => r.checkNo],
        ['صافى الشيك', r => App.fmt(r.netN), { sum: r => r.netN, num: true }], ['الاستحقاق', r => App.iso(r.dueD) || r.due],
        ['الحاله', r => r.status], ['موقف الشيك', r => r.position], ['حالة الصرف', r => r.cashState],
        ],
      });
      $('#shareBtn').addEventListener('click', () => App.share.open(shareCfg()));
      $('#copyBtn').addEventListener('click', () => App.share.copyTable(shareCfg()));
    },
    // يُستخدم من شاشة العملاء لفتح الشيكات بفلتر عميل
    showCustomer(code) { $('#fSearch').value = code; location.hash = '#checks'; },
  };
})();
