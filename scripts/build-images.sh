#!/usr/bin/env bash
# ABOUTME: Build script for meta-vibecoding Docker base images.
# Builds Node.js, Python, and Rust cell images with proper tagging.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$SCRIPT_DIR/../docker/meta-vibecoding"

IMAGES=(
  "node:Dockerfile.node:meta-vibecoding/cell-node:latest"
  "python:Dockerfile.python:meta-vibecoding/cell-python:latest"
  "rust:Dockerfile.rust:meta-vibecoding/cell-rust:latest"
)

echo "==> Building meta-vibecoding cell images..."

for entry in "${IMAGES[@]}"; do
  IFS=':' read -r name dockerfile image tag <<< "$entry"
  echo ""
  echo "--- Building $image:$tag from $dockerfile ---"
  docker build \
    -t "$image:$tag" \
    -f "$DOCKER_DIR/$dockerfile" \
    "$DOCKER_DIR"
  echo "--- Done: $image:$tag ---"
done

echo ""
echo "==> All images built successfully."
echo ""
docker images --filter "reference=meta-vibecoding/cell-*" --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}"
