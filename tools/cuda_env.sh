#!/usr/bin/env bash
# Print common CUDA / NVIDIA-related environment variables (if set).

set -euo pipefail

vars=(
  CUDA_HOME
  CUDA_PATH
  CUDA_VERSION
  NVIDIA_VISIBLE_DEVICES
  NVIDIA_DRIVER_CAPABILITIES
  LD_LIBRARY_PATH
)

for v in "${vars[@]}"; do
  if [ -n "${!v:-}" ]; then
    printf '%s=%s\n' "$v" "${!v}"
  else
    printf '%s=\n' "$v"
  fi
done
