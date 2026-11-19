#!/usr/bin/env python3
"""Push the bench-simplify working tree to the fix/bench-simplify-main-view branch.

Same git-database API approach as ~/workspace/brainrun/scripts/push-to-main.py
(blob -> tree -> commit -> update ref). The target branch is created at the
base commit (main 3b33a7f) on first push if it does not exist yet; this script
never touches main, never merges, never opens a PR.

Usage (run from the repo root):
    python3 scripts/push-to-bench-simplify.py                  # dry run: list files
    python3 scripts/push-to-bench-simplify.py --yes            # actually push
    python3 scripts/push-to-bench-simplify.py --yes --message "Bench main-view simplification: ..."

Rules:
  * File list comes from walking the working tree and applying the root
    .gitignore (same as push-to-main.py). Raw TVB data, .local-assets
    (unreviewed fsaverage derivatives), node_modules, .venv, build outputs
    and logs are never pushed.
  * Default is dry-run: lists files only. Nothing is sent to GitHub
    without --yes.
  * Parent commit is the branch's current head on GitHub. The push is
    refused if that head does not match the local clone's HEAD (pass
    --expected-head to override the expectation explicitly).
  * main is never written, but its SHA is read before and after building
    the commit; the push is refused if main moved in between, so a
    rebase/merge-base surprise is caught instead of silently pushed over.
  * Auth reuses the stored custom.github credential exactly like
    ~/workspace/skills/github/bin/gh-api.py (dynamic_credentials surrogate).
    Credentials are never printed or written to disk. This script never
    runs `git push` and never shells out with a credential.
"""
import argparse
import importlib.util
import os
import subprocess
import sys

REPO = "abwoo/brainrun"
BRANCH = "fix/bench-simplify-main-view"
BASE_BRANCH = "main"
BASE_SHA = "3b33a7fa740b4c00a44416799d8fda81df8b21ef"

# Extra safety: never push these even if .gitignore ever stops excluding them.
BANNED_PREFIXES = (
    "scripts/prepare-brain-data/raw/",
    ".local-assets/",
    "app/public/forward-assets/",
    "app/public/brain-assets/",
)


def load_push_to_main():
    here = os.path.dirname(os.path.abspath(__file__))
    spec = importlib.util.spec_from_file_location(
        "push_to_main", os.path.join(here, "push-to-main.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def local_head(root):
    """Local clone HEAD SHA (read-only `git rev-parse`; no push involved)."""
    out = subprocess.run(
        ["git", "-C", root, "rev-parse", "HEAD"],
        capture_output=True, text=True, check=True)
    return out.stdout.strip()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--yes", action="store_true",
                    help="actually push (default is dry run)")
    ap.add_argument("--message", default="Bench main-view simplification: protocol buttons, one status line, diagnostics toggle, no unconfirmed marks",
                    help="commit message for the push")
    ap.add_argument("--expected-head", default="",
                    help="expected current head SHA of the branch "
                         "(default: local clone HEAD)")
    args = ap.parse_args()

    ptm = load_push_to_main()
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    patterns = ptm.load_gitignore(root)
    files = ptm.collect_files(root, patterns)
    # Linked worktrees carry .git as a file (not a directory), so the
    # collector's .git-dir prune misses it; never push the pointer file.
    files.pop(".git", None)
    total = sum(os.path.getsize(p) for p in files.values())
    print(f"{len(files)} files, {total / 1024:.0f} KiB, to push to "
          f"{REPO}@{BRANCH}")
    for rel in sorted(files):
        print(f"  {rel} ({os.path.getsize(files[rel])} B)")

    banned = [r for r in files if r.startswith(BANNED_PREFIXES)]
    if banned:
        print(f"ABORT: forbidden paths in push list: {banned}", file=sys.stderr)
        return 2

    expected_head = args.expected_head or local_head(root)
    print(f"Local HEAD (expected branch head): {expected_head[:7]}")

    if not args.yes:
        print("\nDry run only. Re-run with --yes to push to "
              f"{REPO}@{BRANCH} (parent = branch head {expected_head[:7]}).")
        return 0

    # Parent: the branch's current head on GitHub; create the branch at the
    # base commit first if it does not exist yet.
    try:
        ref = ptm.api("GET", f"/repos/{REPO}/git/ref/heads/{BRANCH}")
        parent_sha = ref["object"]["sha"]
        print(f"{BRANCH} currently at {parent_sha[:7]}")
    except RuntimeError as exc:
        if "HTTP 404" not in str(exc):
            raise
        print(f"{BRANCH} does not exist yet; creating it at base {BASE_SHA[:7]}")
        ptm.api("POST", f"/repos/{REPO}/git/refs",
                {"ref": f"refs/heads/{BRANCH}", "sha": BASE_SHA})
        parent_sha = BASE_SHA
    if parent_sha != expected_head:
        print(f"ABORT: branch head {parent_sha[:7]} != expected "
              f"{expected_head[:7]}; re-run after syncing the local clone",
              file=sys.stderr)
        return 2

    # main is never written, but guard against it moving mid-push.
    main_before = ptm.api("GET", f"/repos/{REPO}/git/ref/heads/{BASE_BRANCH}")
    main_before_sha = main_before["object"]["sha"]
    print(f"{BASE_BRANCH} currently at {main_before_sha[:7]}; "
          "will re-check before updating the branch ref")

    tree_sha = ptm.build_trees(files)
    commit = ptm.api("POST", f"/repos/{REPO}/git/commits",
                     {"message": args.message, "tree": tree_sha,
                      "parents": [parent_sha]})
    print(f"commit {commit['sha'][:7]} created")

    main_after = ptm.api("GET", f"/repos/{REPO}/git/ref/heads/{BASE_BRANCH}")
    if main_after["object"]["sha"] != main_before_sha:
        print(f"ABORT: {BASE_BRANCH} moved during push "
              f"({main_before_sha[:7]} -> {main_after['object']['sha'][:7]}); "
              f"commit {commit['sha'][:7]} was created but the branch ref "
              "was NOT updated — re-run the script", file=sys.stderr)
        return 2

    # NB: update-a-reference uses plural /git/refs/ (get uses singular
    # /git/ref/); singular here 404s.
    ptm.api("PATCH", f"/repos/{REPO}/git/refs/heads/{BRANCH}",
            {"sha": commit["sha"], "force": False})
    print(f"{BRANCH} updated to {commit['sha'][:7]} "
          f"(parent was {parent_sha[:7]}, {BASE_BRANCH} unchanged at "
          f"{main_before_sha[:7]})")
    print(f"Done. Branch {BRANCH} updated; open a Draft PR at https://github.com/{REPO}/compare/main...{BRANCH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
