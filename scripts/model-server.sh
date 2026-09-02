#!/usr/bin/env bash
# Serves Qwen3-VL locally over an OpenAI-compatible API.
#
# The point of the OpenAI shape is that Studio does not care where the model
# lives: this server and OpenRouter take the same request, so Private Mode is a
# base-URL change rather than a second code path.
set -euo pipefail

cd "$(dirname "$0")/.."

MODEL="${LOCAL_MODEL:-mlx-community/Qwen3-VL-4B-Instruct-4bit}"
PORT="${LOCAL_MODEL_PORT:-8081}"

if [ ! -x ".venv/bin/python" ]; then
  echo "No local model environment yet. Run: pnpm setup:model" >&2
  exit 1
fi

echo "Serving $MODEL on http://127.0.0.1:$PORT/v1"
echo "First run downloads the weights (~2.5 GB) and will take a few minutes."

exec .venv/bin/python -m mlx_vlm.server --model "$MODEL" --port "$PORT"
