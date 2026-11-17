// Cruor web client — dependency-free SPA with hash routing.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const view = $('#view');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (iso, opts = { dateStyle: 'medium' }) => new Intl.DateTimeFormat(undefined, opts).format(new Date(iso));
const fmtDateTime = (iso) => fmtDate(iso, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtTime = (iso) => fmtDate(iso, { hour: '2-digit', minute: '2-digit' });
const todayLocal = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10); };
const DAY_NAMES = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const CAUSE_ICON = { meal: '🍲', school: '🎒', environment: '🌳', gift: '🎁' };

// ---------- state & api ----------
const store = {
  get token() { try { return localStorage.getItem('cruor.token'); } catch { return null; } },
  set token(v) { try { v ? localStorage.setItem('cruor.token', v) : localStorage.removeItem('cruor.token'); } catch { /* private mode */ } },
  user: null,
  meta: null,
};

// In the Android demo build, mobile/local-api.js provides an on-device backend.
const local = window.cruorLocal || null;

async function transport(path, method, body) {
  if (local) return local.request({ method, url: path, body, token: store.token });
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(store.token && { Authorization: `Bearer ${store.token}` }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function api(path, { method = 'GET', body } = {}) {
  const { status, body: data } = await transport(path, method, body);
  if (status === 401 && store.token) {
    store.token = null; store.user = null; renderNav();
    location.hash = '#/login';
  }
  if (status < 200 || status >= 300) throw Object.assign(new Error(data.error || 'Request failed'), { data, status });
  return data;
}

let toastTimer;
function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg; t.className = `show ${kind}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = ''), 3500);
}

function formData(form) {
  const out = {};
  for (const [k, v] of new FormData(form)) out[k] = typeof v === 'string' ? v.trim() : v;
  return out;
}

async function submitting(form, fn) {
  const btn = $('button[type=submit]', form);
  btn && (btn.disabled = true);
  try { await fn(); } catch (e) { toast(e.message, 'error'); } finally { btn && (btn.disabled = false); }
}

// ---------- nav ----------
function renderNav() {
  const u = store.user;
  const links = !u
    ? [['#/centers', 'Find a center'], ['#/login', 'Sign in'], ['#/register', 'Join']]
    : u.role === 'staff'
      ? [['#/staff', 'Verify'], ['#/staff/audit', 'Audit log']]
      : u.role === 'admin'
        ? [['#/admin', 'Overview'], ['#/staff/audit', 'Audit log']]
        : [['#/dashboard', 'Home'], ['#/centers', 'Donate'], ['#/rewards', 'Rewards'], ['#/profile', 'Profile']];
  const here = location.hash.split('?')[0] || '#/';
  $('#nav').innerHTML = links.map(([h, l]) => `<a href="${h}" class="${here === h ? 'active' : ''}">${l}</a>`).join('')
    + (u ? '<button type="button" id="logout">Sign out</button>' : '');
  $('#logout')?.addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* already gone */ }
    store.token = null; store.user = null; location.hash = '#/'; renderNav();
  });
}

const homeFor = (u) => (u?.role === 'staff' ? '#/staff' : u?.role === 'admin' ? '#/admin' : '#/dashboard');

// ---------- views ----------
const routes = [];
const route = (pattern, fn, opts = {}) => routes.push({ re: new RegExp(`^${pattern.replace(/:(\w+)/g, '([^/]+)')}$`), fn, ...opts });

route('#/', () => {
  if (store.user) { location.hash = homeFor(store.user); return; }
  view.innerHTML = `
    <section class="hero">
      <span class="pill accent">Every donation verified. Every point sponsor-funded.</span>
      <h1>Give blood.<br>Give forward.</h1>
      <p class="lead">Cruor helps you find a donation center, book a time that suits you, and turns each verified donation into appreciation points you can redeem — or pass on to a verified cause.</p>
      <div class="row"><a class="btn" href="#/register">Become a donor</a><a class="btn ghost" href="#/centers">Find a center</a></div>
    </section>
    <section class="grid two mt-l">
      <div class="card"><h2>How it works</h2>
        <ol class="steps">
          <li>Create an account and add your blood type.</li>
          <li>Find a participating center near you.</li>
          <li>Book a slot and show your code when you arrive.</li>
          <li>Staff verify your donation — points land in your wallet.</li>
          <li>Redeem a sponsor reward, or give it to a verified cause.</li>
        </ol>
      </div>
      <div class="card"><h2>Our promises</h2>
        <ul class="list">
          <li><strong>We never pay for blood.</strong> Points are a thank-you funded by sponsors, with no cash value.</li>
          <li><strong>Only verified donations count.</strong> Staff confirm each one; every check is audit-logged.</li>
          <li><strong>Privacy first.</strong> Sensitive details are encrypted. Recipients and donors are never linked.</li>
          <li><strong>Only verified charities.</strong> Gifts go through vetted partners, never to individuals.</li>
        </ul>
      </div>
    </section>`;
});

route('#/login', () => {
  view.innerHTML = `
    <div class="form-narrow card">
      <h1>Welcome back</h1>
      <form id="f">
        <div class="field"><label for="identifier">Email or phone</label><input id="identifier" name="identifier" autocomplete="username" required></div>
        <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
        <button class="btn block" type="submit">Sign in</button>
      </form>
      <p class="small muted mt">New here? <a href="#/register">Create an account</a></p>
      ${local ? `
        <div class="notice accent mt stack-s">
          <strong>Demo: try every role on this phone</strong>
          <div class="row">
            <button type="button" class="btn small" data-demo="donor">Donor</button>
            <button type="button" class="btn small ghost" data-demo="staff">Blood bank staff</button>
            <button type="button" class="btn small ghost" data-demo="admin">Admin</button>
          </div>
        </div>`
        : `<details class="small muted"><summary>Demo accounts</summary>
        <p>donor@cruor.test · staff@cruor.test · admin@cruor.test<br>Password: <code>cruor-demo-1</code></p></details>`}
    </div>`;
  const signIn = async (body) => {
    const r = await api('/api/auth/login', { method: 'POST', body });
    store.token = r.token; store.user = r.user; renderNav();
    location.hash = homeFor(r.user);
  };
  $('#f').addEventListener('submit', (e) => {
    e.preventDefault();
    submitting(e.target, () => signIn(formData(e.target)));
  });
  $$('[data-demo]').forEach((b) => b.addEventListener('click', async () => {
    $$('[data-demo]').forEach((x) => (x.disabled = true));
    try { await signIn({ identifier: `${b.dataset.demo}@cruor.test`, password: 'cruor-demo-1' }); }
    catch (e) { toast(e.message, 'error'); }
    finally { $$('[data-demo]').forEach((x) => (x.disabled = false)); }
  }));
});

route('#/register', () => {
  const bt = store.meta.bloodTypes.map((b) => `<option>${b}</option>`).join('');
  view.innerHTML = `
    <div class="form-narrow card">
      <h1>Join Cruor</h1>
      <p class="muted">Takes a minute. You can add more details later.</p>
      <form id="f">
        <div class="field"><label for="name">Your name</label><input id="name" name="name" autocomplete="name" required maxlength="80"></div>
        <div class="tabs" role="group" aria-label="Sign up with">
          <button type="button" class="btn small" data-mode="email">Email</button>
          <button type="button" class="btn small ghost" data-mode="phone">Phone</button>
        </div>
        <div class="field" data-for="email"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email"></div>
        <div class="field hidden" data-for="phone"><label for="phone">Phone</label><input id="phone" name="phone" type="tel" autocomplete="tel" placeholder="+961 70 123 456"></div>
        <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" minlength="8" autocomplete="new-password" required><div class="hint">At least 8 characters.</div></div>
        <div class="grid two">
          <div class="field"><label for="bloodType">Blood type</label><select id="bloodType" name="bloodType"><option value="">I don't know yet</option>${bt}</select></div>
          <div class="field"><label for="city">City</label><input id="city" name="city" autocomplete="address-level2"></div>
        </div>
        <fieldset class="card field">
          <legend class="small muted">Eligibility pre-check (optional)</legend>
          <div class="grid two">
            <div class="field"><label for="dob">Date of birth</label><input id="dob" name="dob" type="date"></div>
            <div class="field"><label for="weightKg">Weight (kg)</label><input id="weightKg" name="weightKg" type="number" min="20" max="300" inputmode="decimal"></div>
          </div>
          <div class="field"><label for="lastDonationAt">Last time you gave blood</label><input id="lastDonationAt" name="lastDonationAt" type="date"><div class="hint">Leave empty if never or not sure.</div></div>
        </fieldset>
        <div class="field"><label class="check"><input type="checkbox" name="consent" required> <span>I agree that Cruor stores my details securely to manage donations. Sensitive fields are encrypted and never shared with sponsors.</span></label></div>
        <button class="btn block" type="submit">Create account</button>
      </form>
    </div>`;
  let mode = 'email';
  $$('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.mode;
    $$('[data-mode]').forEach((x) => x.classList.toggle('ghost', x !== b));
    $$('[data-for]').forEach((x) => x.classList.toggle('hidden', x.dataset.for !== mode));
  }));
  $('#f').addEventListener('submit', (e) => {
    e.preventDefault();
    submitting(e.target, async () => {
      const d = formData(e.target);
      const body = { ...d, consent: d.consent === 'on', email: mode === 'email' ? d.email : undefined, phone: mode === 'phone' ? d.phone : undefined };
      for (const k of ['bloodType', 'dob', 'weightKg', 'lastDonationAt', 'city']) if (!body[k]) delete body[k];
      const r = await api('/api/auth/register', { method: 'POST', body });
      store.token = r.token; store.user = r.user; renderNav();
      toast('Welcome to Cruor!');
      location.hash = '#/centers';
    });
  });
});

route('#/dashboard', async () => {
  const d = await api('/api/dashboard');
  const next = d.upcoming[0];
  const e = d.eligibility;
  const status = e.eligible ? '<span class="pill good">Eligible to donate</span>'
    : e.nextEligibleAt ? `<span class="pill warn">Eligible from ${fmtDate(e.nextEligibleAt)}</span>`
      : e.reasons.length ? '<span class="pill warn">Check with a center</span>' : '<span class="pill">Complete your profile</span>';
  const unread = d.notifications.filter((n) => !n.read);
  view.innerHTML = `
    <div class="row spread"><div><h1>Hi, ${esc(d.user.name.split(' ')[0])}</h1>
      <div class="row">${d.user.bloodType ? `<span class="blood">${esc(d.user.bloodType)}</span>` : ''} ${status}</div></div>
      ${next ? '' : '<a class="btn" href="#/centers">Book a donation</a>'}</div>
    ${d.reminders.length ? `<div class="stack mt">${d.reminders.map((r) => `<div class="notice ${r.kind === 'appointment' ? 'accent' : r.kind === 'eligible' ? 'good' : ''}">${esc(r.text)}</div>`).join('')}</div>` : ''}
    <div class="grid three mt">
      <div class="card"><div class="stat">${d.points}</div><div class="stat-label">points · <a href="#/rewards">use them</a></div></div>
      <div class="card"><div class="stat">${d.stats.donations}</div><div class="stat-label">verified donations</div></div>
      <div class="card"><div class="stat">${d.stats.estimatedLivesHelped}</div><div class="stat-label">people potentially helped<sup>*</sup></div></div>
    </div>
    <div class="grid two mt">
      <section class="card"><h2>Upcoming</h2>
        ${d.upcoming.length ? `<ul class="list">${d.upcoming.map((a) => `<li class="row spread"><div><strong>${fmtDateTime(a.startsAt)}</strong><div class="small muted">${esc(a.centerName)}</div></div><a class="btn small" href="#/appointments/${a.id}">Show code</a></li>`).join('')}</ul>`
          : '<p class="empty">No appointments booked.</p>'}
      </section>
      <section class="card"><h2>Updates</h2>
        ${d.notifications.length ? `<ul class="list">${d.notifications.slice(0, 6).map((n) => `<li data-n="${n.id}" class="${n.read ? 'muted' : ''}"><strong>${esc(n.title)}</strong><div class="small">${esc(n.body)}</div><div class="small muted">${fmtDate(n.at)}</div></li>`).join('')}</ul>`
          : '<p class="empty">Nothing yet.</p>'}
      </section>
    </div>
    <section class="card mt"><h2>Donation history</h2>
      ${d.history.length ? `<ul class="list">${d.history.map((h) => `<li class="row spread"><div><strong>${fmtDate(h.verifiedAt)}</strong><div class="small muted">${esc(h.centerName)}</div></div><span class="pill good">Verified · +${h.points}</span></li>`).join('')}</ul>`
        : '<p class="empty">Your verified donations will appear here.</p>'}
    </section>
    <p class="small muted mt">* A single whole-blood donation can help up to three patients. This is an estimate, not a record of specific recipients.</p>`;
  // Mark visible notifications as read after viewing.
  setTimeout(() => unread.forEach((n) => api(`/api/notifications/${n.id}/read`, { method: 'POST' }).catch(() => {})), 1500);
}, { auth: true });

route('#/centers', async () => {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const qv = params.get('q') || '';
  const pos = store.user?.lat != null ? { lat: store.user.lat, lng: store.user.lng } : null;
  view.innerHTML = `
    <h1>Find a donation center</h1>
    <p class="muted">Only verified blood banks and hospitals appear here.</p>
    <form id="s" class="row" role="search">
      <input name="q" value="${esc(qv)}" placeholder="Search by name or city" aria-label="Search centers" class="grow">
      <button class="btn" type="submit">Search</button>
      <button class="btn ghost" type="button" id="near">Near me</button>
    </form>
    <div id="results" class="grid two mt"></div>`;
  const load = async (q, from) => {
    const sp = new URLSearchParams({ q });
    if (from) { sp.set('lat', from.lat); sp.set('lng', from.lng); }
    const { centers } = await api(`/api/centers?${sp}`);
    $('#results').innerHTML = centers.length ? centers.map((c) => `
      <a class="card center-card" href="#/centers/${c.id}">
        <div class="row spread"><h3>${esc(c.name)}</h3>${c.distanceKm != null ? `<span class="pill">${c.distanceKm} km</span>` : ''}</div>
        <div class="small muted">${esc(c.address)}, ${esc(c.city)}</div>
        <div class="small mt-s">${c.openToday ? `<span class="pill good">Open today ${c.openToday[0]}–${c.openToday[1]}</span>` : '<span class="pill">Closed today</span>'}
          <span class="pill">${c.kind === 'hospital' ? 'Hospital' : 'Blood bank'}</span></div>
      </a>`).join('') : '<p class="empty">No centers match that search.</p>';
  };
  $('#s').addEventListener('submit', (e) => { e.preventDefault(); load(formData(e.target).q, pos).catch((err) => toast(err.message, 'error')); });
  $('#near').addEventListener('click', () => {
    if (!navigator.geolocation) return toast('Location is not available in this browser.', 'error');
    navigator.geolocation.getCurrentPosition(
      (p) => load($('#s [name=q]').value, { lat: p.coords.latitude, lng: p.coords.longitude }),
      () => toast('We could not get your location. Try searching by city.', 'error'),
      { timeout: 8000 });
  });
  await load(qv, pos);
});

route('#/centers/:id', async (id) => {
  const { center: c } = await api(`/api/centers/${id}`);
  const days = Object.keys(DAY_NAMES);
  view.innerHTML = `
    <a href="#/centers" class="small">← All centers</a>
    <div class="grid two mt">
      <section class="card">
        <span class="pill">${c.kind === 'hospital' ? 'Hospital' : 'Blood bank'}</span>
        <h1 class="mt-s">${esc(c.name)}</h1>
        <p class="muted">${esc(c.address)}, ${esc(c.city)}${c.phone ? `<br>${esc(c.phone)}` : ''}</p>
        <h3>Opening hours</h3>
        <table><tbody>${days.map((d) => `<tr><th>${DAY_NAMES[d]}</th><td>${c.hours[d] ? `${c.hours[d][0]} – ${c.hours[d][1]}` : '<span class="muted">Closed</span>'}</td></tr>`).join('')}</tbody></table>
      </section>
      <section class="card">
        <h2>Book a slot</h2>
        ${store.user?.role === 'donor' ? `
          <div class="field"><label for="date">Date</label><input type="date" id="date" min="${todayLocal()}" value="${todayLocal()}"></div>
          <div id="slots" class="slots"></div>
          <div id="elig" class="mt"></div>
          <button class="btn block mt" id="book" disabled>Confirm booking</button>
          <p class="small muted mt-s">Bring ID, eat a good meal and drink plenty of water beforehand.</p>`
          : store.user ? '<p class="muted">Bookings are for donor accounts.</p>'
            : '<p>Sign in to book a time.</p><a class="btn" href="#/login">Sign in</a> <a class="btn ghost" href="#/register">Join</a>'}
      </section>
    </div>`;
  if (store.user?.role !== 'donor') return;

  const me = await api('/api/me');
  const e = me.eligibility;
  if (e.reasons.length) $('#elig').innerHTML = `<div class="notice warn">${esc(e.reasons.join(' '))} ${esc(e.disclaimer)}</div>`;
  else if (e.nextEligibleAt) {
    $('#elig').innerHTML = `<div class="notice warn">You can donate again from ${fmtDate(e.nextEligibleAt)}.</div>`;
    const min = e.nextEligibleAt.slice(0, 10);
    $('#date').min = min; $('#date').value = min;
  } else if (e.missing.length) $('#elig').innerHTML = `<div class="notice">Add your ${esc(e.missing.join(' and '))} in <a href="#/profile">your profile</a> to pre-check eligibility. ${esc(e.disclaimer)}</div>`;

  let chosen = null;
  const loadSlots = async () => {
    chosen = null; $('#book').disabled = true;
    const r = await api(`/api/centers/${id}/slots?date=${$('#date').value}`);
    $('#slots').innerHTML = r.slots.length
      ? r.slots.map((s) => `<button type="button" class="slot" data-t="${s.startsAt}" aria-pressed="false" ${s.available ? '' : 'disabled'}>${fmtTime(s.startsAt)}</button>`).join('')
      : `<p class="muted small">${r.open ? 'No slots left on this day.' : 'Closed on this day.'}</p>`;
    $$('.slot').forEach((b) => b.addEventListener('click', () => {
      $$('.slot').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true'); chosen = b.dataset.t; $('#book').disabled = false;
    }));
  };
  $('#date').addEventListener('change', () => loadSlots().catch((err) => toast(err.message, 'error')));
  $('#book').addEventListener('click', async () => {
    $('#book').disabled = true;
    try {
      const r = await api('/api/appointments', { method: 'POST', body: { centerId: Number(id), startsAt: chosen } });
      toast('Booked! Show this code when you arrive.');
      location.hash = `#/appointments/${r.appointment.id}`;
    } catch (err) { toast(err.message, 'error'); $('#book').disabled = false; }
  });
  await loadSlots();
}, { auth: false });

