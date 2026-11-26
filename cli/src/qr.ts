import QRCode from 'qrcode';

// A QR code drawn in the terminal that phones can actually scan. The qrcode package's own
// terminal output uses the theme's "white" and "black" (often grey and dark grey) and only a
// 1-module border, so cameras often can't read it. Here:
// - pure black and white from the 256-colour cube (16 = #000000, 231 = #ffffff), which
//   themes don't remap; black on white also passes any minimum-contrast setting unchanged;
// - a white border (quiet zone): 4 modules as the QR standard asks, 2 when space is short;
// - error correction L: the smallest code for the link, so each module is as big as possible.
//
// Two ways to draw it:
// - "sharp": each module is two spaces with a background colour. No font glyphs at all, so
//   it can't break: terminals fill the background across the whole cell, line spacing
//   included. macOS Terminal leaves gaps between lines of block characters with many fonts,
//   which stripes a half-block QR code and makes Android scanners fail. Needs a big window
//   (about 74 x 41 for a Wi-Fi link).
// - "compact": two modules per cell, '▀' with the top as foreground and the bottom as
//   background. Half the height, but depends on the font drawing '▀' edge to edge.

const BLACK = 16;
const WHITE = 231;

/** The QR code for `text` as rows of dark (true) / light (false) modules, border included. */
export function qrMatrix(text: string, quiet = 4): boolean[][] {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'L' });
  const n = modules.size + quiet * 2;
  return Array.from({ length: n }, (_, y) =>
    Array.from({ length: n }, (_, x) => {
      const r = y - quiet;
      const c = x - quiet;
      return r >= 0 && c >= 0 && r < modules.size && c < modules.size && Boolean(modules.get(r, c));
    }),
  );
}

const colour = (dark: boolean) => (dark ? BLACK : WHITE);

function sharp(m: boolean[][]): string {
  return m.map((row) => row.map((dark) => `\x1b[48;5;${colour(dark)}m  `).join('') + '\x1b[0m').join('\n');
}

function compact(m: boolean[][]): string {
  const lines: string[] = [];
  for (let y = 0; y < m.length; y += 2) {
    let line = '';
    for (let x = 0; x < m.length; x++) {
      const top = m[y]![x]!;
      const bottom = y + 1 < m.length ? m[y + 1]![x]! : false;
      line += `\x1b[38;5;${colour(top)}m\x1b[48;5;${colour(bottom)}m▀`;
    }
    lines.push(`${line}\x1b[0m`);
  }
  return lines.join('\n');
}

/** Lines printed under the code (instructions); the sharp code must leave room for them. */
const LINES_BELOW = 5; // 4 lines of text, then the shell prompt

/**
 * Terminal text for the QR code: the sharp form when the window has room for it (4-module
 * border, else 2), otherwise the compact form. `window` is the terminal size; without one
 * (output piped to a file) the sharp form is used.
 */
export function terminalQr(
  text: string,
  window?: { columns?: number; rows?: number },
): { text: string; mode: 'sharp' | 'compact'; needs: { columns: number; rows: number } } {
  const smallest = qrMatrix(text, 2).length;
  const needs = { columns: smallest * 2, rows: smallest + LINES_BELOW }; // the smallest sharp form
  for (const quiet of [4, 2]) {
    const m = qrMatrix(text, quiet);
    const fits = !window?.columns || !window.rows || (m.length * 2 <= window.columns && m.length + LINES_BELOW <= window.rows);
    if (fits) return { text: sharp(m), mode: 'sharp', needs };
  }
  return { text: compact(qrMatrix(text, 4)), mode: 'compact', needs };
}
