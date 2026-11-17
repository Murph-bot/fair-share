import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type Bytes = Uint8Array<ArrayBuffer>;

function fixture(name: string): Bytes {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))));
}

/** 16x8 JPEG with no metadata. */
export const plainJpeg = (): Bytes => fixture("plain.jpg");

/** 16x8 JPEG with Make/Model, a capture time, orientation 6, GPS coordinates and a comment. */
export const gpsJpeg = (): Bytes => fixture("gps-camera.jpg");

export function asLatin1(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}
