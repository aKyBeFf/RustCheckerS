const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function showView(name) {
  $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === name));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  try { sessionStorage.setItem('rc_view', name); } catch {}
}

let loggedIn = false;

document.addEventListener('click', e => {
  const trigger = e.target.closest('[data-go]');
  if (!trigger) return;
  e.preventDefault();
  const target = trigger.dataset.go;
  if (['checker', 'tracked'].includes(target) && !loggedIn) {
    setAuthMode('register');
    showView('register');
    return;
  }
  if (target === 'register' && loggedIn) { showView('checker'); return; }
  showView(target);
  if (target === 'tracked') loadTracked();
});

window.addEventListener('load', async () => {
  startCounters();

  if (sb) {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      const info = await loadProfile();
      if (info) { renderTier(info.profile); updateNav(info.profile); renderSteam(info.profile); renderTelegram(info.profile); renderPlan(info.profile); loadStats(info.profile); }
    }
  }

  if (handleSteamReturn()) return;

  let saved = 'landing';
  try { saved = sessionStorage.getItem('rc_view') || 'landing'; } catch {}
  const gated = ['profile', 'subscription', 'checker', 'tracked'];
  const safe = ['landing', 'privacy', 'register'];
  if (gated.includes(saved)) showView(loggedIn ? saved : 'landing');
  else if (safe.includes(saved)) showView(saved);
  else if (loggedIn) showView('profile');
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
    .select('username,tier,premium_until,steam_id,steam_name,avatar_url,telegram_chat_id,telegram_username').eq('id', user.id).single();
  return { user, profile: profile || { username: user.email, tier: 'free' } };
}

function renderTier(profile) {
  const t = (profile.tier || 'free').toUpperCase();
  [['#tierBadge'], ['#subTierBadge']].forEach(([sel]) => {
    const badge = $(sel);
    if (badge) { badge.textContent = t; badge.className = 'tier-badge ' + (profile.tier || 'free'); }
  });
  const name = profile.username || 'игрок';
  const un = $('#userName'); if (un) un.textContent = name;
  const av = $('#profAvatar');
  if (av) {
    if (profile.avatar_url) av.innerHTML = `<img src="${profile.avatar_url}" alt="">`;
    else av.textContent = name.charAt(0).toUpperCase();
  }
}

