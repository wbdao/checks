/* تحديد أكثر من شيك + التعديل الجماعي
   كل شاشة مربوطة بـ«سياق» (شيت الشيكات أو شيت المخازن) بيحدد الأعمدة وطريقة الحفظ */
(function () {
  'use strict';
  const App = window.App, { $, esc, F } = App;
  const CHUNK = 300;

  // ===== سياق شيت الشيكات الرئيسي =====
  const MAIN = {
    labels: F,
    // الأعمدة المسموح تعديلها جماعياً: [المفتاح، النوع، datalist]
    fields: [
      ['position', 'text', 'dl-position'], ['cashState', 'text', 'dl-cash'], ['status', 'text', 'dl-status'],
      ['outDate', 'date'], ['receiver', 'text', 'dl-receiver'], ['supplier', 'text', 'dl-supplier'],
      ['note', 'text'], ['remind', 'text'], ['due', 'date'], ['wh', 'text', 'dl-wh'], ['mm', 'text', 'dl-mm'],
      ['payee', 'text', 'dl-payee'],
    ],
    texts: ['note', 'remind'],                 // يمكن الإضافة في آخر النص بدل الاستبدال
    first: () => App.currentView() === 'suppliers' ? 'cashState' : 'position',
    idHead: 'NN',
    idOf: r => r.id,
    action: 'updateMany',
    byId: id => App.state.records.find(r => r.id === id),
    async send(items) {
      const res = await App.api('updateMany', { updates: items.map(u => ({ id: u.r.id, record: u.record })) });
      const idx = App.colIndex();
      res.rows.forEach((row, j) => {
        const at = App.state.records.findIndex(r => r.id === res.ids[j]);
        if (at >= 0) App.state.records[at] = App.toRecord(row, idx);
      });
      return res.rows.length;
    },
    finish() { App.buildIndexes(); App.render(); },
  };

  const contexts = { checks: MAIN, suppliers: MAIN, treasury: MAIN };
  const ctx = () => contexts[App.currentView()];
  const nameOf = k => (C.display && C.display[k]) || C.labels[k];   // اسم العرض (الحفظ دايماً باسم العمود في الشيت)

  const sel = new Set();
  let lastClicked = null;               // لتحديد مدى بالضغط مع Shift

  const selected = () => { const c = ctx(); return c ? [...sel].map(c.byId).filter(Boolean) : []; };

  // ===== أدوات الجداول =====
  const cell = r => `<td class="selc"><input type="checkbox" data-sel="${esc(r.id)}" ${sel.has(r.id) ? 'checked' : ''} aria-label="تحديد"></td>`;
  const head = () => `<th class="selc" data-k=""><input type="checkbox" data-selall title="تحديد كل النتائج (بعد الفلتر)" aria-label="تحديد الكل"></th>`;

  // تحديث حالة مربع «تحديد الكل» وتلوين الصفوف المحددة
  function sync(table, list) {
    const all = table.querySelector('[data-selall]');
    if (all) {
      const n = list.filter(r => sel.has(r.id)).length;
      all.checked = n > 0 && n === list.length;
      all.indeterminate = n > 0 && n < list.length;
    }
    table.querySelectorAll('tbody tr').forEach(tr => {
      const cb = tr.querySelector('[data-sel]'); if (!cb) return;
      const on = sel.has(cb.dataset.sel);
      tr.classList.toggle('selected', on);
      cb.checked = on;
    });
    bar();
  }

  // ربط جدول: getList = القائمة المفلترة الحالية بالترتيب
  function bind(table, getList) {
    table.addEventListener('click', e => {
      const cb = e.target.closest('[data-sel],[data-selall]');
      const td = e.target.closest('.selc');
      if (!td) return;
      e.stopPropagation();
      const list = getList();
      if (cb && cb.hasAttribute('data-selall')) {
        const on = cb.checked;
        list.forEach(r => on ? sel.add(r.id) : sel.delete(r.id));
      } else {
        const box = td.querySelector('[data-sel]');
        const id = box.dataset.sel;
        if (!cb) box.checked = !box.checked;     // ضغطة على الخلية حول المربع
        const on = box.checked;
        if (e.shiftKey && lastClicked) {
          const ids = list.map(r => r.id), a = ids.indexOf(lastClicked), b = ids.indexOf(id);
          if (a >= 0 && b >= 0) ids.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(x => on ? sel.add(x) : sel.delete(x));
        }
        on ? sel.add(id) : sel.delete(id);
        lastClicked = id;
      }
      sync(table, list);
    }, true);
  }

  function bar() {
    const rs = selected();
    $('#selBar').classList.toggle('hidden', !rs.length);
    if (!rs.length) return;
    $('#selInfo').innerHTML = `تم تحديد <b>${rs.length}</b> شيك — قيمة <b class="num">${App.fmt(rs.reduce((s, r) => s + r.amountN, 0))}</b> <span class="muted small">(Shift + ضغطة لتحديد مدى)</span>`;
  }

  function clear() {
    sel.clear(); lastClicked = null;
    document.querySelectorAll('[data-sel]').forEach(cb => cb.checked = false);
    document.querySelectorAll('tr.selected').forEach(tr => tr.classList.remove('selected'));
    document.querySelectorAll('[data-selall]').forEach(cb => { cb.checked = false; cb.indeterminate = false; });
    bar();
  }

  // ===== نافذة التعديل الجماعي =====
  let C = MAIN;   // السياق وقت فتح النافذة

  function fieldRow(key = '') {
    const used = [...document.querySelectorAll('#bulkFields .bulk-row select.col')].map(s => s.value);
    const k = key || (C.fields.find(f => !used.includes(f[0])) || C.fields[0])[0];
    const div = document.createElement('div');
    div.className = 'bulk-row';
    div.innerHTML = `
      <select class="col" aria-label="العمود">${C.fields.map(([fk]) => `<option value="${fk}" ${fk === k ? 'selected' : ''}>${esc(nameOf(fk))}</option>`).join('')}</select>
      <input class="val" autocomplete="off" aria-label="القيمة الجديدة">
      <select class="mode" aria-label="طريقة التعديل"><option value="set">استبدال القيمة</option><option value="append">إضافة في آخر النص</option></select>
      <button type="button" class="x" title="حذف">✕</button>`;
    const setType = () => {
      const f = C.fields.find(x => x[0] === div.querySelector('.col').value);
      const inp = div.querySelector('.val');
      inp.type = f[1]; inp.value = '';
      f[2] ? inp.setAttribute('list', f[2]) : inp.removeAttribute('list');
      inp.placeholder = f[1] === 'date' ? '' : 'القيمة الجديدة (اتركها فاضية لمسح الخانة)';
      const mode = div.querySelector('.mode');
      mode.value = 'set';
      mode.classList.toggle('hidden-keep', !C.texts.includes(f[0]));
      preview();
    };
    div.querySelector('.col').addEventListener('change', setType);
    div.querySelector('.val').addEventListener('input', preview);
    div.querySelector('.mode').addEventListener('change', preview);
    div.querySelector('.x').addEventListener('click', () => { div.remove(); preview(); });
    $('#bulkFields').appendChild(div);
    setType();
  }

  function changes() {
    return [...document.querySelectorAll('#bulkFields .bulk-row')].map(d => ({
      k: d.querySelector('.col').value, v: d.querySelector('.val').value.trim(), mode: d.querySelector('.mode').value,
    }));
  }
  const newValue = (r, c) => {
    if (c.mode === 'append' && C.texts.includes(c.k)) {
      const old = shown(r, c.k).trim();
      return old && c.v ? `${old} + ${c.v}` : (old || c.v);
    }
    return c.v;
  };
  // القيمة الحالية بنفس شكل خانة الإدخال (التواريخ yyyy-mm-dd)
  const shown = (r, k) => {
    const f = C.fields.find(x => x[0] === k);
    const v = r[k];
    if (f && f[1] === 'date') return App.iso(App.parseDate(v)) || String(v ?? '');
    const s = String(v ?? '');
    return s.trim() === '#N/A' ? '' : s;
  };

  function preview() {
    const rs = selected(), cs = changes();
    const dupCols = cs.map(c => c.k).filter((k, i, a) => a.indexOf(k) !== i);
    $('#bulkPreview thead').innerHTML = `<tr><th>${esc(C.idHead)}</th><th>العميل</th>${cs.map(c => `<th>${esc(nameOf(c.k))}</th>`).join('')}</tr>`;
    $('#bulkPreview tbody').innerHTML = rs.slice(0, 200).map(r => `<tr><td>${esc(C.idOf(r))}</td><td>${esc(r.name)}</td>${cs.map(c => {
      const o = shown(r, c.k), n = newValue(r, c);
      return `<td class="wrap small">${o === n ? `<span class="muted">${esc(o) || '—'} (بدون تغيير)</span>` : `<span class="chg-old">${esc(o) || '—'}</span><br><span class="chg-new">${esc(n) || '(فارغ)'}</span>`}</td>`;
    }).join('')}</tr>`).join('') + (rs.length > 200 ? `<tr><td colspan="${cs.length + 2}" class="muted">… و ${rs.length - 200} شيك آخر</td></tr>` : '');
    const msg = $('#bulkMsg');
    const empties = cs.filter(c => !c.v && c.mode === 'set').map(c => nameOf(c.k));
    if (dupCols.length) { msg.textContent = '⚠ نفس العمود مختار أكتر من مرة'; msg.className = 'small err'; }
    else if (empties.length) { msg.textContent = `⚠ القيمة فاضية — هيتم مسح خانة: ${empties.join('، ')}`; msg.className = 'small warn'; }
    else { msg.textContent = ''; msg.className = 'small'; }
    $('#bulkSave').disabled = !cs.length || dupCols.length > 0;
    $('#bulkSave').textContent = `حفظ التعديل على ${rs.length} شيك`;
  }

  function open() {
    C = ctx();
    const rs = selected();
    if (!C || !rs.length) return;
    $('#bulkTitle').textContent = `تعديل جماعي — ${rs.length} شيك${C.title ? ' — ' + C.title : ''}`;
    $('#bulkFields').innerHTML = '';
    fieldRow(C.first());
    $('#bulkDlg').showModal();
    $('#bulkFields .val').focus();
  }

  async function save(ev) {
    ev.preventDefault();
    const rs = selected(), cs = changes();
    if (!rs.length || !cs.length) return;
    // كل شيك بقيمه، والشيكات اللي مش هتتغير بتتشال
    const items = rs.map(r => {
      const record = {};
      let changed = false;
      cs.forEach(c => { const n = newValue(r, c); record[C.labels[c.k]] = n; if (n !== shown(r, c.k)) changed = true; });
      return { r, record, changed };
    }).filter(u => u.changed);
    const msg = $('#bulkMsg'), btn = $('#bulkSave');
    if (!items.length) { msg.textContent = 'لا يوجد أي تغيير'; msg.className = 'small warn'; return; }
    btn.disabled = true;
    let done = 0;
    try {
      for (let i = 0; i < items.length; i += CHUNK) {
        msg.textContent = `جاري الحفظ في الشيت… ${done} / ${items.length}`; msg.className = 'small';
        done += await C.send(items.slice(i, i + CHUNK));
      }
      $('#bulkDlg').close();
      clear();
      App.toast(`تم تعديل ${done} شيك ✓`, 3500);
      C.finish();
    } catch (e) {
      msg.textContent = new RegExp(C.action).test(e.message)
        ? '⚠ كود Apps Script المنشور قديم — الصق Code.gs الجديد وانشر «إصدار جديد» (لم يتم تعديل أي شيك)'
        : `⚠ ${e.message}` + (done ? ` — تم تعديل ${done} شيك قبل الخطأ` : '');
      msg.className = 'small err';
      if (done) C.finish();
    } finally {
      btn.disabled = false;
    }
  }

  // شاشة تانية (زي شيكات المخازن) بتسجّل سياقها
  const register = (view, c) => { contexts[view] = c; };

  App.sel = { set: sel, cell, head, sync, bind, clear, bar, register };

  document.addEventListener('DOMContentLoaded', () => {
    $('#selClear').addEventListener('click', clear);
    $('#selEdit').addEventListener('click', open);
    $('#bulkAddField').addEventListener('click', () => fieldRow());
    $('#bulkForm').addEventListener('submit', save);
    window.addEventListener('hashchange', bar);
  });
})();
