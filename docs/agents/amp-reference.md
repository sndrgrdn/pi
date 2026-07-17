# Amp reference artifact

The last verified Amp npm release with client-embedded Finder, Oracle, Librarian, and Task prompts is archived locally at:

```text
~/.cache/artifacts/npm/sourcegraph-amp/0.0.1780074265-g6cfdc3/
```

The archive contains the exact npm tarball, extracted `dist/main.js`, harvested prompts and tool instructions, npm metadata, a manifest, and SHA-256 checksums. Its tarball SHA-512 integrity matches the npm registry metadata.

Prompt bodies disappear from the client bundle starting with `0.0.1780078165-g0febee`; later `@ampcode/cli` releases use native platform packages and server-side prompts.

Verify the preserved files with:

```bash
cd ~/.cache/artifacts/npm/sourcegraph-amp/0.0.1780074265-g6cfdc3
shasum -a 256 -c SHA256SUMS
```
