export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function onOfflineChange(callback: (offline: boolean) => void): () => void {
  const update = (): void => callback(isOffline());
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  update();
  return () => {
    window.removeEventListener("online", update);
    window.removeEventListener("offline", update);
  };
}
