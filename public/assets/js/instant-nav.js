/* ==========================================================
   Quant Flow Capital — Instant Navigation & Pre-Warming Engine
   Eliminates clicking lag by prefetching pages & assets on hover/touch
   ========================================================== */
(function () {
  'use strict';

  const prefetched = new Set();

  function prefetchUrl(url) {
    if (!url || prefetched.has(url)) return;
    try {
      const u = new URL(url, window.location.href);
      if (u.origin !== window.location.origin) return; // Only internal links
      if (u.pathname === window.location.pathname && u.hash) return; // Same page hash

      prefetched.add(url);

      // Method 1: <link rel="prefetch">
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = url;
      link.as = 'document';
      document.head.appendChild(link);

      // Method 2: Low priority fetch for browsers without prefetch link support
      if (window.fetch) {
        fetch(url, { priority: 'low', credentials: 'same-origin' }).catch(function () {});
      }
    } catch (e) {}
  }

  // Pre-fetch on mouseover / pointerenter / touchstart
  document.addEventListener('pointerover', function (e) {
    const a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    const href = a.getAttribute('href');
    if (href && (href.startsWith('/') || href.startsWith('.'))) {
      prefetchUrl(href);
    }
  }, { passive: true });

  document.addEventListener('touchstart', function (e) {
    const a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    const href = a.getAttribute('href');
    if (href && (href.startsWith('/') || href.startsWith('.'))) {
      prefetchUrl(href);
    }
  }, { passive: true });

  // Idle prefetching of primary navigation targets
  if (window.requestIdleCallback) {
    requestIdleCallback(function () {
      ['/', '/monitor/', '/markets/', '/library/', '/connect/'].forEach(prefetchUrl);
    });
  } else {
    setTimeout(function () {
      ['/', '/monitor/', '/markets/', '/library/', '/connect/'].forEach(prefetchUrl);
    }, 400);
  }
})();
