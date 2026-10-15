/**
 * واجهة برمجية لشيت الشيكات — تُنشر كـ Web App من داخل الشيت (Extensions > Apps Script).
 * كل الطلبات POST بجسم JSON نصي: { action, key, ... }
 *   list   → يرجع رؤوس الأعمدة وكل الصفوف + قوائم الاختيار من شيت "معاملات"
 *   add    → يضيف شيك جديد (يولّد NN تلقائياً ويكتب معادلات الأعمدة المحسوبة)
 *   update → يعدّل شيك موجود بالـ NN
 */

// ===== الإعدادات =====
const SECRET = 'غيّر-هذا-الرمز';          // نفس الرمز يُكتب في إعدادات الموقع
const DATA_SHEET = 'الشيكات (2)';
const LISTS_SHEET = 'معاملات';
const ID_HEADER = 'NN';
const ID_PREFIX = 'CH';
const ID_DIGITS = 6;

// أعمدة محسوبة بمعادلات — لا تُكتب من الموقع. {col} يُستبدل بحرف العمود و {r} برقم الصف
const FORMULAS = {
  'صافى الشيك': '=+{قيمة الشيك}{r}-{دفعات شيكات}{r}',
  'الشهر': '=MONTH({تاريخ الاستحقاق}{r})',
  'العام': '=+YEAR({تاريخ الاستحقاق}{r})',
  'حالة الشيك': '=IF({تاريخ الاستحقاق}{r}<=TODAY(),"مستحق","تحت التحصيل")',
};
const DATE_HEADERS = ['تاريخ الاستلام', 'تاريخ الاستحقاق', 'تاريخ خروج الشيك'];
const NUMBER_HEADERS = ['قيمة الشيك', 'دفعات شيكات', 'mm'];

// شيت شيكات المخازن — العناوين في الصف الثاني لأن الأول فيه الإجماليات، ولا يوجد عمود ID
// فالتعديل يتم برقم الصف بعد التأكد إن «رقم الشيك» في الصف لسه زي ما هو
const WH_SHEET = 'شيكات المخازن';
let WH_HEADER_ROW = 2;               // بيتحدد تلقائياً: أول صف فيه «رقم الشيك» و«كود العميل»
const WH_MATCH = 'رقم الشيك';
const WH_ID_HEADER = 'WH';            // كود ثابت لكل شيك: WH00001، WH00002…
const WH_ID_PREFIX = 'WH';
const WH_ID_DIGITS = 5;
const WH_KEYS = ['رقم الشيك', 'كود العميل', 'قيمة الشيك'];          // صف فيه أي واحد منهم = صف بيانات
const WH_NUMBERS = ['قيمة الشيك', 'التحصيل', 'المخزن'];
const WH_FORMULAS = {
  'الصافي': "={قيمة الشيك}{r}-{التحصيل}{r}",
  'حالة الشيك': '=IF({تاريخ الاستحقاق}{r}<=TODAY(),"مستحق","تحت التحصيل")',
  'Column1': "=VLOOKUP({رقم الشيك}{r},'الشيكات (2)'!O:Q,1,0)",
};

// قوائم الاختيار: رقم العمود في شيت "معاملات" (A=1)
const LISTS = { 'موقف الشيك': 1, 'حالة الصرف': 3, 'الحاله': 4, 'المخزن': 5 };

// سجل التعديلات: كل إجراءات الكتابة لازم يتبعت معاها user (اسم الموظف)، وبيتسجل صف لكل خانة اتغيرت
// (وصف لكل شيك جديد) في شيت «سجل التعديلات» — بيتعمل لوحده لو مش موجود. history → سجل شيك واحد بالـ NN أو WH
const LOG_SHEET = 'سجل التعديلات';
const LOG_HEADERS = ['الوقت', 'الموظف', 'العملية', 'الشيت', 'كود الشيك', 'العمود', 'القيمة القديمة', 'القيمة الجديدة'];
const LOG_MAIN = 'الشيكات', LOG_WH = 'شيكات المخازن';
const WRITE_ACTIONS = {
  add: 'إضافة', addMany: 'إدراج من جدول', update: 'تعديل', updateMany: 'تعديل جماعي',
  whAdd: 'إضافة', whUpdate: 'تعديل', whFillIds: 'إعطاء أكواد WH',
};
const NEW_CHECK = '(شيك جديد)';
const NEW_SUMMARY = ['كود العميل', 'اسم العميل سيستم', 'اسم العميل', 'رقم الشيك', 'البنك', 'قيمة الشيك', 'تاريخ الاستحقاق'];
// منع التكرار: كل طلب كتابة من الموقع معاه rid (رقم مميز). لو نفس الـ rid رجع تاني خلال 6 ساعات
// (النت فصل والموظف داس حفظ تاني) بيرجع نفس النتيجة القديمة من غير ما يكتب تاني
const RID_TTL = 6 * 60 * 60;           // بالثواني (أقصى مدة في CacheService)
const RID_MAX_CHARS = 90000;            // القيمة في الكاش حدها 100KB — لو النتيجة أكبر بنحفظ «اعمل تحديث» بس

