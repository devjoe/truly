# Model Setup

Truly can run with Chrome's built-in Gemini Nano, a local Ollama model, or an
OpenAI-compatible endpoint that you control.

Start with Gemini Nano when Chrome says it is available. It is the easiest path
because it does not require an endpoint URL or API key. Use Ollama or a private
endpoint when you want stronger summaries, more predictable availability, or a
model you can manage yourself. If your OpenAI-compatible endpoint requires
authentication, enter the API key in Truly's settings instead of putting secrets
in the endpoint URL.

## Ask An AI Agent To Check Your Machine

If you are unsure what your computer can run, paste this prompt into your AI
agent first:

```text
I want to run Truly, a Chrome extension that uses local or user-chosen AI models
for reading hints, summaries, and deeper reading.

Please use Truly's model setup guide as context:
https://github.com/devjoe/truly/blob/main/docs/model-setup.md

Please help me decide which model setup fits this computer.

Ask me for or help me check:
- operating system and Chrome version
- CPU, RAM, GPU, VRAM or unified memory
- available disk space
- whether Ollama is installed
- whether I prefer zero setup, local-only models, or a private endpoint

Then recommend one setup:
1. Chrome built-in Gemini Nano for the lowest setup effort
2. Ollama with `gemma4:e4b-it-qat` for lightweight local use
3. Ollama with `gemma4:12b`, or an OpenAI-compatible endpoint with a stronger 12B-class model, for higher quality
4. Reading hints only if this machine is too small for model-backed summaries

Please explain the tradeoff in setup effort, memory use, speed, and expected
quality. Do not recommend paid cloud APIs unless I explicitly ask for them.
```

## Quick Recommendation

| Your situation | Recommended setup | Reading hints | Summary / deep reading |
| --- | --- | --- | --- |
| Chrome already supports Gemini Nano on your machine | **Chrome built-in Gemini Nano** | Yes, zero config | Experimental; enable in settings |
| Chrome does not have Gemini Nano and the machine is small | Reading hints only | Basic rules only | Off |
| 24 GB unified memory, or 10 GB+ VRAM | Ollama with **`gemma4:e4b-it-qat`** | Yes | Yes, including image-aware checks |
| 32 GB+ unified memory, or 16 GB+ VRAM | Ollama with **`gemma4:12b`**, or a private endpoint with a **12B-class model** | Yes | Better quality, slower |
| You already operate a private model server | OpenAI-compatible endpoint with a **12B-class model** or equivalent | Yes | Best if the endpoint supports structured output and images |

These are conservative starting points for a comfortable preview experience, not
hard minimums. Actual memory use depends on context length, KV cache, image
inputs, concurrent requests, Ollama overhead, and what else Chrome is doing.

## Image-Aware Models

Some posts are mostly text. Others depend on screenshots, photos, posters, or
text embedded in images. A text-only model can still summarize the written post
text, but it cannot judge whether an attached image supports, contradicts, or
changes the claim.

For image-aware reading assistance, choose a model or endpoint that accepts
image input:

- Chrome built-in Gemini Nano: availability and modality support are decided by
  Chrome.
- Ollama: choose a vision-capable local model when image judgement matters.
- Ollama Cloud: model capabilities vary. Truly keeps a small capability registry
  for known cloud models and warns when a selected model is listed as text-only.
- OpenAI-compatible endpoints: choose a model that accepts `image_url` messages,
  then use **Test and Save** to confirm the endpoint works with Truly.

For most users, Truly's Options page is the right place to test image support:
choose the model source, then use **Test and Save**. The development smoke test
below is only for contributors working from a source checkout:

```bash
npm run smoke:ollama-vision
```

## Chrome Built-In Gemini Nano

Chrome downloads and manages Gemini Nano itself. Availability is decided by
Chrome, not Truly, and may change when Chrome updates or frees disk space.

Chrome's on-device model usually needs:

- a GPU with more than 4 GB of VRAM, **or** 16 GB+ RAM and a 4-core CPU;
- about 22 GB of free disk space, because Chrome may remove the model when disk
  space runs low;
- an unmetered network connection for the initial download;
- desktop Chrome on Windows 10/11, macOS 13+, Linux, or ChromeOS.

Use Truly's Options page to check whether Chrome currently exposes the model to
extensions. If Chrome reports the model as downloading or unavailable, Truly
shows that status and falls back to reading hints that do not require deep model
analysis.

