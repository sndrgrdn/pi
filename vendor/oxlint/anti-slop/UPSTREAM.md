# Upstream provenance

- Source: <https://github.com/dmmulroy/anti-slop>
- Installed revision: `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b`
- Previous upstream base: `6a48a8172292d0ca72e581d4275f4cc9c259bd72`
- Plugin paths: `vendor/oxlint/anti-slop/index.ts` and `vendor/oxlint/anti-slop/effect/index.ts`

The previous installation matched the production source at the base revision, except for a non-null assertion in `shared/dictionary-types.ts`. The update preserves that assertion because this repository enables `noUncheckedIndexedAccess` and the upstream expression does not type-check under that setting.

This repository vendors production plugin files and required third-party license files. It does not vendor upstream RuleTester files. The root Oxlint configuration enables all generic rules, the native accumulator-spread companion rule, and all Effect rules because this repository directly depends on Effect.

The update requires no dependency changes. `oxlint` and `@oxlint/plugins` remain pinned to compatible version `1.78.0`. TypeScript type checking and the project test suite pass. The first application lint run reports 681 migration findings from the newly enabled rules. Application source cleanup is deferred because this update does not include a source migration.
