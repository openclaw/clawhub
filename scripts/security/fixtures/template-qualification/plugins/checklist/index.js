// Pure text helper: no IO, imports, installation hooks or executable setup.
export default function checklist(titles) {
  return titles.map((title) => `- [ ] ${title}`).join("\n");
}
