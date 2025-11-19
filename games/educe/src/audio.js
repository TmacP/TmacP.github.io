// audio.js - Rich WebAudio MIDI synthesis for Educe game
import { bgm_midi } from './bgm_midi.js';

let audioCtx;
let scheduledTimeouts = [];
let isPlaying = false;
let masterGainNode;
let bgmGainNode;
let sfxGainNode;
let masterVolume = 0.3; // Global volume control
let bgmVolume = 1.0;
let sfxVolume = 1.0;

// Current synth patch (user-definable)
let currentSynthPatch = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // Create master gain node for global volume control
    masterGainNode = audioCtx.createGain();
    masterGainNode.gain.value = masterVolume;
    masterGainNode.connect(audioCtx.destination);

    // Create separate gain nodes for background music and sound effects
    bgmGainNode = audioCtx.createGain();
    bgmGainNode.gain.value = bgmVolume;
    bgmGainNode.connect(masterGainNode);

    sfxGainNode = audioCtx.createGain();
    sfxGainNode.gain.value = sfxVolume;
    sfxGainNode.connect(masterGainNode);
  }
  return audioCtx;
}

export function playMidiSong(loop = true) {
  stopMidiSong();
  const ctx = getAudioContext();
  
  // Resume context if suspended (required for user gesture compliance)
  if (ctx.state === 'suspended') {
    ctx.resume();
  }
  
  isPlaying = true;
  console.log(`Starting MIDI playback with ${bgm_midi.length} notes`);

  let maxEnd = 0;
  
  // Schedule all notes
  for (const note of bgm_midi) {
    maxEnd = Math.max(maxEnd, note.start + note.dur);
    
    const timeout = setTimeout(() => {
      if (!isPlaying) return;
      playSynthNote(ctx, note.freq, note.dur, note.gain, currentSynthPatch);
    }, note.start * 1000);
    
    scheduledTimeouts.push(timeout);
  }

  // Schedule loop if enabled
  if (loop) {
    const loopTimeout = setTimeout(() => {
      if (isPlaying) {
        console.log('Looping MIDI song...');
        playMidiSong(loop);
      }
    }, (maxEnd + 1.0) * 1000); // 1 second gap between loops
    
    scheduledTimeouts.push(loopTimeout);
  }
}

export function stopMidiSong() {
  isPlaying = false;
  scheduledTimeouts.forEach(t => clearTimeout(t));
  scheduledTimeouts = [];
  console.log('MIDI playback stopped');
}

export function setMasterVolume(volume) {
  masterVolume = Math.max(0, Math.min(1, volume));
  if (masterGainNode) {
    masterGainNode.gain.setValueAtTime(masterVolume, audioCtx.currentTime);
  }
}

export function getMasterVolume() {
  return masterVolume;
}

export function setBgmVolume(volume) {
  bgmVolume = Math.max(0, Math.min(1, volume));
  if (bgmGainNode) {
    bgmGainNode.gain.setValueAtTime(bgmVolume, audioCtx.currentTime);
  }
}

export function getBgmVolume() {
  return bgmVolume;
}

export function setSfxVolume(volume) {
  sfxVolume = Math.max(0, Math.min(1, volume));
  if (sfxGainNode) {
    sfxGainNode.gain.setValueAtTime(sfxVolume, audioCtx.currentTime);
  }
}

export function getSfxVolume() {
  return sfxVolume;
}

// Play a short footstep sound effect
export function playFootstep() {
  const ctx = getAudioContext();
  const now = ctx.currentTime;

  // Slight randomization for natural variation
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 80 + Math.random() * 40;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.5, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

  osc.connect(gain);
  gain.connect(sfxGainNode);

  osc.start(now);
  osc.stop(now + 0.25);
}

