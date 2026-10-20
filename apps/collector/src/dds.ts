// The game's icons are DDS textures (DXT1/3/5 block compression); the app shows PNGs. Decodes
// the top mip level and writes a PNG with node's zlib, so extraction needs no image tools.
import { crc32, deflateSync } from "node:zlib";

export type Rgba = { width: number; height: number; data: Uint8Array };

const rgb565 = (c: number) => [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31].map(Math.round);

/** Top-level image of a DXT1, DXT3 or DXT5 texture, as RGBA. */
export function decodeDds(file: Uint8Array): Rgba {
  const v = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (v.getUint32(0, true) !== 0x20534444) throw new Error("not a DDS file");
  const height = v.getUint32(12, true);
  const width = v.getUint32(16, true);
  const fourcc = String.fromCharCode(...file.subarray(84, 88));
  if (fourcc !== "DXT1" && fourcc !== "DXT3" && fourcc !== "DXT5") throw new Error(`unsupported DDS format ${JSON.stringify(fourcc)}`);
  const blockBytes = fourcc === "DXT1" ? 8 : 16;
  const data = new Uint8Array(width * height * 4);
  let at = 128;
  for (let by = 0; by < height; by += 4) {
    for (let bx = 0; bx < width; bx += 4, at += blockBytes) {
      const alpha = new Array<number>(16).fill(255);
      if (fourcc === "DXT3") {
        for (let i = 0; i < 16; i++) alpha[i] = ((file[at + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17;
      } else if (fourcc === "DXT5") {
        const [a0, a1] = [file[at], file[at + 1]];
        const table = [a0, a1];
        if (a0 > a1) for (let i = 1; i < 7; i++) table.push(Math.round(((7 - i) * a0 + i * a1) / 7));
        else table.push(...[1, 2, 3, 4].map((i) => Math.round(((5 - i) * a0 + i * a1) / 5)), 0, 255);
        // 16 three-bit indices in the next 6 bytes, little-endian.
        let bits = 0n;
        for (let i = 0; i < 6; i++) bits |= BigInt(file[at + 2 + i]) << BigInt(8 * i);
        for (let i = 0; i < 16; i++) alpha[i] = table[Number((bits >> BigInt(3 * i)) & 7n)];
      }
      const c = at + blockBytes - 8;
      const [c0, c1] = [v.getUint16(c, true), v.getUint16(c + 2, true)];
      const [p0, p1] = [rgb565(c0), rgb565(c1)];
      // DXT1 with c0 <= c1 has three colours and a transparent fourth; DXT3/5 always use four.
      const four = fourcc !== "DXT1" || c0 > c1;
      const colors = four
        ? [p0, p1, p0.map((x, i) => Math.round((2 * x + p1[i]) / 3)), p0.map((x, i) => Math.round((x + 2 * p1[i]) / 3))]
        : [p0, p1, p0.map((x, i) => Math.round((x + p1[i]) / 2)), [0, 0, 0]];
      const indices = v.getUint32(c + 4, true);
      for (let i = 0; i < 16; i++) {
        const [x, y] = [bx + (i & 3), by + (i >> 2)];
        if (x >= width || y >= height) continue;
        const k = (indices >> (2 * i)) & 3;
        const o = (y * width + x) * 4;
        data.set(colors[k], o);
        data[o + 3] = !four && k === 3 ? 0 : alpha[i];
      }
    }
  }
  return { width, height, data };
}

function chunk(type: string, body: Uint8Array) {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, "latin1");
  out.set(body, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

/** An 8-bit RGBA PNG. */
export function encodePng({ width, height, data }: Rgba): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA, deflate, no filter method, no interlace
  // Each row starts with its filter type (0: none).
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) rows.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", new Uint8Array())]);
}
