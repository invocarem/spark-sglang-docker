# spark-sglang-docker

Docker-based workflow and **companion monitor** for running [SGLang](https://github.com/sgl-project/sglang) with large language models. The upstream image bundles CUDA, PyTorch, Transformers, SGLang, and related bits; the monitor surfaces **what the running container actually has** so launches and debugging involve less guesswork.

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

## Stack monitor (`apps/monitor`)

Local **Vite + TypeScript** UI with a small **Hono** API that calls the Docker CLI. It lists running containers and runs [`tools/collect_env.py`](tools/collect_env.py) inside the selected container via `docker exec` (expects this repo at `/workspace`, as in `run-docker.sh`).

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

Environment: **`MONITOR_API_PORT`** (optional) overrides the API port (default `8787`).

## Requirements

- Docker with NVIDIA GPU support (`--gpus all`) where you run workloads.
- `HF_TOKEN` set in the host environment when using Hugging Face gated or private assets (passed through in `run-docker.sh`).
