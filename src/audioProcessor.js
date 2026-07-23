/**
 * AudioProcessor - Native Web Audio API audio decoding and PCM 16kHz chunking engine
 * 
 * ponytail: Uses native browser Web Audio API (AudioContext) to decode MP3, WAV, M4A, AAC, OGG, FLAC
 * without needing external ffmpeg or server-side binaries.
 */

export async function decodeAudioFile(file, onProgress) {
  if (onProgress) onProgress("Reading audio file bytes...", 10);
  const arrayBuffer = await file.arrayBuffer();

  if (onProgress) onProgress("Decoding audio stream into Web Audio Buffer...", 30);
  
  // Create offline audio context or standard AudioContext to decode
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  if (onProgress) onProgress("Resampling audio to 16kHz Mono Float32 PCM...", 60);

  // Extract mono Float32 audio data resampled to 16kHz for Whisper model
  const pcm16k = await convertTo16kHzMono(audioBuffer);

  if (onProgress) onProgress("Audio decoding complete!", 100);

  return {
    audioBuffer,
    pcm16k,
    duration: audioBuffer.duration, // in seconds
    sampleRate: audioBuffer.sampleRate,
    numberOfChannels: audioBuffer.numberOfChannels
  };
}

/**
 * Convert AudioBuffer to 16,000 Hz Mono Float32Array (standard Whisper input)
 */
async function convertTo16kHzMono(audioBuffer) {
  const targetSampleRate = 16000;
  const numChannels = audioBuffer.numberOfChannels;
  const length = Math.ceil(audioBuffer.duration * targetSampleRate);

  const offlineCtx = new OfflineAudioContext(1, length, targetSampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;

  // If stereo or multi-channel, merge to mono
  if (numChannels > 1) {
    const merger = offlineCtx.createChannelMerger(numChannels);
    source.connect(merger);
    merger.connect(offlineCtx.destination);
  } else {
    source.connect(offlineCtx.destination);
  }

  source.start(0);
  const renderedBuffer = await offlineCtx.startRendering();
  return renderedBuffer.getChannelData(0);
}

/**
 * Split Float32Array into 30-second chunks for continuous long-audio processing (e.g. 1-hour recordings)
 * 30 seconds at 16,000 Hz = 480,000 samples per chunk
 */
export function chunkAudioData(pcm16kData, chunkDurationSeconds = 30) {
  const sampleRate = 16000;
  const chunkSize = chunkDurationSeconds * sampleRate;
  const totalSamples = pcm16kData.length;
  const chunks = [];

  for (let i = 0; i < totalSamples; i += chunkSize) {
    const end = Math.min(i + chunkSize, totalSamples);
    const chunkData = pcm16kData.subarray(i, end);
    const startTimeSec = i / sampleRate;
    const endTimeSec = end / sampleRate;

    chunks.push({
      data: chunkData,
      index: chunks.length,
      startTimeSec,
      endTimeSec,
      startFormatted: formatTimestamp(startTimeSec),
      endFormatted: formatTimestamp(endTimeSec)
    });
  }

  return chunks;
}

/**
 * Format seconds into HH:MM:SS string
 */
export function formatTimestamp(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const pad = (num) => String(num).padStart(2, '0');

  if (hrs > 0) {
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

/**
 * Format byte size into readable MB/GB string
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Convert 16kHz Mono Float32Array into WAV audio Blob (under 25MB for Cloud API)
 */
export function pcmToWavBlob(pcmFloat32Array, sampleRate = 16000) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmFloat32Array.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // PCM Float32 to Int16
  let offset = 44;
  for (let i = 0; i < pcmFloat32Array.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, pcmFloat32Array[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

