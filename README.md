# AudioScribe AI - Speech to Text & Transcript Formatter

AudioScribe AI is a web application built to transcribe long audio files (such as 1-hour recordings) into formatted text with automatic paragraph structuring, punctuation correction, timestamps, and multi-format export capabilities.

![AudioScribe AI Preview](https://raw.githubusercontent.com/Adithya1910-hub/audio-scribe-ai/main/dist/index.html)

## Features

- 🎙️ **Long Audio Processing**: Decodes and chunks long audio files (MP3, WAV, M4A, AAC, OGG, WEBM, FLAC) into 30-second Float32 PCM arrays using native browser Web Audio API (`AudioContext`).
- 🤖 **Dual AI Engine Options**:
  - **Local Browser AI (Free & Offline)**: Powered by WebAssembly Whisper (`@xenova/transformers`). Runs 100% locally in the browser with zero external server dependencies or binary installations.
  - **Cloud API Engine**: Optional Groq / OpenAI Whisper API support with auto-chunking for files >20 MB to bypass 25 MB payload limits.
- ✨ **Smart Text Formatting**: Auto-formats raw transcripts into structured paragraphs with sentence capitalization, noise cleanup, and optional timestamping (`[MM:SS]`).
- 📄 **Multi-Format Export**: One-click export to `.txt`, `.srt` (subtitles), `.pdf`, and clipboard copying. Native Windows File System Access API support (`showSaveFilePicker`).

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm

### Installation

```bash
git clone https://github.com/Adithya1910-hub/audio-scribe-ai.git
cd audio-scribe-ai
npm install
```

### Running Locally

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Building for Production

```bash
npm run build
```

## Tech Stack

- **Frontend**: HTML5, CSS3 (Vanilla Glassmorphism Theme), JavaScript (ES Modules)
- **Audio Processing**: Web Audio API (`AudioContext`, `OfflineAudioContext`, `DataView` PCM Encoder)
- **AI & Speech Recognition**: `@xenova/transformers` (Whisper WASM) & OpenAI / Groq Cloud Whisper APIs
- **PDF Export**: `jsPDF`
- **Build Tool**: Vite

## License

MIT License
