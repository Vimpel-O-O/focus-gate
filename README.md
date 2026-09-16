# Focus Gate

A personal Chrome/Brave extension that checks YouTube videos against your interests/goals before letting you play them. The default filter is:

## Start here

Requires Node.js 22+ and an OpenAI API key with API billing/access. This uses the OpenAI API, not your ChatGPT browser login, and does not read your chat history. Do not send your API key in a chat or put it in the extension.

1. Open a terminal in this `focus-gate` folder and run `npm start`. No package installation is needed.
2. Enter your OpenAI API key at the hidden prompt. It stays in memory until the service exits. Alternatively supply `OPENAI_API_KEY` through your own secure environment setup. The model defaults to `gpt-4.1-mini`; use `OPENAI_MODEL` to change it to a model supporting Responses structured outputs.
3. In Chrome open `chrome://extensions` (Brave: `brave://extensions`). Enable **Developer mode**, choose **Load unpacked**, and select the `extension` folder.
4. Click Focus Gate’s toolbar icon or open its extension options. Paste the **local pairing token** printed in the terminal, review your goals, and save. This token is not the API key.
5. Click **Test saved connection**. Then reload any open YouTube tabs. Keep the terminal running while you use the extension.

The connection test confirms local setup, not OpenAI billing/key validity. The first actual video check verifies those. If the service stops, checks fail closed and videos stay paused.

## Behavior

- On watch, Shorts, live and embedded video pages, a gate pauses playback while the service retrieves public video text and calls OpenAI.
- Relevant decisions with confidence at least 0.8 offer **Watch this video**. Click it to play. Other decisions and errors remain blocked. Confidence is the model’s estimate, not a calibrated guarantee.
- Each new video requires its own approval, including YouTube navigation without a page reload. Old asynchronous decisions cannot unlock a newly opened video.
- YouTube’s browsing and search interface stays unchanged. This tool does not search for videos or generate recommendations. Autoplay previews remain paused until you open a video and it is reviewed. Incognito must be separately enabled in the browser’s extension settings if you use it there.
- Optional additional context helps interpretation but does not narrow approval to an immediate task.
- Saved goal changes take effect after reloading YouTube tabs. Decisions are cached in service memory for six hours, keyed by video, goals, task and model. Restarting clears the cache. Maximum 30 new checks/hour and two simultaneous checks; not a dollar spending cap.

## What “check the source” means

The service requests YouTube’s public watch page without cookies, extracts title/channel/description, and tries available caption tracks. Long captions are sampled across beginning, middle and end. If that fails, public oEmbed title/channel are used. The gate labels the evidence actually retrieved. Captions are best-effort: YouTube may require consent, withhold tracks, reject the request, or change its page format.

This version does **not** analyze audio, frames, factual accuracy or creator credibility. A clearly relevant topic can be allowed from metadata alone; ambiguous content should be uncertain and blocked. Titles can misrepresent a video, and the model can make incorrect decisions. It is not a reliable safety/content-moderation system.

## Privacy and limits

Only the video ID, your selected goals/task, and retrieved public video text are sent for evaluation. No other browsing history, account cookies or ChatGPT conversations are collected. OpenAI requests set `store: false`; that is not a promise of zero retention under all API policies. See [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data).

The API key stays in the Node process; a separate local token is stored in `.local/pairing-token` and extension storage. The service binds to 127.0.0.1, checks host/origin and token, limits input sizes and only fetches fixed upstream hosts. Never publish `.local` or keys. This is a personal tool, not tamper-proof enforcement: you can disable the extension or use another browser. It cannot stop downloads, every possible alternate YouTube client, or absolutely guarantee zero transient audio during browser/player races. Search thumbnails are not filtered.

## Development and checks

Run `npm test` for dependency-free Node tests. They cover input validation, caption-host restrictions, source fallbacks, structured API decisions, failures/refusals, server authentication, caching, goal changes and concurrent request deduplication. Content-script tests use a small DOM fixture to exercise initial blocking, explicit playback approval, SPA navigation, stale decisions, service failures and Shorts. These use simulated API responses, so they incur no API costs and do not prove model classification accuracy.

Initial verification: the automated tests pass and live YouTube metadata retrieval succeeded (title/channel/description; captions unavailable on that sample). Full browser integration and live OpenAI classification have not been verified: browser automation could not launch in the development sandbox and no API key was configured. Treat this as a first development version until you complete the smoke checks below.

Before relying on the extension, check one useful tutorial and one irrelevant entertainment video with your own key; navigate between them without reloading; stop the service and confirm an unchecked video stays paused. YouTube changes can require selector/parser updates.

Source: `extension/` contains the Manifest V3 extension; `server/` contains the local service. No remote extension code, dependencies, analytics or build step.

References: [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [API authentication](https://developers.openai.com/api/reference/overview), [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [Chrome cross-origin requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests).
