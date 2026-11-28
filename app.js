import { firebaseConfig, emailjsConfig } from './config.js';
import { openStore } from './store.js';
import { newKeyPair, sealFor, openBox, sha256 } from './crypto.js';

// ── Helfer ──────────────────────────────────────────────────────────────────
const app = document.getElementById('app');
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ls = {
  get(k, f = null) { try { const v = localStorage.getItem(k); return v == null ? f : JSON.parse(v); } catch { return f; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const ABC = 'abcdefghijkmnpqrstuvwxyz23456789';
const rand = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => ABC[b % ABC.length]).join('');
const slug = (s) =>
  s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'wichteln';
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const fmtDate = (d) => {
  if (!d) return '';
  const dt = new Date(d + 'T12:00:00');
  return isNaN(dt) ? d : dt.toLocaleDateString('de-CH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
};
const nl2br = (s) => esc(s).replace(/\n/g, '<br>');

const BASE = location.origin + location.pathname;
const groupLink = (gid) => `${BASE}?g=${gid}`;
const personalLink = (gid, me) => `${groupLink(gid)}#p=${me.mid}.${me.d}`;
const adminLink = (gid, key) => `${groupLink(gid)}#admin=${key}`;
// Ohne EmailJS bekommt niemand eine Anmelde-Mail – dann auf den gespeicherten Link verweisen
const LINK_FROM = emailjsConfig ? ' aus der Anmelde-Mail' : ', den du bei der Anmeldung gespeichert hast';
const waLink = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;
const mailLink = ({ to = '', bcc = '', subject, body }) =>
  `mailto:${encodeURIComponent(to)}?${bcc ? `bcc=${bcc.split(',').map(encodeURIComponent).join(',')}&` : ''}subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

let toastTimer;
function toast(msg, kind = 'ok') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.dataset.kind = kind;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3600);
}

// Neu zeichnen, ohne dass Eingaben, Fokus oder geöffnete Bereiche verloren gehen
function paint(html) {
  const vals = {};
  app.querySelectorAll('input[id], textarea[id], select[id]').forEach((el) => {
    if (!el.readOnly && el.type !== 'hidden') vals[el.id] = el.value;
  });
  const open = [...app.querySelectorAll('details[id]')].map((d) => [d.id, d.open]);
  const active = document.activeElement;
  const focusId = active?.id;
  let sel = null;
  try { sel = [active.selectionStart, active.selectionEnd]; } catch {}
  app.innerHTML = html;
  for (const [id, v] of Object.entries(vals)) {
    const el = document.getElementById(id);
    if (el && !el.readOnly) el.value = v;
  }
  for (const [id, o] of open) { const d = document.getElementById(id); if (d) d.open = o; }
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) { el.focus({ preventScroll: true }); try { if (sel?.[0] != null) el.setSelectionRange(...sel); } catch {} }
  }
}

function rememberGroup(gid, name) {
  const list = ls.get('wichtel:groups', []).filter((g) => g.gid !== gid);
  list.unshift({ gid, name });
  ls.set('wichtel:groups', list.slice(0, 12));
}

async function sendMail(to_email, to_name, subject, message) {
  if (!emailjsConfig) return false;
  try {
    const r = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: emailjsConfig.serviceId,
        template_id: emailjsConfig.templateId,
        user_id: emailjsConfig.publicKey,
        template_params: { to_email, to_name, subject, message },
      }),
    });
    return r.ok;
  } catch { return false; }
}

// Zufällige Zuteilung ohne Selbstbeschenkung und unter Beachtung der Ausschlüsse
function derange(ids, exclusions) {
  const bad = new Set(exclusions.flatMap(([a, b]) => [`${a}>${b}`, `${b}>${a}`]));
  const rnd = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  for (let t = 0; t < 20000; t++) {
    const r = ids.slice();
    for (let i = r.length - 1; i > 0; i--) { const j = rnd(i + 1); [r[i], r[j]] = [r[j], r[i]]; }
    if (ids.every((g, i) => r[i] !== g && !bad.has(`${g}>${r[i]}`))) return Object.fromEntries(ids.map((g, i) => [g, r[i]]));
  }
  return null;
}

const demoBanner = (store) =>
  store.demo
    ? `<div class="demo" role="note"><strong>Demo-Modus.</strong> Alles wird nur in diesem Browser gespeichert. Damit sich die Familie anmelden kann, Firebase in <code>config.js</code> eintragen (Anleitung im README).</div>`
    : '';

const store = await openStore(firebaseConfig);

// ── Startseite: neue Runde erstellen ────────────────────────────────────────
function renderHome() {
  const known = ls.get('wichtel:groups', []);
  const nextXmas = `${new Date().getMonth() === 11 && new Date().getDate() > 24 ? new Date().getFullYear() + 1 : new Date().getFullYear()}-12-24`;
  paint(`
    ${demoBanner(store)}
    <header class="hero">
      <p class="eyebrow">Wichteln · Familie</p>
      <h1>Lose ziehen,<br>ohne Hut.</h1>
      <p class="lede">Erstelle eine Wichtelrunde und schick den Link in den Familien-Chat. Alle melden sich mit ihrer E-Mail an. Nach der Auslosung sieht jede Person nur, wen sie selbst beschenkt.</p>
    </header>

    <ol class="steps">
      <li><span>Runde erstellen</span><small>Name, Datum, Budget</small></li>
      <li><span>Link per WhatsApp teilen</span><small>Alle tragen Namen &amp; E-Mail ein</small></li>
      <li><span>Auslosen</span><small>Jedes Los ist verschlüsselt</small></li>
    </ol>

    <form class="card" data-form="create" autocomplete="off">
      <h2>Neue Wichtelrunde</h2>
      <label for="c-name">Name der Runde</label>
      <input id="c-name" name="gname" required maxlength="60" placeholder="z. B. Familie Moser – Weihnachten ${new Date(nextXmas).getFullYear()}">
      <div class="row">
        <div><label for="c-date">Bescherung am</label><input id="c-date" name="date" type="date" value="${nextXmas}"></div>
        <div><label for="c-budget">Budget pro Geschenk</label><div class="affix"><span>CHF</span><input id="c-budget" name="budget" inputmode="decimal" placeholder="30"></div></div>
      </div>
      <label for="c-note">Nachricht an alle <span class="opt">optional</span></label>
      <textarea id="c-note" name="note" rows="3" maxlength="600" placeholder="Wir treffen uns bei Oma, Geschenke bitte eingepackt mitbringen."></textarea>
      <button class="btn primary" type="submit">Runde erstellen</button>
    </form>

    ${known.length ? `
      <section class="card quiet">
        <h2>Deine Runden auf diesem Gerät</h2>
        <ul class="known">${known.map((g) => `<li><a href="${esc(groupLink(g.gid))}">${esc(g.name)}</a></li>`).join('')}</ul>
      </section>` : ''}
  `);
}

async function createGroup(form) {
  const f = form.elements;
  const name = f.gname.value.trim();
  if (!name) return toast('Bitte gib der Runde einen Namen.', 'err');
  const key = rand(18);
  const data = {
    name,
    date: f.date.value,
    budget: f.budget.value.trim(),
    note: f.note.value.trim(),
    adminHash: await sha256(key),
    createdAt: Date.now(),
    members: {},
    results: {},
    exclusions: [],
    drawnAt: null,
    shortLink: '',
  };
  form.querySelector('button').disabled = true;
  for (let i = 0; i < 4; i++) {
    const id = `${slug(name)}-${rand(4)}`;
    try {
      await store.create(id, data);
      ls.set(`wichtel:admin:${id}`, key);
      rememberGroup(id, name);
      location.href = `${groupLink(id)}#admin=${key}&neu=1`;
      return;
    } catch (e) {
      if (e.message !== 'exists') {
        form.querySelector('button').disabled = false;
        return toast(`Speichern fehlgeschlagen: ${e.message}`, 'err');
      }
    }
  }
}

