#!/bin/sh
# Builds scripts/casc/bin/casc-extract (a self-contained Linux game-data extractor) in a podman
# container. Run it before packaging the AppImage; a checkout uses it too when it is there.
set -eu
DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE=localhost/replay-altar-casc-linux:latest
nice -n 19 podman build -q -t "$IMAGE" -f "$DIR/Containerfile.linux" "$DIR" >/dev/null
mkdir -p "$DIR/bin"
podman run --rm --security-opt label=disable -v "$DIR/bin":/out:z --entrypoint cp "$IMAGE" /casc-extract /out/
echo "built $DIR/bin/casc-extract"
