// اختبارات apps-script/Code.gs — التشغيل: npm test  (أو: node --test tests/)
// بتشتغل على شيت وهمي في الذاكرة (fake-gas.js)، فمش محتاج نشر ولا إنترنت.
'use strict';
const { test, describe } = require('node:test');
const assert = require('assert');
const { TZ, Utilities, makeWorld, fixtures, load, MAIN_H, WH_H } = require('./fake-gas');

const MAIN = 'الشيكات (2)', WH = 'شيكات المخازن', LOG = 'سجل التعديلات';
const fresh = (fx, opts) => { const w = makeWorld(fixtures(fx), opts); return { w, api: load(w) }; };
const col = (h) => MAIN_H.indexOf(h);
const whCol = (h) => WH_H.indexOf(h);

// ===== الحماية والدخول =====
describe('الحماية', () => {
  test('كلمة السر الافتراضية بترفض أي طلب', () => {
    const w = makeWorld(fixtures());
    const api = load(w, { secret: null });
    const r = api({ action: 'list', key: 'غيّر-هذا-الرمز' });
    assert.strictEqual(r.ok, false); assert.match(r.error, /غيّر SECRET/);
  });
  test('كلمة سر غلط بترفض', () => {
    const { api } = fresh();
    const r = api({ action: 'list', key: 'wrong' });
    assert.strictEqual(r.ok, false); assert.match(r.error, /رمز الدخول غير صحيح/);
  });
  test('الكتابة من غير اسم موظف بترفض ومش بتغير حاجة', () => {
    const { w, api } = fresh();
    const before = JSON.stringify(w.sheets[MAIN].rows);
    const r = api({ action: 'update', id: 'CH000001', record: { 'الحاله': 'خالص' } });
    assert.strictEqual(r.ok, false); assert.match(r.error, /اسم الموظف/);
    assert.strictEqual(api({ action: 'add', user: '   ', record: { 'رقم الشيك': '1' } }).ok, false);
    assert.strictEqual(JSON.stringify(w.sheets[MAIN].rows), before);
    assert.strictEqual(w.sheets[LOG], undefined);
  });
  test('القراءة (list و listWh و history) مش محتاجة اسم', () => {
    const { api } = fresh();
    assert.strictEqual(api({ action: 'list' }).ok, true);
    assert.strictEqual(api({ action: 'listWh' }).ok, true);
    assert.deepStrictEqual(api({ action: 'history', id: 'CH000001' }).items, []);
  });
});

