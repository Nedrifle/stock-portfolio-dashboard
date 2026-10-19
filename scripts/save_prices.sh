#!/usr/bin/env bash
# Never publish an older checkout after main advances during price retrieval.
set -euo pipefail
stale() {
  echo 'main was updated during this run; the newer run will fetch and deploy.'
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then echo 'stale=true' >> "$GITHUB_OUTPUT"; fi
}
base=$(git rev-parse HEAD)
git fetch origin main
if [[ "$(git rev-parse origin/main)" != "$base" ]]; then
  stale
  exit 0
fi
git add site/data/quotes.json market-symbols.json
if ! git diff --cached --quiet; then
  git commit -m 'Update public stock prices'
  if ! git push origin HEAD:main; then
    git fetch origin main
    if [[ "$(git rev-parse origin/main)" != "$base" ]]; then
      stale
      exit 0
    fi
    # Authentication, network and other genuine failures remain failures.
    exit 1
  fi
fi
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then echo 'stale=false' >> "$GITHUB_OUTPUT"; fi
