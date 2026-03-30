#!/bin/bash

# Configuration variables
MODEL="Qwen/Qwen3.5-122B-A10B-GPTQ-Int4"
SERVED_MODEL_NAME="qwen3.5-122b"
CONTEXT_LENGTH=8192
MEM_FRACTION_STATIC=0.85
TENSOR_PARALLEL=1
HOST="0.0.0.0"
PORT=8000
ATTENTION_BACKEND="triton"
FP8_GEMM_BACKEND="cutlass"
TOOL_CALL_PARSER="qwen3_coder"

SGLANG_USE_AITER=1 python3 -m sglang.launch_server \
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
    --tool-call-parser ${TOOL_CALL_PARSER} \
    --reasoning-parser qwen3 \
    --speculative-algo NEXTN \
    --speculative-num-steps 2 \
    --speculative-eagle-topk 1 \
    --speculative-num-draft-tokens 2 \
    --quantization moe_wna16 \
    --kv-cache-dtype bf16 \
    --enable-cache-report \
    --trust-remote-code
