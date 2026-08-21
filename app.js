const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function showView(name) {
  $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === name));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
}

let loggedIn = false;

document.addEventListener('click', e => {
  const trigger = e.target.closest('[data-go]');
  if (!trigger) return;
  e.preventDefault();
  const target = trigger.dataset.go;
  if (target === 'checker' && !loggedIn) {
    setAuthMode('register');
    showView('register');
    return;
  }
  showView(target);
});

window.addEventListener('load', async () => {
  const from = location.hash.replace('#', '');
  if (['register', 'connect'].includes(from)) showView(from);
  startCounters();
  handleSteamReturn();

  if (sb) {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      const info = await loadProfile();
      if (info) { renderTier(info.profile); updateNav(info.profile); renderSteam(info.profile); }
    }
  }
});

const CFG = window.RUSTCHK_CONFIG || {};
const configured = CFG.SUPABASE_URL && !CFG.SUPABASE_URL.includes('ВСТАВЬ');
let sb = null;
if (configured && window.supabase) {
  sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY);
} else {
  console.warn('[RustChecker] Supabase не настроен — впиши SUPABASE_URL в config.js');
}

let authMode = 'register';
function setAuthMode(mode) {
  authMode = mode;
  const reg = mode === 'register';
  $('#authTitle').textContent = reg ? 'Создать аккаунт' : 'Вход';
  $('#authSubtitle').textContent = reg
    ? 'Зарегистрируйся, чтобы отслеживать игроков и подключить Rust+.'
    : 'Войди по логину и паролю.';
  $('#authSubmit').innerHTML = reg
    ? 'Создать аккаунт <svg class="ic"><use href="#i-arrow"/></svg>'
    : 'Войти <svg class="ic"><use href="#i-arrow"/></svg>';
  $('#nickField input').placeholder = reg ? 'Придумай логин' : 'Логин или email';
  $('#emailField').style.display = reg ? '' : 'none';
  $('#authSwitch').innerHTML = reg
    ? 'Уже есть аккаунт? <a href="#" id="toLogin">Войти</a>'
    : 'Нет аккаунта? <a href="#" id="toRegister">Регистрация</a>';
  clearMsg();
}
function clearMsg() { $('#regErr').textContent = ''; $('#regOk').textContent = ''; }

document.addEventListener('click', e => {
  if (e.target.id === 'toLogin') { e.preventDefault(); setAuthMode('login'); }
  if (e.target.id === 'toRegister') { e.preventDefault(); setAuthMode('register'); }
});
$('#navLogin').addEventListener('click', () => { setAuthMode('login'); showView('register'); });

