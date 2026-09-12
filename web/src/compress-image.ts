import { PHOTO_MAX_EDGE } from "@fairshare/domain/photos";

export async function compressImage(
  file: File,
  options: { maxEdge?: number | null; quality?: number } = {},
): Promise<Blob> {
  const maxEdge = options.maxEdge === undefined ? PHOTO_MAX_EDGE : options.maxEdge;
  const quality = options.quality ?? 0.82;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("This photo could not be read. Try another image from your library.");
  }

  let { width, height } = bitmap;
  if (maxEdge !== null && (width > maxEdge || height > maxEdge)) {
    const scale = maxEdge / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Could not compress this photo");
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", quality);
  });
  if (!blob) {
    throw new Error("Could not compress this photo");
  }
  return blob;
}