// ── Wichtelrunde ────────────────────────────────────────────────────────────
const S = { gid: null, g: null, me: null, adminKey: null, isAdmin: false, plain: null, plainCt: null, decryptErr: false, fresh: false, justJoined: false, confirm: null };

async function initGroup(id) {
  S.gid = id;
  const h = new URLSearchParams(location.hash.slice(1));
  const p = h.get('p');
  if (p && p.includes('.')) { const [mid, d] = p.split('.'); ls.set(`wichtel:me:${id}`, { mid, d }); }
  if (h.get('admin')) ls.set(`wichtel:admin:${id}`, h.get('admin'));
  S.fresh = h.get('neu') === '1';
  // Geheimnisse aus der Adresszeile entfernen, damit niemand versehentlich seinen Link weiterleitet
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);

  S.me = ls.get(`wichtel:me:${id}`);
  S.adminKey = ls.get(`wichtel:admin:${id}`);
  paint(`${demoBanner(store)}<p class="loading">Wichtelrunde wird geladen…</p>`);

  store.watch(id, async (g, err) => {
    if (err) return paint(`<section class="card"><h2>Verbindung fehlgeschlagen</h2><p>${esc(err.message)}</p></section>`);
    if (!g) return paint(`${demoBanner(store)}<section class="card"><h2>Diese Wichtelrunde gibt es nicht</h2><p>Prüfe den Link oder frag die Person, die dich eingeladen hat.</p><a class="btn" href="${esc(BASE)}">Eigene Runde erstellen</a></section>`);
    S.g = g;
    if (S.me && !g.members?.[S.me.mid]) { ls.del(`wichtel:me:${id}`); S.me = null; }
    S.isAdmin = !!S.adminKey && (await sha256(S.adminKey)) === g.adminHash;
    if (S.me || S.isAdmin) rememberGroup(id, g.name);
    await decryptMine();
    renderGroup();
  });
}

async function decryptMine() {
  const box = S.me && S.g.results?.[S.me.mid];
  if (!box) { S.plain = null; S.plainCt = null; S.decryptErr = false; return; }
  if (S.plainCt === box.ct) return;
  try {
    S.plain = await openBox(box, S.g.members[S.me.mid].pub, S.me.d);
    S.decryptErr = false;
  } catch {
    S.plain = null;
    S.decryptErr = true;
  }
  S.plainCt = box.ct;
}

// Gästeliste ↔ Anmeldungen: zuerst über guestId, sonst über den gleichen Namen
// (so werden auch Personen erkannt, die sich vor dem Anlegen der Liste angemeldet haben)
function guestMatches(g) {
  const members = Object.entries(g.members || {});
  const norm = (s) => String(s).trim().toLowerCase();
  const used = new Set();
  const map = {};
  for (const gu of g.guests || []) {
    const hit = members.find(([, m]) => m.guestId === gu.id);
    if (hit) { map[gu.id] = hit[0]; used.add(hit[0]); }
  }
  for (const gu of g.guests || []) {
    if (map[gu.id]) continue;
    const hit = members.find(([id, m]) => !used.has(id) && !m.guestId && norm(m.name) === norm(gu.name));
    if (hit) { map[gu.id] = hit[0]; used.add(hit[0]); }
  }
  return map;
}

function syncJoin() {
  const sel = document.getElementById('j-guest');
  const wrap = document.getElementById('j-name-wrap');
  if (sel && wrap) wrap.hidden = sel.value !== 'other';
}

