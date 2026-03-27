#!/usr/bin/env python3
"""Quick GPU / CUDA sanity check (human-readable stdout). Run inside the container or on the host."""

from __future__ import annotations

import shutil
import subprocess
import sys


def main() -> None:
    print(f"Python: {sys.version.split()[0]}")
    try:
        import torch

        print(f"torch: {torch.__version__}")
        print(f"torch.version.cuda: {torch.version.cuda}")
        print(f"cuda available (torch): {torch.cuda.is_available()}")
        if torch.cuda.is_available():
            print(f"device count: {torch.cuda.device_count()}")
            print(f"device 0: {torch.cuda.get_device_name(0)}")
    except ImportError:
        print("torch: not installed")
    except Exception as e:
        print(f"torch check error: {e}")

    smi = shutil.which("nvidia-smi")
    if not smi:
        print("nvidia-smi: not on PATH")
        return
    try:
        r = subprocess.run(
            ["nvidia-smi", "-L"],
            capture_output=True,
            text=True,
            timeout=15,
        )
        print("nvidia-smi -L:")
        print(r.stdout.rstrip() or "(no output)")
        if r.stderr.strip():
            print(r.stderr.rstrip())
        if r.returncode != 0:
            print(f"(exit {r.returncode})")
    except Exception as e:
        print(f"nvidia-smi error: {e}")


if __name__ == "__main__":
    main()
