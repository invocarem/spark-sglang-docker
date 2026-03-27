#!/usr/bin/env python3
"""Print Hugging Face-related env (token never printed raw) as JSON."""

from __future__ import annotations

import json
import os
import sys

KEYS = (
    "HF_HOME",
    "HF_HUB_CACHE",
    "TRANSFORMERS_CACHE",
    "HF_HUB_ENABLE_HF_TRANSFER",
)


def _mask_token(value: str) -> str:
    if len(value) <= 8:
        return "***"
    return f"{value[:4]}…{value[-4:]} (len={len(value)})"


def main() -> None:
    out: dict[str, str | None] = {}
    for key in KEYS:
        out[key] = os.environ.get(key)

    token = os.environ.get("HF_TOKEN")
    out["HF_TOKEN"] = "set" if token else None
    if token:
        out["HF_TOKEN_masked"] = _mask_token(token)

    json.dump(out, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
