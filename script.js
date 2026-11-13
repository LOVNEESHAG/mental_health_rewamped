'use strict';

// '' calls the same server that serves this page. For a separate API, use e.g. 'https://your-api.onrender.com'
const API_BASE = 'https://mental-health-rewamped.onrender.com';
const TIMEOUT_MS = 60000;

const $ = (s) => document.querySelector(s);
const form = $('#form'), panel = $('#panel'), ruler = $('#ruler'), go = $('#go');
const scoreEl = $('#score'), bandEl = $('#band'), readingEl = $('#reading');
const extra = $('#extra'), apiErr = $('#apiError'), statusEl = $('#status');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const INTRO = readingEl.textContent;
let busy = false, slowTimer = 0;

const NUM = { // name: [min, max, wholeNumber]
  Age: [10, 100, true], Avg_Daily_Usage_Hours: [0, 24], Daily_Unlocks: [0, 1000, true],
  Study_Hours: [0, 24], Physical_Activity_Hours: [0, 24], Sleep_Hours_Per_Night: [0, 24]
};
const CAT = ['Gender', 'Academic_Level', 'Country', 'Most_Used_Platform', 'Purpose_Of_Use', 'Stress_Level'];
const LBL = {
  Age: 'Age', Gender: 'Gender', Country: 'Country', Academic_Level: 'Academic level',
  Most_Used_Platform: 'Main platform', Purpose_Of_Use: 'Main purpose', Avg_Daily_Usage_Hours: 'Daily use (h)',
  Daily_Unlocks: 'Unlocks per day', Study_Hours: 'Study (h)', Sleep_Hours_Per_Night: 'Sleep (h)',
  Physical_Activity_Hours: 'Activity (h)', Stress_Level: 'Stress'
};

/* ---------- field errors ---------- */
function firstOf(name) {
  const f = form.elements[name];
  return f instanceof RadioNodeList ? f[0] : f;
}
function setErr(name, msg) {
  const first = firstOf(name), box = first.closest('.field');
  let p = box.querySelector('.err');
  if (!msg) { if (p) p.remove(); first.removeAttribute('aria-invalid'); return; }
  if (!p) { p = document.createElement('p'); p.className = 'err'; p.id = 'err-' + name; box.append(p); }
  p.textContent = msg;
  first.setAttribute('aria-invalid', 'true');
  first.setAttribute('aria-describedby', p.id);
}
form.addEventListener('input', (e) => { if (e.target.name) setErr(e.target.name, ''); });

/* ---------- slider and number stay in step ---------- */
form.querySelectorAll('[data-sync]').forEach((r) => {
  const n = form.elements[r.dataset.sync];
  r.addEventListener('input', () => { n.value = r.value; setErr(n.name, ''); });
  n.addEventListener('input', () => {
    const v = parseFloat(n.value);
    if (Number.isFinite(v)) r.value = Math.min(24, Math.max(0, v));
  });
});

/* ---------- validation ---------- */
function collect() {
  const payload = {}; let firstBad = null;
  const bad = (name, msg) => { setErr(name, msg); firstBad = firstBad || firstOf(name); };
  for (const [name, [min, max, whole]] of Object.entries(NUM)) {
    const raw = form.elements[name].value.trim(), v = Number(raw);
    if (raw === '' || !Number.isFinite(v) || v < min || v > max || (whole && !Number.isInteger(v))) {
      bad(name, `Enter ${whole ? 'a whole number' : 'a number'} from ${min} to ${max}.`);
    } else { setErr(name, ''); payload[name] = v; }
  }
  for (const name of CAT) {
    const v = form.elements[name].value;
    if (!v) bad(name, 'Choose an option.'); else { setErr(name, ''); payload[name] = v; }
  }
  if (!firstBad && payload.Study_Hours + payload.Sleep_Hours_Per_Night + payload.Physical_Activity_Hours > 24) {
    bad('Sleep_Hours_Per_Night', 'Study, sleep and activity add up to more than 24 hours a day.');
  }
  if (firstBad) firstBad.focus();
  return firstBad ? null : payload;
}

