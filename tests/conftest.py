import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# Tests never touch data/state.json or the network, and start with no LLM key
# unless one is really configured (the key-dependent test checks for it).
os.environ["SENTINEL_NO_PERSIST"] = "1"
os.environ["SENTINEL_NO_NETWORK"] = "1"
os.environ["SENTINEL_FRESH"] = "1"
REAL_KEY = os.environ.get("LLM_API_KEY", "")


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "")
    from fastapi.testclient import TestClient
    import server
    server.store.reset()
    with TestClient(server.app) as c:
        yield c
    server.scenarios.stop()
    server.store.reset()


@pytest.fixture()
def store():
    from brain.store import Store
    return Store(persist=False, fresh=True)
