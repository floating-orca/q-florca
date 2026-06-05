# Release process

## Release a new version

To release a new version, follow these steps:

1. Switch to the `main` branch and pull the latest changes:

   ```bash
   git checkout main
   git pull origin main
   ```

2. Update the version number across the project, e.g., from `0.1.0` to `0.2.0`.

3. Commit the changes, e.g.,

   ```bash
   git commit -am "Bump version to 0.2.0"
   ```

4. Push the changes to the remote repository:

   ```bash
   git push origin main
   ```

5. Tag the commit with the new version number, e.g.,

   ```bash
   git tag v0.2.0
   ```

6. Push the tag to the remote repository:

   ```bash
   git push origin v0.2.0
   ```

7. Build and release the new version by running:

   ```bash
   scripts/release.sh
   ```

   _Please review the script before running it to ensure it meets your needs._

## Release the qFLORCA book

The [qFLORCA](../user-guide/qflorca.md) extension (`0.9.0+Q`) ships **no pre-built
images or binaries** — users build from source — so its "release" is just the
documentation. To publish the book on its own, run:

```bash
scripts/releaseQFlorca.sh
```

This builds the mdBook and uploads it as a GitHub release asset (creating the
release if needed). It requires `mdbook` and an authenticated `gh`. Override the
target repository or tag with `REPO=owner/name` and `TAG=...` if needed.
