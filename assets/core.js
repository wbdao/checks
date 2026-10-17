/* النواة: الإعدادات، الاتصال بـ Apps Script، نموذج البيانات، نموذج الإضافة/التعديل، التنقل */
(function () {
  'use strict';

  // أسماء أعمدة الشيت (بعد إزالة المسافات الزائدة)
  const F = {
    mm: 'mm', wh: 'المخزن', code: 'كود العميل', name: 'اسم العميل سيستم',
    amount: 'قيمة الشيك', paid: 'دفعات شيكات', net: 'صافى الشيك', month: 'الشهر', year: 'العام',
    recv: 'تاريخ الاستلام', due: 'تاريخ الاستحقاق', drawer: 'شيك بأسم', payee: 'اسم المستفيد',
    bank: 'البنك', checkNo: 'رقم الشيك', dueState: 'حالة الشيك', position: 'موقف الشيك',
    cashState: 'حالة الصرف', status: 'الحاله', outDate: 'تاريخ خروج الشيك', receiver: 'اسم المستلم',
    supplier: 'المورد المتوقع', note: 'بيان', remind: 'تذكير', id: 'NN',
  };
  const PAID_STATUS = 'خالص';
  const REJECTED = ['تم الرفض'];

  // تصميم النموذج: [مفتاح, نوع, خصائص]
  const FORM = [
    ['بيانات العميل', [
      ['code', 'text', { req: true, list: 'dl-codes' }],
      ['name', 'text', { req: true, list: 'dl-names' }],
      ['wh', 'text', { list: 'dl-wh' }],
      ['mm', 'text', { list: 'dl-mm' }],
    ]],
    ['بيانات الشيك', [
      ['checkNo', 'text', { req: true }],
      ['bank', 'text', { req: true, list: 'dl-bank' }],
      ['amount', 'number', { req: true }],
      ['paid', 'number', {}],
      ['net', 'text', { readonly: true, hint: 'يُحسب تلقائياً' }],
      ['recv', 'date', { req: true }],
      ['due', 'date', { req: true }],
      ['dueState', 'text', { readonly: true, hint: 'يُحسب تلقائياً' }],
      ['drawer', 'text', { list: 'dl-drawer' }],
      ['payee', 'text', { list: 'dl-payee' }],
    ]],
    ['المتابعة', [
      ['position', 'text', { list: 'dl-position' }],
      ['cashState', 'text', { list: 'dl-cash' }],
      ['status', 'text', { list: 'dl-status' }],
      ['outDate', 'date', {}],
      ['receiver', 'text', { list: 'dl-receiver' }],
      ['supplier', 'text', { list: 'dl-supplier' }],
    ]],
    ['ملاحظات', [
      ['note', 'textarea', { wide: true }],
      ['remind', 'textarea', { wide: true }],
    ]],
  ];

  const App = window.App = {
    VERSION: '2026-10-17 — المورد المتوقع في الشيكات',   // يتغير مع كل تحديث علشان نعرف المتصفح فاتح أنهي نسخة
    F, PAID_STATUS, REJECTED,
    state: { headers: [], rows: [], records: [], lists: {}, loaded: false, loadedAt: null },
    views: {},
  };

  // ===== أدوات عامة =====
  const $ = App.$ = (s, el = document) => el.querySelector(s);
  const esc = App.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = App.num = v => {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    const s = String(v ?? '').replace(/[,\s]/g, '');
    if (!s || s === '-') return 0;
    const n = Number(s);
    return isFinite(n) ? n : 0;
  };
  const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  App.fmt = v => nf.format(Math.round(num(v) * 100) / 100);
  App.fmtShort = v => {
    const n = num(v), a = Math.abs(n);
    if (a >= 1e6) return nf.format(Math.round(n / 1e4) / 100) + ' م';
    if (a >= 1e3) return nf.format(Math.round(n / 10) / 100) + ' ألف';
    return nf.format(n);
  };
  App.today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  App.iso = d => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
  // يقبل yyyy-MM-dd أو رقم سيريال إكسل أو d/m/yy
  App.parseDate = v => {
    if (v === '' || v == null) return null;
    if (v instanceof Date) return isNaN(v) ? null : v;
    if (typeof v === 'number') { if (v < 1000) return null; const d = new Date(Math.round((v - 25569) * 864e5)); return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m) { let y = +m[3]; if (y < 100) y += 2000; return new Date(y, +m[2] - 1, +m[1]); }
    return null;
  };
  App.label = k => F[k];
  App.debounce = (fn, ms = 180) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  App.toast = (msg, ms = 2600) => {
    const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(App._tt); App._tt = setTimeout(() => t.classList.add('hidden'), ms);
  };
  App.setStatus = (msg, isErr) => {
    const s = $('#status');
    if (!msg) { s.classList.add('hidden'); return; }
    s.innerHTML = msg; s.classList.toggle('err', !!isErr); s.classList.remove('hidden');
  };

  // ===== الإعدادات (في المتصفح فقط) =====
  const store = {
    get(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { } },
  };
  App.settings = () => ({ url: store.get('checks.apiUrl'), key: store.get('checks.apiKey'), user: store.get('checks.user').trim() });

  // ===== الاتصال =====
  // إجراءات الكتابة — بتتسجل في «سجل التعديلات» باسم الموظف، فمن غير اسم مش هتتبعت
  const WRITES = ['add', 'addMany', 'update', 'updateMany', 'whAdd', 'whUpdate', 'whFillIds'];
  // مهلة كل طلب (بالمللي ثانية) — قراءة الشيت كله ممكن تاخد وقت أول مرة
  const TIMEOUTS = { list: 120e3, listWh: 90e3, history: 60e3, backupInfo: 30e3 };
  const WRITE_TIMEOUT = 90e3;
  // طلب كتابة ما وصلش رده (النت فصل/المهلة خلصت) بيحتفظ برقمه المميز: لو اتبعت تاني بنفس البيانات
  // السيرفر بيعرف إنه نفس الطلب وما بيكتبش مرتين
  const pendingRid = new Map();
  const newRid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
    : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);

  function netError(e, write, ms) {
    const again = write ? ' — اضغط «حفظ» تاني بنفس البيانات، ولو كان اتحفظ مش هيتكرر' : ' — اضغط «حاول تاني»';
    if (e && e.name === 'AbortError') return `الشيت ما ردّش خلال ${Math.round(ms / 1000)} ثانية (النت بطيء أو Google مشغول)${write ? '. مش متأكد إن الحفظ تم' : ''}${again}`;
    if (!navigator.onLine) return 'مفيش اتصال بالإنترنت' + (write ? ' — التعديل ما اتبعتش. اضغط «حفظ» تاني لما النت يرجع' : '');
    return 'مقدرتش أوصل لـ Apps Script — اتأكد من النت ومن الرابط في ⚙ الإعدادات' + again;
  }
  function httpError(status) {
    if (status === 429) return 'Google بيقول فيه طلبات كتير — استنى دقيقة وحاول تاني';
    if (status === 404) return 'رابط Apps Script غلط أو النشر اتشال — راجع الرابط في ⚙ الإعدادات';
    if (status >= 500) return `Google مشغول دلوقتي (${status}) — حاول تاني بعد شوية`;
    return 'خطأ في الاتصال: ' + status;
  }

  App.api = async (action, payload = {}) => {
    const { url, key, user } = App.settings();
    if (!url) throw new Error('لم يتم ضبط رابط Apps Script — افتح الإعدادات');
    const write = WRITES.includes(action);
    if (write && !user) throw new Error('اكتب اسمك في ⚙ الإعدادات (اسم الموظف) الأول — علشان التعديل يتسجل باسمك');
    let rid, sig;
    if (write) { sig = action + '|' + JSON.stringify(payload); rid = pendingRid.get(sig) || newRid(); pendingRid.set(sig, rid); }
    const ms = TIMEOUTS[action] || WRITE_TIMEOUT;
    const ctrl = window.AbortController ? new AbortController() : null;
    const timer = ctrl && setTimeout(() => ctrl.abort(), ms);
    let res;
    try {
      // text/plain لتجنب طلب preflight مع Apps Script
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, key, user, rid, ...payload }), signal: ctrl ? ctrl.signal : undefined });
    } catch (e) {
      throw new Error(netError(e, write, ms));
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!res.ok) throw new Error(httpError(res.status));
    let data;
    try { data = await res.json(); } catch { throw new Error('رد غير متوقع من Apps Script — تأكد من النشر بصلاحية Anyone'); }
    if (write) pendingRid.delete(sig);   // وصل رد أكيد (نجاح أو رفض) — المرة الجاية طلب جديد
    if (!data.ok) throw new Error(data.error || 'خطأ غير معروف');
    if (data.duplicate) {
      if (data.reload) {   // النتيجة القديمة كانت كبيرة على الكاش — نحمّل البيانات من جديد
        setTimeout(() => App.load(), 0);
        throw new Error('✓ الطلب ده كان اتحفظ قبل كده (ومتكررش) — بحدّث البيانات دلوقتي');
      }
      setTimeout(() => App.toast('✓ الطلب ده كان اتحفظ قبل كده — ما اتكررش', 4000), 400);
    }
    if (data.auditError) setTimeout(() => App.toast('⚠ التعديل اتحفظ، بس ما اتسجلش في «سجل التعديلات»: ' + data.auditError, 6000), 50);
    return data;
  };

  // ===== سجل تعديلات شيك =====
  App.showHistory = async (id, title) => {
    const d = $('#histDlg'), body = $('#histBody');
    $('#histTitle').textContent = 'سجل التعديلات — ' + (title || id);
    body.innerHTML = '<p class="muted small">جاري التحميل…</p>';
    if (!d.open) d.showModal();
    try {
      const { items } = await App.api('history', { id });
      body.innerHTML = !items.length
        ? '<p class="muted small">مفيش تعديلات متسجلة على الشيك ده من الموقع. (السجل بيبدأ من وقت تركيب النسخة الجديدة من Code.gs)</p>'
        : `<div class="table-wrap" style="max-height:60vh"><table class="grid"><thead><tr>
            <th>الوقت</th><th>الموظف</th><th>العملية</th><th>العمود</th><th>قبل</th><th>بعد</th></tr></thead><tbody>
            ${items.map(x => `<tr><td class="num" dir="ltr">${esc(x.at)}</td><td>${esc(x.user)}</td><td>${esc(x.action)}</td>
              <td>${esc(x.col)}</td><td class="muted">${esc(x.old)}</td><td><b>${esc(x.new)}</b></td></tr>`).join('')}
            </tbody></table></div>`;
    } catch (e) {
      body.innerHTML = `<p class="small" style="color:var(--bad)">⚠ ${esc(/history/.test(e.message) ? 'كود Apps Script المنشور قديم — الصق Code.gs الجديد وانشر «إصدار جديد»' : e.message)}</p>`;
    }
  };

  // ===== نموذج البيانات =====
  App.toRecord = (row, idx) => {
    const r = { _row: row };
    for (const k in F) r[k] = idx[k] >= 0 ? row[idx[k]] : '';
    r.amountN = num(r.amount);
    r.paidN = num(r.paid);
    r.netN = (r.net !== '' && typeof r.net === 'number') ? r.net : r.amountN - r.paidN;
    r.dueD = App.parseDate(r.due);
    r.recvD = App.parseDate(r.recv);
    // نحسبها هنا بنفس معادلة الشيت حتى تكون محدثة دائماً
    r.dueState = r.dueD ? (r.dueD <= App.today() ? 'مستحق' : 'تحت التحصيل') : String(r.dueState || '');
    for (const k of ['code', 'name', 'wh', 'status', 'cashState', 'position', 'bank', 'id', 'checkNo', 'supplier'])
      r[k] = String(r[k] ?? '').trim();
    r.isPaid = r.status === PAID_STATUS;
    r.isRejected = REJECTED.includes(r.cashState);
    r.search = [r.id, r.code, r.name, r.checkNo, r.bank, r.drawer, r.payee, r.wh, r.position, r.supplier, r.note, r.remind].join(' ').toLowerCase();
    return r;
  };

  App.colIndex = () => {
    const h = App.state.headers.map(x => String(x).trim());
    const idx = {};
    for (const k in F) idx[k] = h.indexOf(F[k]);
    return idx;
  };

  App.load = async () => {
    App.setStatus('جاري تحميل البيانات من الشيت…');
    $('#reloadBtn').disabled = true;
    try {
      const d = await App.api('list');
      App.state.headers = d.headers;
      App.state.lists = d.lists || {};
      const idx = App.colIndex();
      if (idx.id < 0) throw new Error('عمود NN غير موجود في الشيت');
      App.state.records = d.rows.map(r => App.toRecord(r, idx)).filter(r => r.id); // صف الإجماليات أسفل الجدول ليس له NN
      App.state.loaded = true;
      App.state.loadedAt = new Date();
      App.buildIndexes();
      App.state.wh = null;   // شيت المخازن يُعاد تحميله عند فتح شاشته
      App.setStatus('');
      $('#syncInfo').textContent = `${App.state.records.length.toLocaleString('en-US')} شيك • آخر تحديث ${App.state.loadedAt.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}`;
      App.render();
    } catch (e) {
      App.setStatus('⚠ ' + esc(e.message) + ' <button type="button" class="btn" data-retry="load">⟳ حاول تاني</button>', true);
    } finally {
      $('#reloadBtn').disabled = false;
    }
  };

  // قوائم مساعدة (datalist) وخريطة العملاء
  App.buildIndexes = () => {
    const recs = App.state.records, L = App.state.lists;
    const distinct = (k, extra = []) => {
      const m = new Map();
      [...extra, ...recs.map(r => String(r[k] ?? '').trim())].forEach(v => { if (v && v !== '#N/A') m.set(v, (m.get(v) || 0) + 1); });
      return [...m.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
    };
    const cust = new Map();
    // آخر شيك لكل عميل يحدد اسمه ومخزنه الافتراضي
    [...recs].sort((a, b) => (a.recvD || 0) - (b.recvD || 0)).forEach(r => {
      if (r.code) cust.set(r.code, { code: r.code, name: r.name, wh: r.wh, mm: r.mm });
    });
    App.customers = cust;
    App.lists = {
      wh: distinct('wh', L['المخزن'] || []), status: distinct('status', L['الحاله'] || []),
      cash: distinct('cashState', L['حالة الصرف'] || []), position: distinct('position', L['موقف الشيك'] || []),
      bank: distinct('bank'), supplier: distinct('supplier'), drawer: distinct('drawer').slice(0, 800),
      payee: distinct('payee'), receiver: distinct('receiver'), mm: distinct('mm'),
      names: [...new Set([...cust.values()].map(c => c.name).filter(Boolean))],
    };
    const dl = (id, vals, labelFn) => `<datalist id="${id}">${vals.map(v => `<option value="${esc(v)}">${labelFn ? esc(labelFn(v)) : ''}</option>`).join('')}</datalist>`;
    let host = $('#datalists');
    if (!host) { host = document.createElement('div'); host.id = 'datalists'; document.body.appendChild(host); }
    host.innerHTML = [
      dl('dl-codes', [...cust.keys()], c => cust.get(c).name),
      dl('dl-names', App.lists.names), dl('dl-wh', App.lists.wh), dl('dl-mm', App.lists.mm),
      dl('dl-bank', App.lists.bank), dl('dl-drawer', App.lists.drawer), dl('dl-payee', App.lists.payee),
      dl('dl-position', App.lists.position), dl('dl-cash', App.lists.cash), dl('dl-status', App.lists.status),
      dl('dl-receiver', App.lists.receiver), dl('dl-supplier', App.lists.supplier),
    ].join('');
  };

  App.fillSelect = (sel, vals) => {
    const keep = sel.value, first = sel.options[0].outerHTML;
    sel.innerHTML = first + vals.map(v => `<option>${esc(v)}</option>`).join('');
    sel.value = keep;
  };

  App.statusBadge = r => {
    if (r.isPaid) return `<span class="badge ok">${esc(r.status)}</span>`;
    if (!r.status) return '';
    return `<span class="badge ${r.dueState === 'مستحق' ? 'bad' : 'warn'}">${esc(r.status)}</span>`;
  };
  App.cashBadge = r => {
    if (!r.cashState) return '';
    const cls = r.isRejected ? 'bad' : /تم الصرف|تم السداد/.test(r.cashState) ? 'ok' : /استبدال|رد/.test(r.cashState) ? 'warn' : 'info';
    return `<span class="badge ${cls}">${esc(r.cashState)}</span>`;
  };

  // ===== نموذج الإضافة / التعديل =====
  const dlg = () => $('#checkDlg');
  let editing = null; // السجل الجاري تعديله أو null للإضافة

  function buildForm() {
    $('#formBody').innerHTML = FORM.map(([title, fields]) => `
      <fieldset class="fieldset"><legend>${title}</legend><div class="fgrid">
        ${fields.map(([k, type, o]) => {
          const attrs = `name="${k}" id="ff-${k}" ${o.list ? `list="${o.list}"` : ''} ${o.readonly ? 'readonly tabindex="-1"' : ''} ${o.req ? 'required' : ''} autocomplete="off"`;
          const input = type === 'textarea' ? `<textarea ${attrs}></textarea>` : `<input type="${type}" ${type === 'number' ? 'step="any" min="0"' : ''} ${attrs}>`;
          return `<label class="field ${o.req ? 'req' : ''} ${o.wide ? 'wide' : ''}"><span>${F[k]}${o.hint ? ` <i class="muted">(${o.hint})</i>` : ''}</span>${input}</label>`;
        }).join('')}
      </div></fieldset>`).join('');

    const f = $('#checkForm');
    const recalc = () => {
      const net = num(f.elements.amount.value) - num(f.elements.paid.value);
      f.elements.net.value = App.fmt(net);
      const d = App.parseDate(f.elements.due.value);
      f.elements.dueState.value = d ? (d <= App.today() ? 'مستحق' : 'تحت التحصيل') : '';
    };
    f.elements.amount.addEventListener('input', recalc);
    f.elements.paid.addEventListener('input', recalc);
    f.elements.due.addEventListener('input', recalc);
    f.elements.code.addEventListener('change', () => {
      const c = App.customers.get(f.elements.code.value.trim());
      if (!c) return;
      f.elements.name.value = c.name;
      if (!f.elements.wh.value) f.elements.wh.value = c.wh || '';
      if (!f.elements.mm.value) f.elements.mm.value = c.mm || '';
    });
    f.elements.name.addEventListener('change', () => {
      if (f.elements.code.value) return;
      const c = [...App.customers.values()].find(c => c.name === f.elements.name.value.trim());
      if (c) { f.elements.code.value = c.code; if (!f.elements.wh.value) f.elements.wh.value = c.wh || ''; if (!f.elements.mm.value) f.elements.mm.value = c.mm || ''; }
    });
    App._recalc = recalc;
  }

  const toInputDate = v => App.iso(App.parseDate(v));
  // القيمة الحالية بنفس شكل خانة الإدخال (للمقارنة قبل الحفظ)
  const asInput = (k, type, r) => {
    const v = r[k] ?? '';
    if (type === 'date') return toInputDate(v);
    if (type === 'number') return v === '' && k !== 'paid' ? '' : num(v);
    return String(v).trim();
  };

  App.openForm = (rec, preset) => {
    if (!App.state.loaded) { App.toast('حمّل البيانات أولاً'); return; }
    editing = rec || null;
    const f = $('#checkForm');
    f.reset();
    f.querySelectorAll('.field.invalid').forEach(x => x.classList.remove('invalid'));
    $('#formMsg').textContent = ''; $('#formMsg').className = 'small';
    const src = rec || preset || {};
    for (const [, fields] of FORM) for (const [k, type] of fields) {
      let v = src[k] ?? '';
      if (type === 'date') v = toInputDate(v);
      if (type === 'number') v = v === '' ? '' : num(v);
      f.elements[k].value = v;
    }
    if (!rec && !src.recv) f.elements.recv.value = App.iso(App.today());
    App._recalc();
    $('#dlgTitle').textContent = rec ? `تعديل الشيك ${rec.id}` : 'إضافة شيك جديد';
    $('#dupBtn').classList.toggle('hidden', !rec);
    $('#histBtn').classList.toggle('hidden', !rec);
    dlg().showModal();
    (rec ? f.elements.status : f.elements.code).focus();
  };

  function readForm() {
    const f = $('#checkForm');
    const out = {};
    for (const [, fields] of FORM) for (const [k, type, o] of fields) {
      if (o.readonly) continue;
      let v = f.elements[k].value.trim();
      if (type === 'number') v = v === '' ? (k === 'paid' ? 0 : '') : Number(v);
      out[k] = v;
    }
    return out;
  }

  function validate(data) {
    const f = $('#checkForm');
    let bad = [];
    f.querySelectorAll('.field').forEach(x => x.classList.remove('invalid'));
    for (const [, fields] of FORM) for (const [k, , o] of fields) {
      if (o.req && (data[k] === '' || data[k] == null)) bad.push(k);
    }
    if (data.amount !== '' && !(data.amount > 0)) bad.push('amount');
    if (num(data.paid) > num(data.amount)) bad.push('paid');
    bad.forEach(k => f.elements[k].closest('.field').classList.add('invalid'));
    if (bad.length) return 'برجاء استكمال/تصحيح الحقول المحددة: ' + [...new Set(bad)].map(k => F[k]).join('، ');
    return '';
  }

  // تحذير عند تكرار نفس رقم الشيك لنفس البنك
  function duplicateOf(data) {
    const no = String(data.checkNo).trim(), bank = String(data.bank).trim();
    return App.state.records.find(r => r !== editing && r.checkNo === no && r.bank === bank);
  }

  async function save(ev) {
    ev.preventDefault();
    const data = readForm();
    const msg = $('#formMsg');
    const err = validate(data);
    if (err) { msg.textContent = err; msg.className = 'small err'; return; }
    const dup = duplicateOf(data);
    if (dup && msg.dataset.confirmDup !== dup.id) {
      msg.textContent = `⚠ رقم الشيك موجود بالفعل لنفس البنك (${dup.id} — ${dup.name}). اضغط حفظ مرة أخرى للتأكيد.`;
      msg.className = 'small warn'; msg.dataset.confirmDup = dup.id; return;
    }
    delete msg.dataset.confirmDup;

    // نرسل بأسماء أعمدة الشيت. في التعديل نبعت الخانات اللي اتغيرت بس — علشان لو موظف تاني
    // عدّل خانة تانية في نفس الشيك من جهاز تاني، تعديله ما يتمسحش بالقيم القديمة اللي على الشاشة هنا
    const record = {};
    for (const [, fields] of FORM) for (const [k, type, o] of fields) {
      if (o.readonly) continue;
      if (editing && String(asInput(k, type, editing)) === String(data[k])) continue;
      record[F[k]] = data[k];
    }
    if (editing && !Object.keys(record).length) { dlg().close(); App.toast('لا يوجد أي تغيير'); return; }
    const btn = $('#saveBtn'); btn.disabled = true; msg.textContent = 'جاري الحفظ في الشيت…'; msg.className = 'small';
    try {
      const res = editing ? await App.api('update', { id: editing.id, record }) : await App.api('add', { record });
      const idx = App.colIndex();
      const fresh = App.toRecord(res.row, idx);
      if (editing) {
        const i = App.state.records.indexOf(editing);
        App.state.records[i] = fresh;
      } else {
        App.state.records.push(fresh);
      }
      App.buildIndexes();
      dlg().close();
      App.toast(editing ? `تم حفظ التعديل على ${fresh.id} ✓` : `تمت إضافة الشيك ${fresh.id} ✓`);
      App.render();
    } catch (e) {
      msg.textContent = '⚠ ' + e.message; msg.className = 'small err';
    } finally {
      btn.disabled = false;
    }
  }

  // ===== الإعدادات =====
  // سطر صغير في الإعدادات: آخر نسخة احتياطية للشيت
  async function showBackupInfo() {
    const el = $('#backupInfo'); el.textContent = ''; el.className = 'muted small';
    if (!App.settings().url) return;
    try {
      const b = await App.api('backupInfo');
      if (b.scheduled && b.last) { el.innerHTML = `🗄 النسخ الاحتياطي اليومي شغال — آخر نسخة: <b>${esc(b.last)}</b> (${b.count} نسخة)`; return; }
      el.textContent = b.count
        ? `🗄 آخر نسخة احتياطية: ${b.last} — بس النسخ اليومي مش متجدول. شغّل setupDailyBackup من Apps Script`
        : '⚠ مفيش نسخ احتياطي لسه — شغّل setupDailyBackup مرة واحدة من محرر Apps Script (الخطوات في README)';
      el.className = 'small warn-text';
    } catch (e) {
      // كود قديم أو صلاحية Drive لسه ما اتدّتش — مش هنزعج المستخدم
      if (!/backupInfo/.test(e.message)) { el.textContent = '🗄 حالة النسخ الاحتياطي مش متاحة: ' + e.message; }
    }
  }

  function openSettings() {
    const s = App.settings();
    $('#sUser').value = s.user; $('#sUrl').value = s.url; $('#sKey').value = s.key; $('#sMsg').textContent = '';
    $('#appVersion').textContent = `إصدار الموقع: ${App.VERSION}`;
    showBackupInfo();
    $('#settingsDlg').showModal();
    (s.user ? $('#sUrl') : $('#sUser')).focus();
  }
  async function saveSettings(ev) {
    ev.preventDefault();
    const user = $('#sUser').value.trim();
    if (!user) { $('#sMsg').textContent = 'اكتب اسم الموظف'; $('#sMsg').className = 'small err'; $('#sUser').focus(); return; }
    store.set('checks.user', user);
    store.set('checks.apiUrl', $('#sUrl').value.trim());
    store.set('checks.apiKey', $('#sKey').value.trim());
    const m = $('#sMsg'); m.textContent = 'جاري الاختبار…'; m.className = 'small';
    try {
      await App.api('list');
      m.textContent = 'تم الاتصال ✓'; m.className = 'small ok';
      setTimeout(() => $('#settingsDlg').close(), 500);
      App.load();
    } catch (e) { m.textContent = '⚠ ' + e.message; m.className = 'small err'; }
  }

  // ===== التنقل =====
  App.currentView = () => (location.hash.replace('#', '').split('/')[0] || 'checks');
  App.render = () => {
    const v = App.currentView();
    // رسائل خاصة بشاشة معيّنة ما تفضلش ظاهرة في الشاشات التانية
    if (App.statusOwner && App.statusOwner !== v) { App.setStatus(''); App.statusOwner = null; }
    document.querySelectorAll('.tabs a').forEach(a => a.classList.toggle('active', a.dataset.view === v));
    // على الموبايل التبويبات بتتحرك بالسحب — نخلي التبويب الحالي ظاهر
    const act = document.querySelector('.tabs a.active'), bar = act && act.parentElement;
    if (bar && bar.scrollWidth > bar.clientWidth) {
      const a = act.getBoundingClientRect(), b = bar.getBoundingClientRect();
      if (a.left < b.left || a.right > b.right) bar.scrollLeft += (a.left + a.width / 2) - (b.left + b.width / 2);
    }
    document.querySelectorAll('.view').forEach(s => s.classList.toggle('hidden', s.id !== 'view-' + v));
    if (App.state.loaded && App.views[v]) App.views[v].render();
  };

  // ===== الجداول على الموبايل =====
  // كل خلية بتاخد اسم عمودها (data-label)، والـ CSS بيعرض الصف ككارت «العمود: القيمة» على الشاشات الصغيرة
  const CARD_TABLES = '#checksTable, #custTable, #supTable, #supSumTable, #whTable, #whSumTable, #trTable, #dTable';
  function labelCells() {
    document.querySelectorAll(CARD_TABLES).forEach(t => {
      t.classList.add('cards');
      const heads = [...t.querySelectorAll('thead th')].map(th => th.classList.contains('selc') ? '' : th.textContent.trim());
      t.querySelectorAll('tbody tr').forEach(tr => {
        if (tr.cells.length !== heads.length) return;          // صف «لا توجد نتائج» أو ما شابه
        [...tr.cells].forEach((td, i) => {
          if (td.dataset.label !== heads[i]) td.dataset.label = heads[i];
          const empty = !td.textContent.trim() && !td.querySelector('input, img, svg');
          if (empty !== ('empty' in td.dataset)) empty ? td.dataset.empty = '' : delete td.dataset.empty;
        });
      });
    });
  }
  let labelQueued = false;
  new MutationObserver(() => {
    if (labelQueued) return;
    labelQueued = true;
    requestAnimationFrame(() => { labelQueued = false; labelCells(); });
  }).observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('DOMContentLoaded', () => {
    buildForm();
    $('#checkForm').addEventListener('submit', save);
    $('#dupBtn').addEventListener('click', () => {
      const data = readForm();
      data.checkNo = ''; data.id = '';
      App.openForm(null, data);
    });
    $('#histBtn').addEventListener('click', () => editing && App.showHistory(editing.id, `${editing.id} — ${editing.name} — رقم الشيك ${editing.checkNo}`));
    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
    $('#settingsBtn').addEventListener('click', openSettings);
    $('#settingsForm').addEventListener('submit', saveSettings);
    $('#reloadBtn').addEventListener('click', App.load);
    window.addEventListener('hashchange', App.render);
    $('#status').addEventListener('click', e => {
      const b = e.target.closest('[data-retry]'); if (!b) return;
      if (b.dataset.retry === 'load') App.load();
      else if (b.dataset.retry === 'wh' && App.views.warehouses) { App.state.wh = null; App.views.warehouses.render(); }
    });
    window.addEventListener('offline', () => { document.body.classList.add('offline'); App.toast('📴 النت فصل — التعديلات مش هتتحفظ لحد ما يرجع', 6000); });
    window.addEventListener('online', () => { document.body.classList.remove('offline'); App.toast('✓ النت رجع', 3000); });
    if (!navigator.onLine) document.body.classList.add('offline');
    // لو الصفحة مفتوحة من أكتر من 10 دقايق ورجعتلها — نحدّث البيانات (موظفين تانيين ممكن يكونوا عدّلوا)
    document.addEventListener('visibilitychange', () => {
      const busy = document.querySelector('dialog[open]') || (App.sel && App.sel.set.size);
      if (document.visibilityState === 'visible' && App.state.loadedAt && !busy && Date.now() - App.state.loadedAt > 10 * 60e3) App.load();
    });
    Object.values(App.views).forEach(v => v.init && v.init());
    App.render();
    if (App.settings().url) {
      App.load();
      if (!App.settings().user) openSettings();   // الأجهزة اللي اتظبطت قبل سجل التعديلات
    } else {
      App.setStatus('مرحباً 👋 — لربط الموقع بالشيت اضغط <b>⚙ الإعدادات</b> وأدخل رابط Apps Script ورمز الدخول (الخطوات في README.md).');
      openSettings();
    }
  });
})();
