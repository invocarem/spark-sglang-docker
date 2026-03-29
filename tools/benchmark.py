#!/usr/bin/env python3
"""Run `python3 -m sglang.bench_serving` with defaults for this stack (OpenAI API on :8000).

``sglang.bench_serving`` uses ``--model`` for two things: (1) a Hugging Face id so it can run
``check_chat_template``, and (2) unless ``--served-model-name`` is set, the OpenAI ``model``
field in requests. **Served names** like ``qwen3.5-35b`` are not HF repos — this wrapper passes:

* ``--model <HF id>`` — tokenizer / chat-template check (defaults to ``BENCHMARK_TOKENIZER``).
* ``--served-model-name <id>`` — value sent to the server (from ``--model`` here, env, or
  ``GET /v1/models``).

When used from **Docker / tools**, invoke with no args: served id is auto-detected when possible.

Env (optional): BENCHMARK_BASE_URL, BENCHMARK_BACKEND, BENCHMARK_DATASET,
BENCHMARK_NUM_PROMPTS, BENCHMARK_RANDOM_INPUT_LEN, BENCHMARK_RANDOM_OUTPUT_LEN,
BENCHMARK_SERVED_MODEL (API id), BENCHMARK_HF_MODEL (HF repo for bench ``--model``),
BENCHMARK_TOKENIZER (defaults to a small Qwen instruct tokenizer with long context; not ``gpt2``),
BENCHMARK_MAX_CONCURRENCY.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

DEFAULT_BASE = os.environ.get("BENCHMARK_BASE_URL", "http://127.0.0.1:8000")
DEFAULT_BACKEND = os.environ.get("BENCHMARK_BACKEND", "sglang-oai-chat")
# Long context; avoids gpt2's 1024 limit during bench retokenization. Override if needed.
DEFAULT_TOKENIZER = os.environ.get("BENCHMARK_TOKENIZER", "Qwen/Qwen2.5-0.5B-Instruct")

_DATASETS_WITH_RANDOM_LEN = frozenset({"random", "random-ids", "image"})


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_optional_int(name: str) -> int | None:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def fetch_served_model_id(base_url: str, timeout_sec: float = 15.0) -> str | None:
    url = base_url.rstrip("/") + "/v1/models"
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            raw = resp.read().decode()
        data = json.loads(raw)
        rows = data.get("data")
        if not isinstance(rows, list) or len(rows) == 0:
            return None
        first = rows[0]
        if isinstance(first, dict) and isinstance(first.get("id"), str):
            return first["id"]
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError, OSError):
        return None
    return None


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Thin wrapper around `python -m sglang.bench_serving` for the SGLang stack.",
    )
    p.add_argument(
        "--base-url",
        default=DEFAULT_BASE,
        help=f"Server base URL (default {DEFAULT_BASE!r} or BENCHMARK_BASE_URL).",
    )
    p.add_argument(
        "--backend",
        default=DEFAULT_BACKEND,
        help=f"bench_serving backend (default {DEFAULT_BACKEND!r} or BENCHMARK_BACKEND).",
    )
    p.add_argument(
        "--dataset-name",
        default=os.environ.get("BENCHMARK_DATASET", "random"),
        help="Dataset name (default: random, or BENCHMARK_DATASET).",
    )
    p.add_argument(
        "--num-prompts",
        type=int,
        default=_env_int("BENCHMARK_NUM_PROMPTS", 20),
        help="Prompt count (default 20 or BENCHMARK_NUM_PROMPTS).",
    )
    p.add_argument(
        "--random-input-len",
        type=int,
        default=_env_int("BENCHMARK_RANDOM_INPUT_LEN", 128),
        help="For random/image datasets: input tokens (default 128).",
    )
    p.add_argument(
        "--random-output-len",
        type=int,
        default=_env_int("BENCHMARK_RANDOM_OUTPUT_LEN", 128),
        help="For random/image datasets: output tokens (default 128).",
    )
    p.add_argument(
        "--max-concurrency",
        type=int,
        default=_env_optional_int("BENCHMARK_MAX_CONCURRENCY"),
        help="Cap concurrent requests (optional; BENCHMARK_MAX_CONCURRENCY).",
    )
    p.add_argument(
        "--model",
        default=os.environ.get("BENCHMARK_SERVED_MODEL", "") or os.environ.get("BENCHMARK_MODEL", "")
        or "",
        metavar="SERVED_ID",
        help="Served model id for the API (BENCHMARK_SERVED_MODEL / BENCHMARK_MODEL); optional if /v1/models works.",
    )
    p.add_argument(
        "--hf-model",
        default=os.environ.get("BENCHMARK_HF_MODEL", "") or "",
        metavar="HF_REPO",
        help="HF repo for bench --model / chat-template check; default BENCHMARK_HF_MODEL or same as --tokenizer.",
    )
    p.add_argument(
        "--tokenizer",
        default=DEFAULT_TOKENIZER,
        help=(
            "HF tokenizer for synthetic prompts (BENCHMARK_TOKENIZER). "
            "Must be a real repo; default is a small Qwen instruct model (not gpt2's 1024 limit)."
        ),
    )
    return p


def main() -> None:
    parser = build_parser()
    args, rest = parser.parse_known_args()

    tokenizer = args.tokenizer.strip() or DEFAULT_TOKENIZER
    hf_for_bench = (args.hf_model or "").strip() or tokenizer

    served = (args.model or "").strip() or os.environ.get("BENCHMARK_SERVED_MODEL", "").strip()
    if not served:
        served = fetch_served_model_id(args.base_url) or ""

    if not served:
        print(
            "benchmark.py: could not resolve served model id. Set --model, BENCHMARK_SERVED_MODEL, "
            "or ensure GET {}/v1/models returns a model.".format(args.base_url.rstrip("/")),
            file=sys.stderr,
        )
        raise SystemExit(2)

    cmd: list[str] = [
        sys.executable,
        "-m",
        "sglang.bench_serving",
        "--backend",
        args.backend,
        "--base-url",
        args.base_url,
        "--dataset-name",
        args.dataset_name,
        "--model",
        hf_for_bench,
        "--served-model-name",
        served,
        "--tokenizer",
        tokenizer,
        "--num-prompts",
        str(args.num_prompts),
    ]

    if args.dataset_name in _DATASETS_WITH_RANDOM_LEN:
        cmd.extend(
            [
                "--random-input-len",
                str(args.random_input_len),
                "--random-output-len",
                str(args.random_output_len),
            ]
        )

    if args.max_concurrency is not None:
        cmd.extend(["--max-concurrency", str(args.max_concurrency)])

    cmd.extend(rest)

    print("+ " + " ".join(cmd), file=sys.stderr)
    raise SystemExit(subprocess.call(cmd))


if __name__ == "__main__":
    main()
