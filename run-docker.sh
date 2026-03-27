docker run --gpus all \
    --shm-size 32g \
    -p 8000:8000 \
    -v ~/.cache/huggingface:/root/.cache/huggingface \
    -v $(pwd):/workspace \
    --env "HF_TOKEN=$HF_TOKEN" \
    --ipc=host \
    -it --rm \
    scitrera/dgx-spark-sglang:0.5.9-t5 \
    bash
