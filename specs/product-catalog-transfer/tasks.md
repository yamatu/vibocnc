# Implementation Plan

- [x] 1. Stabilize repository baselines
  - Keep the dirty `fanucnewvco` directory untouched as evidence/reference.
  - Create a clean compatibility worktree from `fanucnewvco/origin/main`.
  - Record protected Vcocnc brand, domain, email, and palette values.
  - _Requirements: 13, 14_

- [x] 2. Define the portable catalog contract
  - Add versioned manifest and canonical category/product relation DTOs.
  - Add checksum, capability, and optional-field metadata.
  - _Requirements: 1, 2, 3, 6, 7, 11_

- [x] 3. Implement product-library export in Vibocnc
  - Stream catalog data and referenced local files into a ZIP.
  - Register admin-only route and download service.
  - _Requirements: 1, 2, 3, 11, 12_

- [x] 4. Implement durable import and preview
  - Add persisted resumable upload/import job.
  - Validate archives and generate non-mutating compatibility preview.
  - Apply category, brand, site-text, field, and SKU conflict mappings.
  - Add pause/resume/cancel/restart recovery.
  - _Requirements: 4, 5, 6, 7, 8, 9, 10, 11, 12_

- [x] 5. Add the backup-page workflow in Vibocnc
  - Add export, resumable upload, preview, mapping, apply, and progress controls.
  - Reuse the existing backup-page visual system.
  - _Requirements: 1, 4, 5, 8, 9, 10_

- [ ] 6. Port backend/admin parity to the clean Vcocnc worktree
  - Port only required functional modules and schema migrations.
  - Replace hard-coded Vibocnc identity with Vcocnc/configured values.
  - Preserve or restore Vcocnc palette tokens and public branding.
  - _Requirements: 6, 10, 13, 14_

- [ ] 7. Verify both projects
  - Run backend tests/vet, frontend lint/type/build, Docker builds, and browser
    migration flows in both worktrees.
  - Produce a compatibility report and safe deployment order.
  - _Requirements: 4, 5, 11, 12, 13, 14_
