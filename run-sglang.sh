#!/bin/bash

# Default image
DEFAULT_IMAGE="scitrera/dgx-spark-sglang:0.5.9-t5"
IMAGE="${1:-$DEFAULT_IMAGE}"

CONTAINER_NAME="sglang_node_tf5"
HOST_PORT=8000
SHM_SIZE="32g"

if [ -z "$HF_TOKEN" ]; then
    echo "Warning: HF_TOKEN environment variable not set"
fi

echo "Using image: $IMAGE"

docker run --gpus all \
    --name ${CONTAINER_NAME} \
    --shm-size ${SHM_SIZE} \
    -p ${HOST_PORT}:8000 \
    -v ~/.cache/huggingface:/root/.cache/huggingface \
    -v $(pwd):/workspace \
    --env "HF_TOKEN=${HF_TOKEN}" \
    --ipc=host \
    -it --rm \
    ${IMAGE} \
    bash
