# Core CI

`.github/workflows/ci.yml` runs on pull requests targeting `main` (including
new commits) and pushes to `main`. The single job is named `noema/core`.
It uses Ubuntu and Node.js 24, installs locked dependencies with
`npm ci --ignore-scripts`, runs `npm run build` (including styles and typechecks),
and runs the existing exhaustive `npm run test:all` discovery and TAP reporter.
Superseded runs for the same PR or branch are cancelled; the timeout is 15 minutes.

Step logs retain build errors, test failures and explicit platform skip reasons.
The job summary shows phase outcomes, TAP totals and skip lines. A successful
Linux job does not validate skipped macOS native behavior. CI uses synthetic test
fixtures and requires no API keys or real vault data.

## Required check: manual repository setting

Workflow execution alone does **not** enforce merging restrictions. During setup,
the GitHub connection could read an empty repository ruleset list and `main` was
reported unprotected, but the branch-protection endpoint returned HTTP 403
`Resource not accessible by integration`. The connection has no administration
capability to configure protection; no protection settings were changed.

An administrator must open **Settings → Branches → Add branch protection rule**
(or edit the existing exact `main` rule if one has since been added):

1. Branch name pattern: `main`.
2. Enable **Require status checks to pass before merging**.
3. Add the exact check **`noema/core`**, from **GitHub Actions**, after its first
   completed PR run. Use the emitted check name, not `CI / noema/core`.
4. Enable **Do not allow bypassing the above settings** so administrators also
   cannot merge while the required check is pending or failing.
5. Add no review or approval requirements. Preserve all unrelated existing rules;
   do not enable force pushes or deletions. This phase does not require branches
   to be up to date before merging.

Proposed delta from the observed unprotected state: protect `main` with the single
required `noema/core` check, apply it to administrators, and add zero review
requirements. Obtain action-time confirmation before applying this setting.
Each new PR commit automatically starts a new run through `pull_request`
`synchronize`; GitHub must receive success for the latest commit before merging.