$('#registerForm').addEventListener('submit', async e => {
  e.preventDefault();
  clearMsg();
  const data = Object.fromEntries(new FormData(e.target));
  const btn = $('#authSubmit');

  if (!data.nick) {
    $('#regErr').textContent = authMode === 'register' ? 'Придумай логин.' : 'Введи логин.';
    return;
  }
  if ((data.password || '').length < 6) {
    $('#regErr').textContent = 'Пароль минимум из 6 символов.';
    return;
  }
  if (authMode === 'register' && !data.email) {
    $('#regErr').textContent = 'Укажи email для подтверждения.';
    return;
  }
  if (!sb) {
    $('#regErr').textContent = 'Supabase не настроен: впиши URL проекта в config.js.';
    return;
  }

  const label = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = authMode === 'register' ? 'Отправляем код…' : 'Входим…';

  try {
    if (authMode === 'register') {
      pendingSignup = {
        email: data.email.trim().toLowerCase(),
        password: data.password,
        username: data.nick
      };
      const { data: res, error } = await sb.functions.invoke('send-otp', {
        body: { email: pendingSignup.email }
      });
      if (error) throw new Error('fn:' + error.message);
      if (res && res.ok === false) {
        if (res.detail) console.warn('[send-otp] detail:', res.detail);
        throw new Error(sendOtpError(res.error));
      }

      $('#verifyEmail').textContent = pendingSignup.email;
      clearOtp();
      $('#verifyErr').textContent = ''; $('#verifyOk').textContent = '';
      e.target.reset();
      showView('verify');
      setTimeout(focusOtp, 300);
    } else {
      let email = data.nick.trim();
      if (!email.includes('@')) {
        const { data: found, error: eErr } = await sb.rpc('get_login_email', { p_login: email });
        if (eErr) throw eErr;
        if (!found) { $('#regErr').textContent = 'Пользователь с таким логином не найден.'; return; }
        email = found;
      }
      const { error } = await sb.auth.signInWithPassword({ email, password: data.password });
      if (error) throw error;
      e.target.reset();
      await afterLogin();
    }
  } catch (err) {
    $('#regErr').textContent = translateAuthError(err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = label;
  }
});

let pendingSignup = null;

$('#verifyBack').addEventListener('click', () => { setAuthMode('register'); showView('register'); });

const otpCells = $$('.otp-cell');
function getOtp() { return otpCells.map(c => c.value).join(''); }
function clearOtp() { otpCells.forEach(c => { c.value = ''; c.classList.remove('filled'); }); }
function focusOtp() { otpCells[0]?.focus(); }

otpCells.forEach((cell, i) => {
  cell.addEventListener('input', () => {
    cell.value = cell.value.replace(/\D/g, '').slice(0, 1);
    cell.classList.toggle('filled', !!cell.value);
    if (cell.value && i < otpCells.length - 1) otpCells[i + 1].focus();
    if (getOtp().length === 6) $('#verifyForm').requestSubmit();
  });
  cell.addEventListener('keydown', e => {
    if (e.key === 'Backspace' && !cell.value && i > 0) {
      otpCells[i - 1].focus();
      otpCells[i - 1].value = '';
      otpCells[i - 1].classList.remove('filled');
      e.preventDefault();
    }
    if (e.key === 'ArrowLeft' && i > 0) otpCells[i - 1].focus();
    if (e.key === 'ArrowRight' && i < otpCells.length - 1) otpCells[i + 1].focus();
  });
  cell.addEventListener('paste', e => {
    e.preventDefault();
    const digits = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
    if (!digits) return;
    otpCells.forEach((c, k) => { c.value = digits[k] || ''; c.classList.toggle('filled', !!c.value); });
    (otpCells[digits.length] || otpCells[5]).focus();
    if (digits.length === 6) $('#verifyForm').requestSubmit();
  });
});

$('#verifyForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('#verifyErr').textContent = ''; $('#verifyOk').textContent = '';
  const code = getOtp().replace(/\D/g, '');
  if (code.length !== 6) { $('#verifyErr').textContent = 'Введи 6-значный код.'; return; }
  if (!pendingSignup) { setAuthMode('register'); showView('register'); return; }

  const btn = $('#verifyBtn');
  const label = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = 'Проверяем…';
  try {
    const { data: res, error } = await sb.functions.invoke('verify-otp', {
      body: {
        email: pendingSignup.email, code,
        password: pendingSignup.password, username: pendingSignup.username
      }
    });
    if (error) throw new Error('fn:' + error.message);
    if (!res || res.ok !== true) throw new Error((res && res.error) || 'verify_failed');

    const { error: sErr } = await sb.auth.signInWithPassword({
      email: pendingSignup.email, password: pendingSignup.password
    });
    if (sErr) throw sErr;
    pendingSignup = null;
    await afterLogin();
  } catch (err) {
    $('#verifyErr').textContent = translateOtpError(err.message);
    clearOtp(); focusOtp();
  } finally {
    btn.disabled = false; btn.innerHTML = label;
  }
});

$('#resendBtn').addEventListener('click', async e => {
  e.preventDefault();
  if (!pendingSignup) return;
  $('#verifyErr').textContent = ''; $('#verifyOk').textContent = '';
  const link = e.target;
  link.textContent = 'Отправляем…';
  try {
    const { data: res, error } = await sb.functions.invoke('send-otp', {
      body: { email: pendingSignup.email }
    });
    if (error) throw new Error(error.message);
    if (res && res.ok === false) throw new Error(res.error);
    $('#verifyOk').textContent = 'Новый код отправлен.';
  } catch (err) {
    $('#verifyErr').textContent = translateOtpError(err.message);
  } finally {
    link.textContent = 'Отправить ещё раз';
  }
});

