"""Personal health profile (section 14): completeness, the kit safety filter, privacy in the digest."""
from brain.profile import Profiles, kit_filter

ITEM = {"id": "ibuprofen", "name": "Ibuprofen (NSAID)"}


def test_completeness_grows_and_names_what_is_missing():
    p = Profiles(persist=False)
    first = p.get("a")
    assert first["completeness"] < 0.2 and "Allergies" in first["missing"]   # only the default reminder times are set
    later = p.update("a", {"callsign": "Ace", "health": {"allergies": ["none"]}, "sharing": {"buddy": "Seth"}})
    assert later["completeness"] > first["completeness"] and "Allergies" not in later["missing"]
    assert p.update("a", {"bogus": 1, "health": {"secret": 2}})["callsign"] == "Ace"   # unknown fields are ignored


def test_an_allergy_blocks_the_kit_item_with_the_reason():
    p = Profiles(persist=False)
    f = kit_filter(ITEM, p.update("a", {"health": {"allergies": ["ibuprofen"], "regularMedicines": ["none"]}}))
    assert f["blocked"] and "ibuprofen" in f["reason"]


def test_a_regular_medicine_adds_a_note_and_an_empty_profile_says_so():
    p = Profiles(persist=False)
    assert "check the label" in kit_filter(ITEM, p.get("x"))["note"].lower()
    f = kit_filter(ITEM, p.update("b", {"health": {"allergies": ["none"], "regularMedicines": ["warfarin"]}}))
    assert not f["blocked"] and "warfarin" in f["note"]


def test_delete_and_endpoints():
    from fastapi.testclient import TestClient
    import server
    c = TestClient(server.app)
    cid = c.get("/api/crew").json()[0]["crew_id"]
    assert c.patch(f"/api/profile/{cid}", json={"wellbeingPlan": {"whatHelps": ["orb_calm"]}}).json()["wellbeingPlan"]["whatHelps"] == ["orb_calm"]
    assert c.delete(f"/api/profile/{cid}").json()["completeness"] < 0.2
