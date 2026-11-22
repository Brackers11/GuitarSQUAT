import { CONNECTIONS } from './pose.js';

export const WIN = { perfect: 0.16, good: 0.32 };
const LOOK = 2.6; // seconds of notes visible ahead
const ZMAX = 3;

export class Play {
  constructor({ song, notes, synth, detector, offset, mode, difficulty }) {
    Object.assign(this, { song, synth, detector, offset, mode, difficulty });
    this.notes = notes.map((n) => ({ ...n, judged: false, result: null, acc: null, holding: false }));
    this.popups = [];
    this.score = 0; this.combo = 0; this.maxCombo = 0;
    this.counts = { perfect: 0, good: 0, miss: 0 };
    this.squats = 0; this.done = false;
    this.lastSquatT = -99; this.lastSquatUsed = true;
    this.duration = song.duration;
  }
  start() {
    this.t0 = this.synth.ctx.currentTime + 0.5;
    this.handle = this.synth.playSong(this.song, this.t0);
    this.unsub = this.detector.on(() => this.onSquat());
  }
  stop() { this.handle && this.handle.stop(); this.unsub && this.unsub(); }
  now() { return this.synth.ctx.currentTime - this.t0 - (this.synth.ctx.outputLatency || 0); }
  judgeTime() { return this.now() - this.offset / 1000; }
  get mult() { return Math.min(4, 1 + Math.floor(this.combo / 8)); }

  popup(text, color) { this.popups.push({ text, color, born: performance.now() }); }

  onSquat() {
    this.squats++;
    const t = this.judgeTime();
    let best = null, bd = Infinity;
    for (const n of this.notes) {
      if (n.judged) continue;
      const d = Math.abs(n.t - t);
      if (d <= WIN.good && d < bd) { best = n; bd = d; }
      if (n.t > t + WIN.good) break;
    }
    if (!best) { this.lastSquatT = t; this.lastSquatUsed = false; return; }
    this.lastSquatUsed = true;
    this.hit(best, bd <= WIN.perfect ? 'perfect' : 'good');
  }

  hit(n, q) {
    n.judged = true; n.result = q; this.counts[q]++;
    this.combo++; this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.score += (q === 'perfect' ? 300 : 150) * this.mult;
    this.synth.blip(q === 'perfect');
    this.popup(q === 'perfect' ? 'PERFECT!' : 'GOOD', q === 'perfect' ? '#ffd23e' : '#7ee8ff');
    const base = q === 'perfect' ? 1 : 0.75;
    if (n.dur > 0) { n.holding = true; n.base = base; n.lastT = n.t; }
    else n.acc = base;
  }

  finishHold(n, frac) {
    n.holding = false; n.holdFrac = frac;
    n.acc = n.base * 0.4 + frac * 0.6;
    if (frac >= 1) { this.score += 200 * this.mult; this.popup('HELD!', '#c084fc'); this.synth.blip(true); }
    else { this.combo = 0; this.popup('TOO EARLY UP!', '#ff6b6b'); this.synth.thud(); }
  }

  update() {
    const t = this.judgeTime();
    const down = this.detector.down;
    for (const n of this.notes) {
      if (!n.judged && t > n.t + WIN.good) {
        // already squatting when the note arrived (went down slightly early) counts as GOOD
        const earlySquat = down && !this.lastSquatUsed && this.lastSquatT > n.t - 0.9;
        if ((n.dur > 0 && down) || earlySquat) { this.lastSquatUsed = true; this.hit(n, 'good'); }
        else {
          n.judged = true; n.result = 'miss'; n.acc = 0; this.counts.miss++; this.combo = 0;
          this.popup('MISS', '#ff6b6b'); this.synth.thud();
        }
      }
      if (n.holding) {
        const end = n.t + n.dur;
        if (down) {
          const prog = Math.min(t, end);
          if (prog > n.lastT) { this.score += (prog - n.lastT) * 250 * this.mult; n.lastT = prog; }
          if (t >= end) this.finishHold(n, 1);
        } else if (t < end - 0.25) this.finishHold(n, Math.max(0, (t - n.t) / n.dur));
        else this.finishHold(n, 1);
      }
    }
    if (this.now() > this.duration + 0.3) this.done = true;
  }

