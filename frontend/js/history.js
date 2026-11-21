// ==========================================================================
// VERIFAI - SCAN HISTORY MODULE
// ==========================================================================

const HistoryModule = {
  currentFilter: 'ALL',
  searchQuery: '',
  historyRecords: [],

  init() {
    this.setupFilters();
    this.setupSearch();
    this.setupActions();
    this.loadHistory();
  },

  setupFilters() {
    document.querySelectorAll('[data-history-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-history-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentFilter = btn.getAttribute('data-history-filter');
        this.renderHistoryTable();
      });
    });
  },

  setupSearch() {
    const searchInput = document.getElementById('historySearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.toLowerCase().trim();
        this.renderHistoryTable();
      });
    }
  },

  setupActions() {
    const clearBtn = document.getElementById('btnClearHistory');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to permanently clear all scan records from SQLite?')) {
          this.clearAllHistory();
        }
      });
    }

    const exportBtn = document.getElementById('btnExportHistoryJson');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        this.exportHistoryJson();
      });
    }
  },

  async loadHistory() {
    try {
      const res = await fetch(apiUrl('/api/history?limit=100'));
      if (res.ok) {
        const data = await apiJson(res);
        this.historyRecords = data.scans || [];
        this.renderHistoryTable();
      }
    } catch (e) {
      console.error('Failed to load history:', e);
    }
  },

  renderHistoryTable() {
    const tbody = document.getElementById('historyTableBody');
    const emptyState = document.getElementById('historyEmptyState');
    if (!tbody) return;

    let filtered = this.historyRecords;

    if (this.currentFilter !== 'ALL') {
      filtered = filtered.filter(r => r.prediction === this.currentFilter);
    }

    if (this.searchQuery) {
      filtered = filtered.filter(r => 
        (r.filename && r.filename.toLowerCase().includes(this.searchQuery)) ||
        (r.analysis_id && r.analysis_id.toLowerCase().includes(this.searchQuery))
      );
    }

    if (filtered.length === 0) {
      tbody.innerHTML = '';
      if (emptyState) emptyState.style.display = 'block';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    tbody.innerHTML = filtered.map(r => `
      <tr>
        <td>
          <img src="${mediaUrl(r.file_path)}" style="width: 48px; height: 48px; border-radius: 6px; object-fit: cover; border: 1px solid var(--color-border-green);" />
        </td>
        <td>
          <div style="font-weight: 600; font-size: 0.92rem;">${r.filename}</div>
          <div style="font-size: 0.75rem; color: var(--color-mint);">${r.analysis_id}</div>
        </td>
        <td>
          <span class="badge ${r.prediction === 'REAL' ? 'badge-real' : 'badge-fake'}">
            ${r.prediction}
          </span>
        </td>
        <td>
          <div style="font-weight: 700;">${r.confidence}%</div>
          <div style="font-size: 0.72rem; color: var(--color-muted-text);">Real: ${r.real_score}% | Fake: ${r.fake_score}%</div>
        </td>
        <td>
          <div>${r.dimensions}</div>
          <div style="font-size: 0.72rem; color: var(--color-muted-text);">${(r.file_size / 1024).toFixed(1)} KB</div>
        </td>
        <td>${r.processing_time_ms} ms</td>
        <td style="font-size: 0.8rem; color: var(--color-muted-text);">
          ${new Date(r.created_at).toLocaleString()}
        </td>
        <td>
          <div style="display: flex; gap: 0.5rem;">
            <button class="btn btn-outline btn-sm" onclick="HistoryModule.openDetailModal('${r.analysis_id}')">
              Dossier
            </button>
            <button class="btn btn-danger btn-sm" onclick="HistoryModule.deleteRecord('${r.analysis_id}')">
              ✕
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  },

  async openDetailModal(analysisId) {
    const record = this.historyRecords.find(r => r.analysis_id === analysisId);
    if (!record) return;

    const modal = document.getElementById('historyDetailModal');
    const modalContent = document.getElementById('historyDetailModalContent');
    if (!modal || !modalContent) return;

    modalContent.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--color-border-green); padding-bottom: 1rem; margin-bottom: 1.5rem;">
        <div>
          <div style="font-size: 0.75rem; color: var(--color-champagne); text-transform: uppercase;">FORENSIC AUDIT DOSSIER</div>
          <h2 style="font-size: 1.5rem; margin-top: 0.25rem;">${record.filename}</h2>
          <div style="font-size: 0.8rem; color: var(--color-mint);">${record.analysis_id}</div>
        </div>
        <span class="badge ${record.prediction === 'REAL' ? 'badge-real' : 'badge-fake'}" style="font-size: 1rem; padding: 0.5rem 1rem;">
          ${record.prediction} (${record.confidence}%)
        </span>
      </div>

      <div class="grid-2" style="margin-bottom: 1.5rem;">
        <div>
          <h4 style="margin-bottom: 0.75rem; font-size: 0.95rem; color: var(--color-champagne);">Original Inspected Media</h4>
          <img src="${mediaUrl(record.file_path)}" style="width: 100%; border-radius: 10px; border: 1px solid var(--color-border-green); max-height: 280px; object-fit: contain; background: #0a1813;" />
        </div>
        <div>
          <h4 style="margin-bottom: 0.75rem; font-size: 0.95rem; color: var(--color-champagne);">PyTorch Grad-CAM Spatial Activation</h4>
          <img src="${mediaUrl(record.gradcam_path)}" style="width: 100%; border-radius: 10px; border: 1px solid var(--color-border-green); max-height: 280px; object-fit: contain; background: #0a1813;" />
        </div>
      </div>

      <div class="grid-2" style="margin-bottom: 1.5rem;">
        <div>
          <h4 style="margin-bottom: 0.75rem; font-size: 0.95rem; color: var(--color-champagne);">2D FFT Magnitude Spectrogram</h4>
          <img src="${mediaUrl(record.fft_path)}" style="width: 100%; border-radius: 10px; border: 1px solid var(--color-border-green); max-height: 220px; object-fit: contain; background: #0a1813;" />
        </div>
        <div>
          <h4 style="margin-bottom: 0.75rem; font-size: 0.95rem; color: var(--color-champagne);">Error Level Analysis (ELA)</h4>
          <img src="${mediaUrl(record.ela_path)}" style="width: 100%; border-radius: 10px; border: 1px solid var(--color-border-green); max-height: 220px; object-fit: contain; background: #0a1813;" />
        </div>
      </div>

      <div style="background: var(--color-deep-forest); border: 1px solid var(--color-border-green); border-radius: 10px; padding: 1.25rem; margin-bottom: 1.5rem;">
        <h4 style="color: var(--color-soft-mint); margin-bottom: 0.5rem; font-size: 0.92rem;">Forensic Evidence Findings</h4>
        <ul style="padding-left: 1.25rem; font-size: 0.88rem; color: var(--color-ivory);">
          ${(record.forensic_data?.evidence_fusion?.findings || []).map(f => `<li>${f}</li>`).join('')}
        </ul>
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 1rem;">
        <button class="btn btn-outline" onclick="HistoryModule.closeModal()">Close</button>
        <button class="btn btn-primary" onclick="ReportModule.printReport('${record.analysis_id}')">Print / Export PDF</button>
      </div>
    `;

    modal.classList.add('active');
  },

  closeModal() {
    const modal = document.getElementById('historyDetailModal');
    if (modal) modal.classList.remove('active');
  },

  async deleteRecord(analysisId) {
    if (!confirm(`Delete scan record ${analysisId}?`)) return;
    try {
      const res = await fetch(apiUrl(`/api/history/${analysisId}`), { method: 'DELETE' });
      if (res.ok) {
        App.showToast(`Deleted record ${analysisId}`, 'info');
        this.historyRecords = this.historyRecords.filter(r => r.analysis_id !== analysisId);
        this.renderHistoryTable();
        App.loadDashboardStats();
      }
    } catch (e) {
      console.error('Error deleting scan:', e);
    }
  },

  async clearAllHistory() {
    try {
      const res = await fetch(apiUrl('/api/history'), { method: 'DELETE' });
      if (res.ok) {
        App.showToast('All scan records cleared', 'info');
        this.historyRecords = [];
        this.renderHistoryTable();
        App.loadDashboardStats();
      }
    } catch (e) {
      console.error('Error clearing history:', e);
    }
  },

  exportHistoryJson() {
    const blob = new Blob([JSON.stringify(this.historyRecords, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `verifai_forensic_history_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    App.showToast('Exported scan history as JSON', 'success');
  }
};

document.addEventListener('DOMContentLoaded', () => {
  HistoryModule.init();
});