route('#/appointments/:id', async (id) => {
  const { appointment: a } = await api(`/api/appointments/${id}`);
  const label = { booked: ['accent', 'Booked'], completed: ['good', 'Verified'], cancelled: ['', 'Cancelled'], deferred: ['warn', 'Deferred'] }[a.status];
  view.innerHTML = `
    <a href="#/dashboard" class="small">← Home</a>
    <div class="form-narrow card mt stack">
      <div class="row spread"><h1>Your appointment</h1><span class="pill ${label[0]}">${label[1]}</span></div>
      <p><strong>${fmtDateTime(a.startsAt)}</strong><br><span class="muted">${esc(a.centerName)} · ${esc(a.centerAddress)}</span></p>
      ${a.status === 'booked' ? `
        <p class="small muted">After you donate, show this to staff so they can verify it.</p>
        <div class="qr" id="qr" aria-hidden="true"></div>
        <div class="code" aria-label="Verification code">${esc(a.verificationCode.replace(/(.{4})/, '$1 '))}</div>
        <p class="small muted">Keep this code private — it can only be used once, by staff at this center, on the day.</p>
        <button class="btn ghost block" id="cancel">Cancel appointment</button>` : ''}
    </div>`;
  if (a.status !== 'booked') return;
  const drawQr = () => {
    if (!window.qrcode) return false;
    const qr = window.qrcode(0, 'M'); qr.addData(`CRUOR:${a.verificationCode}`); qr.make();
    const img = new Image(); img.src = qr.createDataURL(6, 2); img.alt = '';
    $('#qr')?.replaceChildren(img);
    return true;
  };
  if (!drawQr()) window.addEventListener('load', drawQr, { once: true });
  $('#cancel').addEventListener('click', async () => {
    if (!confirm('Cancel this appointment?')) return;
    try { await api(`/api/appointments/${id}/cancel`, { method: 'POST' }); toast('Appointment cancelled.'); location.hash = '#/dashboard'; } catch (e) { toast(e.message, 'error'); }
  });
}, { auth: true });

