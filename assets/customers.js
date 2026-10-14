/* شاشة تحليل العملاء: نظرة عامة + تفاصيل كل عميل */
(function () {
  'use strict';
  const App = window.App, { $, esc } = App;
  const PAGE = 50;
  const charts = {};
  let sortKey = 'open', sortAsc = false, page = 0, rows = [];

  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const C = () => ({ ok: css('--ok'), bad: css('--bad'), warn: css('--warn'), info: css('--info'), primary: css('--primary'), muted: css('--muted'), border: css('--border'), text: css('--text') });
  const PALETTE = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#64748b'];

  function chart(id, cfg) {
    if (charts[id]) charts[id].destroy();
    if (!window.Chart) return;
    const c = C();
    Chart.defaults.font.family = 'Cairo, system-ui, sans-serif';
    Chart.defaults.color = c.muted;
    Chart.defaults.borderColor = c.border;
    charts[id] = new Chart(document.getElementById(id), cfg);
  }
  const moneyTick = { callback: v => App.fmtShort(v) };
  const moneyTip = { callbacks: { label: ctx => `${ctx.dataset.label ? ctx.dataset.label + ': ' : ''}${App.fmt(ctx.parsed.x ?? ctx.parsed.y ?? ctx.parsed)}` } };
  const monthKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const sum = a => a.reduce((s, r) => s + r.netN, 0);
  const mode = arr => { const m = new Map(); arr.forEach(v => v && m.set(v, (m.get(v) || 0) + 1)); return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || ''; };

  // ===== التجميع لكل عميل =====
  function aggregate() {
    const t = App.today(), soon = new Date(t); soon.setDate(soon.getDate() + 30);
    const by = new Map();
    for (const r of App.state.records) {
      if (!r.code) continue;
      if (!by.has(r.code)) by.set(r.code, []);
      by.get(r.code).push(r);
    }
    const out = [];
    for (const [code, list] of by) {
      const open = list.filter(r => !r.isPaid);
      const tenors = list.filter(r => r.dueD && r.recvD).map(r => (r.dueD - r.recvD) / 864e5).filter(d => d >= 0 && d < 2000);
      out.push({
        code, name: App.customers.get(code)?.name || list[0].name, wh: mode(list.map(r => r.wh)), list,
        count: list.length, total: sum(list), paid: sum(list.filter(r => r.isPaid)),
        open: sum(open), openCount: open.length,
        overdue: sum(open.filter(r => r.dueD && r.dueD <= t)), overdueCount: open.filter(r => r.dueD && r.dueD <= t).length,
        upcoming: sum(open.filter(r => r.dueD && r.dueD > t && r.dueD <= soon)),
        rejected: list.filter(r => r.isRejected).length, rejectedAmt: sum(list.filter(r => r.isRejected)),
        replaced: list.filter(r => /استبدال/.test(r.cashState)).length,
        avgDays: tenors.length ? Math.round(tenors.reduce((a, b) => a + b, 0) / tenors.length) : null,
        lastRecv: list.reduce((m, r) => r.recvD && (!m || r.recvD > m) ? r.recvD : m, null),
      });
    }
    return out;
  }

  // ===== النظرة العامة =====
  const COLS = [
    { k: 'code', t: 'الكود', v: c => `<span class="num">${esc(c.code)}</span>` },
    { k: 'name', t: 'العميل', v: c => `<b>${esc(c.name)}</b>` },
    { k: 'wh', t: 'المخزن', v: c => esc(c.wh) },
    { k: 'count', t: 'عدد الشيكات', v: c => `<span class="num">${c.count}</span>` },
    { k: 'total', t: 'إجمالي الشيكات', v: c => `<span class="num">${App.fmt(c.total)}</span>` },
    { k: 'open', t: 'الرصيد المفتوح', v: c => c.open ? `<b class="num">${App.fmt(c.open)}</b><span class="sub">${c.openCount} شيك</span>` : '<span class="badge ok">خالص</span>' },
    { k: 'overdue', t: 'متأخر', v: c => c.overdue ? `<span class="badge bad num">${App.fmt(c.overdue)}</span>` : '' },
    { k: 'rejected', t: 'مرفوض', v: c => c.rejected ? `<span class="badge bad">${c.rejected}</span>` : '' },
    { k: 'avgDays', t: 'متوسط الأجل', v: c => c.avgDays != null ? `<span class="num">${c.avgDays}</span> يوم` : '' },
    { k: 'lastRecv', t: 'آخر استلام', v: c => `<span class="num">${App.iso(c.lastRecv)}</span>` },
  ];

  function overview(all) {
    const t = App.today();
    const recs = App.state.records, open = recs.filter(r => !r.isPaid);
    const overdue = open.filter(r => r.dueD && r.dueD <= t);
    const soon = new Date(t); soon.setDate(soon.getDate() + 30);
    const upcoming = open.filter(r => r.dueD && r.dueD > t && r.dueD <= soon);
    const rej = recs.filter(r => r.isRejected);
    $('#custKpis').innerHTML = [
      ['عدد العملاء', all.length.toLocaleString('en-US'), `${all.filter(c => c.open > 0).length} لديهم رصيد مفتوح`, ''],
      ['إجمالي الرصيد المفتوح', App.fmt(sum(open)), `${open.length} شيك غير خالص`, 'warn'],
      ['متأخر السداد', App.fmt(sum(overdue)), `${overdue.length} شيك — ${new Set(overdue.map(r => r.code)).size} عميل`, 'bad'],
      ['يستحق خلال 30 يوم', App.fmt(sum(upcoming)), `${upcoming.length} شيك`, ''],
      ['شيكات مرفوضة', rej.length.toLocaleString('en-US'), `بقيمة ${App.fmtShort(sum(rej))}`, rej.length ? 'bad' : 'ok'],
    ].map(([l, v, s, c]) => `<div class="kpi ${c}"><div class="lbl">${l}</div><div class="val">${v}</div><div class="sub">${s}</div></div>`).join('');

    const col = C();
    const top = [...all].sort((a, b) => b.open - a.open).filter(c => c.open > 0).slice(0, 10);
    chart('chTopOpen', {
      type: 'bar',
      data: {
        labels: top.map(c => c.name),
        datasets: [
          { label: 'متأخر', data: top.map(c => c.overdue), backgroundColor: col.bad },
          { label: 'لم يستحق بعد', data: top.map(c => c.open - c.overdue), backgroundColor: col.warn },
        ],
      },
      options: {
        indexAxis: 'y', maintainAspectRatio: false, onClick: (e, el) => el[0] && (location.hash = '#customers/' + encodeURIComponent(top[el[0].index].code)),
        scales: { x: { stacked: true, ticks: moneyTick }, y: { stacked: true, position: 'right' } },
        plugins: { tooltip: moneyTip, legend: { position: 'bottom' } },
      },
    });

    // الاستحقاقات المفتوحة بالشهر: المتأخر مجمّع ثم الـ 12 شهر القادمة
    const labels = ['متأخر'], vals = [sum(overdue)], m0 = new Date(t.getFullYear(), t.getMonth(), 1);
    const keys = [];
    for (let i = 0; i < 12; i++) { const d = new Date(m0.getFullYear(), m0.getMonth() + i, 1); keys.push(monthKey(d)); labels.push(d.toLocaleDateString('ar-EG', { month: 'short', year: '2-digit' })); vals.push(0); }
    open.forEach(r => { if (r.dueD && r.dueD > t) { const i = keys.indexOf(monthKey(r.dueD)); if (i >= 0) vals[i + 1] += r.netN; } });
    chart('chUpcoming', {
      type: 'bar',
      data: { labels, datasets: [{ label: 'القيمة', data: vals, backgroundColor: vals.map((_, i) => i === 0 ? col.bad : col.primary) }] },
      options: { maintainAspectRatio: false, scales: { y: { ticks: moneyTick } }, plugins: { legend: { display: false }, tooltip: moneyTip } },
    });
  }

  function table(all) {
    const q = $('#cSearch').value.trim().toLowerCase(), wh = $('#cWh').value, openOnly = $('#cOpenOnly').checked;
    rows = all.filter(c => (!q || (c.code + ' ' + c.name).toLowerCase().includes(q)) && (!wh || c.wh === wh) && (!openOnly || c.open > 0));
    rows.sort((a, b) => { const x = a[sortKey] ?? '', y = b[sortKey] ?? ''; return (x > y ? 1 : x < y ? -1 : 0) * (sortAsc ? 1 : -1); });
    $('#custTable thead').innerHTML = `<tr>${COLS.map(c => `<th data-k="${c.k}" class="${c.k === sortKey ? 'sorted' + (sortAsc ? ' asc' : '') : ''}">${c.t}</th>`).join('')}</tr>`;
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    if (page >= pages) page = pages - 1;
    const slice = rows.slice(page * PAGE, page * PAGE + PAGE);
    $('#custTable tbody').innerHTML = slice.length
      ? slice.map(c => `<tr data-code="${esc(c.code)}">${COLS.map(col => `<td>${col.v(c)}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${COLS.length}" class="muted" style="text-align:center;padding:30px">لا توجد نتائج</td></tr>`;
    $('#custPager').innerHTML = `<span>${rows.length.toLocaleString('en-US')} عميل</span>
      <span class="btns"><button class="btn ghost" data-p="-1" ${page ? '' : 'disabled'}>السابق</button>
      <span>صفحة ${page + 1} / ${pages}</span>
      <button class="btn ghost" data-p="1" ${page < pages - 1 ? '' : 'disabled'}>التالي</button></span>`;
  }

  // ===== تفاصيل عميل =====
  function detail(c) {
    const t = App.today(), col = C();
    const el = $('#custDetail');
    const payRate = c.total ? Math.round(c.paid / c.total * 100) : 0;
    const whs = [...new Set(c.list.map(r => r.wh).filter(Boolean))].join('، ');
    el.innerHTML = `
      <div class="detail-head">
        <a class="btn ghost" href="#customers">→ رجوع</a>
        <h2>${esc(c.name)}</h2><span class="badge">${esc(c.code)}</span><span class="muted">${esc(whs)}</span>
        <span class="grow"></span>
        <button class="btn ghost" id="dShowChecks">عرض في شاشة الشيكات</button>
        <button class="btn primary" id="dAdd">＋ شيك لهذا العميل</button>
      </div>
      <div class="kpis">${[
        ['إجمالي الشيكات', App.fmt(c.total), `${c.count} شيك`, ''],
        ['تم تحصيله (خالص)', App.fmt(c.paid), `نسبة التحصيل ${payRate}%`, 'ok'],
        ['الرصيد المفتوح', App.fmt(c.open), `${c.openCount} شيك`, c.open ? 'warn' : 'ok'],
        ['متأخر', App.fmt(c.overdue), `${c.overdueCount} شيك`, c.overdue ? 'bad' : ''],
        ['يستحق خلال 30 يوم', App.fmt(c.upcoming), '', ''],
        ['متوسط الأجل', c.avgDays != null ? c.avgDays + ' يوم' : '—', 'من الاستلام للاستحقاق', ''],
        ['مرفوض / استبدال', `${c.rejected} / ${c.replaced}`, c.rejected ? `مرفوض بقيمة ${App.fmtShort(c.rejectedAmt)}` : '', c.rejected ? 'bad' : ''],
      ].map(([l, v, s, k]) => `<div class="kpi ${k}"><div class="lbl">${l}</div><div class="val">${v}</div><div class="sub">${s}</div></div>`).join('')}</div>
      <div class="cols">
        <div class="card chart-card"><h3>الشيكات حسب شهر الاستحقاق</h3><div class="chart-box"><canvas id="chCustMonthly"></canvas></div></div>
        <div class="card chart-card"><h3>حالة الصرف</h3><div class="chart-box"><canvas id="chCustCash"></canvas></div></div>
        <div class="card chart-card"><h3>البنوك</h3><div class="chart-box"><canvas id="chCustBank"></canvas></div></div>
      </div>
      <div class="card table-card">
        <div class="filters" style="margin:0;border-bottom:1px solid var(--border)">
          <div class="section-title"><h3>شيكات العميل</h3></div><span class="grow"></span>
          <label class="inline chk"><input type="checkbox" id="dOpenOnly" ${c.open ? 'checked' : ''}> غير الخالص فقط</label>
        </div>
        <div class="table-wrap"><table class="grid" id="dTable"><thead><tr>
          <th>NN</th><th>الاستحقاق</th><th>البنك / رقم الشيك</th><th>الصافي</th><th>حالة الصرف</th><th>الحاله</th><th>موقف الشيك</th><th>بيان</th>
        </tr></thead><tbody></tbody></table></div>
      </div>`;

    const drawTable = () => {
      const only = $('#dOpenOnly').checked;
      const list = c.list.filter(r => !only || !r.isPaid).sort((a, b) => (b.dueD || 0) - (a.dueD || 0));
      $('#dTable tbody').innerHTML = list.map(r => `<tr data-id="${esc(r.id)}">
        <td>${esc(r.id)}</td><td><span class="num">${esc(App.iso(r.dueD) || r.due)}</span><span class="sub">${esc(r.dueState)}</span></td>
        <td>${esc(r.bank)}<span class="sub num">${esc(r.checkNo)}</span></td><td><b class="num">${App.fmt(r.netN)}</b></td>
        <td>${App.cashBadge(r)}</td><td>${App.statusBadge(r)}</td><td>${esc(r.position)}</td>
        <td class="wrap small">${esc(String(r.note || '').slice(0, 90))}</td></tr>`).join('')
        || '<tr><td colspan="8" class="muted" style="text-align:center;padding:24px">لا توجد شيكات غير خالصة</td></tr>';
    };
    drawTable();
    $('#dOpenOnly').addEventListener('change', drawTable);
    $('#dTable tbody').addEventListener('click', e => {
      const id = e.target.closest('tr')?.dataset.id; if (id) App.openForm(App.state.records.find(r => r.id === id));
    });
    $('#dAdd').addEventListener('click', () => {
      const cu = App.customers.get(c.code) || {};
      App.openForm(null, { code: c.code, name: cu.name || c.name, wh: cu.wh || c.wh, mm: cu.mm || '' });
    });
    $('#dShowChecks').addEventListener('click', () => App.views.checks.showCustomer(c.code));

    // شهري: من أول شيك (بحد أقصى 24 شهر للخلف) حتى آخر استحقاق
    const dated = c.list.filter(r => r.dueD);
    if (dated.length) {
      let start = new Date(Math.min(...dated.map(r => +r.dueD))); start = new Date(start.getFullYear(), start.getMonth(), 1);
      const minStart = new Date(t.getFullYear(), t.getMonth() - 24, 1); if (start < minStart) start = minStart;
      const end = new Date(Math.max(...dated.map(r => +r.dueD)));
      const keys = [], labels = [];
      for (let d = new Date(start); d <= end && keys.length < 48; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
        keys.push(monthKey(d)); labels.push(d.toLocaleDateString('ar-EG', { month: 'short', year: '2-digit' }));
      }
      const paid = keys.map(() => 0), openOver = keys.map(() => 0), openFut = keys.map(() => 0);
      dated.forEach(r => {
        const i = keys.indexOf(monthKey(r.dueD)); if (i < 0) return;
        if (r.isPaid) paid[i] += r.netN; else if (r.dueD <= t) openOver[i] += r.netN; else openFut[i] += r.netN;
      });
      chart('chCustMonthly', {
        type: 'bar',
        data: { labels, datasets: [
          { label: 'خالص', data: paid, backgroundColor: col.ok },
          { label: 'متأخر', data: openOver, backgroundColor: col.bad },
          { label: 'لم يستحق', data: openFut, backgroundColor: col.warn },
        ] },
        options: { maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true, ticks: moneyTick } }, plugins: { tooltip: moneyTip, legend: { position: 'bottom' } } },
      });
    }

    const group = key => { const m = new Map(); c.list.forEach(r => { const k = r[key] || 'غير محدد'; m.set(k, (m.get(k) || 0) + r.netN); }); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
    const cash = group('cashState');
    chart('chCustCash', {
      type: 'doughnut',
      data: { labels: cash.map(x => x[0]), datasets: [{ data: cash.map(x => x[1]), backgroundColor: PALETTE, borderColor: css('--surface') }] },
      options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: x => `${x.label}: ${App.fmt(x.parsed)}` } } } },
    });
    const banks = group('bank').slice(0, 8);
    chart('chCustBank', {
      type: 'bar',
      data: { labels: banks.map(x => x[0]), datasets: [{ data: banks.map(x => x[1]), backgroundColor: col.primary }] },
      options: { indexAxis: 'y', maintainAspectRatio: false, scales: { x: { ticks: moneyTick }, y: { position: 'right' } }, plugins: { legend: { display: false }, tooltip: moneyTip } },
    });
  }

  function render() {
    const all = aggregate();
    const code = decodeURIComponent(location.hash.split('/')[1] || '');
    const c = code && all.find(x => x.code === code);
    $('#custOverview').classList.toggle('hidden', !!c);
    $('#custDetail').classList.toggle('hidden', !c);
    if (c) { detail(c); window.scrollTo(0, 0); return; }
    App.fillSelect($('#cWh'), App.lists.wh);
    overview(all);
    table(all);
  }

  App.views.customers = {
    render,
    init() {
      const re = () => { page = 0; table(aggregate()); };
      $('#cSearch').addEventListener('input', App.debounce(re));
      $('#cWh').addEventListener('change', re);
      $('#cOpenOnly').addEventListener('change', re);
      $('#custTable thead').addEventListener('click', e => {
        const k = e.target.closest('th')?.dataset.k; if (!k) return;
        if (k === sortKey) sortAsc = !sortAsc; else { sortKey = k; sortAsc = ['code', 'name', 'wh'].includes(k); }
        table(aggregate());
      });
      $('#custTable tbody').addEventListener('click', e => {
        const code = e.target.closest('tr')?.dataset.code; if (code) location.hash = '#customers/' + encodeURIComponent(code);
      });
      $('#custPager').addEventListener('click', e => { const d = +e.target.dataset.p; if (d) { page += d; table(aggregate()); } });
    },
  };
})();
