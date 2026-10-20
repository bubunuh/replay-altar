import { describe, expect, test } from "vitest";
import { windowsLauncher } from "@replay-altar/core";
import { decodeDds, encodePng } from "../src/dds.ts";
import { inflateSync } from "node:zlib";

/** A 4×4 DDS of one block, header filled only where the decoder reads it. */
function dds(fourcc: string, block: number[]) {
  const file = new Uint8Array(128 + block.length);
  const v = new DataView(file.buffer);
  v.setUint32(0, 0x20534444, true);
  v.setUint32(12, 4, true);
  v.setUint32(16, 4, true);
  file.set([...fourcc].map((c) => c.charCodeAt(0)), 84);
  file.set(block, 128);
  return file;
}

describe("DDS icons", () => {
  test("DXT1: four colours between the two endpoints", () => {
    // c0 = pure red (0xF800), c1 = pure blue (0x001F); first row uses indices 0,1,2,3.
    const img = decodeDds(dds("DXT1", [0x00, 0xf8, 0x1f, 0x00, 0b11100100, 0, 0, 0]));
    const px = (i: number) => [...img.data.subarray(i * 4, i * 4 + 4)];
    expect(px(0)).toEqual([255, 0, 0, 255]);
    expect(px(1)).toEqual([0, 0, 255, 255]);
    expect(px(2)).toEqual([170, 0, 85, 255]);
    expect(px(3)).toEqual([85, 0, 170, 255]);
  });

  test("DXT5: interpolated alpha", () => {
    // Alpha endpoints 255 and 0 (the eight-step table); the first pixel uses index 1, alpha 0.
    const alpha = [255, 0, 0b01001001, 0b10010010, 0b00100100, 0b01001001, 0b10010010, 0b00100100];
    const img = decodeDds(dds("DXT5", [...alpha, 0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0]));
    expect(img.data[3]).toBe(0);
    expect([...img.data.subarray(0, 3)]).toEqual([255, 255, 255]);
  });

  test("PNG: RGBA rows behind filter bytes", () => {
    const png = encodePng({ width: 1, height: 2, data: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) });
    expect([...png.subarray(1, 4)].map((c) => String.fromCharCode(c)).join("")).toBe("PNG");
    const idat = png.indexOf("IDAT");
    const len = png.readUInt32BE(idat - 4);
    expect([...inflateSync(png.subarray(idat + 4, idat + 4 + len))]).toEqual([0, 1, 2, 3, 4, 0, 5, 6, 7, 8]);
  });
});

describe("Windows collector launcher", () => {
  test("quotes every argument for cmd inside a VBScript string", () => {
    const vbs = windowsLauncher(["C:\\Program Files\\nodejs\\node.exe", "C:\\src\\cli.ts", "collector"]);
    expect(vbs).toContain('.Run "cmd /c """"C:\\Program Files\\nodejs\\node.exe"" ""C:\\src\\cli.ts"" ""collector"" >> ""');
    expect(vbs).toMatch(/2>&1""", 0, False\r\n$/);
  });
});
