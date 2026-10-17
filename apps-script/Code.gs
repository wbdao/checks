/**
 * واجهة برمجية لشيت الشيكات — تُنشر كـ Web App من داخل الشيت (Extensions > Apps Script).
 * كل الطلبات POST بجسم JSON نصي: { action, token, ... } — token من login { username, password } (المستخدمين في شيت «الموظفين»)
 *   list   → يرجع رؤوس الأعمدة وكل الصفوف + قوائم الاختيار من شيت "معاملات"
 *   add    → يضيف شيك جديد (يولّد NN تلقائياً ويكتب معادلات الأعمدة المحسوبة)
 *   update → يعدّل شيك موجود بالـ NN
 */

// ===== الإعدادات =====
// SECRET = كلمة سر الدخول الاحتياطي للمدير (اسم المستخدم admin) — التعديلات بيه بتتسجل باسم «المدير»
const SECRET = 'غيّر-هذا-الرمز';
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
const DATE_HEADERS = ['تاريخ الاستلام', 'تاريخ الاستحقاق', 'تاريخ خروج الشيك', 'تاريخ التحصيل'];
// تاريخ التحصيل (عمود اختياري): لما «الحاله» تتغير لـ «خالص» من الموقع وخانة التاريخ فاضية بيتكتب تاريخ النهارده.
// عمره ما بيكتب فوق تاريخ موجود، ولو العمود مش موجود في الشيت مفيش حاجة بتحصل
const STATUS_HEADER = 'الحاله';
const PAID_STATUS = 'خالص';
const PAID_DATE = 'تاريخ التحصيل';
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

// المستخدمين (شيت «الموظفين»): اسم مستخدم + اسم + صلاحية + مفعّل + كلمة السر (hash + salt، عمرها ما بتتخزن صريحة).
// الشيت بيتعمل لوحده، والمستخدمين بيتضافوا من شاشة «المستخدمين» في الموقع (كلمة السر لازم تتعمل من هناك).
// الجدول بيتحفظ في الكاش EMP_TTL ثانية، وأي تعديل في الشيت (onEdit أو من الموقع) بيمسح الكاش فوراً
const EMP_SHEET = 'الموظفين';
const EMP_HEADERS = ['اسم المستخدم', 'الاسم', 'الصلاحية', 'مفعّل', 'كلمة السر (مشفرة)', 'Salt'];
const EMP_TTL = 5 * 60;
const EMP_CACHE = 'emp:v2';
const ADMIN_NAME = 'المدير';             // الدخول الاحتياطي: اسم المستخدم admin + كلمة السر = SECRET
const BREAK_GLASS = '*admin*';
const ROLE_VIEW = 'مشاهدة', ROLE_EDIT = 'تعديل', ROLE_ADMIN = 'مدير';
const ROLES = [ROLE_VIEW, ROLE_EDIT, ROLE_ADMIN];
const READ_ACTIONS = ['list', 'listWh', 'history', 'payments', 'backupInfo'];   // لأي صلاحية — أي إجراء تاني محتاج «تعديل» على الأقل
const ADMIN_ACTIONS = ['users', 'userSave'];
const SESSION_MAX = 12 * 60 * 60;       // الدخول بيفضل شغال 12 ساعة بالكتير
const SESSION_REFRESH = 10 * 60;        // بنجدد مدة الكاش مع الاستخدام كل 10 دقايق
const CACHE_MAX = 6 * 60 * 60;          // أقصى مدة في CacheService
const HASH_ROUNDS = 300;
const MIN_PASS = 8;
const MAX_FAILS = 5, LOCK_MIN = 15;     // 5 محاولات غلط لنفس اسم المستخدم = قفل 15 دقيقة
const LOGIN_NEEDED = 'لازم تسجّل دخول (أو الدخول انتهى) — سجّل دخول تاني';
const EMP_YES = ['true', 'نعم', 'اه', 'آه', 'ايوه', 'أيوه', 'مفعل', 'مفعّل', '✓', '✔', '1', 'yes', 'y'];

