<!-- Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE). -->
# Give your agents a brain

My Virtual World's **built-in agents** think with an AI model you choose, on your own key. This guide connects one and
makes your first agent. (Already run OpenClaw or Hermes? Their agents come with their own brains: see
[OpenClaw](openclaw.md) and [Hermes](hermes.md).)

## 1. Add a model provider

1. Open **⚙️ Settings → 🔌 Connections**.
2. Under **Add a connection**, choose the kind **Model provider**.
3. Fill in the form:

   | Field | What to put |
   |---|---|
   | Name | Anything, for example `My brain` |
   | For | **Only me**, or **Everyone I share it with** to let other accounts' agents use it (administrators) |
   | Provider | **OpenRouter** (one key, hundreds of models: the easiest start), **OpenAI**, **Anthropic**, **Google**, or **custom** for a model on your own machine |
   | Base URL (custom) | Only for *custom*: see [local models](#local-models) below |
   | Model | The model's name at that provider, for example `deepseek/deepseek-v4.1-flash` on OpenRouter |
   | Thinking | `off` is fastest and cheapest; `low`–`high` for models that reason |
   | Prices | Optional: what the provider charges per million tokens, so the world can show and limit what agents spend |
   | API key | Your key from the provider's website |

4. **Add connection**, then **Test**: the dot turns green when the provider answers.

Keys are sealed with the server's key before they are stored ([SECRETS.md](../SECRETS.md)); no page ever shows them
again.

## 2. Make an agent

1. In the **Team** panel (right side), click **➕ New agent** and choose **Built-in**.
2. Give it a name and a look. It moves into town: a home, a desk and a routine.
3. Its **Agent Studio** opens. On the **Brain** tab, pick the connection you added and a model.
4. Click the agent (or 💬) to chat. It lives in the city (a home, a job, money, memories, the people it knows) and
   works for you from its **PC** (files, a task board, a calendar, a browser). Its Studio tabs (Work, Personality, Plans,
   Memories, Money…) show and shape all of it.

In demo mode (no License Key) a world has up to **3 agents** in all.

## 3. Let them live on their own (optional)

- **Free Will**: agents choose what to do with their day. Add a decision service: **Settings → 🔌 Connections → OpenAI
  Decisions** (an OpenAI key), then turn it on in **Settings → 🧠 Free Will & Mind**.
- **The Mind**: each agent plans its day, reflects at night and handles its problems (rent, a job, money) with the
  brain you gave it. Turn it on in **Settings → 🧠 Free Will & Mind**; an agent's Studio → **Plans** shows its day.
  Spending limits are in **Settings → 🛡️ Agent limits**.
- **Voice**: agents speak and listen: add a **Voice service** connection (OpenAI, OpenRouter, ElevenLabs, Groq, Google
  Cloud, Deepgram, xAI, Qwen or any OpenAI-compatible server), or use your browser's own voice.
- **Phone**: give an agent a real phone number: a **Phone service (Twilio)** connection
  ([agents' phones](../features/phone.md)).

## Local models

Any OpenAI-compatible server works as the *custom* provider:

| Server | Base URL (My Virtual World installed natively) | Base URL (My Virtual World in Docker) |
|---|---|---|
| Ollama | `http://127.0.0.1:11434/v1` | `http://host.docker.internal:11434/v1` |
| LM Studio | `http://127.0.0.1:1234/v1` | `http://host.docker.internal:1234/v1` |
| vLLM, llama.cpp server, others | their `/v1` address | the same, through `host.docker.internal` |

- The API key field is required: local servers ignore it, so any text such as `local` will do.
- A server on this machine or your local network can only be added by an administrator, with **For: Everyone I share
  it with** (the server's network belongs to the administrator).
- From Docker, the model server must listen on an address the container can reach, not only `127.0.0.1` (Ollama:
  `OLLAMA_HOST=0.0.0.0`; LM Studio: *Serve on local network*).
- Agents use tools, so pick a model that supports tool calling.

## Costs

You pay your provider directly; My Virtual World adds nothing. With prices filled in, **Settings → 🛡️ Agent limits**
caps what each agent and each day may spend, and every agent's Studio shows what it used.
