type SrcsetCandidate = {
  url: string;
  descriptors: string;
};

function isAsciiWhitespace(char: string): boolean {
  return char === " " || char === "\n" || char === "\t" || char === "\r" || char === "\f";
}

export function parseSrcset(srcset: string): SrcsetCandidate[] {
  const candidates: SrcsetCandidate[] = [];
  let index = 0;

  while (index < srcset.length) {
    while (index < srcset.length) {
      const char = srcset[index];
      if (isAsciiWhitespace(char) || char === ",") {
        index += 1;
        continue;
      }
      break;
    }
    if (index >= srcset.length) break;

    const urlStart = index;
    while (index < srcset.length && !isAsciiWhitespace(srcset[index])) {
      index += 1;
    }
    let url = srcset.slice(urlStart, index);
    const endedWithComma = url.endsWith(",");
    if (endedWithComma) {
      url = url.slice(0, -1);
    }

    while (index < srcset.length && isAsciiWhitespace(srcset[index])) {
      index += 1;
    }

    let descriptors = "";
    if (!endedWithComma) {
      const descriptorsStart = index;
      while (index < srcset.length && srcset[index] !== ",") {
        index += 1;
      }
      descriptors = srcset.slice(descriptorsStart, index).trim();
    }

    candidates.push({ url, descriptors });

    if (srcset[index] === ",") {
      index += 1;
    }
  }

  return candidates;
}
