import { Synth } from './audio.js';
import { PoseTracker, SquatDetector } from './pose.js';
import { SONGS, buildChart } from './songs.js';
import { Play, renderPlay, drawVideo, drawDepthMeter, drawBackground } from './game.js';

const PASS = 60;
const $ = (id) => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');
let W = 0, H = 0;
function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize); resize();

// ---------- storage ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('gsq_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('gsq_' + k, JSON.stringify(v)); } catch {} },
};
const settings = { difficulty: store.get('difficulty', 'normal'), offset: store.get('offset', 0) };
let progress = store.get('progress', {}); // {songId: {camera:{best, passed, diff}, keyboard:{...}}}
let lifetime = store.get('lifetime', 0);

// ---------- core objects ----------
let synth = null;
const pose = new PoseTracker();
const detector = new SquatDetector();
let mode = null; // 'camera' | 'keyboard'
let scene = 'title'; // title | calibrate | menu | play | results | complete
let play = null, calib = null, lastSong = null;

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('hidden', s.id !== id));
}
function hideScreens() { document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden')); }

async function ensureSynth() {
  if (!synth) synth = new Synth();
  await synth.resume();
}

// ---------- title ----------
const camSelect = $('cam-select');
async function listCameras() {
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    const saved = store.get('camera', '');
    camSelect.innerHTML = '<option value="">Default camera</option>' + devs.map((d, i) =>
      `<option value="${d.deviceId}">${d.label || 'Camera ' + (i + 1) + ' (allow camera to see names)'}</option>`).join('');
    if (devs.some((d) => d.deviceId === saved)) camSelect.value = saved;
  } catch (e) { console.warn(e); }
}
listCameras();
navigator.mediaDevices && navigator.mediaDevices.addEventListener && navigator.mediaDevices.addEventListener('devicechange', listCameras);
camSelect.onchange = () => store.set('camera', camSelect.value);

$('btn-camera').onclick = async () => {
  const st = $('start-status');
  $('btn-camera').disabled = $('btn-keyboard').disabled = true;
  try {
    await ensureSynth();
    await pose.init((m) => (st.textContent = m), camSelect.value || undefined);
    listCameras();
    mode = 'camera'; detector.keyboard = false;
    st.textContent = '';
    startCalibration();
  } catch (e) {
    console.error(e);
    listCameras();
    st.textContent = (e && e.name === 'NotAllowedError')
      ? 'Camera permission was blocked. Allow camera access in the address bar and try again.'
      : (e && (e.name === 'NotReadableError' || e.name === 'TrackStartError'))
      ? 'That camera is in use by another app (probably OBS). In OBS click "Start Virtual Camera", then choose "OBS Virtual Camera" above and try again.'
      : (e && e.name === 'OverconstrainedError')
      ? 'That camera is no longer available. Pick another one above.'
      : 'Could not start camera / pose model: ' + (e && e.message ? e.message : e);
  } finally {
    $('btn-camera').disabled = $('btn-keyboard').disabled = false;
  }
};
$('btn-keyboard').onclick = async () => {
  await ensureSynth();
  mode = 'keyboard'; detector.keyboard = true;
  openMenu();
};

// ---------- calibration ----------
function startCalibration() {
  hideScreens(); scene = 'calibrate';
  calib = { step: 'stand', t: performance.now(), samples: [], stand: null, msg: '', testCount: 0, lastTick: -1 };
  detector.calib = null;
}
function calibStep(step, msg = '') { calib.step = step; calib.t = performance.now(); calib.samples = []; calib.msg = msg; calib.lastTick = -1; }

function updateCalibration() {
  const el = (performance.now() - calib.t) / 1000;
  if (calib.step === 'stand' || calib.step === 'squat') {
    const cd = Math.ceil(3 - el);
    if (el < 3 && cd !== calib.lastTick) { calib.lastTick = cd; synth.tick(false); }
    if (el >= 3 && el < 4.5) {
      if (calib.lastTick !== 0) { calib.lastTick = 0; synth.tick(true); }
      if (pose.metrics && pose.visible) calib.samples.push(pose.metrics);
    } else if (el >= 4.5) {
      if (calib.samples.length < 8) return calibStep(calib.step, "I couldn't see you clearly. Get your whole body in frame.");
      if (calib.step === 'stand') { calib.stand = calib.samples; calibStep('squat'); }
      else {
        const c = SquatDetector.makeCalib(calib.stand, calib.samples);
        if (!c) return calibStep('stand', 'That squat looked too shallow. Go lower, and keep your legs in frame.');
        detector.calib = c; detector.depth = 0; detector.down = false;
        calibStep('test');
        calib.unsub = detector.on(() => { calib.testCount++; synth.blip(true); });
      }
    }
  } else if (calib.step === 'test' && calib.testCount >= 3) {
    finishCalibration();
  }
}
function finishCalibration() {
  if (calib && calib.unsub) calib.unsub();
  calib = null; openMenu();
}

