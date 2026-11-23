// Set the API host in index.html's verifai-api-origin meta tag for each deployment.
const VERIFAI_API_ORIGIN = (window.VERIFAI_API_ORIGIN || document.querySelector('meta[name="verifai-api-origin"]')?.content || '').replace(/\/+$/, '');
window.apiUrl = (path) => `${VERIFAI_API_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`;
window.mediaUrl = (path) => path && path.startsWith('/uploads/') ? window.apiUrl(path) : path;
window.apiJson = async (response) => {
  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch {
    if ([502, 503, 504].includes(response.status)) {
      throw new Error(`The detection service returned HTTP ${response.status}. It may still be starting; wait a moment and try again.`);
    }
    throw new Error(`The detection API returned a non-JSON response (HTTP ${response.status}). Check the backend service status and logs.`);
  }
};

window.waitForApiReady = async (signal, onStatus) => {
  const deadline = Date.now() + 90000;
  let delay = 2000;

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new DOMException('Analysis cancelled', 'AbortError');
    onStatus?.('Waking the detection service and loading its model...');

    try {
      const response = await fetch(apiUrl('/api/health'), { signal });
      if (response.ok) {
        const health = await apiJson(response);
        if (health.status === 'healthy' && health.model_loaded) return health;
      } else if (![502, 503, 504].includes(response.status)) {
        throw new Error(`Detection service health check failed (HTTP ${response.status}).`);
      }
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      if (!(error instanceof TypeError) && !/non-JSON response \(HTTP 50[234]\)/.test(error.message)) throw error;
    }

    await new Promise((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException('Analysis cancelled', 'AbortError'));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, delay);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    delay = Math.min(Math.round(delay * 1.5), 8000);
  }

  throw new Error('The detection service is still starting after 90 seconds. Please try again shortly.');
};

window.authToken = () => localStorage.getItem('verifai_auth_token') || '';
window.apiFetch = (url, options = {}) => {
  const headers = new Headers(options.headers || {});
  const token = window.authToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...options, headers });
};
