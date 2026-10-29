#!/usr/bin/env bash
# Opens a pull request from a cloud session (CLOUD-1). The cloud's GitHub proxy refuses GraphQL, so `gh pr create` fails there
# (403); this uses the REST API instead and prints the PR's address.
#   bash tools/cloud-pr.sh --title "fix(x): … [PRD-ID]" --body-file <file> [--head <branch>] [--base main] [--dry-run]
# --head defaults to the current branch, which must already be pushed. It only opens the PR: it never merges and never turns on
# auto-merge or Auto-fix; the local lead does that (CLAUDE.md "In a cloud session"). If the branch already has an open PR, it
# prints that one instead of opening a second. --dry-run prints the request and touches nothing (no git or network calls).
set -u
REPO="techaust/techaust_platform"
usage() {
  echo "Usage: bash tools/cloud-pr.sh --title <title> --body-file <file> [--head <branch>] [--base main] [--dry-run]" >&2
  exit 2
}
TITLE="" BODY_FILE="" HEAD="" BASE="main" DRY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --title) [ $# -ge 2 ] || usage; TITLE="$2"; shift 2 ;;
    --body-file) [ $# -ge 2 ] || usage; BODY_FILE="$2"; shift 2 ;;
    --head) [ $# -ge 2 ] || usage; HEAD="$2"; shift 2 ;;
    --base) [ $# -ge 2 ] || usage; BASE="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    *) usage ;;
  esac
done
[ -n "$TITLE" ] && [ -n "$BODY_FILE" ] || usage
[ -s "$BODY_FILE" ] || { echo "cloud-pr: the body file '$BODY_FILE' is missing or empty" >&2; exit 2; }
if [ -z "$HEAD" ]; then
  HEAD="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
  [ -n "$HEAD" ] && [ "$HEAD" != "HEAD" ] || { echo "cloud-pr: not on a branch; pass --head <branch>" >&2; exit 2; }
fi
case "$HEAD" in main | master) echo "cloud-pr: refusing to open a PR from '$HEAD'" >&2; exit 2 ;; esac
[ "$HEAD" != "$BASE" ] || { echo "cloud-pr: head and base are both '$HEAD'" >&2; exit 2; }

if [ -n "$DRY" ]; then
  echo "dry run: POST repos/$REPO/pulls head=$HEAD base=$BASE title=$TITLE body=<$BODY_FILE, $(wc -c <"$BODY_FILE") bytes>"
  exit 0
fi

# The branch must be on GitHub, at the commit checked out here when it is the current branch. The exact ref: a bare name would
# also match other branches ending in it (fix/x matches feature/fix/x).
remote="$(git ls-remote origin "refs/heads/$HEAD" 2>/dev/null | cut -f1)"
[ -n "$remote" ] || { echo "cloud-pr: origin has no branch '$HEAD'; push it first (git push -u origin $HEAD)" >&2; exit 1; }
if [ "$HEAD" = "$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" ] && [ "$remote" != "$(git rev-parse HEAD)" ]; then
  echo "cloud-pr: origin/$HEAD is not at your last commit; push first" >&2
  exit 1
fi

existing="$(gh api "repos/$REPO/pulls?head=${REPO%%/*}:$HEAD&base=$BASE&state=open" --jq '.[0].html_url // empty')" || exit 1
if [ -n "$existing" ]; then
  echo "$existing"
  echo "cloud-pr: an open PR already exists for $HEAD; nothing opened" >&2
  exit 0
fi
gh api --method POST "repos/$REPO/pulls" -f "head=$HEAD" -f "base=$BASE" -f "title=$TITLE" -F "body=@$BODY_FILE" \
  --jq '.html_url'
