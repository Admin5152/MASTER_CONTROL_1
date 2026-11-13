# Sentinel

Onboard crew-health companion (NASA Space Apps 2026). Work in progress; the full README is written in Phase 10.

## Environment (Phase 0, 13 Nov 2026)

| Step | Result |
|---|---|
| Preflight | Python 3.12.10, git 2.49.0, Node v26.13.0 |
| Repo | `git init`, branch `build`, `.gitignore` covers .env, .venv, __pycache__, data, voiceprints, certs, video/ |
| Python env | `.venv` already present; FastAPI 0.162.5, uvicorn 0.54.0, httpx 0.28.1, numpy 2.5.4, pytest 9.2.0, cryptography 50.0.2 verified by import |
| Speaker ID | Resemblyzer 0.1.4 on torch 2.15.0+cpu imports and embeds 1 s of synthetic audio to a 256-value vector (verified) |
| Vendored JS | mediapipe `vision_bundle.mjs` (156 KB), `wasm/` (4 files), `face_landmarker.task` (3.8 MB), `pose_landmarker_lite.task` (5.8 MB), Chart.js UMD (210 KB), GSAP (73 KB): all present, non-empty |
| NOAA snapshot | `shared/swpc_protons_1day.json` (2,288 rows), `shared/swpc_noaa_scales.json`; live feeds fetched and structure matches |
| DONKI | `shared/donki_sep_events.json`, 60 SEP events from two 60-day windows in 2024 |
| Sources | `shared/thresholds.json`, `shared/facts.json`, `shared/SOURCES.md` |
| LLM | no `.env`, so no key: rules fallback is the default; `.env.example` written |
| Certificate | `tools/make_cert.py` generated `certs/cert.pem` for localhost, 127.0.0.1 and the LAN IPs |