function translateOtpError(msg = '') {
  if (/wrong_code/.test(msg)) return 'Неверный код.';
  if (/expired/.test(msg)) return 'Код истёк — запроси новый.';
  if (/too_many/.test(msg)) return 'Слишком много попыток — запроси новый код.';
  if (/no_code/.test(msg)) return 'Код не найден — отправь заново.';
  if (/mail_failed/.test(msg)) return 'Не удалось отправить письмо (проверь RESEND_API_KEY).';
  if (/username_taken/.test(msg)) return 'Такой логин уже занят — придумай другой.';
  if (/create_failed|already/.test(msg)) return 'Такой email уже зарегистрирован — войди.';
  if (/^fn:/.test(msg)) return 'Функция недоступна — задеплой send-otp/verify-otp.';
  return msg || 'Ошибка проверки кода.';
}

function sendOtpError(code = '') {
  if (code === 'mail_failed')
    return 'Письмо не отправилось — проверь домен в Resend и OTP_FROM (детали в консоли F12).';
  if (code === 'db_failed')
    return 'Нет таблицы email_otps — прогони SQL в Supabase.';
  if (code === 'email_required') return 'Укажи email.';
  return code || 'Не удалось отправить код.';
}

function translateAuthError(msg = '') {
  if (/already registered/i.test(msg)) return 'Такой email уже зарегистрирован.';
  if (/Invalid login/i.test(msg)) return 'Неверный логин или пароль.';
  if (/Email not confirmed/i.test(msg)) return 'Email не подтверждён — проверь почту.';
  return msg || 'Ошибка. Попробуй ещё раз.';
}

async function loadProfile() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: profile } = await sb.from('profiles')
    .select('username,tier,premium_until,steam_id,steam_name,avatar_url').eq('id', user.id).single();
  return { user, profile: profile || { username: user.email, tier: 'free' } };
}

function renderTier(profile) {
  const t = (profile.tier || 'free').toUpperCase();
  const badge = $('#tierBadge');
  badge.textContent = t;
  badge.className = 'tier-badge ' + (profile.tier || 'free');
  $('#userName').textContent = profile.username || 'игрок';
}

async function afterLogin() {
  const info = await loadProfile();
  if (info) { renderTier(info.profile); updateNav(info.profile); renderSteam(info.profile); }
  showView('connect');
}

function updateNav(profile) {
  const chip = $('#navUser');
  const loginBtn = $('#navLogin');
  loggedIn = !!profile;
  const navServers = $('#navServers');
  if (navServers) navServers.style.display = profile ? '' : 'none';
  if (profile) {
    const name = profile.username || 'игрок';
    $('#navUsername').textContent = name;
    const av = $('#navAvatar');
    if (profile.avatar_url) {
      av.innerHTML = `<img src="${profile.avatar_url}" alt="">`;
    } else {
      av.textContent = name.charAt(0).toUpperCase();
    }
    chip.style.display = '';
    loginBtn.style.display = 'none';
  } else {
    chip.style.display = 'none';
    loginBtn.style.display = '';
  }
}

$('#navUser').addEventListener('click', () => showView('connect'));

if (sb) {
  sb.auth.onAuthStateChange(async (event, session) => {
    if (session) {
      const info = await loadProfile();
      if (info) { renderTier(info.profile); updateNav(info.profile); renderSteam(info.profile); }
    } else {
      updateNav(null);
    }
  });
}

$('#keyForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('#keyErr').textContent = ''; $('#keyOk').textContent = '';
  const code = $('#keyInput').value.trim().toUpperCase();
  if (!code) return;
  if (!sb) { $('#keyErr').textContent = 'Supabase не настроен.'; return; }

  const btn = $('#keyBtn');
  btn.disabled = true; btn.textContent = 'Проверяем…';
  try {
    const { data, error } = await sb.rpc('redeem_key', { p_code: code });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    const tier = (row?.tier || 'premium');
    renderTier({ tier, username: $('#userName').textContent });
    const until = row?.premium_until
      ? new Date(row.premium_until).toLocaleDateString('ru-RU')
      : 'навсегда';
    $('#keyOk').textContent = `Ключ активирован! Тариф: ${tier.toUpperCase()} · ${until}.`;
    $('#keyInput').value = '';
  } catch (err) {
    $('#keyErr').textContent = translateKeyError(err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Активировать';
  }
});

