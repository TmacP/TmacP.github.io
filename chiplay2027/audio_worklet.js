/*
  educe — AudioWorklet synth processor.

  Runs the game's synth on the browser's real-time AUDIO THREAD instead of the
  main thread. Replaces the deprecated ScriptProcessorNode path in main.js.

  WHY THIS EXISTS
  A Chrome profile of arfid showed `audioNode.onaudioprocess` at 1,160ms — the
  single largest application cost in the trace, ~25% of all busy main-thread CPU,
  arriving as a ~1.4ms spike every 46ms right in the middle of the frame budget.
  ScriptProcessorNode is deprecated precisely because of this: the audio callback
  and the render loop contend for one thread, so a long frame causes an audible
  dropout and a long mix causes a dropped frame. Moving to a worklet removes the
  cost from the frame budget entirely rather than just making it smaller.

  HOW THE WASM GETS HERE
  A worklet cannot fetch(). The main thread fetches both blobs and hands them over
  through processorOptions (structured-cloned into this scope). We compile
  SYNCHRONOUSLY here with `new WebAssembly.Module(bytes)` — off the main thread
  that is permitted at any size, and passing raw bytes rather than a pre-compiled
  Module sidesteps any structured-clone-of-Module support questions. The module is
  ~23KB; the one-off compile happens before audio flows.

  This is a SECOND, synth-only wasm — not the 26MB game module. See
  games/arfid/platform/web_audio.cpp for why that separation is what makes the
  whole approach possible without SharedArrayBuffer / COOP+COEP.

  BLOCK SIZE
  One render call per 128-frame quantum, no intermediate ring buffer. Measured
  cost is ~2.7% of the block deadline and is FLAT across block sizes from 128 to
  2048 frames — the synth has no meaningful per-block fixed cost — so there is
  nothing to amortise and batching would only add latency and burstiness.
*/

const EXPECTED_SAMPLE_RATE = 44100;

// The synth's math imports. Everything else it needs (sqrt/floor/abs/min/max)
// compiles to native wasm opcodes — see engine/web/math.h. Keep this list in
// sync with the module's import section if the synth gains a new transcendental.
function mathImports() {
  return {
    sinf: Math.sin, cosf: Math.cos, tanf: Math.tan,
    asinf: Math.asin, acosf: Math.acos, atan2f: Math.atan2,
    powf: Math.pow, expf: Math.exp, logf: Math.log, log2f: Math.log2,
    coshf: Math.cosh, tanhf: Math.tanh,
    fmodf: (a, b) => a % b,
    // Cold |x| > 2^23 fallbacks — see engine/web/web_math_native.h. sinf/cosf
    // themselves are native in the module now; these are mandatory imports all
    // the same, so they must stay even though the synth never reaches them.
    _wm_sin_big: Math.sin, _wm_cos_big: Math.cos,
    sin: Math.sin, cos: Math.cos, tan: Math.tan, atan2: Math.atan2,
    pow: Math.pow, exp: Math.exp, log: Math.log, log2: Math.log2,
    fmod: (a, b) => a % b,
  };
}

class EduceSynthProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ready = false;
    this.failed = null;
    this.outPtr = 0;
    this.maxFrames = 0;
    this.i16 = null;        // cached Int16Array view over the wasm output buffer
    this.underruns = 0;

    const opts = (options && options.processorOptions) || {};
    try {
      this.boot(opts.wasmBytes, opts.esmBytes);
    } catch (e) {
      this.failed = String((e && e.message) || e);
    }

    // One status message back to main.js. main.js logs it; it is the only way to
    // see a worklet failure, since a throw in here is otherwise silent and just
    // yields permanent silence.
    this.port.postMessage({
      type: 'status',
      ready: this.ready,
      error: this.failed,
      sampleRate,                                  // worklet global
      sampleRateMismatch: sampleRate !== EXPECTED_SAMPLE_RATE,
    });
  }

  boot(wasmBytes, esmBytes) {
    if (!wasmBytes || !esmBytes) throw new Error('missing wasmBytes/esmBytes');

    const module = new WebAssembly.Module(wasmBytes);
    const instance = new WebAssembly.Instance(module, { env: mathImports() });
    const x = instance.exports;
    this.x = x;
    this.memory = x.memory;

    // Deposit the .esm into the module's own memory, then let it load. The wasm
    // keeps the blob permanently because SynthLoadESM's event pointers alias into
    // it (same reason arfid.cpp holds GArfidEsmData).
    const esm = new Uint8Array(esmBytes);
    const cap = x.ArfidAudioEsmCapacity();
    if (esm.length > cap) throw new Error(`esm ${esm.length} > capacity ${cap}`);
    new Uint8Array(this.memory.buffer, x.ArfidAudioEsmDest(), esm.length).set(esm);

    if (!x.ArfidAudioInit(esm.length)) throw new Error('ArfidAudioInit rejected the .esm');

    this.outPtr = x.ArfidAudioOutPtr();
    this.maxFrames = x.ArfidAudioMaxFrames();
    this.ready = true;
  }

  // The module never grows its memory (everything is static, no allocator), but a
  // detached buffer would throw on every quantum and kill audio silently — so
  // re-derive the view if the backing buffer identity ever changes.
  view(frames) {
    if (!this.i16 || this.i16.buffer !== this.memory.buffer || this.i16.length < frames * 2) {
      this.i16 = new Int16Array(this.memory.buffer, this.outPtr, this.maxFrames * 2);
    }
    return this.i16;
  }

  process(inputs, outputs) {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const L = out[0];
    const R = out.length > 1 ? out[1] : out[0];
    const frames = L.length;

    if (!this.ready) {
      L.fill(0);
      if (R !== L) R.fill(0);
      return true;   // stay alive: silence is correct, death is not recoverable
    }

    const got = this.x.ArfidAudioRender(frames);
    if (got < frames) {
      // Should not happen (frames is 128, max is 2048) but never emit garbage.
      L.fill(0);
      if (R !== L) R.fill(0);
      if (this.underruns++ === 0) this.port.postMessage({ type: 'underrun', got, frames });
      return true;
    }

    const s = this.view(frames);
    const k = 1 / 32768;
    for (let i = 0; i < frames; i++) {
      L[i] = s[i * 2] * k;
      R[i] = s[i * 2 + 1] * k;
    }
    return true;
  }
}

registerProcessor('educe-synth', EduceSynthProcessor);