// سجل التعديلات: الاسم بييجي من جلسة الدخول (مش من الموقع)، وبيتسجل صف لكل خانة اتغيرت
// (وصف لكل شيك جديد) في شيت «سجل التعديلات» — بيتعمل لوحده لو مش موجود. history → سجل شيك واحد بالـ NN أو WH
const LOG_SHEET = 'سجل التعديلات';
const LOG_HEADERS = ['الوقت', 'الموظف', 'العملية', 'الشيت', 'كود الشيك', 'العمود', 'القيمة القديمة', 'القيمة الجديدة'];
const LOG_MAIN = 'الشيكات', LOG_WH = 'شيكات المخازن', LOG_USERS = 'المستخدمين';
const WRITE_ACTIONS = {
  add: 'إضافة', addMany: 'إدراج من جدول', update: 'تعديل', updateMany: 'تعديل جماعي',
  whAdd: 'إضافة', whUpdate: 'تعديل', whFillIds: 'إعطاء أكواد WH', userSave: 'مستخدمين',
};
const NEW_CHECK = '(شيك جديد)';
const NEW_SUMMARY = ['كود العميل', 'اسم العميل سيستم', 'اسم العميل', 'رقم الشيك', 'البنك', 'قيمة الشيك', 'تاريخ الاستحقاق', 'الحاله', 'تاريخ التحصيل'];
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
    if (SECRET === 'غيّر-هذا-الرمز') throw new Error('غيّر SECRET في أول Code.gs (سطر const SECRET) قبل الاستخدام');
    if (req.action === 'login') return json_(Object.assign(login_(req), { ok: true }));
    if (req.action === 'logout') return json_(Object.assign(logout_(req.token), { ok: true }));
    const who = session_(req.token);
    req.user = who.name;   // اسم السجل من الجلسة — أي user جاي من الموقع بيتجاهل
    const need = ADMIN_ACTIONS.indexOf(req.action) >= 0 ? ROLE_ADMIN : READ_ACTIONS.indexOf(req.action) >= 0 ? ROLE_VIEW : ROLE_EDIT;
    if (ROLES.indexOf(who.role) < ROLES.indexOf(need)) {
      throw new Error(need === ROLE_ADMIN ? 'الإجراء ده للمدير بس' : 'صلاحيتك «' + who.role + '» — مش مسموحلك تضيف أو تعدّل. كلّم المدير');
    }
    if (req.action === 'list') { out = list_(); out.user = who.name; out.role = who.role; out.username = who.username === BREAK_GLASS ? 'admin' : who.username; }
    else if (req.action === 'users') out = usersList_();
    else if (req.action === 'userSave') out = withLock_(req, () => userSave_(req, who));
    else if (req.action === 'history') out = history_(req.id);
    else if (req.action === 'payments') out = payments_();
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
    if (err && err.login) out.login = true;
  }
  return json_(out);
}
function json_(out) { return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON); }

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, msg: 'Checks API يعمل — استخدم POST' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===== الدخول: اسم مستخدم + كلمة سر لكل موظف =====
// login → توكن عشوائي في CacheService. كل طلب بعد كده بيبعت token، والسيرفر بيعرف منه الاسم والصلاحية
// (من شيت «الموظفين» وقت الطلب — فإيقاف موظف أو تغيير صلاحيته بيشتغل فوراً)
function session_(token) {
  token = String(token || '').trim();
  if (!token) throw loginErr_(LOGIN_NEEDED);
  const cache = CacheService.getScriptCache();
  const key = 'sess:' + token;
  let s = null;
  try { s = JSON.parse(cache.get(key) || 'null'); } catch (e) { s = null; }
  const now = Date.now();
  if (!s || !(s.exp > now)) { try { cache.remove(key); } catch (e) { } throw loginErr_(LOGIN_NEEDED); }
  let who;
  if (s.u === BREAK_GLASS) {
    if (s.sv !== secretTag_()) { cache.remove(key); throw loginErr_(LOGIN_NEEDED); }   // SECRET اتغير
    who = { username: BREAK_GLASS, name: ADMIN_NAME, role: ROLE_ADMIN };
  } else {
    const us = users_();
    const u = Object.prototype.hasOwnProperty.call(us, s.u) ? us[s.u] : null;
    if (!u || !u.active) { cache.remove(key); throw loginErr_('حسابك اتوقف أو اتشال — كلّم المدير'); }
    who = { username: normUser_(u.username), name: u.name, role: u.role };
  }
  // تجديد مع الاستخدام (الكاش حده 6 ساعات) — بحد أقصى SESSION_MAX من وقت الدخول
  if (now - (s.t || 0) > SESSION_REFRESH * 1000) {
    s.t = now;
    try { cache.put(key, JSON.stringify(s), Math.max(1, Math.min(CACHE_MAX, Math.ceil((s.exp - now) / 1000)))); } catch (e) { }
  }
  return who;
}

