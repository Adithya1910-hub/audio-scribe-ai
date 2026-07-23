/**
 * Transcriber Engine - Local `@xenova/transformers` WebAssembly Whisper + Cloud API Fallback
 */

import { pipeline, env } from '@xenova/transformers';
import { pcmToWavBlob } from './audioProcessor.js';


// Configure transformers.js for optimal browser execution
env.allowLocalModels = false;
env.useBrowserCache = true;

let pipelineInstance = null;
let currentModelName = null;

/**
 * Initialize or get local Whisper pipeline
 */
export async function getTranscriberPipeline(modelName = 'Xenova/whisper-base.en', onProgress) {
  if (pipelineInstance && currentModelName === modelName) {
    return pipelineInstance;
  }

  if (onProgress) onProgress(`Loading local AI model (${modelName.split('/')[1]})...`, 0);

  pipelineInstance = await pipeline('automatic-speech-recognition', modelName, {
    progress_callback: (info) => {
      if (info.status === 'progress' && onProgress) {
        const percent = Math.round((info.loaded / info.total) * 100) || 0;
        onProgress(`Downloading AI Model Weights: ${info.file || ''} (${percent}%)`, percent);
      }
    }
  });

  currentModelName = modelName;
  return pipelineInstance;
}

/**
 * Transcribe array of 30-second audio chunks locally using Transformers.js
 */
export async function transcribeChunksLocal(chunks, modelName, onProgress, onChunkDone) {
  const transcriber = await getTranscriberPipeline(modelName, onProgress);
  const results = [];

  const totalChunks = chunks.length;

  for (let i = 0; i < totalChunks; i++) {
    const chunk = chunks[i];
    const currentPercent = Math.round(((i + 1) / totalChunks) * 100);

    if (onProgress) {
      onProgress(
        `Transcribing Audio Chunk ${i + 1} of ${totalChunks} (${chunk.startFormatted} - ${chunk.endFormatted})...`,
        currentPercent,
        i + 1,
        totalChunks
      );
    }

    // Run Whisper pipeline on Float32 PCM 16kHz audio chunk
    const output = await transcriber(chunk.data, {
      language: 'english',
      task: 'transcribe',
      return_timestamps: false
    });

    const chunkResult = {
      ...chunk,
      text: output.text ? output.text.trim() : ''
    };

    results.push(chunkResult);

    if (onChunkDone) {
      onChunkDone(chunkResult, results, i + 1, totalChunks);
    }
  }

  return results;
}

/**
 * Transcribe via Cloud API (Groq or OpenAI) for ultra-fast processing
 * Handles files larger than 25MB by auto-chunking into 10-minute WAV segments if necessary.
 */
export async function transcribeWithCloudApi(file, provider, apiKey, onProgress, pcm16kData = null) {
  const maxDirectSizeBytes = 20 * 1024 * 1024; // 20 MB limit safety threshold

  // If file is direct size under 20MB, upload directly
  if (file.size <= maxDirectSizeBytes || !pcm16kData) {
    return await sendCloudApiRequest(file, provider, apiKey, 0, onProgress);
  }

  // If file > 20MB, split into 10-minute (600s) WAV audio blobs to stay under 25MB API limit
  const sampleRate = 16000;
  const chunkDurationSec = 600; // 10 minutes per chunk
  const chunkSizeSamples = chunkDurationSec * sampleRate;
  const totalSamples = pcm16kData.length;

  const totalPartChunks = Math.ceil(totalSamples / chunkSizeSamples);
  const allResults = [];

  for (let i = 0; i < totalPartChunks; i++) {

    const startSample = i * chunkSizeSamples;
    const endSample = Math.min(startSample + chunkSizeSamples, totalSamples);
    const pcmSubarray = pcm16kData.subarray(startSample, endSample);

    const wavBlob = pcmToWavBlob(pcmSubarray, sampleRate);
    const chunkFile = new File([wavBlob], `audio_part_${i + 1}.wav`, { type: 'audio/wav' });

    const offsetSec = (startSample / sampleRate);
    const currentPercent = Math.round(((i + 1) / totalPartChunks) * 90);

    if (onProgress) {
      onProgress(`Transcribing Part ${i + 1} of ${totalPartChunks} via ${provider.toUpperCase()} API...`, currentPercent);
    }

    const chunkResults = await sendCloudApiRequest(chunkFile, provider, apiKey, offsetSec, null);
    allResults.push(...chunkResults);
  }

  if (onProgress) onProgress("Cloud transcription complete! Structuring paragraphs...", 100);
  return allResults;
}

async function sendCloudApiRequest(file, provider, apiKey, timeOffsetSec = 0, onProgress) {
  if (onProgress) onProgress(`Uploading audio file to ${provider.toUpperCase()} Cloud API...`, 20);

  const formData = new FormData();
  formData.append('file', file);
  formData.append('model', provider === 'groq' ? 'whisper-large-v3-turbo' : 'whisper-1');
  formData.append('response_format', 'verbose_json');

  const endpoint = provider === 'groq'
    ? 'https://api.groq.com/openai/v1/audio/transcriptions'
    : 'https://api.openai.com/v1/audio/transcriptions';

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`
    },
    body: formData
  });

  if (!response.ok) {
    const errText = await response.text();
    let userMsg = `Cloud API Error (${response.status}): ${errText}`;
    if (response.status === 401) {
      userMsg = `Invalid ${provider.toUpperCase()} API key. Please check your API key in settings.`;
    } else if (response.status === 413) {
      userMsg = `Audio file payload too large for Cloud API direct upload. Auto-chunking will process it in parts.`;
    }
    throw new Error(userMsg);
  }

  if (onProgress) onProgress("Cloud transcription received! Processing response...", 85);

  const data = await response.json();
  
  const chunks = (data.segments || []).map((seg, index) => {
    const startTimeSec = seg.start + timeOffsetSec;
    const endTimeSec = seg.end + timeOffsetSec;

    const startMins = Math.floor(startTimeSec / 60);
    const startSecs = Math.floor(startTimeSec % 60);
    const endMins = Math.floor(endTimeSec / 60);
    const endSecs = Math.floor(endTimeSec % 60);

    const pad = (n) => String(n).padStart(2, '0');

    return {
      index,
      data: null,
      startTimeSec,
      endTimeSec,
      startFormatted: `${pad(startMins)}:${pad(startSecs)}`,
      endFormatted: `${pad(endMins)}:${pad(endSecs)}`,
      text: seg.text
    };
  });

  if (chunks.length === 0 && data.text) {
    const startMins = Math.floor(timeOffsetSec / 60);
    const startSecs = Math.floor(timeOffsetSec % 60);
    const pad = (n) => String(n).padStart(2, '0');

    chunks.push({
      index: 0,
      data: null,
      startTimeSec: timeOffsetSec,
      endTimeSec: timeOffsetSec,
      startFormatted: `${pad(startMins)}:${pad(startSecs)}`,
      endFormatted: `${pad(startMins)}:${pad(startSecs)}`,
      text: data.text
    });
  }

  return chunks;
}