const STAT_LABELS = {
  kill_player: 'Убийств игроков', deaths: 'Смертей', headshot: 'Хедшотов',
  wounded: 'Ранений', wounded_healed: 'Поднятий', wounded_assisted: 'Помощь раненым',
  'acquired_metal.ore': 'Металл собрано', acquired_scrap: 'Скрап', acquired_lowgradefuel: 'Топливо',
  harvested_wood: 'Дерево добыто', harvested_stones: 'Камень добыто',
  harvested_cloth: 'Ткань добыто', harvested_leather: 'Кожа добыто',
  bullet_fired: 'Пуль выпущено', bullet_hit_player: 'Пуль в игроков',
  bullet_hit_building: 'Пуль в постройки', bullet_hit_entity: 'Пуль в объекты',
  bullet_hit_corpse: 'Пуль в труп', bullet_hit_playercorpse: 'Пуль в труп игрока',
  bullet_hit_sign: 'Пуль в табличку', bullet_hit_bear: 'Пуль в медведя',
  bullet_hit_boar: 'Пуль в кабана', bullet_hit_wolf: 'Пуль в волка', bullet_hit_stag: 'Пуль в оленя',
  arrow_fired: 'Стрел выпущено', arrows_shot: 'Стрел (всего)', arrow_hit_player: 'Стрел в игроков',
  arrow_hit_building: 'Стрел в постройки', arrow_hit_entity: 'Стрел в объекты',
  arrow_hit_bear: 'Стрел в медведя', arrow_hit_boar: 'Стрел в кабана',
  arrow_hit_chicken: 'Стрел в курицу', arrow_hit_stag: 'Стрел в оленя', arrow_hit_wolf: 'Стрел в волка',
  shotgun_fired: 'Выстрелов из дробовика', shotgun_hit_player: 'Дробью в игроков',
  shotgun_hit_building: 'Дробью в постройки', shotgun_hit_entity: 'Дробью в объекты', shotgun_hit_horse: 'Дробью в лошадь',
  rocket_fired: 'Ракет выпущено', grenades_thrown: 'Гранат брошено',
  melee_strikes: 'Ударов ближним боем', melee_thrown: 'Метательного брошено',
  melee_thrown_hit_player: 'Метательное в игрока', explosives_thrown: 'Взрывчатки брошено',
  kill_bear: 'Убито медведей', kill_boar: 'Убито кабанов', kill_chicken: 'Убито куриц',
  kill_stag: 'Убито оленей', kill_wolf: 'Убито волков', kill_scientist: 'Убито учёных',
  death_bear: 'Смертей от медведя', death_wolf: 'Смертей от волка', death_entity: 'Смертей от объекта',
  death_fall: 'Смертей от падения', death_selfinflicted: 'Смертей по своей вине', death_suicide: 'Суицидов',
  caught_anchovy: 'Поймано анчоусов', caught_catfish: 'Поймано сомов', caught_herring: 'Поймано сельди',
  caught_salmon: 'Поймано лосося', caught_sardine: 'Поймано сардин',
  caught_small_trout: 'Поймано форели', caught_yellow_perch: 'Поймано окуня',
  'INVENTORY OPENED': 'Инвентарь открыт', 'MAP OPENED': 'Карта открыта',
  'CRAFTING OPENED': 'Крафт открыт', 'CUPBOARD OPENED': 'Шкаф открыт',
  'ITEM EXAMINED': 'Предметов осмотрено', 'ORE HIT': 'Ударов по руде',
  'TREE HIT': 'Ударов по дереву', 'STAT LOOT MAINLAND': 'Лута собрано (материк)',
  blueprint_studied: 'Чертежей изучено', item_drop: 'Предметов выброшено',
  destroyed_barrels: 'Бочек разбито', placed_blocks: 'Блоков поставлено', upgraded_blocks: 'Блоков улучшено',
  pipes_connected: 'Труб соединено', hoses_connected: 'Шлангов соединено',
  wires_connected: 'Проводов соединено', tincanalarms_wired: 'Сигнализаций подключено',
  recycled_cans: 'Банок переработано', cars_shredded: 'Машин измельчено',
  missions_completed: 'Заданий выполнено', helipad_landings: 'Посадок на вертолётку',
  cargoship_bridge_visits: 'Визитов на мостик карго', boat_steering_wheel_mounted_count: 'За штурвалом лодки',
  horse_mounted_count: 'Посадок на лошадь', horse_distance_ridden: 'На лошади (ед.)',
  horse_distance_ridden_km: 'На лошади (км)', distance_in_water_mainland: 'В воде (материк)',
  topology_road_duration: 'На дорогах (сек)', gesture_wave_count: 'Жест «привет»',
  waved_at_players: 'Помахал игрокам', seconds_speaking: 'Секунд в голосовом',
  calories_consumed: 'Калорий съедено', water_consumed: 'Воды выпито',
  cold_exposure_duration: 'Под холодом (сек)', hot_exposure_duration: 'Под жарой (сек)',
  comfort_duration: 'В комфорте (сек)', radiation_exposure_duration: 'Под радиацией (сек)',
  pickup_category_food: 'Еды подобрано', bags_unclaimed: 'Мешков не забрано',
  bee_attacks_count: 'Атак пчёл', snake_hazard_failed_count: 'Укусов змей',
  dweller_kills_while_moving: 'Убийств в движении', scope_zoom_changed: 'Смена зума прицела',
  InstrumentNotesPlayed: 'Нот сыграно', InstrumentNotesPlayedBinds: 'Нот по биндам',
  InstrumentFullKeyboardMode: 'Полная клавиатура',
};

