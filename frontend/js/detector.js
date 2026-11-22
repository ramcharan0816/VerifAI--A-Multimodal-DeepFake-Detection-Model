// ==========================================================================
// VERIFAI - DETECTOR WORKSPACE MODULE
// ==========================================================================

const DetectorModule = {
  selectedFile: null,
  selectedSampleName: null,
  isProcessing: false,
  lastResult: null,

  init() {
    this.setupDropzone();
    this.setupSampleChips();
    this.setupActionButtons();
  },

  setupDropzone() {
    const dropzone = document.getElementById('uploadDropzone');
    const fileInput = document.getElementById('imageFileInput');
    if (!dropzone || !fileInput) return;

    dropzone.addEventListener('click', () => {
      fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        this.handleFileSelected(e.target.files[0]);
      }
    });

    ['dragenter', 'dragover'].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
      });
    });

    dropzone.addEventListener('drop', (e) => {
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        this.handleFileSelected(e.dataTransfer.files[0]);
      }
    });
  },

  setupSampleChips() {
    document.querySelectorAll('[data-sample-name]').forEach(chip => {
      chip.addEventListener('click', () => {
        const sampleName = chip.getAttribute('data-sample-name');
        this.loadSample(sampleName);
      });
    });
  },

  setupActionButtons() {
    const analyzeBtn = document.getElementById('btnStartAnalysis');
    if (analyzeBtn) {
      analyzeBtn.addEventListener('click', () => {
        this.runAnalysis();
      });
    }

    const resetBtn = document.getElementById('btnResetWorkspace');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this.resetWorkspace();
        if (window.MediaDetectors) window.MediaDetectors.reset();
      });
    }
  },

  handleFileSelected(file) {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type) && !file.name.match(/\.(jpg|jpeg|png|webp)$/i)) {
      App.showToast('Unsupported file type. Please upload a JPG, JPEG, PNG, or WEBP image.', 'error');
      return;
    }

    if (file.size > 15 * 1024 * 1024) {
      App.showToast('File size exceeds the 15 MB threshold.', 'error');
      return;
    }

    this.selectedFile = file;
    this.selectedSampleName = null;

    const reader = new FileReader();
    reader.onload = (e) => {
      this.displayPreview(e.target.result, file.name, `${(file.size / 1024).toFixed(1)} KB`);
    };
    reader.readAsDataURL(file);
  },

  loadSample(sampleName) {
    this.selectedSampleName = sampleName;
    this.selectedFile = null;
    const url = `/assets/samples/${sampleName}`;
    this.displayPreview(url, sampleName, 'Sample Test Image');
    App.showToast(`Loaded sample: ${sampleName}`, 'info');
  },

  displayPreview(src, filename, sizeStr) {
    const previewContainer = document.getElementById('previewStage');
    const dropzone = document.getElementById('uploadDropzone');
    const previewImg = document.getElementById('previewImageElement');
    const nameEl = document.getElementById('previewFilename');
    const sizeEl = document.getElementById('previewFilesize');
    const resultBox = document.getElementById('analysisResultContainer');

    if (previewImg) previewImg.src = src;
    if (nameEl) nameEl.textContent = filename;
    if (sizeEl) sizeEl.textContent = sizeStr;

    if (dropzone) dropzone.style.display = 'none';
    if (previewContainer) previewContainer.style.display = 'grid';
    if (resultBox) resultBox.style.display = 'none';

    const analyzeBtn = document.getElementById('btnStartAnalysis');
    if (analyzeBtn) analyzeBtn.disabled = false;
  },

  resetWorkspace() {
    this.selectedFile = null;
    this.selectedSampleName = null;
    this.lastResult = null;

    const dropzone = document.getElementById('uploadDropzone');
    const previewContainer = document.getElementById('previewStage');
    const resultBox = document.getElementById('analysisResultContainer');
    const fileInput = document.getElementById('imageFileInput');

    if (dropzone) dropzone.style.display = 'block';
    if (previewContainer) previewContainer.style.display = 'none';
    if (resultBox) resultBox.style.display = 'none';
    if (fileInput) fileInput.value = '';

    const laser = document.getElementById('scanLaserOverlay');
    if (laser) laser.classList.remove('scanning');
  },

  async runAnalysis() {
    if (this.isProcessing) return;
    if (!this.selectedFile && !this.selectedSampleName) {
      App.showToast('Please select or upload an image first.', 'error');
      return;
    }

    this.isProcessing = true;
    const analyzeBtn = document.getElementById('btnStartAnalysis');
    if (analyzeBtn) {
      analyzeBtn.disabled = true;
      analyzeBtn.innerHTML = `<span class="pulse-dot"></span> Analyzing Neural Tensors...`;
    }

    const laser = document.getElementById('scanLaserOverlay');
    if (laser) laser.classList.add('scanning');

    const progressEl = document.getElementById('scanProgressSteps');
    if (progressEl) {
      progressEl.innerHTML = `
        <div style="font-size: 0.85rem; color: var(--color-mint); margin-top: 0.75rem; display: flex; align-items: center; gap: 0.5rem;">
          <div class="pulse-dot"></div> <span>Connecting to the detection service...</span>
        </div>
      `;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000);
    let analysisSucceeded = false;
    try {
      await waitForApiReady(controller.signal, (status) => {
        if (progressEl) {
          progressEl.innerHTML = `<div style="font-size: 0.85rem; color: var(--color-mint); margin-top: 0.75rem; display: flex; align-items: center; gap: 0.5rem;"><div class="pulse-dot"></div><span>${status}</span></div>`;
        }
      });

      let response;
      if (this.selectedFile) {
        const formData = new FormData();
        formData.append('file', this.selectedFile);
        response = await fetch(apiUrl('/api/analyze/image'), {
          method: 'POST',
          body: formData,
          signal: controller.signal
        });
      } else {
        response = await fetch(apiUrl(`/api/analyze/sample/${encodeURIComponent(this.selectedSampleName)}`), {
          method: 'POST',
          signal: controller.signal
        });
      }

      if (!response.ok) {
        const err = await apiJson(response);
        throw new Error(err.detail || 'Analysis failed on backend');
      }

      const result = await apiJson(response);
      this.lastResult = result;
      App.activeScanData = result;
      analysisSucceeded = true;

      // Render results
      this.renderResults(result);
      App.showToast(`Analysis Complete: Classified as ${result.prediction}`, result.prediction === 'REAL' ? 'success' : 'error');

      // Refresh overview stats
      App.loadDashboardStats();

    } catch (err) {
      console.error('Analysis error:', err);
      const message = err.name === 'AbortError'
        ? 'The detection service did not finish within 3 minutes. Check that the backend is running, then try again.'
        : err instanceof TypeError
          ? 'Could not reach the detection service. It may be waking up or unavailable; please try again shortly.'
          : `Error: ${err.message}`;
      App.showToast(message, 'error');
      if (progressEl) progressEl.textContent = message;
    } finally {
      clearTimeout(timeoutId);
      this.isProcessing = false;
      if (laser) laser.classList.remove('scanning');
      if (analyzeBtn) {
        analyzeBtn.disabled = false;
        analyzeBtn.innerHTML = `<span>Re-Analyze Media</span>`;
      }
      if (progressEl && analysisSucceeded) progressEl.innerHTML = '';
    }
  },

  renderResults(data) {
    const resultBox = document.getElementById('analysisResultContainer');
    if (!resultBox) return;
    resultBox.style.display = 'block';

    const isReal = data.prediction === 'REAL';
    const verdictBanner = document.getElementById('resultVerdictBanner');
    if (verdictBanner) {
      verdictBanner.className = `verdict-banner ${isReal ? 'real' : 'fake'}`;
      verdictBanner.innerHTML = `
        <div>
          <div style="font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--color-champagne); margin-bottom: 0.25rem;">
            AUTHENTICITY VERDICT
          </div>
          <div class="verdict-title">
            <span>${isReal ? '🛡️ REAL MEDIA' : '⚠ MANIPULATED / FAKE'}</span>
          </div>
          <div style="font-size: 0.85rem; color: var(--color-ivory); margin-top: 0.35rem; max-width: 500px;">
            ${data.forensic_data?.evidence_fusion?.summary || 'Deep learning neural evaluation complete.'}
          </div>
        </div>
        <div class="confidence-gauge-container">
          <div style="position: relative; width: 85px; height: 85px; display: flex; align-items: center; justify-content: center;">
            <svg class="gauge-svg" viewBox="0 0 100 100">
              <circle class="gauge-bg" cx="50" cy="50" r="40" />
              <circle class="gauge-meter" cx="50" cy="50" r="40" 
                      stroke="${isReal ? '#22A879' : '#D94B55'}"
                      stroke-dasharray="251.2"
                      stroke-dashoffset="${251.2 - (251.2 * data.confidence) / 100}" />
            </svg>
            <div style="position: absolute; text-align: center;">
              <span style="font-size: 1.15rem; font-weight: 800; color: #fff;">${data.confidence}%</span>
            </div>
          </div>
        </div>
      `;
    }

    // Probability split bar
    const realScore = data.real_score || 50;
    const fakeScore = data.fake_score || 50;
    const barFillReal = document.getElementById('probFillReal');
    const barFillFake = document.getElementById('probFillFake');
    const labelReal = document.getElementById('probLabelReal');
    const labelFake = document.getElementById('probLabelFake');

    if (barFillReal) barFillReal.style.width = `${realScore}%`;
    if (barFillFake) barFillFake.style.width = `${fakeScore}%`;
    if (labelReal) labelReal.textContent = `Authentic Score: ${realScore}%`;
    if (labelFake) labelFake.textContent = `Manipulated Score: ${fakeScore}%`;

    // Metadata items
    const elId = document.getElementById('resultAnalysisId');
    const elDuration = document.getElementById('resultDuration');
    const elModel = document.getElementById('resultModelArch');
    const elHash = document.getElementById('resultSha256');

    if (elId) elId.textContent = data.analysis_id;
    if (elDuration) elDuration.textContent = `${data.processing_time_ms} ms`;
    if (elModel) elModel.textContent = `MobileNetV3-Small (260×260)`;
    if (elHash) elHash.textContent = (data.sha256 || '').substring(0, 24) + '...';

    // Populate Forensics panel with this scan
    if (window.ForensicsModule) {
      window.ForensicsModule.populateForensicsView(data);
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  DetectorModule.init();
});
