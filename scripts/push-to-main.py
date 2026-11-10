#!/usr/bin/env python3
"""Push the brainrun working tree to GitHub `main` via the git database API.

Only writes files -- it never runs `git` and never touches a local clone.
Flow: create blob (per file) -> create tree (bottom-up) -> create commit
-> create/update ref refs/heads/main.

Usage (run from the repo root):
    python3 scripts/push-to-main.py            # dry run: list what would be pushed
    python3 scripts/push-to-main.py --yes      # actually push
    python3 scripts/push-to-main.py --yes --message "Phase 5: acceptance + Pages"

Rules:
  * File list comes from walking the working tree and applying the root
    .gitignore (same patterns the repo itself uses). Raw TVB data, node_modules,
    .venv, build outputs and logs are never pushed.
  * First push: `main` does not exist yet, so the commit is created with no
    parents and the ref is created. Later pushes use the current main SHA as
    the parent commit (and refuse if main moved since the script read it --
    re-run instead of force-pushing).
  * Auth reuses the stored custom.github credential exactly like
    ~/workspace/skills/github/bin/gh-api.py (dynamic_credentials surrogate).
    Credentials are never printed or written to disk.
  * Default is dry-run. Nothing is sent to GitHub without --yes.
"""
import argparse
import base64
import fnmatch
import json
import os
import sys
import urllib.error
import urllib.request

REPO = "abwoo/brainrun"
BRANCH = "main"
BASE = "https://api.github.com"

# Candidate locations of the dynamic_credentials helper (same as gh-api.py).
for _p in ("/opt/hatch/skills/skill-creator/bin",
           "/opt/muse/skills/custom-connector-setup/bin"):
    if os.path.isdir(_p) and _p not in sys.path:
        sys.path.insert(0, _p)
import dynamic_credentials as dc  # noqa: E402

CREDENTIAL_NAME = "custom.github"
ALLOWED_HOSTS = ["api.github.com"]


# ---------------------------------------------------------------- gitignore
def load_gitignore(root):
    patterns = []
    path = os.path.join(root, ".gitignore")
    if not os.path.exists(path):
        return patterns
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line or line.startswith("#"):
                continue
            negated = line.startswith("!")
            if negated:
                line = line[1:]
            anchored = line.startswith("/")
            if anchored:
                line = line[1:]
            dir_only = line.endswith("/")
            if dir_only:
                line = line[:-1]
            patterns.append((line, negated, anchored, dir_only))
    return patterns


def _match_one(pattern, rel, anchored):
    """Match one gitignore pattern against a repo-relative path."""
    if "/" not in pattern:
        # Unanchored bare name: matches any path component.
        return any(fnmatch.fnmatchcase(part, pattern) for part in rel.split("/"))
    if anchored:
        return fnmatch.fnmatchcase(rel, pattern) or fnmatch.fnmatchcase(rel, pattern + "/*")
    # Unanchored pattern with a slash: match against the tail of the path.
    parts = rel.split("/")
    for i in range(len(parts)):
        if fnmatch.fnmatchcase("/".join(parts[i:]), pattern):
            return True
    return False


def is_ignored(rel, patterns, is_dir):
    ignored = False
    for pattern, negated, anchored, dir_only in patterns:
        if dir_only and not is_dir:
            # A dir-only pattern also ignores everything under that dir.
            if _match_one(pattern, rel, anchored):
                ignored = not negated
            continue
        if _match_one(pattern, rel, anchored):
            ignored = not negated
    return ignored


def collect_files(root, patterns):
    """Walk the tree, return {rel_posix_path: absolute_path} for files to push."""
    out = {}
    for dirpath, dirnames, filenames in os.walk(root):
        rel_dir = os.path.relpath(dirpath, root)
        if rel_dir == ".":
            rel_dir = ""
        # Prune ignored / hidden dirs first (never descend into them).
        keep_dirs = []
        for d in sorted(dirnames):
            rel = f"{rel_dir}/{d}" if rel_dir else d
            if d == ".git" or d.startswith(".") and d not in (".github",):
                # Keep .github (workflows); drop other dot-dirs (.venv is
                # gitignored anyway, but never walk it).
                if d != ".github":
                    continue
            if is_ignored(rel, patterns, is_dir=True):
                continue
            keep_dirs.append(d)
        dirnames[:] = keep_dirs
        for name in sorted(filenames):
            rel = f"{rel_dir}/{name}" if rel_dir else name
            if is_ignored(rel, patterns, is_dir=False):
                continue
            out[rel.replace(os.sep, "/")] = os.path.join(dirpath, name)
    return out


