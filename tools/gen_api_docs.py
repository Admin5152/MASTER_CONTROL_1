"""Regenerate the endpoint tables in docs/API.md from server.py, so the reference never drifts from the code.

    .venv\\Scripts\\python tools\\gen_api_docs.py

Everything in docs/API.md above the line "<!-- ROUTES:BEGIN -->" is hand-written and kept; the tables between the
BEGIN and END markers are rewritten from the route decorators and the first line of each handler's docstring.
"""
from __future__ import annotations

import ast
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOC = ROOT / "docs" / "API.md"
BEGIN, END = "<!-- ROUTES:BEGIN -->", "<!-- ROUTES:END -->"

# area -> path prefixes (first match wins); the order is the order in the document
AREAS = [
    ("System and session", ["/api/health", "/api/warm", "/api/pin", "/api/pair", "/api/clock", "/api/audit", "/api/scenario", "/api/cabin"]),
    ("Crew and state", ["/api/crew", "/api/state", "/api/aux", "/api/assessment", "/api/history", "/api/record", "/api/log", "/api/context"]),
    ("Readings, devices and the pipeline", ["/api/reading", "/api/device", "/api/devices", "/api/scan", "/api/scans", "/api/indicators", "/api/pipeline", "/api/baselines", "/api/indicator", "/api/pattern", "/api/trends", "/api/pulse", "/api/skin"]),
    ("Brain and voice", ["/api/chat", "/api/stt", "/api/tts", "/api/voices", "/api/identify", "/api/enrol", "/api/face", "/api/card", "/api/symptom"]),
    ("Local languages (Khaya AI)", ["/api/lang", "/api/twi"]),
    ("Alerts and notifications", ["/api/alerts", "/api/notifications", "/api/safety"]),
    ("Care, protocols and the clinic", ["/api/care", "/api/protocols", "/api/kit", "/api/clinic", "/api/plan", "/api/exercise", "/api/eyes", "/api/records"]),
    ("Mission, EVA and ground", ["/api/ops", "/api/suit", "/api/environment", "/api/ground", "/api/digest", "/api/radiation", "/api/spaceweather"]),
    ("Profile and onboarding", ["/api/profile", "/api/onboarding"]),
    ("Wellbeing and crew comms", ["/api/wellbeing", "/api/messages", "/api/race"]),
    ("NASA dataset", ["/api/dataset"]),
]


def routes() -> list[tuple[str, str, str]]:
    tree = ast.parse((ROOT / "server.py").read_text(encoding="utf-8"))
    out = []
    for n in ast.walk(tree):
        if not isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for d in n.decorator_list:
            if not (isinstance(d, ast.Call) and getattr(d.func, "attr", "") in ("get", "post", "put", "delete", "patch", "api_route")):
                continue
            path = d.args[0].value if d.args and isinstance(d.args[0], ast.Constant) else ""
            if not path.startswith("/api"):
                continue
            method = d.func.attr.upper()
            if method == "API_ROUTE":
                method = ", ".join(e.value for kw in d.keywords if kw.arg == "methods" for e in kw.value.elts if e.value != "OPTIONS")
            doc = (ast.get_docstring(n) or "").strip().split("\n\n")[0].replace("\n", " ")
            doc = re.sub(r"\s+", " ", doc)
            out.append((path, method, doc))
    return sorted(set(out))


def area_of(path: str) -> str:
    for name, prefixes in AREAS:
        if any(path == p or path.startswith(p + "/") or path.startswith(p + "?") for p in prefixes):
            return name
    return "Other"


def tables() -> str:
    rs = routes()
    groups: dict[str, list] = {}
    for r in rs:
        groups.setdefault(area_of(r[0]), []).append(r)
    order = [a for a, _ in AREAS] + ["Other"]
    lines = [f"_{len(rs)} endpoints, generated from `server.py` by `tools/gen_api_docs.py`. `{{cid}}` is a crew member's id "
             "(`GET /api/crew` lists them)._", ""]
    for a in order:
        if a not in groups:
            continue
        lines += [f"### {a}", "", "| Method | Path | What it does |", "| --- | --- | --- |"]
        for path, method, doc in groups[a]:
            lines.append(f"| {method} | `{path}` | {doc.replace('|', '/') or '—'} |")
        lines.append("")
    return "\n".join(lines)


def main() -> None:
    text = DOC.read_text(encoding="utf-8")
    a, b = text.index(BEGIN) + len(BEGIN), text.index(END)
    DOC.write_text(text[:a] + "\n\n" + tables() + "\n" + text[b:], encoding="utf-8", newline="\n")
    print(f"docs/API.md: {len(routes())} endpoints")


if __name__ == "__main__":
    main()