// النسخ الاحتياطي اليومي: شغّل setupDailyBackup مرة واحدة من محرر Apps Script
const BACKUP_FOLDER = 'نسخ احتياطية - شيت الشيكات';
const BACKUP_KEEP = 30;                 // أقدم من كده بتروح سلة المهملات في Drive (مش بتتمسح نهائي)
const BACKUP_HOUR = 2;                  // الساعة 2 بالليل

let AUDIT_ = null;   // صفوف السجل للطلب الحالي: [شيت, كود, عمود, قديم, جديد] — بتتكتب مرة واحدة في آخر الطلب

// منطقة الشيت الزمنية (مش منطقة مشروع Apps Script) علشان التواريخ ما تتزحزحش يوم
function tz_() { return SpreadsheetApp.getActive().getSpreadsheetTimeZone(); }

function doPost(e) {
  let out;
  try {
    const req = JSON.parse(e.postData.contents || '{}');
    if (SECRET === 'غيّر-هذا-الرمز') throw new Error('غيّر SECRET في السطر 10 من Code.gs قبل الاستخدام');
    if (req.key !== SECRET) throw new Error('رمز الدخول غير صحيح');
    if (WRITE_ACTIONS[req.action]) {
      req.user = String(req.user || '').trim().slice(0, 60);
      if (!req.user) throw new Error('اكتب اسمك في ⚙ الإعدادات (اسم الموظف) علشان التعديل يتسجل باسمك — لو الخانة مش ظاهرة اضغط Ctrl+F5');
    }
    if (req.action === 'list') out = list_();
    else if (req.action === 'history') out = history_(req.id);
    else if (req.action === 'add') out = withLock_(req, () => { const r = addMany_([req.record]); return { id: r.ids[0], row: r.rows[0] }; });
    else if (req.action === 'addMany') out = withLock_(req, () => addMany_(req.records));
    else if (req.action === 'update') out = withLock_(req, () => update_(req.id, req.record));
    else if (req.action === 'updateMany') out = withLock_(req, () => updateMany_(req.updates));
    else if (req.action === 'listWh') { whSheet_(); out = readSheet_(WH_SHEET, WH_HEADER_ROW); out.headerRow = WH_HEADER_ROW; }
    else if (req.action === 'whAdd') out = withLock_(req, () => whAdd_(req.records));
    else if (req.action === 'whUpdate') out = withLock_(req, () => whUpdate_(req.updates));
    else if (req.action === 'whFillIds') out = withLock_(req, () => whFillIds_());
    else if (req.action === 'backupInfo') out = backupInfo_();
    else throw new Error('إجراء غير معروف: ' + req.action);
    out.ok = true;
  } catch (err) {
    out = { ok: false, error: String(err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, msg: 'Checks API يعمل — استخدم POST' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===== القراءة =====
function list_() {
  const sh = sheet_();
  const tz = tz_();
  const values = sh.getDataRange().getValues();
  const headers = values[0].map(h => String(h).trim());
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (r.every(v => v === '' || v === null)) continue;
    rows.push(r.map(v => v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v));
  }
  return { headers, rows, lists: lists_(), formulaHeaders: Object.keys(FORMULAS) };
}

// قراءة أي شيت (للعرض فقط) بداية من صف العناوين
function readSheet_(name, headerRow) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('الشيت "' + name + '" غير موجود');
  const tz = tz_();
  const values = sh.getDataRange().getValues();
  const headers = (values[headerRow - 1] || []).map(h => String(h).trim());
  const rows = [], rowNums = [];
  values.forEach((r, i) => {
    if (i < headerRow || !r.some(v => v !== '' && v !== null)) return;
    rows.push(r.map(v => v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v));
    rowNums.push(i + 1);
  });
  return { headers, rows, rowNums };
}

function lists_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(LISTS_SHEET);
  const out = {};
  if (!sh) return out;
  const vals = sh.getDataRange().getValues();
  Object.keys(LISTS).forEach(name => {
    const c = LISTS[name] - 1;
    const seen = {};
    out[name] = vals.map(r => String(r[c] || '').trim()).filter(v => v && !seen[v] && (seen[v] = true));
  });
  return out;
}

// ===== الكتابة =====
// إضافة شيك أو أكثر دفعة واحدة
function addMany_(records) {
  if (!records || !records.length) throw new Error('لا توجد شيكات للإضافة');
  if (records.length > 1000) throw new Error('الحد الأقصى 1000 شيك في المرة');
  const sh = sheet_();
  const map = headerMap_(sh);
  const idCol = map[ID_HEADER];
  if (!idCol) throw new Error('عمود ' + ID_HEADER + ' غير موجود');
  const tz = tz_();
  const width = sh.getLastColumn();
  const n = records.length;

  const last = lastDataRow_(sh, idCol);
  const existing = last > 1 ? sh.getRange(2, idCol, last - 1, 1).getValues() : [];
  let max = 0;
  existing.forEach(r => { const k = parseInt(String(r[0]).replace(/\D/g, ''), 10); if (k > max) max = k; });

  // إدراج الصفوف بعد آخر شيك (تأخذ تنسيقه) حتى لا نكتب فوق صف الإجماليات
  sh.insertRowsAfter(last, n);
  const first = last + 1;
  extendTotals_(sh, last + n + 1, last, last + n);

  const ids = [];
  const values = records.map((record, i) => {
    const id = ID_PREFIX + String(max + 1 + i).padStart(ID_DIGITS, '0');
    ids.push(id);
    const row = new Array(width).fill('');
    Object.keys(record || {}).forEach(h => {
      const col = map[h.trim()];
      if (!col || FORMULAS[h.trim()] || h.trim() === ID_HEADER) return;
      row[col - 1] = convert_(h.trim(), record[h], tz);
    });
    row[idCol - 1] = id;
    return row;
  });
  sh.getRange(first, 1, n, width).setValues(values);
  records.forEach((record, i) => audit_(LOG_MAIN, ids[i], NEW_CHECK, '', newSummary_(record, tz)));

  Object.keys(FORMULAS).forEach(h => {
    const col = map[h];
    if (!col) return;
    const fs = [];
    for (let r = first; r < first + n; r++) fs.push([formulaFor_(h, map, r)]);
    sh.getRange(first, col, n, 1).setFormulas(fs);
  });

  const rows = sh.getRange(first, 1, n, width).getValues()
    .map(r => r.map(v => v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v));
  return { ids, rows };
}

// صف الإجماليات (SUBTOTAL(109,E2:E6627)…) — مد النطاق ليشمل الصف الجديد
function extendTotals_(sh, totalsRow, oldLast, newLast) {
  if (totalsRow > sh.getMaxRows()) return;
  const rng = sh.getRange(totalsRow, 1, 1, sh.getLastColumn());
  const formulas = rng.getFormulas()[0];
  const re = new RegExp('(:\\$?[A-Z]{1,3}\\$?)' + oldLast + '(?!\\d)', 'g');
  formulas.forEach((f, i) => {
    if (f && re.test(f)) { re.lastIndex = 0; sh.getRange(totalsRow, i + 1).setFormula(f.replace(re, '$1' + newLast)); }
  });
}

function update_(id, record) {
  if (!id) throw new Error('رقم الشيك (NN) مطلوب');
  const sh = sheet_();
  const map = headerMap_(sh);
  const idCol = map[ID_HEADER];
  const last = lastDataRow_(sh, idCol);
  const ids = sh.getRange(2, idCol, Math.max(last - 1, 1), 1).getValues();
  const idx = ids.findIndex(r => String(r[0]).trim() === id);
  if (idx < 0) throw new Error('لم يتم العثور على الشيك ' + id);
  const row = idx + 2;
  const rec = Object.assign({}, record);
  delete rec[ID_HEADER];
  const before = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
  writeRecord_(sh, map, row, rec, null, null, { sheet: LOG_MAIN, id, before });
  return { id, row: readRow_(sh, map, row) };
}

// تعديل جماعي: updates = [{ id, record }] — كل شيك بقيمه (تسمح بإضافة نص مختلف لكل شيك)
function updateMany_(updates) {
  if (!updates || !updates.length) throw new Error('لا توجد شيكات للتعديل');
  if (updates.length > 2000) throw new Error('الحد الأقصى 2000 شيك في المرة');
  const sh = sheet_();
  const map = headerMap_(sh);
  const idCol = map[ID_HEADER];
  const last = lastDataRow_(sh, idCol);
  const ids = sh.getRange(2, idCol, Math.max(last - 1, 1), 1).getValues();
  const rowOf = {};
  ids.forEach((r, i) => { const k = String(r[0]).trim(); if (k) rowOf[k] = i + 2; });

  const missing = updates.filter(u => !rowOf[u.id]).map(u => u.id);
  if (missing.length) throw new Error('لم يتم العثور على: ' + missing.slice(0, 10).join('، ') + ' — لم يتم تعديل أي شيك');

  // القيم القديمة (للسجل) بقراءة واحدة قبل الكتابة، والكتابة بدون أي قراءة بينها حتى تتجمع في دفعة واحدة
  const tz = tz_();
  const width = sh.getLastColumn();
  const before = sh.getRange(1, 1, last, width).getValues();
  updates.forEach(u => {
    const rec = Object.assign({}, u.record);
    delete rec[ID_HEADER];
    writeRecord_(sh, map, rowOf[u.id], rec, null, null, { sheet: LOG_MAIN, id: u.id, before: before[rowOf[u.id] - 1] });
  });
  SpreadsheetApp.flush();

  const all = sh.getRange(1, 1, last, width).getValues();
  return {
    ids: updates.map(u => u.id),
    rows: updates.map(u => all[rowOf[u.id] - 1].map(v => v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v)),
  };
}

// log = { sheet, id, before } — before = قيم الصف قبل الكتابة، وكل خانة قيمتها اتغيرت فعلاً بتتسجل
function writeRecord_(sh, map, row, rec, formulas, numbers, log) {
  const tz = tz_();
  formulas = formulas || FORMULAS;
  Object.keys(rec).forEach(h => {
    const col = map[h.trim()];
    if (!col || formulas[h.trim()]) return;
    const v = convert_(h.trim(), rec[h], tz, numbers);
    if (log) {
      const oldV = logVal_(log.before[col - 1], tz), newV = logVal_(v, tz);
      if (oldV !== newV) audit_(log.sheet, log.id, h.trim(), oldV, newV);
    }
    sh.getRange(row, col).setValue(v);
  });
}

// تحويل القيم: التواريخ yyyy-MM-dd إلى Date، والأرقام إلى Number
function convert_(h, v, tz, numbers) {
  if (v === null || v === undefined) return '';
  if (DATE_HEADERS.indexOf(h) >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(String(v))) {
    return Utilities.parseDate(String(v), tz, 'yyyy-MM-dd');
  }
  if ((numbers || NUMBER_HEADERS).indexOf(h) >= 0 && v !== '') {
    const n = Number(String(v).replace(/,/g, ''));
    if (!isNaN(n)) return n;
  }
  return v;
}

function formulaFor_(h, map, row, formulas) {
  return (formulas || FORMULAS)[h].replace(/\{([^}]+)\}\{r\}/g, (m, name) => {
    const c = map[name];
    if (!c) throw new Error('عمود ' + name + ' غير موجود');
    return colLetter_(c) + row;
  });
}