function renderGroup() {
  const g = S.g;
  const members = Object.entries(g.members || {}).sort((a, b) => a[1].joinedAt - b[1].joinedAt);
  const drawn = !!g.drawnAt;
  const guests = g.guests || [];
  const match = guestMatches(g);
  const claimed = guests.filter((gu) => match[gu.id]).length;
  document.title = `${g.name} · Wichteln`;
  paint(`
    ${demoBanner(store)}
    <header class="group-head">
      <p class="eyebrow">${drawn ? 'Ausgelost' : 'Anmeldung offen'}</p>
      <h1>${esc(g.name)}</h1>
      <dl class="facts">
        ${g.date ? `<div><dt>Bescherung</dt><dd>${esc(fmtDate(g.date))}</dd></div>` : ''}
        ${g.budget ? `<div><dt>Budget</dt><dd class="num">CHF ${esc(g.budget)}</dd></div>` : ''}
        <div><dt>Dabei</dt><dd class="num">${guests.length ? `${claimed} von ${guests.length} angemeldet` : `${members.length} ${members.length === 1 ? 'Person' : 'Personen'}`}</dd></div>
      </dl>
      ${g.note ? `<p class="note">${nl2br(g.note)}</p>` : ''}
    </header>
    ${S.isAdmin && S.fresh ? freshHtml() : ''}
    ${S.me ? meHtml(g, drawn) : drawn ? lateHtml() : joinHtml(g, match)}
    ${membersHtml(g, members, match)}
    ${S.isAdmin ? adminHtml(g, members, drawn, match) : ''}
    <footer class="foot"><a href="${esc(BASE)}">Eigene Wichtelrunde erstellen</a></footer>
  `);
  syncJoin();
}

function freshHtml() {
  return `
    <section class="card callout">
      <h2>Deine Runde steht</h2>
      <p>Speichere zuerst deinen <strong>Admin-Link</strong>. Nur damit kannst du später auf einem anderen Gerät auslosen und Personen verwalten.</p>
      <div class="linkbox"><input id="adm-link-fresh" readonly value="${esc(adminLink(S.gid, S.adminKey))}"><button class="btn" data-act="copy" data-text="${esc(adminLink(S.gid, S.adminKey))}">Kopieren</button></div>
      <p class="hint">Danach unten bei <em>Organisation</em> den Einladungslink per WhatsApp teilen. Wenn du selbst mitmachst, melde dich gleich hier an.</p>
      <button class="btn ghost" data-act="dismiss-fresh">Erledigt</button>
    </section>`;
}

function joinHtml(g, match) {
  const guests = g.guests || [];
  const open = guests.filter((gu) => !match[gu.id]);
  return `
    <form class="card" data-form="join" autocomplete="on">
      <h2>Mach mit</h2>
      <p class="sub">Trag dich ein. Nach der Auslosung erfährst du hier, wen du beschenkst.</p>
      ${guests.length ? `
      <label for="j-guest">Wer bist du?</label>
      <select id="j-guest" name="guest">
        <option value="">Bitte wählen…</option>
        ${open.map((gu) => `<option value="${gu.id}">${esc(gu.name)}</option>`).join('')}
        <option value="other">Ich stehe nicht auf der Liste</option>
      </select>` : ''}
      <div id="j-name-wrap" class="field"${guests.length ? ' hidden' : ''}>
        <label for="j-name">Dein Name</label>
        <input id="j-name" name="who" maxlength="40" autocomplete="given-name" placeholder="Vorname">
      </div>
      <label for="j-email">E-Mail</label>
      <input id="j-email" name="email" type="email" required autocomplete="email" placeholder="name@beispiel.ch">
      <label for="j-wish">Dein Wunschzettel <span class="opt">optional</span></label>
      <textarea id="j-wish" name="wish" rows="3" maxlength="800" placeholder="Bücher von Martin Suter, warme Socken (Grösse 39), etwas Selbstgemachtes"></textarea>
      <p class="hint">Den Wunschzettel sieht nur die Person, die dich zieht. Du kannst ihn später noch ändern.</p>
      <button class="btn primary" type="submit">Anmelden</button>
    </form>`;
}

function lateHtml() {
  return `
    <section class="card">
      <h2>Die Lose sind schon gezogen</h2>
      <p>Wenn du dich angemeldet hast, öffne deinen <strong>persönlichen Link</strong>${LINK_FROM}. Auf diesem Gerät ist keine Anmeldung gespeichert.</p>
      <p class="hint">Tipp: Öffne den Link im gleichen Browser wie bei der Anmeldung. Aus WhatsApp heraus öffnet sich oft ein anderer Browser. Tippe dann auf „Im Browser öffnen“ oder kopiere den Link nach Safari bzw. Chrome.</p>
      <p class="hint">Link verloren? Melde dich bei der Person, die die Runde organisiert. Sie kann dir einen neuen Link schicken.</p>
    </section>`;
}

function personalLinkHtml(g, me, prominent) {
  const link = personalLink(S.gid, me);
  const text = `Mein persönlicher Wichtel-Link für „${g.name}“ (nicht weitergeben):\n${link}`;
  const email = g.members[me.mid].email;
  const inner = `
      <p class="sub">Mit diesem Link siehst du nach der Auslosung deinen Wichtel, auch auf einem anderen Gerät. Er gehört nur dir. Bitte nicht in den Familien-Chat schicken.</p>
      <div class="linkbox"><input id="me-link" readonly value="${esc(link)}"><button class="btn" data-act="copy" data-text="${esc(link)}">Kopieren</button></div>
      <div class="actions">
        ${emailjsConfig ? '' : `<a class="btn" href="${esc(mailLink({ to: email, subject: `Mein Wichtel-Link: ${g.name}`, body: text }))}">An mich mailen</a>`}
        <a class="btn" href="${esc(waLink(text))}" target="_blank" rel="noopener">An mich per WhatsApp</a>
      </div>`;
  return prominent
    ? `<div class="keep">${inner}</div>`
    : `<details id="d-mylink" class="keep-fold"><summary>Mein persönlicher Link</summary>${inner}</details>`;
}

