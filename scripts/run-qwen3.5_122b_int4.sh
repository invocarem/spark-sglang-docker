#!/bin/bash

# Configuration variables
MODEL="Intel/Qwen3.5-122B-A10B-int4-AutoRound"
SERVED_MODEL_NAME="qwen3.5-122b"
CONTEXT_LENGTH=262144
MEM_FRACTION_STATIC=0.7
TENSOR_PARALLEL=1
HOST="0.0.0.0"
PORT=8000
ATTENTION_BACKEND="triton"
FP8_GEMM_BACKEND="cutlass"
TOOL_CALL_PARSER="qwen3_coder"
REASONING_PARSER="qwen3"

# Launch the server with single device
python3 -m sglang.launch_server \
    --model-path ${MODEL} \
    --served-model-name ${SERVED_MODEL_NAME} \
    --context-length ${CONTEXT_LENGTH} \
    --mem-fraction-static ${MEM_FRACTION_STATIC} \
    --tp-size ${TENSOR_PARALLEL} \
    --host ${HOST} \
    --port ${PORT} \
    --attention-backend ${ATTENTION_BACKEND} \
    --fp8-gemm-backend ${FP8_GEMM_BACKEND} \
    --tool-call-parser ${TOOL_CALL_PARSER} --reasoning-parser ${REASONING_PARSER} \
    --trust-remote-code