function renderCalibration() {
  drawBackground(ctx, W, H);
  drawVideo(ctx, pose, 0, 0, W, H, 0.85);
  ctx.fillStyle = 'rgba(11,6,24,.6)'; ctx.fillRect(0, 0, W, H * 0.3);
  ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
  const el = (performance.now() - calib.t) / 1000;
  const big = `900 ${Math.round(Math.min(64, H * 0.07))}px Bungee, Impact`;
  const mid = `600 ${Math.round(Math.min(22, H * 0.03))}px Inter`;
  let title = '', sub = '';
  if (calib.step === 'stand') {
    title = 'STAND TALL';
    sub = el < 3 ? `Stand still, arms relaxed… ${Math.ceil(3 - el)}` : 'Hold still… measuring';
  } else if (calib.step === 'squat') {
    title = 'SQUAT DEEP & HOLD';
    sub = el < 3 ? `Go down to your lowest comfortable squat… ${Math.ceil(3 - el)}` : 'HOLD IT… measuring';
  } else {
    title = `TEST: ${calib.testCount}/3 SQUATS`;
    sub = 'Do 3 squats and watch the depth meter go green · Press Enter to skip';
  }
  ctx.font = big; ctx.fillText(title, W / 2, H * 0.12);
  ctx.font = mid; ctx.fillStyle = '#ffd9b0'; ctx.fillText(sub, W / 2, H * 0.19);
  if (calib.msg) { ctx.fillStyle = '#ff8a8a'; ctx.fillText(calib.msg, W / 2, H * 0.25); }
  if (!pose.visible) {
    ctx.fillStyle = '#ff6b6b'; ctx.font = big; ctx.fillText('STEP INTO FRAME', W / 2, H * 0.6);
  }
  if (calib.step === 'test') drawDepthMeter(ctx, detector, W - 60, H * 0.35, 30, H * 0.5);
  ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = '500 14px Inter'; ctx.textAlign = 'left';
  ctx.fillText('Tip: side-on or front-on both work. Whole body, head to feet, in view is best.', 16, H - 16);
}

// ---------- menu ----------
function prog(songId) { return (progress[songId] || {})[mode] || null; }
function allPassed(m = 'camera') { return SONGS.every((s) => progress[s.id] && progress[s.id][m] && progress[s.id][m].passed); }

function openMenu() {
  scene = 'menu'; showScreen('screen-menu');
  $('mode-badge').textContent = mode === 'camera'
    ? '📷 Camera mode: this counts for the challenge'
    : "⌨️ Keyboard test mode (doesn't count for the challenge)";
  $('btn-recal').style.display = mode === 'camera' ? '' : 'none';
  const list = $('song-list'); list.innerHTML = '';
  SONGS.forEach((s, i) => {
    const p = prog(s.id);
    const b = document.createElement('button');
    b.className = 'song';
    b.innerHTML = `<div class="meta">Song ${i + 1} · ${s.bpm} BPM · ${Math.round(s.duration)}s</div>
      <h3>${s.title}</h3><div class="meta">${s.blurb}</div>
      <div class="best">${p ? `Best: ${p.best.toFixed(1)}% ${p.passed ? `<span class="ok">✔ PASSED (${p.diff})</span>` : ''}` : 'Not played yet'}</div>`;
    b.onclick = () => startSong(s);
    list.appendChild(b);
  });
  document.querySelectorAll('#diff-seg button').forEach((b) => b.classList.toggle('on', b.dataset.d === settings.difficulty));
  $('offset').value = settings.offset; $('offset-val').textContent = `${settings.offset} ms`;
  $('lifetime').textContent = `Lifetime squats: ${lifetime}`;
}
document.querySelectorAll('#diff-seg button').forEach((b) => (b.onclick = () => {
  settings.difficulty = b.dataset.d; store.set('difficulty', settings.difficulty); openMenu();
}));
$('offset').oninput = (e) => {
  settings.offset = +e.target.value; store.set('offset', settings.offset);
  $('offset-val').textContent = `${settings.offset} ms`;
};
$('btn-recal').onclick = () => startCalibration();