function translateKeyError(msg = '') {
  if (/AUTH_REQUIRED/.test(msg)) return 'Сначала войди в аккаунт.';
  if (/KEY_INVALID/.test(msg)) return 'Неверный или отключённый ключ.';
  if (/KEY_EXHAUSTED/.test(msg)) return 'Этот ключ уже использован.';
  return msg || 'Не удалось активировать ключ.';
}

$('#logoutBtn').addEventListener('click', async () => {
  if (sb) await sb.auth.signOut();
  updateNav(null);
  showView('landing');
});

function renderSteam(profile) {
  const btn = $('#steamLinkBtn');
  const txt = $('#steamCardText');
  if (!btn) return;
  if (profile && profile.steam_id) {
    txt.innerHTML = `Steam привязан: <b>${profile.steam_name || profile.steam_id}</b>`;
    btn.innerHTML = '<svg class="ic"><use href="#i-check"/></svg> Перепривязать';
  } else {
    txt.textContent = 'Для проверки часов в игре, VAC-статуса и аватарки в профиле.';
    btn.innerHTML = '<svg class="ic"><use href="#i-steam"/></svg> Привязать Steam';
  }
}

$('#steamLinkBtn').addEventListener('click', async () => {
  if (!sb) return;
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { setAuthMode('login'); showView('register'); return; }

  const btn = $('#steamLinkBtn');
  btn.disabled = true;
  btn.innerHTML = 'Переходим в Steam…';
  try {
    const { data: res, error } = await sb.functions.invoke('steam-login', { body: {} });
    if (error) throw new Error(error.message);
    if (!res || !res.ok) throw new Error(res && res.error);
    window.location.href = res.url;
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = '<svg class="ic"><use href="#i-steam"/></svg> Привязать Steam';
    alert('Не удалось начать привязку Steam: ' + (err.message || err));
  }
});

function handleSteamReturn() {
  const h = location.hash;
  if (h.includes('steam=ok') || h.includes('steam=fail')) {
    const ok = h.includes('steam=ok');
    history.replaceState(null, '', location.pathname + '#connect');
    showView('connect');
    if (!ok) setTimeout(() => alert('Привязка Steam не удалась. Попробуй ещё раз.'), 100);
  }
}

$('#pairBtn').addEventListener('click', () => openRustPlus());

$('#tgBtn')?.addEventListener('click', async () => {
  const worker = (window.RUSTCHK_CONFIG || {}).WORKER_URL;
  if (!worker) { alert('Сначала укажи WORKER_URL в config.js (адрес Node-сервиса на Render).'); return; }
  if (!sb) return;
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { setAuthMode('login'); showView('register'); return; }

  const btn = $('#tgBtn');
  btn.disabled = true; btn.textContent = 'Получаем код…';
  try {
    const r = await fetch(worker.replace(/\/$/, '') + '/api/telegram/link', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' }
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'error');
    const botName = j.bot ? '@' + j.bot : 'нашему боту';
    $('#tgText').innerHTML = `Отправь этот код ${esc(botName)} в Telegram:<br><span class="tg-code">${esc(j.code)}</span>`;
    btn.disabled = false;
    btn.innerHTML = '<svg class="ic"><use href="#i-radar"/></svg> Обновить код';
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = '<svg class="ic"><use href="#i-radar"/></svg> Привязать Telegram';
    alert('Не удалось: ' + err.message);
  }
});