// ===== الشيت الرئيسي =====
describe('شيت الشيكات', () => {
  test('إضافة: NN التالي + المعادلات + مد صف الإجماليات', () => {
    const { w, api } = fresh();
    const r = api({ action: 'add', user: 'u', record: { 'كود العميل': '105', 'رقم الشيك': '555', 'البنك': 'CIB', 'قيمة الشيك': '1,500', 'تاريخ الاستحقاق': '2026-12-15' } });
    assert.strictEqual(r.ok, true); assert.strictEqual(r.id, 'CH000004');
    const sh = w.sheets[MAIN];
    assert.strictEqual(sh.rows[4][col('NN')], 'CH000004');
    assert.strictEqual(sh.rows[4][col('قيمة الشيك')], 1500);
    assert.strictEqual(sh.f['4,' + col('صافى الشيك')], '=+E5-F5');
    assert.match(sh.f['4,' + col('حالة الشيك')], /^=IF\(K5<=TODAY\(\)/);
    assert.strictEqual(sh.f['5,4'], '=SUBTOTAL(109,E2:E5)', 'صف الإجماليات اتزحزح لتحت واتمد');
  });
  test('إدراج من جدول: أرقام NN متتالية', () => {
    const { api } = fresh();
    const r = api({ action: 'addMany', user: 'u', records: [{ 'رقم الشيك': '1', 'قيمة الشيك': 1 }, { 'رقم الشيك': '2', 'قيمة الشيك': 2 }] });
    assert.deepStrictEqual(r.ids, ['CH000004', 'CH000005']);
  });
  test('تعديل: بيكتب الخانات المبعوتة بس ومش بيلمس المعادلات أو NN', () => {
    const { w, api } = fresh();
    const r = api({ action: 'update', user: 'u', id: 'CH000002', record: { 'الحاله': 'خالص', 'صافى الشيك': 99, NN: 'X' } });
    assert.strictEqual(r.ok, true);
    const row = w.sheets[MAIN].rows[2];
    assert.strictEqual(row[col('الحاله')], 'خالص');
    assert.strictEqual(row[col('NN')], 'CH000002');
    assert.strictEqual(row[col('صافى الشيك')], '');
  });
  test('تعديل جماعي: لو كود واحد مش موجود مفيش ولا شيك بيتعدل', () => {
    const { w, api } = fresh();
    const before = JSON.stringify(w.sheets[MAIN].rows);
    const r = api({ action: 'updateMany', user: 'u', updates: [{ id: 'CH000001', record: { 'الحاله': 'خالص' } }, { id: 'CH999999', record: {} }] });
    assert.strictEqual(r.ok, false); assert.match(r.error, /CH999999/);
    assert.strictEqual(JSON.stringify(w.sheets[MAIN].rows), before);
  });
  test('التواريخ بتتكتب بمنطقة الشيت الزمنية (من غير ما تتزحزح يوم)', () => {
    const { w, api } = fresh();
    api({ action: 'update', user: 'u', id: 'CH000001', record: { 'تاريخ الاستحقاق': '2026-12-31' } });
    const v = w.sheets[MAIN].rows[1][col('تاريخ الاستحقاق')];
    assert.ok(v instanceof Date);
    assert.strictEqual(Utilities.formatDate(v, TZ, 'yyyy-MM-dd'), '2026-12-31');
  });
});

// ===== شيت المخازن =====
describe('شيت المخازن', () => {
  for (const hdr of [2, 1]) {
    test(`صف العناوين بيتعرف لوحده (العناوين في الصف ${hdr})`, () => {
      const { api } = fresh({ whHeaderRow: hdr });
      const r = api({ action: 'listWh' });
      assert.strictEqual(r.headerRow, hdr);
      assert.strictEqual(r.rows.length, 4);
      assert.deepStrictEqual(r.rowNums, [hdr + 1, hdr + 2, hdr + 3, hdr + 4]);
    });
  }
  test('إضافة: كود WH التالي، جوه نطاق البيانات، والإجمالي بيتمد', () => {
    const { w, api } = fresh();
    const r = api({ action: 'whAdd', user: 'u', records: [{ 'كود العميل': '108', 'رقم الشيك': '905', 'قيمة الشيك': 50, WH: 'HACK' }] });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.rowNums, [7]);
    const sh = w.sheets[WH];
    assert.strictEqual(sh.rows[6][whCol('WH')], 'WH00003', 'الكود من السيرفر مش من الطلب');
    assert.strictEqual(sh.rows[5][whCol('رقم الشيك')], '904', 'آخر صف قديم فضل قبل الجديد');
    assert.strictEqual(sh.f['0,6'], '=SUBTOTAL(9,G3:G7)');
  });
  test('تعديل بالكود وبرقم الصف، والرفض لو الصف اتغير', () => {
    const { w, api } = fresh();
    const r = api({ action: 'whUpdate', user: 'u', updates: [{ id: 'WH00002', record: { mm: 'خالص' } }, { row: 5, match: '903', record: { 'ملاحظات': 'اتصل' } }] });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(w.sheets[WH].rows[3][whCol('mm')], 'خالص');
    assert.strictEqual(w.sheets[WH].rows[4][whCol('ملاحظات')], 'اتصل');
    const bad = api({ action: 'whUpdate', user: 'u', updates: [{ row: 5, match: 'WRONG', record: { 'ملاحظات': 'x' } }] });
    assert.strictEqual(bad.ok, false); assert.match(bad.error, /لم يتم تعديل أي شيك/);
  });
  test('إعطاء أكواد: بيكمل بعد أكبر كود ومش بيغير الموجود', () => {
    const { w, api } = fresh();
    const r = api({ action: 'whFillIds', user: 'u' });
    assert.strictEqual(r.filled, 2);
    const ids = w.sheets[WH].rows.slice(2, 6).map(x => x[whCol('WH')]);
    assert.deepStrictEqual(ids, ['WH00001', 'WH00002', 'WH00003', 'WH00004']);
    assert.strictEqual(api({ action: 'whFillIds', user: 'u' }).filled, 0);
  });
});

