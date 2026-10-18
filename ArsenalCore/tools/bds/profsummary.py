"""CPU プロファイル（tools/bds/debugclient.mjs が書いた capture.cpuprofile）の要約：関数ごとの自己時間と、長かった区間

  python3 tools/bds/profsummary.py <capture.cpuprofile> [件数]
"""
import collections
import json
import os
import sys

f = sys.argv[1]
top = int(sys.argv[2]) if len(sys.argv) > 2 else 25
d = json.load(open(f))
nodes = {n["id"]: n for n in d["nodes"]}
parent = {}
for n in d["nodes"]:
    for c in n.get("children", []):
        parent[c] = n["id"]


def name(n):
    cf = n["callFrame"]
    return f"{cf['functionName'] or '(anon)'} {os.path.basename(cf.get('url', ''))}:{cf.get('lineNumber', 0) + 1}"


samples, deltas = d.get("samples", []), d.get("timeDeltas", [])
self_t = collections.Counter()
total_t = collections.Counter()
for s, dt in zip(samples, deltas):
    self_t[name(nodes[s])] += dt
    seen = set()
    n = s
    while n in nodes:
        k = name(nodes[n])
        if k not in seen:
            total_t[k] += dt
            seen.add(k)
        n = parent.get(n)
tot = sum(self_t.values()) or 1
print(f"合計 {tot / 1000:.1f} ms・サンプル {len(samples)}")
print("自己時間：")
for k, v in self_t.most_common(top):
    print(f"  {v / 1000:9.1f} ms {100 * v / tot:5.1f}%  {k}")
print("累積時間（子を含む）：")
for k, v in total_t.most_common(top):
    print(f"  {v / 1000:9.1f} ms {100 * v / tot:5.1f}%  {k}")
