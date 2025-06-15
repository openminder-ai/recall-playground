/*  client/src/lib/wavtools/lib/worklets/stream_processor.js  */
export const StreamProcessorWorklet = `
class StreamProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { bufferLength = 2048 } = options.processorOptions ?? {};
    this.bufferLength = bufferLength;
    this.outBuffers   = [];
    this.write        = { buffer: new Float32Array(this.bufferLength), trackId: null };
    this.writeOffset  = 0;
    this.trackSampleOffsets = {};
    this.hasInterrupted = false;

    this.port.onmessage = (e) => {
      const p = e.data || {};
      if (p.event === 'write')            this._queue(p.buffer, p.trackId);
      else if (p.event === 'offset' ||
               p.event === 'interrupt')   this._handleOffset(p);
    };
  }

  _queue(int16, trackId = null) {
    const f32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 0x8000;
    let { buffer } = this.write;
    let off = this.writeOffset;
    for (let v of f32) {
      buffer[off++] = v;
      if (off >= buffer.length) {
        this.outBuffers.push(this.write);
        this.write = { buffer: new Float32Array(this.bufferLength), trackId };
        buffer = this.write.buffer;
        off = 0;
      }
    }
    this.writeOffset = off;
  }

  _handleOffset({ requestId, event }) {
    const trackId = this.write.trackId;
    const offset  = this.trackSampleOffsets[trackId] || 0;
    this.port.postMessage({ event: 'offset', requestId, trackId, offset });
    if (event === 'interrupt') this.hasInterrupted = true;
  }

  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (this.hasInterrupted) return false;

    if (this.outBuffers.length) {
      const { buffer, trackId } = this.outBuffers.shift();
      out.set(buffer.subarray(0, out.length));      // copy
      if (trackId) {
        this.trackSampleOffsets[trackId] = (this.trackSampleOffsets[trackId]||0)+buffer.length;
      }
    } else {
      out.fill(0);                                  // play silence, stay alive
    }
    return true;
  }
}
registerProcessor('stream_processor', StreamProcessor);
`;
const script = new Blob([StreamProcessorWorklet], { type: 'application/javascript' });
export const StreamProcessorSrc = URL.createObjectURL(script);
