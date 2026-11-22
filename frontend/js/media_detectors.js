// Dedicated audio and video forensic screening lanes.
const MediaDetectors = {
  files: { audio: null, video: null },
  reset() {
    ['audio', 'video'].forEach(kind => {
      this.files[kind] = null;
      const input = document.getElementById(`${kind}FileInput`);
      const preview = document.getElementById(`${kind}Preview`);
      const button = document.getElementById(`${kind}AnalyzeBtn`);
      const result = document.getElementById(`${kind}Result`);
      if (input) input.value = '';
      if (preview) { preview.pause?.(); preview.removeAttribute('src'); preview.load?.(); preview.hidden = true; }
      if (button) button.disabled = true;
      if (result) result.innerHTML = '';
      const label = document.getElementById(`${kind}FileLabel`);
      const meta = document.getElementById(`${kind}FileMeta`);
      if (label) label.textContent = kind === 'audio' ? 'Choose an audio recording' : 'Choose a video clip';
      if (meta) meta.textContent = kind === 'audio' ? 'No recording selected' : 'No clip selected';
    });
  },
  init() {
    ['audio', 'video'].forEach(kind => {
      const input = document.getElementById(`${kind}FileInput`);
      const button = document.getElementById(`${kind}AnalyzeBtn`);
      const preview = document.getElementById(`${kind}Preview`);
      if (!input || !button) return;
      input.addEventListener('change', () => this.select(kind, input.files[0], preview));
      button.addEventListener('click', () => this.analyze(kind));
    });
  },
  select(kind, file, preview) {
    if (!file) return;
    const audio = kind === 'audio';
    const maxBytes = (audio ? 10 : 25) * 1024 * 1024;
    const ext = file.name.split('.').pop().toLowerCase();
    const allowed = audio ? ['wav', 'mp3', 'm4a', 'aac', 'ogg', 'flac'] : ['mp4', 'mov', 'webm', 'avi', 'mkv'];
    if (!allowed.includes(ext)) return this.failSelect(kind, 'Unsupported file format.');
    if (file.size > maxBytes) return this.failSelect(kind, `File exceeds ${audio ? '10' : '25'} MB.`);
    this.files[kind] = file;
    document.getElementById(`${kind}FileLabel`).textContent = file.name;
    document.getElementById(`${kind}FileMeta`).textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB · Reading duration…`;
    document.getElementById(`${kind}AnalyzeBtn`).disabled = true;
    const objectUrl = URL.createObjectURL(file);
    preview.src = objectUrl;
    preview.hidden = false;
    preview.onloadedmetadata = () => {
      const duration = preview.duration;
      const maxDuration = audio ? 500 : 600;
      if (!Number.isFinite(duration) || duration <= 0) return this.failSelect(kind, 'Could not read the media duration. Try another file.');
      if (duration > maxDuration) return this.failSelect(kind, `Duration exceeds ${audio ? '500 seconds' : '10 minutes'}.`);
      document.getElementById(`${kind}FileMeta`).textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB · ${this.formatDuration(duration)}`;
      document.getElementById(`${kind}AnalyzeBtn`).disabled = false;
      document.getElementById(`${kind}Result`).innerHTML = '';
    };
    preview.onerror = () => {
      // Browser preview codec support is narrower than the server's decoders.
      // Keep the selection usable and let the backend verify duration/content.
      URL.revokeObjectURL(objectUrl);
      preview.hidden = true;
      preview.removeAttribute('src');
      document.getElementById(`${kind}FileMeta`).textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB · Preview unavailable; server will validate duration`;
      document.getElementById(`${kind}AnalyzeBtn`).disabled = false;
      document.getElementById(`${kind}Result`).innerHTML = '';
      App.showToast('Preview is unavailable in this browser. The server will still validate and analyze the file.', 'info');
    };
  },
  failSelect(kind, message) {
    this.files[kind] = null;
    document.getElementById(`${kind}AnalyzeBtn`).disabled = true;
    document.getElementById(`${kind}FileMeta`).textContent = message;
    App.showToast(message, 'error');
  },
  formatDuration(seconds) {
    const min = Math.floor(Number(seconds) / 60);
    const sec = Math.floor(Number(seconds) % 60);
    return `${min}:${String(sec).padStart(2, '0')}`;
  },
  async analyze(kind) {
    const file = this.files[kind];
    if (!file) return;
    const button = document.getElementById(`${kind}AnalyzeBtn`);
    const result = document.getElementById(`${kind}Result`);
    button.disabled = true;
    button.textContent = 'Screening…';
    const startedAt = Date.now();
    result.innerHTML = '<div class="screening-state"><span class="pulse-dot"></span><span>Connecting to the detection service…</span></div>';
    let serviceReady = false;
    const progressTimer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const message = result.querySelector('.screening-state span:last-child');
      if (message && serviceReady) message.textContent = `Model is analyzing ${kind} media (${elapsed}s). Longer recordings take more time; keep this page open.`;
    }, 8000);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600000);
    try {
      await waitForApiReady(controller.signal, status => {
        const message = result.querySelector('.screening-state span:last-child');
        if (message) message.textContent = status;
      });
      serviceReady = true;
      const data = new FormData();
      data.append('file', file);
      const response = await fetch(apiUrl(`/api/analyze/${kind}`), { method: 'POST', body: data, signal: controller.signal });
      const payload = await apiJson(response);
      if (!response.ok) throw new Error(payload.detail || 'Screening failed.');
      if (!Number.isFinite(Number(payload.confidence)) || !Number.isFinite(Number(payload.real_score)) || !Number.isFinite(Number(payload.fake_score)) || !payload.model || (kind === 'audio' && !Array.isArray(payload.segment_results)) || (kind === 'video' && !Array.isArray(payload.frame_results))) {
        throw new Error(`This server is still running an older ${kind} detector, so this scan did not run AI detection. Stop the server with Ctrl+C and restart run.bat from this VerifAI project folder, then analyze the file again.`);
      }
      const isFake = payload.verdict === 'FAKE';
      const detail = kind === 'audio'
        ? `<ul>${payload.signals.map(signal => `<li>${this.escape(signal)}</li>`).join('')}</ul><p>Speech segment scores by timestamp:</p><div class="frame-strip">${payload.segment_results.map(segment => `<span>${this.formatDuration(segment.start_seconds)}–${this.formatDuration(segment.end_seconds)} · ${segment.fake_score}% synthetic</span>`).join('')}</div>`
        : `<p>${payload.frames_analyzed} frames sampled throughout the clip.</p><div class="frame-strip">${payload.frame_results.map(frame => `<span>${frame.time_seconds}s · ${frame.fake_score}% synthetic</span>`).join('')}</div>`;
      const verdictText = isFake ? 'LIKELY MANIPULATED' : 'LIKELY AUTHENTIC';
      result.innerHTML = `<div class="screening-verdict ${isFake ? 'review' : ''}"><span class="text-champagne">${kind.toUpperCase()} AI DETECTOR</span><strong>${verdictText}</strong><small>${payload.confidence}% model confidence · ${this.escape(payload.screening)}</small></div><div class="score-row"><span>Authentic ${payload.real_score}%</span><span>Synthetic ${payload.fake_score}%</span></div><div class="score-track"><span style="width:${payload.real_score}%"></span><span style="width:${payload.fake_score}%"></span></div><div class="screening-details">${detail}<p class="text-muted">${this.escape(payload.note)}</p><small class="text-muted">Model ${this.escape(payload.model)} · Case ${this.escape(payload.analysis_id)} · ${payload.processing_time_ms} ms · SHA-256 ${this.escape(payload.sha256.slice(0, 20))}…</small></div>`;
    } catch (error) {
      const message = error.name === 'AbortError'
        ? `The ${kind} scan did not finish within 10 minutes. Please try a shorter file or try again later.`
        : error.message;
      result.innerHTML = `<div class="screening-error">${this.escape(message)}</div>`;
    } finally {
      clearInterval(progressTimer);
      clearTimeout(timeoutId);
      button.disabled = false;
      button.textContent = kind === 'audio' ? 'Detect audio' : 'Detect video';
    }
  },
  escape(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }
};
window.MediaDetectors = MediaDetectors;
document.addEventListener('DOMContentLoaded', () => MediaDetectors.init());
