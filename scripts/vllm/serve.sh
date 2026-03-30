#!/usr/bin/env bash
# Editable vLLM launch script (repo → /workspace/scripts/vllm in the test container).
# Run from the monitor Tools entry "vLLM: launch serve.sh (detached)".

set -euo pipefail

MODEL="${VLLM_MODEL:-Intel/Qwen3.5-122B-A10B-int4-AutoRound}"

exec vllm serve "${MODEL}" \
  --host 0.0.0.0 \
  --port 8000
