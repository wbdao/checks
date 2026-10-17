// اختبارات apps-script/Code.gs — التشغيل: npm test  (أو: node --test tests/)
// بتشتغل على شيت وهمي في الذاكرة (fake-gas.js)، فمش محتاج نشر ولا إنترنت.
'use strict';
const { test, describe } = require('node:test');
const assert = require('assert');
const vm = require('vm');
const { TZ, Utilities, makeWorld, fixtures, load, MAIN_H, WH_H } = require('./fake-gas');

const MAIN = 'الشيكات (2)', WH = 'شيكات المخازن', LOG = 'سجل التعديلات';
const fresh = (fx, opts) => { const w = makeWorld(fixtures(fx), opts); return { w, api: load(w) }; };
const col = (h) => MAIN_H.indexOf(h);
const whCol = (h) => WH_H.indexOf(h);

// ===== الحماية والدخول =====
const EMP = 'الموظفين';
// مستخدمين تجريبيين بيتعملوا من شاشة المستخدمين (المدير الاحتياطي)
function withUsers() {
  const { w, api } = fresh();
  for (const [username, name, role] of [['mona', 'منى', 'تعديل'], ['karim', 'كريم', 'مشاهدة'], ['boss', 'هالة', 'مدير']]) {
    const r = api({ action: 'userSave', username, name, role, password: username + '-pass-123' });
    assert.strictEqual(r.ok, true, r.error);
  }
  const login = (u, p) => api.raw({ action: 'login', username: u, password: p === undefined ? u + '-pass-123' : p });
  const as = u => { const r = login(u); assert.strictEqual(r.ok, true, r.error); return api.as(r.token); };
  return { w, api, login, as };
}

describe('الحماية', () => {
  test('كلمة السر الافتراضية بترفض أي طلب (حتى الدخول)', () => {
    const w = makeWorld(fixtures());
    const api = load(w, { secret: null });
    for (const body of [{ action: 'list' }, { action: 'login', username: 'admin', password: 'غيّر-هذا-الرمز' }]) {
      const r = api.raw(body);
      assert.strictEqual(r.ok, false); assert.match(r.error, /غيّر SECRET/);
    }
  });
  test('من غير توكن أو بتوكن غلط: مفيش قراية ولا كتابة', () => {
    const { w, api } = fresh();
    const before = JSON.stringify(w.sheets[MAIN].rows);
    for (const token of [undefined, '', 'nope', 'constructor']) {
      const r = api.raw({ action: 'list', token });
      assert.strictEqual(r.ok, false); assert.match(r.error, /سجّل دخول/);
      assert.strictEqual(r.login, true, 'الموقع بيعرف إنه يفتح شاشة الدخول');
      assert.strictEqual(api.raw({ action: 'update', token, user: 'منى', id: 'CH000001', record: { 'الحاله': 'خالص' } }).ok, false);
    }
    assert.strictEqual(api.raw({ action: 'list', key: 'test-key' }).ok, false, 'key القديم مبقاش بيدخّل');
    assert.strictEqual(JSON.stringify(w.sheets[MAIN].rows), before);
    assert.strictEqual(w.sheets[LOG], undefined);
  });
  test('SECRET كدخول احتياطي: admin بصلاحية مدير والسجل باسم «المدير»', () => {
    const { w, api } = fresh();
    const r = api({ action: 'list' });
    assert.strictEqual(r.user, 'المدير'); assert.strictEqual(r.role, 'مدير');
    api({ action: 'update', user: 'منى', id: 'CH000001', record: { 'بيان': 'من المدير' } });
    const rows = w.sheets[LOG].rows.slice(1, w.sheets[LOG].getLastRow());
    assert.ok(rows.length && rows.every(x => x[1] === 'المدير'));
    assert.strictEqual(api.raw({ action: 'login', username: 'mona', password: 'test-key' }).ok, false, 'SECRET مع اسم تاني ما ينفعش');
  });
});

