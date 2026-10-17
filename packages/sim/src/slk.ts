// Minimal reader for the game's SYLK tables (.slk): rows keyed by the header row.
export function parseSlk(text: string): Record<string, string>[] {
  const cells = new Map<number, Map<number, string>>();
  let x = 0;
  let y = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("C;")) continue;
    let value: string | null = null;
    for (const tok of line.slice(2).split(";")) {
      if (tok[0] === "X") x = Number(tok.slice(1));
      else if (tok[0] === "Y") y = Number(tok.slice(1));
      else if (tok[0] === "K") value = tok.slice(1).replace(/^"|"$/g, "");
    }
    if (value === null) continue;
    if (!cells.has(y)) cells.set(y, new Map());
    cells.get(y)!.set(x, value);
  }
  const header = cells.get(1);
  if (!header) return [];
  const rows: Record<string, string>[] = [];
  for (const [rowY, row] of [...cells.entries()].sort((a, b) => a[0] - b[0])) {
    if (rowY === 1) continue;
    const obj: Record<string, string> = {};
    for (const [colX, name] of header) if (row.has(colX)) obj[name] = row.get(colX)!;
    rows.push(obj);
  }
  return rows;
}
