export const MAX_ORIGINAL_BYTES = 15_000_000;
export const ORIGINAL_ALLOWED_FORMATS = "jpg,jpeg,png,heic,heif";
export const CLOUDINARY_ASSET_TYPE = "authenticated";
export const ORIGINAL_URL_TTL_SECONDS = 60 * 60;

export function cloudinaryFolder(tripId: string): string {
  return `fairshare/${tripId}`;
}

export function cloudinaryPublicId(tripId: string, photoId: string): string {
  return `${cloudinaryFolder(tripId)}/${photoId}`;
}

export function isValidCloudinaryId(tripId: string, photoId: string, value: string): boolean {
  return value === cloudinaryPublicId(tripId, photoId);
}

export async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signCloudinaryParams(
  params: Record<string, string | number>,
  apiSecret: string,
): Promise<string> {
  const pairs = Object.keys(params)
    .filter((key) => {
      const value = params[key];
      return value !== undefined && value !== "";
    })
    .sort()
    .map((key) => `${key}=${params[key]}`);
  return sha1Hex(`${pairs.join("&")}${apiSecret}`);
}

export async function signUploadRequest(input: {
  tripId: string;
  photoId: string;
  timestamp: number;
  apiSecret: string;
}): Promise<string> {
  return signCloudinaryParams(
    {
      allowed_formats: ORIGINAL_ALLOWED_FORMATS,
      folder: cloudinaryFolder(input.tripId),
      public_id: input.photoId,
      timestamp: input.timestamp,
      type: CLOUDINARY_ASSET_TYPE,
    },
    input.apiSecret,
  );
}

export async function signedOriginalDownloadUrl(input: {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  publicId: string;
  timestamp: number;
  expiresAt: number;
}): Promise<string> {
  const params = {
    expires_at: input.expiresAt,
    public_id: input.publicId,
    timestamp: input.timestamp,
    type: CLOUDINARY_ASSET_TYPE,
  };
  const signature = await signCloudinaryParams(params, input.apiSecret);
  const query = new URLSearchParams({
    expires_at: String(input.expiresAt),
    public_id: input.publicId,
    timestamp: String(input.timestamp),
    type: CLOUDINARY_ASSET_TYPE,
    api_key: input.apiKey,
    signature,
  });
  return `https://api.cloudinary.com/v1_1/${encodeURIComponent(input.cloudName)}/image/download?${query.toString()}`;
}

export async function signDestroyRequest(input: {
  publicId: string;
  timestamp: number;
  apiSecret: string;
}): Promise<string> {
  return signCloudinaryParams(
    {
      public_id: input.publicId,
      timestamp: input.timestamp,
      type: CLOUDINARY_ASSET_TYPE,
    },
    input.apiSecret,
  );
}