function readRow_(sh, map, row) {
  const tz = tz_();
  const width = sh.getLastColumn();
  return sh.getRange(row, 1, 1, width).getValues()[0]
    .map(v => v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v);
}

// ===== شيكات المخازن =====
function whSheet_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(WH_SHEET);
  if (!sh) throw new Error('الشيت "' + WH_SHEET + '" غير موجود');
  WH_HEADER_ROW = whFindHeaderRow_(sh);
  return sh;
}

// صف العناوين: أول صف (من أول 15) فيه «رقم الشيك» و«كود العميل» — مش لازم يكون الصف التاني
function whFindHeaderRow_(sh) {
  const n = Math.min(15, sh.getLastRow());
  if (n < 1) return 1;
  const vals = sh.getRange(1, 1, n, sh.getLastColumn()).getValues();
  for (let i = 0; i < vals.length; i++) {
    const cells = vals[i].map(v => String(v).trim());
    if (cells.indexOf(WH_MATCH) >= 0 && cells.indexOf('كود العميل') >= 0) return i + 1;
  }
  throw new Error('مش لاقي صف العناوين في شيت "' + WH_SHEET + '" — لازم يكون فيه عمودين «رقم الشيك» و«كود العميل» في أول 15 صف');
}

// آخر صف فيه رقم شيك أو كود عميل أو قيمة
function whLastRow_(sh, map) {
  const cols = WH_KEYS.map(h => map[h]).filter(Boolean);
  const n = sh.getMaxRows();
  let last = WH_HEADER_ROW;
  cols.forEach(c => {
    const vals = sh.getRange(1, c, n, 1).getValues();
    for (let i = vals.length - 1; i >= WH_HEADER_ROW; i--) {
      const v = vals[i][0];
      if (v !== '' && v !== null && String(v).trim() !== '#N/A') { if (i + 1 > last) last = i + 1; break; }
    }
  });
  return last;
}

