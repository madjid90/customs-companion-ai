import { describe, it, expect } from "vitest";
import { inpaint, type PixelBuffer } from "../inpaint";

/** Build a solid-colour RGBA image. */
function solid(width: number, height: number, rgb: [number, number, number]): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

describe("inpaint", () => {
  it("does not mutate the source buffer", () => {
    const img = solid(4, 4, [10, 20, 30]);
    const snapshot = Uint8ClampedArray.from(img.data);
    const mask = new Uint8Array(16);
    mask[5] = 1;
    inpaint(img, mask, { iterations: 5 });
    expect(img.data).toEqual(snapshot);
  });

  it("throws when the mask size does not match the image", () => {
    const img = solid(2, 2, [0, 0, 0]);
    expect(() => inpaint(img, new Uint8Array(3))).toThrow(/mask length/);
  });

  it("reconstructs a masked pixel to the surrounding solid colour", () => {
    // 5x5 solid red; punch a hole in the centre and expect it to come back red.
    const img = solid(5, 5, [200, 30, 40]);
    const center = 2 * 5 + 2;
    // Overwrite the centre pixel with garbage so we can prove it was rebuilt
    // from neighbours, not just left untouched.
    img.data[center * 4] = 0;
    img.data[center * 4 + 1] = 255;
    img.data[center * 4 + 2] = 0;

    const mask = new Uint8Array(25);
    mask[center] = 1;

    const out = inpaint(img, mask, { iterations: 30 });
    expect(out[center * 4]).toBe(200);
    expect(out[center * 4 + 1]).toBe(30);
    expect(out[center * 4 + 2]).toBe(40);
    expect(out[center * 4 + 3]).toBe(255);
  });

  it("interpolates a horizontal gradient across a masked column", () => {
    // Columns go from dark (left) to bright (right). Mask the middle column and
    // expect the reconstruction to land near the gradient value, not the edges.
    const w = 9;
    const h = 3;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const v = Math.round((x / (w - 1)) * 255);
        data[i * 4] = v;
        data[i * 4 + 1] = v;
        data[i * 4 + 2] = v;
        data[i * 4 + 3] = 255;
      }
    }
    const img: PixelBuffer = { data, width: w, height: h };

    const mask = new Uint8Array(w * h);
    const midX = 4;
    for (let y = 0; y < h; y++) mask[y * w + midX] = 1;

    const out = inpaint(img, mask, { iterations: 80 });
    const expected = Math.round((midX / (w - 1)) * 255); // ~128
    const got = out[(1 * w + midX) * 4];
    expect(Math.abs(got - expected)).toBeLessThanOrEqual(6);
  });

  it("leaves unmasked pixels untouched", () => {
    const img = solid(4, 4, [12, 34, 56]);
    const mask = new Uint8Array(16);
    mask[10] = 1;
    const out = inpaint(img, mask, { iterations: 10 });
    for (let i = 0; i < 16; i++) {
      if (mask[i]) continue;
      expect(out[i * 4]).toBe(12);
      expect(out[i * 4 + 1]).toBe(34);
      expect(out[i * 4 + 2]).toBe(56);
    }
  });

  it("handles an empty mask as a no-op copy", () => {
    const img = solid(3, 3, [1, 2, 3]);
    const out = inpaint(img, new Uint8Array(9));
    expect(Array.from(out)).toEqual(Array.from(img.data));
  });
});
