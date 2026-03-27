#!/bin/bash

# Configuration variables
MODEL="Qwen/Qwen3-Coder-Next-FP8"
SERVED_MODEL_NAME="qwen3-coder-next"
CONTEXT_LENGTH=200000
MEM_FRACTION_STATIC=0.8
TENSOR_PARALLEL=1  # Changed from 2 to 1 for single device
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
    --tool-call-parser ${TOOL_CALL_PARSER}