Chrome also provides `chrome://on-device-internals/` for low-level debugging,
but treat that page as advisory. After Chrome updates, it can temporarily show a
stale or confusing model status even when the Prompt API is already usable.
Truly's model check uses `LanguageModel.availability()` plus a short generation
smoke test, which is the source of truth for whether the extension can actually
run Gemini Nano.

## Ollama

Ollama is the simplest local-model path when Gemini Nano is unavailable or too
limited for your use. It is also the easiest way to keep model traffic on your
own machine.

1. Install Ollama.

2. Pull a model. For a lightweight first pass:

   ```bash
   ollama pull gemma4:e4b-it-qat
   ```

   For higher quality on Ollama:

   ```bash
   ollama pull gemma4:12b
   ```

   For other providers, choose a 12B-class tag from your model source and set
   that exact tag in Truly's options. Model tags vary by provider, so copy the
   tag exactly as your server or model library reports it.

3. Allow the extension to reach Ollama and keep the model warm. Without
   `OLLAMA_ORIGINS`, browser requests from the extension are blocked by CORS.
   Without a longer keep-alive, the first request after an idle period can feel
   slow because Ollama has to load the model again.

   ```bash
   OLLAMA_ORIGINS=chrome-extension://*
   OLLAMA_KEEP_ALIVE=-1
   ```

4. In Truly's options, choose Ollama. Use the endpoint that matches where Ollama
   runs:

   | Server location | Example endpoint |
   | --- | --- |
   | Same computer as Chrome | `http://localhost:11434` |
   | Another trusted machine on your LAN | `http://your-model-host.local:11434` |
   | Another trusted machine on your LAN | `http://lan-model-host:11434` |

   Use `localhost` when Ollama runs on the same computer as Chrome. Use a LAN
   hostname or LAN IPv4 address only when Ollama runs on another trusted
   machine. Replace `your-model-host.local` or `lan-model-host` with your own
   machine's address. Use **Test and Save** to confirm the extension can reach
   the endpoint and the selected model follows Truly's output format.

Truly requests structured output and disables hidden reasoning when the provider
supports those controls. If a model cannot follow the required output format,
use a larger model or switch back to Gemini Nano for the affected feature.

If **Test and Save** says the model responded but the output format was wrong,
the endpoint is reachable but the reading-hint parser could not use the reply.
Use **Copy diagnostics** in the model card when reporting the issue. The copied
text includes the provider, endpoint kind, model name, output mode, parse error,
and a short response excerpt; it does not include API keys.

### Ollama Service Settings

Put the Ollama settings in the process that runs `ollama serve`, not only in the
shell where you type commands.

Recommended local settings:

| Setting | Value | Why |
| --- | --- | --- |
| `OLLAMA_ORIGINS` | `chrome-extension://*` | Allows Truly to call local Ollama from Chrome. If you know the final extension ID, you can use `chrome-extension://<extension-id>` instead. |
| `OLLAMA_KEEP_ALIVE` | `-1` | Keeps the selected model loaded so reading does not pause on repeated cold starts. Use `10m` or `1h` instead if memory pressure matters more than latency. |

To find your installed extension ID, open `chrome://extensions`, enable
Developer mode, and copy the **ID** shown on Truly's extension card.

Keep the default local endpoint first:

```text
http://localhost:11434
```

If Ollama runs on another trusted machine, use that machine's LAN hostname or
IPv4 address. For example:

```text
http://your-model-host.local:11434
http://lan-model-host:11434
```

Only expose Ollama on the LAN when you intentionally want another machine to
call it. In that case, set `OLLAMA_HOST=0.0.0.0:11434` in the Ollama service
environment, use a trusted network or firewall, and avoid broad origins unless
you understand the risk. A local Ollama server is not an authenticated public
API.

#### macOS quick trial

For a quick trial with the official Ollama app:

```bash
launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"
launchctl setenv OLLAMA_KEEP_ALIVE "-1"
```

Then quit and restart Ollama from the menu bar. This is convenient for testing,
but it is easy to lose after reboot or service changes.

#### macOS persistent startup

For a predictable setup, run Ollama with a LaunchAgent that owns the environment
variables. Do not run the official app and a Homebrew service at the same time.
If Homebrew is managing Ollama, stop it first:

```bash
brew services stop ollama
```

Create `~/Library/LaunchAgents/org.trulyreader.ollama.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>org.trulyreader.ollama</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/opt/ollama/bin/ollama</string>
    <string>serve</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>OLLAMA_ORIGINS</key>
    <string>chrome-extension://*</string>
    <key>OLLAMA_KEEP_ALIVE</key>
    <string>-1</string>
  </dict>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
```

