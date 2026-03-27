#!/bin/bash

# Configuration variables
MODEL="Qwen/Qwen3.5-27B"
SERVED_MODEL_NAME="qwen3.5-27b"
CONTEXT_LENGTH=262144
MEM_FRACTION_STATIC=0.8
TENSOR_PARALLEL=1
HOST="0.0.0.0"
PORT=8000
ATTENTION_BACKEND="triton"
FP8_GEMM_BACKEND="cutlass"
TOOL_CALL_PARSER="qwen3_coder"

# Launch the server with single device
python3 -m sglang.launch_server \
    --model-path ${MODEL} \
    --served-model-name ${SERVED_MODEL_NAME} \
    --context-length ${CONTEXT_LENGTH} \
    --mem-fraction-static ${MEM_FRACTION_STATIC} \
    --tp-size ${TENSOR_PARALLEL} \
    --host ${HOST} \
    --port ${PORT} \
    --enable-metrics \
    --attention-backend ${ATTENTION_BACKEND} \
    --fp8-gemm-backend ${FP8_GEMM_BACKEND} \
    --tool-call-parser ${TOOL_CALL_PARSER} --reasoning-parser qwen3
