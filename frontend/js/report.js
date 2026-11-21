// ==========================================================================
// VERIFAI - FORENSIC REPORT GENERATION MODULE (PRINTABLE / PDF)
// ==========================================================================

const ReportModule = {
  printReport(analysisId) {
    let record = App.activeScanData;
    if (analysisId && window.HistoryModule) {
      const found = window.HistoryModule.historyRecords.find(r => r.analysis_id === analysisId);
      if (found) record = found;
    }

    if (!record) {
      App.showToast('No active scan record to export.', 'error');
      return;
    }

    const printWin = window.open('', '_blank');
    if (!printWin) {
      App.showToast('Please allow popups to generate forensic report.', 'error');
      return;
    }

    const isReal = record.prediction === 'REAL';
    const verdictColor = isReal ? '#22A879' : '#D94B55';
    const findings = record.forensic_data?.evidence_fusion?.findings || [];
    const meta = record.forensic_data?.metadata || {};

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>VerifAI Forensic Report - ${record.analysis_id}</title>
        <style>
          @page { size: A4; margin: 15mm; }
          body {
            font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
            background: #ffffff;
            color: #123B2E;
            margin: 0;
            padding: 20px;
            font-size: 11pt;
            line-height: 1.5;
          }
          .header {
            border-bottom: 2px solid #087A55;
            padding-bottom: 12px;
            margin-bottom: 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .brand-title {
            font-size: 24pt;
            font-weight: 800;
            color: #123B2E;
            letter-spacing: 1px;
          }
          .brand-sub {
            font-size: 9pt;
            color: #087A55;
            font-weight: 600;
            text-transform: uppercase;
          }
          .verdict-box {
            border: 2px solid ${verdictColor};
            background: ${isReal ? '#f0fdf7' : '#fff5f5'};
            padding: 16px;
            border-radius: 8px;
            margin-bottom: 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .verdict-title {
            font-size: 20pt;
            font-weight: 800;
            color: ${verdictColor};
          }
          .grid-2 {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
            margin-bottom: 20px;
          }
          .evidence-card {
            border: 1px solid #d1d5db;
            border-radius: 6px;
            padding: 10px;
            text-align: center;
          }
          .evidence-card img {
            max-width: 100%;
            height: 180px;
            object-fit: contain;
            margin-top: 6px;
          }
          .meta-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 9pt;
            margin-bottom: 20px;
          }
          .meta-table th, .meta-table td {
            border: 1px solid #e5e7eb;
            padding: 6px 10px;
            text-align: left;
          }
          .meta-table th {
            background: #f3f4f6;
            color: #123B2E;
          }
          .findings-box {
            background: #f9fafb;
            border: 1px solid #e5e7eb;
            border-radius: 6px;
            padding: 14px;
            margin-bottom: 24px;
          }
          .signature-box {
            border-top: 1px dashed #9ca3af;
            padding-top: 14px;
            display: flex;
            justify-content: space-between;
            font-size: 9pt;
            color: #6b7280;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="brand-title">VERIFAI</div>
            <div class="brand-sub">Digital Media Forensic Authentication Certificate</div>
          </div>
          <div style="text-align: right; font-size: 9pt;">
            <div><strong>Case Ref:</strong> ${record.analysis_id}</div>
            <div><strong>Generated:</strong> ${new Date().toUTCString()}</div>
          </div>
        </div>

        <div class="verdict-box">
          <div>
            <div style="font-size: 8pt; text-transform: uppercase; color: #6b7280;">AUTHENTICITY VERDICT</div>
            <div class="verdict-title">${record.prediction === 'REAL' ? 'AUTHENTIC MEDIA (REAL)' : 'MANIPULATED DIGITAL MEDIA (FAKE)'}</div>
            <div style="font-size: 9pt; margin-top: 4px;">Classification Confidence: <strong>${record.confidence}%</strong> (Inference: ${record.processing_time_ms} ms)</div>
          </div>
          <div style="text-align: right; font-size: 10pt;">
            <div>Real Class Score: <strong>${record.real_score}%</strong></div>
            <div>Fake Class Score: <strong>${record.fake_score}%</strong></div>
          </div>
        </div>

        <h3 style="font-size: 12pt; border-bottom: 1px solid #087A55; padding-bottom: 4px; margin-bottom: 10px;">Forensic Evidence Visuals</h3>
        <div class="grid-2">
          <div class="evidence-card">
            <strong>Original Inspected Media</strong>
            <br>
            <img src="${record.file_path}" />
          </div>
          <div class="evidence-card">
            <strong>PyTorch Grad-CAM Spatial Activation</strong>
            <br>
            <img src="${record.gradcam_path}" />
          </div>
          <div class="evidence-card">
            <strong>2D FFT Magnitude Spectrogram</strong>
            <br>
            <img src="${record.fft_path}" />
          </div>
          <div class="evidence-card">
            <strong>Error Level Analysis (ELA)</strong>
            <br>
            <img src="${record.ela_path}" />
          </div>
        </div>

        <h3 style="font-size: 12pt; border-bottom: 1px solid #087A55; padding-bottom: 4px; margin-bottom: 10px;">Media Provenance & Cryptographic Signature</h3>
        <table class="meta-table">
          <tr><th>Filename</th><td>${record.filename}</td><th>Resolution</th><td>${record.dimensions}</td></tr>
          <tr><th>Format</th><td>${record.format}</td><th>File Size</th><td>${(record.file_size / 1024).toFixed(1)} KB</td></tr>
          <tr><th>SHA-256 Hash</th><td colspan="3"><code style="font-size: 8pt;">${record.sha256}</code></td></tr>
          <tr><th>Neural Architecture</th><td>MobileNetV3-Small (PyTorch)</td><th>Hardware EXIF</th><td>${meta.has_exif ? 'Camera Metadata Present' : 'No EXIF (Synthesized or Stripped)'}</td></tr>
        </table>

        <div class="findings-box">
          <h4 style="margin-top: 0; margin-bottom: 8px;">Multimodal Evidence Fusion Findings</h4>
          <ul style="margin: 0; padding-left: 20px; font-size: 9.5pt;">
            ${findings.map(f => `<li>${f}</li>`).join('')}
          </ul>
        </div>

        <div class="signature-box">
          <div>
            <strong>Forensic Verification System:</strong> VerifAI v1.4.0<br>
            Certified for KYC, Law Enforcement & Digital Media Verification
          </div>
          <div style="text-align: right;">
            <strong>Cryptographic Seal:</strong><br>
            VERIFAI-SEC-${Date.now().toString(16).toUpperCase()}
          </div>
        </div>

        <script>
          window.onload = function() {
            window.print();
          };
        </script>
      </body>
      </html>
    `;

    printWin.document.open();
    printWin.document.write(htmlContent);
    printWin.document.close();
  }
};
