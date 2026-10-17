// اختبارات الدوال الصافية في assets/review.js (شاشة مراجعة البيانات) — التشغيل: npm test
'use strict';
const { test, describe } = require('node:test');
const assert = require('assert');
const R = require('../assets/review.js');

const d = s => new Date(s + 'T00:00:00');
let n = 0;
const main = o => Object.assign({ id: 'CH' + String(++n).padStart(6, '0'), code: '101', name: 'أحمد', checkNo: String(1000 + n), bank: 'CIB',
  amountN: 1000, paidN: 0, due: '2026-11-01', dueD: d('2026-11-01'), status: 'تحت التحصيل', recvD: d('2026-10-01') }, o);
const wh = o => Object.assign({ whId: 'WH' + String(++n).padStart(5, '0'), _rowNum: n + 2, wh: '65', code: '101', name: 'أحمد', checkNo: String(5000 + n),
  bank: 'NBE', amountN: 500, collectedN: 0, due: '2026-11-01', dueD: d('2026-11-01'), state: 'NN', recvD: d('2026-10-01') }, o);
const byKey = gs => Object.fromEntries(gs.map(g => [g.key, g]));

describe('التكرار', () => {
  test('نفس الرقم + البنك مرتين بيظهروا الاتنين', () => {
    const a = main({ checkNo: '777', bank: 'CIB' }), b = main({ checkNo: '777', bank: ' cib ' }), c = main({ checkNo: '777', bank: 'QNB' });
    const out = R.duplicates([a, b, c], 'main');
    assert.deepStrictEqual(out.map(x => x.rec), [a, b]);
    assert.strictEqual(out[0].reason, 'متكرر مرتين');
  });
  test('أصفار على الشمال ومسافات ما بتفرقش', () => {
    const out = R.duplicates([wh({ checkNo: '00123', bank: 'NBE' }), wh({ checkNo: '1 23', bank: 'NBE' })], 'wh');
    assert.strictEqual(out.length, 2);
    assert.strictEqual(out[0].sheet, 'wh');
  });
  test('رقم شيك فاضي مش تكرار', () => {
    assert.strictEqual(R.duplicates([main({ checkNo: '' }), main({ checkNo: '' })], 'main').length, 0);
  });
});

describe('شيك في الشيتين', () => {
  test('خالص في واحد ومفتوح في التاني', () => {
    const m = main({ code: '101', checkNo: '42', status: 'خالص', amountN: 500 }), x = wh({ code: '101', checkNo: '42', state: 'NN', amountN: 500 });
    const out = R.crossConflicts([m], [x]);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].twin, x);
    assert.match(out[0].reason, /خالص/);
  });
  test('القيمة مختلفة', () => {
    const out = R.crossConflicts([main({ checkNo: '43', amountN: 1000 })], [wh({ checkNo: '43', amountN: 900 })]);
    assert.strictEqual(out.length, 1);
    assert.match(out[0].reason, /1,000.*900/);
  });
  test('متطابق أو كود عميل مختلف = مفيش مشكلة', () => {
    assert.strictEqual(R.crossConflicts([main({ checkNo: '44', amountN: 500, status: 'خالص' })], [wh({ checkNo: '44', amountN: 500, state: 'خالص' })]).length, 0);
    assert.strictEqual(R.crossConflicts([main({ checkNo: '45', code: '101' })], [wh({ checkNo: '45', code: '999', amountN: 1 })]).length, 0);
    // مفتوح في الاتنين (تم رد الشيك = مش خالص) بنفس القيمة
    assert.strictEqual(R.crossConflicts([main({ checkNo: '46', amountN: 500 })], [wh({ checkNo: '46', amountN: 500, state: 'تم رد الشيك' })]).length, 0);
  });
});

describe('mm في المخازن', () => {
  test('القيم الصح بتعدّي، والغلط والفاضي بيظهروا', () => {
    const ok = ['خالص', 'تم رد الشيك', 'NN', ' NN '].map(state => wh({ state }));
    const bad = [wh({ state: '1234567' }), wh({ state: '' }), wh({ state: 'nn' })];
    const out = R.badStates(ok.concat(bad));
    assert.deepStrictEqual(out.map(x => x.rec), bad);
    assert.match(out[0].reason, /رقم شيك/);
    assert.match(out[1].reason, /فاضي/);
  });
});

