"""Encryption at rest: health files are unreadable on disk, readable by Sentinel, and old plaintext migrates."""
import json

from brain.core import vault


def test_round_trip_is_encrypted_on_disk(tmp_path, monkeypatch):
    monkeypatch.setenv("SENTINEL_DATA_KEY", vault.Fernet.generate_key().decode()); vault._fernet = None
    f = tmp_path / "profiles.json"
    vault.write_json(f, {"kenji": {"health": {"allergies": ["penicillin"]}}})
    raw = f.read_bytes()
    assert raw.startswith(vault.MAGIC) and b"penicillin" not in raw
    assert vault.read_json(f)["kenji"]["health"]["allergies"] == ["penicillin"]


def test_plaintext_from_an_older_install_is_read_and_encrypted_in_place(tmp_path, monkeypatch):
    monkeypatch.setenv("SENTINEL_DATA_KEY", vault.Fernet.generate_key().decode()); vault._fernet = None
    f = tmp_path / "ground.json"; f.write_text(json.dumps([{"crew": "kenji", "body": "resting HR 58"}]), encoding="utf-8")
    assert vault.read_json(f)[0]["crew"] == "kenji"
    raw = f.read_bytes()
    assert raw.startswith(vault.MAGIC) and b"kenji" not in raw      # migrated at once, not on the next change
    assert vault.read_json(f)[0]["body"] == "resting HR 58"
    vault._fernet = None


def test_a_wrong_key_is_refused_not_misread(tmp_path, monkeypatch):
    monkeypatch.setenv("SENTINEL_DATA_KEY", vault.Fernet.generate_key().decode()); vault._fernet = None
    f = tmp_path / "x.json"; vault.write_json(f, {"a": 1})
    monkeypatch.setenv("SENTINEL_DATA_KEY", vault.Fernet.generate_key().decode()); vault._fernet = None
    try:
        vault.read_json(f); assert False, "read with the wrong key"
    except ValueError as e:
        assert "cannot decrypt" in str(e)
    vault._fernet = None