describe('تسجيل الدخول', () => {
  test('دخول صحيح: توكن + الاسم والصلاحية، واسم المستخدم مش حساس لحالة الحروف', () => {
    const { login } = withUsers();
    const r = login(' Mona ', 'mona-pass-123');
    assert.strictEqual(r.ok, true); assert.strictEqual(r.name, 'منى'); assert.strictEqual(r.role, 'تعديل'); assert.strictEqual(r.username, 'mona');
    assert.match(r.token, /^[0-9a-f]{64}$/);
    assert.strictEqual(r.password, undefined); assert.strictEqual(r.hash, undefined);
  });
  test('كلمة سر غلط أو مستخدم مش موجود: نفس الرسالة', () => {
    const { login } = withUsers();
    const a = login('mona', 'wrong-pass'), b = login('ghost', 'whatever');
    assert.strictEqual(a.ok, false); assert.match(a.error, /اسم المستخدم أو كلمة السر غلط/);
    assert.strictEqual(b.ok, false); assert.match(b.error, /اسم المستخدم أو كلمة السر غلط/);
    assert.match(login('', '').error, /اكتب اسم المستخدم/);
  });
  test('5 محاولات غلط = قفل 15 دقيقة حتى بكلمة السر الصح، ومستخدم تاني مش بيتأثر', () => {
    const { w, login } = withUsers();
    for (let i = 0; i < 4; i++) assert.match(login('mona', 'bad').error, /غلط/);
    assert.match(login('mona', 'bad').error, /اتقفل 15 دقيقة/);
    assert.match(login('mona').error, /مقفول/);
    assert.strictEqual(login('karim').ok, true);
    delete w.cache['lock:mona'];                       // القفل خلص (الكاش انتهى)
    assert.strictEqual(login('mona').ok, true);
  });
  test('الدخول الصح بيصفّر عدّاد المحاولات', () => {
    const { login } = withUsers();
    for (let i = 0; i < 4; i++) login('mona', 'bad');
    assert.strictEqual(login('mona').ok, true);
    assert.match(login('mona', 'bad').error, /فاضل 4/);
  });
  test('التوكن بينتهي بعد 12 ساعة، وخروج بيلغيه', () => {
    const { w, login, api } = withUsers();
    const t = login('mona').token, me = api.as(t);
    assert.strictEqual(me({ action: 'list' }).ok, true);
    const s = JSON.parse(w.cache['sess:' + t]);
    assert.ok(s.exp - Date.now() > 11.9 * 3600e3 && s.exp - Date.now() <= 12 * 3600e3);
    w.cache['sess:' + t] = JSON.stringify(Object.assign(s, { exp: Date.now() - 1 }));
    assert.match(me({ action: 'list' }).error, /سجّل دخول/);
    const t2 = login('mona').token;
    assert.strictEqual(api.as(t2)({ action: 'list' }).ok, true);
    assert.strictEqual(api.raw({ action: 'logout', token: t2 }).ok, true);
    assert.match(api.as(t2)({ action: 'list' }).error, /سجّل دخول/);
  });
  test('إيقاف المستخدم بيقفل التوكن بتاعه فوراً، وكلمة السر مش بتدخّل', () => {
    const { api, login, as } = withUsers();
    const mona = as('mona');
    assert.strictEqual(api({ action: 'userSave', username: 'mona', active: false }).ok, true);
    assert.match(mona({ action: 'list' }).error, /اتوقف/);
    assert.match(login('mona').error, /متوقف/);
  });
  test('تغيير SECRET بيلغي جلسات الدخول الاحتياطي', () => {
    const w = makeWorld(fixtures());
    const api = load(w, { secret: 'old-secret' });
    assert.strictEqual(api({ action: 'list' }).ok, true);
    const w2 = makeWorld(fixtures());
    w2.ctx.CacheService = w.ctx.CacheService;              // نفس الكاش، بس Code.gs بـ SECRET جديد
    const api2 = load(w2, { secret: 'new-secret' });
    assert.match(api2.as(api.token)({ action: 'list' }).error, /سجّل دخول/);
    assert.strictEqual(api2({ action: 'list' }).ok, true);
  });
});

