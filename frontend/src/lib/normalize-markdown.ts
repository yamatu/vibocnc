/** Repair a compact pasted GFM table without changing fenced or indented code. */
export function normalizeCompactTables(markdown: string): string {
  let fenceCharacter = '';
  let fenceLength = 0;

  return markdown.replace(/\r\n?/g, '\n').split('\n').map((line) => {
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      const marker = fence[1];
      if (!fenceCharacter) {
        fenceCharacter = marker[0];
        fenceLength = marker.length;
      } else if (marker[0] === fenceCharacter && marker.length >= fenceLength && !fence[2].trim()) {
        fenceCharacter = '';
      }
      return line;
    }
    if (fenceCharacter || /^(?: {4}|\t)/.test(line)) return line;

    // Only a collapsed header + delimiter row qualifies. Ordinary multiline
    // tables may contain empty cells written as "| |" and must stay intact.
    if (!/^ {0,3}\|/.test(line) || !/\|[ \t]+\|[ \t]*:?-{3,}:?[ \t]*\|/.test(line)) return line;
    return line.replace(/\|[ \t]+\|/g, '|\n|');
  }).join('\n');
}
