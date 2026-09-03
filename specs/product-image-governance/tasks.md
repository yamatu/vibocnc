# Implementation Plan

- [x] 1. Add durable cleanup and archive job models/migrations
  - Persist scope, trusted domains, upload offsets, processing cursors, counters, status, and worker leases.
  - _Requirements: R1, R3, R4_

- [x] 2. Implement image ownership classification and cleanup preview/background worker
  - Preserve local, VIBOCNC, default-image, and trusted-domain URLs.
  - Add pause/resume and restart recovery.
  - _Requirement: R1_

- [x] 3. Add media usage lookup
  - Resolve exact media URL references and return direct product targets.
  - _Requirement: R2_

- [x] 4. Implement resumable ZIP upload and secure background processing
  - Add chunk initiation/write/completion APIs, archive validation, SKU folder mapping, media deduplication, product replacement, and restart recovery.
  - _Requirements: R3, R4_

- [x] 5. Add media-page controls and progress states
  - Implement cleanup preview/confirmation, trusted-domain configuration, ZIP upload progress/retry, job monitoring, and product-usage modal.
  - _Requirements: R1, R2, R3, R4_

- [x] 6. Verify, commit, and push
  - Run backend tests/vet, frontend lint/build, document browser-validation gaps, scan staged content, commit, and push `main`.
  - _Requirements: R1, R2, R3, R4_
