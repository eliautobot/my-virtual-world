const DEFAULT_VIEWER_PARAMS = Object.freeze({
  resize: 'scale',
  autoconnect: '1',
});

/**
 * Add safe responsive defaults to a configured browser viewer URL.
 *
 * Existing values win so deployments that deliberately use another KasmVNC
 * resize mode are not overwritten. The URL API also places the query before a
 * fragment and preserves credentials, paths, and unrelated query parameters.
 */
export function buildBrowserViewerUrl(rawUrl, baseUrl = globalThis.location?.href) {
  const configuredUrl = String(rawUrl || '').trim();
  if (!configuredUrl) return 'about:blank';

  try {
    const viewerUrl = new URL(configuredUrl, baseUrl || 'http://localhost/');
    if (viewerUrl.protocol === 'http:' || viewerUrl.protocol === 'https:') {
      for (const [name, value] of Object.entries(DEFAULT_VIEWER_PARAMS)) {
        if (!viewerUrl.searchParams.has(name)) viewerUrl.searchParams.set(name, value);
      }
    }
    return viewerUrl.href;
  } catch {
    // Preserve compatibility with browser-specific iframe URLs that URL cannot
    // parse. The caller can still attempt to load the operator's exact value.
    return configuredUrl;
  }
}
