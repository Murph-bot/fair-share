import type { Config, Context } from "@netlify/functions";
import { ValidationError } from "../../web/src/domain/errors";
import {
  createSessionToken,
  generatePin,
  hashPin,
  normalizePin,
  pinMatches,
} from "../../web/src/domain/pin";
import { createTrip, newTripId, parseTrip, TRIP_ID_RE, type Trip } from "../../web/src/domain/trip";
import {
  assertPinAllowed,
  clearPinFailures,
  errorResponse,
  json,
  pinHashFromRecord,
  pinPepper,
  publicTrip,
  readJsonBody,
  recordPinFailure,
} from "./_shared/http";
import { tripsStore } from "./_shared/stores";

export default async (req: Request, context: Context) => {
  try {
    const id = context.params?.id;
    const store = tripsStore();

    if (req.method === "POST" && !id) {
      const payload = await readJsonBody(req);
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        throw new ValidationError("Body must be an object");
      }
      const name = (payload as { name?: unknown }).name;
      if (typeof name !== "string") {
        throw new ValidationError("Trip name is required");
      }
      const trip = createTrip(name);
      const tripId = newTripId();
      const pepper = pinPepper();
      const pin = generatePin();
      const pin_hash = await hashPin(pin, tripId, pepper);
      await store.setJSON(tripId, { ...trip, pin_hash });
      const photos_token = await createSessionToken(tripId, pepper);
      return json(201, { id: tripId, trip: publicTrip(trip, true), pin, photos_token });
    }

    if (!id || !TRIP_ID_RE.test(id)) {
      return json(404, { error: "Trip not found" });
    }

    const sessionPath = new URL(req.url).pathname.endsWith("/session");
    if (req.method === "POST" && sessionPath) {
      return handleSession(req, id, context.ip ?? "unknown");
    }
    if (sessionPath) {
      return json(405, { error: "Method not allowed" });
    }

    if (req.method === "GET") {
      const raw = await store.get(id, { type: "json" });
      if (raw === null) {
        return json(404, { error: "Trip not found" });
      }
      return json(200, publicTrip(parseTrip(raw), Boolean(pinHashFromRecord(raw))));
    }

    if (req.method === "PUT") {
      const existing = await store.get(id, { type: "json" });
      if (existing === null) {
        return json(404, { error: "Trip not found" });
      }
      const trip: Trip = parseTrip(await readJsonBody(req));
      const pin_hash = pinHashFromRecord(existing);
      await store.setJSON(id, pin_hash ? { ...trip, pin_hash } : trip);
      return json(200, publicTrip(trip, Boolean(pin_hash)));
    }

    return json(405, { error: "Method not allowed" });
  } catch (err) {
    return errorResponse(err);
  }
};

async function handleSession(req: Request, tripId: string, ip: string): Promise<Response> {
  const store = tripsStore();
  const raw = await store.get(tripId, { type: "json" });
  if (raw === null) {
    return json(404, { error: "Trip not found" });
  }
  const pin_hash = pinHashFromRecord(raw);
  if (!pin_hash) {
    throw new ValidationError("This trip does not lock photos");
  }

  const payload = await readJsonBody(req);
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new ValidationError("Body must be an object");
  }
  const pin = normalizePin(String((payload as { pin?: unknown }).pin ?? ""));
  if (!pin) {
    throw new ValidationError("PIN must be 6 digits");
  }

  await assertPinAllowed(tripId, ip);
  const pepper = pinPepper();
  if (!(await pinMatches(pin, tripId, pepper, pin_hash))) {
    await recordPinFailure(tripId, ip);
    return json(401, { error: "Wrong PIN" });
  }
  await clearPinFailures(tripId, ip);
  const token = await createSessionToken(tripId, pepper);
  return json(200, { token });
}

export const config: Config = {
  path: ["/api/trips", "/api/trips/:id", "/api/trips/:id/session"],
};