function meHtml(g, drawn) {
  const m = g.members[S.me.mid];
  let draw = '';
  if (drawn && S.plain && g.members[S.plain]) {
    const r = g.members[S.plain];
    const revealed = ls.get(`wichtel:seen:${S.gid}:${S.plainCt}`, false);
    draw = revealed
      ? `<div class="lot open" aria-live="polite">
           <p class="eyebrow">Du beschenkst</p>
           <p class="lot-name">${esc(r.name)}</p>
           <div class="wish"><h3>Wunschzettel von ${esc(r.name)}</h3>${r.wish ? `<p>${nl2br(r.wish)}</p>` : '<p class="muted">Noch keine Wünsche eingetragen. Schau später nochmals vorbei.</p>'}</div>
           ${g.budget ? `<p class="hint">Budget: CHF ${esc(g.budget)}${g.date ? ` · Bescherung ${esc(fmtDate(g.date))}` : ''}</p>` : ''}
         </div>`
      : `<button class="lot closed" data-act="reveal"><span class="fold">Dein Los</span><span class="tap">Antippen zum Aufdecken</span></button>`;
  } else if (drawn && S.decryptErr) {
    draw = `<div class="card warn"><p>Dein Los liess sich auf diesem Gerät nicht öffnen. Öffne deinen persönlichen Link${LINK_FROM}.</p></div>`;
  } else if (drawn) {
    draw = `<div class="card warn"><p>Du hast dich nach der Auslosung angemeldet. Bitte die Organisatorin oder den Organisator, nochmals auszulosen.</p></div>`;
  }
  return `
    <section class="card me">
      <div class="me-head">
        <h2>${drawn ? `Hallo ${esc(m.name)}` : `Du bist dabei, ${esc(m.name)}`}</h2>
        <button class="link-btn" data-act="logout">Nicht ${esc(m.name)}?</button>
      </div>
      ${drawn ? draw : `<p class="waiting">Die Lose sind noch nicht gezogen. Du bekommst Bescheid, sobald es so weit ist.</p>`}
      ${S.justJoined ? personalLinkHtml(g, S.me, true) : ''}
      <form data-form="wish" class="wish-form">
        <label for="w-wish">Dein Wunschzettel</label>
        <textarea id="w-wish" name="wish" rows="3" maxlength="800" placeholder="Was würde dich freuen?">${esc(m.wish || '')}</textarea>
        <button class="btn" type="submit">Wunschzettel speichern</button>
      </form>
      ${S.justJoined ? '' : personalLinkHtml(g, S.me, false)}
    </section>`;
}

function membersHtml(g, members, match) {
  const guests = g.guests || [];
  if (!members.length && !guests.length) return `<section class="card quiet"><h2>Noch niemand angemeldet</h2><p class="muted">Sobald sich jemand einträgt, erscheint der Name hier.</p></section>`;
  const chip = (name, mid) => {
    const self = mid && S.me?.mid === mid;
    return `<li class="${mid ? '' : 'pending'}${self ? ' self' : ''}">${esc(name)}${self ? ' <small>(du)</small>' : mid ? '' : ' <small>offen</small>'}</li>`;
  };
  const matched = new Set(Object.values(match));
  const extras = members.filter(([id]) => !matched.has(id));
  const open = guests.filter((gu) => !match[gu.id]).length;
  return `
    <section class="card quiet">
      <h2>Wer ist dabei</h2>
      ${guests.length && !g.drawnAt ? `<p class="sub">${open ? `Noch ${open} ${open === 1 ? 'Person' : 'Personen'} offen.` : 'Alle auf der Liste sind angemeldet.'}</p>` : ''}
      <ul class="people">
        ${guests.map((gu) => chip(gu.name, match[gu.id])).join('')}
        ${extras.map(([id, m]) => chip(m.name, id)).join('')}
      </ul>
    </section>`;
}

function guestsAdminHtml(g, drawn, match, invite) {
  const guests = g.guests || [];
  const proxies = ls.get(`wichtel:proxy:${S.gid}`, {});
  const missing = guests.filter((gu) => !match[gu.id]);
  const remind = `🎁 ${g.name}: Noch nicht angemeldet ${missing.length === 1 ? 'ist' : 'sind'} ${missing.map((gu) => gu.name).join(', ')}. Bitte hier eintragen:\n${invite}`;
  const row = (gu) => {
    const mid = match[gu.id];
    const m = mid && g.members[mid];
    const proxy = mid && proxies[mid];
    let actions = '';
    if (proxy) {
      const link = personalLink(S.gid, { mid, d: proxy });
      const text = `Hallo ${gu.name}, ich habe dich für „${g.name}“ angemeldet. Das ist dein persönlicher Wichtel-Link (nicht weitergeben). Nach der Auslosung siehst du dort, wen du beschenkst:\n${link}`;
      actions = `<span class="row-actions"><button class="link-btn" data-act="copy" data-text="${esc(link)}">Link kopieren</button><a class="link-btn" href="${esc(waLink(text))}" target="_blank" rel="noopener">Per WhatsApp</a></span>`;
    } else if (!mid && !drawn) {
      actions = `<span class="row-actions"><button class="link-btn" data-act="ask-behalf" data-guest="${gu.id}">Für ${esc(gu.name)} anmelden</button><button class="link-btn" data-act="del-guest" data-guest="${gu.id}" aria-label="${esc(gu.name)} von der Liste nehmen">Entfernen</button></span>`;
    }
    const form = S.confirm === `behalf:${gu.id}` ? `
      <form data-form="behalf" data-guest="${gu.id}" class="behalf">
        <p class="sub">Für Personen ohne Handy oder WhatsApp. Du bekommst den persönlichen Link und gibst ihn weiter.</p>
        <label for="b-email">E-Mail von ${esc(gu.name)} <span class="opt">optional</span></label>
        <input id="b-email" name="email" type="email" placeholder="name@beispiel.ch">
        <label for="b-wish">Wunschzettel <span class="opt">optional</span></label>
        <textarea id="b-wish" name="wish" rows="2" maxlength="800"></textarea>
        <div class="actions"><button class="btn primary" type="submit">${esc(gu.name)} anmelden</button><button class="btn ghost" data-act="cancel">Abbrechen</button></div>
      </form>` : '';
    return `<li><span class="who">${esc(gu.name)}</span><span class="mail">${m ? (proxy ? 'von dir angemeldet' : `angemeldet${m.email ? ` · ${esc(m.email)}` : ''}`) : 'noch nicht angemeldet'}</span>${actions}${form}</li>`;
  };
  return `
      <p class="sub">Wer an Weihnachten dabei ist. Alle wählen bei der Anmeldung ihren Namen, und du siehst, wer noch fehlt.</p>
      ${guests.length ? `<ul class="roster guests">${guests.map(row).join('')}</ul>` : ''}
      ${drawn ? '' : `
      <form data-form="guests" class="guest-add">
        <label for="g-names">Namen hinzufügen <span class="opt">einer pro Zeile</span></label>
        <textarea id="g-names" name="names" rows="3" placeholder="Oma Rosmarie&#10;Opa Walter&#10;Anna"></textarea>
        <button class="btn" type="submit">Zur Gästeliste hinzufügen</button>
      </form>`}
      ${missing.length && !drawn && guests.length > missing.length ? `<div class="actions"><a class="btn wa" href="${esc(waLink(remind))}" target="_blank" rel="noopener">Fehlende per WhatsApp erinnern</a></div>` : ''}`;
}

