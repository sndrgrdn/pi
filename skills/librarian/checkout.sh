#!/usr/bin/env bash
set -euo pipefail

# The human-facing /librarian skill and the Librarian agent deliberately call
# the same TypeScript implementation. Keep this wrapper logic-free.
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
agent_dir="$(cd -- "$script_dir/../.." && pwd)"
exec "$agent_dir/extensions/node_modules/.bin/jiti" \
  "$agent_dir/extensions/harness/tools/checkout-cli.ts" "$1"
