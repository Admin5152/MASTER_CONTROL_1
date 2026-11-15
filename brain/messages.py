"""Crew-to-Crew Messaging Store (Section: Crew Comms).

Provides persistent 1-to-1 crew messaging with conversation threads,
read receipts, delivery tracking, and unread counts.
Survives process restarts via data/crew_messages.json.
Never passes messages through LLMs or alters message content.
"""
from __future__ import annotations

import copy
import json
import os
import threading
import time
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
MESSAGES_FILE = DATA_DIR / "crew_messages.json"


def conversation_key(cid1: str, cid2: str) -> str:
    """Deterministic conversation identifier between two crew members (sorted order)."""
    a, b = sorted([str(cid1).strip().lower(), str(cid2).strip().lower()])
    return f"{a}:{b}"


class MessagesStore:
    def __init__(self, persist: bool | None = None, file_path: Path | None = None):
        self.persist = (os.getenv("SENTINEL_NO_PERSIST") != "1") if persist is None else persist
        self.file_path = file_path or MESSAGES_FILE
        self.lock = threading.Lock()
        self.messages: list[dict] = []
        if self.persist:
            self._load()

    def _load(self) -> None:
        if not self.file_path.exists():
            self.messages = []
            return
        try:
            with open(self.file_path, "r", encoding="utf-8") as f:
                self.messages = json.load(f)
        except (OSError, ValueError):
            self.messages = []

    def _save(self) -> None:
        if not self.persist:
            return
        try:
            self.file_path.parent.mkdir(parents=True, exist_ok=True)
            temp_file = self.file_path.with_suffix(".tmp")
            with open(temp_file, "w", encoding="utf-8") as f:
                json.dump(self.messages, f, indent=2, ensure_ascii=False)
            temp_file.replace(self.file_path)
        except OSError:
            pass

    def send_message(
        self,
        from_cid: str,
        to_cid: str,
        text: str,
        via: str = "typed",
        valid_crew_ids: set[str] | None = None,
    ) -> dict:
        """Send a message from one crew member to another.
        Enforces length limits, non-empty text, valid recipient, and no self-messages.
        """
        sender = str(from_cid).strip().lower()
        recipient = str(to_cid).strip().lower()

        if not sender or not recipient:
            raise ValueError("Sender and recipient IDs are required")
        if sender == recipient:
            raise ValueError("Cannot send a message to yourself")

        if valid_crew_ids:
            clean_crew = {c.lower() for c in valid_crew_ids}
            if sender not in clean_crew:
                raise ValueError(f"Unknown sender crew member: {sender}")
            if recipient not in clean_crew:
                raise ValueError(f"Unknown recipient crew member: {recipient}")

        clean_text = str(text or "").strip()
        if not clean_text:
            raise ValueError("Message text cannot be empty")
        if len(clean_text) > 500:
            raise ValueError("Message exceeds maximum length of 500 characters")

        via_mode = "voice" if str(via).lower() == "voice" else "typed"
        now = time.time()
        c_key = conversation_key(sender, recipient)

        msg_id = f"msg_{int(now * 1000)}_{os.urandom(3).hex()}"
        record = {
            "id": msg_id,
            "conversation_id": c_key,
            "from_cid": sender,
            "to_cid": recipient,
            "text": clean_text,
            "t": now,
            "delivered": True,
            "read_at": None,
            "via": via_mode,
        }

        with self.lock:
            self.messages.append(record)
            # Enforce reasonable memory cap of 5000 historic messages
            if len(self.messages) > 5000:
                self.messages = self.messages[-5000:]
            self._save()

        return copy.deepcopy(record)

    def list_conversations(self, cid: str, crew_members: list[dict]) -> list[dict]:
        """List all conversation threads for crew member `cid`.
        Returns each thread with the other person's name/callsign, last message preview,
        timestamp, and unread count.
        """
        my_cid = str(cid).strip().lower()
        crew_map = {c["crew_id"].lower(): c for c in crew_members}

        with self.lock:
            # Group messages by conversation_id that include my_cid
            convos: dict[str, list[dict]] = {}
            for m in self.messages:
                if m["from_cid"] == my_cid or m["to_cid"] == my_cid:
                    convos.setdefault(m["conversation_id"], []).append(m)

        results = []
        for c_key, msgs in convos.items():
            if not msgs:
                continue
            p1, p2 = c_key.split(":")
            other_cid = p2 if p1 == my_cid else p1
            other_crew = crew_map.get(other_cid, {"crew_id": other_cid, "display_name": other_cid})

            # Sort messages chronologically
            sorted_msgs = sorted(msgs, key=lambda x: x["t"])
            last_msg = sorted_msgs[-1]
            unread = sum(1 for m in sorted_msgs if m["to_cid"] == my_cid and not m.get("read_at"))

            results.append({
                "conversation_id": c_key,
                "other_cid": other_cid,
                "other_name": other_crew.get("display_name", other_cid),
                "other_callsign": other_crew.get("callsign", ""),
                "last_message": last_msg["text"][:100],
                "last_time": last_msg["t"],
                "unread_count": unread,
            })

        # Sort threads with most recent message first
        results.sort(key=lambda x: x["last_time"], reverse=True)
        return results

    def get_conversation(
        self,
        cid: str,
        other_cid: str,
        limit: int = 30,
        before_time: float | None = None,
    ) -> dict:
        """Fetch message history for conversation between `cid` and `other_cid`.
        Returns oldest first (chronological order) for display in chat thread.
        Supports pagination via `limit` (max 50) and `before_time`.
        """
        my_cid = str(cid).strip().lower()
        partner_cid = str(other_cid).strip().lower()
        c_key = conversation_key(my_cid, partner_cid)

        with self.lock:
            matching = [m for m in self.messages if m["conversation_id"] == c_key]

        if before_time is not None:
            matching = [m for m in matching if m["t"] < before_time]

        # Sort chronologically
        matching.sort(key=lambda x: x["t"])

        # Page window: newest `limit` messages
        page_size = max(1, min(limit, 50))
        paged = matching[-page_size:] if len(matching) > page_size else matching
        has_more = len(matching) > len(paged)

        return {
            "conversation_id": c_key,
            "messages": copy.deepcopy(paged),
            "total_count": len(matching),
            "has_more": has_more,
        }

    def mark_read(self, cid: str, other_cid: str) -> int:
        """Mark all unread messages received by `cid` from `other_cid` as read."""
        my_cid = str(cid).strip().lower()
        partner_cid = str(other_cid).strip().lower()
        c_key = conversation_key(my_cid, partner_cid)
        now = time.time()
        updated_count = 0

        with self.lock:
            for m in self.messages:
                if m["conversation_id"] == c_key and m["to_cid"] == my_cid and not m.get("read_at"):
                    m["read_at"] = now
                    updated_count += 1
            if updated_count > 0:
                self._save()

        return updated_count

    def get_unread_count(self, cid: str) -> int:
        """Get total number of unread messages across all conversations for `cid`."""
        my_cid = str(cid).strip().lower()
        with self.lock:
            return sum(1 for m in self.messages if m["to_cid"] == my_cid and not m.get("read_at"))


# Global singleton instance for Sentinel
crew_messages = MessagesStore()
