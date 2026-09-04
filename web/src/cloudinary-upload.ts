import type { OriginalUploadSign } from "./api";
import { MAX_ORIGINAL_BYTES } from "@fairshare/domain/cloudinary";

export async function uploadOriginalToCloudinary(
  file: File,
  sign: OriginalUploadSign,
): Promise<string> {
  if (file.size > MAX_ORIGINAL_BYTES) {
    throw new Error("Original is too large");
  }
  const data = new FormData();
  data.append("file", file);
  data.append("api_key", sign.apiKey);
  data.append("timestamp", String(sign.timestamp));
  data.append("signature", sign.signature);
  data.append("folder", sign.folder);
  data.append("public_id", sign.publicId);
  data.append("type", sign.type);
  data.append("allowed_formats", sign.allowedFormats);
  const res = await fetch(sign.uploadUrl, { method: "POST", body: data });
  if (!res.ok) {
    throw new Error("Could not upload original");
  }
  const body = (await res.json()) as { public_id?: unknown };
  if (typeof body.public_id !== "string" || !body.public_id) {
    throw new Error("Could not upload original");
  }
  return body.public_id;
}
