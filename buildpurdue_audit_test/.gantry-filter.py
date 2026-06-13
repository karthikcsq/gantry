#!/usr/bin/env python3
"""Compute cross-module import + test-ref signals; filter to load-bearing."""
import json, os, re
from pathlib import Path
from collections import defaultdict

EXTS = {".ts", ".tsx", ".js", ".mjs"}
SKIP_DIRS = {"node_modules", ".next", ".git", "dist", "build", "out", ".venv",
             "coverage", ".planning", "public", "supabase", "prisma/migrations",
             "generated", ".claude"}
TEST_MARKERS = [".test.", ".spec.", "__tests__/", "/tests/", "/test/", "/e2e/"]

def is_test(p: str) -> bool:
    p = p.replace("\\", "/")
    return any(m in p for m in TEST_MARKERS) or p.startswith("e2e/")

def should_skip_dir(p: Path) -> bool:
    parts = p.parts
    for d in SKIP_DIRS:
        if d in parts:
            return True
    if any(part == "generated" for part in parts):
        return True
    return False

# Collect all candidate source files
ROOTS = ["src", "scripts", "e2e"]
all_files = []
for r in ROOTS:
    rp = Path(r)
    if not rp.exists(): continue
    for f in rp.rglob("*"):
        if f.is_file() and f.suffix in EXTS and not should_skip_dir(f) and not f.name.endswith(".d.ts"):
            all_files.append(f)

# Build per-file: (a) set of imported names, (b) full word-tokens set (for test files)
IMPORT_BLOCK = re.compile(r"import\s+([^;]+?)\s+from\s+['\"][^'\"]+['\"]", re.MULTILINE | re.DOTALL)
NAMED_PART = re.compile(r"\{([^}]*)\}")
WORD = re.compile(r"\b[A-Za-z_$][\w$]*\b")

# Map: filepath -> set of imported names
file_imports = {}
# Map: test filepath -> set of word tokens
test_words = {}

for f in all_files:
    p = str(f).replace("\\", "/")
    try:
        text = f.read_text(encoding="utf-8", errors="replace")
    except Exception:
        continue
    names = set()
    for m in IMPORT_BLOCK.finditer(text):
        clause = m.group(1)
        # named imports {a, b as c}
        for nm in NAMED_PART.finditer(clause):
            inner = nm.group(1)
            for piece in inner.split(","):
                piece = piece.strip()
                if not piece: continue
                # handle "a as b" -> import alias is b but source name is a
                if " as " in piece:
                    src, _alias = piece.split(" as ", 1)
                    names.add(src.strip())
                else:
                    names.add(piece)
        # default import: take leading identifier before "{" or ","
        # strip out the named block
        cleaned = NAMED_PART.sub("", clause)
        for piece in cleaned.split(","):
            piece = piece.strip()
            if not piece: continue
            # handle "* as foo" -> skip (not a function name)
            if piece.startswith("*"):
                continue
            # may be like "type Foo" - keep Foo as name
            if piece.startswith("type "):
                piece = piece[5:].strip()
            # default import name
            mtok = re.match(r"^([A-Za-z_$][\w$]*)$", piece)
            if mtok:
                names.add(mtok.group(1))
    file_imports[p] = names
    if is_test(p):
        test_words[p] = set(WORD.findall(text))

# Load functions
funcs = []
with open(".gantry-functions.jsonl", encoding="utf-8") as f:
    for line in f:
        if line.strip():
            funcs.append(json.loads(line))

# Build name -> [func entries] (a name may exist in multiple files; we treat each definition separately
# but cross-module import count is per-name globally, attributing all importing files (other than defining file))
# For accuracy we count imports per (name, defining_file): files that import `name` and are not defining_file.

# Reverse map: name -> list of defining files
name_to_defs = defaultdict(list)
for fn in funcs:
    name_to_defs[fn["name"]].append(fn["file"])

# Precompute: name -> list of files that import it
name_to_importers = defaultdict(set)
for fp, names in file_imports.items():
    for nm in names:
        name_to_importers[nm].add(fp)

# Precompute: name -> count of test files that reference it
name_to_test_refs = defaultdict(int)
for tp, words in test_words.items():
    for nm in name_to_defs.keys():
        if nm in words:
            name_to_test_refs[nm] += 1

# Annotate each function
for fn in funcs:
    nm = fn["name"]
    importers = name_to_importers.get(nm, set())
    cross = sum(1 for ip in importers if ip != fn["file"])
    fn["cross_imports"] = cross
    fn["test_refs"] = name_to_test_refs.get(nm, 0)
    # combined score
    loc_cap = min(fn["loc"], 100) / 100.0
    fn["score"] = loc_cap + cross * 0.5 + fn["test_refs"] * 0.3

# Filter to load-bearing
def is_load_bearing(fn):
    return fn["loc"] > 15 or fn["cross_imports"] >= 2 or fn["test_refs"] >= 1

load_bearing = [fn for fn in funcs if is_load_bearing(fn)]

# Breakdown by which criterion(criteria) qualified
def crit_label(fn):
    labels = []
    if fn["loc"] > 15: labels.append("LOC")
    if fn["cross_imports"] >= 2: labels.append("IMP")
    if fn["test_refs"] >= 1: labels.append("TEST")
    return "+".join(labels)

breakdown = defaultdict(int)
for fn in load_bearing:
    breakdown[crit_label(fn)] += 1

# Save filtered list
with open(".gantry-load-bearing.jsonl", "w", encoding="utf-8") as f:
    for fn in load_bearing:
        f.write(json.dumps(fn) + "\n")

print(f"TOTAL_FUNCTIONS={len(funcs)}")
print(f"LOAD_BEARING={len(load_bearing)}")
print("BREAKDOWN_BY_CRITERION:")
for k, v in sorted(breakdown.items(), key=lambda x: -x[1]):
    print(f"  {k}: {v}")
top10 = sorted(load_bearing, key=lambda x: -x["score"])[:10]
print("\nTOP_10_BY_SCORE:")
for i, fn in enumerate(top10, 1):
    print(f"  {i}. {fn['file']}:{fn['line']}  {fn['name']}  "
          f"loc={fn['loc']} imp={fn['cross_imports']} tests={fn['test_refs']} score={fn['score']:.2f}")
