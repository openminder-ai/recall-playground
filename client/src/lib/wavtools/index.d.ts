export class WavRecorder {
  constructor(options?: {
    sampleRate?: number;
    outputToSpeakers?: boolean;
    debug?: boolean;
  });
  
  static decode(
    audioData: Blob | Float32Array | Int16Array | ArrayBuffer | number[],
    sampleRate?: number,
    fromSampleRate?: number
  ): Promise<{
    blob: Blob;
    url: string;
    values: Float32Array;
    audioBuffer: AudioBuffer;
  }>;
  
  getSampleRate(): number;
  getStatus(): "ended" | "paused" | "recording";
  requestPermission(): Promise<boolean>;
  listDevices(): Promise<Array<MediaDeviceInfo & { default: boolean }>>;
  begin(deviceId?: string): Promise<boolean>;
  record(
    chunkProcessor?: (data: { mono: Int16Array; raw: Int16Array }) => any,
    chunkSize?: number
  ): Promise<boolean>;
  pause(): Promise<boolean>;
  clear(): Promise<boolean>;
  read(): Promise<{ meanValues: Float32Array; channels: Array<Float32Array> }>;
  save(force?: boolean): Promise<any>;
  end(): Promise<any>;
  quit(): Promise<boolean>;
  getFrequencies(
    analysisType?: "frequency" | "music" | "voice",
    minDecibels?: number,
    maxDecibels?: number
  ): any;
}

export class WavStreamPlayer {
  constructor(options?: { sampleRate?: number });
  
  connect(): Promise<boolean>;
  add16BitPCM(arrayBuffer: ArrayBuffer | Int16Array, trackId?: string): Int16Array;
  addBase64Audio(base64: string): Promise<void>;
  getTrackSampleOffset(interrupt?: boolean): Promise<{
    trackId: string | null;
    offset: number;
    currentTime: number;
  }>;
  interrupt(): Promise<{
    trackId: string | null;
    offset: number;
    currentTime: number;
  }>;
  getFrequencies(
    analysisType?: "frequency" | "music" | "voice",
    minDecibels?: number,
    maxDecibels?: number
  ): any;
}

export class WavPacker {
  static floatTo16BitPCM(float32Array: Float32Array): ArrayBuffer;
  static mergeBuffers(leftBuffer: ArrayBuffer, rightBuffer: ArrayBuffer): ArrayBuffer;
  
  pack(sampleRate: number, audio: {
    bitsPerSample: number;
    channels: Array<Float32Array>;
    data: Int16Array;
  }): {
    blob: Blob;
    url: string;
    channelCount: number;
    sampleRate: number;
    duration: number;
  };
}

export class AudioAnalysis {
  constructor(audioElement: HTMLAudioElement, audioBuffer?: AudioBuffer | null);
  
  static getFrequencies(
    analyser: AnalyserNode,
    sampleRate: number,
    fftResult?: Float32Array,
    analysisType?: "frequency" | "music" | "voice",
    minDecibels?: number,
    maxDecibels?: number
  ): {
    values: Float32Array;
    frequencies: number[];
    labels: string[];
  };
  
  getFrequencies(
    analysisType?: "frequency" | "music" | "voice",
    minDecibels?: number,
    maxDecibels?: number
  ): {
    values: Float32Array;
    frequencies: number[];
    labels: string[];
  };
  
  resumeIfSuspended(): Promise<boolean>;
}