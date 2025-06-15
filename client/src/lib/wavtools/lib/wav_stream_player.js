/*  client/src/lib/wavtools/lib/wav_stream_player.js  */
import { StreamProcessorSrc } from './worklets/stream_processor.js';
import { AudioAnalysis }    from './analysis/audio_analysis.js';

export class WavStreamPlayer {
  constructor({ sampleRate = 48000 } = {}) {
    this.sampleRateRequested = sampleRate;   // what we *ask* for
    this.sampleRate         = sampleRate;   // will be overwritten by the context
    this.context            = null;
    this.analyser           = null;
    this.stream             = null;
    this.trackSampleOffsets = {};
    this.interruptedTrackIds = {};

    this.bufferLength = 2048;               //  ≈ 42 ms @ 48 kHz (safe)
  }

  /* -------------------------------------------------------------- */
  async connect() {
    /* Let the browser choose its native rate; then adopt it. */
    this.context     = new AudioContext({ sampleRate: this.sampleRateRequested });
    if (this.context.state === 'suspended') await this.context.resume();
    this.sampleRate  = this.context.sampleRate;        // real, not assumed

    await this.context.audioWorklet.addModule(StreamProcessorSrc);

    /* Analyser for visualisers etc. */
    const analyser   = this.context.createAnalyser();
    analyser.fftSize = 8192;
    analyser.smoothingTimeConstant = 0.1;
    this.analyser    = analyser;
    return true;
  }

  /* -------------------------------------------------------------- */
  getFrequencies(type = 'frequency', min = -100, max = -30) {
    if (!this.analyser) throw new Error('Call .connect() first');
    return AudioAnalysis.getFrequencies(this.analyser, this.sampleRate, null,
                                        type, min, max);
  }

  /* -------------------------------------------------------------- */
  _start() {
    const node = new AudioWorkletNode(this.context, 'stream_processor',
                                      { processorOptions: { bufferLength: this.bufferLength } });

    node.connect(this.context.destination);   // send audio to speakers
    node.port.onmessage = ({ data }) => {
      if (data?.event === 'offset') {
        const { requestId, trackId, offset } = data;
        this.trackSampleOffsets[requestId] = {
          trackId, offset,
          currentTime: offset / this.sampleRate,
        };
      }
    };

    this.analyser.disconnect();
    node.connect(this.analyser);             // tap audio for FFT
    this.stream = node;
  }

  /* -------------------------------------------------------------- */
  add16BitPCM(arrayBuf, trackId = 'default') {
    if (this.interruptedTrackIds[trackId]) return;

    if (!this.stream) this._start();

    const buffer = arrayBuf instanceof Int16Array
      ? arrayBuf
      : new Int16Array(arrayBuf);

    this.stream.port.postMessage({ event: 'write', buffer, trackId });
    return buffer;
  }

  /* same helper to accept ElevenLabs base-64 */
  async addBase64Audio(b64, trackId = crypto.randomUUID()) {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    this.add16BitPCM(bytes.buffer, trackId);
  }

  async getTrackSampleOffset(interrupt = false) {
    if (!this.stream) return null;
    const requestId = crypto.randomUUID();
    this.stream.port.postMessage({ event: interrupt ? 'interrupt' : 'offset', requestId });

    /* wait for reply */
    while (!this.trackSampleOffsets[requestId])
      await new Promise(r => setTimeout(r, 1));

    const info = this.trackSampleOffsets[requestId];
    if (interrupt && info.trackId) this.interruptedTrackIds[info.trackId] = true;
    return info;
  }

  async interrupt() { return this.getTrackSampleOffset(true); }
}
globalThis.WavStreamPlayer = WavStreamPlayer;
