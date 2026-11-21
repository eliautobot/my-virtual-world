# Chat and voice

- **The chat window**: an agent's owner chats with it like with the best assistants - answers streamed in Markdown,
  Stop, edit and regenerate, a model and thinking-effort picker per chat, attachments (images, PDFs, Word, Excel,
  PowerPoint, OpenDocument), projects with their own instructions, search across chats, pinned chats, a sidebar and a
  rail, floating or docked, on a phone or a computer.
- **Several chats at once**: up to four chat windows open together, each with its own agent and chat, sidebar, side
  panel, composer and voice, and its agent provider's own view (an OpenClaw agent's steps and cards, a Hermes agent as
  Hermes Desktop draws it). They float where they are put - moved by the header, sized from any edge or corner, side by
  side when asked - or go full screen; put away, a window waits by the 💬 button, ringed while it works and counting the
  answers that came meanwhile. One chat is never open in two windows. The windows come back with the page: on the same
  chats, where they were, with what was typed.
- **Work and Life**: in Work mode the agent is on the job - its job brief, instructions, tone, knowledge, files and work
  notes, the real date and time where it works, nothing of its city life; in Life mode it is the resident, with its
  day, plans and tools in the city. Each chat has the switch; the brief sets the default.
- **Approvals and notifications**: money actions above an owner's limit wait for their OK in the chat; notifications in
  the app, the browser and by push.
- **Voice**: dictation, reading answers aloud, and a hands-free voice mode that takes turns by itself; through a voice
  service (OpenAI, ElevenLabs, Google, Groq, Deepgram, xAI, Qwen, OpenRouter or any compatible one), the installation's
  for everyone without their own, or the browser's own; each agent may have its own voice.
- **Your own voice server**: any server with OpenAI's audio API (Kokoro, Speaches, vLLM, LocalAI) can be a voice service.
  Say what it does (listens and speaks, speaks only, or listens only) and its Test checks just that; a server without an
  API key needs none. An administrator's own may be on this network (http, a private or Tailscale address), for
  themselves (Only me) or for everyone; a member's own must be a public https address.

## Live voice: whose turn it is
Voice mode in a chat and the companions' Live voice answer when the person has **finished**, not at their first breath
(2026-11-17: a slow talker was cut off mid-sentence by a second of quiet). The end of a turn is decided from three things
together (`client/js/ui/voice-core.js` TurnTaker, `client/js/ui/voice.js` LiveEar):
- **Their patience** (Settings → Voice → "A pause before it answers"): Quick ≈ 1 s, Normal ≈ 1.6 s (the usual), Relaxed
  ≈ 2.4 s, Patient ≈ 3.5 s. Kept with the account (`listen.patience` in `POST /api/voice/prefs`).
- **Their habit** ("Learn how long I pause", on by default): the pauses they make in the middle of a turn — they went on
  talking after them — are learned on that device (the last 40); a pause must then be a little longer than their usual long
  ones (at most 4.8 s) before it ends their turn. A turn that ended on a hanging word counts as a pause they needed longer.
  "Forget it" clears it.
- **Their words so far** ("Wait longer when I stop mid-thought", on by default): 0.35 of the patience into a pause, what was
  recorded so far goes to the voice service while they are quiet; ending on "and", "the", "um", a comma or a dash (and the
  like in Spanish, French, German and Portuguese) gives them 2.2 s more; a finished sentence or a question ends at their
  patience — and those words are then the turn, so nothing is heard twice and the answer comes sooner. At most 8 checks a
  turn, each after more talking; it costs a little more of the voice service. With the browser's own recognition the words
  come with it, free.
- **The loudness** is measured on the audio thread every 20 ms (`client/js/ui/voice-meter.worklet.js`), so a page busy
  drawing the world never makes a pause look longer or shorter than it was; the room's own noise, a dip between syllables,
  a bird or the microphone's gain turning the room up are not talking, and a soft word in a pause slows its clock.
- **How long a turn may be**: up to the voice service's limit (5 minutes), with 30 seconds' warning; it was 1 minute.
- **What they see**: the status fills from the left as a pause goes towards the answer (talking again empties it); a tap
  sends at once. Why a turn ended when it did: `localStorage['mvw.voice.debug'] = '1'` logs every decision to the console.
- Checks: `tests/unit/voice-turns.test.mjs`, `tests/voice-http.test.mjs` (the preferences), and
  `tools/live-voice-check.mjs` (a real browser with a recorded slow voice for its microphone: one turn for a sentence with
  two long pauses, three when the words are not checked, minutes-long turns, a second question after the answer, and the
  companions' Live voice).

