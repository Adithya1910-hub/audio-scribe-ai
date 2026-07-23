/**
 * TextFormatter - Smart Paragraph Structuring, Punctuation & Subtitle Formatter
 * 
 * ponytail: Pure JS regex & string manipulation. Zero external heavy NLP dependencies needed.
 */

/**
 * Format raw transcription chunks into structured paragraphs
 */
export function formatTranscript(chunks, options = { autoFormat: true, includeTimestamps: true }) {
  if (!chunks || chunks.length === 0) return '';

  let fullFormattedText = '';
  let currentParagraph = '';
  let sentenceCount = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    let text = (chunk.text || '').trim();
    if (!text) continue;

    // Clean up spaces & punctuation
    text = cleanUpText(text);

    if (options.includeTimestamps && (currentParagraph === '' || sentenceCount >= 3)) {
      if (currentParagraph) {
        fullFormattedText += currentParagraph.trim() + '\n\n';
        currentParagraph = '';
      }
      currentParagraph += `[${chunk.startFormatted}] `;
      sentenceCount = 0;
    }

    currentParagraph += text + ' ';

    // Count sentences in paragraph
    const sentences = text.match(/[^.!?]+[.!?]+/g);
    if (sentences) {
      sentenceCount += sentences.length;
    }

    // Split into paragraph every 3-4 sentences if autoFormat enabled
    if (options.autoFormat && sentenceCount >= 4) {
      fullFormattedText += currentParagraph.trim() + '\n\n';
      currentParagraph = '';
      sentenceCount = 0;
    }
  }

  if (currentParagraph) {
    fullFormattedText += currentParagraph.trim();
  }

  return fullFormattedText.trim();
}

/**
 * Clean up text (punctuation, spacing, capitalization)
 */
export function cleanUpText(text) {
  if (!text) return '';

  let cleaned = text
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .replace(/\s+([.,!?:;])/g, '$1') // Fix space before punctuation
    .replace(/([.,!?])([A-Za-z])/g, '$1 $2') // Ensure space after punctuation
    .trim();

  // Capitalize first letter of text if lowercase
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  return cleaned;
}

/**
 * Generate SRT subtitle format from transcript chunks
 */
export function generateSrtFormat(chunks) {
  let srtOutput = '';

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const text = cleanUpText(chunk.text || '');
    if (!text) continue;

    const startSrt = formatSrtTime(chunk.startTimeSec);
    const endSrt = formatSrtTime(chunk.endTimeSec);

    srtOutput += `${i + 1}\n`;
    srtOutput += `${startSrt} --> ${endSrt}\n`;
    srtOutput += `${text}\n\n`;
  }

  return srtOutput.trim();
}

/**
 * Format time in seconds to SRT time string (00:00:00,000)
 */
function formatSrtTime(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.floor((seconds % 1) * 1000);

  const pad = (num, size = 2) => String(num).padStart(size, '0');

  return `${pad(hrs)}:${pad(mins)}:${pad(secs)},${pad(millis, 3)}`;
}

/**
 * Calculate transcript statistics (word count, char count, reading time)
 */
export function getTranscriptStats(text) {
  if (!text) {
    return { words: 0, chars: 0, readingTimeMinutes: 0 };
  }

  const clean = text.replace(/\[\d{2}:\d{2}(:\d{2})?\]/g, ''); // strip timestamps
  const words = clean.trim().split(/\s+/).filter(w => w.length > 0).length;
  const chars = clean.length;
  const readingTimeMinutes = Math.max(1, Math.ceil(words / 200)); // ~200 WPM

  return { words, chars, readingTimeMinutes };
}
