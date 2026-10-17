// بيئة Google Apps Script وهمية لتشغيل apps-script/Code.gs على Node من غير ما ننشر حاجة.
// فيها شيتات في الذاكرة (قيم + معادلات + إدراج صفوف) وكل الخدمات اللي Code.gs بيستخدمها.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert'), crypto = require('crypto');

const TZ = 'Africa/Cairo';
const CODE = process.env.CODE_GS || path.join(__dirname, '..', 'apps-script', 'Code.gs');   // CODE_GS: لتجربة نسخة تانية

function parts(d, tz) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(d).map(x => [x.type, x.value]));
}
function tzOffset(ms, tz) {
  const p = parts(new Date(ms), tz);
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}
const Utilities = {
  formatDate(d, tz, fmt) {
    const p = parts(d, tz);
    return fmt.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second);
  },
  parseDate(s, tz) {
    const [y, m, d] = s.split('-').map(Number);
    const g = Date.UTC(y, m - 1, d);
    return new Date(g - tzOffset(g, tz));
  },
  // زي GAS: مصفوفة bytes بإشارة (-128..127)
  computeDigest(alg, s, charset) {
    assert.strictEqual(alg, 'SHA_256'); assert.strictEqual(charset, 'UTF_8');
    return [...crypto.createHash('sha256').update(String(s), 'utf8').digest()].map(b => (b > 127 ? b - 256 : b));
  },
  DigestAlgorithm: { SHA_256: 'SHA_256' },
  Charset: { UTF_8: 'UTF_8' },
  getUuid: () => crypto.randomUUID(),
};
const date = s => Utilities.parseDate(s, TZ);

