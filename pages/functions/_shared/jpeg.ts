import { ValidationError } from "../../../packages/domain/src/errors";

const NOT_JPEG = "Photos must be JPEG";
const TEXT = new TextDecoder("latin1");

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const APP0 = 0xe0;
const APP1 = 0xe1;
const APP2 = 0xe2;
const APP14 = 0xee;
const COM = 0xfe;
const ORIENTATION_TAG = 0x0112;

function startsWith(bytes: Uint8Array, offset: number, label: string): boolean {
  return TEXT.decode(bytes.subarray(offset, offset + label.length)) === label;
}

// Only JFIF, the ICC profile and Adobe's colour flag change how pixels decode.
// Every other APPn and comment segment can carry camera, GPS or free text.
function keepSegment(marker: number, bytes: Uint8Array, payload: number): boolean {
  if (marker === COM || marker === APP1) return false;
  if (marker === APP0) return startsWith(bytes, payload, "JFIF\0");
  if (marker === APP2) return startsWith(bytes, payload, "ICC_PROFILE\0");
  if (marker === APP14) return startsWith(bytes, payload, "Adobe");
  return marker < 0xe0 || marker > 0xef;
}

function readExifOrientation(bytes: Uint8Array, payload: number, end: number): number {
  if (!startsWith(bytes, payload, "Exif\0\0")) return 1;
  const tiff = payload + 6;
  if (tiff + 8 > end) return 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
  if (!little && !(bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d)) return 1;
  const ifd = tiff + view.getUint32(tiff + 4, little);
  if (ifd + 2 > end) return 1;
  const count = view.getUint16(ifd, little);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return 1;
    if (view.getUint16(entry, little) === ORIENTATION_TAG) {
      const value = view.getUint16(entry + 8, little);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

// An EXIF block holding the orientation tag and nothing else.
function orientationSegment(orientation: number): Uint8Array {
  const segment = new Uint8Array(36);
  segment.set([0xff, APP1, 0x00, 0x22]);
  segment.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 4); // "Exif\0\0"
  segment.set([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08], 10);
  segment.set([0x00, 0x01], 18);
  segment.set([0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00], 20);
  return segment;
}

// Index just past the entropy-coded data that follows a SOS header.
function scanEnd(bytes: Uint8Array, from: number): number {
  let i = from;
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const next = bytes[i + 1];
    if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
      i += 2;
    } else if (next === 0xff) {
      i += 1;
    } else {
      return i;
    }
  }
  throw new ValidationError(NOT_JPEG);
}

/**
 * Rewrites a JPEG without EXIF, GPS, XMP, IPTC, comments or trailing data. Pixel data is copied
 * byte for byte. If the source carried an orientation other than "normal", a minimal EXIF
 * block holding only that tag is written so the photo still displays upright.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== SOI) {
    throw new ValidationError(NOT_JPEG);
  }
  const chunks: Uint8Array[] = [];
  let orientation = 1;
  let sawScan = false;
  let i = 2;

  while (i < bytes.length) {
    if (bytes[i] !== 0xff) throw new ValidationError(NOT_JPEG);
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === EOI) {
      if (!sawScan) throw new ValidationError(NOT_JPEG);
      chunks.push(new Uint8Array([0xff, EOI]));
      const body = chunks.reduce((total, chunk) => total + chunk.length, 0);
      const exif = orientation > 1 ? orientationSegment(orientation) : new Uint8Array(0);
      const out = new Uint8Array(2 + exif.length + body);
      out.set([0xff, SOI]);
      out.set(exif, 2);
      let offset = 2 + exif.length;
      for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
      }
      return out;
    }
    if (marker === 0x00 || marker === SOI || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      throw new ValidationError(NOT_JPEG);
    }
    if (i + 4 > bytes.length) throw new ValidationError(NOT_JPEG);
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    const end = i + 2 + length;
    if (length < 2 || end > bytes.length) throw new ValidationError(NOT_JPEG);

    if (marker === APP1 && orientation === 1) {
      orientation = readExifOrientation(bytes, i + 4, end);
    }
    if (marker === SOS) {
      const next = scanEnd(bytes, end);
      chunks.push(bytes.subarray(i, next));
      sawScan = true;
      i = next;
      continue;
    }
    if (keepSegment(marker, bytes, i + 4)) {
      chunks.push(bytes.subarray(i, end));
    }
    i = end;
  }
  throw new ValidationError(NOT_JPEG);
}
