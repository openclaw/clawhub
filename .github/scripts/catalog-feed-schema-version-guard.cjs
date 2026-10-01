function maskNonCode(source) {
  let result = "";
  let state = "code";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (state === "line-comment") {
      if (char === "\n") {
        state = "code";
        result += char;
      } else {
        result += " ";
      }
      continue;
    }
    if (state === "block-comment") {
      if (char === "*" && next === "/") {
        result += "  ";
        index += 1;
        state = "code";
      } else {
        result += char === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (state !== "code") {
      if (char === "\\") {
        result += " ";
        if (next !== undefined) {
          result += next === "\n" ? "\n" : " ";
          index += 1;
        }
      } else if (
        (state === "single-quote" && char === "'") ||
        (state === "double-quote" && char === '"') ||
        (state === "template" && char === "`")
      ) {
        result += " ";
        state = "code";
      } else {
        result += char === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (char === "/" && next === "/") {
      result += "  ";
      index += 1;
      state = "line-comment";
    } else if (char === "/" && next === "*") {
      result += "  ";
      index += 1;
      state = "block-comment";
    } else if (char === "'") {
      result += " ";
      state = "single-quote";
    } else if (char === '"') {
      result += " ";
      state = "double-quote";
    } else if (char === "`") {
      result += " ";
      state = "template";
    } else {
      result += char;
    }
  }
  return result;
}

function extractCatalogFeedSchemaVersion(source) {
  const matches = [
    ...maskNonCode(source).matchAll(
      /^\s*export\s+const\s+CATALOG_FEED_SCHEMA_VERSION\s*=\s*(\d+)\s*;/gm,
    ),
  ];
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one CATALOG_FEED_SCHEMA_VERSION declaration, found ${matches.length}`,
    );
  }
  return Number(matches[0][1]);
}

module.exports = { extractCatalogFeedSchemaVersion };