$('#rpForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  $('#rpErr').textContent = ''; $('#rpOk').textContent = '';
  if (!sb) { $('#rpErr').textContent = 'Supabase не настроен.'; return; }

  const { data: { user } } = await sb.auth.getUser();
  if (!user) { setAuthMode('login'); showView('register'); return; }

  const d = Object.fromEntries(new FormData(e.target));
  const ip = (d.ip || '').trim();
  const port = parseInt(d.port, 10);
  const steamId = (d.steamId || '').trim();
  const token = parseInt(d.token, 10);

  if (!ip || !port || !/^\d{17}$/.test(steamId) || !token) {
    $('#rpErr').textContent = 'Заполни IP, порт, SteamID64 и Player Token числом.';
    return;
  }

  const btn = $('#rpBtn');
  btn.disabled = true; btn.textContent = 'Сохраняем…';
  try {
    const { error } = await sb.from('rustplus_pairings').upsert({
      user_id: user.id, ip, port, steam_id: steamId, player_token: token,
      name: (d.name || '').trim() || `${ip}:${port}`
    }, { onConflict: 'user_id,ip,port' });
    if (error) throw error;
    $('#rpOk').textContent = 'Сервер Rust+ сохранён.';
    e.target.reset();
    loadPairings();
  } catch (err) {
    $('#rpErr').textContent = 'Не удалось сохранить: ' + err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Сохранить сервер';
  }
});

async function openRustPlus() {
  showView('rustplus');
  await loadPairings();
}

async function loadPairings() {
  const box = $('#rpList');
  if (!box || !sb) return;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  const { data, error } = await sb.from('rustplus_pairings')
    .select('*').eq('user_id', user.id).order('created_at', { ascending: false });
  if (error) { box.innerHTML = `<div class="bm-empty">${esc(error.message)}</div>`; return; }
  if (!data.length) { box.innerHTML = '<div class="bm-empty">Пока нет подключённых серверов Rust+.</div>'; return; }
  box.innerHTML = data.map(p => `
    <div class="bm-card">
      <div class="bm-main">
        <div class="bm-name"><span class="status-dot online"></span>${esc(p.name)}</div>
        <div class="bm-sub"><span class="mono">${esc(p.ip)}:${esc(p.port)}</span></div>
      </div>
      <button class="btn btn-ghost btn-sm" data-del-rp="${esc(p.id)}">Удалить</button>
    </div>`).join('');
  box.querySelectorAll('[data-del-rp]').forEach(b => {
    b.addEventListener('click', async () => {
      await sb.from('rustplus_pairings').delete().eq('id', b.dataset.delRp);
      loadPairings();
    });
  });
}

let bmMode = 'servers';

document.querySelectorAll('#bmTabs .stab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('#bmTabs .stab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    bmMode = tab.dataset.bm;
    $('#bmInput').placeholder = bmMode === 'servers' ? 'Название сервера…' : 'Ник игрока…';
    $('#bmInput').value = '';
    $('#bmResults').innerHTML = '';
    $('#bmErr').textContent = '';
    $('#bmInput').focus();
  });
});

$('#bmForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('#bmErr').textContent = '';
  const q = $('#bmInput').value.trim();
  if (!q) return;
  if (!sb) { $('#bmErr').textContent = 'Supabase не настроен.'; return; }

  const results = $('#bmResults');
  results.innerHTML = '<div class="bm-loading">Ищем…</div>';

  try {
    const action = bmMode === 'servers' ? 'searchServers' : 'searchPlayers';
    const { data: res, error } = await sb.functions.invoke('bm-proxy', {
      body: { action, params: { q } }
    });
    if (error) throw new Error(error.message);
    if (!res || !res.ok) throw new Error('BattleMetrics: ' + (res?.status || 'ошибка'));

    const list = res.data?.data || [];
    if (!list.length) { results.innerHTML = '<div class="bm-empty">Ничего не найдено.</div>'; return; }

    results.innerHTML = '';
    if (bmMode === 'servers') list.forEach(s => results.appendChild(renderServer(s)));
    else list.forEach(p => results.appendChild(renderPlayer(p)));
  } catch (err) {
    results.innerHTML = '';
    $('#bmErr').textContent = /bm-proxy|fn|Function/i.test(err.message)
      ? 'Функция bm-proxy недоступна — задеплой её и добавь токен.'
      : (err.message || 'Ошибка поиска.');
  }
});

function esc(s) { return String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }

function wipeStr(a) {
  return a?.details?.rust_last_wipe
    ? new Date(a.details.rust_last_wipe).toLocaleDateString('ru-RU')
    : '—';
}
function mapStr(a) {
  return a?.details?.map || a?.details?.rust_maps?.name || 'Procedural';
}

