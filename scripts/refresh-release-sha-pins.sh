#!/usr/bin/env bash
# scripts/refresh-release-sha-pins.sh
#
# Compares the pinned action SHAs in .github/workflows/release.yml and
# .github/workflows/release-dry-run.yml against the latest commits on
# GitHub. Defaults to a dry-run that prints the diff. Pass --apply to
# write the new SHAs back to disk after a maintainer confirmation.
#
# Usage:
#   scripts/refresh-release-sha-pins.sh          # dry-run (default)
#   scripts/refresh-release-sha-pins.sh --apply # prompt + write changes
#   scripts/refresh-release-sha-pins.sh --help
#
# Companion to the release.yml + release-dry-run.yml workflows. Run this
# whenever an upstream action releases a security fix or you want to drift
# detection without re-investigating each ref manually.

set -euo pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  head -n 5 "$0"
  exit 0
fi

DRY_RUN=true
if [[ "${1:-}" == "--apply" ]]; then
  DRY_RUN=false
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WF_FILES=(
  "$ROOT_DIR/.github/workflows/release.yml"
  "$ROOT_DIR/.github/workflows/release-dry-run.yml"
)

# (label, repo, ref_kind, ref, grep-regex)
# grep-regex matches the @<sha> portion in pinned action lines.
TARGETS=(
  "tauri-apps/tauri-action@v0|tauri-apps/tauri-action|tag|v0|tauri-apps/tauri-action@[a-f0-9]{40}"
  "dtolnay/rust-toolchain@stable|dtolnay/rust-toolchain|branch|stable|dtolnay/rust-toolchain@[a-f0-9]{40}"
  "actions/checkout@v4|actions/checkout|tag|v4|actions/checkout@[a-f0-9]{40}"
  "actions/setup-node@v4|actions/setup-node|tag|v4|actions/setup-node@[a-f0-9]{40}"
  "actions/setup-python@v5|actions/setup-python|tag|v5|actions/setup-python@[a-f0-9]{40}"
  "actions/upload-artifact@v4|actions/upload-artifact|tag|v4|actions/upload-artifact@[a-f0-9]{40}"
)

# Sanity check: both workflow files must exist
for wf in "${WF_FILES[@]}"; do
  if [[ ! -f "$wf" ]]; then
    echo "ERROR: workflow file not found: $wf" >&2
    exit 2
  fi
done

# Sanity check: jq must be on PATH (used to extract SHA from API responses)
command -v jq >/dev/null || { echo "ERROR: jq is required (apt: jq, brew: jq, choco: jq)" >&2; exit 2; }

echo "Pinned action SHAs in .github/workflows/ :"
echo "--------------------------------------------------------------------------------"
declare -A STALE_TARGETS  # label -> "current_old|latest_new"

for t in "${TARGETS[@]}"; do
  IFS='|' read -r label repo ref_kind ref re <<< "$t"

  if [[ "$ref_kind" == "branch" ]]; then
    api_url="https://api.github.com/repos/${repo}/git/refs/heads/${ref}"
  else
    api_url="https://api.github.com/repos/${repo}/git/refs/tags/${ref}"
  fi

  latest_sha=$(curl -fsSL \
    -H "Accept: application/vnd.github+json" \
    -H "User-Agent: lens-refresh-release-sha-pins" \
    "$api_url" 2>/dev/null \
    | jq -r '.object.sha // empty' 2>/dev/null \
    || true)

  if [[ -z "$latest_sha" ]]; then
    printf "  %-40s  current=%-12s  latest=API_ERROR\n" "$label" "$(echo "?"  )"
    continue
  fi

  current_sha=""
  for wf in "${WF_FILES[@]}"; do
    found=$(grep -oE "$re" "$wf" 2>/dev/null | head -1 | sed -E "s|.*@([a-f0-9]{40})|\1|" || true)
    if [[ -n "$found" ]]; then
      current_sha="$found"
      break
    fi
  done

  if [[ -z "$current_sha" ]]; then
    printf "  %-40s  current=NOT_PINNED  latest=%.12s\n" "$label" "$latest_sha"
  elif [[ "$current_sha" == "$latest_sha" ]]; then
    printf "  %-40s  current=%.12s  latest=ALREADY_LATEST\n" "$label" "$current_sha"
    # Strip from STALE_TARGETS to skip apply
  else
    printf "  %-40s  current=%.12s  latest=%.12s  *STALE*\n" "$label" "$current_sha" "$latest_sha"
    STALE_TARGETS["$label"]="${repo}|${current_sha}|${latest_sha}"
  fi
done
echo "--------------------------------------------------------------------------------"

if [[ ${#STALE_TARGETS[@]} -eq 0 ]]; then
  echo "All pinned SHAs already match latest. Nothing to do."
  exit 0
fi

if $DRY_RUN; then
  echo
  echo "Dry-run only. Re-run with --apply to write changes after confirmation."
  exit 0
fi

# Apply mode
echo
echo "Targets to update:"
for label in "${!STALE_TARGETS[@]}"; do
  IFS='|' read -r repo cur lat <<< "${STALE_TARGETS[$label]}"
  printf "  %-40s  %.12s -> %.12s\n" "$label" "$cur" "$lat"
done
echo

read -r -p "Apply changes to .github/workflows/release*.yml? (y/N) " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 1
fi

# Use perl -pi for portable in-place regex replacement (matches \Q...\E literal).
for label in "${!STALE_TARGETS[@]}"; do
  IFS='|' read -r repo cur lat <<< "${STALE_TARGETS[$label]}"
  for wf in "${WF_FILES[@]}"; do
    # Only update if the current SHA is present in the file
    if grep -q "${repo}@${cur}" "$wf"; then
      perl -pi -e "s|\Q${repo}@${cur}\E|${repo}@${lat}|g" "$wf"
      echo "  updated: $wf  (${repo}@${cur:0:12} -> ${lat:0:12})"
    fi
  done
done

echo
echo "Done. Review the diff with: git diff .github/workflows/"
echo "Commit + push via the usual release-prep flow described in README.md."