function whRows_(sh, rowNums) {
  const tz = tz_();
  const width = sh.getLastColumn();
  return rowNums.map(r => sh.getRange(r, 1, 1, width).getValues()[0]
    .map(v => v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v));
}

// أكواد WH الموجودة: [{ row, id }] لكل صفوف البيانات
function whIdList_(sh, map, last) {
  const idCol = map[WH_ID_HEADER];
  if (!idCol || last <= WH_HEADER_ROW) return [];
  return sh.getRange(WH_HEADER_ROW + 1, idCol, last - WH_HEADER_ROW, 1).getValues()
    .map((r, i) => ({ row: WH_HEADER_ROW + 1 + i, id: String(r[0]).trim() }));
}
const whIdNum_ = id => { const m = String(id).match(/^WH0*(\d+)$/i); return m ? +m[1] : 0; };
const whIdOf_ = n => WH_ID_PREFIX + String(n).padStart(WH_ID_DIGITS, '0');

// إضافة شيك أو أكثر — الصفوف تتضاف جوه نطاق البيانات (قبل آخر صف ثم يرجع آخر صف تحتها)
// علشان معادلات الإجمالي (SUBTOTAL) والجداول تتمد لوحدها. كل شيك جديد بياخد كود WH التالي
function whAdd_(records) {
  if (!records || !records.length) throw new Error('لا توجد شيكات للإضافة');
  if (records.length > 1000) throw new Error('الحد الأقصى 1000 شيك في المرة');
  const sh = whSheet_();
  const map = headerMap_(sh, WH_HEADER_ROW);
  const tz = tz_();
  const width = sh.getLastColumn();
  const n = records.length;
  const last = whLastRow_(sh, map);
  const idCol = map[WH_ID_HEADER];
  let max = 0;
  whIdList_(sh, map, last).forEach(x => { const k = whIdNum_(x.id); if (k > max) max = k; });

  if (last > WH_HEADER_ROW) {
    sh.insertRowsBefore(last, n);
    // آخر صف قديم اتزحزح لتحت — نرجعه مكانه، والصفوف الجديدة تبقى بعده
    sh.getRange(last + n, 1, 1, width).copyTo(sh.getRange(last, 1, 1, width));
  } else {
    sh.insertRowsAfter(last, n);
  }
  const first = last + 1;

  const values = records.map((record, i) => {
    const row = new Array(width).fill('');
    Object.keys(record || {}).forEach(h => {
      const col = map[h.trim()];
      if (!col || WH_FORMULAS[h.trim()] || h.trim() === WH_ID_HEADER) return;
      row[col - 1] = convert_(h.trim(), record[h], tz, WH_NUMBERS);
    });
    if (idCol) row[idCol - 1] = whIdOf_(max + 1 + i);
    return row;
  });
  sh.getRange(first, 1, n, width).setValues(values);
  records.forEach((record, i) => audit_(LOG_WH, idCol ? whIdOf_(max + 1 + i) : 'صف ' + (first + i), NEW_CHECK, '', newSummary_(record, tz, WH_NUMBERS)));
  Object.keys(WH_FORMULAS).forEach(h => {
    const col = map[h];
    if (!col) return;
    const fs = [];
    for (let r = first; r < first + n; r++) fs.push([formulaFor_(h, map, r, WH_FORMULAS)]);
    sh.getRange(first, col, n, 1).setFormulas(fs);
  });
  SpreadsheetApp.flush();
  const rowNums = records.map((_, i) => first + i);
  return { rowNums, rows: whRows_(sh, rowNums) };
}

