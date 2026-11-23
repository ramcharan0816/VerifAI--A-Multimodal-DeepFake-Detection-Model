// ==========================================================================
// VERIFAI - DIGITAL FORENSICS MODULE
// ==========================================================================

const ForensicsModule = {
  currentRecord: null,
  activeSubTab: 'visual',

  init() {
    this.setupSlider();
    this.setupSubTabs();
    this.setupSampleSwitchers();
    this.ensureLoaded();
  },

  setupSlider() {
    const slider = document.getElementById('gradCamOpacitySlider');
    const heatmapLayer = document.getElementById('forensicsGradCamLayer');
    const opacityValText = document.getElementById('gradCamOpacityValue');

    if (slider && heatmapLayer) {
      slider.addEventListener('input', (e) => {
        const val = e.target.value;
        heatmapLayer.style.opacity = (val / 100).toString();
        if (opacityValText) opacityValText.textContent = `${val}%`;
      });
    }
  },

  setupSubTabs() {
    document.querySelectorAll('[data-forensic-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-forensic-tab]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.getAttribute('data-forensic-tab');
        this.switchSubTab(tab);
      });
    });
  },

  switchSubTab(tabName) {
    this.activeSubTab = tabName;
    const visualPanel = document.getElementById('forensicsVisualPanel');
    const audioPanel = document.getElementById('forensicsAudioPanel');
    const temporalPanel = document.getElementById('forensicsTemporalPanel');

    if (visualPanel) visualPanel.style.display = tabName === 'visual' ? 'block' : 'none';
    if (audioPanel) audioPanel.style.display = tabName === 'audio' ? 'block' : 'none';
    if (temporalPanel) temporalPanel.style.display = tabName === 'temporal' ? 'block' : 'none';
  },

  setupSampleSwitchers() {
    document.querySelectorAll('[data-forensic-sample]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const sampleName = btn.getAttribute('data-forensic-sample');
        await this.loadSample(sampleName);
      });
    });
  },

  async loadSample(sampleName) {
    App.showToast(`Loading forensic scan for ${sampleName}...`, 'info');
    try {
      const res = await apiFetch(apiUrl(`/api/analyze/sample/${encodeURIComponent(sampleName)}`), { method: 'POST' });
      if (res.ok) {
        const record = await apiJson(res);
        this.populateForensicsView(record);
        App.showToast(`Loaded ${record.filename} into Forensics Lab`, 'success');
      }
    } catch (e) {
      console.error('Error loading sample in forensics:', e);
    }
  },

  async ensureLoaded() {
    if (this.currentRecord) return;
    // History is account-scoped; do not issue a request that must be rejected
    // while the sign-in gate is active.
    if (!authToken()) return;
    
    // Check if App has an active scan data
    if (App.activeScanData) {
      this.populateForensicsView(App.activeScanData);
      return;
    }

    // Try fetching the latest scan from SQLite
    try {
      const res = await apiFetch(apiUrl('/api/history?limit=1'));
      if (res.ok) {
        const data = await apiJson(res);
        if (data.scans && data.scans.length > 0) {
          this.populateForensicsView(data.scans[0]);
          return;
        }
      }
    } catch (e) {
      console.warn('History lookup error:', e);
    }

    // Do not start a CPU-heavy sample analysis just by opening the page.
    // Let the user start a scan from the Detector workspace instead.
  },

  populateForensicsView(data) {
    if (!data) return;
    this.currentRecord = data;

    // Title & ID
    const titleEl = document.getElementById('forensicsMediaTitle');
    const idEl = document.getElementById('forensicsCaseId');
    const verdictEl = document.getElementById('forensicsVerdictBadge');

    if (titleEl) titleEl.textContent = data.filename || 'Inspected Media';
    if (idEl) idEl.textContent = data.analysis_id || 'VFY-ACTIVE';
    if (verdictEl) {
      const isReal = data.prediction === 'REAL';
      verdictEl.className = `badge ${isReal ? 'badge-real' : 'badge-fake'}`;
      verdictEl.textContent = `${data.prediction} (${data.confidence}%)`;
    }

    // Set images for interactive layer
    const origLayer = document.getElementById('forensicsOriginalLayer');
    const heatmapLayer = document.getElementById('forensicsGradCamLayer');
    const fftImg = document.getElementById('forensicsFftImage');
    const elaImg = document.getElementById('forensicsElaImage');

    if (origLayer) origLayer.src = mediaUrl(data.file_path) || '/assets/samples/deepfake_faceswap_1.jpg';
    if (heatmapLayer) heatmapLayer.src = mediaUrl(data.gradcam_path) || '';
    if (fftImg) fftImg.src = mediaUrl(data.fft_path) || '';
    if (elaImg) elaImg.src = mediaUrl(data.ela_path) || '';

    // Reset slider
    const slider = document.getElementById('gradCamOpacitySlider');
    const opacityValText = document.getElementById('gradCamOpacityValue');
    if (slider) slider.value = 50;
    if (heatmapLayer) heatmapLayer.style.opacity = '0.5';
    if (opacityValText) opacityValText.textContent = '50%';

    // Suspicious regions tags
    const regionsContainer = document.getElementById('forensicsSuspiciousRegions');
    const regions = data.forensic_data?.model_result?.suspicious_regions || [];
    if (regionsContainer) {
      if (regions.length === 0) {
        regionsContainer.innerHTML = `<span class="badge badge-emerald">✓ Uniform Biological Texture (No Boundary Discontinuities)</span>`;
      } else {
        regionsContainer.innerHTML = regions.map(r => `
          <span class="badge badge-fake" style="font-size: 0.8rem; padding: 0.35rem 0.75rem;">⚠ ${r}</span>
        `).join('');
      }
    }

    // High frequency ratio
    const highFreqRatio = data.forensic_data?.frequency_analysis?.high_freq_ratio || 0;
    const freqEl = document.getElementById('forensicsFreqRatioText');
    if (freqEl) freqEl.textContent = `${highFreqRatio}% High-Frequency Energy`;

    // ELA Score
    const elaScore = data.forensic_data?.compression_analysis?.ela_score || 0;
    const elaEl = document.getElementById('forensicsElaScoreText');
    if (elaEl) elaEl.textContent = `Mean Error Level: ${elaScore}`;

    // Metadata items table
    const metaTable = document.getElementById('forensicsMetadataBody');
    const meta = data.forensic_data?.metadata || {};
    if (metaTable) {
      metaTable.innerHTML = `
        <tr><td><strong>Image Resolution</strong></td><td>${meta.dimensions || data.dimensions}</td></tr>
        <tr><td><strong>Aspect Ratio</strong></td><td>${meta.aspect_ratio || '1:1'}</td></tr>
        <tr><td><strong>Container Format</strong></td><td>${meta.format || data.format}</td></tr>
        <tr><td><strong>File Size</strong></td><td>${meta.file_size_formatted || (data.file_size / 1024).toFixed(1) + ' KB'}</td></tr>
        <tr><td><strong>Color Encoding</strong></td><td>${meta.color_mode || 'RGB'} (24-bit sRGB)</td></tr>
        <tr><td><strong>Compression Factor</strong></td><td>${meta.compression_ratio || '12.4:1'}</td></tr>
        <tr><td><strong>Hardware Camera EXIF</strong></td><td>${meta.has_exif ? 'Camera Metadata Present' : 'No Hardware EXIF (Synthesized or Stripped)'}</td></tr>
        <tr><td><strong>Cryptographic SHA-256</strong></td><td><code style="font-size: 0.75rem; color: var(--color-mint);">${data.sha256}</code></td></tr>
      `;
    }

    // Evidence Fusion Breakdown
    const fusionList = document.getElementById('forensicsFindingsList');
    const findings = data.forensic_data?.evidence_fusion?.findings || [];
    if (fusionList) {
      fusionList.innerHTML = findings.map(f => `
        <li style="margin-bottom: 0.65rem; color: var(--color-ivory); font-size: 0.88rem; display: flex; align-items: flex-start; gap: 0.5rem;">
          <span style="color: var(--color-mint); font-weight: bold;">▶</span>
          <span>${f}</span>
        </li>
      `).join('');
    }
  }
};

window.ForensicsModule = ForensicsModule;

document.addEventListener('DOMContentLoaded', () => {
  ForensicsModule.init();
});
