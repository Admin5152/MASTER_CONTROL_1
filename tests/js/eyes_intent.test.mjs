// The daily eye check is reachable by voice; "how are my eyes" still points at the body.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchIntent } from "../../app/js/core/intents.js";

test("eye check phrases open the eye check", () => {
  for (const t of ["eye check", "check my eyes", "do my eye check", "SANS check", "scan my eyes", "can you test my eyes"]) {
    assert.deepEqual(matchIntent(t)?.commands, [{ cmd: "open_screen", name: "eyes" }], t);
  }
  assert.equal(matchIntent("how are my eyes")?.commands?.[0]?.cmd, "point_to");
});
