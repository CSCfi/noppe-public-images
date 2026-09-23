#!/usr/bin/env bash
# Local dev loop for the noppe-learning engine: builds the image from this repo
# and mounts a disposable COPY of ../noppe-cli as the course content.
#
# The startup script substitutes {{USERNAME}}/{{PASSWORD}}/etc. in place via sed,
# so bind-mounting the real working tree would write runtime values into
# git-tracked files. The trade-off for copying is that content edits need a
# re-run rather than a live refresh.
set -euo pipefail
cd "$(dirname "$0")"

CONTENT_DIR="${1:-../noppe-cli}"
USERNAME="${USERNAME:-user}"
PASSWORD="${PASSWORD:-devpass}"
SCRATCH_DIR=".content-scratch"

rm -rf "$SCRATCH_DIR"
cp -a "$(realpath "$CONTENT_DIR")" "$SCRATCH_DIR"

DOCKER_BUILDKIT=1 docker build --build-arg USERNAME="$USERNAME" -t noppe-learning:dev .
docker run --rm -p 8787:8787 \
  -e PASSWORD="$PASSWORD" \
  -v "$(realpath "$SCRATCH_DIR")":/home/"$USERNAME"/noppe-cli \
  noppe-learning:dev