route('#/rewards', async () => {
  const d = await api('/api/rewards');
  view.innerHTML = `
    <div class="row spread"><div><h1>Your points</h1><p class="muted">Sponsor-funded thanks for verified donations. No cash value.</p></div>
      <div class="card"><div class="stat">${d.points}</div><div class="stat-label">available</div></div></div>
    <h2 class="mt-l">Give it forward</h2>
    <p class="muted">Turn points into something real, fulfilled by a verified charity partner. You choose a path — never an individual.</p>
    <div class="grid two">${d.causes.map((c) => `
      <div class="card stack-s">
        <div class="row spread"><h3>${CAUSE_ICON[c.kind] || '💝'} ${esc(c.title)}</h3><span class="pill accent">${c.cost} pts</span></div>
        <p class="small">${esc(c.description)}</p><p class="small muted">via ${esc(c.charity)}</p>
        <details><summary class="small">Add a kind message (optional)</summary>
          <textarea maxlength="280" rows="2" data-msg="${c.id}" placeholder="Wishing you a joyful season…"></textarea>
          <div class="hint">Reviewed and delivered by the charity. No names, links or contact details.</div></details>
        <button class="btn block" data-give="${c.id}" ${d.points < c.cost ? 'disabled' : ''}>Give ${c.cost} points</button>
      </div>`).join('')}</div>
    <h2 class="mt-l">Sponsor rewards</h2>
    <div class="grid three">${d.rewards.map((r) => `
      <div class="card stack-s">
        <div class="row spread"><h3>${esc(r.title)}</h3><span class="pill">${r.cost} pts</span></div>
        <p class="small">${esc(r.description)}</p><p class="small muted">from ${esc(r.sponsor)}</p>
        <button class="btn ghost block" data-redeem="${r.id}" ${d.points < r.cost || !r.inStock ? 'disabled' : ''}>${r.inStock ? 'Redeem' : 'Out of stock'}</button>
      </div>`).join('')}</div>
    <p class="small muted mt">Not ready? Your points stay saved for later.</p>
    ${d.redemptions.length || d.gifts.length ? `<section class="card mt-l"><h2>Your activity</h2><ul class="list">
      ${d.redemptions.map((x) => `<li class="row spread"><div><strong>${esc(x.title)}</strong><div class="small muted">${fmtDate(x.at)} · voucher <code>${esc(x.voucherCode)}</code></div></div><span class="pill">−${x.points}</span></li>`).join('')}
      ${d.gifts.map((x) => `<li class="row spread"><div><strong>${esc(x.title)}</strong><div class="small muted">${fmtDate(x.at)} · ${esc(x.charity)}${x.message ? ` · message ${esc(x.messageStatus)}` : ''}</div></div><span class="pill good">Given · ${x.points}</span></li>`).join('')}
    </ul></section>` : ''}`;
  $$('[data-give]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const message = $(`[data-msg="${b.dataset.give}"]`).value.trim() || undefined;
      await api(`/api/causes/${b.dataset.give}/give`, { method: 'POST', body: { message } });
      toast('Thank you — your gift is on its way through our charity partner.');
      routeNow();
    } catch (e) { toast(e.message, 'error'); b.disabled = false; }
  }));
  $$('[data-redeem]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const r = await api(`/api/rewards/${b.dataset.redeem}/redeem`, { method: 'POST' });
      toast(`Redeemed! Voucher ${r.voucherCode}`);
      routeNow();
    } catch (e) { toast(e.message, 'error'); b.disabled = false; }
  }));
}, { auth: true });

