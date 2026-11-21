// Send media straight to Render; Vercel's external proxy has a short request timeout.
const VERIFAI_API_ORIGIN = 'https://verifai-a-multimodal-deepfake-detection.onrender.com';
window.apiUrl = (path) => `${VERIFAI_API_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`;
window.mediaUrl = (path) => path && path.startsWith('/uploads/') ? window.apiUrl(path) : path;
window.apiJson = async (response) => {
  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`The Render API returned a non-JSON response (HTTP ${response.status}). Check the Render service status and logs.`);
  }
};
