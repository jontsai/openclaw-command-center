# Pre-commit Checks

Automated enforcement of rules from `AGENTS.md` and `CONTRIBUTING.md`.

## Checks

| Check             | Rule Source           | Description                                          |
| ----------------- | --------------------- | ---------------------------------------------------- |
| `version-sync.sh` | CONTRIBUTING.md       | Ensures `package.json` and `SKILL.md` versions match |
| `no-user-data.sh` | public/data/AGENTS.md | Blocks commits of user-specific data files           |
| `no-secrets.sh`   | AGENTS.md             | Scans for accidentally committed secrets             |

## Adding New Checks

1. Create a new script in `scripts/checks/` named `<check-name>.sh`
2. Script must:
   - Accept repo root as first argument (`$1`)
   - Exit `0` on success
   - Exit `1` on failure
   - Print clear error messages when failing
3. Make it executable: `chmod +x scripts/checks/<check-name>.sh`

## Running Manually

```bash
# Run all checks
./scripts/pre-commit

# Run individual check
./scripts/checks/version-sync.sh .
```

## Installing the Hook

```bash
make install-hooks
# or manually:
cp scripts/pre-commit .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

## Bypassing (Not Recommended)

```bash
git commit --no-verify
```

Only use this if you understand why the check is failing and have a valid reason to bypass.
