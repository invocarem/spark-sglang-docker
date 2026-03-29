#!/bin/bash

# Configuration variables
MODEL="deepseek-ai/DeepSeek-V2-Lite"
SERVED_MODEL_NAME="deepseek-v2-lite"
MEM_FRACTION_STATIC=0.85
TENSOR_PARALLEL=1
HOST="0.0.0.0"
PORT=8000
ATTENTION_BACKEND="flashinfer"

python3 -m sglang.launch_server \
  --model-path ${MODEL} \
  --served-model-name ${SERVED_MODEL_NAME} \
  --host ${HOST} \
  --port ${PORT} \
  --trust-remote-code \
  --tp-size ${TENSOR_PARALLEL} \
  --attention-backend flashinfer \
  --mem-fraction-static ${MEM_FRACTION_STATIC}