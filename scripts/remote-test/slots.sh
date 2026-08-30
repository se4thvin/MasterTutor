# Stack slots on the shared CI host (D48). Sourced by run-on-host.sh and by scripts/remote-test.test.ts.
#
# Every stack suite (behaviour, ui, e2e, smoke, bench-mock) holds one slot for its whole run. A
# slot is a counting-semaphore seat (flock on ~/mt-ci/.runs/slot-<i>.lock, released by the kernel
# when the run exits, even on a crash) and owns a block of addresses no other run uses:
#   - networks: 10.213.<8i>.0/21, one /24 per network (cdp or behaviour, fixtures, edge, backend, egress);
#   - loopback ports: 20000+100i .. 20000+100i+99.
# Slot 31 is reserved for qa, whose long-lived stack keeps the legacy stack.lock instead of a seat.
# None of this overlaps the legacy fixed values (172.30.x subnets, ports 18080 and 19223), so runs
# from branches that still use the old locks coexist with these. Pure functions first; only
# acquire_slot touches the host. Bash 3.2-compatible apart from acquire_slot.

SLOT_NET=10.213
SLOT_PORT_BASE=20000
SLOT_QA=31

# The network variables of slot $1, one NAME=VALUE per line.
slot_networks() {
  local n=$((8 * $1))
  echo "CDP_SUBNET_PREFIX=$SLOT_NET.$n"
  echo "BEHAVIOUR_SUBNET_PREFIX=$SLOT_NET.$n"
  echo "FIXTURES_SUBNET_PREFIX=$SLOT_NET.$((n + 1))"
  echo "MT_CI_EDGE_SUBNET=$SLOT_NET.$((n + 2)).0/24"
  echo "MT_CI_BACKEND_SUBNET=$SLOT_NET.$((n + 3)).0/24"
  echo "MT_CI_EGRESS_SUBNET=$SLOT_NET.$((n + 4)).0/24"
}

# The loopback port variables of slot $1, one NAME=VALUE per line.
slot_ports() {
  local p=$((SLOT_PORT_BASE + 100 * $1))
  echo "BEHAVIOUR_CDP_PORT_1=$((p + 1))"
  echo "BEHAVIOUR_CDP_PORT_2=$((p + 2))"
  echo "BEHAVIOUR_NEKO_PORT_1=$((p + 11))"
  echo "BEHAVIOUR_NEKO_PORT_2=$((p + 12))"
  echo "BEHAVIOUR_IDLE_PORT_1=$((p + 21))"
  echo "BEHAVIOUR_IDLE_PORT_2=$((p + 22))"
  echo "BEHAVIOUR_AUDIO_PORT=$((p + 31))"
  echo "WEB_UI_PORT=$((p + 30))"
  echo "TEST_HTTP_PORT=$((p + 80))"
}

# An IPv4 address as an integer.
ip_int() {
  local IFS=. a b c d
  read -r a b c d <<<"$1"
  echo $(((a << 24) + (b << 16) + (c << 8) + d))
}

# Succeeds when the IPv4 CIDRs $1 and $2 share any address.
cidr_overlaps() {
  local a_ip=${1%/*} a_len=${1#*/} b_ip=${2%/*} b_len=${2#*/} a0 a1 b0 b1
  a0=$(($(ip_int "$a_ip") & ~((1 << (32 - a_len)) - 1) & 0xFFFFFFFF))
  a1=$((a0 + (1 << (32 - a_len)) - 1))
  b0=$(($(ip_int "$b_ip") & ~((1 << (32 - b_len)) - 1) & 0xFFFFFFFF))
  b1=$((b0 + (1 << (32 - b_len)) - 1))
  ((a0 <= b1 && b0 <= a1))
}

# Prints why slot $1 is unusable, given the host's network subnets ($2, whitespace-separated
# CIDRs; non-IPv4 entries are ignored) and listening TCP ports ($3, whitespace-separated). Prints
# nothing when the slot is free.
slot_conflict() {
  local slot=$1 cidr port first=$((SLOT_PORT_BASE + 100 * $1))
  for cidr in $2; do
    [[ "$cidr" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/[0-9]+$ ]] || continue
    if cidr_overlaps "$cidr" "$SLOT_NET.$((8 * slot)).0/21"; then
      echo "network $cidr overlaps $SLOT_NET.$((8 * slot)).0/21"
      return 0
    fi
  done
  for port in $3; do
    if ((port >= first && port < first + 100)); then
      echo "port $port is in use"
      return 0
    fi
  done
}

# The host's Docker network subnets and listening TCP ports, for slot_conflict.
# One inspect per network: a concurrent run may remove a network between ls and inspect, and a
# network that is gone holds no subnet.
# Listing itself failing (no daemon) is still an error: never allocate blind.
host_subnets() {
  local id ids
  ids="$(docker network ls -q)" || return 1
  for id in $ids; do
    docker network inspect -f '{{range .IPAM.Config}}{{.Subnet}} {{end}}' "$id" 2>/dev/null || true
  done
}
host_ports() { ss -ltnH | awk '{ sub(/.*:/, "", $4); print $4 }'; }

# Takes the first free, conflict-free slot below $1, waiting while all are busy. Sets SLOT and
# keeps SLOT_FD open (holding the seat) until this shell exits. $2 is the folder for the lock files.
# The host is probed after the seat is taken, so the check and the allocation are one step under
# the lock: a slot's previous holder frees its seat only after its cleanup has finished, so a
# subnet still being torn down in this slot's block is a crashed run's leftover and is skipped.
acquire_slot() {
  local max=$1 dir=$2 i fd subnets ports why
  while true; do
    for ((i = 0; i < max; i++)); do
      exec {fd}>"$dir/slot-$i.lock"
      if flock -n "$fd"; then
        subnets="$(host_subnets)"
        ports="$(host_ports)"
        why="$(slot_conflict "$i" "$subnets" "$ports")"
        if [[ -z "$why" ]]; then
          SLOT=$i SLOT_FD=$fd
          return 0
        fi
        echo "remote-test: skipping stack slot $i: $why (a leftover from a crashed run?)" >&2
      fi
      exec {fd}>&-
    done
    echo "remote-test: all $max stack slots are busy; waiting" >&2
    sleep 15
  done
}
