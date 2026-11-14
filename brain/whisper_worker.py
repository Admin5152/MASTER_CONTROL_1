"""Local Whisper in its own process: reads WAV bytes on stdin, prints the transcript as JSON.

Run by brain.speech.stt_local so the CTranslate2 model never shares memory with Kokoro (onnxruntime)
in the server process; on a laptop with little free commit memory the two did not fit together.
"""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def pcm16k(wav: bytes):
    """Decode a PCM WAV to mono float32 at 16 kHz (no PyAV: the venv's PyAV is incompatible with faster-whisper)."""
    import wave

    import numpy as np
    with wave.open(io.BytesIO(wav)) as w:
        rate, ch, width = w.getframerate(), w.getnchannels(), w.getsampwidth()
        raw = w.readframes(w.getnframes())
    dt = {1: "u1", 2: "<i2", 4: "<i4"}[width]
    x = np.frombuffer(raw, dtype=dt).astype("float32")
    x = (x - 128) / 128 if width == 1 else x / float(2 ** (8 * width - 1))
    if ch > 1:
        x = x.reshape(-1, ch).mean(axis=1)
    if rate != 16000:
        n = int(len(x) * 16000 / rate)
        x = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype("float32")
    return x


def main() -> None:
    from faster_whisper import WhisperModel
    path = ROOT / "models" / "whisper" / "base.en"
    model = WhisperModel(str(path) if path.exists() else "base.en", device="cpu", compute_type="int8", cpu_threads=2,
                         download_root=str(ROOT / "models" / "whisper"))
    wav = sys.stdin.buffer.read()
    segs, _ = model.transcribe(pcm16k(wav), language="en", beam_size=1, vad_filter=False)
    sys.stdout.write(json.dumps({"text": " ".join(s.text.strip() for s in segs).strip()}))


if __name__ == "__main__":
    main()
