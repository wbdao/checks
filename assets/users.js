// ===== المستخدمين والصلاحيات (مدير بس) =====
// السيرفر هو اللي بيتحقق من الصلاحية — الشاشة دي بتظهر للمدير بس علشان التنظيم
(() => {
  const { $, esc } = App;
  const ROLES = [App.ROLE_VIEW, App.ROLE_EDIT, App.ROLE_ADMIN];
  let users = [];

  function msg(text, cls) { const m = $('#usersMsg'); m.textContent = text; m.className = 'small ' + (cls || ''); }

  function render() {
    const me = App.session().username;
    $('#usersTable tbody').innerHTML = users.length ? users.map(u => {
      const self = u.username.toLowerCase() === String(me || '').toLowerCase();
      return `<tr data-u="${esc(u.username)}" class="${u.active ? '' : 'muted'}">
        <td dir="ltr"><b>${esc(u.username)}</b>${self ? ' <span class="badge">انت</span>' : ''}${u.hasPassword ? '' : ' <span class="badge">مالوش كلمة سر</span>'}</td>
        <td><input data-f="name" value="${esc(u.name)}" maxlength="60" autocomplete="off"></td>
        <td><select data-f="role" ${self ? 'disabled title="مينفعش تغيّر صلاحيتك"' : ''}>${ROLES.map(r => `<option${r === u.role ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select></td>
        <td><label class="inline chk"><input type="checkbox" data-f="active" ${u.active ? 'checked' : ''} ${self ? 'disabled' : ''}> ${u.active ? 'مفعّل' : 'متوقف'}</label></td>
        <td class="nowrap"><input data-f="password" type="text" dir="ltr" autocomplete="new-password" placeholder="8 حروف على الأقل" size="14">
          <button type="button" class="btn ghost" data-act="pass">تعيين</button></td>
      </tr>`;
    }).join('') : '<tr><td colspan="5" class="muted">مفيش مستخدمين لسه — ضيف أول مستخدم تحت.</td></tr>';
  }

  async function save(payload, okText) {
    msg('جاري الحفظ…');
    try {
      const d = await App.api('userSave', payload);
      users = d.users || [];
      render();
      msg('✓ ' + okText, 'ok');
      return true;
    } catch (e) {
      msg('⚠ ' + e.message, 'err');
      render();   // نرجّع الشاشة زي ما هي على السيرفر
      return false;
    }
  }

  async function open() {
    if (!App.isAdmin()) return;
    users = []; render(); msg('جاري التحميل…');
    $('#usersDlg').showModal();
    try { users = (await App.api('users')).users || []; render(); msg(''); } catch (e) { msg('⚠ ' + e.message, 'err'); }
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('#usersBtn').addEventListener('click', open);
    const tb = $('#usersTable tbody');
    tb.addEventListener('change', e => {
      const f = e.target.dataset.f, tr = e.target.closest('tr[data-u]');
      if (!tr || !f || f === 'password') return;
      const username = tr.dataset.u;
      if (f === 'name') save({ username, name: e.target.value.trim() }, 'الاسم اتغير');
      if (f === 'role') save({ username, role: e.target.value }, `صلاحية ${username} بقت «${e.target.value}»`);
      if (f === 'active') save({ username, active: e.target.checked }, e.target.checked ? `${username} اتفعّل` : `${username} اتوقف — مش هيقدر يدخل تاني`);
    });
    tb.addEventListener('click', async e => {
      if (!e.target.closest('[data-act="pass"]')) return;
      const tr = e.target.closest('tr[data-u]'), inp = tr.querySelector('[data-f="password"]');
      if (inp.value.length < 8) { msg('⚠ كلمة السر لازم تكون 8 حروف على الأقل', 'err'); inp.focus(); return; }
      await save({ username: tr.dataset.u, password: inp.value }, `كلمة سر ${tr.dataset.u} اتغيرت — ابعتهاله`);
    });
    $('#userAddForm').addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target;
      const el = f.elements;
      const payload = { username: el.username.value.trim(), name: el.name.value.trim(), role: el.role.value, password: el.password.value, active: true };
      if (users.some(u => u.username.toLowerCase() === payload.username.toLowerCase())) { msg('⚠ اسم المستخدم ده موجود — غيّر كلمة السر من الجدول فوق', 'err'); return; }
      if (await save(payload, `${payload.username} اتضاف — ابعتله اسم المستخدم وكلمة السر`)) f.reset();
    });
  });
})();