// تعديل: updates = [{ id, record }] بكود WH (الطريقة الأساسية)
//   أو [{ row, match, record }] لشيك لسه مالوش كود — match = رقم الشيك المتوقع في الصف
function whUpdate_(updates) {
  if (!updates || !updates.length) throw new Error('لا توجد شيكات للتعديل');
  const sh = whSheet_();
  const map = headerMap_(sh, WH_HEADER_ROW);
  const mCol = map[WH_MATCH];
  if (!mCol) throw new Error('عمود ' + WH_MATCH + ' غير موجود');

  let rowsOf = null;
  if (updates.some(u => u.id)) {
    rowsOf = {};
    whIdList_(sh, map, whLastRow_(sh, map)).forEach(x => { if (x.id) (rowsOf[x.id] = rowsOf[x.id] || []).push(x.row); });
  }
  const problems = [];
  const resolved = updates.map(u => {
    if (u.id) {
      const rs = rowsOf[u.id] || [];
      if (!rs.length) problems.push(u.id + ' مش موجود');
      else if (rs.length > 1) problems.push(u.id + ' مكرر في الصفوف ' + rs.join('، '));
      return rs[0];
    }
    if (!(u.row > WH_HEADER_ROW) || String(sh.getRange(u.row, mCol).getValue()).trim() !== String(u.match).trim()) {
      problems.push('صف ' + u.row + ' اتغير');
    }
    return u.row;
  });
  if (problems.length) {
    throw new Error(problems.slice(0, 5).join(' — ') + ' — اضغط ⟳ تحديث وحاول تاني. لم يتم تعديل أي شيك');
  }
  // القيم القديمة للسجل بقراءة واحدة للنطاق اللي فيه كل الصفوف
  const lo = Math.min.apply(null, resolved), hi = Math.max.apply(null, resolved);
  const block = sh.getRange(lo, 1, hi - lo + 1, sh.getLastColumn()).getValues();
  const idCol = map[WH_ID_HEADER];
  updates.forEach((u, i) => {
    const rec = Object.assign({}, u.record);
    delete rec[WH_ID_HEADER];
    const before = block[resolved[i] - lo];
    const id = u.id || (idCol && String(before[idCol - 1]).trim()) || 'صف ' + resolved[i];
    writeRecord_(sh, map, resolved[i], rec, WH_FORMULAS, WH_NUMBERS, { sheet: LOG_WH, id, before });
  });
  SpreadsheetApp.flush();
  return { rowNums: resolved, rows: whRows_(sh, resolved) };
}

