import { ConfigError } from "../../../packages/domain/src/errors";
import {
  CLOUDINARY_ASSET_TYPE,
  ORIGINAL_URL_TTL_SECONDS,
  signedOriginalDownloadUrl,
  signDestroyRequest,
} from "../../../packages/domain/src/cloudinary";
import { envVar } from "./http";

export type CloudinaryConfig = {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
};

export function cloudinaryConfig(): CloudinaryConfig | null {
  const cloudName = envVar("CLOUDINARY_CLOUD_NAME");
  const apiKey = envVar("CLOUDINARY_API_KEY");
  const apiSecret = envVar("CLOUDINARY_API_SECRET");
  if (!cloudName || !apiKey || !apiSecret) {
    return null;
  }
  return { cloudName, apiKey, apiSecret };
}

export function requireCloudinary(): CloudinaryConfig {
  const config = cloudinaryConfig();
  if (!config) {
    throw new ConfigError("Originals are not configured");
  }
  return config;
}

export async function signedOriginalUrl(publicId: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<
  string | null
> {
  const config = cloudinaryConfig();
  if (!config) {
    return null;
  }
  return signedOriginalDownloadUrl({
    cloudName: config.cloudName,
    apiKey: config.apiKey,
    apiSecret: config.apiSecret,
    publicId,
    timestamp: nowSeconds,
    expiresAt: nowSeconds + ORIGINAL_URL_TTL_SECONDS,
  });
}

export async function destroyCloudinaryAsset(publicId: string): Promise<void> {
  const config = cloudinaryConfig();
  if (!config) {
    return;
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await signDestroyRequest({
    publicId,
    timestamp,
    apiSecret: config.apiSecret,
  });
  const body = new URLSearchParams({
    public_id: publicId,
    timestamp: String(timestamp),
    type: CLOUDINARY_ASSET_TYPE,
    api_key: config.apiKey,
    signature,
  });
  const res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/image/destroy`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error("Could not delete original");
  }
}
