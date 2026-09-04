import { PHOTO_MAX_EDGE } from "../domain/photos";
import type { PhotoPart } from "../api/photoApi";

export type PickedPhoto = {
  display: PhotoPart & { uri: string };
  original: PhotoPart & { uri: string; fileSize?: number };
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

  return {
    display: {
      uri: compressed.uri,
      name: "photo.jpg",
      type: "image/jpeg",
    },
    original: {
      uri: asset.uri,
      name: asset.fileName || "original.jpg",
      type: asset.mimeType || "image/jpeg",
      fileSize: asset.fileSize,
    },
  };
}
