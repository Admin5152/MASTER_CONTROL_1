// Client view of the backend state. Polls every 500 ms (no WebSockets, per spec).
import { api } from "./api.js";
import { emit } from "./bus.js";

export const view = {
  crewId: null,
  crew: [],
  state: null,
  aux: null,
  online: null,
  identitySource: "manual",
  scenarioSeq: 0,
  sessionStart: Date.now(),
};

let timer = null;
let failures = 0;
let inflight = false;

export function setCrew(id, source = "manual") {
  if (!id) return;
  const changed = id !== view.crewId;
  view.crewId = id;
  view.identitySource = source;
  if (changed) emit("crew:changed", id);
  pollOnce();
}

export async function pollOnce() {
  if (!view.crewId || inflight) return;
  inflight = true;
  try {
    const [s, a] = await Promise.all([api.state(view.crewId), api.aux(view.crewId)]);
    view.state = s;
    view.aux = a;
    failures = 0;
    if (!view.online) { view.online = true; emit("online"); }
    emit("state", view);
  } catch (err) {
    failures += 1;
    if (failures >= 2 && view.online !== false) { view.online = false; emit("offline", err); }
  } finally {
    inflight = false;
  }
}

export function startPolling() {
  if (timer) return;
  timer = setInterval(pollOnce, 500);
  pollOnce();
}

export async function patch(p) {
  if (!view.crewId) return null;
  const s = await api.patch(view.crewId, p);
  view.state = s;
  emit("state", view);
  return s;
}
