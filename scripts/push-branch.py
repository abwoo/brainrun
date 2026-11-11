#!/usr/bin/env python3
"""Push the brainrun working tree to a NEW branch and open a PR against main.

Same git-database API approach as scripts/push-to-main.py (blob -> tree ->
commit -> create ref), but the target is refs/heads/<branch> with main's
current SHA as parent, and it then opens a pull request (head=<branch>,
base=main). Never touches main, never merges.

Usage (run from the repo root):
    python3 scripts/push-branch.py --branch pr1-science-compliance --yes
    python3 scripts/push-branch.py --branch <name> --yes \
        --title "PR1: ..." --body-file /tmp/pr-body.md

Rules:
  * File list comes from walking the working tree and applying the root
    .gitignore (same as push-to-main.py). Raw TVB data, node_modules,
    .venv, build outputs and logs are never pushed.
  * Default is dry-run: lists files and the PR that would be opened.
    Nothing is sent to GitHub without --yes.
  * Refuses if the branch already exists (re-run with a new name or delete
    the branch first); refuses if main moved since the script read it.
  * Auth reuses the stored custom.github credential exactly like
    ~/workspace/skills/github/bin/gh-api.py (dynamic_credentials surrogate).
"""
import argparse
import importlib.util
import os
import sys

REPO = "abwoo/brainrun"
BASE_BRANCH = "main"


def load_push_to_main():
    here = os.path.dirname(os.path.abspath(__file__))
    spec = importlib.util.spec_from_file_location(
        "push_to_main", os.path.join(here, "push-to-main.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--branch", required=True, help="new branch name to create")
    ap.add_argument("--yes", action="store_true",
                    help="actually push and open the PR (default is dry run)")
    ap.add_argument("--title", default="",
                    help="PR title (required with --yes)")
    ap.add_argument("--body-file", default="",
                    help="file holding the PR body in Markdown")
    args = ap.parse_args()

    ptm = load_push_to_main()
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    patterns = ptm.load_gitignore(root)
    files = ptm.collect_files(root, patterns)
    total = sum(os.path.getsize(p) for p in files.values())
    print(f"{len(files)} files, {total / 1024:.0f} KiB, to push to "
          f"{REPO}@{args.branch} (parent {BASE_BRANCH})")
    for rel in sorted(files):
        print(f"  {rel} ({os.path.getsize(files[rel])} B)")

    banned = [r for r in files if r.startswith("scripts/prepare-brain-data/raw/")]
    if banned:
        print(f"ABORT: raw TVB data in push list: {banned}", file=sys.stderr)
        return 2

    body = ""
    if args.body_file:
        with open(args.body_file, encoding="utf-8") as f:
            body = f.read()

    if not args.yes:
        print(f"\nDry run only. Would create branch {args.branch} from "
              f"{BASE_BRANCH} and open a PR titled: {args.title or '(no title)'}")
        return 0
    if not args.title:
        print("ABORT: --title is required with --yes", file=sys.stderr)
        return 2

    # Parent: main's current SHA.
    ref = ptm.api("GET", f"/repos/{REPO}/git/ref/heads/{BASE_BRANCH}")
    parent_sha = ref["object"]["sha"]
    print(f"{BASE_BRANCH} currently at {parent_sha[:7]}; using it as parent commit")

    # Refuse if the branch already exists.
    try:
        ptm.api("GET", f"/repos/{REPO}/git/ref/heads/{args.branch}")
        print(f"ABORT: branch {args.branch} already exists", file=sys.stderr)
        return 2
    except RuntimeError as exc:
        if "HTTP 404" not in str(exc):
            raise

    tree_sha = ptm.build_trees(files)
    commit = ptm.api("POST", f"/repos/{REPO}/git/commits",
                     {"message": args.title, "tree": tree_sha,
                      "parents": [parent_sha]})
    print(f"commit {commit['sha'][:7]} created")
    ptm.api("POST", f"/repos/{REPO}/git/refs",
            {"ref": f"refs/heads/{args.branch}", "sha": commit["sha"]})
    print(f"branch {args.branch} created at {commit['sha'][:7]}")
    pr = ptm.api("POST", f"/repos/{REPO}/pulls",
                 {"title": args.title, "head": args.branch,
                  "base": BASE_BRANCH, "body": body})
    print(f"PR #{pr['number']} opened: {pr['html_url']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
