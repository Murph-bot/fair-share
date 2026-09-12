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
import { addNetworkStateListener } from "expo-network";

import {
  deletePhoto,
  fetchPhotos,
  lockTripPhotos,
  unlockPhotos,
  uploadPhoto,
} from "../api/photoApi";
import {
  cachePhoto,
  cachedPhotoUri,
  loadPhotoList,
  removeCachedPhoto,
  savePhotoList,
  stagePhotoForQueue,
} from "../api/photoCache";
import { enqueuePhotoUpload, flushPhotoQueue, pendingPhotoUploads, removePhotoUpload } from "../api/photoQueue";
import { isOnline } from "../api/networkStatus";
import { MAX_ORIGINAL_BYTES } from "../../../packages/domain/src/photos";
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

function newPhotoId(): string {
  let hex = "";
  for (let i = 0; i < 32; i++) {
    hex += Math.floor(Math.random() * 16).toString(16);
  }
  return hex;
}

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
    pending: {
      color: colors.tint,
      fontWeight: "700",
      fontSize: 12,
    },
  });
}

export function Moments({ tripId, trip, onTripLocked }: MomentsProps) {
  const { t } = useTranslation();
  const [hasToken, setHasToken] = useState(false);
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [cachedUris, setCachedUris] = useState<Record<string, string | null>>({});
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const scheme = useColorScheme();
  const colors = scheme === "dark" ? Colors.dark : Colors.light;
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const access = photoAccessState(trip.photos_locked, hasToken);
  const offerLock = shouldOfferLockCta(trip.photos_locked);

  const syncPhotos = useCallback(async () => {
    setError(null);
    const online = await isOnline();
    let list: PhotoRecord[];
    const uris: Record<string, string | null> = {};
    if (online) {
      await flushPhotoQueue();
      list = await fetchPhotos(tripId);
      await savePhotoList(tripId, list);
      for (const photo of list) {
        uris[photo.id] = await cachePhoto(tripId, photo);
      }
    } else {
      list = (await loadPhotoList(tripId)) ?? [];
      for (const photo of list) {
        uris[photo.id] = await cachedPhotoUri(tripId, photo.id);
      }
    }
    setPhotos(list);
    setCachedUris(uris);
    const pending = await pendingPhotoUploads(tripId);
    setPendingIds(pending.map((item) => item.photoId));
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
          await syncPhotos();
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
  }, [syncPhotos, trip.photos_locked, tripId, t]);

  // Auto-sync when connectivity returns.
  useEffect(() => {
    const subscription = addNetworkStateListener((state) => {
      if (state.isConnected && state.isInternetReachable) {
        void syncPhotos().catch(() => {
          /* next reconnect retries */
        });
      }
    });
    return () => {
      subscription.remove();
    };
  }, [syncPhotos]);

  const handleUnlock = async () => {
    setBusy(true);
    setError(null);
    try {
      await unlockPhotos(tripId, pin.trim());
      setHasToken(true);
      setPin("");
      await syncPhotos();
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
      await syncPhotos();
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
      const queuePicked = async () => {
        const photoId = newPhotoId();
        const stagedDisplay = await stagePhotoForQueue(photoId, picked.display.uri, "display");
        const stagedOriginal = picked.original?.uri
          ? await stagePhotoForQueue(photoId, picked.original.uri, "original")
          : null;
        await enqueuePhotoUpload({
          tripId,
          photoId,
          displayUri: stagedDisplay ?? picked.display.uri,
          displayName: picked.display.name,
          displayType: picked.display.type,
          originalUri: stagedOriginal ?? picked.original?.uri ?? null,
          originalName: picked.original?.name ?? null,
          originalType: picked.original?.type ?? null,
          createdAt: new Date().toISOString(),
        });
      };
      if (!(await isOnline())) {
        // Offline: queue locally, it syncs when connectivity returns.
        await queuePicked();
      } else {
        try {
          const originalSize = picked.original?.fileSize ?? 0;
          const extras =
            picked.original && originalSize > 0 && originalSize <= MAX_ORIGINAL_BYTES
              ? { original: picked.original }
              : undefined;
          await uploadPhoto(tripId, picked.display, extras);
        } catch (caught) {
          // Network dropped mid-upload: queue it like an offline pick.
          if (!(caught instanceof TypeError)) {
            throw caught;
          }
          await queuePicked();
        }
      }
      await syncPhotos();
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
              await removePhotoUpload(tripId, photo.id);
              await removeCachedPhoto(tripId, photo.id);
              await deletePhoto(tripId, photo.id);
              await syncPhotos();
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
        {photos.map((photo, index) => {
          const pending = pendingIds.includes(photo.id);
          return (
            <View key={photo.id} style={styles.tile}>
              <Image
                source={{ uri: cachedUris[photo.id] ?? photo.thumbUrl }}
                style={styles.thumb}
                accessibilityRole="image"
                accessibilityLabel={t("Photo {{index}} of {{total}} from {{trip}}", { index: String(index + 1), total: String(photos.length), trip: trip.name })}
              />
              {pending ? <Text style={styles.pending}>{t("Pending upload")}</Text> : null}
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
          );
        })}
      </View>
    </View>
  );
}
