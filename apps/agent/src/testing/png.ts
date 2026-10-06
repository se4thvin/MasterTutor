import sharp from "sharp";

export interface PixelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** True when every pixel inside the box (image pixels, 1px inset for antialiasing) is black. */
export async function regionIsBlack(png: Uint8Array, box: PixelBox): Promise<boolean> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const top = Math.ceil(box.y) + 1;
  const bottom = Math.floor(box.y + box.height) - 1;
  const left = Math.ceil(box.x) + 1;
  const right = Math.floor(box.x + box.width) - 1;
  if (bottom <= top || right <= left) throw new Error("box too small to check");
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const at = (y * info.width + x) * info.channels;
      if (data[at] !== 0 || data[at + 1] !== 0 || data[at + 2] !== 0) return false;
    }
  }
  return true;
}

export async function imageWidth(png: Uint8Array): Promise<number> {
  return (await sharp(png).metadata()).width ?? 0;
}