function makeWorld(fixtures, opts = {}) {
  const stats = { setValues: {} };
  class Range {
    constructor(sh, r, c, nr, nc) {
      if (r < 1 || c < 1 || nr < 1 || nc < 1 || r + nr - 1 > sh.rows.length || c + nc - 1 > sh.cols)
        throw new Error(`range out of bounds ${sh.name} r${r} c${c} ${nr}x${nc} (max ${sh.rows.length}x${sh.cols})`);
      Object.assign(this, { sh, r, c, nr, nc });
    }
    each(fn) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) fn(i, j, this.r - 1 + i, this.c - 1 + j); }
    getValues() { const o = []; for (let i = 0; i < this.nr; i++) o.push(this.sh.rows[this.r - 1 + i].slice(this.c - 1, this.c - 1 + this.nc).map(v => v instanceof Date ? new Date(v) : v)); return o; }
    getValue() { return this.getValues()[0][0]; }
    setValues(vals) {
      assert.strictEqual(vals.length, this.nr, 'setValues rows'); vals.forEach(r => assert.strictEqual(r.length, this.nc, 'setValues cols'));
      stats.setValues[this.sh.name] = (stats.setValues[this.sh.name] || 0) + 1;
      this.each((i, j, R, C) => { let v = vals[i][j]; if (typeof v === 'string' && v[0] === "'") v = v.slice(1); this.sh.rows[R][C] = v; delete this.sh.f[R + ',' + C]; });
      return this;
    }
    setValue(v) { return this.setValues([[v]]); }
    setFormulas(fs) { this.each((i, j, R, C) => { this.sh.rows[R][C] = 'ƒ' + fs[i][j]; this.sh.f[R + ',' + C] = fs[i][j]; }); return this; }
    setFormula(f) { return this.setFormulas([[f]]); }
    getFormulas() { const o = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sh.f[(this.r - 1 + i) + ',' + (this.c - 1 + j)] || ''); o.push(row); } return o; }
    copyTo(dst) {
      const v = this.getValues(), f = this.getFormulas(), dr = dst.r - this.r;
      // المعادلات النسبية بتتزحزح بفرق الصفوف زي Sheets
      const shift = fx => fx.replace(/([A-Z]+)(\$?)(\d+)/g, (m, c, abs, r) => abs ? m : c + (+r + dr));
      dst.each((i, j, R, C) => { dst.sh.rows[R][C] = v[i][j]; if (f[i][j]) dst.sh.f[R + ',' + C] = shift(f[i][j]); else delete dst.sh.f[R + ',' + C]; });
    }
    setNumberFormat(fmt) { this.each((i, j, R, C) => { this.sh.fmt[R + ',' + C] = fmt; }); return this; }
    setFontWeight() { return this; }
  }
  class Sheet {
    constructor(name, rows, maxRows, cols) {
      this.name = name; this.cols = cols || Math.max(...rows.map(r => r.length), 1);
      this.rows = rows.map(r => { const x = r.slice(); while (x.length < this.cols) x.push(''); return x; });
      while (this.rows.length < (maxRows || rows.length)) this.rows.push(new Array(this.cols).fill(''));
      this.f = {}; this.fmt = {};
    }
    getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
    getMaxRows() { return this.rows.length; }
    getMaxColumns() { return this.cols; }
    insertColumnsAfter(c, n) { assert.strictEqual(c, this.cols, 'الفيك بيدعم الإضافة في الآخر بس'); this.cols += n; this.rows.forEach(r => { for (let i = 0; i < n; i++) r.push(''); }); }
    getLastRow() { for (let i = this.rows.length - 1; i >= 0; i--) if (this.rows[i].some(v => v !== '' && v !== null)) return i + 1; return 0; }
    getLastColumn() { let m = 0; this.rows.forEach(r => r.forEach((v, j) => { if (v !== '' && v !== null && j + 1 > m) m = j + 1; })); return m; }
    getDataRange() { return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
    // إدراج صفوف: المعادلات اللي بتشاور على صفوف بعد مكان الإدراج بتتزحزح (زي SUBTOTAL(…E2:E4) → E2:E6)
    shift(at, n) {
      const nf = {};
      for (const k in this.f) {
        const [R, C] = k.split(',').map(Number);
        nf[(R >= at ? R + n : R) + ',' + C] = this.f[k].replace(/([A-Z]+)(\$?)(\d+)/g, (m, c, abs, r) => (+r > at ? c + abs + (+r + n) : m));
      }
      this.f = nf;
    }
    insertRowsAfter(r, n) { this.shift(r, n); this.rows.splice(r, 0, ...Array.from({ length: n }, () => new Array(this.cols).fill(''))); }
    insertRowsBefore(r, n) { this.shift(r - 1, n); this.rows.splice(r - 1, 0, ...Array.from({ length: n }, () => new Array(this.cols).fill(''))); }
    setFrozenRows(n) { this.frozen = n; }
  }

  const sheets = {};
  Object.entries(fixtures).forEach(([name, fx]) => {
    sheets[name] = new Sheet(name, fx.rows, fx.maxRows);
    Object.assign(sheets[name].f, fx.formulas || {});
  });
  const ss = {
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => (sheets[n] = new Sheet(n, [], 1000, 26)),
    getSpreadsheetTimeZone: () => TZ,
    getName: () => 'شيكات عملاء',
    getId: () => 'SHEET-ID',
  };

  // Drive: فولدرات وملفات في الذاكرة
  let clock = Date.UTC(2026, 0, 1);
  const folders = [];
  const iter = arr => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
  const makeFolder = name => {
    const files = [];
    const f = { name, files, getName: () => name, getFiles: () => iter(files.slice()), getUrl: () => 'https://drive/' + encodeURIComponent(name) };
    folders.push(f);
    return f;
  };
  const DriveApp = {
    getFoldersByName: n => iter(folders.filter(f => f.name === n)),
    createFolder: makeFolder,
    getFileById: id => ({
      makeCopy(name, folder) {
        const created = new Date(clock += 60e3);
        const file = { trashed: false, getName: () => name, getDateCreated: () => created, isTrashed() { return this.trashed; }, setTrashed(t) { this.trashed = t; } };
        folder.files.push(file);
        return file;
      },
    }),
  };

  // Triggers
  const triggers = [];
  const ScriptApp = {
    getProjectTriggers: () => triggers.slice(),
    deleteTrigger: t => triggers.splice(triggers.indexOf(t), 1),
    newTrigger: fn => {
      const spec = { fn };
      const b = { timeBased: () => b, everyDays: d => (spec.days = d, b), atHour: h => (spec.hour = h, b),
        create: () => { const t = Object.assign({ getHandlerFunction: () => fn }, spec); triggers.push(t); return t; } };
      return b;
    },
  };

  const cache = {};
  const ctx = {
    SpreadsheetApp: { getActive: () => ss, flush() { } },
    Utilities,
    LockService: { getScriptLock: () => ({
      tryLock: () => !ctx.lockBusy, waitLock: () => { if (ctx.lockBusy) throw new Error('Lock timeout'); },
      releaseLock() { ctx.lockReleased = (ctx.lockReleased || 0) + 1; },
    }) },
    CacheService: { getScriptCache: () => ({ get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ s, setMimeType() { return this; } }) },
    DriveApp, ScriptApp,
    Logger: { log() { } },
    console, Date,
  };
  return { sheets, ctx, stats, cache, folders, triggers };
}

// ===== بيانات تجريبية =====
const MAIN_H = ['mm', 'المخزن', 'كود العميل', 'اسم العميل سيستم', 'قيمة الشيك', 'دفعات شيكات', 'صافى الشيك', 'الشهر', 'العام',
  'تاريخ الاستلام', 'تاريخ الاستحقاق', 'شيك بأسم', 'اسم المستفيد', 'البنك', 'رقم الشيك', 'حالة الشيك', 'موقف الشيك',
  'حالة الصرف', 'الحاله', 'تاريخ خروج الشيك', 'اسم المستلم', 'المورد المتوقع', 'بيان', 'تذكير', 'NN'];
