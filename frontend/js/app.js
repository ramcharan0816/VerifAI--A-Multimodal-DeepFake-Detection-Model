// ==========================================================================
// VERIFAI - APPLICATION CORE & SPA ROUTER
// ==========================================================================

const App = {
  currentView: 'overview',
  activeScanData: null,
  
  init() {
    this.setupNavigation();
    this.setupAuth();
    this.setupHeroCanvas();
    this.setupAccordions();
    this.checkSystemHealth();
    this.loadDashboardStats();
    
    // Check initial hash route
    const hash = window.location.hash.replace('#', '');
    if (hash && ['overview', 'detector', 'forensics', 'history', 'model', 'workflow', 'about', 'settings'].includes(hash)) {
      this.switchView(hash);
    } else {
      this.switchView('overview');
    }
  },

  setupAuth() {
    this.authMode = 'login';
    const gate = document.getElementById('authGate');
    const form = document.getElementById('authForm');
    const accountButton = document.getElementById('accountButton');
    const toggle = document.getElementById('authToggle');
    const setAuthView = () => {
      const signedIn = Boolean(authToken());
      gate.hidden = signedIn;
      accountButton.textContent = signedIn ? 'Sign out' : 'Sign in';
      accountButton.title = signedIn ? 'Sign out of your VerifAI account' : 'Sign in to save detection history';
    };
    setAuthView();
    accountButton.addEventListener('click', () => {
      if (authToken()) {
        localStorage.removeItem('verifai_auth_token');
        setAuthView();
        this.loadDashboardStats();
        if (window.HistoryModule) { window.HistoryModule.historyRecords = []; window.HistoryModule.renderHistoryTable(); }
      } else gate.hidden = false;
    });
    toggle.addEventListener('click', () => {
      this.authMode = this.authMode === 'login' ? 'register' : 'login';
      document.getElementById('authTitle').textContent = this.authMode === 'login' ? 'Welcome back' : 'Create your account';
      document.getElementById('authDescription').textContent = this.authMode === 'login' ? 'Sign in to save and view your private detection history.' : 'Create an account to keep your detection history with you.';
      document.getElementById('authSubmit').textContent = this.authMode === 'login' ? 'Sign in' : 'Create account';
      document.getElementById('authPassword').autocomplete = this.authMode === 'login' ? 'current-password' : 'new-password';
      toggle.textContent = this.authMode === 'login' ? 'Create a new account' : 'I already have an account';
      document.getElementById('authError').textContent = '';
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const button = document.getElementById('authSubmit');
      const error = document.getElementById('authError');
      button.disabled = true;
      error.textContent = '';
      try {
        const credentials = JSON.stringify({ email: document.getElementById('authEmail').value, password: document.getElementById('authPassword').value });
        button.textContent = 'Connecting…';
        await waitForApiReady(undefined, status => { button.textContent = status; });
        let response = await fetch(apiUrl(`/api/auth/${this.authMode}`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: credentials });
        if ([502, 503, 504].includes(response.status)) {
          button.textContent = 'Reconnecting…';
          await waitForApiReady(undefined, status => { button.textContent = status; });
          response = await fetch(apiUrl(`/api/auth/${this.authMode}`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: credentials });
        }
        // The first registration may have succeeded even if its gateway response
        // was lost. In that case, sign in with the same submitted credentials.
        if (this.authMode === 'register' && response.status === 409) {
          response = await fetch(apiUrl('/api/auth/login'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: credentials });
        }
        const data = await apiJson(response);
        if (!response.ok) throw new Error(data.detail || 'Could not sign in.');
        localStorage.setItem('verifai_auth_token', data.token);
        form.reset();
        setAuthView();
        this.loadDashboardStats();
        if (window.HistoryModule) window.HistoryModule.loadHistory();
        if (this.currentView === 'forensics' && window.ForensicsModule) window.ForensicsModule.ensureLoaded();
        this.showToast('Signed in successfully', 'success');
      } catch (err) { error.textContent = err.message; }
      finally {
        button.disabled = false;
        button.textContent = this.authMode === 'login' ? 'Sign in' : 'Create account';
      }
    });
  },

  setupNavigation() {
    // Top Nav links
    document.querySelectorAll('[data-nav-view]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const view = el.getAttribute('data-nav-view');
        this.switchView(view);
      });
    });

    // Sidebar items
    document.querySelectorAll('[data-sidebar-view]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const view = el.getAttribute('data-sidebar-view');
        this.switchView(view);
      });
    });
  },

  switchView(viewName) {
    this.currentView = viewName;
    window.location.hash = viewName;

    // Toggle view sections
    document.querySelectorAll('.view-section').forEach(sec => {
      sec.classList.remove('active');
    });
    const targetSection = document.getElementById(`view-${viewName}`);
    if (targetSection) {
      targetSection.classList.add('active');
    }

    // Update active nav link
    document.querySelectorAll('[data-nav-view]').forEach(el => {
      el.classList.toggle('active', el.getAttribute('data-nav-view') === viewName);
    });

    // Update active sidebar item
    document.querySelectorAll('[data-sidebar-view]').forEach(el => {
      el.classList.toggle('active', el.getAttribute('data-sidebar-view') === viewName);
    });

    // View specific hooks
    if (viewName === 'history' && window.HistoryModule) {
      window.HistoryModule.loadHistory();
    } else if (viewName === 'forensics' && window.ForensicsModule) {
      window.ForensicsModule.ensureLoaded();
    } else if (viewName === 'model' && window.ModelInfoModule) {
      window.ModelInfoModule.loadModelInfo();
    } else if (viewName === 'overview') {
      this.loadDashboardStats();
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  showToast(message, type = 'info') {
    let container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.style.cssText = `
        position: fixed;
        bottom: 2rem;
        right: 2rem;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      `;
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    const borderCol = type === 'success' ? '#22A879' : type === 'error' ? '#D94B55' : '#65C9A5';
    toast.style.cssText = `
      background: rgba(16, 43, 36, 0.95);
      border: 1px solid ${borderCol};
      color: #F5F1E8;
      padding: 0.85rem 1.25rem;
      border-radius: 8px;
      font-size: 0.88rem;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
      backdrop-filter: blur(12px);
      display: flex;
      align-items: center;
      gap: 0.65rem;
      animation: fadeIn 0.3s ease;
      max-width: 380px;
    `;
    toast.innerHTML = `<span>${type === 'success' ? '✓' : type === 'error' ? '⚠' : 'ℹ'}</span> <div>${message}</div>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  },

  async checkSystemHealth() {
    try {
      const res = await apiFetch(apiUrl('/api/health'));
      if (res.ok) {
        const data = await apiJson(res);
        const indicator = document.getElementById('systemHealthText');
        if (indicator) {
          indicator.textContent = `Engine Active • PyTorch MobileNetV3 (${data.device.toUpperCase()})`;
        }
      }
    } catch (e) {
      console.warn('Backend health check warning:', e);
    }
  },

  async loadDashboardStats() {
    if (!authToken()) {
      ['statTotalScans', 'statRealScans', 'statFakeScans'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '—'; });
      const recent = document.getElementById('recentActivityList');
      if (recent) recent.innerHTML = '<div style="text-align:center;color:var(--color-muted-text);padding:2rem">Sign in to view your saved scan history.</div>';
      return;
    }
    try {
      const res = await apiFetch(apiUrl('/api/dashboard/stats'));
      if (res.ok) {
        const stats = await apiJson(res);
        const totalEl = document.getElementById('statTotalScans');
        const realEl = document.getElementById('statRealScans');
        const fakeEl = document.getElementById('statFakeScans');
        const avgTimeEl = document.getElementById('statAvgTime');

        if (totalEl) totalEl.textContent = stats.total_scans;
        if (realEl) realEl.textContent = stats.real_count;
        if (fakeEl) fakeEl.textContent = stats.fake_count;
        if (avgTimeEl) avgTimeEl.textContent = `${stats.avg_processing_time_ms || 38.4} ms`;

        // Render recent activity list on overview
        const recentList = document.getElementById('recentActivityList');
        if (recentList && stats.recent_scans) {
          if (stats.recent_scans.length === 0) {
            recentList.innerHTML = `<div style="text-align: center; color: var(--color-muted-text); padding: 2rem;">No recent scans yet. Upload an image to start verification.</div>`;
          } else {
            recentList.innerHTML = stats.recent_scans.map(s => `
              <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.85rem 0; border-bottom: 1px solid rgba(49, 83, 68, 0.4);">
                <div style="display: flex; align-items: center; gap: 0.85rem;">
                  <img src="${mediaUrl(s.file_path)}" style="width: 44px; height: 44px; border-radius: 6px; object-fit: cover; border: 1px solid var(--color-border-green);" />
                  <div>
                    <div style="font-weight: 600; font-size: 0.9rem;">${s.filename}</div>
                    <div style="font-size: 0.75rem; color: var(--color-muted-text);">${new Date(s.created_at).toLocaleString()} • ${s.dimensions}</div>
                  </div>
                </div>
                <div style="display: flex; align-items: center; gap: 1rem;">
                  <span class="badge ${s.prediction === 'REAL' ? 'badge-real' : 'badge-fake'}">${s.prediction} (${s.confidence}%)</span>
                  <button class="btn btn-outline btn-sm" onclick="App.inspectScan('${s.analysis_id}')">Inspect</button>
                </div>
              </div>
            `).join('');
          }
        }
      }
    } catch (e) {
      console.warn('Dashboard stats error:', e);
    }
  },

  inspectScan(scanId) {
    if (window.HistoryModule) {
      window.HistoryModule.openDetailModal(scanId);
    }
  },

  setupHeroCanvas() {
    const canvas = document.getElementById('heroCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let width = canvas.width = canvas.parentElement.offsetWidth;
    let height = canvas.height = canvas.parentElement.offsetHeight;

    window.addEventListener('resize', () => {
      if (canvas.parentElement) {
        width = canvas.width = canvas.parentElement.offsetWidth;
        height = canvas.height = canvas.parentElement.offsetHeight;
      }
    });

    const particles = [];
    const count = 45;
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        radius: Math.random() * 2 + 1,
        color: Math.random() > 0.4 ? '#65C9A5' : '#D8C39A'
      });
    }

    function animate() {
      ctx.clearRect(0, 0, width, height);
      for (let i = 0; i < count; i++) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();

        for (let j = i + 1; j < count; j++) {
          const p2 = particles[j];
          const dist = Math.hypot(p.x - p2.x, p.y - p2.y);
          if (dist < 110) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = `rgba(101, 201, 165, ${0.22 * (1 - dist / 110)})`;
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
      }
      requestAnimationFrame(animate);
    }
    animate();
  },

  setupAccordions() {
    document.querySelectorAll('.accordion-header').forEach(header => {
      header.addEventListener('click', () => {
        const item = header.parentElement;
        item.classList.toggle('open');
      });
    });
  }
};

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
