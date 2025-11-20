export class AudioBus {
  constructor() {
    this.context = null;
    this.master = null;
    this.bgm = null;
    this.sfx = null;
  }

  ensureContext() {
    if (!this.context) {
      this.context = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.context.createGain();
      this.bgm = this.context.createGain();
      this.sfx = this.context.createGain();
      this.bgm.connect(this.master);
      this.sfx.connect(this.master);
      this.master.connect(this.context.destination);
      this.master.gain.value = 0.9;
      this.bgm.gain.value = 0.75;
      this.sfx.gain.value = 0.9;
    }
    return this.context;
  }

  setMasterVolume(value) {
    this.ensureContext();
    this.master.gain.value = value;
  }

  setBgmVolume(value) {
    this.ensureContext();
    this.bgm.gain.value = value;
  }

  setSfxVolume(value) {
    this.ensureContext();
    this.sfx.gain.value = value;
  }

  async playBuffer(buffer, channel = 'sfx', options = {}) {
    this.ensureContext();
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    const gainNode = this[channel] || this.sfx;
    if (options.loop) source.loop = true;
    if (Number.isFinite(options.detune)) source.detune.value = options.detune;
    source.connect(gainNode);
    source.start();
    return source;
  }
}
