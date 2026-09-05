type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let installEvent: BeforeInstallPromptEvent | null = null;

export function captureInstallPrompt(event: Event): void {
  event.preventDefault();
  installEvent = event as BeforeInstallPromptEvent;
}

export function getInstallPrompt(): BeforeInstallPromptEvent | null {
  return installEvent;
}

export async function runInstallPrompt(): Promise<{ outcome: "accepted" | "dismissed" } | null> {
  if (!installEvent) {
    return null;
  }
  await installEvent.prompt();
  const choice = await installEvent.userChoice;
  installEvent = null;
  return choice;
}

export function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (window.navigator as { standalone?: boolean }).standalone === true;
}
