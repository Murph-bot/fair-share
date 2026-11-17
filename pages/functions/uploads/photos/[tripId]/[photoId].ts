import { PHOTO_ID_RE } from "../../../../../packages/domain/src/photos";
import { verifyPhotoAccess, verifySessionToken } from "../../../../../packages/domain/src/pin";
import { TRIP_ID_RE } from "../../../../../packages/domain/src/trip";
import {
  bearerToken,
  corsPreflight,
  errorResponse,
  pinHashFromRecord,
  pinPepper,
  withApiHeaders,
} from "../../../_shared/http";
import { getPhoto, getTripRaw } from "../../../_shared/stores";
import type { Env } from "../../../_shared/env";

async function respond(
  req: Request,
  env: Env,
  tripId: string,
  photoId: string,
): Promise<Response> {
  try {
    if (req.method === "OPTIONS") {
      return corsPreflight();
    }
    if (req.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    if (!TRIP_ID_RE.test(tripId) || !PHOTO_ID_RE.test(photoId)) {
      return new Response("Not found", { status: 404 });
    }

    const tripRaw = await getTripRaw(env, tripId);
    if (tripRaw === null) {
      return new Response("Not found", { status: 404 });
    }

    const isOriginal = new URL(req.url).searchParams.get("original") === "1";
    const pinHash = pinHashFromRecord(tripRaw);
    if (pinHash) {
      const url = new URL(req.url);
      const exp = url.searchParams.get("exp");
      const sig = url.searchParams.get("sig");
      const pepper = pinPepper(env);
      const variant = isOriginal ? "original" : "display";
      const signed =
        exp && sig
          ? await verifyPhotoAccess(tripId, photoId, pepper, exp, sig, undefined, variant)
          : false;
      const token = bearerToken(req);
      const authed = token ? await verifySessionToken(token, tripId, pepper) : false;
      if (!signed && !authed) {
        return new Response("Photos PIN required", { status: 401 });
      }
    }

    const result = await getPhoto(env, tripId, photoId, isOriginal);
    if (!result) {
      return new Response("Not found", { status: 404 });
    }

    return new Response(result.data, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": pinHash ? "private, max-age=300" : "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function handlePhotoRequest(
  req: Request,
  env: Env,
  tripId: string,
  photoId: string,
): Promise<Response> {
  return withApiHeaders(req, await respond(req, env, tripId, photoId));
}

export const onRequestGet = async (context: {
  request: Request;
  env: Env;
  params: { tripId?: string; photoId?: string };
}): Promise<Response> =>
  handlePhotoRequest(
    context.request,
    context.env,
    context.params.tripId ?? "",
    context.params.photoId ?? "",
  );
