# Browser checks (Playwright)

Scripts that drive the real app in a browser and save screenshots to `tests/screenshots/` (git-ignored). They are not
part of `pytest`; run one against a running server, for example:

```powershell
.venv\Scripts\python tests\browser\clinic_ui_check.py                          # the clinic screens, end to end
.venv\Scripts\python tests\browser\layout_shots.py http://127.0.0.1:8000 both   # every main screen, dark and light
```

| Script | Checks |
| --- | --- |
| `clinic_ui_check.py` | The clinic, triage, protocols and alerts screens, driven like a user |
| `layout_shots.py` | Screenshots of every main screen in both themes |
| `body_shots.py`, `body_zones_check.py` | The 3D body, X-ray, zone checks and pointing |
| `race_check.py` | The space race from menu to saved mood |
| `gpu_check.py`, `flicker_check.py`, `polish_check.py` | Frame rate on a real GPU, black-frame flicker, visual polish |
| `planet_explorer_check.py`, `radiation_location_check.py` | Planet explorer and radiation by location |
| `voice_e2e.py` | The voice loop end to end |
| `browser_check.py`, `offline_check.py`, `resource_check.py` | v1-era checks (page errors, offline mode, resource use) |

The scripts block `/api/tts`, so they spend no ElevenLabs credit.
