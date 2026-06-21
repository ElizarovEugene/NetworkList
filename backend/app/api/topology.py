"""Returns graph data for the network map (nodes + edges).

Column position on the map isn't a fixed 4-tier scheme — it's each node's
BFS distance (depth) from the router, walked over the real edges (manual
links and parent->guest virtualization links). That way a VM's containers
always end up one column to its right regardless of whether the VM itself
is physical or virtual, and a host wired through a switch sits one column
further out than the switch — no fixed limit on how many columns exist.

Hosts with no real (manual/virt) path back to the router still need to
connect to it somehow, so each otherwise-disconnected cluster gets an
inferred gateway edge — attached to a network device in that cluster if
there is one (the natural uplink, shared by all of the cluster's other
members so a switch's downstream hosts route through the switch instead of
each drawing its own redundant line straight to the gateway). If there's no
real switch, every standalone physical candidate gets its own inferred edge
instead of arbitrarily picking one to stand in for the rest.
"""
from collections import defaultdict, deque
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional

from app.database import get_db
from app.models import Host, Link, Network

router = APIRouter(prefix="/topology", tags=["topology"])


class _DSU:
    def __init__(self, ids):
        self.parent = {i: i for i in ids}

    def find(self, x):
        while self.parent[x] != x:
            x = self.parent[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[ra] = rb


@router.get("/")
def get_topology(
    network_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(Host)
    if network_id is not None:
        q = q.filter_by(network_id=network_id)
    hosts = q.all()

    gateway_ips = {n.gateway for n in db.query(Network).all() if n.gateway}

    def tier_of(h: Host) -> str:
        if h.virt_type in ("vm", "container"):
            return "virtual"
        if h.ip_address in gateway_ips:
            return "router"
        return "physical"

    tiers = {h.id: tier_of(h) for h in hosts}
    all_hosts_by_id = {h.id: h for h in hosts}

    # Powered-off VMs with no IP at all are unreachable clutter — hide them,
    # same rule as the Hosts list. Also respect the per-host map visibility
    # toggles: hide this host entirely, or just hide its VMs/containers.
    def is_hidden(h: Host) -> bool:
        if tiers[h.id] == "virtual" and h.virt_type == "vm" and h.is_up is False and not h.ip_address:
            return True
        if h.map_hidden:
            return True
        if h.parent_host_id:
            parent = all_hosts_by_id.get(h.parent_host_id)
            if parent and parent.map_hide_virt_children:
                return True
        return False

    hosts = [h for h in hosts if not is_hidden(h)]
    host_map = {h.id: h for h in hosts}

    # — Manual links (drawn by the user, or discovered via LLDP/CDP) —
    manual_edges = []
    seen_pairs: set = set()
    for lnk in db.query(Link).all():
        if lnk.source_id not in host_map or lnk.target_id not in host_map:
            continue
        # Edge ids share a namespace with node ids in Cytoscape — Link.id and
        # Host.id are independent sequences that collide (both start at 1),
        # which silently drops whichever edge loses the clash. Prefix it.
        manual_edges.append((f"link-{lnk.id}", lnk.source_id, lnk.target_id, lnk.link_type, lnk.source_iface, lnk.target_iface))
        seen_pairs.add(frozenset((lnk.source_id, lnk.target_id)))

    # — Virtualization links: each VM/container to the host that runs it —
    # including virt_type "host" (an ESXi host vCenter merely monitors over
    # the vSphere API, not actually runs). Keeping this edge in the graph
    # matters for connectivity: it's often the *only* thing anchoring
    # vCenter's whole VM cluster to the rest of the network. Depth still
    # comes out right because BFS takes the shortest path — if that ESXi
    # host also has its own real link (manual or LLDP) to a switch, it gets
    # its shallow depth from that, and vCenter/its VMs end up one hop
    # further out through this edge, not the other way around.
    virt_edges = []
    for h in hosts:
        if not h.parent_host_id or h.parent_host_id not in host_map:
            continue
        pair = frozenset((h.parent_host_id, h.id))
        if pair not in seen_pairs:
            seen_pairs.add(pair)
            virt_edges.append((f"virt-{h.parent_host_id}-{h.id}", h.parent_host_id, h.id))

    # — Group hosts into connected components over the *real* graph only —
    dsu = _DSU([h.id for h in hosts])
    real_adjacency: dict = {h.id: set() for h in hosts}
    for _, s, t, *_ in manual_edges:
        real_adjacency[s].add(t)
        real_adjacency[t].add(s)
        dsu.union(s, t)
    for _, s, t in virt_edges:
        real_adjacency[s].add(t)
        real_adjacency[t].add(s)
        dsu.union(s, t)

    # A site can have more than one gateway (multiple independent Networks,
    # each with its own router, not bridged to one another) — anchor on
    # *every* router's component, not just the first one found, or every
    # router past the first looks disconnected and gets a spurious inferred
    # edge trying to reach some other network's gateway.
    router_ids = [h.id for h in hosts if tiers[h.id] == "router"]
    router_roots = {dsu.find(rid) for rid in router_ids}

    components: dict = defaultdict(list)
    for h in hosts:
        components[dsu.find(h.id)].append(h)

    # — Inferred gateway edge(s) per disconnected cluster, attached to a
    # network device in that cluster if there is one. If there's a real
    # switch, every other candidate genuinely reaches the gateway through
    # it, so it alone gets the uplink. If there isn't — e.g. two standalone
    # ESXi hosts that share nothing real except both reporting to the same
    # vCenter VM — they aren't actually routed through each other, so each
    # gets its own direct line; picking just one (the old behaviour) shoved
    # the other physical box a column behind the VM that merely monitors it.
    inferred_edges = []
    for root, members in components.items():
        if root in router_roots:
            continue
        candidates = [h for h in members if tiers[h.id] == "physical" and h.network_id]
        if not candidates:
            continue
        network_candidates = [h for h in candidates if h.device_type == "network"]
        uplinks = [sorted(network_candidates, key=lambda h: h.id)[0]] if network_candidates else candidates
        for uplink in uplinks:
            net = db.get(Network, uplink.network_id)
            if not net or not net.gateway:
                continue
            gw = db.query(Host).filter_by(ip_address=net.gateway).first()
            if not gw or gw.id not in host_map or gw.id == uplink.id:
                continue
            pair = frozenset((gw.id, uplink.id))
            if pair in seen_pairs:
                continue
            seen_pairs.add(pair)
            inferred_edges.append((f"gw-{min(gw.id, uplink.id)}-{max(gw.id, uplink.id)}", gw.id, uplink.id))

    # — BFS depth from the router(s) over the full graph (real + inferred) —
    adjacency = real_adjacency
    for _, s, t in inferred_edges:
        adjacency[s].add(t)
        adjacency[t].add(s)

    depth: dict = {}
    queue = deque()
    for hid in router_ids:
        depth[hid] = 0
        queue.append(hid)
    while queue:
        cur = queue.popleft()
        for nxt in adjacency[cur]:
            if nxt not in depth:
                depth[nxt] = depth[cur] + 1
                queue.append(nxt)

    def resolve_depth(h: Host, _seen=None) -> int:
        if h.id in depth:
            return depth[h.id]
        _seen = _seen or set()
        if h.id in _seen:
            return 1  # cycle guard — shouldn't happen, but never loop forever
        _seen.add(h.id)
        if h.parent_host_id and h.parent_host_id in host_map:
            return resolve_depth(host_map[h.parent_host_id], _seen) + 1
        return 1 if tiers[h.id] == "physical" else 2

    for h in hosts:
        if h.id not in depth:
            depth[h.id] = resolve_depth(h)

    nodes = []
    for h in hosts:
        label = h.hostname or h.snmp_sysname or h.ip_address or h.virt_id
        nodes.append({
            "id": str(h.id),
            "label": label,
            "ip": h.ip_address,
            "type": h.device_type or "unknown",
            "tier": tiers[h.id],
            "depth": depth[h.id],
            "virt_type": h.virt_type,
            "parent_host_id": str(h.parent_host_id) if h.parent_host_id else None,
            "is_up": h.is_up,
            "os": h.os_name,
            "vendor": h.vendor,
            "mac": h.mac_address,
            "network_id": h.network_id,
            "map_x": h.map_x,
            "map_y": h.map_y,
        })

    edges = (
        [{"id": lid, "source": str(s), "target": str(t), "type": ltype, "source_iface": si, "target_iface": ti}
         for lid, s, t, ltype, si, ti in manual_edges]
        + [{"id": eid, "source": str(s), "target": str(t), "type": "inferred"} for eid, s, t in inferred_edges]
        + [{"id": eid, "source": str(s), "target": str(t), "type": "virt"} for eid, s, t in virt_edges]
    )

    return {"nodes": nodes, "edges": edges}
