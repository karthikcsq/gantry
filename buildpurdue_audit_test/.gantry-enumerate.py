#!/usr/bin/env python3
"""Enumerate TS/TSX/JS function definitions. Outputs JSONL."""
import json, os, re, sys
from pathlib import Path

ROOT = Path(".")
SKIP_DIRS = {"node_modules", ".next", ".git", "dist", "build", "out", ".venv",
             "coverage", ".planning", "public", "supabase", "prisma/migrations",
             "generated", ".claude"}
SKIP_FILE_PARTS = [".test.", ".spec.", "__tests__", "/tests/", "/test/"]
SOURCE_DIRS = ["src", "scripts", "utils", "lib"]  # we'll scan src + scripts mainly
EXTS = {".ts", ".tsx", ".js", ".mjs"}

def should_skip(path: str) -> bool:
    p = path.replace("\\", "/")
    for d in SKIP_DIRS:
        if f"/{d}/" in f"/{p}" or p.startswith(d + "/") or p == d:
            return True
    for s in SKIP_FILE_PARTS:
        if s in p:
            return True
    if p.endswith(".d.ts"):
        return True
    return False

# Patterns capturing the function NAME at end of match
# We capture position then compute LOC by finding matching brace.
PATTERNS = [
    # export? async? function NAME(
    re.compile(r"(?:^|\n)\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*[<(]"),
    # export? const NAME = async? (...) =>   or  = function
    re.compile(r"(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=;]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=>"),
    re.compile(r"(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=;]+)?=\s*(?:async\s*)?function\b"),
    # class method:  async? NAME(...) {  — restrict to clearly method-like with body
    re.compile(r"(?:^|\n)[ \t]+(?:public\s+|private\s+|protected\s+|static\s+|readonly\s+)*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{;]+)?\s*\{"),
]

# Words that are NOT functions even if they pattern-match (control flow, type guards)
BLACKLIST = {"if","for","while","switch","catch","return","function","constructor",
             "do","else","case","default","try","finally","new","typeof","class",
             "interface","type","enum","namespace","import","export","from","as",
             "in","of","await","async","yield","throw","void","null","undefined",
             "true","false","this","super"}

def find_matching_brace(text: str, start_idx: int) -> int:
    """Given index of '{', return index of matching '}'. Naive (no comment/string awareness)."""
    depth = 0
    i = start_idx
    in_string = None
    in_line_comment = False
    in_block_comment = False
    while i < len(text):
        c = text[i]
        nxt = text[i+1] if i+1 < len(text) else ""
        if in_line_comment:
            if c == "\n":
                in_line_comment = False
        elif in_block_comment:
            if c == "*" and nxt == "/":
                in_block_comment = False
                i += 1
        elif in_string:
            if c == "\\":
                i += 1  # skip escape
            elif c == in_string:
                in_string = None
            elif in_string == "`" and c == "$" and nxt == "{":
                # template literal expression — naive: treat as code w/ depth tracking
                depth += 1
                i += 1
        else:
            if c == "/" and nxt == "/":
                in_line_comment = True
                i += 1
            elif c == "/" and nxt == "*":
                in_block_comment = True
                i += 1
            elif c in ('"', "'", "`"):
                in_string = c
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return i
        i += 1
    return -1

def loc_for_match(text: str, name_end: int) -> int:
    """Find body LOC starting at first '{' or arrow body after name_end."""
    # find next '{' or '=>' followed by something
    # cheap heuristic: find first '{' within ~400 chars
    window = text[name_end:name_end+800]
    brace_rel = window.find("{")
    arrow_rel = window.find("=>")
    if arrow_rel != -1 and (brace_rel == -1 or arrow_rel < brace_rel):
        # arrow expr — body may be expression or brace
        after_arrow = name_end + arrow_rel + 2
        # skip whitespace
        j = after_arrow
        while j < len(text) and text[j] in " \t\n":
            j += 1
        if j < len(text) and text[j] == "{":
            end = find_matching_brace(text, j)
            if end == -1: return 1
            body = text[j:end+1]
            return body.count("\n")
        else:
            # single-expr arrow
            return 1
    elif brace_rel != -1:
        j = name_end + brace_rel
        end = find_matching_brace(text, j)
        if end == -1: return 1
        body = text[j:end+1]
        return body.count("\n")
    return 1

def line_of(text: str, idx: int) -> int:
    return text.count("\n", 0, idx) + 1

def signature(text: str, name_end: int) -> str:
    """Capture signature up to first '{' or '=>' (max 250 chars)."""
    snippet = text[max(0, name_end-80):name_end+250]
    # cut at first '{' or '=>'
    cut = len(snippet)
    for marker in ["{", "=>"]:
        idx = snippet.find(marker)
        if idx != -1 and idx < cut:
            cut = idx
    sig = snippet[:cut].strip()
    # collapse whitespace
    sig = re.sub(r"\s+", " ", sig)
    return sig[-220:]

def enumerate_file(path: Path):
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return []
    results = []
    seen = set()  # (name, line) to dedupe
    for pat_idx, pat in enumerate(PATTERNS):
        for m in pat.finditer(text):
            name = m.group(1)
            if name in BLACKLIST:
                continue
            # for method pattern (idx 3) skip when name is a JSX-ish single uppercase keyword or built-in
            name_end = m.end(1)
            # find paren / generic
            # determine roughly the body start
            # For method pattern, opening '{' is in match — find its position via search.
            loc = loc_for_match(text, name_end)
            ln = line_of(text, m.start(1))
            key = (name, ln)
            if key in seen:
                continue
            seen.add(key)
            sig = signature(text, name_end)
            results.append({
                "file": str(path).replace("\\","/"),
                "name": name,
                "line": ln,
                "loc": loc,
                "sig": sig,
                "pattern": pat_idx,
            })
    return results

def main():
    all_funcs = []
    for root_dir in SOURCE_DIRS:
        if not Path(root_dir).exists():
            continue
        for path in Path(root_dir).rglob("*"):
            if not path.is_file():
                continue
            if path.suffix not in EXTS:
                continue
            if should_skip(str(path)):
                continue
            all_funcs.extend(enumerate_file(path))
    with open(".gantry-functions.jsonl", "w", encoding="utf-8") as f:
        for fn in all_funcs:
            f.write(json.dumps(fn) + "\n")
    print(f"TOTAL_FUNCTIONS={len(all_funcs)}")
    print("FIRST_5:")
    for fn in all_funcs[:5]:
        print(json.dumps(fn))

if __name__ == "__main__":
    main()