function prettyStat(key) {
  if (STAT_LABELS[key]) return STAT_LABELS[key];
  return key.replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

async function loadStats(profile) {
  const hint = $('#statsHint');
  const grid = $('#statsGrid');
  if (!hint || !grid) return;
  if (!profile || !profile.steam_id) {
    grid.innerHTML = '';
    hint.textContent = 'Привяжи Steam, чтобы подтянуть статистику Rust.';
    return;
  }
  hint.textContent = 'Загружаем статистику из Steam…';
  try {
    const { data, error } = await sb.functions.invoke('steam-stats', { body: {} });
    if (error) throw new Error(error.message);
    if (!data || !data.ok) throw new Error(data && data.error);
    if (data.debug) console.warn('[steam-stats]', data.debug);
    if (!data.hasStats) {
      grid.innerHTML = '';
      hint.textContent = 'Статистика скрыта — открой в Steam приватность → «Сведения об игре» → Публично.';
      return;
    }

    renderStatsGrid(grid, data);
    if (data.cached) {
      const d = data.updatedAt ? new Date(data.updatedAt).toLocaleDateString('ru-RU') : '';
      hint.textContent = `Профиль Steam закрыт — показаны сохранённые данные${d ? ' от ' + d : ''}. Открой «Сведения об игре», чтобы обновить.`;
    } else {
      hint.textContent = 'Данные из Steam — официальная статистика Rust.';
    }
  } catch (err) {
    hint.textContent = 'Не удалось загрузить статистику: ' + (err.message || err);
  }
}

function renderStatsGrid(grid, data) {
  const num = v => v == null ? '—' : Number(v).toLocaleString('ru-RU');
  const tiles = [['Часы в игре', num(data.hours)], ['K/D', data.kd == null ? '—' : data.kd]];
  const all = data.all || {};
  const order = ['kill_player', 'deaths', 'headshot', 'wounded',
    'harvested_wood', 'harvested_stones', 'acquired_metal.ore', 'harvested_cloth',
    'harvested_leather', 'acquired_scrap', 'acquired_lowgradefuel'];
  const keys = Object.keys(all).sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    return prettyStat(a).localeCompare(prettyStat(b), 'ru');
  });
  keys.forEach(k => tiles.push([prettyStat(k), num(all[k])]));
  grid.innerHTML = tiles.map(([label, val]) =>
    `<div class="d-metric"><span>${esc(label)}</span><b>${esc(val)}</b></div>`).join('');
}

let planTimer = null;
function renderPlan(profile) {
  const el = $('#planStatus');
  if (!el) return;
  if (planTimer) { clearInterval(planTimer); planTimer = null; }

  const tier = (profile.tier || 'free');
  const until = profile.premium_until ? new Date(profile.premium_until) : null;
  const expired = until && until.getTime() < Date.now();
  const active = tier !== 'free' && !expired;

  el.hidden = false;
  el.className = 'plan-status ' + (active ? tier : 'free');

  if (tier === 'free') {
    el.innerHTML = `<div class="ps-row"><span class="tier-badge free">FREE</span>
      <span class="ps-text">Бесплатный тариф · 1 отслеживание, только своя статистика.</span></div>`;
    return;
  }
  if (expired) {
    el.innerHTML = `<div class="ps-row"><span class="tier-badge free">ИСТЁК</span>
      <span class="ps-text">Подписка ${tier.toUpperCase()} закончилась. Продли, чтобы вернуть возможности.</span></div>`;
    return;
  }

  const tick = () => {
    const ms = until.getTime() - Date.now();
    if (ms <= 0) { renderPlan({ ...profile, premium_until: profile.premium_until }); return; }
    const d = Math.floor(ms / 86400000);
    const h = Math.floor(ms % 86400000 / 3600000);
    const m = Math.floor(ms % 3600000 / 60000);
    const s = Math.floor(ms % 60000 / 1000);
    el.innerHTML = `<div class="ps-row">
        <span class="tier-badge ${tier}">${tier.toUpperCase()}</span>
        <span class="ps-text">Активна до ${until.toLocaleDateString('ru-RU')}</span>
      </div>
      <div class="ps-timer">
        <div class="ps-unit"><b>${d}</b><span>дн</span></div>
        <div class="ps-unit"><b>${String(h).padStart(2,'0')}</b><span>ч</span></div>
        <div class="ps-unit"><b>${String(m).padStart(2,'0')}</b><span>мин</span></div>
        <div class="ps-unit"><b>${String(s).padStart(2,'0')}</b><span>сек</span></div>
      </div>`;
  };
  tick();
  planTimer = setInterval(tick, 1000);
}