const WH_H = ['WH', 'المخزن', 'كود العميل', 'اسم العميل', 'رقم الشيك', 'البنك', 'قيمة الشيك', 'التحصيل', 'الصافي',
  'تاريخ الاستلام', 'تاريخ الاستحقاق', 'حالة الشيك', 'mm', 'Column1', 'ملاحظات'];
const mainRow = o => MAIN_H.map(h => o[h] !== undefined ? o[h] : '');
const whRow = o => WH_H.map(h => o[h] !== undefined ? o[h] : '');

// whHeaderRow: 2 = زي الملف الأصلي (صف إجماليات فوق العناوين)، 1 = العناوين في أول صف
function fixtures({ whHeaderRow = 2 } = {}) {
  const main = [MAIN_H,
    mainRow({ 'كود العميل': '101', 'اسم العميل سيستم': 'أحمد', 'قيمة الشيك': 1000, 'دفعات شيكات': 0, 'تاريخ الاستحقاق': date('2026-11-01'), 'البنك': 'CIB', 'رقم الشيك': '111', 'الحاله': 'تحت التحصيل', 'بيان': 'قديم', NN: 'CH000001' }),
    mainRow({ 'كود العميل': '102', 'اسم العميل سيستم': 'محمود', 'قيمة الشيك': 2000, 'دفعات شيكات': 0, 'تاريخ الاستحقاق': date('2026-12-01'), 'البنك': 'NBE', 'رقم الشيك': '222', 'الحاله': 'تحت التحصيل', NN: 'CH000002' }),
    mainRow({ 'كود العميل': '103', 'اسم العميل سيستم': 'سارة', 'قيمة الشيك': 3000, 'دفعات شيكات': 500, 'تاريخ الاستحقاق': date('2027-01-01'), 'البنك': 'QNB', 'رقم الشيك': '333', NN: 'CH000003' }),
    mainRow({ 'قيمة الشيك': 6000 }),   // صف الإجماليات تحت البيانات
  ];
  const whData = [
    whRow({ WH: 'WH00001', 'المخزن': 65, 'كود العميل': '101', 'رقم الشيك': '901', 'البنك': 'CIB', 'قيمة الشيك': 500, mm: 'NN' }),
    whRow({ WH: 'WH00002', 'المخزن': 90, 'كود العميل': '102', 'رقم الشيك': '902', 'البنك': 'NBE', 'قيمة الشيك': 700, mm: 'NN' }),
    whRow({ 'المخزن': 65, 'كود العميل': '104', 'رقم الشيك': '903', 'البنك': 'QNB', 'قيمة الشيك': 800, mm: 'NN' }),
    whRow({ 'رقم الشيك': '904', 'قيمة الشيك': 100 }),
  ];
  const wh = whHeaderRow === 2 ? [whRow({ 'قيمة الشيك': 9999 }), WH_H, ...whData] : [WH_H, ...whData];
  const whTotal = whHeaderRow === 2 ? { '0,6': '=SUBTOTAL(9,G3:G6)' } : {};
  return {
    'الشيكات (2)': { rows: main, maxRows: 8, formulas: { '4,4': '=SUBTOTAL(109,E2:E4)' } },
    'شيكات المخازن': { rows: wh, maxRows: wh.length + 3, formulas: whTotal },
    'معاملات': { rows: [['خزنة', '', 'تم الصرف', 'خالص', '65']] },
  };
}

// تحميل Code.gs في البيئة الوهمية. secret: null = سيب الـ SECRET زي ما هو في الملف.
// api(body) بيبعت طلب بتوكن دخول المدير الاحتياطي (admin + SECRET) — إلا لو body فيه token.
// api.raw(body) = طلب من غير توكن، و api.as(token) = طلبات بتوكن معيّن
function load(world, { secret = 'test-key', file = CODE } = {}) {
  let src = fs.readFileSync(file, 'utf8');
  if (secret !== null) src = src.replace(/const SECRET = '[^']*'/, `const SECRET = '${secret}'`);
  vm.createContext(world.ctx);
  vm.runInContext(src, world.ctx, { filename: file });
  const raw = body => JSON.parse(world.ctx.doPost({ postData: { contents: JSON.stringify(body) } }).s);
  const token = secret !== null ? raw({ action: 'login', username: 'admin', password: secret }).token : undefined;
  const api = body => raw(Object.assign({ token }, body));
  api.raw = raw;
  api.token = token;
  api.as = t => body => raw(Object.assign({ token: t }, body));
  return api;
}

module.exports = { TZ, Utilities, date, makeWorld, fixtures, load, MAIN_H, WH_H };