function participantRow(g, id, m, drawn) {
  const proxy = ls.get(`wichtel:proxy:${S.gid}`, {})[id];
  const own = S.me?.mid === id;
  let actions;
  if (S.confirm === `rm:${id}`) {
    actions = `<span class="confirm">Entfernen? <button class="link-btn danger" data-act="remove" data-mid="${id}">Ja</button> <button class="link-btn" data-act="cancel">Nein</button></span>`;
  } else {
    const link = proxy && personalLink(S.gid, { mid: id, d: proxy });
    const text = link && `Hallo ${m.name}, hier ist dein persönlicher Wichtel-Link für „${g.name}“ (nicht weitergeben). Dort siehst du${drawn ? '' : ' nach der Auslosung'}, wen du beschenkst:\n${link}`;
    actions = `<span class="row-actions">
      ${link ? `<button class="link-btn" data-act="copy" data-text="${esc(link)}">Link kopieren</button><a class="link-btn" href="${esc(waLink(text))}" target="_blank" rel="noopener">Per WhatsApp</a>` : ''}
      ${own ? '' : `<button class="link-btn" data-act="ask-relink" data-mid="${id}">Neuer Link</button>`}
      ${drawn ? '' : `<button class="link-btn" data-act="ask-remove" data-mid="${id}" aria-label="${esc(m.name)} entfernen">Entfernen</button>`}
    </span>`;
  }
  const confirm = S.confirm === `relink:${id}` ? `
    <div class="behalf">
      <p>Neuen persönlichen Link für <strong>${esc(m.name)}</strong> erstellen? Der alte Link funktioniert danach nicht mehr. Weil der neue Link bei dir entsteht, könntest du damit auch das Los von ${esc(m.name)} sehen.</p>
      ${drawn ? `<p class="warn-line">Die Lose sind schon gezogen. Das Los von ${esc(m.name)} lässt sich mit dem neuen Link erst nach einer <strong>neuen Auslosung</strong> öffnen. Dabei bekommen alle eine neue Person. Erstelle zuerst alle nötigen neuen Links und lose dann einmal neu aus.</p>` : ''}
      <div class="actions"><button class="btn primary" data-act="relink" data-mid="${id}">Neuen Link erstellen</button><button class="btn ghost" data-act="cancel">Abbrechen</button></div>
    </div>` : '';
  return `<li><span class="who">${esc(m.name)}${own ? ' <small>(du)</small>' : ''}</span><span class="mail">${esc(m.email || 'ohne E-Mail')}${m.relinkedAt && g.drawnAt && m.relinkedAt > g.drawnAt ? ' · <strong class="warn-text">neuer Link, braucht neue Auslosung</strong>' : ''}</span>${actions}${confirm}</li>`;
}

