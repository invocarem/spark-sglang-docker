docker run --gpus all \
    --name sglang_node \
    --shm-size 32g \
    -p 8000:8000 \
    -v ~/.cache/huggingface:/root/.cache/huggingface \
    -v $(pwd):/workspace \
    --env "HF_TOKEN=$HF_TOKEN" \
    --env "TIKTOKEN_ENCODINGS_BASE=/tiktoken_encodings" \
    --ipc=host \
    -it --rm \
    lmsysorg/sglang:spark \
    bash