function renderTelegram(profile) {
  const txt = $('#tgText');
  const btn = $('#tgBtn');
  if (!txt || !btn) return;
  if (profile && profile.telegram_chat_id) {
    const uname = profile.telegram_username ? '@' + profile.telegram_username : 'привязан';
    txt.innerHTML = `Telegram привязан: <b>${esc(uname)}</b>. Уведомления включены.`;
    btn.innerHTML = '<svg class="ic"><use href="#i-check"/></svg> Перепривязать';
  }
}

async function afterLogin() {
  const info = await loadProfile();
  if (info) { renderTier(info.profile); updateNav(info.profile); renderSteam(info.profile); renderTelegram(info.profile); renderPlan(info.profile); loadStats(info.profile); }
  showView('profile');
}

let currentProfile = null;
function updateNav(profile) {
  currentProfile = profile;
  const wrap = $('#navUserWrap');
  const loginBtn = $('#navLogin');
  loggedIn = !!profile;
  const navServers = $('#navServers');
  if (navServers) navServers.style.display = profile ? '' : 'none';
  if (profile) {
    const name = profile.username || 'игрок';
    $('#navUsername').textContent = name;
    const av = $('#navAvatar');
    if (profile.avatar_url) av.innerHTML = `<img src="${profile.avatar_url}" alt="">`;
    else av.textContent = name.charAt(0).toUpperCase();
    wrap.style.display = '';
    loginBtn.style.display = 'none';
  } else {
    wrap.style.display = 'none';
    loginBtn.style.display = '';
    $('#navMenu').classList.remove('open');
  }
}

function closeMenu() { $('#navMenu').classList.remove('open'); $('#navUserWrap').classList.remove('open'); }
$('#navUser').addEventListener('click', e => {
  e.stopPropagation();
  const open = $('#navMenu').classList.toggle('open');
  $('#navUserWrap').classList.toggle('open', open);
});
document.addEventListener('click', e => { if (!e.target.closest('#navUserWrap')) closeMenu(); });
$('#navMenu').addEventListener('click', closeMenu);
$('#menuLogout').addEventListener('click', async () => {
  if (sb) await sb.auth.signOut();
  updateNav(null);
  showView('landing');
});

