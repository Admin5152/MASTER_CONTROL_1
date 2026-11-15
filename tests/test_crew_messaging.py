"""Automated Test Suite for Crew-to-Crew Messaging (Phase 1 Backend & Store)."""
import os
os.environ["SENTINEL_NO_NETWORK"] = "1"
os.environ["SENTINEL_NO_WARM"] = "1"
import tempfile
from pathlib import Path
import pytest
from brain.crew.messages import MessagesStore, conversation_key
from brain.core.store import Store
from fastapi.testclient import TestClient
import server


CREW_FIXTURE = [
    {"crew_id": "james", "display_name": "Eliah", "callsign": "James-1"},
    {"crew_id": "kenji", "display_name": "Seth", "callsign": "Kenji-1"},
    {"crew_id": "amara", "display_name": "Annie", "callsign": "Amara-1"},
    {"crew_id": "lukas", "display_name": "Stanley", "callsign": "Lukas-1"},
]


def test_conversation_key_is_deterministic():
    assert conversation_key("james", "kenji") == "james:kenji"
    assert conversation_key("kenji", "james") == "james:kenji"
    assert conversation_key("James", "KENJI") == "james:kenji"


def test_send_message_record_schema():
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tf:
        temp_path = Path(tf.name)
    try:
        store = MessagesStore(persist=True, file_path=temp_path)
        valid_ids = {"james", "kenji", "amara"}

        msg = store.send_message(
            from_cid="james",
            to_cid="kenji",
            text="Hey Seth, did you finish the environmental sample analysis?",
            via="typed",
            valid_crew_ids=valid_ids,
        )

        assert msg["id"].startswith("msg_")
        assert msg["conversation_id"] == "james:kenji"
        assert msg["from_cid"] == "james"
        assert msg["to_cid"] == "kenji"
        assert msg["text"] == "Hey Seth, did you finish the environmental sample analysis?"
        assert msg["via"] == "typed"
        assert msg["delivered"] is True
        assert msg["read_at"] is None
        assert isinstance(msg["t"], float)
    finally:
        if temp_path.exists():
            temp_path.unlink()


def test_validation_rules():
    store = MessagesStore(persist=False)
    valid_ids = {"james", "kenji"}

    # 1. Empty message blocked
    with pytest.raises(ValueError, match="cannot be empty"):
        store.send_message("james", "kenji", "   ", valid_crew_ids=valid_ids)

    # 2. Self message blocked
    with pytest.raises(ValueError, match="yourself"):
        store.send_message("james", "james", "Hello myself", valid_crew_ids=valid_ids)

    # 3. Message exceeding 500 chars blocked
    long_text = "A" * 501
    with pytest.raises(ValueError, match="500 characters"):
        store.send_message("james", "kenji", long_text, valid_crew_ids=valid_ids)

    # 4. Unknown recipient blocked
    with pytest.raises(ValueError, match="Unknown recipient"):
        store.send_message("james", "nonexistent_crew", "Hello", valid_crew_ids=valid_ids)


def test_conversation_listing_and_unread_counts():
    store = MessagesStore(persist=False)
    valid_ids = {"james", "kenji", "amara"}

    # Seth sends 2 messages to Eliah
    store.send_message("kenji", "james", "Eliah, meeting at 14:00.", valid_crew_ids=valid_ids)
    store.send_message("kenji", "james", "Don't forget the cue card.", valid_crew_ids=valid_ids)

    # Annie sends 1 message to Eliah
    store.send_message("amara", "james", "Plants are watered.", valid_crew_ids=valid_ids)

    # Check Eliah's inbox
    convos = store.list_conversations("james", CREW_FIXTURE)
    assert len(convos) == 2

    # Verify unread counts
    assert store.get_unread_count("james") == 3

    seth_convo = next(c for c in convos if c["other_cid"] == "kenji")
    assert seth_convo["unread_count"] == 2
    assert seth_convo["last_message"] == "Don't forget the cue card."

    # Mark Seth's messages read
    read_count = store.mark_read("james", "kenji")
    assert read_count == 2
    assert store.get_unread_count("james") == 1


def test_persistence_across_restart():
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tf:
        temp_path = Path(tf.name)
    try:
        # Instance 1: write message
        store1 = MessagesStore(persist=True, file_path=temp_path)
        store1.send_message("james", "kenji", "Testing reboot persistence.")

        # Instance 2 (simulating fresh server restart)
        store2 = MessagesStore(persist=True, file_path=temp_path)
        thread = store2.get_conversation("james", "kenji")
        assert len(thread["messages"]) == 1
        assert thread["messages"][0]["text"] == "Testing reboot persistence."
    finally:
        if temp_path.exists():
            temp_path.unlink()


def test_fastapi_endpoints():
    from server import (
        messages_send,
        messages_conversations,
        messages_conversation_thread,
        messages_mark_read,
        messages_unread_count,
    )
    from fastapi import HTTPException

    # 1. Send message
    send_resp = messages_send(
        from_cid="james",
        body={"to_cid": "kenji", "text": "Hello Seth from FastAPI test", "via": "typed"},
    )
    assert send_resp["ok"] is True
    assert send_resp["message"]["from_cid"] == "james"
    assert send_resp["message"]["to_cid"] == "kenji"

    # 2. List conversations
    convos = messages_conversations("kenji")["conversations"]
    assert any(convo["other_cid"] == "james" for convo in convos)

    # 3. Get thread
    thread = messages_conversation_thread("kenji", "james")
    assert any(m["text"] == "Hello Seth from FastAPI test" for m in thread["messages"])

    # 4. Check unread
    unread = messages_unread_count("kenji")
    assert unread["unread_count"] >= 1

    # 5. Mark read
    read_resp = messages_mark_read("kenji", "james")
    assert read_resp["ok"] is True

    # 6. Reject invalid recipient
    with pytest.raises(HTTPException) as exc_info:
        messages_send("james", {"to_cid": "kofi_nonexistent", "text": "Hi"})
    assert exc_info.value.status_code == 404