// ===== سجل التعديلات =====
describe('سجل التعديلات', () => {
  test('بيسجل الخانات اللي اتغيرت بس بالقيمة القديمة والجديدة، في setValues واحدة', () => {
    const { w, api } = fresh();
    api({ action: 'update', user: 'منى', id: 'CH000002', record: { 'الحاله': 'خالص', 'البنك': 'NBE', 'بيان': '=1+1', 'تذكير': '00123' } });
    const s = w.sheets[LOG];
    assert.deepStrictEqual(s.rows[0].slice(0, 8), ['الوقت', 'الموظف', 'العملية', 'الشيت', 'كود الشيك', 'العمود', 'القيمة القديمة', 'القيمة الجديدة']);
    const rows = s.rows.slice(1, s.getLastRow());
    assert.deepStrictEqual(rows.map(r => r[5]).sort(), ['الحاله', 'بيان', 'تذكير'].sort(), 'البنك ما اتغيرش فمش متسجل');
    assert.ok(rows.every(r => r[1] === 'منى' && r[2] === 'تعديل' && r[4] === 'CH000002'));
    assert.deepStrictEqual(rows.find(r => r[5] === 'بيان').slice(6, 8), ['', '=1+1'], 'المعادلة اتسجلت كنص');
    assert.strictEqual(w.stats.setValues[LOG], 2, 'العناوين + صفوف الطلب مرة واحدة');
  });
  test('history بيرجع سجل الشيك الأحدث الأول', () => {
    const { api } = fresh();
    api({ action: 'update', user: 'a', id: 'CH000001', record: { 'الحاله': 'خالص' } });
    api({ action: 'update', user: 'b', id: 'CH000001', record: { 'بيان': 'جديد' } });
    const h = api({ action: 'history', id: 'CH000001' });
    assert.deepStrictEqual(h.items.map(x => x.col), ['بيان', 'الحاله']);
  });
  test('فشل كتابة السجل ما بيحوّلش التعديل لخطأ', () => {
    const { w, api } = fresh();
    api({ action: 'update', user: 'x', id: 'CH000001', record: { 'بيان': 'a' } });
    const s = w.sheets[LOG], orig = s.getRange.bind(s);
    s.getRange = () => { throw new Error('boom'); };
    const r = api({ action: 'update', user: 'x', id: 'CH000003', record: { 'بيان': 'y' } });
    s.getRange = orig;
    assert.strictEqual(r.ok, true); assert.match(r.auditError, /boom/);
  });
});

// ===== منع التكرار (rid) =====
describe('منع الإضافة المكررة', () => {
  test('نفس الطلب مرتين = شيك واحد، والمرة التانية بترجع نفس النتيجة', () => {
    const { w, api } = fresh();
    const req = { action: 'add', user: 'u', rid: 'req-1', record: { 'رقم الشيك': '777', 'قيمة الشيك': 10 } };
    const a = api(req), b = api(req);
    assert.strictEqual(a.ok, true); assert.strictEqual(a.duplicate, undefined);
    assert.strictEqual(b.ok, true); assert.strictEqual(b.duplicate, true);
    assert.strictEqual(b.id, a.id);
    assert.strictEqual(w.sheets[MAIN].rows.filter(r => r[col('رقم الشيك')] === '777').length, 1);
    const log = w.sheets[LOG].rows.filter(r => r[4] === a.id);
    assert.strictEqual(log.length, 1, 'السجل اتكتب مرة واحدة');
  });
  test('طلب جديد (rid مختلف) بيضيف عادي', () => {
    const { api } = fresh();
    const rec = { 'رقم الشيك': '777', 'قيمة الشيك': 10 };
    assert.strictEqual(api({ action: 'add', user: 'u', rid: 'a', record: rec }).id, 'CH000004');
    assert.strictEqual(api({ action: 'add', user: 'u', rid: 'b', record: rec }).id, 'CH000005');
  });
  test('من غير rid (نسخة موقع قديمة) الطلب بيتنفذ كل مرة زي الأول', () => {
    const { api } = fresh();
    const rec = { 'رقم الشيك': '1', 'قيمة الشيك': 1 };
    assert.strictEqual(api({ action: 'add', user: 'u', record: rec }).id, 'CH000004');
    assert.strictEqual(api({ action: 'add', user: 'u', record: rec }).id, 'CH000005');
  });
  test('الطلب اللي اترفض ما بيتحفظش — إعادته بعد التصحيح بتشتغل', () => {
    const { w, api } = fresh();
    const r1 = api({ action: 'updateMany', user: 'u', rid: 'x', updates: [{ id: 'CH999999', record: {} }] });
    assert.strictEqual(r1.ok, false);
    assert.strictEqual(Object.keys(w.cache).length, 0);
  });
  test('نتيجة كبيرة على الكاش: الإعادة بترجع «اعمل تحديث» بدل ما تكتب تاني', () => {
    const { w, api } = fresh();
    const records = Array.from({ length: 400 }, (_, i) => ({ 'رقم الشيك': 'B' + i, 'قيمة الشيك': i + 1, 'بيان': 'ملاحظة طويلة '.repeat(5) }));
    const req = { action: 'addMany', user: 'u', rid: 'big', records };
    assert.strictEqual(api(req).ids.length, 400);
    const again = api(req);
    assert.strictEqual(again.ok, true); assert.strictEqual(again.duplicate, true); assert.strictEqual(again.reload, true);
    assert.strictEqual(w.sheets[MAIN].rows.filter(r => String(r[col('رقم الشيك')]).startsWith('B')).length, 400);
  });
  test('منع التكرار شغال في شيت المخازن كمان', () => {
    const { w, api } = fresh();
    const req = { action: 'whAdd', user: 'u', rid: 'w1', records: [{ 'رقم الشيك': '999', 'قيمة الشيك': 5 }] };
    api(req); const b = api(req);
    assert.strictEqual(b.duplicate, true);
    assert.strictEqual(w.sheets[WH].rows.filter(r => r[whCol('رقم الشيك')] === '999').length, 1);
  });
});

