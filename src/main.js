import { decodeAudioFile, chunkAudioData, formatTimestamp, formatFileSize } from './audioProcessor.js';
import { transcribeChunksLocal, transcribeWithCloudApi } from './transcriber.js';
import { formatTranscript, generateSrtFormat, getTranscriptStats, cleanUpText } from './textFormatter.js';
import { jsPDF } from 'jspdf';

// State
let selectedFile = null;
let audioDecodedData = null;
let audioChunks = [];
let transcriptionResults = [];
let activeTab = 'formatted';

// DOM Elements
const dropzone = document.getElementById('dropzone');
const audioFileInput = document.getElementById('audioFileInput');
const audioPlayerContainer = document.getElementById('audioPlayerContainer');
const audioElement = document.getElementById('audioElement');
const fileNameEl = document.getElementById('fileName');
const fileMetaEl = document.getElementById('fileMeta');
const removeFileBtn = document.getElementById('removeFileBtn');

const engineSelect = document.getElementById('engineSelect');
const autoFormatToggle = document.getElementById('autoFormatToggle');
const timestampToggle = document.getElementById('timestampToggle');
const startTranscribeBtn = document.getElementById('startTranscribeBtn');

const progressSection = document.getElementById('progressSection');
const progressTitle = document.getElementById('progressTitle');
const progressPercent = document.getElementById('progressPercent');
const progressBarFill = document.getElementById('progressBarFill');
const progressDetails = document.getElementById('progressDetails');
const progressChunkInfo = document.getElementById('progressChunkInfo');

const transcriptEditor = document.getElementById('transcriptEditor');
const wordCountStat = document.getElementById('wordCountStat');
const charCountStat = document.getElementById('charCountStat');
const readTimeStat = document.getElementById('readTimeStat');

const tabBtns = document.querySelectorAll('.tab-btn');
const searchInput = document.getElementById('searchInput');
const formatTextBtn = document.getElementById('formatTextBtn');

const copyBtn = document.getElementById('copyBtn');
const downloadTxtBtn = document.getElementById('downloadTxtBtn');
const downloadSrtBtn = document.getElementById('downloadSrtBtn');
const downloadPdfBtn = document.getElementById('downloadPdfBtn');

const apiSettingsBtn = document.getElementById('apiSettingsBtn');
const apiModal = document.getElementById('apiModal');
const closeApiModal = document.getElementById('closeApiModal');
const saveApiKeyBtn = document.getElementById('saveApiKeyBtn');
const apiKeyProvider = document.getElementById('apiKeyProvider');
const apiKeyValue = document.getElementById('apiKeyValue');

// Initialization
function init() {
  setupEventListeners();
  loadApiSettings();
}

function setupEventListeners() {
  // Drag & drop
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('drag-over');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  });

  audioFileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelected(e.target.files[0]);
    }
  });

  removeFileBtn.addEventListener('click', resetFileSelection);

  // Transcribe start
  startTranscribeBtn.addEventListener('click', startTranscription);

  // Tabs
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.tab;
      renderTranscriptOutput();
    });
  });

  // Editor manual input updates stats
  transcriptEditor.addEventListener('input', () => {
    updateStats(transcriptEditor.value);
  });

  // Format button
  formatTextBtn.addEventListener('click', () => {
    if (transcriptEditor.value) {
      const formatted = cleanUpText(transcriptEditor.value);
      transcriptEditor.value = formatted;
      updateStats(formatted);
    }
  });

  // Search
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    if (!query) return;
    const text = transcriptEditor.value;
    const index = text.toLowerCase().indexOf(query);
    if (index !== -1) {
      transcriptEditor.focus();
      transcriptEditor.setSelectionRange(index, index + query.length);
    }
  });

  // Export buttons
  copyBtn.addEventListener('click', copyToClipboard);
  downloadTxtBtn.addEventListener('click', downloadTxt);
  downloadSrtBtn.addEventListener('click', downloadSrt);
  downloadPdfBtn.addEventListener('click', downloadPdf);

  // Modal handlers
  apiSettingsBtn.addEventListener('click', () => apiModal.classList.remove('hidden'));
  closeApiModal.addEventListener('click', () => apiModal.classList.add('hidden'));
  saveApiKeyBtn.addEventListener('click', saveApiSettings);
}