export function playDinoRoar() {
  const ctx = getAudioContext();
  const now = ctx.currentTime;

  // --- Loud, punchy, oink-like dino grunt ---

  // Main grunt body (sawtooth for bite)
  const osc1 = ctx.createOscillator();
  osc1.type = 'sawtooth';
  osc1.frequency.setValueAtTime(110, now);
  osc1.frequency.linearRampToValueAtTime(80, now + 0.13);
  osc1.frequency.linearRampToValueAtTime(60, now + 0.22);

  // Mid/high overtone (square for nasal/oink character)
  const osc2 = ctx.createOscillator();
  osc2.type = 'square';
  osc2.frequency.setValueAtTime(220, now);
  osc2.frequency.linearRampToValueAtTime(180, now + 0.09);
  osc2.frequency.linearRampToValueAtTime(120, now + 0.18);

  // Short noise burst for percussive attack
  const noise = ctx.createBufferSource();
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.18, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) * 0.5;
  }
  noise.buffer = buffer;

  // Gain envelopes
  // Main grunt: fast attack, short decay
  const gain1 = ctx.createGain();
  gain1.gain.setValueAtTime(0, now);
  gain1.gain.linearRampToValueAtTime(0.18, now + 0.01);
  gain1.gain.linearRampToValueAtTime(0.13, now + 0.09);
  gain1.gain.linearRampToValueAtTime(0.01, now + 0.22);
  gain1.gain.linearRampToValueAtTime(0, now + 0.28);

  // Overtone: quick, nasal, fades fast
  const gain2 = ctx.createGain();
  gain2.gain.setValueAtTime(0, now);
  gain2.gain.linearRampToValueAtTime(0.13, now + 0.02);
  gain2.gain.linearRampToValueAtTime(0.09, now + 0.11);
  gain2.gain.linearRampToValueAtTime(0, now + 0.19);

  // Noise: percussive, very short
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0, now);
  noiseGain.gain.linearRampToValueAtTime(0.12, now + 0.01);
  noiseGain.gain.linearRampToValueAtTime(0, now + 0.09);

  // Connect layers
  osc1.connect(gain1);
  osc2.connect(gain2);
  noise.connect(noiseGain);

  gain1.connect(sfxGainNode);
  gain2.connect(sfxGainNode);
  noiseGain.connect(sfxGainNode);

  // Start and stop
  osc1.start(now);
  osc2.start(now);
  noise.start(now);

  osc1.stop(now + 0.28);
  osc2.stop(now + 0.19);
  noise.stop(now + 0.09);
}

// Dino spots the player - alert growl
export function playDinoSpotted() {
  const ctx = getAudioContext();
  const now = ctx.currentTime;

  // Sharp, alerting growl when dino spots player
  const osc1 = ctx.createOscillator();
  osc1.type = 'sawtooth';
  osc1.frequency.setValueAtTime(180, now);
  osc1.frequency.exponentialRampToValueAtTime(220, now + 0.1);
  osc1.frequency.exponentialRampToValueAtTime(160, now + 0.3);

  const osc2 = ctx.createOscillator();
  osc2.type = 'square';
  osc2.frequency.setValueAtTime(90, now);
  osc2.frequency.exponentialRampToValueAtTime(110, now + 0.15);

  const gain1 = ctx.createGain();
  gain1.gain.setValueAtTime(0, now);
  gain1.gain.linearRampToValueAtTime(0.3, now + 0.05);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

  const gain2 = ctx.createGain();
  gain2.gain.setValueAtTime(0, now);
  gain2.gain.linearRampToValueAtTime(0.2, now + 0.03);
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

  osc1.connect(gain1);
  osc2.connect(gain2);
  gain1.connect(sfxGainNode);
  gain2.connect(sfxGainNode);

  osc1.start(now);
  osc2.start(now);
  osc1.stop(now + 0.4);
  osc2.stop(now + 0.35);
}

