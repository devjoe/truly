# Model Setup

Truly can run with Chrome's built-in Gemini Nano, a local Ollama model, or an
OpenAI-compatible endpoint that you control.

Start with Gemini Nano when Chrome says it is available. It is the easiest path
because it does not require an endpoint URL or API key. Use Ollama or a private
endpoint when you want stronger summaries, more predictable availability, or a
model you can manage yourself.

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
2. Ollama with Gemma 4 E4B for lightweight local use
3. Ollama or an OpenAI-compatible endpoint with Gemma 4 12B for higher quality
4. Reading hints only if this machine is too small for model-backed summaries

Please explain the tradeoff in setup effort, memory use, speed, and expected
quality. Do not recommend paid cloud APIs unless I explicitly ask for them.
```

## Quick Recommendation

| Your situation | Recommended setup | Reading hints | Summary / deep reading |
| --- | --- | --- | --- |
| Chrome already supports Gemini Nano on your machine | **Chrome built-in Gemini Nano** | Yes, zero config | Experimental; enable in settings |
| Chrome does not have Gemini Nano and the machine is small | Reading hints only | Basic rules only | Off |
| 16 GB RAM Apple Silicon Mac, or a 6-8 GB VRAM GPU | Ollama with **Gemma 4 E4B** | Yes | Yes, text-focused |
| 24-36 GB unified memory, or 12 GB+ VRAM | Ollama or private endpoint with **Gemma 4 12B** | Yes | Better quality, slower |
| You already operate a private model server | OpenAI-compatible endpoint with **Gemma 4 12B** or an equivalent model | Yes | Best if the endpoint supports structured output and images |

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

The live image probe is intentionally separate from the normal public checks,
because it depends on the current endpoint, model, permissions, and network
state. Run it when validating a specific Ollama-compatible setup:

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

   For higher quality, use a Gemma 4 12B tag from your model source and set that
   exact tag in Truly's options.

3. Allow the extension to reach Ollama. Without this, browser requests are
   blocked by CORS:

   ```bash
   launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"   # macOS
   # or set OLLAMA_ORIGINS=chrome-extension://* in the service environment
   ```

4. In Truly's options, choose Ollama. The default endpoint is
   `http://localhost:11434`. Use **Test and Save** to confirm the extension can
   reach the endpoint and the selected model follows Truly's output format.

Truly requests structured output and disables hidden reasoning when the provider
supports those controls. If a model cannot follow the required output format,
use a larger model or switch back to Gemini Nano for the affected feature.

If **Test and Save** says the model responded but the output format was wrong,
the endpoint is reachable but the reading-hint parser could not use the reply.
Use **Copy diagnostics** in the model card when reporting the issue. The copied
text includes the provider, endpoint kind, model name, output mode, parse error,
and a short response excerpt; it does not include API keys.

### Why Gemma 4 E4B And Gemma 4 12B

Gemma 4 E4B is the lightweight local option: it is suitable for quick reading
hints and text-focused summaries on smaller machines.

Gemma 4 12B is the recommended higher-quality local model when your hardware can
handle it. It is slower and needs more memory, but it is a better target for
summary quality, deeper reading, and more stable structured output.

## OpenAI-Compatible Endpoints

Any server that speaks the OpenAI chat-completions API can work, including vLLM,
llama.cpp server, LM Studio, and similar tools. Choose
**OpenAI-compatible endpoint** in Truly's options, then set the endpoint URL and
model name.

For summary and deep reading, the model should:

- follow JSON or structured-output instructions reliably;
- support the response format used by the endpoint;
- accept image input if you want image-aware reading assistance.

Use this path when you already run a private model service or need a stronger
model than your laptop can host directly. Do not put secrets in endpoint URLs.
If the endpoint provides a model list, Truly can help you choose from the models
it reports; otherwise, enter the model name exactly as the server expects it.

## Performance Expectations

Local single-stream decoding speed is usually bound by memory bandwidth, not
only compute. Smaller models respond faster but make more formatting and
reasoning mistakes. Larger models are more useful for deep reading, but they can
take noticeably longer.

For a first preview setup:

1. Try Gemini Nano if Chrome reports it is available.
2. Use Gemma 4 E4B when you need local Ollama support on a smaller machine.
3. Move to Gemma 4 12B when you want better quality and can tolerate slower
   responses.
