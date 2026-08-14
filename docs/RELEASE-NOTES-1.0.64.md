# v1.0.64 — Live Agent PC Previews

Released: August 14, 2026

This release turns assigned agent computers into a live view of the work agents
are producing. Files, media, web pages, and Agent Browser activity can appear in
a compact Preview Bubble above the agent's desk and expand into a full floating
Preview Window.

## Live Preview Bubbles

- Automatically recognizes provider-neutral tool activity for files, generated
  artifacts, safe URLs, and browser sessions, while also exposing an explicit
  preview publication API for agents and integrations.
- Renders HTML, Markdown, text, source code, images, PDF documents, audio,
  video, URLs, and the shared Agent Browser.
- Anchors each bubble to the assigned or deterministic work-desk monitor and
  lets users toggle it by clicking the actual PC screen.
- Adds compact tabs with selection and close controls, horizontal tab scrolling,
  persistent hidden state, and persistent closed-tab state across page refreshes.
- Prevents Preview Bubbles from overlapping one another and moves chat bubbles
  around visible previews while preserving the agent PC as the preview anchor.

## Expanded Preview Window

- Opens compact previews in a shared multi-tab window with tab closing,
  refresh, open-original, drag, eight-direction resize, maximize/restore, and
  left/right snapping.
- Watches live files for changes and refreshes the relevant preview without
  creating duplicate tabs.
- Uses a cached PDF.js canvas viewer instead of the slower browser PDF iframe,
  with page navigation, zoom, Fit page, and Fit width controls.
- Keeps rendered PDF documents and canvases cached across tab switches for
  immediate return to previously viewed pages.

## Preview controls and ownership

- Adds independent Settings > General > Preview Bubbles controls for consistent
  or world-scaled display, Large/Medium/Small bubble sizes, and 50–200% content
  zoom. Saved changes now apply immediately without reloading the world.
- Keeps Agent Browser previews scoped to the agent and run that invoked the
  browser. Because the browser is shared, ownership transfers exclusively to
  the most recent invoking agent instead of opening in every agent's bubble.
- Keeps Agent Browser's full-window fit unchanged while allowing content zoom
  for files, HTML, Markdown, images, and media.

## Security and integration

- Adds `POST /api/previews/open` and a cursor-based preview feed for explicit,
  provider-independent publication of file, URL, and browser targets.
- Confines file access to the selected agent's workspace, resolves workdirs and
  host/container path mappings, blocks symlink escapes and sensitive paths,
  validates extensions and MIME types, and enforces type-specific size limits.
- Serves preview content with no-store/nosniff protections and byte-range media
  support. HTML and Markdown previews remove scripts, embedded frames/objects,
  inline event handlers, and unsafe URLs before rendering in sandboxed frames.
- Extends the reusable browser-window controller with snap geometry and restore
  behavior used by the Preview Window.

## Verification

- The complete application test suite passes, including new client and backend
  Preview Hub regressions, browser-window controls, chat collision layout,
  provider integrations, and OpenClaw Gateway coverage.
- Live 8590 checks covered all supported example types, assigned-monitor
  toggling, compact and expanded tabs, scrolling and zoom, PDF rendering and
  caching, bubble collisions, immediate settings application, refresh
  persistence, and two-agent browser ownership.
- Browser validation completed without console or page errors, and both the
  8590 web application and 8592 realtime service remained healthy.

## Upgrade notes

No data migration is required. Rebuild both application services normally and
preserve the existing `vw-data` volume. The new `pdfjs-dist` dependency is
installed through the normal package/container build. Existing worlds receive
Preview Bubble defaults of Consistent, Large, and 100% content zoom.