route('#/profile', async () => {
  const { user: u, eligibility: e } = await api('/api/me');
  const bt = store.meta.bloodTypes.map((b) => `<option ${u.bloodType === b ? 'selected' : ''}>${b}</option>`).join('');
  view.innerHTML = `
    <h1>Profile</h1>
    <div class="grid two">
      <form class="card" id="f">
        <div class="field"><label for="name">Name</label><input id="name" name="name" value="${esc(u.name)}" required></div>
        <p class="small muted">${esc(u.email || u.phone)}</p>
        <div class="grid two">
          <div class="field"><label for="bloodType">Blood type</label><select id="bloodType" name="bloodType"><option value="">Unknown</option>${bt}</select></div>
          <div class="field"><label for="city">City</label><input id="city" name="city" value="${esc(u.city)}"></div>
          <div class="field"><label for="dob">Date of birth</label><input id="dob" name="dob" type="date" value="${esc(u.dob)}"></div>
          <div class="field"><label for="weightKg">Weight (kg)</label><input id="weightKg" name="weightKg" type="number" value="${esc(u.weightKg)}"></div>
        </div>
        <div class="field"><label class="check"><input type="checkbox" name="remindersOptIn" ${u.remindersOptIn ? 'checked' : ''}> Send me reminders when I can donate again</label></div>
        <button class="btn" type="submit">Save</button>
        <button class="btn ghost" type="button" id="loc">Use my location</button>
      </form>
      <section class="card"><h2>Eligibility pre-check</h2>
        ${e.eligible ? '<div class="notice good">Based on what you told us, you look good to donate.</div>'
          : `<div class="notice warn">${esc([...e.reasons, e.nextEligibleAt && `Next possible donation: ${fmtDate(e.nextEligibleAt)}.`, e.missing.length && `Missing: ${e.missing.join(', ')}.`].filter(Boolean).join(' '))}</div>`}
        <p class="small muted mt">${esc(e.disclaimer)}</p>
        <p class="small muted">General guidance: age ${store.meta.eligibility.minAge}–${store.meta.eligibility.maxAge}, at least ${store.meta.eligibility.minWeightKg} kg, ${store.meta.eligibility.wholeBloodIntervalDays} days between whole-blood donations.</p>
      </section>
    </div>`;
  let coords = {};
  $('#loc').addEventListener('click', () => navigator.geolocation?.getCurrentPosition((p) => {
    coords = { lat: p.coords.latitude, lng: p.coords.longitude }; toast('Location captured — press Save.');
  }, () => toast('Could not get your location.', 'error')));
  $('#f').addEventListener('submit', (ev) => {
    ev.preventDefault();
    submitting(ev.target, async () => {
      const d = formData(ev.target);
      const r = await api('/api/me', { method: 'PATCH', body: { ...d, bloodType: d.bloodType || null, remindersOptIn: d.remindersOptIn === 'on', ...coords } });
      store.user = r.user; toast('Saved.'); routeNow();
    });
  });
}, { auth: true });