function login_(req) {
  const uname = normUser_(req.username);
  const pass = String(req.password || '');
  if (!uname || !pass) throw new Error('اكتب اسم المستخدم وكلمة السر');
  const cache = CacheService.getScriptCache();
  const failKey = 'fail:' + uname, lockKey = 'lock:' + uname;
  if (cache.get(lockKey)) throw new Error('الحساب ده مقفول ' + LOCK_MIN + ' دقيقة بسبب محاولات غلط كتير — استنى وحاول تاني، أو كلّم المدير');
  let who = null;
  if ((uname === 'admin' || uname === normUser_(ADMIN_NAME)) && pass === SECRET) {
    who = { username: BREAK_GLASS, name: ADMIN_NAME, role: ROLE_ADMIN };
  } else {
    const us = users_();
    const u = Object.prototype.hasOwnProperty.call(us, uname) ? us[uname] : null;
    if (u && u.hash && u.salt && hashPass_(pass, u.salt) === u.hash) {
      if (!u.active) throw new Error('الحساب ده متوقف — كلّم المدير');
      who = { username: uname, name: u.name, role: u.role };
    }
  }
  if (!who) {
    const n = (parseInt(cache.get(failKey), 10) || 0) + 1;
    if (n >= MAX_FAILS) {
      cache.put(lockKey, '1', LOCK_MIN * 60); cache.remove(failKey);
      throw new Error('محاولات غلط كتير — الحساب اتقفل ' + LOCK_MIN + ' دقيقة');
    }
    cache.put(failKey, String(n), LOCK_MIN * 60);
    throw new Error('اسم المستخدم أو كلمة السر غلط (فاضل ' + (MAX_FAILS - n) + ' محاولات قبل القفل)');
  }
  cache.remove(failKey);
  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  const now = Date.now();
  const s = { u: who.username, exp: now + SESSION_MAX * 1000, t: now };
  if (s.u === BREAK_GLASS) s.sv = secretTag_();
  cache.put('sess:' + token, JSON.stringify(s), CACHE_MAX);
  return { token, name: who.name, role: who.role, username: who.username === BREAK_GLASS ? 'admin' : who.username };
}

function logout_(token) {
  token = String(token || '').trim();
  if (token) CacheService.getScriptCache().remove('sess:' + token);
  return {};
}

function loginErr_(msg) { const e = new Error(msg); e.login = true; return e; }   // الموقع بيفتح شاشة الدخول
const normUser_ = u => String(u || '').trim().toLowerCase();
const hex_ = bytes => bytes.map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
const sha_ = s => hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8));
// SHA-256 مكرر HASH_ROUNDS مرة بـ salt مختلف لكل مستخدم
function hashPass_(pass, salt) {
  let h = sha_(salt + ':' + pass);
  for (let i = 0; i < HASH_ROUNDS; i++) h = sha_(h + salt);
  return h;
}
function secretTag_() { return sha_('secret:' + SECRET).slice(0, 12); }

