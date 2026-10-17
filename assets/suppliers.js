/* شاشة متابعة الموردين: الشيكات بحالة «متابعة مورد» و«امانات لدي المورد» */
(function () {
  'use strict';
  const App = window.App, { $, esc } = App;
  const isSupplierStatus = s => /مورد/.test(s);   // متابعة مورد، امانات لدي المورد
  const PENDING = 'معلق للافادة';

  // المورد = قيمة «موقف الشيك» كما هي في الشيت (لا يُستخدم «المورد المتوقع»)
  const supplierOf = r => String(r.position || '').trim().replace(/\s+/g, ' ') || 'بدون موقف شيك';
  const daysSince = d => d ? Math.floor((App.today() - d) / 864e5) : null;
  // في هذه الشاشة القيمة = قيمة الشيك الأصلية (شيكات الأمانات صافيها صفر لأنها اتسددت بتحويلات لكن الشيك لسه عند المورد)
  const sum = a => a.reduce((s, r) => s + r.amountN, 0);
  const sumNet = a => a.reduce((s, r) => s + r.netN, 0);

  let sortKey = 'sup', sortAsc = true, list = [];

  const COLS = [
    { k: 'id', t: 'NN', v: r => esc(r.id), s: r => r.id },
    { k: 'sup', t: 'موقف الشيك', v: r => `<b>${esc(r._sup)}</b>`, s: r => r._sup + '|' + (r.dueD ? App.iso(r.dueD) : '') },
    { k: 'name', t: 'العميل', v: r => `${esc(r.name)}<span class="sub">${esc(r.code)}</span>`, s: r => r.name },
    { k: 'drawer', t: 'شيك بأسم', v: r => `<span class="small">${esc(r.drawer)}</span>`, s: r => String(r.drawer ?? '') },
    { k: 'bank', t: 'البنك / رقم الشيك', v: r => `${esc(r.bank)}<span class="sub num">${esc(r.checkNo)}</span>`, s: r => r.bank },
    { k: 'net', t: 'قيمة الشيك', v: r => `<b class="num">${App.fmt(r.amountN)}</b>${r.paidN ? `<span class="sub num">${r.netN ? 'متبقي ' + App.fmt(r.netN) : 'مسدد بالكامل'}</span>` : ''}`, s: r => r.amountN },
    { k: 'due', t: 'الاستحقاق', v: r => `<span class="num">${esc(App.iso(r.dueD) || r.due)}</span><span class="sub">${esc(r.dueState)}</span>`, s: r => r.dueD ? +r.dueD : 0 },
    { k: 'days', t: 'خروج الشيك للمورد', v: r => r._outD ? `<span class="num">${App.iso(r._outD)}</span><span class="sub">منذ ${r._days} يوم</span>` : '<span class="muted small">—</span>', s: r => r._days ?? -1 },
    { k: 'status', t: 'الحاله', v: r => `<span class="badge ${/امان/.test(r.status) ? 'info' : 'warn'}">${esc(r.status)}</span>`, s: r => r.status },
    { k: 'cash', t: 'حالة الصرف', v: r => App.cashBadge(r), s: r => r.cashState },
    { k: 'note', t: 'بيان / تذكير', v: r => `<span class="small">${esc(String(r.note || '').slice(0, 120))}</span>${r.remind ? `<span class="sub">🔔 ${esc(String(r.remind).slice(0, 80))}</span>` : ''}`, cls: 'wrap' },
  ];

  function base() {
    return App.state.records.filter(r => isSupplierStatus(r.status)).map(r => {
      r._sup = supplierOf(r);
      r._outD = App.parseDate(r.outDate);
      r._days = daysSince(r._outD);
      return r;
    });
  }

  function kpis(all) {
    const t = App.today();
    const fol = all.filter(r => !/امان/.test(r.status)), am = all.filter(r => /امان/.test(r.status));
    const due = all.filter(r => r.dueD && r.dueD <= t), rej = all.filter(r => r.isRejected), pend = all.filter(r => r.cashState === PENDING);
    $('#supKpis').innerHTML = [
      ['إجمالي قيمة الشيكات لدى الموردين', App.fmt(sum(all)), `${all.length} شيك — ${new Set(all.map(r => r._sup)).size} مورد — متبقي ${App.fmtShort(sumNet(all))}`, 'warn'],
      ['متابعة مورد', App.fmt(sum(fol)), `${fol.length} شيك`, ''],
      ['امانات لدي المورد', App.fmt(sum(am)), `${am.length} شيك`, ''],
      ['مستحق (تاريخه عدّى)', App.fmt(sum(due)), `${due.length} شيك`, due.length ? 'bad' : ''],
      ['مرفوض', App.fmt(sum(rej)), `${rej.length} شيك`, rej.length ? 'bad' : ''],
      ['معلق للإفادة', App.fmt(sum(pend)), `${pend.length} شيك`, pend.length ? 'warn' : ''],
    ].map(([l, v, s, c]) => `<div class="kpi ${c}"><div class="lbl">${l}</div><div class="val">${v}</div><div class="sub">${s}</div></div>`).join('');
  }

  // ملخص لكل مورد — الضغط على الصف يفلتر عليه
  function summary(all) {
    const t = App.today(), by = new Map();
    all.forEach(r => { if (!by.has(r._sup)) by.set(r._sup, []); by.get(r._sup).push(r); });
    const rows = [...by.entries()].map(([sup, l]) => ({
      sup, n: l.length, total: sum(l),
      fol: sum(l.filter(r => !/امان/.test(r.status))), am: sum(l.filter(r => /امان/.test(r.status))),
      due: l.filter(r => r.dueD && r.dueD <= t).length, rej: l.filter(r => r.isRejected).length,
      pend: l.filter(r => r.cashState === PENDING).length,
      oldest: Math.max(-1, ...l.map(r => r._days ?? -1)),
    })).sort((a, b) => b.total - a.total);
    const cur = $('#sSupplier').value;
    $('#supSumTable thead').innerHTML = '<tr><th>المورد (موقف الشيك)</th><th>عدد الشيكات</th><th>الإجمالي</th><th>متابعة مورد</th><th>امانات لدي المورد</th><th>مستحق</th><th>مرفوض</th><th>معلق للإفادة</th><th>أقدم شيك لدى المورد</th></tr>';
    $('#supSumTable tbody').innerHTML = rows.map(x => `
      <tr data-sup="${esc(x.sup)}" style="${x.sup === cur ? 'background:var(--primary-weak)' : ''}">
        <td><b>${esc(x.sup)}</b></td><td class="num">${x.n}</td><td class="num"><b>${App.fmt(x.total)}</b></td>
        <td class="num">${x.fol ? App.fmt(x.fol) : ''}</td><td class="num">${x.am ? App.fmt(x.am) : ''}</td>
        <td>${x.due ? `<span class="badge bad">${x.due}</span>` : ''}</td><td>${x.rej ? `<span class="badge bad">${x.rej}</span>` : ''}</td>
        <td>${x.pend ? `<span class="badge warn">${x.pend}</span>` : ''}</td>
        <td>${x.oldest >= 0 ? `<span class="num">${x.oldest}</span> يوم` : ''}</td>
      </tr>`).join('');
    App.fillSelect($('#sSupplier'), rows.map(x => x.sup));
  }

  function table(all) {
    const q = $('#sSearch').value.trim().toLowerCase(), terms = q ? q.split(/\s+/) : [];
    const sup = $('#sSupplier').value, st = $('#sStatus').value, cash = $('#sCash').value, due = $('#sDue').value;
    list = all.filter(r => (!sup || r._sup === sup) && (!st || r.status === st) &&
      (!cash || (cash === '(فارغ)' ? !r.cashState : r.cashState === cash)) && (!due || r.dueState === due) &&
      terms.every(t => (r.search + ' ' + r._sup.toLowerCase()).includes(t)));
    const col = COLS.find(c => c.k === sortKey);
    list.sort((a, b) => { const x = col.s(a), y = col.s(b); return (x > y ? 1 : x < y ? -1 : 0) * (sortAsc ? 1 : -1); });

    $('#supTable thead').innerHTML = `<tr>${App.sel.head()}${COLS.map(c => `<th data-k="${c.k}" class="${c.s ? '' : 'nosort'} ${c.k === sortKey ? 'sorted' + (sortAsc ? ' asc' : '') : ''}">${c.t}</th>`).join('')}</tr>`;
    $('#supTable tbody').innerHTML = list.length
      ? list.map(r => `<tr data-id="${esc(r.id)}">${App.sel.cell(r)}${COLS.map(c => `<td class="${c.cls || ''}">${c.v(r)}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${COLS.length + 1}" class="muted" style="text-align:center;padding:30px">لا توجد شيكات</td></tr>`;
    App.sel.sync($('#supTable'), list);
    $('#supFoot').innerHTML = `<span>${list.length} شيك</span><b class="num">قيمة الشيكات: ${App.fmt(sum(list))} — المتبقي (الصافي): ${App.fmt(sumNet(list))}</b>`;

    $('#supPrintTitle').innerHTML = `<h2>كشف شيكات لدى ${sup ? 'المورد: ' + esc(sup) : 'الموردين'}</h2>
      <div class="muted">${st ? esc(st) + ' — ' : ''}${cash ? esc(cash) + ' — ' : ''}بتاريخ ${App.iso(App.today())} — عدد ${list.length} شيك — إجمالي ${App.fmt(sum(list))}</div>`;
  }

  function render() {
    const all = base();
    const statuses = [...new Set(all.map(r => r.status))].sort();
    App.fillSelect($('#sStatus'), statuses);
    const cashes = [...new Set(all.map(r => r.cashState || '(فارغ)'))];
    App.fillSelect($('#sCash'), cashes);
    kpis(all); summary(all); table(all);
  }

  App.views.suppliers = {
    render,
    init() {
      const re = () => { const all = base(); summary(all); table(all); };
      $('#sSearch').addEventListener('input', App.debounce(re));
      ['#sSupplier', '#sStatus', '#sCash', '#sDue'].forEach(s => $(s).addEventListener('change', re));
      $('#sReset').addEventListener('click', () => { ['#sSearch', '#sSupplier', '#sStatus', '#sCash', '#sDue'].forEach(s => $(s).value = ''); re(); });
      $('#supSumTable tbody').addEventListener('click', e => {
        const sup = e.target.closest('tr')?.dataset.sup; if (sup == null) return;
        $('#sSupplier').value = $('#sSupplier').value === sup ? '' : sup; re();
        $('#supTable').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      $('#supTable thead').addEventListener('click', e => {
        const k = e.target.closest('th')?.dataset.k; if (!k || !COLS.find(c => c.k === k).s) return;
        if (k === sortKey) sortAsc = !sortAsc; else { sortKey = k; sortAsc = !['net', 'days'].includes(k); }
        table(base());
      });
      $('#supTable tbody').addEventListener('click', e => {
        const id = e.target.closest('tr')?.dataset.id; if (id) App.openForm(App.state.records.find(r => r.id === id));
      });
      $('#sPrint').addEventListener('click', () => window.print());
      const shareCfg = () => ({
        title: $('#sSupplier').value ? `شيكات لدى المورد: ${$('#sSupplier').value}` : 'شيكات لدى الموردين', file: 'suppliers', rows: list,
        cols: [
          ['موقف الشيك', r => r._sup], ['NN', r => r.id], ['العميل', r => r.name], ['شيك بأسم', r => r.drawer], ['البنك', r => r.bank], ['رقم الشيك', r => r.checkNo],
          ['قيمة الشيك', r => App.fmt(r.amountN), { sum: r => r.amountN, num: true }], ['المتبقي', r => App.fmt(r.netN), { sum: r => r.netN, num: true }],
          ['الاستحقاق', r => App.iso(r.dueD) || r.due], ['خروج الشيك', r => App.iso(r._outD)], ['الحاله', r => r.status], ['حالة الصرف', r => r.cashState],
        ],
      });
      $('#sShare').addEventListener('click', () => App.share.open(shareCfg()));
      $('#sCopy').addEventListener('click', () => App.share.copyTable(shareCfg()));
      App.sel.bind($('#supTable'), () => list);
    },
  };
})();
