import { getStore } from "@netlify/blobs";

export function tripsStore() {
  return getStore({ name: "trips", consistency: "strong" });
}

export function photosStore() {
  return getStore({ name: "photos", consistency: "strong" });
}

export function pinAttemptsStore() {
  return getStore({ name: "pin-attempts", consistency: "strong" });
}
