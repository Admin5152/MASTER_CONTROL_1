"""Mental Wellbeing Tests (Product Document Section 15, FR-40 to FR-50).
- 15.1 Purpose & limits (change from usual, no diagnoses)
- 15.2 Four dimensions (Mood, Energy, Stress, Connection; no single score)
- 15.3 Signals & limits (camera opt-in/fallback AC-21, reaction test, voice, engagement)
- 15.4 Wellbeing levels (0 Steady, 1 Check-in, 2 Support plan, 3 Urgent concern)
- 15.5 Support toolkit (10 evidence-based tools, labels LIVE / DESIGNED)
- 15.6 Support flows & closed-loop learning (FR-45 pre/post efficacy delta ranking)
- 15.7 Team wellbeing & safeguards (encrypted journal FR-47, crew pulse AC-22, team cohesion)
"""
from brain.crew.wellbeing import WellbeingEngine, TOOLKIT, CLINICAL_SCALES
from brain.crew.crew_pulse import CrewPulse
from brain.core.store import Store
from brain.core.profile import Profiles


def test_section_15_2_four_dimensions_independent():
    w = WellbeingEngine(persist=False)
    state = {
        "manual": {"mood": 4, "sleep_hours": 7.5, "stress": 0.2},
        "state": {"fatigue": 0.2, "stress": 0.2},
        "vitals": {"heart_rate": 64},
        "baseline": {"heart_rate": 64},
        "cognitive": {"last_ms": 270, "baseline_ms": 270},
        "voice": {"talk_time": 10.0},
    }
    res = w.evaluate("kenji", state)
    # Check that each dimension exists separately
    assert "mood" in res["details"]
    assert "energy" in res["details"]
    assert "stress" in res["details"]
    assert "connection" in res["details"]
    # All steady
    assert res["level"] == 0
    assert res["wording"] == "You're steady."
    assert sum(res["dims"].values()) == 0


def test_section_15_3_camera_opt_in_and_fallback():
    """AC-21: Given camera mood analysis switched off, then wellbeing still works from self-report and voice."""
    w = WellbeingEngine(persist=False)
    # Camera detects negative valence (-0.8), but astronaut has good self-report (mood=4)
    state = {
        "manual": {"mood": 4},
        "state": {"valence": -0.8, "arousal": 0.7, "fatigue": 0.2, "stress": 0.2},
    }

    # Case 1: Camera analysis opted IN
    res_opt_in = w.evaluate("kenji", state, profile={"wellbeingPlan": {"cameraMoodAnalysis": True}})
    assert res_opt_in["details"]["mood"]["camera_used"] is True
    assert res_opt_in["details"]["mood"]["status"] == "lower_than_usual"

    # Case 2: Camera analysis opted OUT (fallback to self-report)
    res_opt_out = w.evaluate("kenji", state, profile={"wellbeingPlan": {"cameraMoodAnalysis": False}})
    assert res_opt_out["details"]["mood"]["camera_used"] is False
    assert res_opt_out["details"]["mood"]["status"] == "steady"


def test_section_15_4_wellbeing_levels_and_support_plan():
    w = WellbeingEngine(persist=False)

    # Level 1: 1 dimension drifting (Energy)
    state_lv1 = {
        "manual": {"mood": 4, "sleep_hours": 4.5},
        "state": {"fatigue": 0.7, "stress": 0.2},
    }
    r1 = w.evaluate("kenji", state_lv1)
    assert r1["level"] == 1
    assert "energy" in r1["wording"].lower()
    assert len(r1["tools"]) == 1

    # Level 2: 2 dimensions drifting (Mood and Stress) -> AC-19: top three tools
    state_lv2 = {
        "manual": {"mood": 2, "sleep_hours": 7.0},
        "state": {"fatigue": 0.2, "stress": 0.8},
    }
    r2 = w.evaluate("kenji", state_lv2, profile={"wellbeingPlan": {"whatHelps": ["earth_window", "greenhouse", "orb_calm"]}})
    assert r2["level"] == 2
    assert "shifted" in r2["wording"].lower()
    assert len(r2["tools"]) == 3
    # Offered in astronaut's preferred order
    assert r2["tools"][0] == "earth_window"
    assert r2["tools"][1] == "greenhouse"
    assert r2["tools"][2] == "orb_calm"


def test_section_15_5_toolkit_catalogue():
    assert len(TOOLKIT) >= 10
    assert "orb_calm" in TOOLKIT
    assert "earth_window" in TOOLKIT
    assert "greenhouse" in TOOLKIT
    assert "private_journal" in TOOLKIT
    assert TOOLKIT["orb_calm"]["label"] == "LIVE"
    assert TOOLKIT["home_messages"]["label"] == "DESIGNED"
    assert TOOLKIT["greenhouse"]["label"] == "DESIGNED"