/* ---------- result panel ---------- */
function setBusy(b) {
  busy = b;
  go.setAttribute('aria-disabled', b);
  go.textContent = b ? 'Calculating' : 'Calculate score';
  panel.setAttribute('aria-busy', b);
  ruler.classList.toggle('sweep', b);
  clearTimeout(slowTimer);
  if (b) {
    ruler.classList.remove('on'); ruler.style.setProperty('--p', 0);
    scoreEl.textContent = '--'; bandEl.textContent = 'Calculating';
    readingEl.textContent = 'Sending your details to the model.';
    extra.hidden = true; apiErr.hidden = true;
    statusEl.textContent = 'Calculating your score.';
    slowTimer = setTimeout(() => { readingEl.textContent = 'Free hosting can take up to a minute to wake up. Still working.'; }, 6000);
  }
}
function count(v) {
  if (reduce) { scoreEl.textContent = v.toFixed(1); return; }
  const t0 = performance.now();
  (function step(t) {
    const k = Math.min(1, (t - t0) / 1100);
    scoreEl.textContent = (v * (1 - Math.pow(1 - k, 3))).toFixed(1);
    if (k < 1) requestAnimationFrame(step);
  })(t0);
}
function notesFor(p) {
  const n = [];
  if (p.Sleep_Hours_Per_Night < 6) n.push('Most sleep guidance for adults suggests 7 to 9 hours a night.');
  if (p.Avg_Daily_Usage_Hours >= 6) n.push('Six or more hours of daily social media use leaves less time for sleep, study and movement.');
  if (p.Physical_Activity_Hours < 0.5) n.push('A short daily walk counts as physical activity.');
  if (p.Stress_Level === 'High' || p.Stress_Level === 'Very High') n.push('High stress is worth talking through with someone you trust or a counsellor.');
  return n;
}
function showResult(v, p) {
  const band = v < 5 ? 'Lower range' : v < 7 ? 'Middle range' : 'Higher range';
  const text = v < 5
    ? 'Students with profiles like this tended to report lower scores in the survey data.'
    : v < 7
      ? 'Students with profiles like this tended to report scores near the middle of the scale.'
      : 'Students with profiles like this tended to report higher scores in the survey data.';
  ruler.classList.add('on');
  ruler.style.setProperty('--p', Math.min(Math.max(v, 0), 10) / 10);
  count(v);
  bandEl.textContent = band;
  readingEl.textContent = text;
  statusEl.textContent = `Your estimated score is ${v.toFixed(1)} out of 10. ${band}. ${text}`;

  const notes = $('#notes'), recap = $('#recap');
  notes.replaceChildren(...notesFor(p).map((t) => Object.assign(document.createElement('li'), { textContent: t })));
  notes.previousElementSibling.hidden = !notes.children.length;
  recap.replaceChildren();
  for (const k of Object.keys(LBL)) {
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = LBL[k]; dd.textContent = String(p[k]);
    recap.append(dt, dd);
  }
  extra.hidden = false;
  if (innerWidth < 960) panel.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}
function errorText(err) {
  if (err.name === 'AbortError') return 'The server took too long to answer. Try again in a minute.';
  if (err.status === 422) return 'The server could not accept one of the values. Check every field and try again.';
  if (err.status === 429) return 'Too many requests. Wait a moment and try again.';
  if (err.status) return `The scoring service returned an error (${err.status}). Try again shortly.`;
  return 'The scoring service cannot be reached. Check your connection and try again.';
}
function resetResult() {
  clearTimeout(slowTimer);
  ruler.classList.remove('on', 'sweep'); ruler.style.setProperty('--p', 0);
  scoreEl.textContent = '--'; bandEl.textContent = 'Waiting for your details';
  readingEl.textContent = INTRO; extra.hidden = true; apiErr.hidden = true; statusEl.textContent = '';
}

/* ---------- submit ---------- */
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (busy) return;
  const payload = collect();
  if (!payload) return;
  setBusy(true);
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API_BASE + '/predict', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: ctl.signal, credentials: 'omit', cache: 'no-store'
    });
    if (!res.ok) { const er = new Error('api'); er.status = res.status; throw er; }
    const v = Number((await res.json()).predicted_mental_health_score);
    if (!Number.isFinite(v)) throw new Error('bad response');
    setBusy(false);
    showResult(v, payload);
  } catch (err) {
    setBusy(false);
    resetResult();
    apiErr.textContent = errorText(err); apiErr.hidden = false;
    statusEl.textContent = apiErr.textContent;
  } finally { clearTimeout(timer); }
});

form.addEventListener('reset', () => setTimeout(() => {
  form.querySelectorAll('.err').forEach((p) => p.remove());
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  resetResult();
}, 0));

/* ---------- dialogs and footer ---------- */
document.querySelectorAll('[data-open]').forEach((b) =>
  b.addEventListener('click', () => document.getElementById(b.dataset.open).showModal()));
document.querySelectorAll('dialog').forEach((d) => {
  d.addEventListener('click', (e) => { if (e.target === d || e.target.hasAttribute('data-close')) d.close(); });
});
$('#year').textContent = new Date().getFullYear();