describe('بيانات ناقصة', () => {
  test('كل الأسباب في صف واحد', () => {
    const r = main({ dueD: null, due: '', bank: ' ', checkNo: '', amountN: 0 });
    const out = R.fieldProblems([r, main()], 'main');
    assert.strictEqual(out.length, 1);
    assert.match(out[0].reason, /مفيش تاريخ استحقاق/);
    assert.match(out[0].reason, /مفيش بنك/);
    assert.match(out[0].reason, /مفيش رقم شيك/);
    assert.match(out[0].reason, /صفر/);
  });
  test('تاريخ مش مفهوم', () => {
    assert.match(R.fieldProblems([main({ dueD: null, due: 'بكره' })], 'main')[0].reason, /مش مفهوم «بكره»/);
  });
  test('الدفعات أكبر من القيمة (الشيكات) والتحصيل أكبر من القيمة (المخازن)', () => {
    assert.match(R.fieldProblems([main({ amountN: 100, paidN: 150 })], 'main')[0].reason, /دفعات شيكات/);
    assert.match(R.fieldProblems([wh({ amountN: 100, collectedN: 150 })], 'wh')[0].reason, /التحصيل/);
    assert.strictEqual(R.fieldProblems([main({ amountN: 100, paidN: 100 })], 'main').length, 0);
  });
});

test('شيكات مخازن من غير كود WH', () => {
  const a = wh({ whId: '' }), b = wh();
  assert.deepStrictEqual(R.missingWhId([a, b]).map(x => x.rec), [a]);
});

describe('كود عميل بأكتر من اسم', () => {
  test('بين الشيتين، ومعاه آخر شيك بكل اسم', () => {
    const m1 = main({ code: '200', name: 'محمد علي', recvD: d('2026-01-01') });
    const m2 = main({ code: '200', name: 'محمد  علي ', recvD: d('2026-02-01') });   // مسافات زيادة = نفس الاسم
    const x = wh({ code: '200', name: 'محمد على' });
    const out = R.multiNames([m1, m2, main({ code: '300', name: 'سارة' })], [x, wh({ code: '300', name: '#N/A' })]);
    assert.strictEqual(out.length, 2);
    assert.strictEqual(out[0].name, 'محمد علي');
    assert.strictEqual(out[0].count, 2);
    assert.strictEqual(out[0].rec, m2);
    assert.strictEqual(out[1].sheet, 'wh');
    assert.strictEqual(out[1].sheets, 'المخازن');
  });
});

describe('findIssues', () => {
  test('من غير شيت المخازن: مجموعاته pending وفاضية', () => {
    const g = byKey(R.findIssues([main({ checkNo: '9' }), main({ checkNo: '9' })], null));
    assert.strictEqual(g.dupMain.items.length, 2);
    for (const k of ['dupWh', 'cross', 'mm', 'noWh']) { assert.strictEqual(g[k].pending, true); assert.strictEqual(g[k].items.length, 0); }
    assert.strictEqual(g.fields.pending, false);
  });
  test('كل المجموعات بالترتيب ومن الشيتين', () => {
    const gs = R.findIssues([main({ amountN: -5 })], [wh({ whId: '', state: '55555' })]);
    assert.deepStrictEqual(gs.map(g => g.key), ['dupMain', 'dupWh', 'cross', 'mm', 'fields', 'noWh', 'names']);
    const g = byKey(gs);
    assert.strictEqual(g.mm.items.length, 1);
    assert.strictEqual(g.noWh.items.length, 1);
    assert.deepStrictEqual(g.fields.items.map(i => i.sheet), ['main']);
  });
  test('ref', () => {
    assert.strictEqual(R.ref('wh', { whId: '', _rowNum: 7 }), 'صف 7');
    assert.strictEqual(R.ref('main', { id: 'CH1' }), 'CH1');
  });
});