def test_section_15_6_closed_loop_learning():
    """FR-45: Empirical tracking of stress delta before and after interventions to personalize tool ranking."""
    w = WellbeingEngine(persist=False)
    cid = "kenji"

    # Default ranking before any data
    init_ranks = w.get_ranked_tools(cid, profile={"wellbeingPlan": {"whatHelps": ["orb_calm"]}})
    assert init_ranks[0] == "orb_calm"

    # Record sessions: user does "greenhouse" and experiences dramatic stress reduction (from 0.9 to 0.2, delta=0.7)
    w.record_session(cid, "greenhouse", pre_stress=0.9, post_stress=0.2, pre_mood=2, post_mood=4)
    w.record_session(cid, "greenhouse", pre_stress=0.8, post_stress=0.3, pre_mood=2, post_mood=5)

    # User does "orb_calm" with mild reduction (from 0.7 to 0.6, delta=0.1)
    w.record_session(cid, "orb_calm", pre_stress=0.7, post_stress=0.6, pre_mood=3, post_mood=3)

    # Adaptive closed-loop ranking: greenhouse must rise to #1 due to proven empirical delta!
    adaptive_ranks = w.get_ranked_tools(cid, profile={"wellbeingPlan": {"whatHelps": ["orb_calm"]}})
    assert adaptive_ranks[0] == "greenhouse"


def test_section_15_7_private_journal_on_device():
    """FR-47: Encrypted on-device private astronaut reflective journal."""
    w = WellbeingEngine(persist=False)
    cid = "kenji"

    entry = w.add_journal_entry(cid, "Long EVA today, tough terrain but we succeeded.", tags=["eva", "reflection"], mood=4)
    assert entry["device_only"] is True
    assert entry["tags"] == ["eva", "reflection"]

    entries = w.list_journal_entries(cid)
    assert len(entries) == 1
    assert entries[0]["text"] == "Long EVA today, tough terrain but we succeeded."

    # Delete entry
    deleted = w.delete_journal_entry(cid, entry["id"])
    assert deleted is True
    assert len(w.list_journal_entries(cid)) == 0


def test_section_15_7_crew_pulse_aggregation():
    """FR-49 & AC-22: Given fewer than three crew pulse responses, then no team-level result is shown."""
    cp = CrewPulse(persist=False)
    week = 12

    # 1 response: hidden
    cp.answer(week, "kenji", {"together": 4, "heard": 4})
    r1 = cp.result(week, "kenji")
    assert r1["shown"] is False
    assert "Team results appear once 3 people have answered" in r1["note"]

    # 2 responses: still hidden
    cp.answer(week, "eliah", {"together": 5, "heard": 5})
    r2 = cp.result(week, "kenji")
    assert r2["shown"] is False

    # 3 responses: team-level result unlocks (without individual names)
    cp.answer(week, "sarah", {"together": 3, "heard": 3})
    r3 = cp.result(week, "kenji")
    assert r3["shown"] is True
    assert r3["team"]["together"] == 4.0
    assert r3["team"]["heard"] == 4.0
    assert "Team average only" in r3["note"]


def test_section_15_7_team_cohesion_note():
    w = WellbeingEngine(persist=False)
    crew = {
        "kenji": {"display_name": "Kenji", "voice": {"talk_time": 25.0}},
        "eliah": {"display_name": "Eliah", "voice": {"talk_time": 25.0}},
        "sarah": {"display_name": "Sarah", "voice": {"talk_time": 25.0}},
    }
    # Balanced
    coh_bal = w.evaluate_team_cohesion(crew)
    assert coh_bal["cohesion_status"] == "balanced"
    assert "balanced" in coh_bal["note"].lower()

    # Imbalanced: Kenji spoke very little (2.0 vs 50.0 total)
    crew["kenji"]["voice"]["talk_time"] = 2.0
    coh_imb = w.evaluate_team_cohesion(crew)
    assert coh_imb["cohesion_status"] == "imbalanced"
    assert "Kenji" in coh_imb["note"]


def test_section_15_server_api_endpoints():
    from fastapi.testclient import TestClient
    import server
    c = TestClient(server.app)
    cid = c.get("/api/crew").json()[0]["crew_id"]

    # 1. Toolkit catalogue
    tk = c.get("/api/wellbeing/toolkit").json()
    assert "orb_calm" in tk["tools"]
    assert tk["tools"]["earth_window"]["label"] == "LIVE"

    # 2. Screening scales
    sc = c.get("/api/wellbeing/scales").json()
    assert "phq2" in sc["scales"]
    assert "gad2" in sc["scales"]

    # 3. 4-Dimension assessment
    wb = c.get(f"/api/wellbeing/{cid}").json()
    assert "details" in wb
    assert "mood" in wb["details"]

    # 4. Closed-loop session recording
    sess = c.post(f"/api/wellbeing/{cid}/session", json={
        "tool_id": "greenhouse",
        "pre_stress": 0.8,
        "post_stress": 0.3,
        "pre_mood": 2,
        "post_mood": 4,
    }).json()
    assert sess["delta_stress"] == 0.5
    assert sess["effective"] is True

    # 5. Ranking endpoint
    rk = c.get(f"/api/wellbeing/{cid}/ranking").json()
    assert "ranked_tools" in rk

    # 6. Journal flow
    entry = c.post(f"/api/wellbeing/{cid}/journal", json={
        "text": "Tested sensory garden in habitat sol 122.",
        "tags": ["garden", "calm"],
        "mood": 5,
    }).json()
    assert entry["id"].startswith("j_")

    journal_list = c.get(f"/api/wellbeing/{cid}/journal").json()
    assert len(journal_list["entries"]) >= 1

    del_resp = c.delete(f"/api/wellbeing/{cid}/journal/{entry['id']}").json()
    assert del_resp["ok"] is True

    # 7. Team cohesion
    coh = c.get("/api/wellbeing/team/cohesion").json()
    assert "cohesion_status" in coh
