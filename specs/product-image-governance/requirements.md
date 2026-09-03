# Product Image Governance Requirements

## Problem and scope

Imported products may contain unwanted third-party image URLs, while locally uploaded images and administrator-approved external URLs must be preserved. Administrators also need to trace a media asset back to products and import large SKU-organized image archives without a single long-running HTTP request.

## User stories

1. As an administrator, I want to preview and remove only untrusted external product images so that owned images remain intact.
2. As an administrator, I want to open a media asset and see every product using it so that I can correct product assignments quickly.
3. As an administrator, I want to upload a large ZIP whose folders are named by SKU so that matching products receive the folder images automatically.
4. As an operator, I want upload and processing progress to survive request failures and service restarts.

## Acceptance criteria

### R1 — Safe external-image cleanup

- When an administrator requests a cleanup preview, the system shall scan the selected product scope without modifying products.
- The system shall always preserve relative `/uploads/` URLs, SKU default-image URLs, VIBOCNC-owned hostnames, URLs explicitly added through the administrator product editor, and URLs whose hostname matches the configured trusted-domain list.
- The system shall classify every other HTTP(S) product image as removable and return product/image counts plus representative samples.
- When the administrator starts cleanup, the system shall run a persistent background job that removes only classified untrusted URLs and preserves all trusted URLs in their original order.
- While cleanup is running, the system shall expose progress and allow pause/resume without re-removing completed data.

### R2 — Media-to-product usage

- When an administrator requests usage for a media asset, the system shall find exact URL matches in product `image_urls` and product-image relations.
- The response shall include product ID, SKU, name, brand, status, and the matched URL.
- The media page shall provide direct links to the matching admin product pages.

### R3 — Resumable SKU ZIP upload

- When a ZIP upload is initiated, the system shall create a persistent upload job and accept bounded binary chunks at explicit offsets.
- When a chunk is retried at the same offset, the system shall not corrupt or duplicate archive bytes.
- The browser shall display byte-level upload progress and retry transient chunk failures.
- When all bytes are present and completion is requested, the system shall validate the ZIP before queueing processing.

### R4 — Background SKU image import

- When processing a valid archive, the system shall treat the first meaningful folder under an optional wrapper directory as the SKU.
- For each matched SKU, the system shall optimize supported images, store them in the media library, and replace that product's current image list with the local uploaded URLs in stable filename order.
- The system shall skip unmatched SKU folders, unsupported files, unsafe paths, and oversized/decompression-bomb entries while recording counts/errors.
- The processing job shall persist progress and resume after service restart.
- Existing products not represented by a successfully processed SKU folder shall remain unchanged.

## Constraints and non-goals

- Historical manual external URLs cannot be inferred reliably; administrators protect them through trusted hostnames.
- This change does not scrape or download remote images.
- This change does not delete media files merely because product links are cleaned.
- GitHub push is included; production deployment is not.
