// WebAudio square-wave tones for buzzers.

export class ToneOutput {
  private ctx: AudioContext | null = null;
  private voices = new Map<string, { osc: OscillatorNode; gain: GainNode }>();
  muted = false;

  /** Must be called from a user gesture (e.g. the Run button). */
  unlock() {
    if (!this.ctx) {
      try { this.ctx = new AudioContext(); } catch { return; }
    }
    void this.ctx.resume();
  }

  update(tones: Map<string, number>) {
    if (!this.ctx) return;
    for (const [id, v] of this.voices) {
      if (!tones.has(id) || this.muted) {
        v.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.01);
        v.osc.stop(this.ctx.currentTime + 0.05);
        this.voices.delete(id);
      }
    }
    if (this.muted) return;
    for (const [id, f] of tones) {
      const freq = Math.max(20, Math.min(12000, f));
      let v = this.voices.get(id);
      if (!v) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        gain.gain.value = 0;
        gain.gain.setTargetAtTime(0.04, this.ctx.currentTime, 0.005);
        osc.connect(gain).connect(this.ctx.destination);
        osc.start();
        v = { osc, gain };
        this.voices.set(id, v);
      }
      if (Math.abs(v.osc.frequency.value - freq) > 0.5) v.osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    }
  }

  stopAll() { this.update(new Map()); }
}
