# spark-sglang-docker

Docker-based workflow and **SGLang Stack Dashboard** (local UI) for running [SGLang](https://github.com/sgl-project/sglang) with large language models. The upstream image bundles CUDA, PyTorch, Transformers, SGLang, and related bits; the dashboard surfaces **what the running container actually has** so launches and debugging involve less guesswork.

## Quick start

### 1. Run Docker and get a shell

```bash
./run-docker.sh
```

This starts `scitrera/dgx-spark-sglang` with GPU access, Hugging Face cache mount, and the repo mounted at `/workspace`.

### 2. Run a model script inside the container

From the container shell (paths follow your repo layout under `/workspace`), for example:

```bash
./scripts/run-qwen3.5_27b_int4.sh
```

(Adjust the script path if your working directory inside the container differs.)

## SGLang Stack Dashboard (`apps/monitor`)

Local **Vite + TypeScript** UI with a small **Hono** API. **Docker / tools** tab: lists running containers and runs whitelisted scripts under [`tools/`](tools/) via `docker exec` (repo at `/workspace`). **SGLang metrics** tab: proxies `GET /metrics` from the SGLang HTTP port on the host (default `http://127.0.0.1:8000/metrics`). Model launch scripts use `--enable-metrics` so Prometheus text is available. **Side chat**: sends `POST /v1/chat/completions` (OpenAI-compatible) to the same SGLang base URL via `POST /api/sglang/chat/completions` (non-streaming). API: `GET /api/tools`, `GET /api/probe?...`, `GET /api/sglang/config`, `GET /api/sglang/metrics`, `POST /api/sglang/chat/completions`.

### Run in development

From the repo root:

```bash
cd apps/monitor
npm install
npm run dev
```

Then open the URL Vite prints (default **http://localhost:5173**). The API listens on **http://127.0.0.1:8787**; the dev server proxies `/api` to it.

Requirements on the host: **Docker CLI** available (e.g. Docker Desktop), same machine where containers run.

### Production build

```bash
cd apps/monitor
npm run build
```

This writes the client to `apps/monitor/dist/client` and the API to `apps/monitor/dist/server`. To run the built app locally: in one terminal `npm start` (API), in another `npm run preview` (Vite serves `dist/client` and proxies `/api` to the API). Or use `npm run dev` during development.

Environment (dashboard API): **`MONITOR_API_PORT`** (optional, default `8787`). SGLang scrape target: **`SGLANG_BASE_URL`** (default `http://127.0.0.1:8000`), **`SGLANG_METRICS_PATH`** (default `/metrics`), or set **`SGLANG_METRICS_URL`** to a full URL (chat uses the same inferred HTTP origin). Hostnames are restricted to loopback unless **`SGLANG_ALLOW_ANY_HOST=1`**. Optional **`SGLANG_FETCH_TIMEOUT_MS`** (default `8000`) for metrics; **`SGLANG_CHAT_TIMEOUT_MS`** (default `120000`) for chat proxy requests.

## Requirements

- Docker with NVIDIA GPU support (`--gpus all`) where you run workloads.
- `HF_TOKEN` set in the host environment when using Hugging Face gated or private assets (passed through in `run-docker.sh`).