// ---------- staff ----------
route('#/staff', async () => {
  const d = await api('/api/staff/today');
  view.innerHTML = `
    <h1>Verify a donation</h1>
    <p class="muted">${esc(d.center?.name || '')}</p>
    <div class="grid two">
      <section class="card stack">
        <form id="f" class="stack">
          <div><label for="code">Donor's code</label><input id="code" name="code" autocomplete="off" autocapitalize="characters" placeholder="ABCD 2345" class="code-input"></div>
          <div class="row"><button class="btn" type="submit">Look up</button><button class="btn ghost" type="button" id="scan">Scan QR</button></div>
        </form>
        <video class="scan hidden" id="video" playsinline muted></video>
        <div id="result"></div>
      </section>
      <section class="card"><h2>Today</h2>
        ${d.appointments.length ? `<ul class="list">${d.appointments.map((a) => `<li class="row spread"><div><strong>${fmtTime(a.startsAt)}</strong> ${esc(a.donorName)} <span class="blood small">${esc(a.donorBloodType || '')}</span></div><span class="pill ${a.status === 'completed' ? 'good' : a.status === 'deferred' ? 'warn' : ''}">${a.status}</span></li>`).join('')}</ul>`
          : '<p class="empty">No appointments today.</p>'}
      </section>
    </div>`;

  const show = (a, code) => {
    $('#result').innerHTML = `
      <div class="notice accent stack-s">
        <div><strong>${esc(a.donorName)}</strong> ${a.donorBloodType ? `<span class="blood">${esc(a.donorBloodType)}</span>` : ''} ${a.donorAge ? `· ${a.donorAge} yrs` : ''}</div>
        <div class="small">${fmtDateTime(a.startsAt)} · <strong>${esc(a.status)}</strong></div>
        <p class="small">Please check photo ID before verifying.</p>
        ${store.meta.demo && new Date(a.startsAt).toDateString() !== new Date().toDateString() ? '<p class="small"><strong>Demo build:</strong> verifying before the appointment day is allowed so you can try the whole flow now. The real service only allows it on the day.</p>' : ''}
        ${a.status === 'booked' ? '<div class="row"><button class="btn" id="verify">Confirm donation completed</button><button class="btn ghost" id="defer">Donor deferred</button></div>' : ''}
      </div>`;
    $('#verify')?.addEventListener('click', async () => {
      try {
        const r = await api('/api/staff/verify', { method: 'POST', body: { code } });
        toast(`Verified. ${r.points} points sent to the donor.`); routeNow();
      } catch (e) { toast(e.message, 'error'); }
    });
    $('#defer')?.addEventListener('click', async () => {
      if (!confirm('Record that this donor was deferred today? No points are awarded.')) return;
      try { await api('/api/staff/defer', { method: 'POST', body: { code } }); toast('Recorded.'); routeNow(); } catch (e) { toast(e.message, 'error'); }
    });
  };
  const lookup = async (raw) => {
    const code = raw.replace(/^CRUOR:/i, '');
    try { show((await api('/api/staff/lookup', { method: 'POST', body: { code } })).appointment, code); }
    catch (e) { $('#result').innerHTML = `<div class="notice warn">${esc(e.message)}</div>`; }
  };
  $('#f').addEventListener('submit', (e) => { e.preventDefault(); lookup(formData(e.target).code); });

  $('#scan').addEventListener('click', async () => {
    if (!('BarcodeDetector' in window)) return toast('QR scanning is not supported in this browser — type the code instead.', 'error');
    const video = $('#video');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream; video.classList.remove('hidden'); await video.play();
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      const stop = () => { stream.getTracks().forEach((t) => t.stop()); video.classList.add('hidden'); };
      window.addEventListener('hashchange', stop, { once: true });
      const tick = async () => {
        if (video.classList.contains('hidden')) return;
        const [hit] = await detector.detect(video).catch(() => []);
        if (hit?.rawValue?.startsWith('CRUOR:')) { stop(); $('#code').value = hit.rawValue.slice(6); lookup(hit.rawValue); } else requestAnimationFrame(tick);
      };
      tick();
    } catch { toast('Camera unavailable — type the code instead.', 'error'); }
  });
}, { auth: true, roles: ['staff'] });