if (sb) {
  sb.auth.onAuthStateChange(async (event, session) => {
    if (session) {
      const info = await loadProfile();
      if (info) { renderTier(info.profile); updateNav(info.profile); renderSteam(info.profile); renderTelegram(info.profile); renderPlan(info.profile); loadStats(info.profile); }
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
    renderPlan({ tier, premium_until: row?.premium_until || null });
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

function buyNotice(type, title, text) {
  const el = $('#buyNotice');
  if (!el) return;
  el.hidden = false;
  el.className = 'buy-notice ' + type;
  const icon = type === 'ok' ? '#i-check' : (type === 'wait' ? '#i-radar' : '#i-bolt');
  el.innerHTML = `<span class="bn-ic"><svg class="ic"><use href="${icon}"/></svg></span>
    <div class="bn-body"><b>${esc(title)}</b><span>${esc(text)}</span></div>`;
}

document.querySelectorAll('[data-buy]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const worker = (window.RUSTCHK_CONFIG || {}).WORKER_URL;
    if (!worker) { buyNotice('err', 'Оплата недоступна', 'Не задан WORKER_URL в config.js.'); return; }
    if (!sb) return;
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { setAuthMode('login'); showView('register'); return; }

    const label = btn.innerHTML;
    btn.disabled = true; btn.textContent = 'Готовим счёт…';
    buyNotice('wait', 'Формируем счёт…', 'Секунду, отправляем в Telegram.');
    try {
      const r = await fetch(worker.replace(/\/$/, '') + '/api/buy', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: btn.dataset.buy })
      });
      const j = await r.json();
      if (!j.ok) {
        if (j.error === 'no_telegram') buyNotice('err', 'Нужен Telegram', 'Сначала привяжи Telegram в профиле — счёт придёт туда.');
        else throw new Error(j.detail || j.error || 'error');
      } else {
        buyNotice('ok', 'Счёт отправлен в Telegram ⭐', 'Открой чат с ботом и оплати звёздами. После оплаты тариф активируется автоматически.');
      }
    } catch (err) {
      buyNotice('err', 'Не удалось', err.message);
    } finally {
      btn.disabled = false; btn.innerHTML = label;
    }
  });
});

function translateKeyError(msg = '') {
  if (/AUTH_REQUIRED/.test(msg)) return 'Сначала войди в аккаунт.';
  if (/KEY_INVALID/.test(msg)) return 'Неверный или отключённый ключ.';
  if (/KEY_EXHAUSTED/.test(msg)) return 'Этот ключ уже использован.';
  return msg || 'Не удалось активировать ключ.';
}

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
    history.replaceState(null, '', location.pathname);
    showView('profile');
    if (!ok) setTimeout(() => alert('Привязка Steam не удалась. Попробуй ещё раз.'), 100);
    return true;
  }
  return false;
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
  const sid = document.querySelector('#rpForm input[name="steamId"]');
  const note = $('#rpSteamNote');
  if (sid && currentProfile && currentProfile.steam_id) {
    sid.value = currentProfile.steam_id;
    sid.readOnly = true;
    if (note) note.textContent = 'SteamID подставлен из привязанного Steam.';
  } else if (note) {
    note.innerHTML = 'Привяжи Steam в профиле — тогда SteamID подставится сам. <a href="#" data-go="profile">Привязать</a>';
  }
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

