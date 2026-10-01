const assert = require("node:assert/strict");
const test = require("node:test");
const { extractCatalogFeedSchemaVersion } = require("./catalog-feed-schema-version-guard.cjs");

test("reads the exported catalog feed schema version", () => {
  assert.equal(
    extractCatalogFeedSchemaVersion("export const CATALOG_FEED_SCHEMA_VERSION = 1;\n"),
    1,
  );
});

test("ignores fake declarations in comments and strings", () => {
  assert.equal(
    extractCatalogFeedSchemaVersion(`
      // export const CATALOG_FEED_SCHEMA_VERSION = 7;
      /* export const CATALOG_FEED_SCHEMA_VERSION = 8; */
      const example = "export const CATALOG_FEED_SCHEMA_VERSION = 9;";
      export const CATALOG_FEED_SCHEMA_VERSION = 2;
    `),
    2,
  );
});

test("rejects missing or duplicate declarations", () => {
  assert.throws(() => extractCatalogFeedSchemaVersion("const version = 1;"));
  assert.throws(() =>
    extractCatalogFeedSchemaVersion(`
      export const CATALOG_FEED_SCHEMA_VERSION = 1;
      export const CATALOG_FEED_SCHEMA_VERSION = 2;
    `),
  );
});
