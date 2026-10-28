const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const KEY = 'medtracker.v2';
const ICONS = ['💊','💧','🍯','💉','🧴','👁️','🫁','🩹'];
const SIZES = [16, 18, 21, 24];
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const DAY_SHORT = ['S','M','T','W','T','F','S'];

// Migrate from v1 if needed
let db;
const raw = localStorage.getItem(KEY) || localStorage.getItem('medtracker.v1');
db = JSON.parse(raw || '{"meds":[],"log":{},"size":1}');
// Ensure every med has new fields
db.meds.forEach(m => {
  if (!m.freq) m.freq = 'daily';
  if (!m.days) m.days = [];
  if (m.refillTotal == null) m.refillTotal = 0;
  if (m.refillLeft == null) m.refillLeft = 0;
});

let icon = ICONS[0];
let freq = 'daily';
let selectedDays = [];
let selectedDates = [];
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();
const alerted = new Set();

const save = () => localStorage.setItem(KEY, JSON.stringify(db));
const today = () => new Date().toLocaleDateString('en-CA');
const nowHM = () => new Date().toTimeString().slice(0, 5);
const ds = d => d.toLocaleDateString('en-CA');
const fmt = t => { const [h, m] = t.split(':'); return `${+h % 12 || 12}:${m} ${+h < 12 ? 'AM' : 'PM'}`; };
const esc = s => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isTaken = id => !!(db.log[today()] || {})[id];
const ordinal = n => { const s=['th','st','nd','rd'],v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]); };

/* ── Scheduling helpers ────────────────────── */
function isScheduledOn(med, date) {
  const f = med.freq || 'daily';
  if (f === 'daily') return true;
  if (f === 'weekly') return (med.days || []).includes(date.getDay());
  if (f === 'monthly') return (med.days || []).includes(date.getDate());
  return true;
}

function getScheduledMeds(date) {
  return db.meds.filter(m => isScheduledOn(m, date));
}

function todayMeds() {
  return getScheduledMeds(new Date());
}

/* ── Stats helpers ─────────────────────────── */
function isDayCompleteFor(dateStr, dateObj) {
  const scheduled = getScheduledMeds(dateObj);
  if (scheduled.length === 0) return null;
  const log = db.log[dateStr] || {};
  return scheduled.every(m => !!log[m.id]);
}

function getDayStatus(dateStr, dateObj) {
  const scheduled = getScheduledMeds(dateObj);
  if (scheduled.length === 0) return 'none';
  const log = db.log[dateStr] || {};
  const taken = scheduled.filter(m => !!log[m.id]).length;
  if (taken === scheduled.length) return 'complete';
  if (taken > 0) return 'partial';
  return 'missed';
}

function computeStats() {
  const now = new Date();
  const todayStr = today();
  const scheduled = todayMeds();
  const todayDone = scheduled.filter(m => isTaken(m.id)).length;
  const todayTotal = scheduled.length;
  const allDoneToday = todayTotal > 0 && todayDone >= todayTotal;

  // This week (Mon → today)
  const dow = now.getDay();
  const monOffset = dow === 0 ? 6 : dow - 1;
  let weekComplete = 0;
  const weekDays = monOffset + 1;
  for (let i = 0; i < weekDays; i++) {
    const d = new Date(now); d.setDate(now.getDate() - monOffset + i);
    const dStr = ds(d);
    const complete = dStr === todayStr ? allDoneToday : isDayCompleteFor(dStr, d) === true;
    if (complete) weekComplete++;
  }

  // This month (1st → today)
  const monthDays = now.getDate();
  let monthComplete = 0;
  for (let i = 1; i <= monthDays; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), i);
    const dStr = ds(d);
    const complete = dStr === todayStr ? allDoneToday : isDayCompleteFor(dStr, d) === true;
    if (complete) monthComplete++;
  }

  // Streak
  let streak = 0;
  const c = new Date(now);
  if (allDoneToday) { streak = 1; c.setDate(c.getDate() - 1); }
  else { c.setDate(c.getDate() - 1); }
  while (true) {
    const r = isDayCompleteFor(ds(c), c);
    if (r === true) { streak++; c.setDate(c.getDate() - 1); }
    else break;
  }

  // Best streak (90 days)
  let bestStreak = 0, run = 0;
  for (let i = 90; i >= 0; i--) {
    const d = new Date(now); d.setDate(now.getDate() - i);
    const dStr = ds(d);
    const complete = dStr === todayStr ? allDoneToday : isDayCompleteFor(dStr, d) === true;
    if (complete) { run++; if (run > bestStreak) bestStreak = run; }
    else run = 0;
  }

  // Adherence (30 days)
  let adhComplete = 0, adhDays = 0;
  for (let i = 0; i < 30; i++) {
    const d = new Date(now); d.setDate(now.getDate() - i);
    const dStr = ds(d);
    const scheduled = getScheduledMeds(d);
    if (scheduled.length === 0) continue;
    adhDays++;
    const complete = dStr === todayStr ? allDoneToday : isDayCompleteFor(dStr, d) === true;
    if (complete) adhComplete++;
  }
  const adherence = adhDays ? Math.round((adhComplete / adhDays) * 100) : 0;

  return { todayDone, todayTotal, allDoneToday, weekComplete, weekDays, monthComplete, monthDays, streak, bestStreak, adherence };
}

