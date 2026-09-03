# Product Image Governance

The admin media page now provides three image-maintenance workflows.

## Safe cleanup

Open `/admin/media`, add any external hosts that belong to your business CDN,
and click **Preview removable images** first. The preview is read-only. After
confirmation, the cleanup worker removes only untrusted `http://` and `https://`
references from the selected product scope.

The following are always preserved:

- relative paths such as `/uploads/...`;
- VIBOCNC and configured deployment hosts;
- SKU default-image URLs;
- external URLs explicitly added through the product editor;
- hosts listed in the trusted-host field.

The worker stores its cursor and can be paused/resumed. It also resumes after a
backend restart. It removes database image references only; it never deletes a
remote file or a local media asset.

## Media usage lookup

Use the chain/link action on a media-library tile to list products that reference
that asset. Matching covers JSON product image URLs, absolute VIBOCNC URLs, and
legacy `product_images` rows. Each result links directly to the admin product
editor.

## SKU ZIP import

Create a ZIP with one or more of these layouts:

```text
A06B-6117-H209/
  front.jpg
  label.png
```

or:

```text
export/
  A06B-6117-H209/
    front.jpg
```

The first meaningful folder at the SKU level is matched case-insensitively to
the product SKU. Unmatched folders are skipped. A matched product is replaced
only after all supported images in its folder are successfully optimized and
stored. Existing products absent from the archive are untouched.

The browser uploads the archive in 5 MiB chunks (maximum 8 MiB), displays byte
progress, retries transient failures, and resumes the same file by its content
fingerprint. ZIP processing runs in the background and supports pause/resume.

## Production migration

With `DB_AUTO_MIGRATE=true`, the new tables are created at backend startup. If
automatic migration is disabled, run:

```text
backend/migrations/20260903_add_product_image_management_jobs.sql
```

Optional archive limits are documented in `backend/.env.example`. The default
archive limit is 20 GiB, each expanded image is limited to 25 MiB, and each SKU
folder accepts up to 30 supported images unless configured otherwise.