# ------------------------------------------------------------------- API
def api(method, path, body=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    if data:
        req.add_header("Content-Type", "application/json")
    dc.add_surrogate_to_request(req, CREDENTIAL_NAME, allowed_hosts=ALLOWED_HOSTS)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = dc.read_response_body(resp)
            return json.loads(payload) if payload else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:500]
        raise RuntimeError(f"{method} {path} -> HTTP {exc.code}: {detail}") from exc


def build_trees(files):
    """Create blobs + nested trees bottom-up. Returns the root tree SHA."""
    blob_sha = {}
    for rel, abspath in sorted(files.items()):
        with open(abspath, "rb") as f:
            content = base64.b64encode(f.read()).decode()
        resp = api("POST", f"/repos/{REPO}/git/blobs",
                   {"content": content, "encoding": "base64"})
        blob_sha[rel] = resp["sha"]
        print(f"  blob {rel} ({resp['sha'][:7]})")

    # Group entries by directory, deepest first.
    dirs = {}
    for rel in files:
        parent = os.path.dirname(rel)
        mode = "100755" if rel.endswith(".sh") or os.access(files[rel], os.X_OK) else "100644"
        dirs.setdefault(parent, []).append(
            {"path": os.path.basename(rel), "mode": mode, "type": "blob", "sha": blob_sha[rel]})
        # Register every ancestor dir as a tree, even when it holds no files
        # directly. Without this, pure intermediate dirs (crates/, tests/,
        # .github/, reference/) are never added as subtrees and their whole
        # contents silently drop out of the pushed tree.
        parts = parent.split("/") if parent else []
        for i in range(1, len(parts)):
            dirs.setdefault("/".join(parts[:i]), [])

    def tree_sha_for(directory):
        entries = list(dirs.get(directory, []))
        for sub in sorted(d for d in dirs if os.path.dirname(d) == directory and d):
            entries.append({"path": os.path.basename(sub), "mode": "040000",
                            "type": "tree", "sha": tree_sha_for(sub)})
        resp = api("POST", f"/repos/{REPO}/git/trees", {"tree": entries})
        return resp["sha"]

    return tree_sha_for("")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--yes", action="store_true", help="actually push (default is dry run)")
    ap.add_argument("--message", default="Brain Physics Playground: push working tree to main")
    args = ap.parse_args()

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    patterns = load_gitignore(root)
    files = collect_files(root, patterns)
    total = sum(os.path.getsize(p) for p in files.values())
    print(f"{len(files)} files, {total / 1024:.0f} KiB, to push to {REPO}@{BRANCH}")
    for rel in sorted(files):
        print(f"  {rel} ({os.path.getsize(files[rel])} B)")

    # Safety: raw TVB data must never be in the push list.
    banned = [r for r in files if r.startswith("scripts/prepare-brain-data/raw/")]
    if banned:
        print(f"ABORT: raw TVB data in push list: {banned}", file=sys.stderr)
        return 2

    if not args.yes:
        print("\nDry run only. Re-run with --yes to push.")
        return 0

    parent_sha = None
    try:
        ref = api("GET", f"/repos/{REPO}/git/ref/heads/{BRANCH}")
        parent_sha = ref["object"]["sha"]
        print(f"main currently at {parent_sha[:7]}; using it as parent commit")
    except RuntimeError as exc:
        # Empty repo: GitHub answers GET ref with 409 "Git Repository is
        # empty" rather than 404. Both mean main does not exist yet.
        if "HTTP 404" not in str(exc) and "Git Repository is empty" not in str(exc):
            raise
        print("main does not exist yet; first push will create it with no parents")

    tree_sha = build_trees(files)
    parents = [parent_sha] if parent_sha else []
    commit = api("POST", f"/repos/{REPO}/git/commits",
                 {"message": args.message, "tree": tree_sha, "parents": parents})
    print(f"commit {commit['sha'][:7]} created")
    if parent_sha:
        # NB: update-a-reference uses plural /git/refs/ (get uses singular
        # /git/ref/); singular here 404s.
        api("PATCH", f"/repos/{REPO}/git/refs/heads/{BRANCH}",
            {"sha": commit["sha"], "force": False})
        print(f"main updated to {commit['sha'][:7]}")
    else:
        api("POST", f"/repos/{REPO}/git/refs",
            {"ref": f"refs/heads/{BRANCH}", "sha": commit["sha"]})
        print(f"main created at {commit['sha'][:7]}")
    print(f"Done. Site deploys via Actions to https://abwoo.github.io/brainrun/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
