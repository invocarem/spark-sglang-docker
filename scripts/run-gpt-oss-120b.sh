#!/bin/bash

# Configuration variables
MODEL="openai/gpt-oss-120b"
SERVED_MODEL_NAME="gpt-oss-120b"
CONTEXT_LENGTH=65536
MEM_FRACTION_STATIC=0.8
TENSOR_PARALLEL=1  # Changed from 2 to 1 for single device
HOST="0.0.0.0"
PORT=8000
ATTENTION_BACKEND="triton"
TOOL_CALL_PARSER="gpt-oss"

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
    --tool-call-parser ${TOOL_CALL_PARSER} \
    --reasoning-parser gpt-oss
