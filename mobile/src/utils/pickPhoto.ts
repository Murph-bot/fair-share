import { PHOTO_MAX_EDGE } from "../domain/photos";

export type PickedPhoto = {
  display: { uri: string; name: string; type: string };
  original: { uri: string; name: string; type: string; fileSize?: number } | null;
};

export async function pickCompressedPhoto(): Promise<PickedPhoto | null> {
  const ImagePicker = await import("expo-image-picker");
  const ImageManipulator = await import("expo-image-manipulator");

  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error("Photo library permission is required to add a moment");
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 1,
    allowsEditing: false,
  });
  if (result.canceled || !result.assets[0]) {
    return null;
  }

  const asset = result.assets[0];
  const width = asset.width || PHOTO_MAX_EDGE;
  const height = asset.height || PHOTO_MAX_EDGE;
  const longest = Math.max(width, height);
  const actions =
    longest > PHOTO_MAX_EDGE
      ? [{ resize: width >= height ? { width: PHOTO_MAX_EDGE } : { height: PHOTO_MAX_EDGE } }]
      : [];

  const compressed = await ImageManipulator.manipulateAsync(asset.uri, actions, {
    compress: 0.82,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  // The server accepts JPEG originals only. Keep real JPEGs untouched; convert
  // anything else (HEIC, PNG, WebP) to a full-resolution JPEG so the upload
  // can't fail and the original is still preserved.
  const mime = asset.mimeType ?? "";
  const looksJpeg =
    mime === "image/jpeg" || mime === "image/jpg" || (!mime && /\.jpe?g$/i.test(asset.fileName ?? ""));
  let original: PickedPhoto["original"] = null;
  if (looksJpeg) {
    original = {
      uri: asset.uri,
      name: asset.fileName || "original.jpg",
      type: "image/jpeg",
      fileSize: asset.fileSize,
    };
  } else {
    try {
      const converted = await ImageManipulator.manipulateAsync(asset.uri, [], {
        compress: 0.95,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      const { File } = await import("expo-file-system");
      const size = new File(converted.uri).size;
      original = {
        uri: converted.uri,
        name: "original.jpg",
        type: "image/jpeg",
        fileSize: typeof size === "number" ? size : undefined,
      };
    } catch {
      original = null;
    }
  }

  return {
    display: {
      uri: compressed.uri,
      name: "photo.jpg",
      type: "image/jpeg",
    },
    original,
  };
}
