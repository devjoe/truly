# Model Setup

Truly is local-first: by default it uses Chrome's built-in Gemini Nano and
needs no setup. If you want higher quality or your machine cannot run Gemini
Nano, you can point Truly at your own local model instead.

## Quick Recommendation

| Your machine | Recommended setup | Realtime hints (Tier A) | Deep analysis / reading brief (Tier B) |
|---|---|---|---|
| GPU with more than 4 GB VRAM, **or** 16 GB RAM with a 4-core CPU, plus 22 GB free disk | **Nothing to install** — Chrome built-in Gemini Nano (default) | Yes, zero config | Experimental; enable in settings |
| Below the Gemini Nano floor (for example an 8 GB RAM laptop) | Keep the model provider set to `none` | Heuristic rules only | Off |
| 16 GB RAM Apple Silicon Mac, or a 6–8 GB VRAM GPU | Ollama with `gemma4:e4b-it-qat` (6.1 GB download, ~5 GB resident) | Yes | Yes, text-focused |
| 36 GB+ unified memory Mac, or 16 GB+ VRAM | Ollama: `gemma4:e4b-it-qat` for Tier A, `qwen3.6:35b-a3b` (~22 GB resident) for Tier B | Yes | Yes, higher quality |
| 128 GB unified-memory workstation | vLLM serving an INT4-quantized Qwen3.6-35B, connected as an OpenAI-compatible endpoint | Yes | Yes, full multimodal |

## Gemini Nano (Default)

Chrome downloads and manages the model itself. Requirements set by Chrome:

- a GPU with more than 4 GB of VRAM, **or** 16 GB+ RAM and a 4-core CPU;
- about 22 GB of free disk space (Chrome removes the model when disk runs low);
- an unmetered network connection for the initial download;
- desktop Chrome on Windows 10/11, macOS 13+, Linux, or ChromeOS.

If Chrome reports the model as downloading or unavailable, Truly shows the
status in its options page and falls back to heuristic hints until the model is
ready.

## Ollama

1. Install Ollama 0.30 or newer and pull the model:

   ```bash
   ollama pull gemma4:e4b-it-qat
   ```

2. Allow the extension to reach Ollama (required; without it every request is
   blocked by CORS):

   ```bash
   launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"   # macOS
   # or set OLLAMA_ORIGINS=chrome-extension://* in the service environment
   ```

3. In Truly's options, choose Ollama as the provider. The default endpoint is
   `http://localhost:11434` and the default model is `gemma4:e4b-it-qat`.

Truly sets the JSON response format and disables hidden reasoning at the API
level; no model parameters need manual tuning.

### Why `gemma4:e4b-it-qat`

In our evaluations it was the best quality-per-gigabyte fit for this workload:
about 5 GB resident memory, classification quality on par with much larger
models on a 40-post comparison, and stable structured-output behavior. It also
followed Taiwan-conventional Traditional Chinese more consistently than the
alternatives we tested. Smaller models (2B class) failed to follow the
structured output format reliably and are not recommended.

## OpenAI-Compatible Endpoints

Any server that speaks the OpenAI chat-completions API works (vLLM,
llama.cpp server, LM Studio, and similar). Choose "OpenAI-compatible" as the
provider and set the endpoint URL and model name. For Tier B deep analysis the
model must accept image input and `response_format: json_object`.

## Performance Expectations

Local single-stream decoding speed is bound by memory bandwidth, not compute.
The same 4-bit model that decodes at roughly 80 tokens/s on a 400 GB/s-class
machine runs at roughly 15–25 tokens/s on entry-level Apple Silicon. That is
still usable for feed hints; expect deep analysis to take noticeably longer on
slower machines.
