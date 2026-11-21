// Vercel rewrites these same-origin paths to Render, avoiding browser CORS.
window.apiUrl = (path) => path.startsWith('/') ? path : `/${path}`;
window.mediaUrl = (path) => path && path.startsWith('/uploads/') ? path : path;
window.apiJson = async (response) => {
  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`The API proxy returned a non-JSON response (HTTP ${response.status}). Check the latest Vercel and Render deployment logs.`);
  }
};
