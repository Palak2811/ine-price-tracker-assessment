/**
 * Thin API client.
 *
 * The base URL is injected at build time via VITE_API_BASE_URL so the same
 * bundle can point at localhost or the Render service without a code change.
 */

const BASE = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080').replace(/\/$/, '');

/** Error carrying the API's machine-readable code, so the UI can react to it. */
export class ApiClientError extends Error {
  constructor(message, { code, status } = {}) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch {
    // A network-level failure (backend asleep, DNS, offline) has no response.
    throw new ApiClientError(
      'Could not reach the API. If the backend is on a free tier it may be waking up — try again in a moment.',
      { code: 'network_error' }
    );
  }

  const text = await res.text();
  const body = text ? safeJson(text) : null;

  if (!res.ok) {
    throw new ApiClientError(
      body?.error?.message ?? `Request failed (${res.status})`,
      { code: body?.error?.code, status: res.status }
    );
  }
  return body;
}

const safeJson = (t) => { try { return JSON.parse(t); } catch { return null; } };

export const api = {
  searchProducts: (q, limit = 20) =>
    request(`/api/products/search?q=${encodeURIComponent(q)}&limit=${limit}`),

  listTracked: () => request('/api/tracked-products'),

  track: (productId, scrapeIntervalMinutes) =>
    request('/api/tracked-products', {
      method: 'POST',
      body: JSON.stringify({ productId, scrapeIntervalMinutes }),
    }),

  getTracked: (id) => request(`/api/tracked-products/${id}`),

  untrack: (id) => request(`/api/tracked-products/${id}`, { method: 'DELETE' }),

  setInterval: (id, scrapeIntervalMinutes) =>
    request(`/api/tracked-products/${id}/interval`, {
      method: 'PATCH',
      body: JSON.stringify({ scrapeIntervalMinutes }),
    }),

  scrapeNow: (id) => request(`/api/tracked-products/${id}/scrape`, { method: 'POST' }),

  health: () => request('/health'),
};