// Dino preparing to charge - menacing windup sound
export function playDinoChargeWindup() {
  // const ctx = getAudioContext();
  // const now = ctx.currentTime;

  // // Deep menacing growl that builds in intensity
  // const osc1 = ctx.createOscillator();
  // osc1.type = 'sawtooth';
  // osc1.frequency.setValueAtTime(45, now);
  // osc1.frequency.exponentialRampToValueAtTime(85, now + 0.4);
  // osc1.frequency.exponentialRampToValueAtTime(120, now + 0.8);

  // // Mid-range snarl
  // const osc2 = ctx.createOscillator();
  // osc2.type = 'square';
  // osc2.frequency.setValueAtTime(90, now);
  // osc2.frequency.exponentialRampToValueAtTime(140, now + 0.5);
  // osc2.frequency.exponentialRampToValueAtTime(180, now + 0.8);

  // // Higher growl harmonics
  // const osc3 = ctx.createOscillator();
  // osc3.type = 'sawtooth';
  // osc3.frequency.setValueAtTime(180, now + 0.2);
  // osc3.frequency.exponentialRampToValueAtTime(280, now + 0.6);
  // osc3.frequency.exponentialRampToValueAtTime(320, now + 0.8);

  // // Gain envelopes - building intensity
  // const gain1 = ctx.createGain();
  // gain1.gain.setValueAtTime(0, now);
  // gain1.gain.linearRampToValueAtTime(0.4, now + 0.1);
  // gain1.gain.setValueAtTime(0.4, now + 0.7);
  // gain1.gain.exponentialRampToValueAtTime(0.001, now + 1.0);

  // const gain2 = ctx.createGain();
  // gain2.gain.setValueAtTime(0, now);
  // gain2.gain.linearRampToValueAtTime(0.3, now + 0.2);
  // gain2.gain.linearRampToValueAtTime(0.5, now + 0.8);
  // gain2.gain.exponentialRampToValueAtTime(0.001, now + 1.0);

  // const gain3 = ctx.createGain();
  // gain3.gain.setValueAtTime(0, now + 0.2);
  // gain3.gain.linearRampToValueAtTime(0.2, now + 0.4);
  // gain3.gain.linearRampToValueAtTime(0.4, now + 0.8);
  // gain3.gain.exponentialRampToValueAtTime(0.001, now + 1.0);

  // // Connect oscillators
  // osc1.connect(gain1);
  // osc2.connect(gain2);
  // osc3.connect(gain3);
  
  // gain1.connect(sfxGainNode);
  // gain2.connect(sfxGainNode);
  // gain3.connect(sfxGainNode);

  // // Start and stop oscillators
  // osc1.start(now);
  // osc2.start(now);
  // osc3.start(now + 0.2);
  
  // osc1.stop(now + 1.0);
  // osc2.stop(now + 1.0);
  // osc3.stop(now + 1.0);
}

// Dino charging attack - fast whoosh with impact
export function playDinoCharge() {
  const ctx = getAudioContext();
  const now = ctx.currentTime;

  // Fast whoosh sound
  const noise = ctx.createBufferSource();
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  
  // Generate white noise and filter it
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * 0.5;
  }
  noise.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(2000, now);
  filter.frequency.exponentialRampToValueAtTime(800, now + 0.3);
  filter.Q.value = 10;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.6, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(sfxGainNode);

  noise.start(now);
  noise.stop(now + 0.4);
}

