# Product Catalog Transfer Requirements

## Scope

Add a portable product-library backup and restore flow to both `vibocnc` and
`fanucnewvco`. The archive must move catalog data between sites without
requiring identical database schemas or copying unrelated orders/users/settings.

## User stories

1. As an administrator, I want to export the product catalog as one portable
   archive so I can move it to another compatible site.
2. As an administrator, I want to preview an import before writing data so I
   can review field, category, brand, and site-name transformations.
3. As the Vcocnc site owner, I want imported Vibocnc wording rewritten to
   Vcocnc without changing manufacturer names or product identifiers.
4. As an operator, I want large imports to run in a durable background task so
   a browser refresh or backend restart does not interrupt the migration.
5. As the Vcocnc site owner, I want backend/admin feature parity without
   replacing the existing Vcocnc public-site color identity.

## Acceptance criteria

1. When an administrator exports the product library, the system shall produce
   a versioned ZIP containing a manifest, portable catalog JSON, and referenced
   local product files that exist under `UPLOAD_PATH`.
2. The export shall include categories, products, product images, attributes,
   translations, purchase links, FAQs, and tags when those relations exist.
3. The archive shall identify records by portable keys such as SKU, category
   path, language code, and relation order rather than source database IDs.
4. When an administrator uploads an archive, the system shall support resumable
   chunk upload, persisted progress, pause/resume, and restart recovery.
5. Before applying an import, the system shall report source/target schema
   versions, products to create/update/skip, missing target fields, category
   mappings, source brands, and planned text replacements.
6. When target code lacks an optional source field, the importer shall ignore
   that field and report it instead of failing the entire import.
7. When the target has a supported field absent from the archive, the importer
   shall retain the existing value during update or use target defaults during
   creation.
8. When conflict mode is `skip`, existing SKUs shall remain unchanged; when it
   is `update`, matching SKUs shall be updated; when it is `upsert`, missing
   SKUs shall be created and matching SKUs updated.
9. When a brand mapping is supplied, the importer shall replace only exact
   normalized brand values, not arbitrary occurrences inside model numbers.
10. When importing into Vcocnc, case-insensitive site text and URL replacements
    shall convert configured Vibocnc names/domains/emails to Vcocnc values in
    customer-facing product/category text and links.
11. The importer shall reject ZIP traversal, filesystem-root targets, oversized
    entries, malformed manifests, and unsupported future major versions.
12. The importer shall never modify orders, customers, admin users, payment
    settings, AI credentials, shipping settings, or global site configuration.
13. The Vcocnc compatibility update shall preserve its original public palette
    and brand identity while permitting admin layout additions that follow its
    existing component patterns.
14. A Docker build from the repaired Vcocnc branch shall contain the public
    home, products, categories, product detail, account, checkout, and policy
    routes instead of the deleted-page state in the current local worktree.

## Non-goals

- Cloning order/customer/payment history between sites.
- Treating a full SQL dump as a portable cross-site catalog format.
- Blindly copying the Vibocnc frontend or color theme into Vcocnc.
- Replacing manufacturer brand values unless an explicit mapping requests it.
