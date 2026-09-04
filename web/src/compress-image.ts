import { PHOTO_MAX_EDGE } from "@fairshare/domain/photos";

export async function compressImage(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("This photo could not be read. Try another image from your library.");
  }

  let { width, height } = bitmap;
  if (width > PHOTO_MAX_EDGE || height > PHOTO_MAX_EDGE) {
    const scale = PHOTO_MAX_EDGE / Math.max(width, height);
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
    canvas.toBlob(resolve, "image/jpeg", 0.82);
  });
  if (!blob) {
    throw new Error("Could not compress this photo");
  }
  return blob;
}