// Dino attack impact - aggressive hit sound
export function playDinoAttack() {
  const ctx = getAudioContext();
  const now = ctx.currentTime;

  // Sharp attack sound with multiple components
  const osc1 = ctx.createOscillator();
  osc1.type = 'sawtooth';
  osc1.frequency.setValueAtTime(200, now);
  osc1.frequency.exponentialRampToValueAtTime(80, now + 0.2);

  const osc2 = ctx.createOscillator();
  osc2.type = 'square';
  osc2.frequency.setValueAtTime(400, now);
  osc2.frequency.exponentialRampToValueAtTime(150, now + 0.15);

  // Add noise burst for impact
  const noise = ctx.createBufferSource();
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * 0.8;
  }
  noise.buffer = buffer;

  const gain1 = ctx.createGain();
  gain1.gain.setValueAtTime(0, now);
  gain1.gain.linearRampToValueAtTime(0.5, now + 0.01);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

  const gain2 = ctx.createGain();
  gain2.gain.setValueAtTime(0, now);
  gain2.gain.linearRampToValueAtTime(0.4, now + 0.005);
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0, now);
  noiseGain.gain.linearRampToValueAtTime(0.3, now + 0.005);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

  osc1.connect(gain1);
  osc2.connect(gain2);
  noise.connect(noiseGain);
  
  gain1.connect(sfxGainNode);
  gain2.connect(sfxGainNode);
  noiseGain.connect(sfxGainNode);

  osc1.start(now);
  osc2.start(now);
  noise.start(now);
  
  osc1.stop(now + 0.3);
  osc2.stop(now + 0.2);
  noise.stop(now + 0.1);
}

// Dino stunned - dizzy, confused sound
export function playDinoStunned() {
  const ctx = getAudioContext();
  const now = ctx.currentTime;

  // Wobbly, descending sound to indicate confusion
  const osc1 = ctx.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(300, now);
  osc1.frequency.exponentialRampToValueAtTime(150, now + 0.8);

  // Add warble effect
  const warble = ctx.createOscillator();
  warble.type = 'sine';
  warble.frequency.value = 3; // Slow warble

  const warbleGain = ctx.createGain();
  warbleGain.gain.value = 20; // Frequency modulation depth

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.3, now + 0.1);
  gain.gain.setValueAtTime(0.3, now + 0.6);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 1.0);

  warble.connect(warbleGain);
  warbleGain.connect(osc1.frequency);

  osc1.connect(gain);
  gain.connect(sfxGainNode);

  warble.start(now);
  osc1.start(now);
  
  warble.stop(now + 1.0);
  osc1.stop(now + 1.0);
}

// Dino searching - curious sniffing sounds
export function playDinoSearching() {
  const ctx = getAudioContext();
  const now = ctx.currentTime;

  // Short sniffing sounds - play 3 quick sniffs
  for (let i = 0; i < 3; i++) {
    const delay = i * 0.3;
    
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120 + Math.random() * 40, now + delay);
    osc.frequency.exponentialRampToValueAtTime(80 + Math.random() * 20, now + delay + 0.1);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now + delay);
    gain.gain.linearRampToValueAtTime(0.2, now + delay + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.15);

    osc.connect(gain);
    gain.connect(sfxGainNode);

    osc.start(now + delay);
    osc.stop(now + delay + 0.15);
  }
}

// Dino wandering - occasional grunt or grumble
export function playDinoWandering() {
  const ctx = getAudioContext();
  const now = ctx.currentTime;

  // Low, quiet grumble
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(60 + Math.random() * 20, now);
  osc.frequency.exponentialRampToValueAtTime(40 + Math.random() * 15, now + 0.4);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.15, now + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

  osc.connect(gain);
  gain.connect(sfxGainNode);

  osc.start(now);
  osc.stop(now + 0.5);
}

// Allow external code to set the synth patch
export function setSynthPatch(patchObject) {
  // Basic validation
  if (patchObject && typeof patchObject === 'object') {
    currentSynthPatch = JSON.parse(JSON.stringify(patchObject));
    console.log('Synth patch set:', currentSynthPatch?.name || '(unnamed)');
  }
}

export async function loadSynthPatchFromUrl(url) {
  const res = await fetch(url);
  const json = await res.json();
  setSynthPatch(json);
}

