import { describe, expect, it } from "vitest";
import {
  CLOUDINARY_ASSET_TYPE,
  ORIGINAL_ALLOWED_FORMATS,
  cloudinaryFolder,
  cloudinaryPublicId,
  isValidCloudinaryId,
  signCloudinaryParams,
  signedOriginalDownloadUrl,
  signUploadRequest,
} from "@fairshare/domain/cloudinary";

const secret = "abcd";
const tripId = "11111111111111111111111111111111";
const photoId = "22222222222222222222222222222222";

describe("Cloudinary signing", () => {
  it("SHA-1 hashes sorted params plus the API secret", async () => {
    const signature = await signCloudinaryParams(
      { public_id: "sample", version: "1315060510" },
      secret,
    );
    expect(signature).toBe("912d90b6fe28aa6820cf928bc440a65a0f36e002");
  });

  it("sorts parameters alphabetically and omits empty values", async () => {
    const signature = await signCloudinaryParams(
      { b: "2", a: "1", skip: "", empty: "" },
      secret,
    );
    const expected = await signCloudinaryParams({ a: "1", b: "2" }, secret);
    expect(signature).toBe(expected);
  });

  it("builds folder and public id without nesting blob keys", () => {
    expect(cloudinaryFolder(tripId)).toBe(`fairshare/${tripId}`);
    expect(cloudinaryPublicId(tripId, photoId)).toBe(`fairshare/${tripId}/${photoId}`);
    expect(isValidCloudinaryId(tripId, photoId, cloudinaryPublicId(tripId, photoId))).toBe(true);
    expect(isValidCloudinaryId(tripId, photoId, "someone-else")).toBe(false);
    expect(isValidCloudinaryId(tripId, photoId, `fairshare/${tripId}/cccccccccccccccccccccccccccccccc`)).toBe(
      false,
    );
  });

  it("signs an authenticated original upload", async () => {
    const timestamp = 1_700_000_000;
    const signature = await signUploadRequest({
      tripId,
      photoId,
      timestamp,
      apiSecret: secret,
    });
    const expected = await signCloudinaryParams(
      {
        allowed_formats: ORIGINAL_ALLOWED_FORMATS,
        folder: `fairshare/${tripId}`,
        public_id: photoId,
        timestamp,
        type: CLOUDINARY_ASSET_TYPE,
      },
      secret,
    );
    expect(signature).toBe(expected);
    expect(CLOUDINARY_ASSET_TYPE).toBe("authenticated");
  });

  it("builds a short-lived signed download URL with no long-lived public path", async () => {
    const timestamp = 1_700_000_000;
    const expiresAt = timestamp + 3600;
    const url = await signedOriginalDownloadUrl({
      cloudName: "demo",
      apiKey: "1234",
      apiSecret: secret,
      publicId: cloudinaryPublicId(tripId, photoId),
      timestamp,
      expiresAt,
    });
    const parsed = new URL(url);
    expect(parsed.protocol).toBe("https:");
    expect(parsed.hostname).toBe("api.cloudinary.com");
    expect(parsed.pathname).toBe("/v1_1/demo/image/download");
    expect(parsed.searchParams.get("public_id")).toBe(`fairshare/${tripId}/${photoId}`);
    expect(parsed.searchParams.get("type")).toBe("authenticated");
    expect(parsed.searchParams.get("expires_at")).toBe(String(expiresAt));
    expect(parsed.searchParams.get("api_key")).toBe("1234");
    expect(parsed.searchParams.get("signature")).toMatch(/^[a-f0-9]{40}$/);
    expect(url).not.toContain(secret);
    expect(url).not.toContain("res.cloudinary.com");
  });
});