  accuracy() {
    if (!this.notes.length) return 100;
    return (this.notes.reduce((s, n) => s + (n.acc || 0), 0) / this.notes.length) * 100;
  }
  judgedCount() { return this.notes.filter((n) => n.acc != null).length; }
  liveAccuracy() {
    const j = this.notes.filter((n) => n.acc != null);
    return j.length ? (j.reduce((s, n) => s + n.acc, 0) / j.length) * 100 : 100;
  }
}

// ---------- drawing helpers ----------
export function drawVideo(ctx, pose, x, y, w, h, alpha = 1) {
  const v = pose.video;
  const vw = v.videoWidth || 640, vh = v.videoHeight || 480;
  // cover-crop
  const scale = Math.max(w / vw, h / vh);
  const sw = w / scale, sh = h / scale, sx = (vw - sw) / 2, sy = (vh - sh) / 2;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.translate(x + w, y); ctx.scale(-1, 1);
  if (v.readyState >= 2) ctx.drawImage(v, sx, sy, sw, sh, 0, 0, w, h);
  const lm = pose.landmarks;
  if (lm && pose.visible) {
    const P = (i) => [((lm[i].x * vw - sx) / sw) * w, ((lm[i].y * vh - sy) / sh) * h];
    ctx.globalAlpha = 1;
    ctx.lineWidth = Math.max(2, w / 120); ctx.strokeStyle = '#3ee07c'; ctx.lineCap = 'round';
    for (const [a, b] of CONNECTIONS) {
      if ((lm[a].visibility ?? 1) < 0.4 || (lm[b].visibility ?? 1) < 0.4) continue;
      const [ax, ay] = P(a), [bx, by] = P(b);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
    ctx.fillStyle = '#ffb21e';
    for (const i of [23, 24, 25, 26, 27, 28]) {
      if ((lm[i].visibility ?? 1) < 0.4) continue;
      const [px, py] = P(i); ctx.beginPath(); ctx.arc(px, py, Math.max(3, w / 80), 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

export function drawDepthMeter(ctx, detector, x, y, w, h) {
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,.08)'; roundRect(ctx, x, y, w, h, w / 2); ctx.fill();
  const d = Math.max(0, Math.min(1, detector.depth));
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#7ee8ff'); g.addColorStop(1, detector.down ? '#3ee07c' : '#ff5b2e');
  ctx.fillStyle = g; roundRect(ctx, x, y, w, Math.max(w, h * d), w / 2); ctx.fill();
  const mark = (v, label, col) => {
    const yy = y + h * v; ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - 6, yy); ctx.lineTo(x + w + 6, yy); ctx.stroke();
    ctx.fillStyle = col; ctx.font = '600 12px Inter'; ctx.textAlign = 'right'; ctx.fillText(label, x - 10, yy + 4);
  };
  mark(detector.DOWN, 'SQUAT', '#3ee07c'); mark(detector.UP, 'UP', '#b9acd9');
  ctx.fillStyle = '#fff'; ctx.font = '800 13px Inter'; ctx.textAlign = 'center';
  ctx.fillText('DEPTH', x + w / 2, y - 10);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export function drawBackground(ctx, W, H, pulse = 0) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#1a0a3a'); g.addColorStop(1, '#07030f');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  if (pulse > 0) {
    const r = ctx.createRadialGradient(W / 2, H * 0.8, 10, W / 2, H * 0.8, H * 0.8);
    r.addColorStop(0, `rgba(255,91,46,${0.18 * pulse})`); r.addColorStop(1, 'rgba(255,91,46,0)');
    ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);
  }
}

export function renderPlay(ctx, W, H, play, pose) {
  const t = play.now() - play.offset / 1000;
  const beatPhase = ((t / play.song.beat) % 1 + 1) % 1;
  drawBackground(ctx, W, H, t > 0 ? 1 - beatPhase : 0);

  const cx = W / 2, horizonY = H * 0.1, hitY = H * 0.8;
  const halfW = Math.min(W * 0.2, 240);
  const proj = (dt) => {
    const z = Math.max(-0.45, (dt / LOOK) * ZMAX);
    const s = 1 / (1 + z);
    return { y: horizonY + (hitY - horizonY) * s, s };
  };
  const sFar = 1 / (1 + ZMAX), sNear = (H - horizonY) / (hitY - horizonY);

  // highway
  ctx.save();
  const hg = ctx.createLinearGradient(0, horizonY, 0, H);
  hg.addColorStop(0, 'rgba(120,60,220,.05)'); hg.addColorStop(1, 'rgba(120,60,220,.35)');
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.moveTo(cx - halfW * sFar, horizonY + (hitY - horizonY) * sFar);
  ctx.lineTo(cx + halfW * sFar, horizonY + (hitY - horizonY) * sFar);
  ctx.lineTo(cx + halfW * sNear, H); ctx.lineTo(cx - halfW * sNear, H); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(200,160,255,.5)'; ctx.lineWidth = 3; ctx.stroke();

  // beat lines
  const b0 = Math.ceil((t - 0.4) / play.song.beat), b1 = Math.floor((t + LOOK) / play.song.beat);
  for (let b = b0; b <= b1; b++) {
    const { y, s } = proj(b * play.song.beat - t);
    ctx.strokeStyle = b % 4 === 0 ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.1)';
    ctx.lineWidth = b % 4 === 0 ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(cx - halfW * s, y); ctx.lineTo(cx + halfW * s, y); ctx.stroke();
  }

  // hit ring
  const d = Math.max(0, Math.min(1, play.detector.depth));
  ctx.lineWidth = 6;
  ctx.strokeStyle = play.detector.down ? '#3ee07c' : 'rgba(255,255,255,.85)';
  ctx.beginPath(); ctx.ellipse(cx, hitY, halfW * 0.62, halfW * 0.22, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = play.detector.down ? 'rgba(62,224,124,.45)' : 'rgba(255,178,30,.3)';
  ctx.beginPath(); ctx.ellipse(cx, hitY, halfW * 0.62 * d, halfW * 0.22 * d, 0, 0, Math.PI * 2); ctx.fill();

  // notes (far to near)
  const visible = play.notes.filter((n) => n.t - t < LOOK && n.t + n.dur - t > -0.6);
  for (let i = visible.length - 1; i >= 0; i--) {
    const n = visible[i];
    if (n.dur > 0) {
      const startDt = n.holding ? 0 : n.t - t;
      if (n.judged && !n.holding && n.result !== 'miss' && n.holdFrac != null) continue;
      const endDt = Math.min(LOOK, n.t + n.dur - t);
      if (endDt < -0.45) continue;
      const a = proj(Math.max(-0.45, startDt)), b = proj(endDt);
      const col = n.result === 'miss' || n.holdFrac < 1 ? 'rgba(120,120,140,.6)' : n.holding ? '#e9b8ff' : '#a855f7';
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(cx - halfW * 0.32 * a.s, a.y); ctx.lineTo(cx + halfW * 0.32 * a.s, a.y);
      ctx.lineTo(cx + halfW * 0.32 * b.s, b.y); ctx.lineTo(cx - halfW * 0.32 * b.s, b.y); ctx.closePath(); ctx.fill();
      if (n.holding) { ctx.shadowColor = '#c084fc'; ctx.shadowBlur = 30; ctx.fill(); ctx.shadowBlur = 0; }
      if (!n.judged) drawGem(ctx, cx, a.y, halfW * 0.55 * a.s, '#c084fc', '#7c3aed', 'HOLD');
    } else {
      if (n.judged && n.result !== 'miss') continue;
      const { y, s } = proj(n.t - t);
      if (n.result === 'miss') drawGem(ctx, cx, y, halfW * 0.55 * s, '#666', '#333', '');
      else drawGem(ctx, cx, y, halfW * 0.55 * s, '#ffb21e', '#ff5b2e', '▼');
    }
  }
  ctx.restore();

  // cue text
  const next = play.notes.find((n) => !n.judged);
  const holding = play.notes.find((n) => n.holding);
  ctx.textAlign = 'center';
  if (holding) {
    const left = Math.max(0, holding.t + holding.dur - t);
    ctx.fillStyle = '#e9b8ff'; ctx.font = `900 ${Math.round(H * 0.07)}px Bungee, Impact`;
    ctx.fillText(`HOLD IT! ${left.toFixed(1)}s`, cx, H * 0.93);
  } else if (next && next.t - t < 0.9 && next.t - t > -0.3) {
    ctx.fillStyle = next.dur > 0 ? '#c084fc' : '#ffb21e';
    ctx.font = `900 ${Math.round(H * 0.07)}px Bungee, Impact`;
    ctx.fillText(next.dur > 0 ? 'SQUAT & HOLD!' : 'SQUAT!', cx, H * 0.93);
  }
  const first = play.notes[0];
  if (first && t < first.t - 0.9) {
    const secs = Math.ceil(first.t - t);
    ctx.fillStyle = '#fff'; ctx.font = `900 ${Math.round(H * 0.05)}px Bungee, Impact`;
    ctx.fillText('GET READY', cx, H * 0.35);
    ctx.font = `900 ${Math.round(H * 0.12)}px Bungee, Impact`;
    ctx.fillText(String(Math.max(1, secs)), cx, H * 0.5);
  }

  // popups
  const nowMs = performance.now();
  play.popups = play.popups.filter((p) => nowMs - p.born < 700);
  play.popups.forEach((p, i) => {
    const k = (nowMs - p.born) / 700;
    ctx.globalAlpha = 1 - k; ctx.fillStyle = p.color;
    ctx.font = `900 ${Math.round(H * 0.05)}px Bungee, Impact`;
    ctx.fillText(p.text, cx, hitY - H * 0.12 - k * 50 - i * 6);
  });
  ctx.globalAlpha = 1;

  // HUD
  ctx.textAlign = 'right'; ctx.fillStyle = '#fff';
  ctx.font = `900 ${Math.round(Math.min(40, H * 0.05))}px Bungee, Impact`;
  ctx.fillText(Math.floor(play.score).toLocaleString(), W - 24, 52);
  ctx.font = '600 16px Inter'; ctx.fillStyle = '#b9acd9';
  ctx.fillText(`Accuracy ${play.liveAccuracy().toFixed(0)}%   Squats ${play.squats}`, W - 24, 78);
  ctx.textAlign = 'center';
  if (play.combo > 1) {
    ctx.fillStyle = '#ffd23e'; ctx.font = `900 ${Math.round(Math.min(34, H * 0.045))}px Bungee, Impact`;
    ctx.fillText(`${play.combo} COMBO  x${play.mult}`, cx, 46);
  }
  // progress bar
  const prog = Math.max(0, Math.min(1, play.now() / play.duration));
  ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.fillRect(0, 0, W, 6);
  ctx.fillStyle = '#ff5b2e'; ctx.fillRect(0, 0, W * prog, 6);
  // section name
  const bar = Math.max(0, Math.min(play.song.totalBars - 1, Math.floor(play.now() / (play.song.beat * 4))));
  ctx.textAlign = 'left'; ctx.fillStyle = '#b9acd9'; ctx.font = '600 14px Inter';

  // camera + meter
  const pw = Math.min(260, W * 0.24), ph = pw * 0.75;
  if (play.mode === 'camera') {
    drawVideo(ctx, pose, 16, 20, pw, ph);
    ctx.strokeStyle = pose.visible ? 'rgba(62,224,124,.8)' : '#ff6b6b'; ctx.lineWidth = 3; ctx.strokeRect(16, 20, pw, ph);
    if (!pose.visible) {
      ctx.fillStyle = '#ff6b6b'; ctx.font = `900 ${Math.round(H * 0.04)}px Bungee, Impact`; ctx.textAlign = 'center';
      ctx.fillText("CAN'T SEE YOU! STEP INTO FRAME", cx, H * 0.25);
    }
    ctx.textAlign = 'left'; ctx.fillStyle = '#b9acd9'; ctx.font = '600 14px Inter';
    ctx.fillText(`${play.song.title} · ${play.song.sections[play.song.bars[bar].sec].name}`, 16, ph + 44);
  } else {
    ctx.fillText(`${play.song.title} · ${play.song.sections[play.song.bars[bar].sec].name}`, 16, 30);
    ctx.fillText('KEYBOARD MODE: hold SPACE to squat', 16, 52);
  }
  ctx.fillStyle = 'rgba(185,172,217,.7)'; ctx.font = '500 13px Inter'; ctx.textAlign = 'left';
  ctx.fillText('Esc = quit song', 16, H - 16);
  drawDepthMeter(ctx, play.detector, W - 56, H * 0.22, 28, H * 0.5);
}

function drawGem(ctx, x, y, r, c1, c2, label) {
  if (r < 1) return;
  const g = ctx.createLinearGradient(0, y - r * 0.4, 0, y + r * 0.4);
  g.addColorStop(0, c1); g.addColorStop(1, c2);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.38, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = Math.max(1, r / 18); ctx.stroke();
  if (label && r > 18) {
    ctx.fillStyle = 'rgba(30,10,0,.85)'; ctx.font = `900 ${Math.round(r * 0.32)}px Bungee, Impact`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, x, y + 1); ctx.textBaseline = 'alphabetic';
  }
}
