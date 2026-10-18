#!/bin/sh
# Extracts the balance tables WC3V's simulation needs from the local Warcraft III install.
#
#   scripts/extract-gamedata.sh [wc3-install-dir]
#
# Reads the game's CASC storage with casc-extract (scripts/casc) in a podman container.
# The install is mounted as an overlay (:O): CascLib opens files read-write, and the
# overlay sends anything it might write to a throwaway layer, so the game files are never
# touched. Output: vendor/wc3v/helpers/UnitBalance.json plus a copy of the source tables
# and a manifest under $REPLAY_ALTAR_DATA/sim/gamedata/<game version>/.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WC3="${1:-$HOME/Games/battlenet/drive_c/Program Files (x86)/Warcraft III}"
DATA="${REPLAY_ALTAR_DATA:-${XDG_DATA_HOME:-$HOME/.local/share}/replay-altar}"
IMAGE=localhost/replay-altar-casc:latest

[ -f "$WC3/.build.info" ] || { echo "No Warcraft III install at $WC3" >&2; exit 1; }
VERSION="$(awk -F'|' 'NR==1{for(i=1;i<=NF;i++) if($i ~ /^Version!/) c=i} NR==2{print $c}' "$WC3/.build.info")"
OUT="$DATA/sim/gamedata/$VERSION"
mkdir -p "$OUT"

if ! podman image exists "$IMAGE"; then
  echo "Building the CASC extractor image (one time)…"
  podman build -q -t "$IMAGE" "$ROOT/scripts/casc" >/dev/null
fi

# The base war3.w3mod tables are current melee balance. The _balance\* overlays are
# alternate data sets for custom maps and are not used here.
nice -n 19 podman run --rm --security-opt label=disable \
  -v "$WC3":/war3:O -v "$OUT":/out:z "$IMAGE" /war3 /out \
  'war3.w3mod:units\unitbalance.slk' \
  'war3.w3mod:units\upgradedata.slk' \
  'war3.w3mod:units\abilitydata.slk' \
  'war3.w3mod:units\itemdata.slk' \
  'war3.w3mod:units\unitweapons.slk' \
  'war3.w3mod:units\unitdata.slk' \
  'war3.w3mod:units\miscgame.txt'

# WC3V's converter reads ./UnitBalance.slk and writes ./UnitBalance.json.
(cd "$OUT" && cp unitbalance.slk UnitBalance.slk && node "$ROOT/vendor/wc3v/slk/slk.js" >/dev/null)
cp "$OUT/UnitBalance.json" "$ROOT/vendor/wc3v/helpers/UnitBalance.json"

{
  echo "{"
  echo "  \"gameVersion\": \"$VERSION\","
  echo "  \"source\": \"war3.w3mod:units (base melee tables) from $WC3\","
  echo "  \"extractedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
  echo "  \"sha256\": {"
  first=1
  for f in unitbalance.slk upgradedata.slk abilitydata.slk itemdata.slk unitweapons.slk unitdata.slk miscgame.txt UnitBalance.json; do
    [ $first -eq 1 ] || echo ","
    printf '    "%s": "%s"' "$f" "$(sha256sum "$OUT/$f" | cut -d' ' -f1)"
    first=0
  done
  echo ""
  echo "  }"
  echo "}"
} > "$OUT/manifest.json"
ln -sfn "$VERSION" "$DATA/sim/gamedata/current"
echo "Game data $VERSION -> $OUT (and vendor/wc3v/helpers/UnitBalance.json)"
