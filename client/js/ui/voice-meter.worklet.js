// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The microphone, where the sound is (the audio thread): every 20 ms its loudness (RMS), how long that was, and the sound
// itself made small (16 kHz, 16-bit — what voice services hear) — sent to the page in order (voice.js Mic → LiveEar →
// voice-core.js TurnTaker). A page busy drawing the world reads these late — seconds late on a slow device — but in order
// and each with its own length, so a pause is timed by the sound itself and a turn ends exactly where its pause began:
// words said while the page was busy are neither lost nor taken into the wrong turn.
const OUT_RATE = 16000;

class VoiceMeter extends AudioWorkletProcessor {
  constructor(o) {
    super();
    const ms = Number(o && o.processorOptions && o.processorOptions.ms) || 20;
    this.block = Math.max(128, Math.round(ms * sampleRate / 1000));
    this.n = 0; this.sum = 0;
    // (to 16 kHz: each output sample the mean of the input samples it covers — a simple low-pass enough for speech)
    this.step = sampleRate / OUT_RATE; this.acc = 0; this.cnt = 0; this.pos = 0;
    this.out = new Int16Array(Math.ceil(this.block / this.step) + 8); this.k = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    const len = ch ? ch.length : 128;
    for (let i = 0; i < len; i++) {
      const v = ch ? ch[i] : 0;
      this.sum += v * v;
      this.acc += v; this.cnt++; this.pos++;
      if (this.pos >= this.step) {
        this.pos -= this.step;
        const m = this.acc / this.cnt;
        if (this.k < this.out.length) this.out[this.k++] = Math.max(-32768, Math.min(32767, Math.round(m * 32767)));
        this.acc = 0; this.cnt = 0;
      }
    }
    this.n += len;
    if (this.n >= this.block) {
      const pcm = this.out.slice(0, this.k);
      this.port.postMessage([Math.sqrt(this.sum / this.n), this.n / sampleRate * 1000, pcm], [pcm.buffer]);
      this.n = 0; this.sum = 0; this.k = 0;
    }
    return true;
  }
}
registerProcessor('mvw-voice-meter', VoiceMeter);
