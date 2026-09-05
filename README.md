# TubeGuard 🛡️

**A brutally honest YouTube blocker & watch-time tracker.**

Let's be real: YouTube is designed to keep you clicking. This extension is a heavy-handed, pure DOM-manipulation hack to rip out the channels you don't want to see and guilt-trip you with your own watch time stats.

## What is this actually about?
TubeGuard is a Manifest V3 Chrome extension that:
- **Blocks channels and videos** you don't want to see by injecting "Block" buttons directly into the YouTube UI.
- **Tracks your watch time** locally via an IndexedDB cache so you know exactly how many hours you've wasted.
- **Optionally evaluates learning value each day** with an OpenRouter GLM model, using priorities you set in the extension.
- **Keeps an auditable local record** of captured evidence, classifications, run settings, errors, and automatic channel blocks.
- **Works purely through DOM manipulation**. No fancy network-level `webRequest` blocking here. It literally finds the HTML elements you hate, sets `display: none`, and deletes them from the page before you can click them.

## The Brutal Truth
Because this relies entirely on DOM manipulation, **it is inherently fragile**. YouTube changes its obfuscated class names and HTML structure all the time. When YouTube updates their UI, our selectors *will* break, and they'll need to be manually updated in `src/shared/constants.js`. It's a continuous cat-and-mouse game. 

Also, we do not use runtime npm dependencies or CDNs. Everything is built locally, and the code is strict about not weakening the Content Security Policy (`script-src 'self'`).

## Installation (For Outsiders)
This extension isn't on the Chrome Web Store (yet). To install it locally:

1. Clone this repository.
2. Install the dev dependencies (we use `esbuild`):
   ```bash
   npm install
   ```
3. Build the extension:
   ```bash
   npm run build
   ```
4. Open Chrome and navigate to `chrome://extensions`
5. Enable **Developer mode** in the top right corner.
6. Click **Load unpacked** and select the project root directory.

## Development
- **Unit tests:** `npm run test`
- **Browser integration test:** `npm run test:e2e`
- **Watch mode:** `npm run build:watch`
- **Package for Web Store:** `npm run zip`

We use ES modules everywhere and bundle the service worker, content script, and small YouTube page bridge via `esbuild`. The stats, options, and popup pages load ES modules directly.

Open **Learning priorities** from the popup to enable analysis, enter an OpenRouter key, and set the outcomes or subjects you want to prioritize. Videos longer than five minutes enter local history once active watch time is recorded. Every 24 hours, or when you select **Analyze now**, eligible evidence is sent in bounded requests. A channel is silently blocked after its deduplicated irrelevant watch time is strictly greater than 30 minutes under the current priorities.

The API key is stored in trusted local extension storage and is excluded from history, logs, and exports. Titles, descriptions, transcript excerpts, runs, and decisions remain in the local Chrome profile. Transcript capture is best effort because YouTube may withhold caption data; the history records an explicit unavailable or partial status when that happens.

## Future Features & Telemetry (Coming Soon)
A few things are currently in the works and will be pushed in future updates:
- **Telemetry (Opt-in):** We are planning to add an opt-in telemetry system to collect usage events and improve the extension. Right now, there is only a stub in the code (`telemetry.enabled` defaults to `false` and no-ops), but actual data collection is coming later. No data will leave your machine without your explicit opt-in.
- **AI Summaries:** We plan to integrate an AI summary feature (using an API key) to summarize videos instead of you having to watch them. This will be implemented as a new stats plugin.
- **Shorts Blocking:** We'll be adding dedicated support for blocking YouTube Shorts and other specific content types soon.

---
*Take back control of your YouTube experience.*
