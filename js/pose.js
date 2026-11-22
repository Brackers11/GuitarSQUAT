// Webcam + MediaPipe Pose, and squat detection from the landmarks.
const VISION = new URL('../vendor/mediapipe', import.meta.url).href;
const MODEL = new URL('../vendor/mediapipe/pose_landmarker_lite.task', import.meta.url).href;

export const CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32],
];

export class PoseTracker {
  constructor() {
    this.video = document.createElement('video');
    this.video.playsInline = true; this.video.muted = true; this.video.autoplay = true;
    this.landmarks = null; this.metrics = null; this.lastSeen = 0; this.ready = false; this.lastVideoTime = -1;
  }
  async openCamera(deviceId) {
    if (this.video.srcObject) this.video.srcObject.getTracks().forEach((t) => t.stop());
    const video = { width: { ideal: 640 }, height: { ideal: 480 } };
    if (deviceId) video.deviceId = { exact: deviceId }; else video.facingMode = 'user';
    const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    this.video.srcObject = stream;
    await this.video.play();
  }
  async init(onStatus, deviceId) {
    onStatus('Asking for camera access…');
    await this.openCamera(deviceId);
    if (this.ready) return;
    onStatus('Loading pose model (first time takes a few seconds)…');
    const { FilesetResolver, PoseLandmarker } = await import(`${VISION}/vision_bundle.mjs`);
    const fileset = await FilesetResolver.forVisionTasks(`${VISION}/wasm`);
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numPoses: 1,
      minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    try { this.lm = await PoseLandmarker.createFromOptions(fileset, opts('GPU')); }
    catch (e) { console.warn('GPU delegate failed, using CPU', e); this.lm = await PoseLandmarker.createFromOptions(fileset, opts('CPU')); }
    this.ready = true;
  }
  // returns true when a new frame was processed
  tick() {
    if (!this.ready || this.video.readyState < 2) return false;
    if (this.video.currentTime === this.lastVideoTime) return false;
    this.lastVideoTime = this.video.currentTime;
    let res;
    try { res = this.lm.detectForVideo(this.video, performance.now()); } catch (e) { return false; }
    const lm = res.landmarks && res.landmarks[0];
    if (!lm) { this.landmarks = null; this.metrics = null; return true; }
    this.landmarks = lm; this.lastSeen = performance.now();
    this.metrics = computeMetrics(lm, this.video.videoWidth || 640, this.video.videoHeight || 480);
    return true;
  }
  get visible() { return performance.now() - this.lastSeen < 700; }
}

function angle(a, b, c) {
  const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
  const d = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (d === 0) return null;
  return (Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / d))) * 180) / Math.PI;
}

function computeMetrics(lm, w, h) {
  const P = (i) => ({ x: lm[i].x * w, y: lm[i].y * h, v: lm[i].visibility ?? 1 });
  const knees = [];
  for (const [hi, ki, ai] of [[23, 25, 27], [24, 26, 28]]) {
    const a = P(hi), b = P(ki), c = P(ai);
    if (Math.min(a.v, b.v, c.v) > 0.5 && lm[ai].y < 1.02) {
      const ang = angle(a, b, c);
      if (ang != null) knees.push(ang);
    }
  }
  const knee = knees.length ? knees.reduce((s, x) => s + x, 0) / knees.length : null;
  const hipY = (lm[23].y + lm[24].y) / 2;
  return { knee, hipY };
}

const median = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

// Turns raw metrics into a 0..1 squat depth using the player's calibration.
export class SquatDetector {
  constructor() {
    this.calib = null; this.depth = 0; this.down = false; this.listeners = new Set();
    this.DOWN = 0.6; this.UP = 0.3;
    this.keyboard = false; this.keyDown = false; this.total = 0;
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  static makeCalib(standSamples, squatSamples) {
    const kS = standSamples.map((m) => m.knee).filter((x) => x != null);
    const kQ = squatSamples.map((m) => m.knee).filter((x) => x != null);
    const c = {
      hipStand: median(standSamples.map((m) => m.hipY)),
      hipSquat: median(squatSamples.map((m) => m.hipY)),
      kneeStand: kS.length >= 5 ? median(kS) : null,
      kneeSquat: kQ.length >= 5 ? median(kQ) : null,
    };
    c.useKnee = c.kneeStand != null && c.kneeSquat != null && c.kneeStand - c.kneeSquat > 25;
    c.useHip = c.hipSquat - c.hipStand > 0.03;
    return c.useKnee || c.useHip ? c : null;
  }

  rawDepth(m) {
    const c = this.calib; const parts = [];
    if (c.useKnee && m.knee != null) parts.push((c.kneeStand - m.knee) / (c.kneeStand - c.kneeSquat));
    if (c.useHip) parts.push((m.hipY - c.hipStand) / (c.hipSquat - c.hipStand));
    if (!parts.length) return null;
    const d = parts.reduce((s, x) => s + x, 0) / parts.length;
    return Math.max(-0.2, Math.min(1.3, d));
  }

  update(pose) {
    let target;
    if (this.keyboard) target = this.keyDown ? 1 : 0;
    else {
      if (!this.calib || !pose.metrics) return;
      target = this.rawDepth(pose.metrics);
      if (target == null) return;
    }
    this.depth += (target - this.depth) * 0.6;
    if (!this.down && this.depth >= this.DOWN) {
      this.down = true; this.total++;
      this.listeners.forEach((f) => f());
    } else if (this.down && this.depth <= this.UP) {
      this.down = false;
    }
  }
}
