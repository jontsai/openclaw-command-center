# Release preparation and publication

## Candidate pairing

Command Center **1.5.0** and Spacesuit **0.4.0** are independent versions,
prepared for review, not evidence of registry publication. Both use the existing
v1 snapshot contracts. Command Center's native session explorer works without
Spacesuit; Spacesuit supplies optional workspace conventions, flavors and tracker
snapshot compilers. Do not copy one operator's runtime data into a package.

## Versions

SemVer permits prerelease suffixes: `1.5.0-rc.1` and `0.4.0-rc.1` are valid and
sort below their corresponding stable releases. An RC is optional; use one only
when distributing an explicitly prerelease candidate. All metadata must agree.
Promoting an RC means publishing a **new** stable version, not editing an already
published artifact. See <https://semver.org/>.

## Review and artifact gate

1. Prepare metadata and changelog changes in a PR. Review the complete outgoing
   artifact and metadata for private data. Run the repository test/build checks.
2. Commit the reviewed files, then validate and export tracked files only:

   ```sh
   bash scripts/release.sh 1.5.0
   bash scripts/release.sh 1.5.0 --stage /absolute/new/staging-directory
   ```

   The destination must not exist and must be outside the checkout. The source
   must have no tracked modifications. Ignored/untracked runtime files are not
   copied. The command **never commits, tags, pushes or publishes**.

3. Test the staged artifact, not only the developer checkout. Exercise fresh
   installation, existing-workspace preservation, upgrade and rollback. For
   Command Center, build before committing so `lib/server.js` matches source;
   test with an explicit disposable workspace/profile and unused loopback port.
4. Test a registry-shaped copy too: ClawHub may omit extensionless files and
   executable modes. A local filtered-copy test is not proof of registry upload
   or download behavior. Verify the actual published download before broad use.

## Separate publication gate

After human approval and verified merge, select the exact reviewed commit and
repeat staging from a clean checkout. Publication needs explicit maintainer
intent; merging this preparation PR does not publish a package. Independently:

- Create and push the matching `v1.5.0` tag at that commit, when publishing GitHub
  releases. Review any tag-triggered workflow first.
- Use the authenticated ClawHub CLI to publish the **staging directory**, with the
  package's existing slug and matching version. Do not publish the workspace or
  an arbitrary checkout with local runtime files.
- Read back release metadata, install that exact version into a disposable
  directory, and repeat the package smoke checks. Record commit, version and
  artifact provenance. Keep the previous version available for rollback.

## Scope and known limits

The operations explorer is bounded snapshot browsing with progressive rendering,
not server-paginated graph exploration, automatic semantic clustering or live
tracker synchronization. Optional connectors need separate configuration. A
session-summary failure can still occur; metadata remains browsable but this
release does not promise every summary backend works. Historical privacy cleanup
is not accomplished by publishing new assets. The separate session-explorer PR
is not implicitly included by this version bump.

## Spacesuit installation and rollback

Use Bash 4+ explicitly (the default macOS Bash 3 is unsupported), and Node 18+
for snapshot/release helpers. Command Center also needs Node 18+, but the installed
OpenClaw runtime may require a newer Node; satisfy both requirements.

```sh
bash scripts/install.sh --workspace /absolute/disposable-workspace
bash scripts/upgrade.sh --workspace /absolute/workspace --dry-run
bash scripts/upgrade.sh --workspace /absolute/workspace
```

For registry installs, `version.txt` provides the version even if `VERSION` and
`Makefile` are omitted. Shell commands do not require preserved executable bits.
Install preserves existing files and an existing version tracker. Upgrade edits
only valid managed sections; unmarked files stay untouched. For deliberate
migration, review `--dry-run --adopt-unmarked` before applying `--adopt-unmarked`.
Malformed markers and symlinked managed targets are rejected before writes.

Each modifying upgrade records prior changed files and version under the printed
`.spacesuit-backups/upgrade.*` directory. To roll back, stop concurrent workspace
editing, inspect that exact backup and restore its saved files to their matching
workspace paths. Restore `.spacesuit-version` too; if the backup contains
`.version-was-absent`, remove only the newly created version tracker instead.
Compare restored bytes with the backup. This is a file backup, not a transactional
filesystem snapshot; retain it until the upgrade is verified. No gateway restart
is performed by either installer.
