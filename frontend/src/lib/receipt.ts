// Receipt rules, mirrored from the backend (D36) so the form can say what's
// wrong before uploading. The server checks again, by the file's content.
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
export const RECEIPT_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf";

const OK_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const OK_NAME = /\.(jpe?g|png|webp|pdf)$/i;

export function checkReceipt(file: File): string | null {
  if (!OK_TYPES.has(file.type) && !OK_NAME.test(file.name)) return "A receipt must be a JPEG, PNG or WebP image, or a PDF.";
  if (file.size > MAX_RECEIPT_BYTES) return `The receipt is too big (${formatBytes(file.size)}): 5 MB at most.`;
  if (file.size === 0) return "That file is empty.";
  return null;
}

// "820 B", "48 KB", "2.4 MB"
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