// ===== القفل =====
describe('القفل', () => {
  test('لو السيرفر مشغول: رسالة بالعربي ومفيش كتابة', () => {
    const { w, api } = fresh();
    w.ctx.lockBusy = true;
    const before = JSON.stringify(w.sheets[MAIN].rows);
    const r = api({ action: 'add', user: 'u', record: { 'رقم الشيك': '1' } });
    assert.strictEqual(r.ok, false); assert.match(r.error, /الشيت مشغول/);
    assert.doesNotMatch(r.error, /Lock timeout/);
    assert.strictEqual(JSON.stringify(w.sheets[MAIN].rows), before);
  });
  test('القفل بيتفك بعد كل كتابة (نجحت أو فشلت)', () => {
    const { w, api } = fresh();
    api({ action: 'add', user: 'u', record: { 'رقم الشيك': '1' } });
    api({ action: 'update', user: 'u', id: 'CH999999', record: {} });
    assert.strictEqual(w.ctx.lockReleased, 2);
  });
});

// ===== النسخ الاحتياطي =====
describe('النسخ الاحتياطي', () => {
  test('setupDailyBackup: نسخة دلوقتي + Trigger يومي واحد بس حتى لو اتشغلت مرتين', () => {
    const { w } = fresh();
    w.ctx.setupDailyBackup();
    w.ctx.setupDailyBackup();
    const t = w.triggers.filter(x => x.getHandlerFunction() === 'dailyBackup');
    assert.strictEqual(t.length, 1); assert.strictEqual(t[0].days, 1); assert.strictEqual(t[0].hour, 2);
    assert.strictEqual(w.folders.length, 1);
    assert.strictEqual(w.folders[0].name, 'نسخ احتياطية - شيت الشيكات');
    assert.strictEqual(w.folders[0].files.length, 2);
    assert.match(w.folders[0].files[0].getName(), /^شيكات عملاء — نسخة \d{4}-\d{2}-\d{2} \d{2}-\d{2}$/);
  });
  test('بيحتفظ بآخر 30 نسخة والأقدم بيروح السلة (مش بيتمسح)', () => {
    const { w } = fresh();
    for (let i = 0; i < 33; i++) w.ctx.dailyBackup();
    const files = w.folders[0].files;
    assert.strictEqual(files.length, 33);
    assert.strictEqual(files.filter(f => f.trashed).length, 3);
    assert.ok(files.slice(0, 3).every(f => f.trashed), 'الأقدم هو اللي اتشال');
  });
  test('backupInfo للموقع: متجدول ولا لأ وآخر نسخة', () => {
    const { w, api } = fresh();
    const none = api({ action: 'backupInfo' });
    assert.strictEqual(none.ok, true); assert.strictEqual(none.count, 0); assert.strictEqual(none.scheduled, false);
    w.ctx.setupDailyBackup();
    const b = api({ action: 'backupInfo' });
    assert.strictEqual(b.scheduled, true); assert.strictEqual(b.count, 1);
    assert.match(b.last, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});