route('#/staff/audit', async () => {
  const { entries } = await api('/api/staff/audit');
  view.innerHTML = `
    <h1>Audit log</h1>
    <p class="muted">Append-only record of bookings, verifications and other sensitive actions.</p>
    <div class="card table-wrap"><table>
      <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Ref</th></tr></thead>
      <tbody>${entries.map((e) => `<tr><td>${fmtDateTime(e.at)}</td><td>${esc(e.actor || '—')}</td><td><code>${esc(e.action)}</code></td><td class="small muted">${esc(e.entity)} #${esc(e.entityId ?? '')}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No entries yet.</td></tr>'}</tbody>
    </table></div>`;
}, { auth: true, roles: ['staff', 'admin'] });

// ---------- admin ----------
route('#/admin', async () => {
  const [m, { messages }] = await Promise.all([api('/api/admin/metrics'), api('/api/admin/messages')]);
  const tiles = [
    ['Registered donors', m.registeredDonors], ['Active donors (30d)', m.activeDonors30d], ['Verified donations', m.verifiedDonations],
    ['Repeat donation rate', `${m.repeatDonationRate}%`], ['Centers onboarded', m.bloodBanksOnboarded], ['Sponsors', m.sponsors],
    ['Rewards redeemed', m.rewardsRedeemed], ['Rewards given to charity', m.rewardsDonated],
  ];
  view.innerHTML = `
    <h1>Overview</h1>
    <div class="grid three">${tiles.map(([l, v]) => `<div class="card"><div class="stat">${v}</div><div class="stat-label">${l}</div></div>`).join('')}</div>
    <section class="card mt-l"><h2>Messages awaiting review</h2>
      <p class="small muted">Donor identities are hidden from moderators. Approved messages are passed to the charity for delivery.</p>
      ${messages.length ? `<ul class="list">${messages.map((x) => `<li><p>“${esc(x.message)}”</p><div class="row spread"><span class="small muted">${esc(x.cause)} · ${esc(x.charity)}</span>
        <span class="row"><button class="btn small" data-mod="${x.id}" data-d="approved">Approve</button><button class="btn small ghost" data-mod="${x.id}" data-d="rejected">Reject</button></span></div></li>`).join('')}</ul>`
        : '<p class="empty">All caught up.</p>'}
    </section>`;
  $$('[data-mod]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/admin/messages/${b.dataset.mod}/moderate`, { method: 'POST', body: { decision: b.dataset.d } }); routeNow(); } catch (e) { toast(e.message, 'error'); }
  }));
}, { auth: true, roles: ['admin'] });