function adminHtml(g, members, drawn, match) {
  const invite = g.shortLink || groupLink(S.gid);
  const inviteText = `🎁 Wichteln: ${g.name}\n${g.date ? `Bescherung: ${fmtDate(g.date)}\n` : ''}${g.budget ? `Budget: CHF ${g.budget}\n` : ''}\nMelde dich hier mit deiner E-Mail an. Nach der Auslosung siehst du, wen du beschenkst:\n${invite}`;
  const doneText = `🎁 ${g.name}: Die Lose sind gezogen!\nÖffne diese Seite auf dem Handy, mit dem du dich angemeldet hast, oder deinen persönlichen Link${LINK_FROM}:\n${invite}`;
  const name = (id) => esc(g.members[id]?.name ?? '?');
  const excl = (g.exclusions || []).filter(([a, b]) => g.members[a] && g.members[b]);
  const opts = members.map(([id, m]) => `<option value="${id}">${esc(m.name)}</option>`).join('');
  const emails = members.map(([, m]) => m.email).filter(Boolean);
  const confirmDraw = S.confirm === 'redraw';
  const missing = (g.guests || []).filter((gu) => !match[gu.id]);
  let n = 0;
  const step = (t) => `${++n} · ${t}`;
  return `
    <section class="card admin">
      <p class="eyebrow">Nur für dich sichtbar</p>
      <h2>Organisation</h2>

      <h3>${step('Einladen')}</h3>
      <div class="linkbox"><input id="inv-link" readonly value="${esc(invite)}"><button class="btn" data-act="copy" data-text="${esc(invite)}">Kopieren</button></div>
      <div class="actions"><a class="btn wa" href="${esc(waLink(inviteText))}" target="_blank" rel="noopener">Per WhatsApp teilen</a></div>
      <details id="d-short" class="fold">
        <summary>Kurzen Link verwenden (Bitly)</summary>
        <p class="sub">Erstelle auf <a href="https://bitly.com/" target="_blank" rel="noopener">bitly.com</a> einen kostenlosen Kurzlink für <span class="mono">${esc(groupLink(S.gid))}</span> und füge ihn hier ein. WhatsApp-Nachrichten verwenden dann den Kurzlink.</p>
        <form data-form="short" class="inline">
          <input id="s-link" name="short" type="url" placeholder="https://bit.ly/wichteln-moser" value="${esc(g.shortLink || '')}">
          <button class="btn" type="submit">Speichern</button>
        </form>
      </details>

      <h3>${step('Gästeliste')} ${(g.guests || []).length ? `<span class="count">${(g.guests || []).length - missing.length}/${(g.guests || []).length}</span>` : '<span class="opt">optional</span>'}</h3>
      ${guestsAdminHtml(g, drawn, match, invite)}

      <h3>${step('Teilnehmende')} <span class="count">${members.length}</span></h3>
      ${members.length ? `<p class="sub">Hat jemand den persönlichen Link verloren? Mit <em>Neuer Link</em> erstellst du einen neuen und schickst ihn weiter.</p>
      <ul class="roster">${members.map(([id, m]) => participantRow(g, id, m, drawn)).join('')}</ul>`
        : '<p class="muted">Noch niemand. Teile den Einladungslink.</p>'}

      ${members.length >= 2 && !drawn ? `
      <h3>${step('Ausschlüsse')} <span class="opt">optional</span></h3>
      <p class="sub">Paare, die sich nicht gegenseitig ziehen sollen, zum Beispiel Ehepaare.</p>
      <form data-form="excl" class="inline excl">
        <select id="x-a" name="a" aria-label="Person A">${opts}</select>
        <span aria-hidden="true">↔</span>
        <select id="x-b" name="b" aria-label="Person B">${opts}</select>
        <button class="btn" type="submit">Hinzufügen</button>
      </form>` : ''}
      ${excl.length ? `<ul class="chips">${excl.map(([a, b], i) => `<li>${name(a)} ↔ ${name(b)}${drawn ? '' : ` <button class="link-btn" data-act="del-excl" data-i="${i}" aria-label="Ausschluss entfernen">✕</button>`}</li>`).join('')}</ul>` : ''}

      <h3>${step('Auslosen')}</h3>
      ${drawn ? `
        <p class="ok-line">Ausgelost am ${new Date(g.drawnAt).toLocaleString('de-CH', { dateStyle: 'medium', timeStyle: 'short' })}. Alle können jetzt ihr Los öffnen.</p>
        ${members.some(([, m]) => m.relinkedAt > g.drawnAt) ? `<p class="warn-line">Neue Links für ${members.filter(([, m]) => m.relinkedAt > g.drawnAt).map(([, m]) => esc(m.name)).join(', ')}. Diese Lose öffnen sich erst nach einer neuen Auslosung. Tippe unten auf <em>Neu auslosen</em>, sobald alle neuen Links erstellt sind.</p>` : ''}
        <div class="actions">
          <a class="btn wa" href="${esc(waLink(doneText))}" target="_blank" rel="noopener">Per WhatsApp Bescheid geben</a>
          ${emailjsConfig
            ? `<button class="btn" data-act="notify">Alle per E-Mail informieren</button>`
            : `<a class="btn" href="${esc(mailLink({ bcc: emails.join(','), subject: `🎁 ${g.name}: Die Lose sind gezogen`, body: doneText }))}">Alle per E-Mail informieren</a>`}
        </div>
        ${confirmDraw
          ? `<div class="confirm-box"><p>Neu auslosen macht alle bisherigen Lose ungültig. Wer schon nachgeschaut hat, bekommt eine neue Person.</p><div class="actions"><button class="btn danger" data-act="draw">Ja, neu auslosen</button><button class="btn ghost" data-act="cancel">Abbrechen</button></div></div>`
          : `<button class="link-btn" data-act="ask-redraw">Neu auslosen (z. B. weil jemand dazugekommen ist)</button>`}
        <button class="link-btn" data-act="reopen">Anmeldung wieder öffnen</button>`
      : `
        <p class="sub">${members.length < 3 ? `Es braucht mindestens 3 Personen. Noch ${3 - members.length}.` : 'Danach ist keine Anmeldung mehr möglich. Die Zuteilung ist für jede Person einzeln verschlüsselt.'}</p>
        ${S.confirm === 'draw-missing'
          ? `<div class="confirm-box"><p>Noch nicht angemeldet: <strong>${missing.map((gu) => esc(gu.name)).join(', ')}</strong>. Wer jetzt fehlt, bekommt kein Los. Später dazunehmen geht nur mit einer neuen Auslosung für alle.</p><div class="actions"><button class="btn danger" data-act="draw">Trotzdem auslosen</button><button class="btn ghost" data-act="cancel">Abbrechen</button></div></div>`
          : `<button class="btn primary" data-act="${missing.length ? 'ask-draw' : 'draw'}" ${members.length < 3 ? 'disabled' : ''}>Lose ziehen</button>`}`}

      <details id="d-admin" class="fold">
        <summary>Mein Admin-Link</summary>
        <p class="sub">Damit verwaltest du die Runde auch auf einem anderen Gerät. Nicht weitergeben.</p>
        <div class="linkbox"><input id="adm-link" readonly value="${esc(adminLink(S.gid, S.adminKey))}"><button class="btn" data-act="copy" data-text="${esc(adminLink(S.gid, S.adminKey))}">Kopieren</button></div>
      </details>
    </section>`;
}