function renderServer(s) {
  const a = s.attributes || {};
  const online = a.status === 'online';
  const el = document.createElement('div');
  el.className = 'bm-card';
  el.style.cursor = 'pointer';
  el.innerHTML = `
    <div class="bm-rank">${a.rank ? '#' + a.rank : ''}</div>
    <div class="bm-main">
      <div class="bm-name"><span class="status-dot ${online ? 'online' : ''}"></span>${esc(a.name)}</div>
      <div class="bm-sub">
        <span><svg class="ic"><use href="#i-pin"/></svg>${esc(a.country || '—')}</span>
        <span><svg class="ic"><use href="#i-server"/></svg>${esc(mapStr(a))}</span>
        <span><svg class="ic"><use href="#i-clock"/></svg>вайп: ${wipeStr(a)}</span>
      </div>
    </div>
    <div class="bm-players"><b>${a.players ?? 0}</b><small>/ ${a.maxPlayers ?? '?'}</small></div>`;
  el.addEventListener('click', () => openServer(s.id));
  return el;
}

function renderPlayer(p) {
  const a = p.attributes || {};
  const el = document.createElement('div');
  el.className = 'bm-card';
  el.style.cursor = 'pointer';
  el.innerHTML = `
    <div class="bm-main">
      <div class="bm-name"><span class="status-dot"></span>${esc(a.name)}</div>
      <div class="bm-sub"><span>ID: ${esc(p.id)}</span></div>
    </div>
    <span class="btn btn-ghost btn-sm bm-track"><svg class="ic"><use href="#i-arrow"/></svg> Открыть</span>`;
  el.addEventListener('click', () => openPlayer(p.id, a.name));
  return el;
}

async function openServer(id) {
  showView('server');
  const box = $('#serverDetail');
  box.innerHTML = '<div class="bm-loading">Загружаем сервер…</div>';
  try {
    const { data: res, error } = await sb.functions.invoke('bm-proxy', {
      body: { action: 'server', params: { id } }
    });
    if (error) throw new Error(error.message);
    const srv = res?.data?.data || {};
    const a = srv.attributes || {};
    const online = a.status === 'online';
    const addr = (a.ip && a.port) ? `${a.ip}:${a.port}` : '—';
    const players = (res?.data?.included || []).filter(x => x.type === 'player');

    const playersBlock = players.length
      ? `<h3 class="d-players-title">Сейчас на сервере · ${players.length}</h3>
         <div class="d-players">${players.map(p =>
            `<button class="pchip" data-pid="${esc(p.id)}" data-pname="${esc(p.attributes?.name || '')}">
               <svg class="ic"><use href="#i-user"/></svg>${esc(p.attributes?.name || '—')}
             </button>`).join('')}</div>
         <p class="detail-hint">Нажми на ник — откроется игрок, и его можно отслеживать именно на этом сервере.</p>`
      : `<p class="detail-hint">Список игроков этого сервера скрыт (приватность/права). Отследить игрока можно через вкладку «Игроки».</p>`;

    box.innerHTML = `
      <div class="detail-card">
        <div class="detail-top">
          <h2><span class="status-dot ${online ? 'online' : ''}"></span>${esc(a.name || 'Сервер')}</h2>
          <span class="badge">${a.rank ? 'RANK #' + a.rank : 'RUST'}</span>
        </div>
        <div class="detail-grid">
          <div class="d-metric"><span>Онлайн</span><b>${a.players ?? 0} / ${a.maxPlayers ?? '?'}</b></div>
          <div class="d-metric"><span>Статус</span><b class="${online ? 'ok' : ''}">${online ? 'онлайн' : 'офлайн'}</b></div>
          <div class="d-metric"><span>Локация</span><b>${esc(a.country || '—')}</b></div>
          <div class="d-metric"><span>Карта</span><b>${esc(mapStr(a))}</b></div>
          <div class="d-metric"><span>Вайп</span><b>${wipeStr(a)}</b></div>
          <div class="d-metric"><span>Адрес</span><b class="mono">${esc(addr)}</b></div>
        </div>
        ${playersBlock}
      </div>`;

    box.querySelectorAll('.pchip').forEach(chip => {
      chip.addEventListener('click', () => openPlayer(chip.dataset.pid, chip.dataset.pname));
    });
  } catch (err) {
    box.innerHTML = `<div class="bm-empty">Не удалось загрузить сервер: ${esc(err.message)}</div>`;
  }
}

