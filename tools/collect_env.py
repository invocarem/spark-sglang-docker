#!/usr/bin/env python3
"""Print environment / stack info as JSON (stdout). Intended for docker exec + repo mounted at /workspace."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys


def _pkg_version(dist_name: str) -> str | None:
    try:
        from importlib.metadata import PackageNotFoundError, version

        return version(dist_name)
    except (ImportError, PackageNotFoundError):
        return None
    except Exception:
        return None


def main() -> None:
    data: dict[str, object] = {
        "python": sys.version.split()[0],
        "python_full": sys.version.replace("\n", " "),
        "platform": sys.platform,
    }

    for dist in ("transformers", "torch", "sglang", "numpy", "flash_attn"):
        v = _pkg_version(dist)
        if v:
            data[dist] = v

    try:
        import torch

        data["torch_version"] = torch.__version__
        data["torch_cuda_build"] = torch.version.cuda
        try:
            if torch.backends.cudnn.is_available():
                data["torch_cudnn"] = torch.backends.cudnn.version()
        except Exception:
            pass
    except Exception as e:
        data["torch_error"] = str(e)

    if shutil.which("nvidia-smi"):
        try:
            proc = subprocess.run(
                [
                    "nvidia-smi",
                    "--query-gpu=name,driver_version,memory.total",
                    "--format=csv,noheader",
                ],
                capture_output=True,
                text=True,
                timeout=15,
            )
            data["nvidia_smi_exit"] = proc.returncode
            data["nvidia_smi"] = proc.stdout.strip() or None
            if proc.stderr.strip():
                data["nvidia_smi_stderr"] = proc.stderr.strip()
        except Exception as e:
            data["nvidia_smi_error"] = str(e)
    else:
        data["nvidia_smi"] = None

    json.dump(data, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
