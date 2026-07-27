# v1.0.34 — Reliable, Responsive Agent Chat

Released: July 27, 2026

This release makes the in-world agent chat clearer and more dependable. Connection state now describes the agent framework connection only, recoverable command failures no longer look like broken model runs, Markdown renders consistently while responses stream, and the chat window remains usable at narrow sizes.

## Run and connection reliability

- Reserved the header status for the OpenClaw agent-framework connection, so failed commands no longer replace `Connected` with a misleading run or model error.
- Separated failed tool calls from failed responses. Tool failures remain visible on their red tool cards while successful runs finish normally.
- Removed synthetic `Run failed` chat messages that appeared after otherwise successful responses.
- Added a compact, dismissible notice outside the conversation only when a response genuinely fails to start or complete.
- Used the authoritative final chat event to resolve ambiguous lifecycle errors, preventing late or duplicate failure events from overriding successful responses.
- Corrected restored chat history so tool results stored with `isError: true` remain marked as errors after a reload.

## Streaming Markdown

- Rendered Markdown throughout streaming instead of switching from plain text to formatted content only after completion.
- Preserved the streamed message container at completion to avoid the previous full-bubble re-render.
- Added scoped styles for headings, paragraphs, ordered and unordered lists, nested lists, blockquotes, links, inline code, code blocks, horizontal rules, task lists, details, images, and tables.
- Added bordered, padded, horizontally scrollable tables for narrow chat windows.
- Served Marked locally with the application instead of depending on a third-party CDN.

## Chat window usability

- Reworked the header as a container-responsive layout so the agent selector, Reset Session, and Close controls remain accessible as the panel narrows.
- Allowed long connection messages to wrap onto a dedicated second row instead of pushing controls outside the window.
- Removed the dedicated move button and made the main chat header directly draggable.
- Added a movement threshold so normal clicks do not accidentally move the panel while preserving left and right snap behavior.

## Verification

- Public smoke suite passed, including product files, syntax, packaging, Docker hygiene, secret scanning, and the new chat regressions.
- Added behavioral coverage for recoverable tool failures, genuine terminal failures, duplicate and late terminal events, historical `isError` tool results, streaming Markdown, safe Markdown sanitization including encoded unsafe URLs, responsive headers, and direct header dragging.
- Live 8590 health checks and browser verification passed with existing world data preserved.
- Verified that successful runs containing failed Bash commands remain connected, show only the failed tool card in red, and do not append a `Run failed` chat message.
