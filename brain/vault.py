"""Encryption at rest for health data on the device (Product Document 14.4 and 28: "the target is encryption at rest").

Health state, the profile (allergies, medicines), the ground queue and the crew pulse are written encrypted with
Fernet (AES-128-CBC with HMAC-SHA256, from the `cryptography` library). Reading accepts the old plaintext files, so
an existing install migrates on its next save.

The key: SENTINEL_DATA_KEY if set (a Fernet key, kept off the device, e.g. by the flight surgeon's system); otherwise
a key generated once into data/.key. A key on the same disk only protects a copied data folder, not a stolen laptop:
in flight the key would live in the spacecraft's secure element. That limit is stated, not hidden.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

DATA = Path(__file__).resolve().parent.parent / "data"
MAGIC = b"SENTINEL-VAULT-1\n"
_fernet: Fernet | None = None


def _key() -> bytes:
    env = os.getenv("SENTINEL_DATA_KEY", "").strip()
    if env:
        return env.encode()
    kf = DATA / ".key"
    if kf.exists():
        return kf.read_bytes().strip()
    DATA.mkdir(exist_ok=True)
    k = Fernet.generate_key()
    kf.write_bytes(k)
    try:
        os.chmod(kf, 0o600)
    except OSError:
        pass
    return k


def _f() -> Fernet:
    global _fernet
    if _fernet is None:
        _fernet = Fernet(_key())
    return _fernet


def write_json(path: Path, obj) -> None:
    """Atomic, encrypted write."""
    path.parent.mkdir(exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(MAGIC + _f().encrypt(json.dumps(obj, separators=(",", ":")).encode("utf-8")))
    tmp.replace(path)


def read_json(path: Path):
    """Read an encrypted file, or a plaintext one from before encryption (encrypted in place as it is read)."""
    raw = path.read_bytes()
    if raw.startswith(MAGIC):
        try:
            return json.loads(_f().decrypt(raw[len(MAGIC):]).decode("utf-8"))
        except InvalidToken as e:
            raise ValueError(f"{path.name}: cannot decrypt (wrong SENTINEL_DATA_KEY?)") from e
    obj = json.loads(raw.decode("utf-8"))
    try:
        write_json(path, obj)   # migrate now: a plaintext health file must not wait for the next change to be encrypted
    except OSError:
        pass
    return obj
