import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
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
import { Colors, type ColorTheme } from "../constants/theme";
import { useTranslation } from "../i18n";
import { photoAccessState, shouldOfferLockCta } from "../utils/photoAccess";
import { pickCompressedPhoto } from "../utils/pickPhoto";

type MomentsProps = {
  tripId: string;
  trip: PublicTrip;
  onTripLocked?: (pin: string) => void;
};

function makeStyles(colors: ColorTheme) {
  return StyleSheet.create({
    stack: {
      gap: 12,
    },
    muted: {
      color: colors.textSecondary,
      fontSize: 14,
    },
    error: {
      color: colors.negative,
      fontWeight: "600",
    },
    input: {
      minHeight: 48,
      borderWidth: 1,
      borderColor: colors.rule,
      borderRadius: 12,
      paddingHorizontal: 12,
      backgroundColor: colors.background,
      color: colors.text,
      fontSize: 16,
    },
    button: {
      minHeight: 48,
      borderRadius: 12,
      backgroundColor: colors.text,
      alignItems: "center",
      justifyContent: "center",
    },
    buttonText: {
      color: colors.background,
      fontWeight: "700",
    },
    secondary: {
      minHeight: 48,
      borderRadius: 12,
      backgroundColor: colors.backgroundElement,
      alignItems: "center",
      justifyContent: "center",
    },
    secondaryText: {
      color: colors.tint,
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
      backgroundColor: colors.backgroundElement,
    },
    tileActions: {
      flexDirection: "row",
      justifyContent: "space-between",
    },
    link: {
      color: colors.tint,
      fontWeight: "700",
    },
    danger: {
      color: colors.negative,
      fontWeight: "700",
    },
  });
}

export function Moments({ tripId, trip, onTripLocked }: MomentsProps) {
  const { t } = useTranslation();
  const [hasToken, setHasToken] = useState(false);
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const scheme = useColorScheme();
  const colors = scheme === "dark" ? Colors.dark : Colors.light;
  const styles = useMemo(() => makeStyles(colors), [colors]);

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
            setError(caught instanceof Error ? caught.message : t("Could not load photos"));
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
      setError(caught instanceof Error ? caught.message : t("Could not unlock photos"));
    } finally {
      setBusy(false);
    }
  };

  const handleLock = async () => {
    const chosen = pin.trim();
    if (chosen && !/^\d{6}$/.test(chosen)) {
      setError(t("PIN must be 6 digits"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await lockTripPhotos(tripId, chosen || undefined);
      setHasToken(true);
      setPin("");
      onTripLocked?.(result.pin);
      Alert.alert(t("Photos locked"), t("Save this PIN: {{pin}}", { pin: result.pin }));
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("Could not lock photos"));
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
      setError(caught instanceof Error ? caught.message : t("Could not upload photo"));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = (photo: PhotoRecord) => {
    Alert.alert(t("Delete this photo permanently?"), undefined, [
      { text: t("Cancel"), style: "cancel" },
      {
        text: t("Delete"),
        style: "destructive",
        onPress: () => {
          void (async () => {
            setBusy(true);
            setError(null);
            try {
              await deletePhoto(tripId, photo.id);
              await refresh();
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : t("Could not delete photo"));
            } finally {
              setBusy(false);
            }
          })();
        },
      },
    ]);
  };

  if (!ready) {
    return <Text style={styles.muted}>{t("Loading photos…")}</Text>;
  }

  if (access === "locked") {
    return (
      <View style={styles.stack}>
        <Text style={styles.muted}>{t("Enter the trip PIN to view and add photos. Expenses stay open without it.")}</Text>
        <TextInput
          value={pin}
          onChangeText={setPin}
          placeholder={t("6-digit PIN")}
          keyboardType="number-pad"
          maxLength={6}
          style={styles.input}
          accessibilityLabel={t("Photos PIN")}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable style={styles.button} onPress={() => void handleUnlock()} disabled={busy} accessibilityRole="button">
          <Text style={styles.buttonText}>{busy ? t("Unlocking…") : t("Unlock")}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      <Pressable style={styles.button} onPress={() => void handleUpload()} disabled={busy} accessibilityRole="button">
        <Text style={styles.buttonText}>{busy ? t("Working…") : t("Add a photo")}</Text>
      </Pressable>
      {offerLock ? (
        <View style={styles.stack}>
          <Text style={styles.muted}>{t("Photos on this trip are not locked with a PIN.")}</Text>
          <TextInput
            value={pin}
            onChangeText={setPin}
            placeholder={t("6-digit PIN (optional)")}
            keyboardType="number-pad"
            maxLength={6}
            style={styles.input}
            accessibilityLabel={t("Choose 6-digit PIN")}
          />
          <Pressable style={styles.secondary} onPress={() => void handleLock()} disabled={busy} accessibilityRole="button">
            <Text style={styles.secondaryText}>{t("Lock photos with a PIN")}</Text>
          </Pressable>
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {busy ? <ActivityIndicator color={colors.tint} /> : null}
      {photos.length === 0 ? <Text style={styles.muted}>{t("No photos yet. Add one above.")}</Text> : null}
      <View style={styles.grid}>
        {photos.map((photo, index) => (
          <View key={photo.id} style={styles.tile}>
            <Image
              source={{ uri: photo.thumbUrl }}
              style={styles.thumb}
              accessibilityRole="image"
              accessibilityLabel={t("Photo {{index}} of {{total}} from {{trip}}", { index: String(index + 1), total: String(photos.length), trip: trip.name })}
            />
            <View style={styles.tileActions}>
              {photo.originalUrl?.startsWith("https://") ? (
                <Pressable
                  onPress={() => void Linking.openURL(photo.originalUrl as string)}
                  accessibilityRole="link"
                  accessibilityLabel={t("Open original photo")}
                >
                  <Text style={styles.link}>{t("Original")}</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => handleDelete(photo)}
                accessibilityRole="button"
                accessibilityLabel={t("Delete photo")}
                accessibilityHint={t("Removes this photo from the trip")}
              >
                <Text style={styles.danger}>{t("Delete")}</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}
