/* شاشة شيكات بالخزنة: Pivot بالمورد المتوقع × سنة/شهر الاستحقاق */
(function () {
  'use strict';
  const App = window.App, { $, esc } = App;
  const STATUSES = ['متابعة', 'متابعة بنك', 'عهد تحصيل'];
  const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const EMPTY = '(فارغ)', NODATE = 'بدون تاريخ';

  const active = new Set(STATUSES);
  let drill = null;          // { sup, y, m } — الخلية المختارة (null في أي جزء = الكل)
  let list = [];             // شيكات الخلية المختارة
  let pivotCache = null;     // لتصدير CSV
  let scrollToNow = true;    // عند فتح الشاشة أو تغيير الفلاتر

  const supOf = r => String(r.supplier ?? '').trim().replace(/\s+/g, ' ') || EMPTY;
  const yOf = r => r.dueD ? String(r.dueD.getFullYear()) : NODATE;
  const mOf = r => r.dueD ? r.dueD.getMonth() + 1 : 0;
  const measure = () => $('#trMeasure').value;
  const val = r => measure() === 'count' ? 1 : measure() === 'amount' ? r.amountN : r.netN;
  const fmt = v => !v ? '' : measure() === 'count' ? String(v) : App.fmt(v);
  const sum = a => a.reduce((s, r) => s + r.netN, 0);

  function base() {
    const wh = $('#trWh').value;
    return App.state.records.filter(r => active.has(r.status) && (!wh || r.wh === wh));
  }

  function toggles() {
    const all = App.state.records;
    $('#trStatuses').innerHTML = STATUSES.map(s => {
      const n = all.filter(r => r.status === s).length;
      return `<label class="tog ${active.has(s) ? 'on' : ''}"><input type="checkbox" value="${esc(s)}" ${active.has(s) ? 'checked' : ''}> ${esc(s)} <span class="cnt">${n}</span></label>`;
    }).join('');
  }

  function kpis(recs) {
    const t = App.today(), y = t.getFullYear(), m = t.getMonth();
    const next = new Date(y, m + 1, 1);
    const overdue = recs.filter(r => r.dueD && r.dueD <= t);
    const thisM = recs.filter(r => r.dueD && r.dueD > t && r.dueD.getFullYear() === y && r.dueD.getMonth() === m);
    const nextM = recs.filter(r => r.dueD && r.dueD.getFullYear() === next.getFullYear() && r.dueD.getMonth() === next.getMonth());
    $('#trKpis').innerHTML = [
      ['إجمالي الشيكات بالخزنة', App.fmt(sum(recs)), `${recs.length} شيك`, 'warn'],
      ['مستحق (تاريخه عدّى)', App.fmt(sum(overdue)), `${overdue.length} شيك`, overdue.length ? 'bad' : ''],
      [`باقي ${MONTHS[m]}`, App.fmt(sum(thisM)), `${thisM.length} شيك`, ''],
      [`${MONTHS[next.getMonth()]} ${next.getFullYear()}`, App.fmt(sum(nextM)), `${nextM.length} شيك`, ''],
    ].map(([l, v, s, c]) => `<div class="kpi ${c}"><div class="lbl">${l}</div><div class="val">${v}</div><div class="sub">${s}</div></div>`).join('');
  }

  function pivot(recs) {
    const byMonth = $('#trGrain').value === 'month';
    const t = App.today(), curY = t.getFullYear(), curM = t.getMonth() + 1;

    // الأعمدة: السنين (والشهور الموجودة في كل سنة)
    const years = [...new Set(recs.map(yOf))].sort((a, b) => a === NODATE ? 1 : b === NODATE ? -1 : a - b);
    const monthsOf = {};
    years.forEach(y => { monthsOf[y] = [...new Set(recs.filter(r => yOf(r) === y).map(mOf))].sort((a, b) => a - b); });

    // التجميع
    const cell = {}, add = (k, v) => { cell[k] = (cell[k] || 0) + v; };
    recs.forEach(r => {
      const s = supOf(r), y = yOf(r), m = mOf(r), v = val(r);
      add(`${s}|${y}|${m}`, v); add(`${s}|${y}|`, v); add(`${s}||`, v);
      add(`*|${y}|${m}`, v); add(`*|${y}|`, v); add('*||', v);
    });
    const sups = [...new Set(recs.map(supOf))].sort((a, b) => (cell[`${b}||`] || 0) - (cell[`${a}||`] || 0));

    const cls = (y, m) => {
      if (y === NODATE || !m) return '';
      const n = +y * 12 + m, c = curY * 12 + curM;
      return n < c ? 'past' : n === c ? 'cur' : '';
    };
    const isActive = (s, y, m) => drill && drill.sup === s && drill.y === y && drill.m === m;
    const td = (s, y, m, extra = '') => {
      const v = cell[`${s}|${y}|${m}`];
      return `<td class="v ${extra} ${isActive(s, y, m) ? 'active' : ''}" data-s="${esc(s)}" data-y="${esc(y)}" data-m="${m}">${fmt(v)}</td>`;
    };

    let head, colsOf;
    if (byMonth) {
      head = `<tr><th class="rowh" rowspan="2">المورد المتوقع</th>${years.map(y =>
        `<th colspan="${monthsOf[y].length + (y === NODATE ? 0 : 1)}">${esc(y)}</th>`).join('')}<th rowspan="2" class="gt">الإجمالي</th></tr>
        <tr>${years.map(y => y === NODATE ? '<th>—</th>' : monthsOf[y].map(m => `<th class="${cls(y, m)}" title="${MONTHS[m - 1]} ${y}${cls(y, m) === 'past' ? ' — شهر عدّى' : ''}">${MONTHS[m - 1]}</th>`).join('') + `<th class="yt">إجمالي ${esc(y)}</th>`).join('')}</tr>`;
      colsOf = s => years.map(y => y === NODATE ? td(s, y, 0)
        : monthsOf[y].map(m => td(s, y, m, cls(y, m))).join('') + td(s, y, '', 'yt')).join('') + td(s, '', '', 'gt');
    } else {
      head = `<tr><th class="rowh">المورد المتوقع</th>${years.map(y => `<th>${esc(y)}</th>`).join('')}<th class="gt">الإجمالي</th></tr>`;
      colsOf = s => years.map(y => td(s, y, y === NODATE ? 0 : '', '')).join('') + td(s, '', '', 'gt');
    }
    $('#trPivot').innerHTML = `<thead>${head}</thead>
      <tbody>${sups.map(s => `<tr><td class="rowh v" data-s="${esc(s)}" data-y="" data-m="">${esc(s)}</td>${colsOf(s)}</tr>`).join('')
        || '<tr><td class="muted" style="padding:30px">لا توجد شيكات بالحالات المختارة</td></tr>'}</tbody>
      ${sups.length ? `<tfoot><tr><td class="rowh">الإجمالي</td>${colsOf('*')}</tr></tfoot>` : ''}`;

    // للتصدير
    pivotCache = { years, monthsOf, sups, cell, byMonth };

    // أول فتح: تحريك الجدول أفقياً لحد الشهر الحالي
    if (scrollToNow) {
      scrollToNow = false;
      const cur = $('#trPivot thead th.cur') || $('#trPivot thead th:not(.past):not(.rowh):not(.yt)');
      const wrap = $('#trPivot').closest('.table-wrap');
      if (cur && wrap) {
        const w = wrap.getBoundingClientRect(), c = cur.getBoundingClientRect(), rowh = $('#trPivot .rowh').getBoundingClientRect().width;
        wrap.scrollLeft += c.right - (w.right - rowh);   // RTL: الشهر الحالي يبقى جنب عمود المورد
      }
    }
  }

  // مفاتيح البيانات: y = '' (كل السنين)، m = '' (كل الشهور)، m = 0 (بدون تاريخ)
  function matches(r, d) {
    return (d.sup === '*' || supOf(r) === d.sup) && (d.y === '' || yOf(r) === d.y) && (d.m === '' || mOf(r) === +d.m);
  }

  function detail(recs) {
    if (!drill) { $('#trDetail').classList.add('hidden'); return; }
    list = recs.filter(r => matches(r, drill)).sort((a, b) => (a.dueD || 0) - (b.dueD || 0));
    const parts = [drill.sup === '*' ? 'كل الموردين' : drill.sup];
    if (drill.y) parts.push(drill.m !== '' && +drill.m ? `${MONTHS[drill.m - 1]} ${drill.y}` : drill.y);
    $('#trDetailTitle').textContent = `الشيكات: ${parts.join(' — ')}`;
    $('#trTable thead').innerHTML = `<tr>${App.sel.head()}<th>NN</th><th>العميل</th><th>البنك / رقم الشيك</th><th>صافى الشيك</th><th>الاستحقاق</th><th>الحاله</th><th>موقف الشيك</th><th>المورد المتوقع</th><th>بيان / تذكير</th></tr>`;
    $('#trTable tbody').innerHTML = list.map(r => `<tr data-id="${esc(r.id)}">${App.sel.cell(r)}
      <td>${esc(r.id)}</td><td>${esc(r.name)}<span class="sub">${esc(r.code)}</span></td>
      <td>${esc(r.bank)}<span class="sub num">${esc(r.checkNo)}</span></td>
      <td><b class="num">${App.fmt(r.netN)}</b>${r.paidN ? `<span class="sub num">من ${App.fmt(r.amountN)}</span>` : ''}</td>
      <td><span class="num">${esc(App.iso(r.dueD) || r.due)}</span><span class="sub">${esc(r.dueState)}</span></td>
      <td>${App.statusBadge(r)}</td><td>${esc(r.position)}</td><td>${esc(r.supplier)}</td>
      <td class="wrap small">${esc(String(r.note || '').slice(0, 100))}${r.remind ? `<span class="sub">🔔 ${esc(String(r.remind).slice(0, 60))}</span>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="10" class="muted" style="text-align:center;padding:24px">لا توجد شيكات</td></tr>';
    $('#trFoot').innerHTML = `<span>${list.length} شيك</span><b class="num">صافى: ${App.fmt(sum(list))}</b>`;
    $('#trDetail').classList.remove('hidden');
    App.sel.sync($('#trTable'), list);
  }

  function render() {
    toggles();
    App.fillSelect($('#trWh'), App.lists.wh);
    const recs = base();
    kpis(recs); pivot(recs); detail(recs);
    const st = [...active].join(' + ') || '—', wh = $('#trWh').value;
    $('#trPrintTitle').innerHTML = `<h2>شيكات بالخزنة — ${esc(st)}${wh ? ' — ' + esc(wh) : ''}</h2>
      <div class="muted">${$('#trMeasure').selectedOptions[0].text} بالمورد المتوقع على شهور الاستحقاق — بتاريخ ${App.iso(App.today())} — ${recs.length} شيك — صافى ${App.fmt(sum(recs))}</div>`;
  }

  function exportCsv() {
    const p = pivotCache; if (!p) return;
    const cols = [];
    p.years.forEach(y => {
      if (p.byMonth && y !== NODATE) { p.monthsOf[y].forEach(m => cols.push([`${MONTHS[m - 1]} ${y}`, y, m])); cols.push([`إجمالي ${y}`, y, '']); }
      else cols.push([y, y, y === NODATE ? 0 : '']);
    });
    cols.push(['الإجمالي', '', '']);
    const lines = [['المورد المتوقع', ...cols.map(c => c[0])]];
    [...p.sups, '*'].forEach(s => lines.push([s === '*' ? 'الإجمالي' : s, ...cols.map(([, y, m]) => p.cell[`${s}|${y}|${m}`] || 0)]));
    const csv = '﻿' + lines.map(l => l.map(v => { const x = String(v); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; }).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `treasury-pivot-${App.iso(new Date())}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  App.views.treasury = {
    render,
    init() {
      $('#trStatuses').addEventListener('change', e => {
        const v = e.target.value; e.target.checked ? active.add(v) : active.delete(v); render();
      });
      ['#trWh', '#trMeasure', '#trGrain'].forEach(s => $(s).addEventListener('change', () => { scrollToNow = true; render(); }));
      window.addEventListener('hashchange', () => { if (App.currentView() === 'treasury') scrollToNow = true; });
      $('#trPivot').addEventListener('click', e => {
        const c = e.target.closest('td.v'); if (!c) return;
        const d = { sup: c.dataset.s, y: c.dataset.y, m: c.dataset.m };
        drill = drill && drill.sup === d.sup && drill.y === d.y && drill.m === d.m ? null : d;
        render();
        if (drill) $('#trDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      $('#trDetailClose').addEventListener('click', () => { drill = null; render(); });
      $('#trShare').addEventListener('click', () => App.share.open({
        title: $('#trDetailTitle').textContent, file: 'treasury', rows: list,
        cols: [
        ['NN', r => r.id], ['العميل', r => r.name], ['البنك', r => r.bank], ['رقم الشيك', r => r.checkNo],
        ['صافى الشيك', r => App.fmt(r.netN), { sum: r => r.netN, num: true }], ['الاستحقاق', r => App.iso(r.dueD) || r.due],
        ['الحاله', r => r.status], ['موقف الشيك', r => r.position], ['المورد المتوقع', r => r.supplier],
        ],
      }));
      $('#trTable tbody').addEventListener('click', e => {
        const id = e.target.closest('tr')?.dataset.id; if (id) App.openForm(App.state.records.find(r => r.id === id));
      });
      App.sel.bind($('#trTable'), () => list);
      $('#trExport').addEventListener('click', exportCsv);
      $('#trPrint').addEventListener('click', () => window.print());
    },
  };
})();
