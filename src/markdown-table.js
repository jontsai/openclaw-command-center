/** Split pipe tables without dropping blank cells or escaped pipe characters. */
function splitTableRow(line) {
  line = line.trim();
  if (!line.startsWith("|")) return [];
  const cells = [];
  let cell = "";
  for (let i = 1; i < line.length; i++) {
    const char = line[i];
    if (char === "\\" && ["|", "\\"].includes(line[i + 1])) {
      cell += line[++i];
    } else if (char === "|") {
      cells.push(cell.trim());
      cell = "";
      if (i === line.length - 1) return cells;
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function isTableSeparator(line, columnCount) {
  const cells = splitTableRow(line);
  return cells.length === columnCount && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

module.exports = { splitTableRow, isTableSeparator };