describe('الصلاحيات', () => {
  const READS = [{ action: 'list' }, { action: 'listWh' }, { action: 'history', id: 'CH000001' }, { action: 'payments' }, { action: 'backupInfo' }];
  const WRITES = [
    { action: 'add', record: { 'رقم الشيك': '1' } },
    { action: 'addMany', records: [{ 'رقم الشيك': '2' }] },
    { action: 'update', id: 'CH000001', record: { 'بيان': 'x' } },
    { action: 'updateMany', updates: [{ id: 'CH000001', record: { 'بيان': 'y' } }] },
    { action: 'whAdd', records: [{ 'رقم الشيك': '3' }] },
    { action: 'whUpdate', updates: [{ id: 'WH00001', record: { mm: 'z' } }] },
    { action: 'whFillIds' },
  ];
  test('مشاهدة: القراية كلها شغالة، وأي كتابة أو إدارة مستخدمين بتترفض من غير ما تغير حاجة', () => {
    const { w, as } = withUsers();
    const karim = as('karim');
    READS.forEach(b => assert.strictEqual(karim(b).ok, true, b.action + ': ' + karim(b).error));
    assert.strictEqual(karim({ action: 'list' }).role, 'مشاهدة');
    const main = JSON.stringify(w.sheets[MAIN].rows), wh = JSON.stringify(w.sheets[WH].rows);
    WRITES.forEach(b => { const r = karim(b); assert.strictEqual(r.ok, false, b.action); assert.match(r.error, /مش مسموحلك/); });
    assert.match(karim({ action: 'users' }).error, /للمدير بس/);
    assert.match(karim({ action: 'userSave', username: 'karim', role: 'مدير' }).error, /للمدير بس/);
    assert.match(karim({ action: 'somethingNew' }).error, /مش مسموحلك/, 'أي إجراء جديد مش متصنف = كتابة');
    assert.strictEqual(JSON.stringify(w.sheets[MAIN].rows), main);
    assert.strictEqual(JSON.stringify(w.sheets[WH].rows), wh);
  });
  test('تعديل: بيضيف ويعدّل، بس مش بيدير المستخدمين', () => {
    const { as } = withUsers();
    const mona = as('mona');
    WRITES.forEach(b => assert.strictEqual(mona(b).ok, true, b.action + ': ' + mona(b).error));
    assert.match(mona({ action: 'users' }).error, /للمدير بس/);
  });
  test('مدير: كل حاجة', () => {
    const { as } = withUsers();
    const boss = as('boss');
    WRITES.forEach(b => assert.strictEqual(boss(b).ok, true, b.action));
    assert.strictEqual(boss({ action: 'users' }).users.length, 3);
  });
  test('اسم السجل من الجلسة — user اللي جاي من الموقع بيتجاهل', () => {
    const { w, as } = withUsers();
    as('mona')({ action: 'add', user: 'كريم', record: { 'رقم الشيك': '1', 'قيمة الشيك': 1 } });
    as('boss')({ action: 'whUpdate', user: '', updates: [{ id: 'WH00001', record: { mm: 'خالص' } }] });
    const rows = w.sheets[LOG].rows.slice(1, w.sheets[LOG].getLastRow()).filter(r => r[3] !== 'المستخدمين');
    assert.deepStrictEqual(rows.map(x => x[1]), ['منى', 'هالة']);
    assert.strictEqual(as('karim')({ action: 'history', id: 'WH00001' }).items[0].user, 'هالة');
  });
  test('تغيير الصلاحية بيشتغل على الجلسة المفتوحة فوراً', () => {
    const { api, as } = withUsers();
    const karim = as('karim');
    assert.strictEqual(karim(WRITES[2]).ok, false);
    api({ action: 'userSave', username: 'karim', role: 'تعديل' });
    assert.strictEqual(karim(WRITES[2]).ok, true);
  });
});

