/**
 * Content-aware inpainting for watermark removal.
 *
 * Given an image and a binary mask of the pixels to remove (the watermark),
 * this reconstructs those pixels from the surrounding background using:
 *   1. A grass-fire seed pass that propagates the nearest known colours into
 *      the masked region (so we never start from grey / black).
 *   2. Harmonic (Laplacian) diffusion that relaxes the seeded pixels into a
 *      smooth interpolation of the boundary — the classic, well-behaved
 *      inpainting technique that blends gradients and flat backgrounds.
 *
 * Everything here is pure (no DOM), so it is unit-testable and could also run
 * inside a Web Worker on large images.
 */

export interface PixelBuffer {
  /** RGBA pixels, length === width * height * 4. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface InpaintOptions {
  /**
   * Number of diffusion relaxation passes. Higher = smoother / more blended
   * but slower. ~50 is a good default for typical watermarks.
   */
  iterations?: number;
}

const DEFAULT_ITERATIONS = 50;

/**
 * Returns a new RGBA buffer with the masked pixels reconstructed.
 * The source buffer is never mutated.
 *
 * @param src   the original image
 * @param mask  Uint8Array of length width*height — non-zero marks a pixel to remove
 */
export function inpaint(
  src: PixelBuffer,
  mask: Uint8Array,
  options: InpaintOptions = {},
): Uint8ClampedArray {
  const { width, height, data } = src;
  const n = width * height;

  if (mask.length !== n) {
    throw new Error(
      `mask length ${mask.length} does not match image size ${n} (${width}x${height})`,
    );
  }

  const iterations = Math.max(0, options.iterations ?? DEFAULT_ITERATIONS);

  // Working RGB buffers in float for stable averaging.
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  // known[i] === 1 once a pixel has a usable colour (original or filled-in).
  const known = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    r[i] = data[i * 4];
    g[i] = data[i * 4 + 1];
    b[i] = data[i * 4 + 2];
    known[i] = mask[i] ? 0 : 1;
  }

  seedByGrassfire(r, g, b, known, mask, width, height);
  diffuse(r, g, b, mask, width, height, iterations);

  // Compose result, preserving original alpha for kept pixels and forcing
  // reconstructed pixels to fully opaque (a removed watermark should reveal
  // solid background, not transparency).
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < n; i++) {
    out[i * 4] = r[i];
    out[i * 4 + 1] = g[i];
    out[i * 4 + 2] = b[i];
    out[i * 4 + 3] = mask[i] ? 255 : data[i * 4 + 3];
  }
  return out;
}

/**
 * Fill every masked pixel with the average of its already-known 8-neighbours,
 * expanding inward ring by ring until the whole region is seeded.
 */
function seedByGrassfire(
  r: Float32Array,
  g: Float32Array,
  b: Float32Array,
  known: Uint8Array,
  mask: Uint8Array,
  width: number,
  height: number,
): void {
  const n = width * height;
  let remaining = 0;
  for (let i = 0; i < n; i++) if (mask[i]) remaining++;
  if (remaining === 0) return;

  // If the mask covers the whole image there is nothing to borrow from.
  if (remaining === n) return;

  const nextR = new Float32Array(n);
  const nextG = new Float32Array(n);
  const nextB = new Float32Array(n);
  const toFill: number[] = [];

  while (remaining > 0) {
    toFill.length = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (known[i]) continue;

        let sr = 0;
        let sg = 0;
        let sb = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            const j = ny * width + nx;
            if (!known[j]) continue;
            sr += r[j];
            sg += g[j];
            sb += b[j];
            count++;
          }
        }
        if (count > 0) {
          nextR[i] = sr / count;
          nextG[i] = sg / count;
          nextB[i] = sb / count;
          toFill.push(i);
        }
      }
    }

    // No progress possible (shouldn't happen unless the region is detached) —
    // bail to avoid an infinite loop.
    if (toFill.length === 0) break;

    for (const i of toFill) {
      r[i] = nextR[i];
      g[i] = nextG[i];
      b[i] = nextB[i];
      known[i] = 1;
      remaining--;
    }
  }
}

/**
 * Jacobi relaxation of the Laplace equation over the masked pixels: each masked
 * pixel is repeatedly set to the average of its 4-connected neighbours, which
 * smooths the grass-fire seed into a natural-looking interpolation.
 */
function diffuse(
  r: Float32Array,
  g: Float32Array,
  b: Float32Array,
  mask: Uint8Array,
  width: number,
  height: number,
  iterations: number,
): void {
  if (iterations === 0) return;
  const n = width * height;

  // Collect masked pixel indices once.
  const masked: number[] = [];
  for (let i = 0; i < n; i++) if (mask[i]) masked.push(i);
  if (masked.length === 0) return;

  const tmpR = new Float32Array(r);
  const tmpG = new Float32Array(g);
  const tmpB = new Float32Array(b);

  for (let it = 0; it < iterations; it++) {
    for (const i of masked) {
      const x = i % width;
      const y = (i - x) / width;

      let sr = 0;
      let sg = 0;
      let sb = 0;
      let count = 0;

      if (x > 0) {
        const j = i - 1;
        sr += r[j];
        sg += g[j];
        sb += b[j];
        count++;
      }
      if (x < width - 1) {
        const j = i + 1;
        sr += r[j];
        sg += g[j];
        sb += b[j];
        count++;
      }
      if (y > 0) {
        const j = i - width;
        sr += r[j];
        sg += g[j];
        sb += b[j];
        count++;
      }
      if (y < height - 1) {
        const j = i + width;
        sr += r[j];
        sg += g[j];
        sb += b[j];
        count++;
      }

      if (count > 0) {
        tmpR[i] = sr / count;
        tmpG[i] = sg / count;
        tmpB[i] = sb / count;
      }
    }

    // Commit this pass (only masked pixels changed).
    for (const i of masked) {
      r[i] = tmpR[i];
      g[i] = tmpG[i];
      b[i] = tmpB[i];
    }
  }
}
