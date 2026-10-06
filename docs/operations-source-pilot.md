# Source-build pilot (no registry release required)

Use a pinned reviewed revision to test Command Center under a second OS user or
OpenClaw profile. Do not point the second dashboard at the first user's workspace.
A package release is a distribution milestone, not a prerequisite for a pilot.

1. As the intended OS user, verify `node --version`, `openclaw --version`, and
   `openclaw --profile pilot sessions --agent main --limit all --json` privately.
   Use the Node version required by the installed OpenClaw runtime (which may be
   newer than Command Center's own minimum). Do not copy session output into issues.
2. Clone into a dedicated code directory. Fetch and check out an exact reviewed
   commit, not a floating development branch. Keep the existing service untouched.

   ```bash
   git clone https://github.com/jontsai/openclaw-command-center.git command-center-pilot
   cd command-center-pilot
   git fetch origin
   git checkout --detach REVIEWED_COMMIT_SHA
   npm ci
   npm test
   npm run build
   ```

   Replace `REVIEWED_COMMIT_SHA` with the full commit ID from the reviewed PR.
   The checked-in `lib/server.js` is the runtime bundle; the build above verifies
   it can be reproduced. No registry publication or install of a second skill is needed.

3. Set explicit profile, workspace, and an unused port. For example, with a
   profile named `pilot` and workspace at `$HOME/workspaces/pilot`:

   ```bash
   OPENCLAW_PROFILE=pilot \
   OPENCLAW_WORKSPACE="$HOME/workspaces/pilot" \
   COMMAND_CENTER_MODE=core HOST=127.0.0.1 PORT=3340 \
   node lib/server.js
   ```

4. Open `http://127.0.0.1:3340/operations.html`. For remote review, use an existing
   authenticated/private route or SSH forwarding, e.g.
   `ssh -L 3340:127.0.0.1:3340 pilot-host`. Do not publish real session catalogs
   through a public demo tunnel. Do not restart the OpenClaw gateway.
5. Verify session identity/counts against that profile; names, privacy filtering,
   stacks, back/reset, summary requests, cost and cron APIs, language switching,
   and the intended remote route. No tracker or Spacesuit setup is required for
   session browsing. Missing work bindings stay unassigned.
6. Only after the approved merge passes on the primary test instance, switch the
   pilot's dashboard supervisor to the reviewed build. Record the previous commit
   and launch command for rollback. Stop/restart only that dashboard process.

Spacesuit is optional for native monitoring. Add it later using a separately pinned
compatible revision, with explicit profile/agent-bound snapshot selection. Do not
run its starter installer over an established workspace's instruction files.
Tracker authentication and live collection are separate setup steps.

Promote a coordinated versioned package only after clean installation, upgrade,
profile isolation and rollback have been tested. This guide does not publish a
release, enable external data integrations or authorize merging a PR.
