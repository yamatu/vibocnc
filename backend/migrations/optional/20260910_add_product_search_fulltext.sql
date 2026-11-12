-- Optional FULLTEXT index for product search.
--
-- Apply manually, then set PRODUCT_SEARCH_MODE=fulltext to use it.
-- The application does NOT create this index automatically because FULLTEXT
-- changes search semantics (token/word boundaries instead of substring match),
-- which must be validated against real catalogue queries first.
--
-- Verify the plan before/after with:
--   EXPLAIN SELECT id FROM products
--    WHERE MATCH(sku, name, part_number, model)
--          AGAINST ('+A06B*' IN BOOLEAN MODE);
--
-- Notes
--   * InnoDB only. On MySQL 8.0 the FULLTEXT index is usable with the default
--     parser, which ignores tokens shorter than innodb_ft_min_token_size
--     (default 3). The application falls back to LIKE for such queries.
--   * For CJK text enable the ngram parser instead (see the commented
--     statement below). Note that ngram does not support the '*' wildcard, so
--     prefix matching degrades to substring token matching.
--   * Adding the index on a large table is an online DDL operation but still
--     writes the whole table; run it off-peak.

ALTER TABLE products
  ADD FULLTEXT INDEX idx_products_search_fulltext (sku, name, part_number, model);

-- CJK alternative (choose ONE of the two statements):
-- ALTER TABLE products
--   ADD FULLTEXT INDEX idx_products_search_fulltext (sku, name, part_number, model)
--   WITH PARSER ngram;

-- Rollback:
-- ALTER TABLE products DROP INDEX idx_products_search_fulltext;