describe('إدارة المستخدمين', () => {
  test('الشيت بيتعمل لوحده، وكلمة السر متخزنة hash + salt (مش صريحة) ومش بترجع للموقع', () => {
    const { w, api } = withUsers();
    const s = w.sheets[EMP];
    assert.deepStrictEqual(s.rows[0].slice(0, 6), ['اسم المستخدم', 'الاسم', 'الصلاحية', 'مفعّل', 'كلمة السر (مشفرة)', 'Salt']);
    const mona = s.rows.find(r => r[0] === 'mona');
    assert.deepStrictEqual(mona.slice(0, 4), ['mona', 'منى', 'تعديل', true]);
    assert.match(mona[4], /^[0-9a-f]{64}$/); assert.match(mona[5], /^[0-9a-f]{32}$/);
    assert.ok(!JSON.stringify(s.rows).includes('mona-pass-123'));
    const boss = s.rows.find(r => r[0] === 'boss');
    assert.notStrictEqual(boss[5], mona[5], 'salt مختلف لكل مستخدم');
    const list = api({ action: 'users' });
    assert.deepStrictEqual(list.users.map(u => u.username), ['mona', 'karim', 'boss']);
    assert.ok(!/[0-9a-f]{32}/.test(JSON.stringify(list)), 'مفيش hash ولا salt في الرد');
  });
  test('إعادة تعيين كلمة السر: القديمة مبقتش تدخّل والجديدة بتدخّل', () => {
    const { api, login } = withUsers();
    assert.strictEqual(api({ action: 'userSave', username: 'mona', password: 'new-pass-456' }).ok, true);
    assert.strictEqual(login('mona').ok, false);
    assert.strictEqual(login('mona', 'new-pass-456').ok, true);
  });
  test('التحقق: اسم مستخدم/صلاحية/كلمة سر غلط، ومستخدم جديد من غير كلمة سر', () => {
    const { api } = withUsers();
    assert.match(api({ action: 'userSave', username: 'منى', password: '12345678' }).error, /اسم المستخدم لازم/);
    assert.match(api({ action: 'userSave', username: 'admin', password: '12345678' }).error, /محجوز/);
    assert.match(api({ action: 'userSave', username: 'sara', role: 'ملك', password: '12345678' }).error, /الصلاحية لازم/);
    assert.match(api({ action: 'userSave', username: 'sara', password: '123' }).error, /8 حروف/);
    assert.match(api({ action: 'userSave', username: 'sara', name: 'سارة' }).error, /محتاج كلمة سر/);
    assert.strictEqual(api({ action: 'users' }).users.length, 3);
  });
  test('المدير مينفعش يوقف نفسه أو يشيل صلاحيته', () => {
    const { as } = withUsers();
    const boss = as('boss');
    assert.match(boss({ action: 'userSave', username: 'boss', active: false }).error, /نفسك/);
    assert.match(boss({ action: 'userSave', username: 'boss', role: 'تعديل' }).error, /نفسك/);
    assert.strictEqual(boss({ action: 'userSave', username: 'boss', name: 'هالة م' }).ok, true);
  });
  test('التعديلات على المستخدمين بتتسجل في السجل من غير كلمة السر', () => {
    const { w, api } = withUsers();
    api({ action: 'userSave', username: 'karim', role: 'تعديل', password: 'another-pass' });
    const rows = w.sheets[LOG].rows.filter(r => r[3] === 'المستخدمين' && r[4] === 'karim');
    assert.deepStrictEqual(rows.map(r => r[5]), ['(مستخدم جديد)', 'كلمة السر', 'الصلاحية', 'كلمة السر']);
    assert.ok(!JSON.stringify(w.sheets[LOG].rows).includes('another-pass'));
  });
  test('شيت قديم (الاسم، الرمز، مفعّل) بياخد العناوين الجديدة، والرموز القديمة مبتدخّلش', () => {
    const fx = fixtures();
    fx[EMP] = { rows: [['الاسم', 'الرمز', 'مفعّل'], ['منى', 'mona-1234', true]] };
    const w = makeWorld(fx), api = load(w);
    assert.strictEqual(api.raw({ action: 'list', key: 'mona-1234' }).ok, false);
    assert.strictEqual(api.raw({ action: 'login', username: 'منى', password: 'mona-1234' }).ok, false);
    assert.deepStrictEqual(w.sheets[EMP].rows[0].slice(0, 7), ['الاسم', 'الرمز', 'مفعّل', 'اسم المستخدم', 'الصلاحية', 'كلمة السر (مشفرة)', 'Salt']);
    assert.strictEqual(api({ action: 'userSave', username: 'mona', name: 'منى', role: 'تعديل', password: 'mona-pass-123' }).ok, true);
    assert.strictEqual(api.raw({ action: 'login', username: 'mona', password: 'mona-pass-123' }).ok, true);
  });
  test('جدول المستخدمين في الكاش، وonEdit في شيت الموظفين بيمسحه', () => {
    const { w, login, as } = withUsers();
    const mona = as('mona');
    const emp = w.sheets[EMP];
    let reads = 0; const orig = emp.getDataRange.bind(emp);
    emp.getDataRange = () => { reads++; return orig(); };
    emp.rows.find(r => r[0] === 'mona')[3] = false;       // المدير شال ✓ بإيده
    assert.strictEqual(mona({ action: 'list' }).ok, true, 'من الكاش');
    assert.strictEqual(reads, 0);
    w.ctx.onEdit({ range: { getSheet: () => ({ getName: () => 'معاملات' }) } });
    assert.strictEqual(mona({ action: 'list' }).ok, true, 'تعديل في شيت تاني مش بيمسح الكاش');
    w.ctx.onEdit({ range: { getSheet: () => ({ getName: () => EMP }) } });
    assert.match(mona({ action: 'list' }).error, /اتوقف/);
    assert.match(login('mona').error, /متوقف/);
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
    api({ action: 'update', id: 'CH000002', record: { 'الحاله': 'خالص', 'البنك': 'NBE', 'بيان': '=1+1', 'تذكير': '00123' } });
    const s = w.sheets[LOG];
    assert.deepStrictEqual(s.rows[0].slice(0, 8), ['الوقت', 'الموظف', 'العملية', 'الشيت', 'كود الشيك', 'العمود', 'القيمة القديمة', 'القيمة الجديدة']);
    const rows = s.rows.slice(1, s.getLastRow());
    assert.deepStrictEqual(rows.map(r => r[5]).sort(), ['الحاله', 'بيان', 'تذكير'].sort(), 'البنك ما اتغيرش فمش متسجل');
    assert.ok(rows.every(r => r[1] === 'المدير' && r[2] === 'تعديل' && r[4] === 'CH000002'));
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
    assert.strictEqual(Object.keys(w.cache).filter(k => k.startsWith('rid:')).length, 0);
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

// ===== تاريخ التحصيل =====
describe('تاريخ التحصيل', () => {
  const PD = 'تاريخ التحصيل', date = s => Utilities.parseDate(s, TZ);
  // نفس الشيت التجريبي + عمود «تاريخ التحصيل» في الآخر. dates = { صف: Date } و log = صفوف جاهزة في سجل التعديلات
  const withPaid = ({ dates = {}, status = {}, log } = {}) => {
    const fx = fixtures();
    fx[MAIN].rows = fx[MAIN].rows.map((r, i) => {
      const x = r.slice();
      if (status[i]) x[col('الحاله')] = status[i];
      return x.concat([i === 0 ? PD : (dates[i] || '')]);
    });
    if (log) fx[LOG] = { rows: [['الوقت', 'الموظف', 'العملية', 'الشيت', 'كود الشيك', 'العمود', 'القيمة القديمة', 'القيمة الجديدة'], ...log] };
    const w = makeWorld(fx);
    return { w, api: load(w), pd: MAIN_H.length };
  };
  const today = () => Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const iso = v => v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : v;
  const logRows = w => w.sheets[LOG].rows.slice(1, w.sheets[LOG].getLastRow());

  test('تعديل الحاله لـ خالص بيكتب تاريخ النهارده ويسجله في السجل', () => {
    const { w, api, pd } = withPaid();
    const r = api({ action: 'update', user: 'u', id: 'CH000001', record: { 'الحاله': 'خالص' } });
    assert.strictEqual(r.ok, true);
    const v = w.sheets[MAIN].rows[1][pd];
    assert.ok(v instanceof Date, 'اتكتب كتاريخ مش نص');
    assert.strictEqual(iso(v), today());
    assert.strictEqual(r.row[pd], today(), 'الرد للموقع فيه التاريخ');
    const row = logRows(w).find(x => x[5] === PD);
    assert.deepStrictEqual([row[4], row[6], row[7]], ['CH000001', '', today()]);
  });
  test('التعديل الجماعي لـ خالص بيكتب التاريخ لكل شيك، والشيكات التانية ما بتتلمسش', () => {
    const { w, api, pd } = withPaid();
    api({ action: 'updateMany', user: 'u', updates: [{ id: 'CH000001', record: { 'الحاله': 'خالص' } }, { id: 'CH000002', record: { 'بيان': 'x' } }, { id: 'CH000003', record: { 'الحاله': 'خالص' } }] });
    const rows = w.sheets[MAIN].rows;
    assert.strictEqual(iso(rows[1][pd]), today());
    assert.strictEqual(rows[2][pd], '');
    assert.strictEqual(iso(rows[3][pd]), today());
    assert.deepStrictEqual(logRows(w).filter(x => x[5] === PD).map(x => x[4]), ['CH000001', 'CH000003']);
  });
  test('مش بيكتب فوق تاريخ موجود، ولا لو الحاله كانت خالص أصلاً، ولا لو الحاله اتغيرت لحاجة تانية', () => {
    const { w, api, pd } = withPaid({ dates: { 1: date('2026-09-01') }, status: { 2: 'خالص' } });
    api({ action: 'update', user: 'u', id: 'CH000001', record: { 'الحاله': 'خالص' } });
    api({ action: 'update', user: 'u', id: 'CH000002', record: { 'الحاله': 'خالص', 'بيان': 'y' } });
    api({ action: 'update', user: 'u', id: 'CH000003', record: { 'الحاله': 'تحت التحصيل' } });
    const rows = w.sheets[MAIN].rows;
    assert.strictEqual(iso(rows[1][pd]), '2026-09-01');
    assert.strictEqual(rows[2][pd], '');
    assert.strictEqual(rows[3][pd], '');
    assert.strictEqual(logRows(w).filter(x => x[5] === PD).length, 0);
  });
  test('شيك جديد خالص بياخد التاريخ وبيظهر في ملخص السجل؛ والغير خالص لأ', () => {
    const { w, api, pd } = withPaid();
    const r = api({ action: 'addMany', user: 'u', records: [{ 'رقم الشيك': '1', 'الحاله': 'خالص' }, { 'رقم الشيك': '2', 'الحاله': 'تحت التحصيل' }] });
    assert.strictEqual(r.rows[0][pd], today());
    assert.strictEqual(r.rows[1][pd], '');
    const sum = logRows(w).find(x => x[4] === r.ids[0])[7];
    assert.match(sum, new RegExp(PD + ': ' + today()));
  });
  test('من غير عمود «تاريخ التحصيل» مفيش أي تغيير زي الأول', () => {
    const { w, api } = fresh();
    const width = w.sheets[MAIN].getLastColumn();
    api({ action: 'update', user: 'u', id: 'CH000001', record: { 'الحاله': 'خالص' } });
    api({ action: 'add', user: 'u', record: { 'رقم الشيك': '9', 'الحاله': 'خالص' } });
    assert.strictEqual(w.sheets[MAIN].getLastColumn(), width);
    assert.ok(!logRows(w).some(x => x[5] === PD));
  });
  test('backfillPaidDates: بياخد أول «الحاله ← خالص» من السجل، وسايب المجهول فاضي، ومش بيكتب فوق الموجود', () => {
    const L = (at, id, col, oldV, newV, sheet = 'الشيكات') => [at, 'منى', 'تعديل', sheet, id, col, oldV, newV];
    const { w, pd } = withPaid({
      status: { 1: 'خالص', 2: 'خالص', 3: 'خالص' },
      dates: { 3: date('2026-08-08') },
      log: [
        L('2026-10-05 10:00:00', 'CH000001', 'الحاله', 'تحت التحصيل', 'خالص'),
        L('2026-10-07 09:00:00', 'CH000001', 'الحاله', 'خالص', 'تحت التحصيل'),
        L('2026-10-09 12:00:00', 'CH000001', 'الحاله', 'تحت التحصيل', 'خالص'),
        L('2026-10-06 08:00:00', 'CH000002', 'بيان', '', 'خالص'),                   // عمود تاني — مش محسوب
        L('2026-10-06 08:00:00', 'CH000002', 'الحاله', '', 'خالص', 'شيكات المخازن'), // شيت تاني — مش محسوب
        L('2026-10-01 08:00:00', 'CH000003', 'الحاله', '', 'خالص'),
      ],
    });
    const r = w.ctx.backfillPaidDates();
    assert.deepStrictEqual({ ...r }, { filled: 1, unknown: 1, alreadyHad: 1 });
    const rows = w.sheets[MAIN].rows;
    assert.strictEqual(iso(rows[1][pd]), '2026-10-05', 'أول مرة اتعمل خالص');
    assert.strictEqual(rows[2][pd], '', 'مالوش صف في السجل = مش معروف');
    assert.strictEqual(iso(rows[3][pd]), '2026-08-08', 'التاريخ الموجود ما اتغيرش');
    const added = logRows(w).filter(x => x[5] === PD);
    assert.deepStrictEqual(added.map(x => [x[4], x[7]]), [['CH000001', '2026-10-05']]);
    assert.deepStrictEqual({ ...w.ctx.backfillPaidDates() }, { filled: 0, unknown: 1, alreadyHad: 2 }, 'التشغيل التاني ما بيغيرش حاجة');
  });
  test('backfillPaidDates من غير العمود بترمي رسالة واضحة', () => {
    const { w } = fresh();
    assert.throws(() => w.ctx.backfillPaidDates(), /ضيف عمود «تاريخ التحصيل»/);
  });

  // ===== الدفعات =====
  const P = (at, id, oldV, newV, col = 'دفعات شيكات', sheet = 'الشيكات') => [at, 'منى', 'تعديل', sheet, id, col, oldV, newV];
  test('payments: كل زيادة في «دفعات شيكات» = دفعة بالفرق في يومها، وأكتر من دفعة لنفس الشيك', () => {
    const { api } = withPaid({ log: [
      P('2026-09-01 10:00:00', 'CH000001', '0', '200'),
      P('2026-09-15 11:00:00', 'CH000001', '200', '1,000'),
      P('2026-09-20 09:00:00', 'CH000002', '', '500'),
      P('2026-09-21 09:00:00', 'CH000002', '500', '500'),                      // نفس القيمة — مش دفعة
      P('2026-09-22 09:00:00', 'CH000003', '0', '700', 'بيان'),                // عمود تاني
      P('2026-09-22 09:00:00', 'CH000003', '0', '700', 'دفعات شيكات', 'شيكات المخازن'),   // شيت تاني
    ] });
    const r = api({ action: 'payments' });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.map, { CH000001: [['2026-09-01', 200], ['2026-09-15', 800]], CH000002: [['2026-09-20', 500]] });
  });
  test('payments: النقص تصحيح مش دفعة — بيلغي آخر زيادة غلط', () => {
    const { api } = withPaid({ log: [
      P('2026-09-01 10:00:00', 'CH000001', '0', '300'),
      P('2026-09-10 10:00:00', 'CH000001', '300', '3300'),   // اتكتب 3300 بدل 330
      P('2026-09-10 10:05:00', 'CH000001', '3300', '330'),   // تصحيح
      P('2026-09-20 10:00:00', 'CH000001', '330', '600'),
      P('2026-09-21 10:00:00', 'CH000002', '0', '100'),
      P('2026-09-22 10:00:00', 'CH000002', '100', '0'),      // اتلغت خالص
    ] });
    assert.deepStrictEqual(api({ action: 'payments' }).map, { CH000001: [['2026-09-01', 300], ['2026-09-10', 30], ['2026-09-20', 270]] });
  });
  test('دفعات من الموقع ثم خالص: الدفعات في payments، والباقي = قيمة الشيك − دفعات في «تاريخ التحصيل»', () => {
    const { w, api, pd } = withPaid();
    api({ action: 'update', user: 'u', id: 'CH000001', record: { 'دفعات شيكات': '300' } });
    api({ action: 'update', user: 'u', id: 'CH000001', record: { 'دفعات شيكات': '700' } });
    const map = api({ action: 'payments' }).map;
    assert.deepStrictEqual(map, { CH000001: [[today(), 300], [today(), 400]] });
    api({ action: 'update', user: 'u', id: 'CH000001', record: { 'الحاله': 'خالص' } });
    const row = w.sheets[MAIN].rows[1];
    const rest = row[col('قيمة الشيك')] - row[col('دفعات شيكات')];
    assert.strictEqual(rest, 300);
    assert.strictEqual(iso(row[pd]), today());
    assert.strictEqual(map.CH000001.reduce((s, p) => s + p[1], 0) + rest, 1000, 'الدفعات + الباقي = قيمة الشيك');
  });
  test('payments من الكاش لحد ما السجل يزيد', () => {
    const { w, api } = withPaid({ log: [P('2026-09-01 10:00:00', 'CH000001', '0', '200')] });
    api({ action: 'payments' });
    const s = w.sheets[LOG], orig = s.getRange.bind(s);
    let reads = 0; s.getRange = (...a) => { reads++; return orig(...a); };
    api({ action: 'payments' });
    assert.strictEqual(reads, 0, 'من الكاش');
    s.getRange = orig;
    api({ action: 'update', user: 'u', id: 'CH000002', record: { 'دفعات شيكات': '50' } });
    assert.deepStrictEqual(Object.keys(api({ action: 'payments' }).map).sort(), ['CH000001', 'CH000002']);
  });
  test('backfillPaidDates: شيك خالص اتسدد بالدفعات بياخد يوم ما الدفعات وصلت لقيمته', () => {
    const { w, pd } = withPaid({
      status: { 1: 'خالص', 2: 'خالص' },
      log: [
        P('2026-09-01 10:00:00', 'CH000001', '0', '400'),
        P('2026-09-12 10:00:00', 'CH000001', '400', '1000'),          // قيمة الشيك 1000
        P('2026-09-30 10:00:00', 'CH000001', '', 'خالص', 'الحاله'),     // اتعلّم خالص بعدها
        P('2026-09-05 10:00:00', 'CH000002', '0', '500'),             // نص القيمة بس — مش معروف امتى اتسدد الباقي
      ],
    });
    const r = w.ctx.backfillPaidDates();
    assert.deepStrictEqual({ ...r }, { filled: 1, unknown: 1, alreadyHad: 0 });
    assert.strictEqual(iso(w.sheets[MAIN].rows[1][pd]), '2026-09-12');
    assert.strictEqual(w.sheets[MAIN].rows[2][pd], '');
  });
});
