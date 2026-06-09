#!/usr/bin/env python3
"""Vision task benchmark: multimodal chat/completions + image fixtures + checkers.

Complements ``task_benchmark.py`` (text-only). Each JSONL row references an image file
and a prompt; the script base64-embeds the image in an OpenAI-style ``image_url`` part.

Input JSONL fields (one object per line):

- ``id`` (str): stable id
- ``image`` (str): path to PNG/JPEG/WebP (relative to the JSONL directory, or absolute)
- ``category`` (str): label for reporting
- ``prompt`` (str): user text (dimensions / disambiguation hints go here)
- ``system`` (optional str): system message
- ``thinking`` (optional bool): Qwen3.x thinking mode (default false — use direct answers for OCR/JSON)
- ``checker`` (object): how to grade assistant text
    - ``type``: ``regex`` | ``contains`` | ``contains_all`` | ``contains_any`` | ``json_point``
    - ``regex``: pattern string; optional ``flags`` (e.g. ``IGNORECASE``)
    - ``value`` / ``values``: for contains / contains_all
    - ``json_point``: parse JSON with numeric ``x``, ``y`` from the response
        - optional ``x``, ``y``, ``tolerance`` — center must be within ``tolerance`` px (L∞)
        - optional ``region``: ``{min_x,max_x,min_y,max_y}`` — point must fall inside
        - optional ``exclude_rect``: ``[x1,y1,x2,y2]`` — point must be **outside** (e.g. UI panel)
        - optional ``contains_any``: list of substrings; at least one must appear in full text

Env: VISION_BENCH_BASE_URL (default http://127.0.0.1:8000), VISION_BENCH_MODEL,
VISION_BENCH_INPUT, VISION_BENCH_TEMPERATURE, VISION_BENCH_MAX_TOKENS,
VISION_BENCH_TIMEOUT_SEC.

Usage::

  python3 /workspace/tools/vision_benchmark.py \\
    --input /workspace/screenshots/vision_tasks.jsonl

  python3 /workspace/tools/vision_benchmark.py -i screenshots/vision_tasks.jsonl -m qwen2.5-vl-7b
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import re
import sys
import time
import urllib.error
import urllib.request
from typing import Any


def _fetch_json(url: str, timeout: float) -> Any:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def fetch_served_model_id(base_url: str, timeout: float) -> str | None:
    try:
        data = _fetch_json(base_url.rstrip("/") + "/v1/models", timeout)
        rows = data.get("data")
        if not isinstance(rows, list) or not rows:
            return None
        first = rows[0]
        if isinstance(first, dict) and isinstance(first.get("id"), str):
            return first["id"]
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError, OSError):
        return None
    return None


def _normalize_message_text(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict):
                t = part.get("text")
                if isinstance(t, str):
                    parts.append(t)
        return "".join(parts)
    return ""


def assistant_parts_from_completion(data: object) -> tuple[str, str]:
    """Return (content, reasoning_content) from a chat completion body."""
    if not isinstance(data, dict):
        return "", ""
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices:
        return "", ""
    first = choices[0]
    if not isinstance(first, dict):
        return "", ""
    if isinstance(first.get("text"), str):
        return first["text"], ""
    msg = first.get("message")
    if not isinstance(msg, dict):
        return "", ""
    content = _normalize_message_text(msg.get("content"))
    reasoning = ""
    rc = msg.get("reasoning_content")
    if isinstance(rc, str):
        reasoning = rc
    elif isinstance(msg.get("reasoning"), str):
        reasoning = msg["reasoning"]
    return content, reasoning


def text_for_grading(content: str, reasoning: str, checker: object) -> str:
    """Pick assistant text to grade; JSON tasks also scan reasoning as fallback."""
    content = content.strip()
    reasoning = reasoning.strip()
    if isinstance(checker, dict) and checker.get("type") == "json_point":
        for candidate in (content, reasoning, f"{reasoning}\n{content}".strip()):
            if candidate and extract_json_object(candidate) is not None:
                return candidate
        return content or reasoning
    return content or reasoning


def extract_json_object(text: str) -> dict[str, Any] | None:
    """Best-effort JSON object extraction (handles optional markdown fences)."""
    stripped = text.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", stripped, re.IGNORECASE)
    if fence:
        stripped = fence.group(1).strip()
    try:
        parsed = json.loads(stripped)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start >= 0 and end > start:
        try:
            parsed = json.loads(stripped[start : end + 1])
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            return None
    return None


def point_outside_rect(x: float, y: float, rect: list[Any]) -> bool:
    if len(rect) != 4:
        return True
    try:
        x1, y1, x2, y2 = (float(rect[0]), float(rect[1]), float(rect[2]), float(rect[3]))
    except (TypeError, ValueError):
        return True
    left, right = min(x1, x2), max(x1, x2)
    top, bottom = min(y1, y2), max(y1, y2)
    return not (left <= x <= right and top <= y <= bottom)


def point_in_region(x: float, y: float, region: object) -> tuple[bool, str]:
    if not isinstance(region, dict):
        return True, "region ok"
    checks: list[str] = []
    for key, label in (
        ("min_x", "min_x"),
        ("max_x", "max_x"),
        ("min_y", "min_y"),
        ("max_y", "max_y"),
    ):
        bound = region.get(key)
        if bound is None:
            continue
        try:
            b = float(bound)
        except (TypeError, ValueError):
            return False, f"invalid region {label}"
        if key == "min_x" and x < b:
            return False, f"x={x} < min_x={b}"
        if key == "max_x" and x > b:
            return False, f"x={x} > max_x={b}"
        if key == "min_y" and y < b:
            return False, f"y={y} < min_y={b}"
        if key == "max_y" and y > b:
            return False, f"y={y} > max_y={b}"
        checks.append(f"{label}={b}")
    return True, f"region ok ({', '.join(checks)})" if checks else "region ok"


def run_checker(text: str, checker: object) -> tuple[bool, str]:
    if not isinstance(checker, dict):
        return False, "checker must be an object"
    ctype = checker.get("type")
    if ctype == "regex":
        pat = checker.get("pattern")
        if not isinstance(pat, str):
            return False, "regex checker needs string pattern"
        flags_raw = checker.get("flags")
        flags = 0
        if isinstance(flags_raw, str) and "IGNORECASE" in flags_raw.upper():
            flags |= re.IGNORECASE
        if not re.search(pat, text, flags):
            return False, f"regex did not match: {pat!r}"
        return True, "regex ok"
    if ctype == "contains":
        val = checker.get("value")
        if not isinstance(val, str):
            return False, "contains checker needs string value"
        ci = bool(checker.get("case_insensitive"))
        hay = text.lower() if ci else text
        needle = val.lower() if ci else val
        if needle not in hay:
            return False, f"missing substring: {val!r}"
        return True, "contains ok"
    if ctype == "contains_all":
        vals = checker.get("values")
        if not isinstance(vals, list) or not all(isinstance(x, str) for x in vals):
            return False, "contains_all needs values: list of strings"
        ci = bool(checker.get("case_insensitive"))
        hay = text.lower() if ci else text
        for v in vals:
            n = v.lower() if ci else v
            if n not in hay:
                return False, f"missing substring: {v!r}"
        return True, "contains_all ok"
    if ctype == "contains_any":
        vals = checker.get("values")
        if not isinstance(vals, list) or not all(isinstance(x, str) for x in vals):
            return False, "contains_any needs values: list of strings"
        ci = bool(checker.get("case_insensitive"))
        hay = text.lower() if ci else text
        for v in vals:
            n = v.lower() if ci else v
            if n in hay:
                return True, f"contains_any ok ({v!r})"
        return False, f"none of {vals!r} found"
    if ctype == "json_point":
        obj = extract_json_object(text)
        if obj is None:
            return False, "could not parse JSON object from response"
        raw_x, raw_y = obj.get("x"), obj.get("y")
        try:
            x, y = float(raw_x), float(raw_y)
        except (TypeError, ValueError):
            return False, f"JSON missing numeric x,y (got x={raw_x!r}, y={raw_y!r})"

        region = checker.get("region")
        if region is not None:
            ok_region, reason = point_in_region(x, y, region)
            if not ok_region:
                return False, reason

        exclude_rect = checker.get("exclude_rect")
        if isinstance(exclude_rect, list):
            if not point_outside_rect(x, y, exclude_rect):
                return False, f"point ({x}, {y}) inside excluded rect {exclude_rect}"

        exp_x, exp_y = checker.get("x"), checker.get("y")
        if exp_x is not None and exp_y is not None:
            try:
                gx, gy = float(exp_x), float(exp_y)
            except (TypeError, ValueError):
                return False, "checker x,y must be numeric"
            tol = float(checker.get("tolerance", 80))
            if abs(x - gx) > tol or abs(y - gy) > tol:
                return False, (
                    f"point ({x}, {y}) outside tolerance {tol}px from golden ({gx}, {gy})"
                )

        contains_any = checker.get("contains_any")
        if isinstance(contains_any, list) and contains_any:
            ci = bool(checker.get("case_insensitive"))
            haystacks = [text.lower() if ci else text]
            for val in obj.values():
                if isinstance(val, str):
                    haystacks.append(val.lower() if ci else val)
            if not any(
                (v.lower() if ci else v) in hay
                for v in contains_any
                if isinstance(v, str)
                for hay in haystacks
            ):
                return False, f"response missing any of {contains_any!r}"

        return True, f"json_point ok ({x}, {y})"
    return False, f"unknown checker type: {ctype!r}"


def resolve_image_path(image: str, jsonl_path: str) -> str | None:
    if os.path.isabs(image) and os.path.isfile(image):
        return image
    jsonl_dir = os.path.dirname(os.path.abspath(jsonl_path))
    candidates = [
        os.path.join(jsonl_dir, image),
        os.path.join(jsonl_dir, os.path.basename(image)),
        os.path.join(os.path.dirname(jsonl_dir), image),
        os.path.abspath(image),
    ]
    seen: set[str] = set()
    for path in candidates:
        norm = os.path.normpath(path)
        if norm in seen:
            continue
        seen.add(norm)
        if os.path.isfile(norm):
            return norm
    return None


def image_to_data_url(path: str) -> str:
    mime, _ = mimetypes.guess_type(path)
    if not mime or not mime.startswith("image/"):
        ext = os.path.splitext(path)[1].lower()
        mime = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
            ".gif": "image/gif",
        }.get(ext, "image/png")
    with open(path, "rb") as f:
        b64 = base64.standard_b64encode(f.read()).decode("ascii")
    return f"data:{mime};base64,{b64}"


def chat_completion(
    base_url: str,
    model: str,
    messages: list[dict[str, Any]],
    temperature: float,
    max_tokens: int,
    timeout: float,
    *,
    enable_thinking: bool | None = None,
) -> tuple[int, object | None, str | None]:
    url = base_url.rstrip("/") + "/v1/chat/completions"
    body: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": False,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if enable_thinking is not None:
        body["chat_template_kwargs"] = {"enable_thinking": enable_thinking}
    payload = json.dumps(body).encode()
    req = urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else None, None
    except urllib.error.HTTPError as e:
        raw = e.read().decode() if e.fp else ""
        try:
            parsed = json.loads(raw) if raw else None
        except json.JSONDecodeError:
            parsed = raw[:2000] if raw else None
        return e.code, parsed, str(e)
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        return 0, None, str(e)


def load_jsonl(path: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with open(path, encoding="utf-8") as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as e:
                print(f"vision_benchmark: skip line {line_num}: invalid JSON: {e}", file=sys.stderr)
                continue
            if isinstance(row, dict):
                rows.append(row)
    return rows


def main() -> None:
    here = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.dirname(here)
    default_input = "/workspace/screenshots/vision_tasks.jsonl"
    fallback_input = os.path.join(repo_root, "screenshots", "vision_tasks.jsonl")

    p = argparse.ArgumentParser(description="Vision chat benchmark (JSONL + images + checkers).")
    p.add_argument(
        "--input",
        "-i",
        default=os.environ.get(
            "VISION_BENCH_INPUT",
            default_input if os.path.isfile(default_input) else fallback_input,
        ),
        help="JSONL path (default: screenshots/vision_tasks.jsonl).",
    )
    p.add_argument(
        "--base-url",
        default=os.environ.get("VISION_BENCH_BASE_URL", "http://127.0.0.1:8000"),
        help="OpenAI-compatible server origin (no path).",
    )
    p.add_argument(
        "--model",
        "-m",
        default=os.environ.get("VISION_BENCH_MODEL", "") or "",
        help="Served model id (default: /v1/models first).",
    )
    p.add_argument(
        "--temperature",
        type=float,
        default=float(os.environ.get("VISION_BENCH_TEMPERATURE", "0.2")),
    )
    p.add_argument(
        "--max-tokens",
        type=int,
        default=int(os.environ.get("VISION_BENCH_MAX_TOKENS", "2048")),
    )
    p.add_argument(
        "--thinking",
        action=argparse.BooleanOptionalAction,
        default=os.environ.get("VISION_BENCH_THINKING", "0").strip().lower()
        in ("1", "true", "yes"),
        help="Enable Qwen3.x thinking mode (default: off). Per-case thinking overrides.",
    )
    p.add_argument(
        "--timeout",
        type=float,
        default=float(os.environ.get("VISION_BENCH_TIMEOUT_SEC", "300")),
        help="Per-request timeout in seconds.",
    )
    args = p.parse_args()

    path = os.path.abspath(args.input)
    if not os.path.isfile(path):
        print(f"vision_benchmark: file not found: {path}", file=sys.stderr)
        raise SystemExit(2)

    model = args.model.strip()
    if not model:
        model = fetch_served_model_id(args.base_url, min(30.0, args.timeout)) or ""
    if not model:
        print(
            "vision_benchmark: set --model or VISION_BENCH_MODEL, or ensure GET /v1/models works.",
            file=sys.stderr,
        )
        raise SystemExit(2)

    cases = load_jsonl(path)
    if not cases:
        print("vision_benchmark: no cases loaded.", file=sys.stderr)
        raise SystemExit(2)

    print(
        f"vision_benchmark: model={model!r} cases={len(cases)} base={args.base_url!r}\n",
        file=sys.stderr,
    )

    results: list[dict[str, Any]] = []
    t0 = time.perf_counter()

    for case in cases:
        cid = str(case.get("id", ""))
        category = str(case.get("category", "unknown"))
        user_prompt = case.get("prompt")
        checker = case.get("checker")
        image_ref = case.get("image")
        if not isinstance(user_prompt, str) or not user_prompt.strip():
            results.append(
                {
                    "id": cid,
                    "category": category,
                    "ok": False,
                    "error": "missing prompt",
                    "latency_ms": 0,
                }
            )
            continue
        if not isinstance(image_ref, str) or not image_ref.strip():
            results.append(
                {
                    "id": cid,
                    "category": category,
                    "ok": False,
                    "error": "missing image",
                    "latency_ms": 0,
                }
            )
            continue

        image_path = resolve_image_path(image_ref.strip(), path)
        if image_path is None:
            results.append(
                {
                    "id": cid,
                    "category": category,
                    "ok": False,
                    "error": f"image not found: {image_ref!r}",
                    "latency_ms": 0,
                }
            )
            continue

        try:
            data_url = image_to_data_url(image_path)
        except OSError as e:
            results.append(
                {
                    "id": cid,
                    "category": category,
                    "ok": False,
                    "error": f"read image: {e}",
                    "latency_ms": 0,
                }
            )
            continue

        messages: list[dict[str, Any]] = []
        sys_msg = case.get("system")
        if isinstance(sys_msg, str) and sys_msg.strip():
            messages.append({"role": "system", "content": sys_msg.strip()})
        messages.append(
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": user_prompt.strip()},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }
        )

        thinking = args.thinking
        if "thinking" in case:
            thinking = bool(case["thinking"])

        t_req = time.perf_counter()
        status, data, err = chat_completion(
            args.base_url,
            model,
            messages,
            args.temperature,
            args.max_tokens,
            args.timeout,
            enable_thinking=thinking,
        )
        dt_ms = int((time.perf_counter() - t_req) * 1000)

        if status != 200 or not isinstance(data, dict):
            detail = data if data is not None else err
            results.append(
                {
                    "id": cid,
                    "category": category,
                    "ok": False,
                    "error": f"http {status}: {detail}",
                    "latency_ms": dt_ms,
                    "image": image_path,
                }
            )
            continue

        content, reasoning = assistant_parts_from_completion(data)
        text = text_for_grading(content, reasoning, checker)
        ok, reason = run_checker(text, checker)
        preview = (text[:500] + "…") if len(text) > 500 else text
        results.append(
            {
                "id": cid,
                "category": category,
                "ok": ok,
                "reason": reason,
                "latency_ms": dt_ms,
                "preview": preview,
                "image": image_path,
                "thinking": thinking,
                "had_reasoning": bool(reasoning),
            }
        )
        mark = "PASS" if ok else "FAIL"
        print(f"[{mark}] {cid} ({category}) {dt_ms}ms — {reason}", file=sys.stderr)
        if not ok:
            print(f"  preview: {preview!r}", file=sys.stderr)

    wall_ms = int((time.perf_counter() - t0) * 1000)
    passed = sum(1 for r in results if r.get("ok"))
    by_cat: dict[str, dict[str, int]] = {}
    for r in results:
        c = str(r.get("category", "unknown"))
        bucket = by_cat.setdefault(c, {"pass": 0, "fail": 0})
        if r.get("ok"):
            bucket["pass"] += 1
        else:
            bucket["fail"] += 1

    summary = {
        "model": model,
        "input": path,
        "wall_ms": wall_ms,
        "cases": len(results),
        "passed": passed,
        "failed": len(results) - passed,
        "pass_rate": round(passed / len(results), 4) if results else 0.0,
        "by_category": by_cat,
        "results": results,
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
