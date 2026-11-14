// Voice-activity detector (brief section 4.1). Pure: no DOM, tested with node --test.
// Each 20 ms frame is "speech" when its energy is well above an adaptive noise floor and its
// zero-crossing rate is in the range of voice (not hiss). An utterance starts after a few speech
// frames in a row and ends after a hangover of silence, or at the maximum length.

export const VAD_DEFAULTS = {
  frameMs: 20,
  startFrames: 3,       // consecutive speech frames to open an utterance (60 ms)
  hangMs: 560,          // silence that closes it (shorter = a faster reply; longer cuts fewer mid-sentence pauses)
  maxMs: 15000,         // hard cap on one utterance
  minMs: 350,           // shorter bursts (clicks, coughs) are dropped
  floorInit: 0.004,     // starting noise floor (RMS)
  ratio: 3.0,           // speech must be this many times the floor
  minRms: 0.01,         // and at least this loud
  zcrMax: 0.42,         // above this the frame is hiss, not voice
};

export function frameRms(x, from = 0, to = x.length) {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, to - from));
}

export function frameZcr(x, from = 0, to = x.length) {
  let z = 0;
  for (let i = from + 1; i < to; i++) if ((x[i - 1] >= 0) !== (x[i] >= 0)) z++;
  return z / Math.max(1, to - from - 1);
}

/** A streaming VAD. push(samples) returns the events it produced: {type:"start"|"end"|"drop", at, from, to}
 *  where at/from/to count samples since the VAD was created. */
export function createVad(rate, opts = {}) {
  const o = { ...VAD_DEFAULTS, ...opts };
  const N = Math.max(1, Math.round((rate * o.frameMs) / 1000));
  const hangFrames = Math.ceil(o.hangMs / o.frameMs), maxFrames = Math.ceil(o.maxMs / o.frameMs), minFrames = Math.ceil(o.minMs / o.frameMs);
  let floor = o.floorInit, run = 0, inSpeech = false, silent = 0, startFrame = 0, frameNo = 0, lastSpeech = 0;
  const buf = new Float32Array(N);
  let fill = 0;
  const st = { get floor() { return floor; }, get active() { return inSpeech; }, level: 0 };

  function frame(events) {
    const rms = frameRms(buf), zcr = frameZcr(buf);
    st.level = rms;
    const speech = rms > Math.max(floor * o.ratio, o.minRms) && zcr < o.zcrMax;
    if (!inSpeech) {
      // the floor follows the room only while nobody is talking
      if (!speech) floor = Math.max(1e-4, floor * 0.96 + Math.min(rms, floor * 2.5) * 0.04);
      run = speech ? run + 1 : 0;
      if (run >= o.startFrames) {
        inSpeech = true; silent = 0; startFrame = frameNo - run + 1; lastSpeech = frameNo;
        events.push({ type: "start", at: startFrame * N });
      }
    } else {
      if (speech) { silent = 0; lastSpeech = frameNo; } else silent++;
      const len = frameNo - startFrame + 1;
      if (silent >= hangFrames || len >= maxFrames) {
        inSpeech = false; run = 0;
        const voiced = lastSpeech - startFrame + 1;
        events.push({ type: voiced >= minFrames ? "end" : "drop", at: (frameNo + 1) * N, from: startFrame * N, to: (lastSpeech + 1) * N, capped: len >= maxFrames });
      }
    }
    frameNo++;
  }

  st.push = (x) => {
    const events = [];
    for (let i = 0; i < x.length; i++) {
      buf[fill++] = x[i];
      if (fill === N) { frame(events); fill = 0; }
    }
    return events;
  };
  st.reset = () => { inSpeech = false; run = 0; silent = 0; };
  return st;
}

/** Whole-signal segmentation (for tests and offline use): [{from, to}] in samples. */
export function segment(samples, rate, opts = {}) {
  const v = createVad(rate, opts);
  const out = [];
  for (const e of v.push(samples)) if (e.type === "end") out.push({ from: e.from, to: e.to, capped: !!e.capped });
  return out;
}