// File Selection Handler
async function handleFileSelected(file) {
  selectedFile = file;
  fileNameEl.textContent = file.name;
  fileMetaEl.textContent = `Loading & decoding audio info... • ${formatFileSize(file.size)}`;

  dropzone.classList.add('hidden');
  audioPlayerContainer.classList.remove('hidden');

  // Set audio source
  const fileUrl = URL.createObjectURL(file);
  audioElement.src = fileUrl;

  try {
    // Decode audio metadata using AudioContext
    audioDecodedData = await decodeAudioFile(file, (msg, percent) => {
      fileMetaEl.textContent = `${msg} • ${formatFileSize(file.size)}`;
    });

    const formattedDuration = formatTimestamp(audioDecodedData.duration);
    fileMetaEl.textContent = `${formattedDuration} • ${formatFileSize(file.size)} • ${(audioDecodedData.sampleRate / 1000).toFixed(1)}kHz Mono`;
  } catch (err) {
    console.error('Audio decoding error:', err);
    fileMetaEl.textContent = `Ready • ${formatFileSize(file.size)}`;
  }
}

function resetFileSelection() {
  selectedFile = null;
  audioDecodedData = null;
  audioChunks = [];
  transcriptionResults = [];
  audioFileInput.value = '';
  audioElement.src = '';
  dropzone.classList.remove('hidden');
  audioPlayerContainer.classList.add('hidden');
  progressSection.classList.add('hidden');
}

// Transcription Workflow
async function startTranscription() {
  if (!selectedFile) return;

  const engine = engineSelect.value;
  startTranscribeBtn.disabled = true;
  progressSection.classList.remove('hidden');
  transcriptionResults = [];
  transcriptEditor.value = '';

  try {
    if (engine === 'cloud-api') {
      const provider = localStorage.getItem('audioscribe_provider') || 'groq';
      const apiKey = localStorage.getItem('audioscribe_apikey');
      if (!apiKey) {
        alert('Please enter your Cloud API Key in API Settings first!');
        apiModal.classList.remove('hidden');
        startTranscribeBtn.disabled = false;
        return;
      }

      if (!audioDecodedData && selectedFile.size > 20 * 1024 * 1024) {
        updateProgress('Decoding Audio for Cloud Chunking...', 5, 'Decoding >20MB audio to fit Cloud API limit...');
        audioDecodedData = await decodeAudioFile(selectedFile);
      }

      updateProgress('Starting Cloud API Transcription...', 10, 'Sending audio to Cloud Whisper engine...');
      transcriptionResults = await transcribeWithCloudApi(
        selectedFile,
        provider,
        apiKey,
        (msg, percent) => updateProgress('Processing Cloud Transcription', percent, msg),
        audioDecodedData ? audioDecodedData.pcm16k : null
      );
    } else {

      // Local AI WASM pipeline
      updateProgress('Preparing Audio Chunks...', 5, 'Extracting 16kHz PCM audio buffers...');
      
      if (!audioDecodedData) {
        audioDecodedData = await decodeAudioFile(selectedFile);
      }

      // Chunk long audio into 30-second segments for smooth processing
      audioChunks = chunkAudioData(audioDecodedData.pcm16k, 30);

      transcriptionResults = await transcribeChunksLocal(
        audioChunks,
        engine,
        (msg, percent, current, total) => {
          updateProgress(`Transcribing Audio`, percent, msg, `Chunk ${current} of ${total}`);
        },
        (chunkResult, currentResults, currentChunk, totalChunks) => {
          // Stream results directly into UI as they complete
          renderTranscriptOutput();
        }
      );
    }

    updateProgress('Transcription Completed!', 100, 'All audio segments processed & formatted successfully.');
    renderTranscriptOutput();
  } catch (error) {
    console.error('Transcription Failed:', error);
    updateProgress('Transcription Error', 100, `Error: ${error.message}`);
    alert(`Transcription Error: ${error.message}`);
  } finally {
    startTranscribeBtn.disabled = false;
  }
}

// Update UI Progress
function updateProgress(title, percent, details, chunkInfo = '') {
  progressTitle.textContent = title;
  progressPercent.textContent = `${percent}%`;
  progressBarFill.style.width = `${percent}%`;
  progressDetails.textContent = details;
  progressChunkInfo.textContent = chunkInfo;
}

// Render Text Output based on Active Tab
function renderTranscriptOutput() {
  const autoFormat = autoFormatToggle.checked;
  const includeTimestamps = timestampToggle.checked;

  let text = '';

  if (activeTab === 'formatted') {
    text = formatTranscript(transcriptionResults, { autoFormat, includeTimestamps });
  } else if (activeTab === 'timestamps') {
    text = formatTranscript(transcriptionResults, { autoFormat: false, includeTimestamps: true });
  } else if (activeTab === 'raw') {
    text = transcriptionResults.map(r => r.text).join(' ');
  }

  transcriptEditor.value = text;
  updateStats(text);
}

// Update Statistics
function updateStats(text) {
  const stats = getTranscriptStats(text);
  wordCountStat.textContent = stats.words.toLocaleString();
  charCountStat.textContent = stats.chars.toLocaleString();
  readTimeStat.textContent = `${stats.readingTimeMinutes} min`;
}

