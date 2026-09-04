import type { Config, Context } from "@netlify/functions";
import { PHOTO_ID_RE } from "../../packages/domain/src/photos";
import { verifyPhotoAccess, verifySessionToken } from "../../packages/domain/src/pin";
import { TRIP_ID_RE } from "../../packages/domain/src/trip";
import { bearerToken, corsHeaders, errorResponse, pinHashFromRecord, pinPepper, corsPreflight } from "./_shared/http";
import { photosStore, tripsStore } from "./_shared/stores";

export default async (req: Request, context: Context) => {
  try {
    if (req.method === "OPTIONS") {
      return corsPreflight();
    }
    if (req.method !== "GET") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders() });
    }

    const tripId = context.params?.tripId;
    const photoId = context.params?.photoId;
    if (!tripId || !photoId || !TRIP_ID_RE.test(tripId) || !PHOTO_ID_RE.test(photoId)) {
      return new Response("Not found", { status: 404, headers: corsHeaders() });
    }

    const tripRaw = await tripsStore().get(tripId, { type: "json" });
    if (tripRaw === null) {
      return new Response("Not found", { status: 404, headers: corsHeaders() });
    }

    const pinHash = pinHashFromRecord(tripRaw);
    if (pinHash) {
      const url = new URL(req.url);
      const exp = url.searchParams.get("exp");
      const sig = url.searchParams.get("sig");
      const pepper = pinPepper();
      const signed = exp && sig ? await verifyPhotoAccess(tripId, photoId, pepper, exp, sig) : false;
      const token = bearerToken(req);
      const authed = token ? await verifySessionToken(token, tripId, pepper) : false;
      if (!signed && !authed) {
        return new Response("Photos PIN required", { status: 401, headers: corsHeaders() });
      }
    }

    const key = `${tripId}/${photoId}`;
    const result = await photosStore().getWithMetadata(key, { type: "arrayBuffer" });
    if (!result || !result.data) {
      return new Response("Not found", { status: 404, headers: corsHeaders() });
    }

    const contentType =
      typeof result.metadata?.contentType === "string" ? result.metadata.contentType : "image/jpeg";
    return new Response(result.data, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": pinHash ? "private, max-age=300" : "public, max-age=31536000, immutable",
        ...corsHeaders(),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = {
  path: "/uploads/photos/:tripId/:photoId",
};
