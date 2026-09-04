import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  deletePhoto,
  fetchPhotos,
  lockTripPhotos,
  signOriginalUpload,
  unlockPhotos,
  uploadOriginalToCloudinary,
  uploadPhoto,
} from "../api/photoApi";
import { loadPhotoToken } from "../api/photoSession";
import type { PhotoRecord, PublicTrip } from "../domain/photos";
import { photoAccessState, shouldOfferLockCta } from "../utils/photoAccess";
import { pickCompressedPhoto } from "../utils/pickPhoto";

type MomentsProps = {
  tripId: string;
  trip: PublicTrip;
  onTripLocked?: (pin: string) => void;
};

export function Moments({ tripId, trip, onTripLocked }: MomentsProps) {
  const [hasToken, setHasToken] = useState(false);
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  const access = photoAccessState(trip.photos_locked, hasToken);
  const offerLock = shouldOfferLockCta(trip.photos_locked);

  const refresh = useCallback(async () => {
    setError(null);
    const photosList = await fetchPhotos(tripId);
    setPhotos(photosList);
  }, [tripId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const token = await loadPhotoToken(tripId);
      if (cancelled) {
        return;
      }
      setHasToken(Boolean(token));
      setReady(true);
      if (photoAccessState(trip.photos_locked, Boolean(token)) === "unlocked") {
        try {
          await refresh();
        } catch (caught) {
          if (!cancelled) {
            setError(caught instanceof Error ? caught.message : "Could not load photos");
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh, trip.photos_locked, tripId]);

  const handleUnlock = async () => {
    setBusy(true);
    setError(null);
    try {
      await unlockPhotos(tripId, pin.trim());
      setHasToken(true);
      setPin("");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not unlock photos");
    } finally {
      setBusy(false);
    }
  };

  const handleLock = async () => {
    const chosen = pin.trim();
    if (chosen && !/^\d{6}$/.test(chosen)) {
      setError("PIN must be 6 digits");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await lockTripPhotos(tripId, chosen || undefined);
      setHasToken(true);
      setPin("");
      onTripLocked?.(result.pin);
      Alert.alert("Photos locked", `Save this PIN: ${result.pin}`);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not lock photos");
    } finally {
      setBusy(false);
    }
  };

  const handleUpload = async () => {
    setBusy(true);
    setError(null);
    try {
      const picked = await pickCompressedPhoto();
      if (!picked) {
        return;
      }
      let extras: { photoId?: string; cloudinaryId?: string } | undefined;
      const originalSize = picked.original.fileSize ?? 0;
      if (originalSize > 0) {
        try {
          const sign = await signOriginalUpload(tripId);
          if (originalSize <= sign.maxFileSize) {
            const cloudinaryId = await uploadOriginalToCloudinary(picked.original, sign);
            extras = { photoId: sign.photoId, cloudinaryId };
          }
        } catch {
          extras = undefined;
        }
      }
      await uploadPhoto(tripId, picked.display, extras);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not upload photo");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = (photo: PhotoRecord) => {
    Alert.alert("Delete this photo permanently?", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void (async () => {
            setBusy(true);
            setError(null);
            try {
              await deletePhoto(tripId, photo.id);
              await refresh();
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : "Could not delete photo");
            } finally {
              setBusy(false);
            }
          })();
        },
      },
    ]);
  };

  if (!ready) {
    return <Text style={styles.muted}>Loading photos…</Text>;
  }

  if (access === "locked") {
    return (
      <View style={styles.stack}>
        <Text style={styles.muted}>Enter the trip PIN to view and add photos. Expenses stay open without it.</Text>
        <TextInput
          value={pin}
          onChangeText={setPin}
          placeholder="6-digit PIN"
          keyboardType="number-pad"
          maxLength={6}
          style={styles.input}
          accessibilityLabel="Photos PIN"
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable style={styles.button} onPress={() => void handleUnlock()} disabled={busy} accessibilityRole="button">
          <Text style={styles.buttonText}>{busy ? "Unlocking…" : "Unlock"}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      <Pressable style={styles.button} onPress={() => void handleUpload()} disabled={busy} accessibilityRole="button">
        <Text style={styles.buttonText}>{busy ? "Working…" : "Add a photo"}</Text>
      </Pressable>
      {offerLock ? (
        <View style={styles.stack}>
          <Text style={styles.muted}>Photos on this trip are not locked with a PIN.</Text>
          <TextInput
            value={pin}
            onChangeText={setPin}
            placeholder="6-digit PIN (optional)"
            keyboardType="number-pad"
            maxLength={6}
            style={styles.input}
            accessibilityLabel="Choose 6-digit PIN"
          />
          <Pressable style={styles.secondary} onPress={() => void handleLock()} disabled={busy} accessibilityRole="button">
            <Text style={styles.secondaryText}>Lock photos with a PIN</Text>
          </Pressable>
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {busy ? <ActivityIndicator color="#7c4a20" /> : null}
      {photos.length === 0 ? <Text style={styles.muted}>No photos yet.</Text> : null}
      <View style={styles.grid}>
        {photos.map((photo) => (
          <View key={photo.id} style={styles.tile}>
            <Image source={{ uri: photo.thumbUrl }} style={styles.thumb} accessibilityLabel="Trip photo" />
            <View style={styles.tileActions}>
              {photo.originalUrl?.startsWith("https://") ? (
                <Pressable onPress={() => void Linking.openURL(photo.originalUrl as string)} accessibilityRole="link">
                  <Text style={styles.link}>Original</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={() => handleDelete(photo)} accessibilityRole="button" accessibilityLabel="Delete photo">
                <Text style={styles.danger}>Delete</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: 12,
  },
  muted: {
    color: "#6b7280",
    fontSize: 14,
  },
  error: {
    color: "#b91c1c",
    fontWeight: "600",
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: "#d6c7b0",
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: "#fff",
    fontSize: 16,
  },
  button: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: "#7c4a20",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    color: "#fff",
    fontWeight: "700",
  },
  secondary: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: "#efe5d4",
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: {
    color: "#5c3b1e",
    fontWeight: "700",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  tile: {
    width: "47%",
    gap: 8,
  },
  thumb: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 12,
    backgroundColor: "#efe5d4",
  },
  tileActions: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  link: {
    color: "#7c4a20",
    fontWeight: "700",
  },
  danger: {
    color: "#b91c1c",
    fontWeight: "700",
  },
});