// ── Aktionen ────────────────────────────────────────────────────────────────
async function join(form) {
  const f = form.elements;
  const pick = f.guest?.value;
  let name = f.who.value.trim();
  let guestId = null;
  if (f.guest && !pick) return toast('Bitte wähle deinen Namen aus der Liste.', 'err');
  if (pick && pick !== 'other') {
    const gu = (S.g.guests || []).find((x) => x.id === pick);
    if (!gu || guestMatches(S.g)[gu.id]) return toast('Diese Person ist schon angemeldet.', 'err');
    name = gu.name;
    guestId = gu.id;
  }
  const email = f.email.value.trim().toLowerCase();
  const wish = f.wish.value.trim();
  if (!name) return toast('Bitte gib deinen Namen ein.', 'err');
  if (!isEmail(email)) return toast('Diese E-Mail-Adresse sieht nicht richtig aus.', 'err');
  if (S.g.drawnAt) return toast('Die Lose sind schon gezogen.', 'err');
  if (Object.values(S.g.members).some((m) => m.email === email))
    return toast(`Diese E-Mail ist schon angemeldet. Öffne deinen persönlichen Link${LINK_FROM}.`, 'err');
  form.querySelector('button[type=submit]').disabled = true;
  const { pub, secret } = await newKeyPair();
  const mid = rand(10);
  try {
    await store.update(S.gid, { [`members.${mid}`]: { name, email, wish, pub, joinedAt: Date.now(), guestId } });
  } catch (e) {
    form.querySelector('button[type=submit]').disabled = false;
    return toast(`Anmeldung fehlgeschlagen: ${e.message}`, 'err');
  }
  S.me = { mid, d: secret };
  S.justJoined = true;
  ls.set(`wichtel:me:${S.gid}`, S.me);
  rememberGroup(S.gid, S.g.name);
  renderGroup();
  const link = personalLink(S.gid, S.me);
  const sent = await sendMail(email, name, `Du bist dabei: ${S.g.name}`,
    `Hallo ${name}\n\nDu bist für „${S.g.name}“ angemeldet.${S.g.date ? `\nBescherung: ${fmtDate(S.g.date)}` : ''}${S.g.budget ? `\nBudget: CHF ${S.g.budget}` : ''}\n\nDein persönlicher Link (nicht weitergeben). Nach der Auslosung siehst du dort, wen du beschenkst:\n${link}`);
  toast(sent ? 'Angemeldet. Dein persönlicher Link ist unterwegs in dein Postfach.' : 'Angemeldet. Speichere jetzt deinen persönlichen Link.');
  document.querySelector('.keep')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function draw() {
  const g = S.g;
  const ids = Object.keys(g.members);
  if (ids.length < 3) return toast('Es braucht mindestens 3 Personen.', 'err');
  const map = derange(ids, g.exclusions || []);
  if (!map) return toast('Mit diesen Ausschlüssen geht keine Auslosung auf. Entferne einen Ausschluss.', 'err');
  const results = {};
  for (const giver of ids) results[giver] = await sealFor(g.members[giver].pub, map[giver]);
  S.confirm = null;
  await store.update(S.gid, { results, drawnAt: Date.now() });
  toast('Die Lose sind gezogen.');
}

async function notifyAll() {
  const g = S.g;
  const invite = g.shortLink || groupLink(S.gid);
  let ok = 0;
  const all = Object.values(g.members).filter((m) => m.email);
  for (const m of all) {
    if (await sendMail(m.email, m.name, `🎁 ${g.name}: Die Lose sind gezogen`,
      `Hallo ${m.name}\n\nDie Lose für „${g.name}“ sind gezogen. Öffne deinen persönlichen Link aus der Anmelde-Mail, um zu sehen, wen du beschenkst. Auf dem Gerät, mit dem du dich angemeldet hast, geht auch dieser Link:\n${invite}`)) ok++;
  }
  toast(`${ok} von ${all.length} E-Mails verschickt.`, ok === all.length ? 'ok' : 'err');
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Kopiert.'); }
  catch { toast('Kopieren nicht möglich. Bitte den Link markieren und kopieren.', 'err'); }
}

const actions = {
  copy: (el) => copy(el.dataset.text),
  reveal: () => { ls.set(`wichtel:seen:${S.gid}:${S.plainCt}`, true); renderGroup(); },
  logout: () => { ls.del(`wichtel:me:${S.gid}`); S.me = null; S.justJoined = false; renderGroup(); },
  'dismiss-fresh': () => { S.fresh = false; renderGroup(); },
  'ask-remove': (el) => { S.confirm = `rm:${el.dataset.mid}`; renderGroup(); },
  'ask-relink': (el) => { S.confirm = `relink:${el.dataset.mid}`; renderGroup(); },
  relink: async (el) => {
    const mid = el.dataset.mid;
    const m = S.g.members[mid];
    const { pub, secret } = await newKeyPair();
    const proxies = ls.get(`wichtel:proxy:${S.gid}`, {});
    proxies[mid] = secret;
    ls.set(`wichtel:proxy:${S.gid}`, proxies);
    S.confirm = null;
    await store.update(S.gid, { [`members.${mid}.pub`]: pub, [`members.${mid}.relinkedAt`]: Date.now() });
    const link = personalLink(S.gid, { mid, d: secret });
    const sent = m.email && await sendMail(m.email, m.name, `Dein neuer Wichtel-Link: ${S.g.name}`,
      `Hallo ${m.name}\n\nHier ist dein neuer persönlicher Link für „${S.g.name}“ (nicht weitergeben):\n${link}`);
    toast(sent ? `Neuer Link für ${m.name} ist per E-Mail unterwegs.` : `Neuer Link für ${m.name} erstellt. Schick ihn per WhatsApp oder kopiere ihn.`);
  },
  'ask-redraw': () => { S.confirm = 'redraw'; renderGroup(); },
  'ask-draw': () => { S.confirm = 'draw-missing'; renderGroup(); },
  'ask-behalf': (el) => { S.confirm = `behalf:${el.dataset.guest}`; renderGroup(); document.getElementById('b-email')?.focus(); },
  'del-guest': async (el) => {
    await store.update(S.gid, { guests: (S.g.guests || []).filter((gu) => gu.id !== el.dataset.guest) });
  },
  cancel: () => { S.confirm = null; renderGroup(); },
  remove: async (el) => {
    const mid = el.dataset.mid;
    S.confirm = null;
    await store.update(S.gid, {
      [`members.${mid}`]: store.DEL,
      exclusions: (S.g.exclusions || []).filter((p) => !p.includes(mid)),
    });
    toast('Entfernt.');
  },
  'del-excl': async (el) => {
    const list = (S.g.exclusions || []).filter(([a, b]) => S.g.members[a] && S.g.members[b]);
    list.splice(Number(el.dataset.i), 1);
    await store.update(S.gid, { exclusions: list });
  },
  draw: () => draw(),
  notify: () => notifyAll(),
  reopen: async () => { await store.update(S.gid, { drawnAt: null, results: {} }); toast('Anmeldung ist wieder offen. Lose später neu ziehen.'); },
};

const forms = {
  create: createGroup,
  join,
  wish: async (form) => {
    await store.update(S.gid, { [`members.${S.me.mid}.wish`]: form.elements.wish.value.trim() });
    toast('Wunschzettel gespeichert.');
  },
  short: async (form) => {
    const v = form.elements.short.value.trim();
    if (v && !/^https?:\/\//.test(v)) return toast('Bitte den ganzen Link mit https:// einfügen.', 'err');
    await store.update(S.gid, { shortLink: v });
    toast(v ? 'Kurzlink gespeichert.' : 'Kurzlink entfernt.');
  },
  guests: async (form) => {
    const list = S.g.guests || [];
    const have = new Set(list.map((gu) => gu.name.toLowerCase()));
    const add = [];
    for (const raw of form.elements.names.value.split(/[\n,;]+/)) {
      const name = raw.trim().slice(0, 40);
      if (!name || have.has(name.toLowerCase())) continue;
      have.add(name.toLowerCase());
      add.push({ id: rand(6), name });
    }
    if (!add.length) return toast('Keine neuen Namen gefunden.', 'err');
    if (list.length + add.length > 100) return toast('Die Gästeliste kann höchstens 100 Namen haben.', 'err');
    await store.update(S.gid, { guests: [...list, ...add] });
    document.getElementById('g-names').value = '';
    toast(`${add.length} ${add.length === 1 ? 'Name' : 'Namen'} hinzugefügt.`);
  },
  behalf: async (form) => {
    const gu = (S.g.guests || []).find((x) => x.id === form.dataset.guest);
    if (!gu || guestMatches(S.g)[gu.id]) return toast('Diese Person ist schon angemeldet.', 'err');
    if (S.g.drawnAt) return toast('Die Lose sind schon gezogen.', 'err');
    const email = form.elements.email.value.trim().toLowerCase();
    if (email && !isEmail(email)) return toast('Diese E-Mail-Adresse sieht nicht richtig aus.', 'err');
    if (email && Object.values(S.g.members).some((m) => m.email === email)) return toast('Diese E-Mail ist schon angemeldet.', 'err');
    const { pub, secret } = await newKeyPair();
    const mid = rand(10);
    // Den geheimen Schlüssel behält dein Browser, damit du den Link weitergeben kannst
    const proxies = ls.get(`wichtel:proxy:${S.gid}`, {});
    proxies[mid] = secret;
    ls.set(`wichtel:proxy:${S.gid}`, proxies);
    S.confirm = null;
    await store.update(S.gid, {
      [`members.${mid}`]: { name: gu.name, email, wish: form.elements.wish.value.trim(), pub, joinedAt: Date.now(), guestId: gu.id, byAdmin: true },
    });
    const sent = email && await sendMail(email, gu.name, `Du bist dabei: ${S.g.name}`,
      `Hallo ${gu.name}\n\nDu wurdest für „${S.g.name}“ angemeldet.${S.g.date ? `\nBescherung: ${fmtDate(S.g.date)}` : ''}${S.g.budget ? `\nBudget: CHF ${S.g.budget}` : ''}\n\nDein persönlicher Link (nicht weitergeben). Nach der Auslosung siehst du dort, wen du beschenkst:\n${personalLink(S.gid, { mid, d: secret })}`);
    toast(sent ? `${gu.name} ist angemeldet und hat den Link per E-Mail bekommen.` : `${gu.name} ist angemeldet. Gib den persönlichen Link weiter.`);
  },
  excl: async (form) => {
    const a = form.elements.a.value, b = form.elements.b.value;
    if (a === b) return toast('Bitte zwei verschiedene Personen wählen.', 'err');
    const list = S.g.exclusions || [];
    if (list.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) return toast('Diesen Ausschluss gibt es schon.', 'err');
    await store.update(S.gid, { exclusions: [...list, [a, b]] });
  },
};

app.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  e.preventDefault();
  try { await actions[el.dataset.act]?.(el); } catch (err) { toast(`Das hat nicht geklappt: ${err.message}`, 'err'); }
});
app.addEventListener('change', (e) => { if (e.target.id === 'j-guest') syncJoin(); });
app.addEventListener('submit', async (e) => {
  e.preventDefault();
  try { await forms[e.target.dataset.form]?.(e.target); } catch (err) { toast(`Das hat nicht geklappt: ${err.message}`, 'err'); }
});

// ── Start ───────────────────────────────────────────────────────────────────
const gid = new URLSearchParams(location.search).get('g');
if (!gid) renderHome();
else initGroup(gid);
// Persönlicher Link in einem schon offenen Tab geöffnet → neu laden, damit er übernommen wird
window.addEventListener('hashchange', () => location.hash && location.reload());