// { اسم المستخدم (حروف صغيرة): { username, name, role, active, hash, salt, row } } — من الكاش أو الشيت
function users_() {
  const cache = CacheService.getScriptCache();
  try { const hit = cache.get(EMP_CACHE); if (hit) return JSON.parse(hit); } catch (e) { /* نقرا الشيت */ }
  const sh = empSheet_();
  const c = empCols_(sh);
  const vals = sh.getDataRange().getValues();
  const out = Object.create(null);
  vals.slice(1).forEach((r, i) => {
    const username = String(r[c.user - 1] === undefined ? '' : r[c.user - 1]).trim();
    const k = normUser_(username);
    if (!k || out[k]) return;   // أول صف بالاسم ده هو اللي بيتحسب
    const role = String(r[c.role - 1] === undefined ? '' : r[c.role - 1]).trim();
    const cell = col => String(r[col - 1] === undefined ? '' : r[col - 1]).trim();
    out[k] = {
      username, name: cell(c.name).slice(0, 60) || username,
      role: ROLES.indexOf(role) >= 0 ? role : ROLE_VIEW,
      active: EMP_YES.indexOf(cell(c.active).toLowerCase()) >= 0,
      hash: cell(c.hash), salt: cell(c.salt), row: i + 2,
    };
  });
  try { cache.put(EMP_CACHE, JSON.stringify(out), EMP_TTL); } catch (e) { /* الكاش اختياري */ }
  return out;
}

function empSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(EMP_SHEET);
  if (!sh) {
    sh = ss.insertSheet(EMP_SHEET);
    sh.getRange(1, 1, 1, EMP_HEADERS.length).setValues([EMP_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

// أرقام الأعمدة بالعناوين — أي عنوان ناقص (شيت قديم) بيتضاف في آخر الصف الأول
function empCols_(sh) {
  const map = sh.getLastColumn() ? headerMap_(sh) : {};
  const missing = EMP_HEADERS.filter(h => !map[h]);
  if (missing.length) {
    const start = sh.getLastColumn() + 1;
    const extra = start + missing.length - 1 - sh.getMaxColumns();
    if (extra > 0) sh.insertColumnsAfter(sh.getMaxColumns(), extra);
    sh.getRange(1, start, 1, missing.length).setValues([missing]).setFontWeight('bold');
    missing.forEach((h, i) => { map[h] = start + i; });
  }
  return { user: map[EMP_HEADERS[0]], name: map[EMP_HEADERS[1]], role: map[EMP_HEADERS[2]], active: map[EMP_HEADERS[3]], hash: map[EMP_HEADERS[4]], salt: map[EMP_HEADERS[5]] };
}

// ===== إدارة المستخدمين (مدير بس) =====
// عمرها ما بترجع كلمة السر ولا الـ hash
function usersList_() {
  const us = users_();
  return { users: Object.keys(us).map(k => ({ username: us[k].username, name: us[k].name, role: us[k].role, active: us[k].active, hasPassword: !!us[k].hash })) };
}

// إضافة أو تعديل مستخدم: { username, name?, role?, active?, password? } — password = تعيين/إعادة تعيين كلمة السر
function userSave_(req, who) {
  const username = String(req.username || '').trim();
  const k = normUser_(username);
  if (!/^[a-z0-9._-]{3,30}$/.test(k)) throw new Error('اسم المستخدم لازم يكون من 3 لـ 30 حرف إنجليزي أو رقم (ومسموح . _ -) من غير مسافات');
  if (k === 'admin') throw new Error('اسم المستخدم admin محجوز للدخول الاحتياطي — اختار اسم تاني');
  if (req.role !== undefined && ROLES.indexOf(req.role) < 0) throw new Error('الصلاحية لازم تكون: ' + ROLES.join(' / '));
  const pass = req.password === undefined || req.password === null ? '' : String(req.password);
  if (pass && pass.length < MIN_PASS) throw new Error('كلمة السر لازم تكون ' + MIN_PASS + ' حروف على الأقل');
  if (k === who.username && (req.active === false || (req.role !== undefined && req.role !== ROLE_ADMIN))) {
    throw new Error('مينفعش توقف حسابك أو تشيل صلاحية المدير من نفسك — خلّي مدير تاني يعملها');
  }
  const sh = empSheet_();
  const c = empCols_(sh);
  CacheService.getScriptCache().remove(EMP_CACHE);
  const us = users_();
  const existing = Object.prototype.hasOwnProperty.call(us, k) ? us[k] : null;
  const width = Math.max.apply(null, Object.keys(c).map(x => c[x]));
  let row, before;
  if (existing) {
    row = existing.row;
    before = sh.getRange(row, 1, 1, width).getValues()[0];
  } else {
    if (!pass) throw new Error('مستخدم جديد محتاج كلمة سر');
    row = Math.max(sh.getLastRow(), 1) + 1;
    if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 1);
    before = new Array(width).fill('');
  }
  const after = before.slice();
  after[c.user - 1] = existing ? before[c.user - 1] : username;
  if (req.name !== undefined || !existing) after[c.name - 1] = String(req.name || username).trim().slice(0, 60);
  if (req.role !== undefined || !existing) after[c.role - 1] = req.role || ROLE_VIEW;
  if (req.active !== undefined || !existing) after[c.active - 1] = req.active !== false;
  if (pass) {
    const salt = Utilities.getUuid().replace(/-/g, '');
    after[c.salt - 1] = salt;
    after[c.hash - 1] = hashPass_(pass, salt);
  }
  // السجل: كل خانة اتغيرت (كلمة السر بتتسجل «اتغيرت» بس، من غير قيمتها)
  const id = String(after[c.user - 1]);
  if (!existing) audit_(LOG_USERS, id, '(مستخدم جديد)', '', 'الاسم: ' + after[c.name - 1] + ' • الصلاحية: ' + after[c.role - 1]);
  else {
    [['name', 'الاسم'], ['role', 'الصلاحية'], ['active', 'مفعّل']].forEach(([f, label]) => {
      const o = String(before[c[f] - 1]), n = String(after[c[f] - 1]);
      if (o !== n) audit_(LOG_USERS, id, label, o, n);
    });
  }
  if (pass) audit_(LOG_USERS, id, 'كلمة السر', '', existing ? '(اتغيرت)' : '(اتعملت)');
  sh.getRange(row, 1, 1, width).setValues([after]);
  CacheService.getScriptCache().remove(EMP_CACHE);
  return usersList_();
}

// أي تعديل يدوي في شيت «الموظفين» (إيقاف موظف/تغيير صلاحية) بيشتغل فوراً من غير ما نستنى الكاش
function onEdit(e) {
  try {
    if (e && e.range && e.range.getSheet().getName() === EMP_SHEET) CacheService.getScriptCache().remove(EMP_CACHE);
  } catch (err) { /* مش مهم */ }
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
  records = records.map(record => stampPaid_(map, Object.assign({}, record), null));
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
  stampPaid_(map, rec, before);
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
    stampPaid_(map, rec, before[rowOf[u.id] - 1]);
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

// «الحاله» اتغيرت لـ «خالص» وخانة «تاريخ التحصيل» فاضية → نضيف تاريخ النهارده للـ rec (فبيتكتب ويتسجل
// في السجل زي أي خانة). before = الصف قبل الكتابة (null لشيك جديد). لو العمود مش موجود، أو الحاله كانت
// خالص أصلاً، أو فيه تاريخ في الشيت أو في الطلب — مفيش تغيير
function stampPaid_(map, rec, before) {
  const dCol = map[PAID_DATE], sCol = map[STATUS_HEADER];
  if (!dCol || !sCol) return rec;
  const keys = Object.keys(rec);
  const sk = keys.filter(h => h.trim() === STATUS_HEADER)[0];
  if (sk === undefined || String(rec[sk]).trim() !== PAID_STATUS) return rec;
  if (keys.some(h => h.trim() === PAID_DATE && String(rec[h] == null ? '' : rec[h]).trim() !== '')) return rec;
  if (before && String(before[sCol - 1]).trim() === PAID_STATUS) return rec;
  if (before && before[dCol - 1] !== '' && before[dCol - 1] !== null) return rec;
  keys.filter(h => h.trim() === PAID_DATE).forEach(h => delete rec[h]);
  rec[PAID_DATE] = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
  return rec;
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

// ===== دفعات الشيكات (من سجل التعديلات) =====
// كل زيادة في «دفعات شيكات» في السجل = دفعة بالفرق في يوم التعديل. النقص مش دفعة: ده تصحيح بيلغي آخر دفعات
// اتكتبت زيادة (من الأحدث للأقدم) لحد ما المجموع ينزل بنفس الفرق. الدفعة الأخيرة (الباقي لما الحاله تبقى خالص)
// مش هنا — الموقع بيحسبها من «تاريخ التحصيل»: قيمة الشيك − دفعات شيكات
const PAY_HEADER = 'دفعات شيكات';
const PAY_TTL = 10 * 60;               // مفتاح الكاش فيه عدد صفوف السجل، فأي تعديل جديد بيتقري من الأول

// صفوف السجل → { NN: [[yyyy-MM-dd, مبلغ], …] } — بس الشيكات اللي ليها دفعات
function paymentsFromLog_(vals, tz) {
  const num = v => { const s = String(v == null ? '' : v).replace(/,/g, '').trim(); return s === '' ? 0 : Number(s); };
  const out = {};
  vals.forEach(r => {
    if (String(r[3]).trim() !== LOG_MAIN || String(r[5]).trim() !== PAY_HEADER) return;
    const id = String(r[4]).trim();
    const at = r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'yyyy-MM-dd') : String(r[0]).trim().slice(0, 10);
    const oldV = num(r[6]), newV = num(r[7]);
    if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(at) || isNaN(oldV) || isNaN(newV) || newV === oldV) return;
    const list = out[id] || (out[id] = []);
    if (newV > oldV) { list.push([at, Math.round((newV - oldV) * 100) / 100]); return; }
    let cut = oldV - newV;
    while (cut > 0.005 && list.length) {
      const p = list[list.length - 1];
      if (p[1] <= cut + 0.005) { cut -= p[1]; list.pop(); } else { p[1] = Math.round((p[1] - cut) * 100) / 100; cut = 0; }
    }
  });
  Object.keys(out).forEach(id => { if (!out[id].length) delete out[id]; });
  return out;
}

// للموقع: { map: { NN: [[تاريخ, مبلغ], …] } } بقراية واحدة للسجل
function payments_() {
  const log = SpreadsheetApp.getActive().getSheetByName(LOG_SHEET);
  if (!log || log.getLastRow() < 2) return { map: {} };
  const cache = CacheService.getScriptCache(), key = 'pay:v1:' + log.getLastRow();
  try { const hit = cache.get(key); if (hit) return { map: JSON.parse(hit) }; } catch (e) { /* نقرا السجل */ }
  const map = paymentsFromLog_(log.getRange(2, 1, log.getLastRow() - 1, LOG_HEADERS.length).getValues(), tz_());
  try { const txt = JSON.stringify(map); if (txt.length < RID_MAX_CHARS) cache.put(key, txt, PAY_TTL); } catch (e) { /* الكاش اختياري */ }
  return { map };
}

// ===== تعبئة «تاريخ التحصيل» للشيكات القديمة =====
// شغّلها مرة واحدة من المحرر (اختار backfillPaidDates ← Run) بعد ما تضيف عمود «تاريخ التحصيل».
// كل شيك «خالص» وخانة تاريخه فاضية بياخد أول يوم اتسدد فيه بالكامل حسب «سجل التعديلات»: أول «الحاله ← خالص»،
// أو أول مرة «دفعات شيكات» وصلت لقيمة الشيك (لو اتسدد بالدفعات) — الأقدم فيهم.
// الشيكات اللي مالهاش صف في السجل (اتعملت خالص قبل السجل أو من الشيت بإيدك) بتفضل فاضية (مش معروف).
// مش بتكتب فوق أي تاريخ موجود، وتشغيلها مرتين ما بيغيرش حاجة
function backfillPaidDates() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  AUDIT_ = [];
  try {
    const tz = tz_();
    const sh = sheet_();
    const map = headerMap_(sh);
    const dCol = map[PAID_DATE], sCol = map[STATUS_HEADER], idCol = map[ID_HEADER], aCol = map['قيمة الشيك'];
    if (!dCol) throw new Error('ضيف عمود «' + PAID_DATE + '» في أول صف في شيت «' + DATA_SHEET + '» الأول');
    if (!sCol || !idCol) throw new Error('عمود «' + STATUS_HEADER + '» أو «' + ID_HEADER + '» مش موجود');

    // من السجل: أول وقت «الحاله ← خالص»، وكل قيمة جديدة لـ «دفعات شيكات» بوقتها
    const first = {}, pays = {};
    const log = SpreadsheetApp.getActive().getSheetByName(LOG_SHEET);
    if (log && log.getLastRow() > 1) {
      log.getRange(2, 1, log.getLastRow() - 1, LOG_HEADERS.length).getValues().forEach(r => {
        if (String(r[3]).trim() !== LOG_MAIN) return;
        const c = String(r[5]).trim(), id = String(r[4]).trim();
        const at = r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'yyyy-MM-dd HH:mm:ss') : String(r[0]).trim();
        if (!id || !/^\d{4}-\d{2}-\d{2}/.test(at)) return;
        if (c === STATUS_HEADER && String(r[7]).trim() === PAID_STATUS) { if (!first[id] || at < first[id]) first[id] = at; }
        else if (c === PAY_HEADER) (pays[id] = pays[id] || []).push([at, Number(String(r[7]).replace(/,/g, ''))]);
      });
    }

    const last = lastDataRow_(sh, idCol);
    const out = { filled: 0, unknown: 0, alreadyHad: 0 };
    if (last < 2) return out;
    const n = last - 1;
    const ids = sh.getRange(2, idCol, n, 1).getValues(), st = sh.getRange(2, sCol, n, 1).getValues();
    const amounts = aCol ? sh.getRange(2, aCol, n, 1).getValues() : null;
    const dates = sh.getRange(2, dCol, n, 1).getValues();
    for (let i = 0; i < n; i++) {
      if (String(st[i][0]).trim() !== PAID_STATUS) continue;
      if (dates[i][0] !== '' && dates[i][0] !== null) { out.alreadyHad++; continue; }
      const id = String(ids[i][0]).trim(), amt = amounts ? Number(amounts[i][0]) : 0;
      let at = first[id];
      if (amt > 0) (pays[id] || []).forEach(p => { if (p[1] >= amt - 0.005 && (!at || p[0] < at)) at = p[0]; });
      if (!at) { out.unknown++; continue; }
      dates[i][0] = Utilities.parseDate(at.slice(0, 10), tz, 'yyyy-MM-dd');
      audit_(LOG_MAIN, id, PAID_DATE, '', at.slice(0, 10));
      out.filled++;
    }
    if (out.filled) sh.getRange(2, dCol, n, 1).setValues(dates);
    flushAudit_({ action: 'تعبئة تاريخ التحصيل من السجل', user: '(من محرر Apps Script)' });
    Logger.log('اتملى %s شيك • %s خالص من غير صف في السجل (فضلوا فاضيين) • %s كان ليهم تاريخ', out.filled, out.unknown, out.alreadyHad);
    return out;
  } finally { AUDIT_ = null; lock.releaseLock(); }
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
