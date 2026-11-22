# GuitarSQUAT

A rhythm game you play by squatting in front of your webcam.

- Notes scroll down the highway. **Squat** so you reach the bottom as a note hits the ring.
- **Purple bars** are holds: stay down until the bar ends.
- Two original songs. Pass both with 60%+ accuracy in camera mode to beat the game.
- Pose tracking runs entirely in your browser (MediaPipe Pose). No video leaves your machine.

## Play
Open the GitHub Pages site, click **Start with camera**, stand 2–3 m back with your whole body in view, and follow the calibration (stand, deep squat, 3 test squats).

Keyboard test mode: hold **Space** to squat. It doesn't count toward completion.

## Run locally
```bash
python3 -m http.server 8000
```
Then open http://localhost:8000. The camera needs `localhost` or HTTPS.

Every push deploys automatically through `.github/workflows/deploy.yml`.
