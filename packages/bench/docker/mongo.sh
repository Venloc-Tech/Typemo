#!/usr/bin/env bash
# Starts (or reuses) the benchmark MongoDB container and waits for the replica set.
# Usage: packages/bench/docker/mongo.sh [up|down|status]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
compose=(docker compose -f "$here/compose.yaml")
case "${1:-up}" in
  up)
    "${compose[@]}" up -d --wait
    docker exec typemo-bench-mongo mongosh --quiet --eval '
      try { rs.status().ok } catch (e) {
        rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "localhost:27017" }] });
      }
      while (!db.hello().isWritablePrimary) { sleep(200); }
      print("rs0 primary ready, mongod " + db.version());
    '
    ;;
  down) "${compose[@]}" down -v ;;
  status) docker ps --filter name=typemo-bench-mongo ;;
  *) echo "usage: $0 [up|down|status]" >&2; exit 2 ;;
esac
