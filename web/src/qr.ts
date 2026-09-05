import QRCode from "qrcode";

function qrColor(): { dark: string; light: string } {
  const rootStyle = getComputedStyle(document.documentElement);
  const dark = rootStyle.getPropertyValue("--ink").trim() || "#2a1c14";
  return { dark, light: "#0000" };
}

export async function showQrDialog(url: string): Promise<void> {
  const colors = qrColor();
  const dataUrl = await QRCode.toDataURL(url, {
    width: 240,
    margin: 2,
    color: colors,
  });

  const dialog = document.createElement("dialog");
  dialog.className = "qr-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "Trip QR code");
  dialog.innerHTML = `
    <form method="dialog" class="qr-close-form">
      <button type="submit" class="secondary">Close</button>
    </form>
    <div class="qr-body">
      <img src="${dataUrl}" alt="QR code for the trip link" width="240" height="240">
      <p class="muted small">Scan to open this trip.</p>
    </div>
  `;

  dialog.addEventListener("close", () => {
    dialog.remove();
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });

  document.body.appendChild(dialog);
  dialog.showModal();
}