async function openPlayer(id, name) {
  showView('player');
  const box = $('#playerDetail');
  box.innerHTML = '<div class="bm-loading">Загружаем игрока…</div>';
  try {
    const { data: res, error } = await sb.functions.invoke('bm-proxy', {
      body: { action: 'player', params: { id } }
    });
    if (error) throw new Error(error.message);
    const d = res?.data?.data || {};
    const a = d.attributes || {};
    const servers = (res?.data?.included || []).filter(x => x.type === 'server');

    const rows = servers.length
      ? servers.map(s => {
          const sa = s.attributes || {};
          const on = sa.status === 'online';
          return `<div class="bm-card">
            <div class="bm-main">
              <div class="bm-name"><span class="status-dot ${on ? 'online' : ''}"></span>${esc(sa.name)}</div>
              <div class="bm-sub"><span>${esc(sa.country || '—')}</span><span>${sa.players ?? 0}/${sa.maxPlayers ?? '?'}</span></div>
            </div>
            <button class="btn btn-primary btn-sm" data-track-srv="${esc(s.id)}" data-srv-name="${esc(sa.name)}">
              <svg class="ic"><use href="#i-radar"/></svg> Отслеживать тут
            </button>
          </div>`;
        }).join('')
      : '<div class="bm-empty">Серверы игрока недоступны (нужны права/приватность профиля).</div>';

    box.innerHTML = `
      <div class="detail-card">
        <div class="detail-top">
          <h2><span class="status-dot"></span>${esc(a.name || name || 'Игрок')}</h2>
          <span class="badge">ID ${esc(d.id || id)}</span>
        </div>
        <p class="detail-hint">Выбери сервер, на котором нужно отслеживать игрока — придёт уведомление в Telegram, когда он зайдёт/выйдет с этого сервера.</p>
        <div class="bm-results">${rows}</div>
      </div>`;

    box.querySelectorAll('[data-track-srv]').forEach(btn => {
      btn.addEventListener('click', () => trackPlayer(
        d.id || id, a.name || name,
        btn.dataset.trackSrv, btn.dataset.srvName, btn
      ));
    });
  } catch (err) {
    box.innerHTML = `<div class="bm-empty">Не удалось загрузить игрока: ${esc(err.message)}</div>`;
  }
}

async function trackPlayer(playerId, playerName, serverId, serverName, btn) {
  if (!sb) return;
  btn.disabled = true;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { setAuthMode('login'); showView('register'); return; }
  const { error } = await sb.from('tracked_players').insert({
    user_id: user.id,
    player_id: String(playerId),
    player_name: playerName,
    server_id: String(serverId),
    server_name: serverName
  });
  if (error) {
    if (/duplicate|unique/i.test(error.message)) {
      btn.innerHTML = '<svg class="ic"><use href="#i-check"/></svg> Уже отслеживается';
    } else {
      btn.disabled = false;
      alert('Не удалось добавить: ' + error.message);
      return;
    }
  } else {
    btn.innerHTML = '<svg class="ic"><use href="#i-check"/></svg> Отслеживается';
    btn.classList.remove('btn-primary'); btn.classList.add('btn-ghost');
  }
}

function animateCounter(el, target) {
  if (!el) return;
  let cur = 0;
  const step = target / 45;
  const t = setInterval(() => {
    cur += step;
    if (cur >= target) { cur = target; clearInterval(t); }
    el.textContent = Math.floor(cur).toLocaleString('ru-RU');
  }, 20);
}
function startCounters() {
  animateCounter($('#stServers'), 12480);
  animateCounter($('#stPlayers'), 184902);
}

const reveals = $$('.reveal');
reveals.forEach((el, i) => (el.dataset.d = (i % 4) * 90));

function show(el) {
  el.style.transitionDelay = (el.dataset.d || 0) + 'ms';
  el.classList.add('in');
}

if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) { show(e.target); io.unobserve(e.target); }
    });
  }, { threshold: 0.08 });
  reveals.forEach(el => io.observe(el));
} else {
  reveals.forEach(show);
}

setTimeout(() => reveals.forEach(el => el.classList.contains('in') || show(el)), 1200);