// إعطاء كود WH لكل شيك لسه مالوش كود (بالترتيب من فوق لتحت، بعد أكبر كود موجود)
function whFillIds_() {
  const sh = whSheet_();
  const map = headerMap_(sh, WH_HEADER_ROW);
  const idCol = map[WH_ID_HEADER];
  if (!idCol) throw new Error('عمود ' + WH_ID_HEADER + ' غير موجود في الصف ' + WH_HEADER_ROW);
  const last = whLastRow_(sh, map);
  if (last <= WH_HEADER_ROW) return { filled: 0, duplicates: [] };
  const n = last - WH_HEADER_ROW;
  const keyCols = WH_KEYS.map(h => map[h]).filter(Boolean);
  const keyVals = keyCols.map(c => sh.getRange(WH_HEADER_ROW + 1, c, n, 1).getValues());
  const ids = sh.getRange(WH_HEADER_ROW + 1, idCol, n, 1).getValues();

  let max = 0;
  const seen = {}, duplicates = [];
  ids.forEach(r => {
    const id = String(r[0]).trim(); if (!id) return;
    const k = whIdNum_(id); if (k > max) max = k;
    if (seen[id]) duplicates.push(id); seen[id] = true;
  });
  let filled = 0;
  const added = [];
  ids.forEach((r, i) => {
    if (String(r[0]).trim()) return;
    const hasData = keyVals.some(col => { const v = col[i][0]; return v !== '' && v !== null && String(v).trim() !== '#N/A'; });
    if (!hasData) return;
    r[0] = whIdOf_(++max);
    added.push(i);
    filled++;
  });
  if (filled) {
    sh.getRange(WH_HEADER_ROW + 1, idCol, n, 1).setValues(ids);
    added.forEach(i => audit_(LOG_WH, ids[i][0], WH_ID_HEADER, '', ids[i][0] + ' (صف ' + (WH_HEADER_ROW + 1 + i) + ')'));
  }
  return { filled, duplicates };
}

