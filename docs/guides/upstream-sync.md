# Upstream Sync Workflow

This guide covers how to keep your fork of `openclaw-command-center` in sync with the upstream repository (`jontsai/openclaw-command-center`).

## Initial Fork Setup

After forking the repo on GitHub, clone your fork and add the upstream remote:

```bash
git clone https://github.com/YOUR_USERNAME/openclaw-command-center.git
cd openclaw-command-center

# Add the upstream remote
git remote add upstream https://github.com/jontsai/openclaw-command-center.git

# Verify remotes
git remote -v
# origin    https://github.com/YOUR_USERNAME/openclaw-command-center.git (fetch)
# origin    https://github.com/YOUR_USERNAME/openclaw-command-center.git (push)
# upstream  https://github.com/jontsai/openclaw-command-center.git (fetch)
# upstream  https://github.com/jontsai/openclaw-command-center.git (push)
```

## The "Sync Before Branch" Ritual

**Always sync before starting new work.** This prevents merge conflicts and keeps your fork's `main` branch identical to upstream.

```bash
# 1. Fetch latest upstream changes
git fetch upstream

# 2. Switch to your local main branch
git checkout main

# 3. Merge upstream/main into your local main
git merge upstream/main

# 4. Push the updated main to your fork
git push origin main
```

After syncing, create your feature branch from the up-to-date `main`:

```bash
git checkout -b feat/your-feature-name
```

## Handling Conflicts During Sync

In rare cases, if your fork's `main` has diverged from upstream:

```bash
# Option A: Fast-forward merge (preferred — no conflicts possible)
git checkout main
git fetch upstream
git reset --hard upstream/main
git push origin main --force-with-lease

# Option B: Rebase your feature branch on latest upstream
git checkout feat/your-feature
git fetch upstream
git rebase upstream/main
# Resolve any conflicts, then:
git push origin feat/your-feature --force-with-lease
```

## Automated Sync via GitHub Actions

The repository includes a scheduled workflow (`.github/workflows/upstream-sync.yml`) that:

- Runs every Monday at 09:00 UTC
- Checks if upstream has new commits
- Opens an auto-PR to merge upstream changes into the fork's `main` branch
- Can also be triggered manually via `workflow_dispatch`

This ensures the fork never falls too far behind, even if contributors forget to sync manually.

## Quick Reference

| Task | Command |
|------|---------|
| Add upstream remote | `git remote add upstream https://github.com/jontsai/openclaw-command-center.git` |
| Fetch upstream | `git fetch upstream` |
| Sync main | `git checkout main && git merge upstream/main && git push origin main` |
| Branch from synced main | `git checkout -b feat/my-feature` |
| Check remote config | `git remote -v` |
