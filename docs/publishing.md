# Publishing

This package is published to npm as `opencode-pushtodisplay` and installed by
OpenCode with:

```bash
opencode plugin add opencode-pushtodisplay@latest
```

OpenCode V2.2+ loads the package's `./src/index.ts` export directly with its Bun
runtime. There is no build step.

The release workflow is
[`.github/workflows/publish.yml`](../.github/workflows/publish.yml). It runs
`npm run check`, verifies the tarball, publishes with `--provenance`, commits the
version bump, and pushes the release tag.

## Prerequisites

- npm account with publish access to `opencode-pushtodisplay`.
- The GitHub repository is public (required for provenance).
- Node.js 24 locally, matching the workflow.

## First publish

The package does not exist on npm yet, so npm Trusted Publishing cannot be
configured until after the first publish. Choose one of these two paths.

### Option A: publish manually, then enable Trusted Publishing

```bash
npm login
npm whoami                     # must print the npm account name
npm ci
npm run check
npm pack --dry-run             # inspect the exact tarball contents
npm publish --access public    # first publish; no --provenance outside CI
npm view opencode-pushtodisplay version
```

Then, on npmjs.com under the package's **Settings → Trusted publishing**, add:

- Provider: GitHub Actions
- Repository: `pushtodisplay/opencode-pushtodisplay`
- Workflow filename: `publish.yml`
- Environment: leave empty (or set one and add it to the workflow)

After that, remove any local `NPM_TOKEN` and use the workflow for every release.
Trusted Publishing uses GitHub OIDC and gives each release provenance without a
long-lived token.

### Option B: first publish from the workflow with an `NPM_TOKEN`

1. Create an npm granular access token with read/write access to the package (or
   the `@pushtodisplay` scope, if the package is moved into a scope).
2. Add it to the repository as the `NPM_TOKEN` Actions secret.
3. Run **Actions → Publish → Run workflow** with:

   - `release_type`: `stable`
   - `version_bump`: `none` (publishes the current `package.json` version)
   - `dry_run`: `false`

4. Delete the `NPM_TOKEN` secret and configure Trusted Publishing as in Option A.
   The workflow automatically uses OIDC when `NPM_TOKEN` is absent.

## Regular releases

1. Update `CHANGELOG.md` and merge it to `main`.
2. Run **Actions → Publish → Run workflow**:

   - `release_type`: `stable`, `rc`, `beta`, or `alpha`
   - `version_bump`: `patch`, `minor`, `major`, or `none`
   - `npm_tag`: optional dist-tag override; defaults to `latest` for stable and
     the pre-release type otherwise
   - `dry_run`: `true` to exercise versioning and packing without publishing

3. The workflow:
   - runs `npm run check` (`typecheck`, `lint`, `test`),
   - computes and writes the next version,
   - runs `npm pack --dry-run`,
   - publishes with `--provenance`,
   - commits `chore: release vX.Y.Z`, tags
     `opencode-pushtodisplay-vX.Y.Z`, and pushes both.
4. Verify:

   ```bash
   npm view opencode-pushtodisplay@<version> version dist-tags --json
   npm view opencode-pushtodisplay@<version> dist.integrity
   ```

5. Confirm provenance on the npm package page and in the workflow run summary.

## Manual fallback (token-based)

If OIDC is unavailable, export a granular token with publish access and run:

```bash
npm ci
npm run check
npm version <version> --no-git-tag-version
npm publish --access public --tag latest
git add package.json package-lock.json
git commit -m "chore: release v<version>"
git tag opencode-pushtodisplay-v<version>
git push origin HEAD opencode-pushtodisplay-v<version>
```

Never commit an npm token or put one in `opencode.json`.

## Package contents

`package.json` publishes:

- `src/*.ts` (runtime entry and its imports)
- `vendor/pushtodisplay/**` (the pinned, vendored CLI)
- `docs/*.md` (maintainer and publishing notes)
- `README.md`
- `CHANGELOG.md`
- `LICENSE`

Tests under `src/__tests__/` and development configuration are excluded. Check
with `npm pack --dry-run` before every release. The vendored release is pinned;
do not copy the upstream `npm-shrinkwrap.json` into the package.

## Trusted Publishing notes

- `permissions: id-token: write` is required in the workflow job.
- `npm publish --provenance` requires a CI provider that supports OIDC; it is not
  available for a normal local publish.
- The workflow supports both OIDC and an `NPM_TOKEN` secret so the first publish
  is possible before Trusted Publishing exists.
- A published version cannot be overwritten; bump the version instead.
