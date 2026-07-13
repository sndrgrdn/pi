#!/usr/bin/env bash
set -euo pipefail

exec optiq serve \
  --model mlx-community/Qwen3.6-35B-A3B-OptiQ-4bit \
  --mtp \
  --mtp-depth 2 \
  --port 8080
