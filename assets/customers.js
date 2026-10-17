/* شاشة تحليل العملاء: نظرة عامة + تفاصيل كل عميل */
(function () {
  'use strict';
  const App = window.App, { $, esc } = App;
  const PAGE = 50;
  const charts = {};
  let sortKey = 'open', sortAsc = false, page = 0, rows = [];
  let ovPick = null;   // اختيار من رسم «الاستحقاقات المفتوحة» بيفلتر جدول العملاء

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
    // الرسوم اللي بتتضغط: شكل الماوس إيد فوق العواميد
    if (cfg.options && cfg.options.onClick) cfg.options.onHover = (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; };
    charts[id] = new Chart(document.getElementById(id), cfg);
  }

  // ===== الرسوم التفاعلية: الضغط على عمود أو جزء بيفلتر الجدول اللي تحته، والضغط عليه تاني بيلغي =====
  // pick = { chart, index, ds, label, fn } — العنصر المختار بيفضل بلونه والباقي بيبهت
  const fadeHex = c => /^#[0-9a-f]{6}$/i.test(c) ? c + '44' : c;
  const pickColor = (getPick, id, base) => ctx => {
    const p = getPick(), b = Array.isArray(base) ? base[ctx.dataIndex % base.length] : typeof base === 'function' ? base(ctx) : base;
    if (!p || p.chart !== id) return b;
    return p.index === ctx.dataIndex && (p.ds == null || p.ds === ctx.datasetIndex) ? b : fadeHex(b);
  };
  const samePick = (a, b) => a && b && a.chart === b.chart && a.index === b.index && a.ds === b.ds;
  const pickChip = p => p ? `<span class="chip">📊 <b>${esc(p.label)}</b><button type="button" class="rm" data-unpick title="إلغاء الفلتر">✕</button></span>` : '';
  const recolor = () => Object.values(charts).forEach(ch => ch && ch.update('none'));
  const HINT = '<span class="muted small" style="font-weight:400"> — اضغط على أي جزء لعرض شيكاته</span>';
  const moneyTick = { callback: v => App.fmtShort(v) };
  const moneyTip = { callbacks: { label: ctx => `${ctx.dataset.label ? ctx.dataset.label + ': ' : ''}${App.fmt(ctx.parsed.x ?? ctx.parsed.y ?? ctx.parsed)}` } };
  const monthKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const sum = a => a.reduce((s, r) => s + r.netN, 0);
  const isOpen = r => !r.isPaid && !r.isReturned;
  const mode = arr => { const m = new Map(); arr.forEach(v => v && m.set(v, (m.get(v) || 0) + 1)); return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || ''; };

  // ===== الشيكات من الشيتين =====
  // شيت الشيكات + شيت المخازن. الشيك اللي موجود في الاتنين (نفس كود العميل ونفس رقم الشيك) بيتحسب مرة واحدة
  // من شيت الشيكات، وبيتكتب جنبه كود WH بتاعه
  const WH = () => App.views.warehouses && App.views.warehouses.shared;
  let inWh = new Map();   // «كود|رقم الشيك» في شيت الشيكات ← شيك المخازن المطابق
  function allRecs() {
    const main = App.state.records, w = WH();
    inWh = new Map();
    if (!w || w.state() !== 'ready') return main;
    const keys = new Set(main.filter(r => r.code && r.checkNo).map(r => r.code + '|' + r.checkNo));
    const extra = [];
    for (const x of w.records()) {
      if (!x.code) continue;
      const k = x.code + '|' + x.checkNo;
      if (x.checkNo && keys.has(k)) { if (!inWh.has(k)) inWh.set(k, x); continue; }
      const open = w.isOpen(x);
      extra.push({
        src: 'wh', ref: x, id: x.whId || 'صف ' + x._rowNum, code: x.code, name: x.name, drawer: x.drawer,
        wh: w.whName(x.wh) || x.wh, bank: x.bank, checkNo: x.checkNo, due: x.due, dueD: x.dueD, recvD: x.recvD,
        dueState: x.dueState, netN: open ? x.netN : x.amountN,   // المفتوح بالمتبقي، والخالص/المردود بقيمته
        isPaid: w.isPaid(x), isReturned: w.isReturned(x), isRejected: false,
        cashState: 'مخازن: ' + (x.state || '—'), position: '', note: x.notes.join(' • '),
      });
    }
    return main.concat(extra);
  }

  // ===== الالتزام بالسداد =====
  // بيتحسب من الشيكات اللي ميعادها عدّى (بعد مهلة تحصيل البنك). النسبة بالقيمة:
  // خالص وليه «تاريخ التحصيل»: اتسدد خلال المهلة = ملتزم، بعدها = نص. خالص من غير تاريخ (قبل ما العمود يتعمل) = ملتزم.
  // شيك اتدفع على دفعات (زيادات «دفعات شيكات» في سجل التعديلات): كل دفعة بتاريخها — خلال المهلة = قيمتها كاملة،
  // بعدها = نصها، والباقي اللي لسه ما اتدفعش = مش ملتزم. الدفعات اللي مالهاش تاريخ معروف (قبل السجل) = ملتزم.
  // استبدال أو اتسدد بعد رفض = نص، مرفوض أو لسه مفتوح = مش ملتزم.
  // مش داخلين في الحساب: الشيكات المردودة (مخازن: تم رد الشيك)، و«امانات لدي المورد» لأنها اتسددت
  // والعميل مالوش دعوة بموعدها
  const GRACE = 7;   // أيام بعد الاستحقاق قبل ما الشيك يتحسب متأخر
  const RATINGS = [[95, 'ممتاز', 'ok'], [85, 'جيد', 'info'], [70, 'متوسط', 'warn'], [0, 'ضعيف', 'bad']];
  const isDeposit = r => /امان/.test(r.status || '');   // الحاله: امانات لدي المورد
  const daysLate = (r, t) => Math.floor((t - r.dueD) / 864e5);
  const lateOn = (r, d) => Math.round((d - r.dueD) / 864e5);   // أيام من الاستحقاق لحد يوم الدفع
  const paidLate = r => r.isPaid && r.paidD && r.dueD ? lateOn(r, r.paidD) : null;

  // دفعات الشيكات من «سجل التعديلات» (إجراء payments في Code.gs): { NN: [[yyyy-MM-dd, مبلغ], …] }.
  // بتتحمّل في الخلفية مرة مع كل تحميل للبيانات، ولو Code.gs قديم الحساب بيفضل زي الأول
  let pays = {}, paysFor = null, paysBusy = false;
  function ensurePays() {
    const k = App.state.loadedAt;
    if (paysBusy || !k || paysFor === k) return;
    paysBusy = true;
    App.api('payments').then(d => { pays = d.map || {}; }).catch(() => { })
      .finally(() => { paysFor = k; paysBusy = false; if (/^#customers/.test(location.hash)) render(); });
  }
  // شيك ليه دفعات بتاريخها: تفاصيل كل دفعة وتقييمها. null = مفيش دفعات في السجل (الحساب العادي)
  function installments(r, t) {
    const logged = !r.src && pays[r.id];
    if (!logged || !logged.length || !r.dueD) return null;
    const parts = logged.map(([d, a]) => ({ d: App.parseDate(d), a: +a || 0 })).filter(p => p.d && p.a > 0);
    if (!parts.length) return null;
    const amount = r.amountN || parts.reduce((s, p) => s + p.a, 0);
    const loggedSum = parts.reduce((s, p) => s + p.a, 0);
    const unknown = Math.max(0, Math.min(r.paidN, amount) - loggedSum);   // اتدفع قبل السجل أو من الشيت — تاريخه مش معروف
    const rest = Math.max(0, amount - Math.max(r.paidN, loggedSum));      // الباقي بعد الدفعات
    if (r.isPaid && rest > 0) { if (r.paidD) parts.push({ d: r.paidD, a: rest, last: true }); }
    const y = { n: parts.length + (unknown > 0 ? 1 : 0) + (r.isPaid && rest > 0 && !r.paidD ? 1 : 0), base: amount,
      paid: 0, onTime: 0, credit: 0, late: [], open: 0, openDays: 0 };
    for (const p of parts) {
      const dl = lateOn(r, p.d);
      y.paid += p.a;
      if (dl <= GRACE) { y.onTime += p.a; y.credit += p.a; } else { y.credit += p.a / 2; y.late.push(dl); }
    }
    const known = unknown + (r.isPaid && rest > 0 && !r.paidD ? rest : 0);   // دفعات من غير تاريخ = في الميعاد زي الأول
    y.paid += known; y.onTime += known; y.credit += known;
    if (!r.isPaid && rest > 0) { y.open = rest; y.openDays = daysLate(r, t); }
    y.pct = y.paid ? Math.round(y.onTime / y.paid * 100) : 0;
    return y;
  }

  function commitment(list, t) {
    const due = list.filter(r => r.dueD && daysLate(r, t) > GRACE && !r.isReturned && !isDeposit(r));
    const x = { deposits: list.filter(isDeposit).length, dueCount: due.length, paid: 0, half: 0, rejected: 0, late: 0, lateAmt: 0,
      openMaxLate: 0, paidTotal: 0, dated: 0, paidLate: 0, paidAvgLate: 0, paidMaxLate: 0, inst: 0, maxLate: 0, pct: null, label: 'لا يوجد مستحق', cls: '' };
    let base = 0, credit = 0;
    const lateDays = [];   // أيام التأخير لكل دفعة اتدفعت بعد المهلة
    const openLate = (r, v) => { x.late++; x.lateAmt += v; x.openMaxLate = Math.max(x.openMaxLate, daysLate(r, t)); };
    for (const r of due) {
      const v = Math.abs(r.netN) || 0, replaced = /استبدال/.test(r.cashState || '');
      const y = !r.isRejected && !replaced ? installments(r, t) : null;
      if (y) {
        x.inst++; base += y.base; credit += y.credit; lateDays.push(...y.late);
        if (r.isPaid) { x.paidTotal++; x.dated++; y.late.length ? x.paidLate++ : x.paid++; }
        else if (y.open) openLate(r, y.open);
        continue;
      }
      base += v;
      if (r.isPaid && !r.isRejected && !replaced) {
        x.paidTotal++;
        const d = paidLate(r);
        if (d != null) x.dated++;
        if (d == null || d <= GRACE) { x.paid++; credit += v; }
        else { x.paidLate++; credit += v / 2; lateDays.push(d); }
      }
      else if (replaced || r.isPaid) { x.half++; credit += v / 2; }
      else if (r.isRejected) x.rejected++;
      else openLate(r, v);
    }
    x.paidMaxLate = lateDays.length ? Math.max(...lateDays) : 0;
    x.paidAvgLate = lateDays.length ? Math.round(lateDays.reduce((a, b) => a + b, 0) / lateDays.length) : 0;
    x.maxLate = Math.max(x.openMaxLate, x.paidMaxLate);
    if (!due.length) return x;
    x.pct = base ? Math.round(credit / base * 100) : 100;
    let i = RATINGS.findIndex(([min]) => x.pct >= min);
    if (x.rejected && i < 2) i = 2;   // شيك مرفوض لسه ما اتسددش: أعلى تقييم «متوسط»
    [, x.label, x.cls] = RATINGS[i];
    return x;
  }
  // السطر الصغير تحت الاستحقاق في جدول شيكات العميل
  function dueNote(r, t) {
    const y = !r.isRejected && !/استبدال/.test(r.cashState || '') ? installments(r, t) : null;
    if (y) {
      const tip = `title="${esc(pays[r.id].map(([d, a]) => `${d}: ${App.fmt(a)}`).join(' • ') + (r.paidD ? ` • تاريخ التحصيل ${App.iso(r.paidD)}` : ''))}"`;
      const color = y.pct === 100 && !y.open ? 'ok' : y.pct >= 50 ? 'warn' : 'bad';
      return `<span class="sub" style="color:var(--${color})" ${tip}>اتدفع ${y.n === 1 ? 'منه دفعة واحدة' : y.n === 2 ? 'على دفعتين' : `على ${y.n} دفعات`} — ${y.pct}% في الميعاد</span>` +
        (y.open && y.openDays > 0 ? `<span class="sub" style="color:var(--bad)">الباقي ${App.fmt(y.open)} متأخر ${y.openDays} يوم</span>` : '');
    }
    const d = paidLate(r);
    if (d != null) {
      const tip = `title="تاريخ التحصيل ${esc(App.iso(r.paidD))}"`;
      return d <= GRACE ? `<span class="sub" style="color:var(--ok)" ${tip}>اتسدد في الميعاد</span>`
        : `<span class="sub" style="color:var(--warn)" ${tip}>اتسدد متأخر ${d} يوم</span>`;
    }
    if (isOpen(r) && !isDeposit(r) && r.dueD && daysLate(r, t) > 0) return `<span class="sub" style="color:var(--bad)">متأخر ${daysLate(r, t)} يوم</span>`;
    return `<span class="sub">${esc(r.dueState)}</span>`;
  }
  const commitBadge = (x, withPct = true) => x.pct == null ? '<span class="muted small">لا يوجد مستحق</span>'
    : `<span class="badge ${x.cls}">${x.label}${withPct ? ` <span class="num">${x.pct}%</span>` : ''}</span>`;

  // ===== التجميع لكل عميل =====
  function aggregate(recs) {
    const t = App.today(), soon = new Date(t); soon.setDate(soon.getDate() + 30);
    const by = new Map();
    for (const r of recs) {
      if (!r.code) continue;
      if (!by.has(r.code)) by.set(r.code, []);
      by.get(r.code).push(r);
    }
    const out = [];
    for (const [code, list] of by) {
      const open = list.filter(isOpen);
      const tenors = list.filter(r => r.dueD && r.recvD).map(r => (r.dueD - r.recvD) / 864e5).filter(d => d >= 0 && d < 2000);
      const commit = commitment(list, t);
      out.push({
        commit, commitPct: commit.pct ?? -1,
        code, name: App.customers.get(code)?.name || list[0].name, wh: mode(list.map(r => r.wh)), list,
        count: list.length, whCount: list.filter(r => r.src === 'wh').length, total: sum(list), paid: sum(list.filter(r => r.isPaid)),
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
    { k: 'commitPct', t: 'الالتزام بالسداد', v: c => commitBadge(c.commit) + (c.commit.maxLate ? `<span class="sub">أقصى تأخير ${c.commit.maxLate} يوم</span>` : '') },
    { k: 'rejected', t: 'مرفوض', v: c => c.rejected ? `<span class="badge bad">${c.rejected}</span>` : '' },
    { k: 'avgDays', t: 'متوسط الأجل', v: c => c.avgDays != null ? `<span class="num">${c.avgDays}</span> يوم` : '' },
    { k: 'lastRecv', t: 'آخر استلام', v: c => `<span class="num">${App.iso(c.lastRecv)}</span>` },
  ];

  function overview(all, recs) {
    const t = App.today();
    const open = recs.filter(isOpen);
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
      (() => {
        const n = l => all.filter(c => c.commit.label === l).length, weak = n('ضعيف');
        return ['التزام ضعيف بالسداد', weak.toLocaleString('en-US'), `${n('متوسط')} متوسط • ${n('جيد')} جيد • ${n('ممتاز')} ممتاز`, weak ? 'bad' : 'ok'];
      })(),
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
    // الضغط على شهر بيفلتر جدول العملاء على اللي عندهم شيكات مفتوحة في الشهر ده (والضغط تاني بيلغي)
    const inBucket = (r, i) => isOpen(r) && r.dueD && (i === 0 ? r.dueD <= t : r.dueD > t && monthKey(r.dueD) === keys[i - 1]);
    chart('chUpcoming', {
      type: 'bar',
      data: { labels, datasets: [{ label: 'القيمة', data: vals, backgroundColor: pickColor(() => ovPick, 'u', vals.map((_, i) => i === 0 ? col.bad : col.primary)) }] },
      options: {
        maintainAspectRatio: false, scales: { y: { ticks: moneyTick } }, plugins: { legend: { display: false }, tooltip: moneyTip },
        onClick: (e, els) => {
          const el = els[0]; if (!el) return;
          const p = { chart: 'u', index: el.index, ds: null, label: el.index === 0 ? 'عندهم شيكات متأخرة' : `عندهم استحقاقات ${labels[el.index]}`, fn: c => c.list.some(r => inBucket(r, el.index)) };
          setOvPick(p);
        },
      },
    });
  }
  function setOvPick(p) {
    ovPick = !p || samePick(p, ovPick) ? null : p;
    page = 0; table(aggregate(allRecs())); recolor();
    if (ovPick) $('#custTable').closest('.table-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function table(all) {
    const q = $('#cSearch').value.trim().toLowerCase(), wh = $('#cWh').value, openOnly = $('#cOpenOnly').checked, cm = $('#cCommit').value;
    rows = all.filter(c => (!q || (c.code + ' ' + c.name).toLowerCase().includes(q)) && (!wh || c.wh === wh) && (!openOnly || c.open > 0) &&
      (!cm || (cm === 'none' ? c.commit.pct == null : c.commit.label === cm)) && (!ovPick || ovPick.fn(c)));
    $('#cPick').innerHTML = pickChip(ovPick);
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
        ['الالتزام بالسداد', c.commit.pct == null ? '—' : `${c.commit.label} ${c.commit.pct}%`,
          (c.commit.pct == null ? 'مفيش شيكات ميعادها عدّى' : `${c.commit.paid} من ${c.commit.dueCount} شيك مستحق اتسدد في الميعاد`) +
          (c.commit.paidLate ? ` • ${c.commit.paidLate} اتسدد متأخر (متوسط ${c.commit.paidAvgLate} يوم، أقصى ${c.commit.paidMaxLate})` : '') +
          (c.commit.inst ? ` • ${c.commit.inst} شيك بالدفعات متحسب كل دفعة بتاريخها` : '') +
          (c.commit.half ? ` • ${c.commit.half} استبدال/بعد رفض` : '') + (c.commit.rejected ? ` • ${c.commit.rejected} مرفوض` : '') +
          (c.commit.late ? ` • ${c.commit.late} لسه مفتوح متأخر (أقصى ${c.commit.openMaxLate} يوم)` : '') +
          (c.commit.deposits ? ` • ${c.commit.deposits} امانات لدي المورد مش محسوبة` : '') +
          (c.commit.paidTotal ? `<br>تاريخ التحصيل معروف لـ ${c.commit.dated} من ${c.commit.paidTotal} شيك خالص` +
            (c.commit.dated < c.commit.paidTotal ? ' — الباقي متحسب في الميعاد' : '') : ''), c.commit.cls],
        ['إجمالي الشيكات', App.fmt(c.total), `${c.count} شيك${c.whCount ? ` — منهم ${c.whCount} من شيت المخازن` : ''}`, ''],
        ['تم تحصيله (خالص)', App.fmt(c.paid), `نسبة التحصيل ${payRate}%`, 'ok'],
        ['الرصيد المفتوح', App.fmt(c.open), `${c.openCount} شيك`, c.open ? 'warn' : 'ok'],
        ['متأخر', App.fmt(c.overdue), `${c.overdueCount} شيك`, c.overdue ? 'bad' : ''],
        ['يستحق خلال 30 يوم', App.fmt(c.upcoming), '', ''],
        ['متوسط الأجل', c.avgDays != null ? c.avgDays + ' يوم' : '—', 'من الاستلام للاستحقاق', ''],
        ['مرفوض / استبدال', `${c.rejected} / ${c.replaced}`, c.rejected ? `مرفوض بقيمة ${App.fmtShort(c.rejectedAmt)}` : '', c.rejected ? 'bad' : ''],
      ].map(([l, v, s, k]) => `<div class="kpi ${k}"><div class="lbl">${l}</div><div class="val">${v}</div><div class="sub">${s}</div></div>`).join('')}</div>
      <div class="cols">
        <div class="card chart-card"><h3>الشيكات حسب شهر الاستحقاق${HINT}</h3><div class="chart-box"><canvas id="chCustMonthly"></canvas></div></div>
        <div class="card chart-card"><h3>حالة الصرف${HINT}</h3><div class="chart-box"><canvas id="chCustCash"></canvas></div></div>
        <div class="card chart-card"><h3>البنوك${HINT}</h3><div class="chart-box"><canvas id="chCustBank"></canvas></div></div>
      </div>
      <div class="card table-card">
        <div class="filters" style="margin:0;border-bottom:1px solid var(--border)">
          <div class="section-title"><h3>شيكات العميل</h3></div><span id="dPick" class="chips-inline"></span><span class="grow"></span>
          <select id="dSrc" autocomplete="off"><option value="">الشيتين</option><option value="main">شيت الشيكات</option><option value="wh">شيت المخازن</option></select>
          <label class="inline chk"><input type="checkbox" id="dOpenOnly" ${c.open ? 'checked' : ''}> غير الخالص فقط</label>
          <button type="button" class="btn ghost" id="dCopy" title="نسخ الجدول علشان تلصقه في Excel أو Google Sheets أو Word">📋 نسخ كجدول</button>
          <button type="button" class="btn ghost" id="dShare">📤 مشاركة</button>
        </div>
        <div class="table-wrap"><table class="grid" id="dTable"><thead><tr>
          <th>الشيت</th><th>NN / WH</th><th>شيك بأسم</th><th>الاستحقاق</th><th>البنك / رقم الشيك</th><th>الصافي</th><th>حالة الصرف</th><th>الحاله</th><th>موقف الشيك</th><th>بيان</th>
        </tr></thead><tbody></tbody></table></div>
      </div>`;

    const w = WH();
    let shown = [];   // الشيكات الظاهرة في الجدول (للمشاركة)
    let pick = null;  // العنصر المختار من الرسوم
    const drawTable = () => {
      const only = $('#dOpenOnly').checked, src = $('#dSrc').value;
      $('#dPick').innerHTML = pickChip(pick);
      const list = shown = c.list.filter(r => (!only || isOpen(r)) && (!src || (r.src || 'main') === src) && (!pick || pick.fn(r))).sort((a, b) => (b.dueD || 0) - (a.dueD || 0));
      $('#dTable tbody').innerHTML = list.map(r => {
        const twin = r.src ? null : inWh.get(r.code + '|' + r.checkNo);
        return `<tr data-id="${esc(r.id)}" data-src="${r.src || 'main'}">
        <td>${r.src ? '<span class="badge info">المخازن</span>' : '<span class="badge">الشيكات</span>'}</td>
        <td>${esc(r.id)}${twin ? `<span class="sub" title="نفس الشيك موجود في شيت المخازن">+ مخازن ${esc(twin.whId || 'صف ' + twin._rowNum)}</span>` : ''}</td><td><span class="small">${esc(r.drawer)}</span></td><td><span class="num">${esc(App.iso(r.dueD) || r.due)}</span>${dueNote(r, t)}</td>
        <td>${esc(r.bank)}<span class="sub num">${esc(r.checkNo)}</span></td><td><b class="num">${App.fmt(r.netN)}</b></td>
        <td>${r.src ? w.stateBadge(r.ref) : App.cashBadge(r)}</td><td>${r.src ? '' : App.statusBadge(r)}</td><td>${esc(r.position)}</td>
        <td class="wrap small">${esc(String(r.note || '').slice(0, 90))}</td></tr>`;
      }).join('')
        || '<tr><td colspan="11" class="muted" style="text-align:center;padding:24px">لا توجد شيكات</td></tr>';
    };
    drawTable();
    // الضغط على الرسم: نفس العنصر تاني = إلغاء. «غير الخالص فقط» بيتشال علشان الخالص يظهر لو اخترته
    const setPick = p => {
      pick = !p || samePick(p, pick) ? null : p;
      if (pick) $('#dOpenOnly').checked = false;
      drawTable(); recolor();
      if (pick) $('#dTable').closest('.table-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
    $('#dPick').addEventListener('click', e => { if (e.target.closest('[data-unpick]')) setPick(null); });
    $('#dOpenOnly').addEventListener('change', drawTable);
    const shareCfg = () => ({
      title: `شيكات العميل: ${c.name} (${c.code})`, file: 'customer-' + c.code, rows: shown,
      cols: [
        ['الشيت', r => r.src ? 'المخازن' : 'الشيكات'], ['NN / WH', r => r.id], ['شيك بأسم', r => r.drawer], ['الاستحقاق', r => App.iso(r.dueD) || r.due],
        ['البنك', r => r.bank], ['رقم الشيك', r => r.checkNo], ['الصافي', r => App.fmt(r.netN), { sum: r => r.netN, num: true }],
        ['الحاله', r => r.status || (r.ref && r.ref.state) || ''], ['موقف الشيك', r => r.position],
      ],
    });
    $('#dShare').addEventListener('click', () => App.share.open(shareCfg()));
    $('#dCopy').addEventListener('click', () => App.share.copyTable(shareCfg()));
    $('#dSrc').addEventListener('change', drawTable);
    $('#dTable tbody').addEventListener('click', e => {
      const tr = e.target.closest('tr'), id = tr?.dataset.id; if (!id) return;
      if (tr.dataset.src === 'wh') { const r = c.list.find(x => x.src === 'wh' && x.id === id); if (r) w.openForm(r.ref); }
      else App.openForm(App.state.records.find(r => r.id === id));
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
      const cat = r => r.isReturned ? -1 : r.isPaid ? 0 : r.dueD <= t ? 1 : 2;   // نفس ترتيب الأعمدة: خالص، متأخر، لم يستحق
      dated.forEach(r => {
        const i = keys.indexOf(monthKey(r.dueD)); if (i < 0) return;
        const k = cat(r); if (k < 0) return;
        [paid, openOver, openFut][k][i] += r.netN;
      });
      const DS = [['خالص', paid, col.ok], ['متأخر', openOver, col.bad], ['لم يستحق', openFut, col.warn]];
      chart('chCustMonthly', {
        type: 'bar',
        data: { labels, datasets: DS.map(([label, data, color]) => ({ label, data, backgroundColor: pickColor(() => pick, 'm', color) })) },
        options: {
          maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true, ticks: moneyTick } }, plugins: { tooltip: moneyTip, legend: { position: 'bottom' } },
          onClick: (e, els) => {
            const el = els[0]; if (!el) return;
            const key = keys[el.index], ds = el.datasetIndex;
            setPick({ chart: 'm', index: el.index, ds, label: `${labels[el.index]} — ${DS[ds][0]}`, fn: r => r.dueD && monthKey(r.dueD) === key && cat(r) === ds });
          },
        },
      });
    }

    const group = key => { const m = new Map(); c.list.forEach(r => { const k = r[key] || 'غير محدد'; m.set(k, (m.get(k) || 0) + r.netN); }); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
    const byKey = (key, label, chartId) => (e, els) => {
      const el = els[0]; if (!el) return;
      const v = label[el.index];
      setPick({ chart: chartId, index: el.index, ds: null, label: v, fn: r => (r[key] || 'غير محدد') === v });
    };
    const cash = group('cashState'), cashL = cash.map(x => x[0]);
    chart('chCustCash', {
      type: 'doughnut',
      data: { labels: cashL, datasets: [{ data: cash.map(x => x[1]), backgroundColor: pickColor(() => pick, 'c', PALETTE), borderColor: css('--surface') }] },
      options: {
        maintainAspectRatio: false, onClick: byKey('cashState', cashL, 'c'),
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: x => `${x.label}: ${App.fmt(x.parsed)}` } } },
      },
    });
    const banks = group('bank').slice(0, 8), bankL = banks.map(x => x[0]);
    chart('chCustBank', {
      type: 'bar',
      data: { labels: bankL, datasets: [{ data: banks.map(x => x[1]), backgroundColor: pickColor(() => pick, 'b', col.primary) }] },
      options: {
        indexAxis: 'y', maintainAspectRatio: false, onClick: byKey('bank', bankL, 'b'),
        scales: { x: { ticks: moneyTick }, y: { position: 'right' } }, plugins: { legend: { display: false }, tooltip: moneyTip },
      },
    });
  }

  function render() {
    WH()?.ensure();   // شيت المخازن بيتحمّل في الخلفية، ولما يخلص الشاشة بتترسم تاني بيه
    ensurePays();     // وكمان دفعات الشيكات من سجل التعديلات
    const recs = allRecs(), all = aggregate(recs);
    const code = decodeURIComponent(location.hash.split('/')[1] || '');
    const c = code && all.find(x => x.code === code);
    $('#custOverview').classList.toggle('hidden', !!c);
    $('#custDetail').classList.toggle('hidden', !c);
    if (c) { detail(c); window.scrollTo(0, 0); return; }
    App.fillSelect($('#cWh'), App.lists.wh);
    overview(all, recs);
    table(all);
  }

  App.views.customers = {
    render,
    init() {
      const re = () => { page = 0; table(aggregate(allRecs())); };
      $('#cSearch').addEventListener('input', App.debounce(re));
      $('#cWh').addEventListener('change', re);
      $('#cCommit').addEventListener('change', re);
      $('#cPick').addEventListener('click', e => { if (e.target.closest('[data-unpick]')) setOvPick(null); });
      // نسخ جدول العملاء (كل النتايج بعد الفلتر، مش الصفحة الظاهرة بس)
      $('#cCopy').addEventListener('click', () => App.share.copyTable({
        title: 'تحليل العملاء', unit: 'عميل', rows,
        cols: [
          ['الكود', c => c.code], ['العميل', c => c.name], ['المخزن', c => c.wh], ['عدد الشيكات', c => c.count],
          ['إجمالي الشيكات', c => App.fmt(c.total), { sum: c => c.total, num: true }],
          ['الرصيد المفتوح', c => App.fmt(c.open), { sum: c => c.open, num: true }],
          ['متأخر', c => App.fmt(c.overdue), { sum: c => c.overdue, num: true }],
          ['الالتزام بالسداد', c => c.commit.pct == null ? 'لا يوجد مستحق' : `${c.commit.label} ${c.commit.pct}%`],
          ['أقصى تأخير (يوم)', c => c.commit.maxLate || ''], ['مرفوض', c => c.rejected || ''],
          ['متوسط الأجل (يوم)', c => c.avgDays ?? ''], ['آخر استلام', c => App.iso(c.lastRecv)],
        ],
      }));
      $('#cOpenOnly').addEventListener('change', re);
      $('#custTable thead').addEventListener('click', e => {
        const k = e.target.closest('th')?.dataset.k; if (!k) return;
        if (k === sortKey) sortAsc = !sortAsc; else { sortKey = k; sortAsc = ['code', 'name', 'wh'].includes(k); }
        table(aggregate(allRecs()));
      });
      $('#custTable tbody').addEventListener('click', e => {
        const code = e.target.closest('tr')?.dataset.code; if (code) location.hash = '#customers/' + encodeURIComponent(code);
      });
      $('#custPager').addEventListener('click', e => { const d = +e.target.dataset.p; if (d) { page += d; table(aggregate(allRecs())); } });
    },
  };
})();
