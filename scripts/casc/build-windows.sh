#!/bin/sh
# Builds scripts/casc/bin/casc-extract.exe (the Windows game-data extractor) on Linux, in a
# podman container. Run it before packaging the Windows version.
set -eu
DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE=localhost/replay-altar-casc-windows:latest
nice -n 19 podman build -q -t "$IMAGE" -f "$DIR/Containerfile.windows" "$DIR" >/dev/null
mkdir -p "$DIR/bin"
podman run --rm --security-opt label=disable -v "$DIR/bin":/out:z --entrypoint cp "$IMAGE" /casc-extract.exe /out/
echo "built $DIR/bin/casc-extract.exe"