$('#bmForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('#bmErr').textContent = '';
  const q = $('#bmInput').value.trim();
  if (!q) return;
  if (!sb) { $('#bmErr').textContent = 'Supabase не настроен.'; return; }

  const results = $('#bmResults');
  results.innerHTML = '<div class="bm-loading">Ищем…</div>';

  try {
    const { data: res, error } = await sb.functions.invoke('bm-proxy', {
      body: { action: 'searchServers', params: { q } }
    });
    if (error) throw new Error(error.message);
    if (!res || !res.ok) throw new Error('BattleMetrics: ' + (res?.status || 'ошибка'));

    const list = res.data?.data || [];
    if (!list.length) { results.innerHTML = '<div class="bm-empty">Ничего не найдено.</div>'; return; }

    results.innerHTML = '';
    list.forEach(s => results.appendChild(renderServer(s)));
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
    const pid = d.id || id;
    const pname = a.name || name || 'Игрок';

    const servers = (res?.data?.included || []).filter(x => x.type === 'server');
    servers.sort((s1, s2) => new Date(s2.meta?.lastSeen || 0) - new Date(s1.meta?.lastSeen || 0));
    const current = servers.find(s => s.meta && s.meta.online);
    const recent = servers.filter(s => s !== current);

    const seenStr = ls => ls ? new Date(ls).toLocaleDateString('ru-RU') : '—';

    const currentBlock = current
      ? `<div class="live-now on"><span class="status-dot online"></span> Сейчас играет на <b>${esc(current.attributes?.name || '')}</b></div>
         <div class="bm-card">
           <div class="bm-main">
             <div class="bm-name">${esc(current.attributes?.name)} <span class="live-tag">онлайн</span></div>
             <div class="bm-sub"><span>${esc(current.attributes?.country || '—')}</span><span>${current.attributes?.players ?? 0}/${current.attributes?.maxPlayers ?? '?'}</span></div>
           </div>
           <button class="btn btn-primary btn-sm" data-track-srv="${esc(current.id)}" data-srv-name="${esc(current.attributes?.name)}">
             <svg class="ic"><use href="#i-radar"/></svg> Отслеживать тут
           </button>
         </div>`
      : `<div class="live-now off"><span class="status-dot"></span> Сейчас не в игре</div>`;

    const recentRows = recent.length
      ? recent.map(s => {
          const sa = s.attributes || {};
          return `<div class="bm-card">
            <div class="bm-main">
              <div class="bm-name">${esc(sa.name)}</div>
              <div class="bm-sub"><span>${esc(sa.country || '—')}</span><span><svg class="ic"><use href="#i-clock"/></svg> ${seenStr(s.meta?.lastSeen)}</span></div>
            </div>
            <button class="btn btn-ghost btn-sm" data-track-srv="${esc(s.id)}" data-srv-name="${esc(sa.name)}">
              <svg class="ic"><use href="#i-radar"/></svg> Отслеживать тут
            </button>
          </div>`;
        }).join('')
      : '<div class="bm-empty">Недавних серверов нет.</div>';

    box.innerHTML = `
      <div class="detail-card">
        <div class="detail-top">
          <h2><span class="status-dot ${current ? 'online' : ''}"></span>${esc(pname)}</h2>
          <a class="badge badge-link" href="https://www.battlemetrics.com/players/${esc(pid)}" target="_blank" rel="noopener">Профиль BattleMetrics ↗</a>
        </div>
        ${currentBlock}
        <button class="btn btn-primary full" id="trackGlobal" style="margin:16px 0">
          <svg class="ic"><use href="#i-radar"/></svg> Отслеживать по всем серверам <span class="tag-soon">Premium</span>
        </button>
        <h3 class="d-players-title">Недавние серверы</h3>
        <div class="bm-results">${recentRows}</div>
      </div>`;

    box.querySelectorAll('[data-track-srv]').forEach(btn => {
      btn.addEventListener('click', () => trackPlayer(pid, pname, btn.dataset.trackSrv, btn.dataset.srvName, btn, 'server'));
    });
    $('#trackGlobal').addEventListener('click', () =>
      trackPlayer(pid, pname, '*', 'Все серверы', $('#trackGlobal'), 'global'));
  } catch (err) {
    box.innerHTML = `<div class="bm-empty">Не удалось загрузить игрока: ${esc(err.message)}</div>`;
  }
}