// ===== أدوات =====
function sheet_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(DATA_SHEET);
  if (!sh) throw new Error('الشيت "' + DATA_SHEET + '" غير موجود');
  return sh;
}

function headerMap_(sh, headerRow) {
  const hdr = sh.getRange(headerRow || 1, 1, 1, sh.getLastColumn()).getValues()[0];
  const map = {};
  hdr.forEach((h, i) => { const k = String(h).trim(); if (k && !map[k]) map[k] = i + 1; });
  return map;
}

// آخر صف فيه NN (الصفوف الفارغة في الأسفل لا تُحسب)
function lastDataRow_(sh, idCol) {
  const vals = sh.getRange(1, idCol, sh.getMaxRows(), 1).getValues();
  for (let i = vals.length - 1; i >= 0; i--) if (String(vals[i][0]).trim() !== '') return i + 1;
  return 1;
}

function colLetter_(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// كل الكتابة بالدور، وسجل التعديلات بيتكتب جوه نفس القفل — حتى لو العملية وقفت في النص
// بيتسجل اللي اتكتب فعلاً. لو السجل نفسه فشل، التعديل مايرجعش كخطأ (علشان محدش يعيده مرتين)
function withLock_(req, fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('الشيت مشغول بتعديل تاني دلوقتي — استنى ثواني وحاول تاني (ما اتحفظش حاجة)');
  AUDIT_ = [];
  try {
    // نفس الطلب وصل قبل كده؟ نرجّع نتيجته من غير ما نكتب تاني
    const rid = String(req.rid || '').slice(0, 100);
    const cache = rid ? CacheService.getScriptCache() : null;
    const key = 'rid:' + rid;
    if (cache) {
      const hit = cache.get(key);
      if (hit) { const prev = JSON.parse(hit); prev.duplicate = true; return prev; }
    }
    let out, err = null, logErr = '';
    try { out = fn(); } catch (e) { err = e; }
    try { flushAudit_(req); } catch (e) { logErr = String(e.message || e); }
    if (err) throw err;
    if (logErr) out.auditError = logErr;
    if (cache) {
      try {
        let txt = JSON.stringify(out);
        if (txt.length > RID_MAX_CHARS) txt = JSON.stringify({ reload: true });
        cache.put(key, txt, RID_TTL);
      } catch (e) { /* الكاش اختياري — الكتابة نفسها تمت */ }
    }
    return out;
  } finally { AUDIT_ = null; lock.releaseLock(); }
}

// ===== النسخ الاحتياطي =====
function backupFolder_(create) {
  const it = DriveApp.getFoldersByName(BACKUP_FOLDER);
  if (it.hasNext()) return it.next();
  return create ? DriveApp.createFolder(BACKUP_FOLDER) : null;
}
function backupPrefix_() { return SpreadsheetApp.getActive().getName() + ' — نسخة '; }
function backupFiles_(folder) {
  const files = [], prefix = backupPrefix_();
  const it = folder.getFiles();
  while (it.hasNext()) { const f = it.next(); if (!f.isTrashed() && f.getName().indexOf(prefix) === 0) files.push(f); }
  return files.sort((a, b) => b.getDateCreated() - a.getDateCreated());   // الأحدث الأول
}

// نسخة من الملف كله (كل الشيتات) في فولدر النسخ، ونحتفظ بآخر BACKUP_KEEP نسخة
function dailyBackup() {
  const ss = SpreadsheetApp.getActive();
  const folder = backupFolder_(true);
  const name = backupPrefix_() + Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH-mm');
  DriveApp.getFileById(ss.getId()).makeCopy(name, folder);
  const files = backupFiles_(folder);
  files.slice(BACKUP_KEEP).forEach(f => f.setTrashed(true));
  return { name: name, kept: Math.min(files.length, BACKUP_KEEP), trashed: Math.max(0, files.length - BACKUP_KEEP) };
}

// شغّلها مرة واحدة من المحرر (اختار setupDailyBackup ← Run): بتطلب صلاحية Drive، وبتعمل نسخة دلوقتي، وتجدول نسخة كل يوم
function setupDailyBackup() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'dailyBackup')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyBackup').timeBased().everyDays(1).atHour(BACKUP_HOUR).create();
  const r = dailyBackup();
  Logger.log('تم: نسخة احتياطية دلوقتي (%s) + نسخة كل يوم الساعة %s', r.name, BACKUP_HOUR);
  return r;
}

