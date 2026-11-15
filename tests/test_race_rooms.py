"""Slipstream multiplayer rooms."""
import pytest

from brain.crew.race_rooms import PLAYER_TTL_S, RaceRooms


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def test_create_join_start_race_and_finish():
    c = Clock()
    rr = RaceRooms(clock=c)
    room = rr.create("a", "James")
    code = room["code"]
    assert len(code) == 4 and room["host"] == "a" and room["status"] == "lobby"
    v = rr.join(code.lower(), "b", "Amara")
    assert {p["name"] for p in v["players"]} == {"James", "Amara"}
    assert len({p["color"] for p in v["players"]}) == 2
    with pytest.raises(PermissionError):
        rr.start(code, "b")
    v = rr.start(code, "a")
    assert v["status"] == "racing" and v["start_at"] > c.t
    with pytest.raises(ValueError):
        rr.join(code, "c", "Late")
    c.t += 5
    v = rr.update(code, "a", {"dist": 120.5, "x": 1, "y": -1, "lap": 2})
    me = next(p for p in v["players"] if p["id"] == "a")
    assert me["dist"] == 120.5 and me["lap"] == 2
    rr.update(code, "a", {"finished": 95.2})
    v = rr.update(code, "b", {"finished": 99.0})
    assert v["status"] == "done"


def test_silent_players_drop_out_and_host_moves_on_leave():
    c = Clock()
    rr = RaceRooms(clock=c)
    code = rr.create("a", "A")["code"]
    rr.join(code, "b", "B")
    rr.start(code, "a")
    c.t += PLAYER_TTL_S + 1
    v = rr.update(code, "a", {"dist": 1})
    assert [p["id"] for p in v["players"]] == ["a"]
    rr.leave(code, "a")
    with pytest.raises(KeyError):
        rr.update(code, "a", {})


def test_unknown_room():
    rr = RaceRooms()
    with pytest.raises(KeyError):
        rr.join("ZZZZ", "x", "X")