// Export Functions
function copyToClipboard() {
  const text = transcriptEditor.value;
  if (!text) {
    alert("There is no text to copy.");
    return;
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showCopyToast();
    }).catch(() => {
      fallbackCopyText(text);
    });
  } else {
    fallbackCopyText(text);
  }
}

function fallbackCopyText(text) {
  transcriptEditor.select();
  document.execCommand('copy');
  showCopyToast();
}

function showCopyToast() {
  const originalText = copyBtn.innerHTML;
  copyBtn.innerHTML = '✅ Copied!';
  setTimeout(() => copyBtn.innerHTML = originalText, 2000);
}

function downloadTxt() {
  const text = transcriptEditor.value;
  if (!text) {
    alert("There is no transcript text to download. Please transcribe an audio file or type text into the editor.");
    return;
  }
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const filename = `${selectedFile ? selectedFile.name.replace(/\.[^/.]+$/, "") : "transcript"}_formatted.txt`;
  saveFile(blob, filename);
}

function downloadSrt() {
  let srtText = '';
  if (transcriptionResults && transcriptionResults.length > 0) {
    srtText = generateSrtFormat(transcriptionResults);
  } else {
    const text = transcriptEditor.value;
    if (!text) {
      alert("There is no transcript text to export as SRT.");
      return;
    }
    const lines = text.split(/\n+/).filter(l => l.trim());
    srtText = lines.map((line, idx) => `${idx + 1}\n00:00:${String(idx*5).padStart(2,'0')},000 --> 00:00:${String((idx+1)*5).padStart(2,'0')},000\n${line}`).join('\n\n');
  }

  const blob = new Blob([srtText], { type: 'text/plain;charset=utf-8' });
  const filename = `${selectedFile ? selectedFile.name.replace(/\.[^/.]+$/, "") : "transcript"}.srt`;
  saveFile(blob, filename);
}

function downloadPdf() {
  const text = transcriptEditor.value;
  if (!text) {
    alert("There is no transcript text to export as PDF.");
    return;
  }

  try {
    const doc = new jsPDF();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Audio Transcription Report", 14, 20);

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`File: ${selectedFile ? selectedFile.name : "Audio Recording"}`, 14, 28);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 14, 34);
    doc.line(14, 38, 196, 38);

    doc.setFontSize(11);
    const splitText = doc.splitTextToSize(text, 180);
    
    let y = 46;
    const pageHeight = doc.internal.pageSize.height;
    for (let i = 0; i < splitText.length; i++) {
      if (y > pageHeight - 20) {
        doc.addPage();
        y = 20;
      }
      doc.text(splitText[i], 14, y);
      y += 6;
    }

    const pdfBlob = doc.output('blob');
    const filename = `${selectedFile ? selectedFile.name.replace(/\.[^/.]+$/, "") : "transcript"}.pdf`;
    saveFile(pdfBlob, filename);
  } catch (err) {
    console.error("PDF generation failed:", err);
    alert(`PDF generation failed: ${err.message}`);
  }
}

async function saveFile(blob, filename) {
  // 1. Try Native Windows File System Access API (Chrome/Edge)
  if (window.showSaveFilePicker) {
    try {
      const ext = filename.split('.').pop().toLowerCase();
      let mimeType = 'text/plain';
      if (ext === 'pdf') mimeType = 'application/pdf';
      if (ext === 'srt') mimeType = 'text/plain';

      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: `${ext.toUpperCase()} File`,
          accept: { [mimeType]: [`.${ext}`] }
        }]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // User cancelled save dialog
      console.warn('showSaveFilePicker fallback:', err);
    }
  }

  // 2. Fallback download for other browsers
  const reader = new FileReader();
  reader.onload = function(e) {
    const dataUrl = e.target.result;
    const a = document.createElement('a');
    a.style.display = 'none';
    a.setAttribute('download', filename);
    a.download = filename;
    a.href = dataUrl;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (document.body.contains(a)) {
        document.body.removeChild(a);
      }
    }, 1000);
  };
  reader.readAsDataURL(blob);
}




// API Modal Settings
function loadApiSettings() {
  const provider = localStorage.getItem('audioscribe_provider') || 'groq';
  const apiKey = localStorage.getItem('audioscribe_apikey') || '';
  apiKeyProvider.value = provider;
  apiKeyValue.value = apiKey;
}

function saveApiSettings() {
  localStorage.setItem('audioscribe_provider', apiKeyProvider.value);
  localStorage.setItem('audioscribe_apikey', apiKeyValue.value.trim());
  apiModal.classList.add('hidden');
  alert('API settings saved successfully!');
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', init);