async function loadTracked() {
  const box = $('#trackedList');
  if (!box || !sb) return;
  box.innerHTML = '<div class="bm-loading">Загружаем…</div>';
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { box.innerHTML = ''; return; }
  const { data, error } = await sb.from('tracked_players')
    .select('*').eq('user_id', user.id).order('created_at', { ascending: false });
  if (error) { box.innerHTML = `<div class="bm-empty">${esc(error.message)}</div>`; return; }
  if (!data.length) { box.innerHTML = '<div class="bm-empty">Ты пока никого не отслеживаешь. Открой сервер или игрока и нажми «Отслеживать».</div>'; return; }

  box.innerHTML = data.map(r => {
    const online = r.last_status === 'online';
    const where = r.server_id === '*'
      ? (online ? 'по всем серверам · сейчас на ' + esc(r.last_server || '—') : 'по всем серверам · не в игре')
      : esc(r.server_name || r.server_id);
    return `<div class="bm-card">
      <div class="bm-main">
        <div class="bm-name"><span class="status-dot ${online ? 'online' : ''}"></span>${esc(r.player_name || 'Игрок')}${r.server_id === '*' ? ' <span class="live-tag" style="color:var(--amber);background:rgba(240,164,34,.14);border-color:rgba(240,164,34,.3)">все</span>' : ''}</div>
        <div class="bm-sub"><span>${where}</span></div>
      </div>
      <div class="tr-actions">
        <button class="btn btn-ghost btn-sm" data-open-pl="${esc(r.player_id)}" data-pl-name="${esc(r.player_name || '')}">Открыть профиль</button>
        <button class="btn btn-ghost btn-sm tr-del" data-del-tr="${esc(r.id)}">Удалить</button>
      </div>
    </div>`;
  }).join('');

  box.querySelectorAll('[data-open-pl]').forEach(b =>
    b.addEventListener('click', () => openPlayer(b.dataset.openPl, b.dataset.plName)));
  box.querySelectorAll('[data-del-tr]').forEach(b =>
    b.addEventListener('click', async () => {
      b.disabled = true; b.textContent = 'Удаляем…';
      const worker = (window.RUSTCHK_CONFIG || {}).WORKER_URL;
      const { data: { session } } = await sb.auth.getSession();
      if (worker && session) {
        try {
          await fetch(worker.replace(/\/$/, '') + '/api/untrack', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: b.dataset.delTr })
          });
        } catch {}
      } else {
        await sb.from('tracked_players').delete().eq('id', b.dataset.delTr);
      }
      loadTracked();
    }));
}

async function trackPlayer(playerId, playerName, serverId, serverName, btn, mode = 'server') {
  if (!sb) return;
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { setAuthMode('login'); showView('register'); return; }

  const worker = (window.RUSTCHK_CONFIG || {}).WORKER_URL;
  btn.disabled = true;
  const prev = btn.innerHTML;
  btn.innerHTML = 'Запускаем…';

  if (worker) {
    try {
      const r = await fetch(worker.replace(/\/$/, '') + '/api/track', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: String(playerId), playerName, serverId: String(serverId), serverName, mode })
      });
      const j = await r.json();
      if (!j.ok) {
        if (j.error === 'need_premium') {
          btn.disabled = false; btn.innerHTML = prev;
          alert('Отслеживание по всем серверам доступно на Premium/Unlimited. Оформи в разделе «Подписка».');
          return;
        }
        if (j.error === 'limit') {
          btn.disabled = false; btn.innerHTML = prev;
          alert(`Лимит отслеживаний исчерпан (${j.limit}). Оформи Premium (8) или Unlimited (∞) в разделе «Подписка».`);
          return;
        }
        throw new Error(j.error || 'error');
      }
      btn.innerHTML = j.notified
        ? '<svg class="ic"><use href="#i-check"/></svg> Отслеживается'
        : '<svg class="ic"><use href="#i-check"/></svg> Добавлено (привяжи Telegram)';
      btn.classList.remove('btn-primary'); btn.classList.add('btn-ghost');
    } catch (err) {
      btn.disabled = false; btn.innerHTML = prev;
      alert('Не удалось запустить отслеживание: ' + err.message);
    }
    return;
  }

  const { error } = await sb.from('tracked_players').insert({
    user_id: session.user.id,
    player_id: String(playerId),
    player_name: playerName,
    server_id: String(serverId),
    server_name: serverName
  });
  if (error) {
    if (/duplicate|unique/i.test(error.message)) {
      btn.innerHTML = '<svg class="ic"><use href="#i-check"/></svg> Уже отслеживается';
    } else {
      btn.disabled = false; btn.innerHTML = prev;
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
