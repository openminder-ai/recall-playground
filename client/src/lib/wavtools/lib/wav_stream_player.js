/*  client/src/lib/wavtools/lib/wav_stream_player.js  */
import { StreamProcessorSrc } from './worklets/stream_processor.js';
import { AudioAnalysis }     from './analysis/audio_analysis.js';

/* ---------- helper: fast offline resampler -------------------------------- */
async function resampleInt16(int16, fromRate, toRate) {
  if (fromRate === toRate) return int16;                    // no work
  /* int16 -> float32 */
  const f32 = Float32Array.from(int16, v => v / 0x8000);
  const offline = new OfflineAudioContext(1,                 // mono
                  Math.ceil(f32.length * toRate / fromRate),
                  toRate);
  const buf = offline.createBuffer(1, f32.length, fromRate);
  buf.copyToChannel(f32, 0);
  const src = offline.createBufferSource();
  src.buffer = buf;  src.connect(offline.destination);  src.start();
  const rendered = await offline.startRendering();
  const f32r = rendered.getChannelData(0);
  /* float32 -> int16 */
  const out = new Int16Array(f32r.length);
  for (let i = 0; i < f32r.length; i++) {
    const s = Math.max(-1, Math.min(1, f32r[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return out;
}

/* =======================================================================
   MAIN CLASS
   ======================================================================= */
export class WavStreamPlayer {
  constructor({ bufferLength = 4096 } = {}) {                //  ~85 ms @ 48 k
    this.context   = null;
    this.sampleRate = null;          // real hardware rate after connect()
    this.bufferLen = bufferLength;

    this.analyser  = null;
    this.stream    = null;
    this.trackSampleOffsets = {};
    this.interruptedTrackIds = {};
  }

  /* ---------- connect ---------------------------------------------------- */
  async connect() {
    /* ask politely for 48 k but accept whatever the hardware returns */
    this.context = new AudioContext({ sampleRate: 44100 });
    if (this.context.state === 'suspended') await this.context.resume();
    this.sampleRate = this.context.sampleRate;               // e.g. 44100

    await this.context.audioWorklet.addModule(StreamProcessorSrc);

    const analyser   = this.context.createAnalyser();
    analyser.fftSize = 8192; analyser.smoothingTimeConstant = 0.1;
    this.analyser    = analyser;
    return true;
  }

  /* ---------- frequency helper (unchanged) ------------------------------ */
  getFrequencies(type='frequency', min=-100, max=-30) {
    if (!this.analyser) throw new Error('Call .connect() first');
    return AudioAnalysis.getFrequencies(this.analyser,
                                        this.sampleRate, null, type, min, max);
  }

  /* ---------- start worklet if first chunk ------------------------------ */
  _start() {
    const node = new AudioWorkletNode(this.context, 'stream_processor',
                                      { processorOptions:{bufferLength:this.bufferLen} });
    node.connect(this.context.destination);     // speakers
    node.port.onmessage = ({data}) => {
      if (data?.event === 'offset') {
        const { requestId, trackId, offset } = data;
        this.trackSampleOffsets[requestId] = {
          trackId, offset,
          currentTime: offset / this.sampleRate,
        };
      }
    };
    this.analyser.disconnect();
    node.connect(this.analyser);
    this.stream = node;
  }

  /* ---------- enqueue raw PCM (Int16) ----------------------------------- */
  add16BitPCM(bufOrInt16, trackId='default') {
    if (this.interruptedTrackIds[trackId]) return;           // after interrupt()
    if (!this.stream) this._start();

    const int16 = bufOrInt16 instanceof Int16Array
      ? bufOrInt16
      : new Int16Array(bufOrInt16);

    this.stream.port.postMessage({ event:'write', buffer:int16, trackId });
  }

  /* ---------- *the* entry point from ElevenLabs ------------------------- */
  async addBase64Audio(b64, trackId = crypto.randomUUID()) {
    const bytes = Uint8Array.from(atob(b64), c=>c.charCodeAt(0));
    const raw   = bytes.buffer;

    try {                                                     // container: mp3 / opus / wav
      const audio = await this.context.decodeAudioData(raw.slice(0));
      const srcRate = audio.sampleRate;
      const f32 = audio.getChannelData(0);                    // mono
      const int16 = await resampleInt16(
        Int16Array.from(f32, s=> s<0?s*0x8000:s*0x7FFF),
        srcRate, this.sampleRate);
      this.add16BitPCM(int16, trackId);
    } catch {                                                // raw PCM (ElevenLabs)
      const srcRate = 48000;                   // ElevenLabs raw = always 48 k
      const int16in = new Int16Array(raw);
      const int16   = await resampleInt16(int16in, srcRate, this.sampleRate);
      this.add16BitPCM(int16, trackId);
    }
  }

  /* ---------- offset / interrupt helpers ------------------------------- */
  async _offsetReq(kind) {
    if (!this.stream) return null;
    const requestId = crypto.randomUUID();
    this.stream.port.postMessage({ event: kind, requestId });
    while (!this.trackSampleOffsets[requestId])
      await new Promise(r => setTimeout(r,1));
    return this.trackSampleOffsets[requestId];
  }
  getTrackSampleOffset()          { return this._offsetReq('offset');     }
  async interrupt() {
    const info = await this._offsetReq('interrupt');
    if (info.trackId) this.interruptedTrackIds[info.trackId] = true;
    return info;
  }
}

globalThis.WavStreamPlayer = WavStreamPlayer;
