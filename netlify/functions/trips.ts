import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { FairShareError, ValidationError } from "../../web/src/domain/errors";
import { createTrip, newTripId, parseTrip, TRIP_ID_RE, type Trip } from "../../web/src/domain/trip";

const MAX_BODY_BYTES = 200_000;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function tripsStore() {
  return getStore({ name: "trips", consistency: "strong" });
}

async function readBody(req: Request): Promise<unknown> {
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    throw new ValidationError("Payload is too large");
  }
  if (!raw.trim()) {
    throw new ValidationError("Request body is required");
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ValidationError("Invalid JSON");
  }
}

function errorResponse(err: unknown): Response {
  if (err instanceof FairShareError) {
    return json(400, { error: err.message });
  }
  return json(500, { error: "Something went wrong" });
}

export default async (req: Request, context: Context) => {
  try {
    const id = context.params?.id;
    const store = tripsStore();

    if (req.method === "POST" && !id) {
      const payload = await readBody(req);
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        throw new ValidationError("Body must be an object");
      }
      const name = (payload as { name?: unknown }).name;
      if (typeof name !== "string") {
        throw new ValidationError("Trip name is required");
      }
      const trip = createTrip(name);
      const tripId = newTripId();
      await store.setJSON(tripId, trip);
      return json(201, { id: tripId, trip });
    }

    if (!id || !TRIP_ID_RE.test(id)) {
      return json(404, { error: "Trip not found" });
    }

    if (req.method === "GET") {
      const trip = await store.get(id, { type: "json" });
      if (trip === null) {
        return json(404, { error: "Trip not found" });
      }
      return json(200, parseTrip(trip));
    }

    if (req.method === "PUT") {
      const existing = await store.get(id, { type: "json" });
      if (existing === null) {
        return json(404, { error: "Trip not found" });
      }
      const trip: Trip = parseTrip(await readBody(req));
      await store.setJSON(id, trip);
      return json(200, trip);
    }

    return json(405, { error: "Method not allowed" });
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = {
  path: ["/api/trips", "/api/trips/:id"],
};
