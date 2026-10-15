/* مشاركة الجدول: واتساب (نص)، نسخ، صورة PNG، Excel (CSV)، أو قائمة المشاركة بتاعة الجهاز
   App.share.open({ title, rows, cols: [[العنوان، r => قيمة، { sum: r => رقم }]] })
   لو فيه شيكات متحددة في الجدول بيتشارك المتحدد بس */
(function () {
  'use strict';
  const App = window.App, { $, esc } = App;
  const IMG_MAX_ROWS = 300;     // أكتر من كده الصورة بتبقى طويلة جداً
  const WA_MAX_CHARS = 3500;    // روابط واتساب الطويلة بتفشل

  // تاريخ النهارده جوه جملة عربي: بالشكل 15/10/2026 (الشرطة «-» بتخلي الأجزاء تتقلب جوه النص العربي)
  const todayAr = () => { const d = App.today(); return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`; };

  // في النص والصورة: 2026-11-07 → 7/11/2026 (Excel بيفضل بالشكل الأصلي)
  const arDate = v => String(v).replace(/^(\d{4})-(\d{2})-(\d{2})$/, (m, y, mo, d) => `${+d}/${+mo}/${y}`);
  const shownRows = d => d.body.map(r => r.map(arDate));

  let cur = null;               // { title, sub, head, body, sums, file, text }

  // ===== تجهيز البيانات =====
  function prepare(o) {
    const sel = App.sel ? o.rows.filter(r => App.sel.set.has(r.id)) : [];
    const rows = sel.length ? sel : o.rows;
    const cols = o.cols;
    const head = cols.map(c => c[0]);
    const body = rows.map(r => cols.map(c => { const v = c[1](r); return v == null ? '' : String(v).trim(); }));
    const sums = cols.map(c => c[2] && c[2].sum ? rows.reduce((s, r) => s + (Number(c[2].sum(r)) || 0), 0) : null);
    const parts = [`${rows.length} شيك${sel.length ? ' (المتحدد بس)' : ''}`];
    cols.forEach((c, i) => { if (sums[i] != null) parts.push(`إجمالي ${c[0]}: ${App.fmt(sums[i])}`); });
    return { title: o.title, sub: parts.join(' — '), head, body, sums, file: o.file || 'checks', numCols: cols.map(c => !!(c[2] && c[2].num)) };
  }

  function toText(d, maxChars) {
    const lines = [`*${d.title}*`, d.sub, `بتاريخ ${todayAr()}`, '—'.repeat(12)];
    let used = lines.join('\n').length, shown = 0;
    for (const row of shownRows(d)) {
      const line = `${shown + 1}) ` + row.filter(Boolean).join(' | ');
      if (maxChars && used + line.length + 60 > maxChars) break;
      lines.push(line); used += line.length + 1; shown++;
    }
    if (shown < d.body.length) lines.push(`… و ${d.body.length - shown} شيك تاني (الجدول كامل في الصورة أو ملف Excel)`);
    return lines.join('\n');
  }

  function toCsv(d) {
    const q = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const total = d.sums.some(s => s != null) ? [d.sums.map((s, i) => s != null ? s : (i === 0 ? 'الإجمالي' : ''))] : [];
    return '﻿' + [d.head, ...d.body, ...total].map(r => r.map(q).join(',')).join('\n');
  }

  // ===== الصورة: رسم الجدول على canvas (العربي بيتكتب متصل ومن اليمين للشمال) =====
  async function toImage(d) {
    try { await document.fonts.ready; } catch { }
    const S = 2, PAD = 24, ROW = 30, FONT = '"Cairo", system-ui, sans-serif', MAXW = 280;
    const c = document.createElement('canvas'), x = c.getContext('2d');
    const rows = shownRows(d).slice(0, IMG_MAX_ROWS);
    const more = d.body.length - rows.length;
    const totals = d.sums.some(s => s != null) ? d.sums.map((s, i) => s != null ? App.fmt(s) : (i === 0 ? 'الإجمالي' : '')) : null;

    // عرض كل عمود = أطول قيمة فيه (بحد أقصى)
    x.font = `700 13px ${FONT}`;   // نفس خط العناوين وقت الرسم
    const widths = d.head.map(h => x.measureText(h).width);
    x.font = `13px ${FONT}`;
    [...rows, ...(totals ? [totals] : [])].forEach(r => r.forEach((v, i) => { widths[i] = Math.max(widths[i], Math.min(MAXW, x.measureText(v).width)); }));
    const colW = widths.map(w => Math.ceil(w) + 20);
    const tableW = colW.reduce((a, b) => a + b, 0);
    x.font = `700 20px ${FONT}`; const titleW = x.measureText(d.title).width;
    x.font = `13px ${FONT}`; const subW = x.measureText(d.sub).width;
    const W = Math.ceil(Math.max(tableW, titleW, subW, 360) + PAD * 2);
    const H = PAD + 30 + 24 + 16 + ROW * (1 + rows.length + (totals ? 1 : 0) + (more ? 1 : 0)) + 34 + PAD;

    c.width = W * S; c.height = H * S;
    x.scale(S, S);
    x.direction = 'rtl'; x.textAlign = 'right'; x.textBaseline = 'middle';
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H);

    let y = PAD + 14;
    x.fillStyle = '#0f172a'; x.font = `700 20px ${FONT}`; x.fillText(d.title, W - PAD, y);
    y += 26;
    x.fillStyle = '#475569'; x.font = `13px ${FONT}`; x.fillText(d.sub, W - PAD, y);
    y += 26;

    const fit = (t, w) => {   // قص النص الطويل بـ «…»
      if (x.measureText(t).width <= w) return t;
      while (t.length > 1 && x.measureText(t + '…').width > w) t = t.slice(0, -1);
      return t + '…';
    };
    const drawRow = (vals, bg, font, color) => {
      if (bg) { x.fillStyle = bg; x.fillRect(PAD, y, tableW, ROW); }
      x.font = font; x.fillStyle = color;
      let right = W - PAD;
      vals.forEach((v, i) => { x.fillText(fit(String(v), colW[i] - 16), right - 8, y + ROW / 2); right -= colW[i]; });
      x.strokeStyle = '#e2e8f0'; x.beginPath(); x.moveTo(PAD, y + ROW); x.lineTo(PAD + tableW, y + ROW); x.stroke();
      y += ROW;
    };
    drawRow(d.head, '#e2e8f0', `700 13px ${FONT}`, '#0f172a');
    rows.forEach((r, i) => drawRow(r, i % 2 ? '#f8fafc' : null, `13px ${FONT}`, '#0f172a'));
    if (more) drawRow([`… و ${more} شيك تاني (في ملف Excel)`, ...d.head.slice(1).map(() => '')], '#fff7ed', `13px ${FONT}`, '#9a3412');
    if (totals) drawRow(totals, '#dbeafe', `700 13px ${FONT}`, '#1d4ed8');

    y += 20;
    x.fillStyle = '#94a3b8'; x.font = `11px ${FONT}`;
    x.fillText(`إدارة الشيكات — ${todayAr()}`, W - PAD, y);
    return new Promise(res => c.toBlob(b => res(b), 'image/png'));
  }

  // ===== أدوات =====
  const download = (blob, name) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const fname = ext => `${cur.file}-${App.iso(new Date())}.${ext}`;
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch { }
    const t = $('#shText'); t.select();
    try { return document.execCommand('copy'); } catch { return false; }
  }
  const msg = (m, cls = '') => { $('#shMsg').textContent = m; $('#shMsg').className = 'small ' + cls; };

  // ===== النافذة =====
  async function open(o) {
    const d = prepare(o);
    if (!d.body.length) { App.toast('مفيش شيكات في الجدول للمشاركة'); return; }
    cur = d;
    cur.text = toText(d);
    $('#shTitle').textContent = `مشاركة: ${d.title}`;
    $('#shSub').textContent = d.sub;
    $('#shText').value = cur.text;
    $('#shImg').removeAttribute('src');
    $('#shImgWrap').classList.add('loading');
    const canShareFiles = !!(navigator.canShare && window.File && navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] }));
    $('#shNative').classList.toggle('hidden', !navigator.share);
    $('#shImgShare').classList.toggle('hidden', !canShareFiles);
    msg('');
    $('#shareDlg').showModal();
    cur.blob = await toImage(d);
    if (cur.blob) {
      $('#shImg').src = URL.createObjectURL(cur.blob);
      $('#shImgWrap').classList.remove('loading');
    }
  }

  async function shareImage() {
    if (!cur.blob) return;
    const file = new File([cur.blob], fname('png'), { type: 'image/png' });
    try { await navigator.share({ files: [file], title: cur.title, text: `${cur.title}\n${cur.sub}` }); }
    catch (e) { if (e.name !== 'AbortError') msg('⚠ ' + e.message, 'err'); }
  }

  App.share = { open };

  document.addEventListener('DOMContentLoaded', () => {
    $('#shWa').addEventListener('click', () => {
      const t = toText(cur, WA_MAX_CHARS);
      window.open('https://wa.me/?text=' + encodeURIComponent(t), '_blank', 'noopener');
      if (t.length < cur.text.length) msg('النص اتقص علشان واتساب — ابعت الصورة أو ملف Excel للجدول كامل', 'warn');
    });
    $('#shCopy').addEventListener('click', async () => { const ok = await copy(cur.text); msg(ok ? 'اتنسخ ✓ — الصقه في أي شات' : '⚠ مقدرتش أنسخ — حدد النص وانسخه بإيدك', ok ? 'ok' : 'err'); });
    $('#shImgShare').addEventListener('click', shareImage);
    $('#shImgDl').addEventListener('click', () => cur.blob && download(cur.blob, fname('png')));
    $('#shCsv').addEventListener('click', () => download(new Blob([toCsv(cur)], { type: 'text/csv;charset=utf-8' }), fname('csv')));
    $('#shNative').addEventListener('click', async () => {
      try { await navigator.share({ title: cur.title, text: cur.text }); }
      catch (e) { if (e.name !== 'AbortError') msg('⚠ ' + e.message, 'err'); }
    });
  });
})();
