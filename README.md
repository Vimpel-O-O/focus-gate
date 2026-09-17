# Focus Gate

A Chrome browser extension that pauses YouTube videos, checks their topic against your interests using AI, and allows relevant videos. Shorts are blocked automatically. Trusted channels skip AI review. Approved videos resume after a 300 ms checkmark; unrelated videos stay blocked.

The hidden local macOS service was chosen to prioritize response time and avoid cloud hosting cold starts. New reviews still require internet access to YouTube and your selected AI provider. Decisions are cached privately for six hours, including across service restarts; changing interests or trusted channels triggers a fresh check.

## Setup (macOS)

Requires Node.js 22+ and Apple Command Line Tools (`xcode-select --install`). An API key and API access for OpenAI, Anthropic (Claude), Google (Gemini), or xAI (Grok) are required.

1. Clone this repository and open a terminal in its folder.
2. Run `npm run setup`. Choose a provider and a model that supports structured JSON output, then enter its API key at the hidden prompt. It is stored in Apple Keychain. If an old `npm start` process is running, stop it first.
3. In `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this repository's `extension` folder.
4. Open the extension popup. Enter your interests and the local pairing token printed by setup, then save. Optionally add trusted channel handles or URLs.

The service runs in the background and starts at login. No open terminal session is needed. Your existing pairing token is preserved when upgrading from the old setup.

## Choose an AI provider

Run `npm run setup` to switch providers or models. Supported provider IDs are `openai`, `anthropic`, `gemini`, and `xai`. You can also supply `--provider` and `--model`:

```bash
npm run setup -- --provider anthropic --model YOUR_MODEL_ID
```

Use an actual model ID supported by your provider's structured-output API. Setup keeps a separate Keychain key for each provider. Switching never sends your old provider's key to the new one, and there is no automatic provider fallback. Reload open YouTube tabs after switching.

Existing installations keep OpenAI and `gpt-4.1-mini` unless changed. Other providers require an explicit model ID. Provider/model settings live in the private `provider.json` file alongside the runtime; keys never go in that file. Cached decisions are isolated by provider and model.

## Updates and controls

After pulling or editing code, run `npm run service:update`, then reload the extension on the browser's extensions page. Runtime updates copy the current Node executable too.

- `npm run service:status` - check the backend.
- `npm run service:token` - show your local pairing token.
- `npm run setup` - choose a provider/model and add or replace its Keychain API key.
- `npm run service:stop` / `npm run service:start` - stop or start the service.
- `npm run service:uninstall` - remove automatic startup; retain private data and the Keychain entry.
- `npm test` - run tests.

Runtime, cache, pairing token and logs live in `~/Library/Application Support/FocusGate`. Startup uses `~/Library/LaunchAgents/com.focusgate.service.plist`. If the login Keychain is locked, unlock it and run `npm run service:start`. Logs never intentionally include API keys or pairing tokens.

## Privacy and limits

No interests are preset. Settings stay in browser local storage; your interests and retrieved video text are sent to your selected AI provider for review. The API key stays on your Mac. The cache contains private video metadata. Only YouTube playback is gated; other websites are unaffected.

Reviews use titles, descriptions and captions when available, not video footage. AI can misclassify videos. Failed or uncertain checks stay blocked. This is a voluntary attention aid tool and can be disabled anytime.

Provider adapters follow the official [OpenAI](https://developers.openai.com/api/docs/guides/structured-outputs), [Anthropic](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [Gemini](https://ai.google.dev/api/generate-content), and [xAI](https://docs.x.ai/developers/model-capabilities/text/structured-outputs) APIs. Tests use simulated responses; model availability, billing, and live classification require your own provider credentials.
