# v1.0.36 — Readable Fixed-size Scrollbars

Released: July 27, 2026

This patch improves scrollbar visibility in the smaller Fixed-size chat-bubble modes without changing the bubble sizes or their world-anchored behavior.

## Fixed-size scrollbar usability

- Increased the Fixed Medium scrollbar width to a usable minimum of `1.25px`.
- Increased the Fixed Small scrollbar width to the same `1.25px` minimum.
- Kept the scrollbar thumb radius proportional to the wider track.
- Kept Fixed Large unchanged at `1.428px`.
- Kept all Consistent-size scrollbars unchanged at `3px`.
- Preserved hidden native scrollbar arrow buttons.

## Verification

- Added regression assertions for Fixed Large, Medium, and Small scrollbar dimensions.
- Passed the complete application test suite and chat UI verification.
- Verified the final build on port 8590 with all chat-bubble display modes.
- Confirmed saved world data, agents, buildings, and the realtime service remained intact.
