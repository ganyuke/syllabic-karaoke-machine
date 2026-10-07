#!/bin/sh
# Builds the release binary inside a container, for computers without a C toolchain.
# The result lands in native/dist/syllabic-karaoke-machine.
set -e
cd "$(dirname "$0")"
podman run --rm \
  -v "$PWD/..:/repo:Z" \
  -v skm-cargo:/usr/local/cargo/registry \
  -v skm-target:/target \
  -e CARGO_TARGET_DIR=/target \
  -w /repo/native \
  docker.io/library/rust:latest \
  sh -c 'apt-get update -qq && apt-get install -y -qq libasound2-dev pkg-config >/dev/null && cargo build --release && mkdir -p dist && cp /target/release/syllabic-karaoke-machine dist/'
echo "Built native/dist/syllabic-karaoke-machine"