/* ── Speech ────────────────────────────────── */
function speak(text) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.85;
  speechSynthesis.speak(u);
}

/* ── Calendar ──────────────────────────────── */
function renderCalendar() {
  const first = new Date(calYear, calMonth, 1);
  const last = new Date(calYear, calMonth + 1, 0);
  const startDow = first.getDay();
  const daysInMonth = last.getDate();
  const todayStr = today();
  const nowObj = new Date();

  let h = `<div class="cal-header">
    <button type="button" id="calPrev" class="cal-nav">‹</button>
    <span class="cal-title">${first.toLocaleDateString(undefined,{month:'long',year:'numeric'})}</span>
    <button type="button" id="calNext" class="cal-nav">›</button>
  </div><div class="cal-grid">`;

  DAY_SHORT.forEach(d => { h += `<div class="cal-day-header">${d}</div>`; });
  for (let i = 0; i < startDow; i++) h += `<div class="cal-cell empty"></div>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(calYear, calMonth, d);
    const dStr = ds(dateObj);
    const isToday = dStr === todayStr;
    const isFuture = dateObj > nowObj && !isToday;

    let status;
    if (isFuture) status = 'future';
    else if (isToday) status = getDayStatus(dStr, dateObj) === 'complete' ? 'complete' : getDayStatus(dStr, dateObj);
    else status = getDayStatus(dStr, dateObj);

    h += `<div class="cal-cell ${status} ${isToday ? 'is-today' : ''}">${d}</div>`;
  }
  h += '</div>';
  return h;
}

/* ── Frequency label for cards ─────────────── */
function freqLabel(med) {
  if (med.freq === 'weekly') {
    const names = (med.days || []).map(d => DAY_NAMES[d]).join(', ');
    return names || 'Weekly';
  }
  if (med.freq === 'monthly') {
    const dates = (med.days || []).map(d => ordinal(d)).join(', ');
    return dates || 'Monthly';
  }
  return 'Every day';
}

/* ── Render ─────────────────────────────────── */
function render() {
  document.documentElement.style.fontSize = SIZES[db.size] + 'px';
  const h = new Date().getHours();
  $('#greeting').textContent = (h < 12 ? 'Good morning ☀️' : h < 17 ? 'Good afternoon 🌤️' : 'Good evening 🌙');
  $('#date').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  const meds = todayMeds().sort((a, b) => a.time.localeCompare(b.time));
  const done = meds.filter(m => isTaken(m.id)).length;
  const total = meds.length;
  $('#ring').style.strokeDashoffset = 326.7 * (1 - (total ? done / total : 0));
  $('#ringText').textContent = `${done}/${total}`;
  $('#summary').textContent = !db.meds.length ? 'No medicines yet' : !total ? 'No medicines today' : done === total ? 'All done! Great job! 🌟' : `${total - done} left to take today`;
  $('#sub').textContent = !db.meds.length ? 'Tap the button below' : !total ? 'Nothing scheduled for today 🎉' : done === total ? 'See you tomorrow' : 'Tap "I took it" after each one';

  /* Stats */
  const stats = computeStats();
  if (db.meds.length > 0) {
    $('#statsCards').classList.remove('hidden');
    $('#dayVal').textContent = `${stats.todayDone}/${stats.todayTotal}`;
    $('#weekVal').textContent = `${stats.weekComplete}/${stats.weekDays}`;
    $('#monthVal').textContent = `${stats.monthComplete}/${stats.monthDays}`;
  } else {
    $('#statsCards').classList.add('hidden');
  }

  /* Calendar */
  if (db.meds.length > 0) {
    $('#calSection').classList.remove('hidden');
    $('#calContent').innerHTML = renderCalendar();
  } else {
    $('#calSection').classList.add('hidden');
  }

  /* Efficiency */
  if (stats.allDoneToday) {
    $('#efficiency').classList.remove('hidden');
    $('#efficiency').classList.add('pop');
    $('#effRate').textContent = stats.adherence + '%';
    $('#effStreak').textContent = stats.streak;
    $('#effBest').textContent = stats.bestStreak;
    $('#effFill').style.width = stats.adherence + '%';
    let msg;
    if (stats.adherence >= 90) msg = 'Outstanding! You\'re a medicine champion! 🏆';
    else if (stats.adherence >= 70) msg = 'Great consistency! Keep it going! 💪';
    else if (stats.adherence >= 50) msg = 'Good progress! Building a healthy habit! 🌱';
    else msg = 'Every dose counts. Let\'s build that streak! 🚀';
    $('#effMsg').textContent = msg;
  } else {
    $('#efficiency').classList.add('hidden');
  }

  /* Medicine list */
  if (!db.meds.length) {
    $('#list').innerHTML = `<div class="rounded-[2rem] bg-white p-8 text-center text-xl font-bold shadow-soft"><div class="text-6xl mb-3">💊</div>Add your first medicine to begin.</div>`;
  } else if (!total) {
    $('#list').innerHTML = `<div class="rounded-[2rem] bg-white p-8 text-center text-xl font-bold shadow-soft"><div class="text-6xl mb-3">🎉</div>No medicines scheduled for today!<br><span class="text-base opacity-70">You have ${db.meds.length} medicine${db.meds.length > 1 ? 's' : ''} on other days.</span></div>`;
  } else {
    $('#list').innerHTML = meds.map(m => {
      const taken = isTaken(m.id);
      const due = !taken && m.time <= nowHM();
      const hasRefill = m.refillTotal > 0;
      const lowRefill = hasRefill && m.refillLeft <= Math.max(5, Math.round(m.refillTotal * 0.15));
      const pct = hasRefill ? Math.round((m.refillLeft / m.refillTotal) * 100) : 0;

      let refillHtml = '';
      if (hasRefill) {
        refillHtml = `<div class="refill-info">
          <span>${lowRefill ? '⚠️' : '💊'} ${m.refillLeft} left</span>
          <div class="refill-bar"><div class="refill-fill ${lowRefill ? 'low' : ''}" style="width:${pct}%"></div></div>
        </div>`;
      }

      return `<article class="card ${taken ? 'done' : due ? 'due' : ''} ${lowRefill && !taken ? 'refill-low' : ''}" data-id="${m.id}">
        <div class="flex items-center gap-4">
          <div class="text-5xl">${m.icon}</div>
          <div class="min-w-0 flex-1">
            <h3 class="text-2xl font-extrabold break-words">${esc(m.name)}</h3>
            <p class="text-lg font-bold opacity-80">${m.dose ? esc(m.dose) + ' · ' : ''}${fmt(m.time)}</p>
            <span class="freq-badge">${freqLabel(m)}</span>
            <p class="font-extrabold ${taken ? 'text-teal-dark' : due ? 'text-amber-700' : 'opacity-60'}">${taken ? '✔ Taken' : due ? '⏰ Time to take it' : 'Later today'}</p>
            ${refillHtml}
          </div>
        </div>
        <div class="mt-3 flex gap-2">
          <button class="take" data-act="take">${taken ? 'Undo' : '✔ I took it'}</button>
          ${hasRefill ? `<button class="mini refill-btn" data-act="refill" aria-label="Refill ${esc(m.name)}">🔄</button>` : ''}
          <button class="mini" data-act="speak" aria-label="Read aloud">🔊</button>
          <button class="mini" data-act="del" aria-label="Delete ${esc(m.name)}">🗑️</button>
        </div>
      </article>`;
    }).join('');
  }
}

/* ── Card actions ──────────────────────────── */
$('#list').addEventListener('click', e => {
  const btn = e.target.closest('button'); if (!btn) return;
  const card = btn.closest('.card'); if (!card) return;
  const id = card.dataset.id;
  const m = db.meds.find(x => x.id === id);
  if (!m) return;

  if (btn.dataset.act === 'take') {
    const day = db.log[today()] = db.log[today()] || {};
    const wasTaken = !!day[id];
    day[id] = !day[id]; 
    // Refill tracking
    if (m.refillTotal > 0) {
      if (day[id] && !wasTaken) m.refillLeft = Math.max(0, m.refillLeft - 1);
      else if (!day[id] && wasTaken) m.refillLeft = Math.min(m.refillTotal, m.refillLeft + 1);
    }
    save(); render();
    if (day[id]) {
      const left = todayMeds().filter(x => !isTaken(x.id)).length;
      speak(left ? 'Well done!' : 'All done for today. Great job!');
    }
  } else if (btn.dataset.act === 'speak') {
    speak(`Take ${m.name}${m.dose ? ', ' + m.dose : ''}, at ${fmt(m.time)}.`);
  } else if (btn.dataset.act === 'del') {
    if (confirm(`Remove ${m.name}?`)) { db.meds = db.meds.filter(x => x.id !== id); save(); render(); }
  } else if (btn.dataset.act === 'refill') {
    openRefillDialog(m);
  }
});

/* ── Calendar navigation ───────────────────── */
$('#calContent').addEventListener('click', e => {
  const btn = e.target.closest('#calPrev, #calNext');
  if (!btn) return;
  if (btn.id === 'calPrev') { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } }
  else { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } }
  $('#calContent').innerHTML = renderCalendar();
});

/* ── Refill dialog ─────────────────────────── */
let refillMedId = null;
function openRefillDialog(med) {
  refillMedId = med.id;
  $('#refillName').textContent = `${med.icon} ${med.name}  —  currently ${med.refillLeft} of ${med.refillTotal} left`;
  $('#refillCount').value = med.refillTotal;
  $('#refillDlg').showModal();
}
$('#refillCancel').onclick = () => $('#refillDlg').close();
$('#refillForm').addEventListener('submit', () => {
  const m = db.meds.find(x => x.id === refillMedId);
  if (m) {
    const count = parseInt($('#refillCount').value) || m.refillTotal;
    m.refillLeft = count;
    m.refillTotal = Math.max(m.refillTotal, count);
    save(); render();
    speak(`${m.name} refilled to ${count} pills.`);
  }
});

/* ── Add dialog ────────────────────────────── */
const dlg = $('#dlg');

function drawIcons() {
  $('#icons').innerHTML = ICONS.map(i => `<button type="button" class="icon-opt" aria-pressed="${i === icon}" data-i="${i}">${i}</button>`).join('');
}
$('#icons').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { icon = b.dataset.i; drawIcons(); } });

// Frequency picker
$('#freqPicker').addEventListener('click', e => {
  const b = e.target.closest('.freq-opt'); if (!b) return;
  freq = b.dataset.freq;
  $$('.freq-opt').forEach(x => x.setAttribute('aria-pressed', x.dataset.freq === freq));
  $('#weekPicker').classList.toggle('hidden', freq !== 'weekly');
  $('#monthPicker').classList.toggle('hidden', freq !== 'monthly');
});

// Weekly day picker
$('#weekPicker').addEventListener('click', e => {
  const b = e.target.closest('.day-opt'); if (!b) return;
  const d = parseInt(b.dataset.d);
  const idx = selectedDays.indexOf(d);
  if (idx >= 0) selectedDays.splice(idx, 1); else selectedDays.push(d);
  b.setAttribute('aria-pressed', idx < 0);
});

// Monthly date picker - generate buttons
function drawMonthDates() {
  let h = '';
  for (let i = 1; i <= 31; i++) {
    h += `<button type="button" class="date-opt" data-d="${i}" aria-pressed="${selectedDates.includes(i)}">${i}</button>`;
  }
  $('#monthDates').innerHTML = h;
}
$('#monthDates').addEventListener('click', e => {
  const b = e.target.closest('.date-opt'); if (!b) return;
  const d = parseInt(b.dataset.d);
  const idx = selectedDates.indexOf(d);
  if (idx >= 0) selectedDates.splice(idx, 1); else selectedDates.push(d);
  b.setAttribute('aria-pressed', idx < 0);
});

// Open add dialog
$('#add').onclick = () => {
  $('#dlgTitle').textContent = 'New medicine';
  $('#form').reset();
  $('#time').value = '08:00';
  icon = ICONS[0];
  freq = 'daily';
  selectedDays = [];
  selectedDates = [];
  $$('.freq-opt').forEach(x => x.setAttribute('aria-pressed', x.dataset.freq === 'daily'));
  $$('.day-opt').forEach(x => x.setAttribute('aria-pressed', 'false'));
  $('#weekPicker').classList.add('hidden');
  $('#monthPicker').classList.add('hidden');
  drawMonthDates();
  drawIcons();
  dlg.showModal();
  $('#name').focus();
};

$('#cancel').onclick = () => dlg.close();

$('#form').addEventListener('submit', () => {
  const refTotal = parseInt($('#refillTotal').value) || 0;
  const refLeft = parseInt($('#refillLeft').value) || refTotal;
  const days = freq === 'weekly' ? [...selectedDays] : freq === 'monthly' ? [...selectedDates] : [];

  db.meds.push({
    id: crypto.randomUUID(),
    name: $('#name').value.trim(),
    dose: $('#dose').value.trim(),
    time: $('#time').value,
    icon,
    freq,
    days,
    refillTotal: refTotal,
    refillLeft: Math.min(refLeft, refTotal || refLeft)
  });
  save(); render();
});

/* ── Text size ─────────────────────────────── */
$('#bigger').onclick = () => { db.size = Math.min(SIZES.length - 1, db.size + 1); save(); render(); };
$('#smaller').onclick = () => { db.size = Math.max(0, db.size - 1); save(); render(); };

/* ── Reminders ─────────────────────────────── */
$('#remind').onclick = async () => {
  if ('Notification' in window) await Notification.requestPermission();
  $('#remind').textContent = '🔔 On';
  speak('Reminders are on.');
};
$('#alertClose').onclick = () => $('#alert').classList.add('hidden');

function checkReminders() {
  const t = nowHM();
  todayMeds().forEach(m => {
    const k = today() + m.id + m.time;
    if (m.time === t && !isTaken(m.id) && !alerted.has(k)) {
      alerted.add(k);
      const msg = `Time to take ${m.name}${m.dose ? ' (' + m.dose + ')' : ''}`;
      $('#alertText').textContent = `${m.icon} ${msg}`;
      $('#alert').classList.remove('hidden');
      speak(msg);
      if ('Notification' in window && Notification.permission === 'granted') new Notification('Medicine time', { body: msg });
      render();
    }
  });
}

setInterval(() => { checkReminders(); render(); }, 30000);
if ('Notification' in window && Notification.permission === 'granted') $('#remind').textContent = '🔔 Reminders on';
render(); checkReminders();