// ---------- router ----------
async function routeNow() {
  const hash = (location.hash || '#/').split('?')[0];
  const match = routes.map((r) => ({ r, m: r.re.exec(hash) })).find((x) => x.m);
  renderNav();
  if (!match) { view.innerHTML = '<div class="empty"><h1>Not found</h1><a href="#/">Go home</a></div>'; return; }
  const { r, m } = match;
  if (r.auth && !store.user) { location.hash = '#/login'; return; }
  if (r.roles && !r.roles.includes(store.user.role)) { location.hash = homeFor(store.user); return; }
  try {
    await r.fn(...m.slice(1));
    view.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  } catch (e) {
    if (e.status !== 401) view.innerHTML = `<div class="notice warn">${esc(e.message)}</div>`;
  }
}

async function boot() {
  if (local) {
    const note = document.createElement('p');
    note.className = 'mt-s';
    note.innerHTML = 'Demo mode: all data stays on this device. <button type="button" class="linklike" id="reset-demo">Reset demo data</button>';
    $('.footer').append(note);
    $('#reset-demo').addEventListener('click', () => {
      if (confirm('Erase everything on this device and start again with fresh demo data?')) local.reset();
    });
  }
  store.meta = await api('/api/meta');
  if (store.token) {
    try { store.user = (await api('/api/me')).user; } catch { store.token = null; }
  }
  window.addEventListener('hashchange', routeNow);
  routeNow();
}
boot();
