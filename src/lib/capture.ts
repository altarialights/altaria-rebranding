import fs from 'node:fs';
import path from 'node:path';

/**
 * USR-01 — the real De Zamorano home capture.
 *
 * Drop the PNG at public/media/dezamorano-home.png and every component
 * that depends on it switches over automatically: the laptop renders the
 * real image instead of the placeholder, and the in-lid scroll of beat 2
 * turns on. Until then the scroll stays off, because scrolling a
 * placeholder that exactly fills the bezel would just reveal black.
 */
export const CAPTURE_SRC = '/media/dezamorano-home.png';

export function hasCapture(): boolean {
  return fs.existsSync(path.join(process.cwd(), 'public', CAPTURE_SRC));
}