// للموقع: حالة النسخ الاحتياطي (قراءة بس)
function backupInfo_() {
  const tz = tz_();
  const scheduled = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'dailyBackup');
  const folder = backupFolder_(false);
  const files = folder ? backupFiles_(folder) : [];
  return {
    scheduled: scheduled,
    count: files.length,
    last: files.length ? Utilities.formatDate(files[0].getDateCreated(), tz, 'yyyy-MM-dd HH:mm') : '',
    folderUrl: folder ? folder.getUrl() : '',
  };
}

// ===== سجل التعديلات =====
function audit_(sheet, id, col, oldV, newV) {
  if (AUDIT_) AUDIT_.push([sheet, id, col, oldV, newV]);
}

// القيمة زي ما بتتعرض في السجل (التواريخ yyyy-MM-dd)
function logVal_(v, tz) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  return String(v);
}

// ملخص الشيك الجديد في خانة واحدة: «رقم الشيك: 123 • البنك: …»
function newSummary_(record, tz, numbers) {
  const rec = {};
  Object.keys(record || {}).forEach(h => { rec[h.trim()] = convert_(h.trim(), record[h], tz, numbers); });
  return NEW_SUMMARY.filter(h => rec[h] !== undefined && rec[h] !== '').map(h => h + ': ' + logVal_(rec[h], tz)).join(' • ');
}

function logSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(LOG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(LOG_SHEET);
    sh.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

// كتابة كل صفوف الطلب مرة واحدة (setValues واحدة) كنص — علشان «=…» ما تتحسبش معادلة و«00123» ما تبقاش رقم
function flushAudit_(req) {
  if (!AUDIT_ || !AUDIT_.length) return;
  const tz = tz_();
  const at = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
  const label = WRITE_ACTIONS[req.action] || req.action;
  const txt = v => { const s = String(v); return /^[=+]/.test(s) ? "'" + s : s; };
  const rows = AUDIT_.map(a => [at, req.user, label].concat(a).map(txt));
  const sh = logSheet_();
  const first = sh.getLastRow() + 1;
  const need = first + rows.length - 1 - sh.getMaxRows();
  if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need);
  sh.getRange(first, 1, rows.length, LOG_HEADERS.length).setNumberFormat('@').setValues(rows);
}

// سجل شيك واحد — الأحدث الأول
function history_(id) {
  id = String(id || '').trim();
  if (!id) throw new Error('كود الشيك مطلوب');
  const sh = SpreadsheetApp.getActive().getSheetByName(LOG_SHEET);
  if (!sh || sh.getLastRow() < 2) return { items: [] };
  const tz = tz_();
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, LOG_HEADERS.length).getValues();
  const items = [];
  for (let i = vals.length - 1; i >= 0 && items.length < 500; i--) {
    const r = vals[i];
    if (String(r[4]).trim() !== id) continue;
    const v = r.map(x => x instanceof Date ? Utilities.formatDate(x, tz, 'yyyy-MM-dd HH:mm:ss') : String(x));
    items.push({ at: v[0], user: v[1], action: v[2], sheet: v[3], col: v[5], old: v[6], new: v[7] });
  }
  return { items };
}