// ---------- play ----------
async function startSong(song) {
  await ensureSynth();
  hideScreens(); scene = 'play'; lastSong = song;
  detector.depth = 0; detector.down = false;
  play = new Play({
    song, notes: buildChart(song, settings.difficulty), synth, detector,
    offset: settings.offset, mode, difficulty: settings.difficulty,
  });
  play.start();
}
function quitSong() { if (play) play.stop(); play = null; openMenu(); }

function endSong() {
  const p = play; p.stop(); play = null;
  const acc = p.accuracy(), passed = acc >= PASS;
  lifetime += p.squats; store.set('lifetime', lifetime);
  const wasComplete = allPassed('camera');
  progress[p.song.id] = progress[p.song.id] || {};
  const prev = progress[p.song.id][mode];
  progress[p.song.id][mode] = {
    best: Math.max(acc, prev ? prev.best : 0),
    passed: passed || (prev ? prev.passed : false),
    diff: passed ? p.difficulty : prev ? prev.diff : p.difficulty,
  };
  store.set('progress', progress);

  const grade = acc >= 95 ? 'S' : acc >= 85 ? 'A' : acc >= 75 ? 'B' : acc >= PASS ? 'C' : 'F';
  $('res-title').textContent = p.song.title;
  $('res-grade').textContent = grade;
  $('res-pass').innerHTML = passed ? '<span style="color:#3ee07c">SONG PASSED!</span>' : `<span style="color:#ff6b6b">Need ${PASS}% to pass. Go again!</span>`;
  const holds = p.notes.filter((n) => n.dur > 0);
  const held = holds.filter((n) => n.holdFrac >= 1).length;
  $('res-stats').innerHTML = [
    ['Accuracy', acc.toFixed(1) + '%'], ['Score', Math.floor(p.score).toLocaleString()],
    ['Perfect', p.counts.perfect], ['Good', p.counts.good], ['Miss', p.counts.miss],
    ['Holds completed', `${held}/${holds.length}`], ['Max combo', p.maxCombo],
    ['Squats this song', p.squats], ['Difficulty', p.difficulty],
  ].map(([a, b]) => `<div>${a}</div><div>${b}</div>`).join('');

  if (mode === 'camera' && !wasComplete && allPassed('camera')) {
    scene = 'complete'; showScreen('screen-complete');
    $('complete-stats').innerHTML = [
      ...SONGS.map((s) => [s.title, `${progress[s.id].camera.best.toFixed(1)}% (${progress[s.id].camera.diff})`]),
      ['Lifetime squats', lifetime],
    ].map(([a, b]) => `<div>${a}</div><div>${b}</div>`).join('');
    celebrate();
  } else {
    scene = 'results'; showScreen('screen-results');
  }
}
$('btn-retry').onclick = () => startSong(lastSong);
$('btn-menu').onclick = () => openMenu();
$('btn-complete-menu').onclick = () => openMenu();

function celebrate() {
  if (!synth) return;
  const t = synth.ctx.currentTime + 0.05;
  [72, 76, 79, 84, 88, 91, 96].forEach((m, i) => synth.lead(t + i * 0.11, m, 0.3));
  synth.crash(t); synth.kick(t);
}

// ---------- input ----------
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); if (detector.keyboard) detector.keyDown = true; }
  if (e.code === 'Escape' && scene === 'play') quitSong();
  if (e.code === 'Escape' && scene === 'calibrate' && detector.calib) finishCalibration();
  if (e.code === 'Enter' && scene === 'calibrate' && calib && calib.step === 'test') finishCalibration();
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space') detector.keyDown = false; });

// ---------- main loop ----------
function frame() {
  requestAnimationFrame(frame);
  if (mode === 'camera') { if (pose.tick()) detector.update(pose); }
  else if (mode === 'keyboard') detector.update(pose);

  if (scene === 'calibrate' && calib) { updateCalibration(); if (calib) renderCalibration(); }
  else if (scene === 'play' && play) {
    play.update();
    renderPlay(ctx, W, H, play, pose);
    if (play.done) endSong();
  } else {
    drawBackground(ctx, W, H);
  }
}
requestAnimationFrame(frame);

// expose for debugging
window.__gsq = { get play() { return play; }, detector, pose, SONGS, buildChart };