Load it:

```bash
launchctl unload ~/Library/LaunchAgents/org.trulyreader.ollama.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/org.trulyreader.ollama.plist
curl -fs http://localhost:11434/api/tags >/dev/null && echo "Ollama is ready"
```

If your Ollama binary is not installed by Homebrew, replace
`/opt/homebrew/opt/ollama/bin/ollama` with the path returned by:

```bash
which ollama
```

#### Linux systemd

If Ollama is installed as a systemd service, create a drop-in:

```bash
sudo systemctl edit ollama.service
```

Add:

```ini
[Service]
Environment="OLLAMA_ORIGINS=chrome-extension://*"
Environment="OLLAMA_KEEP_ALIVE=-1"
```

Then restart:

```bash
sudo systemctl daemon-reload
sudo systemctl restart ollama
curl -fs http://localhost:11434/api/tags >/dev/null && echo "Ollama is ready"
```

#### Windows

Quit Ollama from the tray, add user environment variables in Windows Settings,
then start Ollama again:

```text
OLLAMA_ORIGINS=chrome-extension://*
OLLAMA_KEEP_ALIVE=-1
```

Use Truly's **Test and Save** after restarting Ollama. If the selected model is
already warm, `ollama ps` should show it loaded after the first successful test.

For the underlying Ollama environment-variable behavior, see Ollama's
[FAQ](https://docs.ollama.com/faq), [macOS](https://docs.ollama.com/macos),
[Linux](https://docs.ollama.com/linux), and
[Windows](https://docs.ollama.com/windows) docs.

### Why `gemma4:e4b-it-qat` And `gemma4:12b`

`gemma4:e4b-it-qat` is the lightweight local option: it is suitable for quick
reading hints, summaries, and basic image-aware checks on smaller machines.

`gemma4:12b` is the recommended higher-quality local target when your hardware
can handle it. It is slower and needs more memory, but it is usually a better
target for summary quality, deeper reading, and stable structured output. Use an
equivalent 12B-class model id when you run a private model server that does not
use Ollama tags.

## OpenAI-Compatible Endpoints

Any server that speaks the OpenAI chat-completions API can work, including vLLM,
LM Studio, MLX-VLM, llama.cpp server, and similar tools. Choose
**OpenAI-compatible endpoint** in Truly's options, then set the endpoint root URL
and model name.

Use the API root, not the full chat-completions path:

| Server location | Example endpoint |
| --- | --- |
| Same computer as Chrome | `http://localhost:8000/v1` |
| Another trusted machine on your LAN | `http://your-model-host.local:8000/v1` |
| Another trusted machine on your LAN | `http://lan-model-host:8000/v1` |

Use `localhost` when the model server runs on the same computer as Chrome. Use a
LAN hostname or LAN IPv4 address only when the model runs on another trusted
machine. Replace `your-model-host.local` or `lan-model-host` with your own
machine's address.

Truly expects the endpoint to support:

- `GET /v1/models` for model discovery when available;
- `POST /v1/chat/completions` for reading hints, summaries, and deep reading;
- reliable JSON or structured-output behavior;
- OpenAI-style `image_url` message parts if you want image-aware reading.

OpenAI-compatible means "similar API shape", not identical behavior. A server
can list models and still fail Truly's image test or output-format test. Use
**Test and Save** after changing the endpoint, model, or endpoint type.

If **Test and Save** says the model responded but the output format was wrong,
the endpoint is reachable but the model did not follow Truly's required response
contract. Try a larger model, disable fast numeric output for reading hints, or
switch to a server mode with structured output support.

### vLLM And Private Model Servers

For vLLM, the most reliable deployment pattern is:

1. keep vLLM itself bound to `127.0.0.1`;
2. expose a trusted LAN port through a small reverse proxy;
3. let the proxy handle CORS and Chrome Private Network Access preflight;
4. restrict the port with a firewall or trusted network boundary.

For same-machine development, `http://localhost:8000/v1` is usually the least
surprising setup. When a Chrome extension calls a LAN endpoint such as
`http://your-model-host.local:8000/v1` or `http://lan-model-host:8000/v1`, Chrome
may send an `OPTIONS` preflight before the real request. The response must
include `Access-Control-Allow-Private-Network: true`, and the final response
still needs the normal CORS headers.

A quick PNA check looks like this:

```bash
ENDPOINT=http://your-model-host.local:8000/v1

curl -i -X OPTIONS "$ENDPOINT/chat/completions" \
  -H 'Origin: chrome-extension://<extension-id>' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type' \
  -H 'Access-Control-Request-Private-Network: true'
```

For a basic endpoint check:

```bash
ENDPOINT=http://your-model-host.local:8000/v1

curl -fs "$ENDPOINT/models"

curl -s "$ENDPOINT/chat/completions" \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "your-model-name",
    "messages": [{"role": "user", "content": "Reply with JSON: {\"ok\":true}"}],
    "max_tokens": 64
  }'
```

For image-aware reading, also verify a small image request. vLLM-compatible
vision models should accept a chat message whose content includes an
`image_url` part with a `data:image/...;base64,...` URL. If this probe fails,
text-only summaries may still work, but image explanations will be incomplete.

Some reasoning models put their early output in reasoning fields or need more
tokens before `message.content` appears. A short generic chat smoke is therefore
not enough to prove the endpoint is broken. Prefer Truly's **Test and Save** and
its diagnostics when debugging model compatibility.

If a `.local` hostname is slow or flaky, try the machine's direct IPv4 address.
Some networks advertise IPv6 for `.local` names even when that path is not
routable.

### Endpoint Type

Choose the closest endpoint type in Truly:

| Type | Use when |
| --- | --- |
| General OpenAI-compatible endpoint | The server follows the common OpenAI chat-completions shape. |
| vLLM | You run vLLM or a vLLM-compatible proxy and want Truly to apply vLLM-oriented probes. |
| MLX-VLM | You run an MLX-VLM OpenAI-compatible server, especially for local vision models on Apple Silicon. |

If your OpenAI-compatible endpoint requires authentication, fill in the optional
API key field in Truly's Options page. The key is stored locally in Chrome
extension storage and is sent as a Bearer token only to OpenAI-compatible
requests. It is not included in Truly's copyable diagnostics.

If you are running Truly from source or helping debug an authenticated endpoint,
you can run a live API-key smoke test:

```bash
TRULY_SMOKE_OPENAI_ENDPOINT=http://host:8000/v1 \
TRULY_SMOKE_OPENAI_MODEL=model-name \
TRULY_SMOKE_OPENAI_API_KEY=secret \
npm run smoke:openai-api-key
```

Do not expose a raw model server to the public internet. Do not put secrets in
the endpoint URL. Avoid logging full prompts or images on shared model servers.

Useful references:

- vLLM [OpenAI-compatible server](https://docs.vllm.ai/en/stable/serving/online_serving/),
  [structured outputs](https://docs.vllm.ai/en/latest/features/structured_outputs/),
  and [multimodal inputs](https://docs.vllm.ai/en/latest/features/multimodal_inputs/).
- Chrome extension
  [cross-origin requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
  and [Private Network Access preflight](https://developer.chrome.com/blog/private-network-access-preflight).

## Troubleshooting

| Symptom | Likely cause | What to try |
| --- | --- | --- |
| Truly cannot reach Ollama | Ollama is running, but Chrome extension requests are blocked by CORS. | Set `OLLAMA_ORIGINS=chrome-extension://*`, restart Ollama, then use **Test and Save** again. |
| LAN endpoint works with `curl`, but Chrome still fails | Chrome Private Network Access or extension host permission is blocking the request. | Use `localhost` when possible. For LAN servers, confirm the proxy answers PNA preflight and allow Chrome's local-network permission when prompted. |
| `.local` hostname is slow or unreliable | The network may advertise IPv6 for `.local` even when that route is not usable. | Try the machine's direct LAN IPv4 address. |
| Model responded, but output format was wrong | The endpoint is reachable, but the model did not follow Truly's response contract. | Use a larger model, disable fast numeric output for reading hints, or choose a server mode with stronger structured-output support. |
| Text summaries work, but image explanations are missing | The selected model or endpoint is text-only. | Choose a vision-capable model and run **Test and Save** again. |
| First request is slow after idle time | The model was unloaded from memory. | For Ollama, set `OLLAMA_KEEP_ALIVE=-1`, `1h`, or another keep-alive value that fits your memory budget. |

## Performance Expectations

Local single-stream decoding speed is usually bound by memory bandwidth, not
only compute. Smaller models respond faster but make more formatting and
reasoning mistakes. Larger models are more useful for deep reading, but they can
take noticeably longer.

For a first preview setup:

1. Try Gemini Nano if Chrome reports it is available.
2. Use `gemma4:e4b-it-qat` when you need local Ollama support on a smaller
   machine.
3. Move to `gemma4:12b` or another 12B-class model when you want better quality
   and can tolerate slower responses.