function playSynthNote(ctx, freq, dur, gain, patch) {
  const now = ctx.currentTime;
  // Default patch mirrors previous "Snowflake" sound
  const defaultPatch = {
    name: 'DefaultSnowflake',
    oscillators: [
      { type: 'sawtooth', ratio: 1.0, gain: 0.35 },
      { type: 'sine', ratio: 0.5, gain: 0.25 },
      { type: 'sawtooth', ratio: 1.012, gain: 0.2 },
      { type: 'triangle', ratio: 0.997, gain: 0.15 },
    ],
    filter: { type: 'lowpass', q: 8, freqMulStart: 4, freqMulMid: 2, freqMulEnd: 1.5 },
    envelope: { attack: 0.08, decay: 0.15, sustain: 0.7, release: 0.4, gainScale: 0.4 },
    vibrato: { enabled: true, freq: 5, depthRatio: 0.01, minDur: 0.5, targets: [0,2] },
  };

  const p = patch || defaultPatch;

  // Build oscillators and premix
  const premix = ctx.createGain();
  const oscNodes = [];
  const gainNodes = [];
  (p.oscillators || []).forEach((o) => {
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.value = freq * (o.ratio || 1);
    const g = ctx.createGain();
    g.gain.value = Number.isFinite(o.gain) ? o.gain : 0.2;
    osc.connect(g);
    g.connect(premix);
    oscNodes.push(osc);
    gainNodes.push(g);
  });

  // Filter
  const filter = ctx.createBiquadFilter();
  const ft = (p.filter && p.filter.type) || 'lowpass';
  filter.type = ft;
  const q = (p.filter && p.filter.q) || 0;
  filter.Q.value = q;
  const fmS = Math.min(8000, freq * ((p.filter && p.filter.freqMulStart) || 4));
  const fmM = Math.min(8000, freq * ((p.filter && p.filter.freqMulMid) || 2));
  const fmE = Math.min(8000, freq * ((p.filter && p.filter.freqMulEnd) || 1.5));
  filter.frequency.setValueAtTime(fmS, now);
  filter.frequency.exponentialRampToValueAtTime(fmM, now + dur * 0.3);
  filter.frequency.exponentialRampToValueAtTime(fmE, now + dur);
  premix.connect(filter);

  // Envelope
  const env = ctx.createGain();
  const atk = Math.min(dur * (p.envelope?.attack ?? 0.08), 0.5);
  const dec = Math.min(dur * (p.envelope?.decay ?? 0.15), 0.6);
  const sus = p.envelope?.sustain ?? 0.7;
  const rel = Math.min(dur * (p.envelope?.release ?? 0.4), 1.2);
  const peak = gain * (p.envelope?.gainScale ?? 0.4);
  const susGain = peak * sus;
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(peak, now + atk);
  env.gain.linearRampToValueAtTime(susGain, now + atk + dec);
  env.gain.setValueAtTime(susGain, now + dur - rel);
  env.gain.linearRampToValueAtTime(0, now + dur);
  filter.connect(env);
  env.connect(bgmGainNode);

  // Vibrato
  const vib = p.vibrato || {};
  if (vib.enabled && dur > (vib.minDur ?? 0.5)) {
    const vOsc = ctx.createOscillator();
    const vGain = ctx.createGain();
    vOsc.type = 'sine';
    vOsc.frequency.value = vib.freq || 5;
    vGain.gain.value = freq * (vib.depthRatio || 0.01);
    vOsc.connect(vGain);
    const targets = Array.isArray(vib.targets) ? vib.targets : [0];
    targets.forEach((idx) => {
      if (oscNodes[idx]) vGain.connect(oscNodes[idx].frequency);
    });
    vOsc.start(now + atk + dec);
    vOsc.stop(now + dur);
  }

  // Start/stop oscillators
  oscNodes.forEach((osc) => {
    osc.start(now);
    osc.stop(now + dur + 0.1);
  });
}

// Utility function to unlock audio context on user gesture
export function unlockAudioContext() {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    ctx.resume().then(() => {
      console.log('Audio context unlocked');
    });
  }
}
