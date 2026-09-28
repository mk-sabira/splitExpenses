import { randomBytes } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RequestHandler } from "express";
import multer from "multer";
import { config } from "../config";
import { HttpError } from "../lib/errors";

// Receipt files on local disk (D36). One per expense, stored under a random
// name in config.uploadsDir; the database keeps the name, the detected type,
// the uploader's file name and the size.

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

const TYPES = [
  { mime: "image/jpeg", ext: ".jpg", matches: (b: Buffer) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: "image/png",
    ext: ".png",
    matches: (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: "image/webp",
    ext: ".webp",
    matches: (b: Buffer) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  },
  { mime: "application/pdf", ext: ".pdf", matches: (b: Buffer) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
] as const;

// By the file's first bytes. The name and the Content-Type the browser sent
// are ignored: both are whatever the client says.
export function detectReceiptType(bytes: Buffer) {
  return TYPES.find((t) => t.matches(bytes)) ?? null;
}

export interface StoredReceipt {
  receiptPath: string;
  receiptMime: string;
  receiptName: string;
  receiptSize: number;
}

// Parses an optional "receipt" file from a multipart request into memory,
// capped at 5 MB; JSON requests pass through untouched. The expense itself
// arrives as JSON in the "expense" field.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_RECEIPT_BYTES, files: 1, fields: 2, fieldSize: 200_000, parts: 3 },
  defParamCharset: "utf8",
}).single("receipt");

export const receiptUpload: RequestHandler = (req, res, next) => {
  upload(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") return next(new HttpError(413, "The receipt is too big: 5 MB at most."));
      if (err.code === "LIMIT_UNEXPECTED_FILE") return next(new HttpError(400, 'Send the receipt in a field named "receipt", one file only.'));
      return next(new HttpError(400, `Invalid upload: ${err.message}`));
    }
    next(err);
  });
};

// Checks the uploaded file and writes it to disk under a random name.
export async function storeReceipt(file: Express.Multer.File): Promise<StoredReceipt> {
  const type = detectReceiptType(file.buffer);
  if (!type) throw new HttpError(415, "A receipt must be a JPEG, PNG or WebP image, or a PDF.");
  const receiptPath = randomBytes(16).toString("hex") + type.ext;
  await mkdir(config.uploadsDir, { recursive: true });
  await writeFile(receiptFile(receiptPath), file.buffer, { flag: "wx" });
  return { receiptPath, receiptMime: type.mime, receiptName: displayName(file.originalname, type.ext), receiptSize: file.size };
}

// Absolute path of a stored receipt. Names are always ours (hex + extension),
// but refuse anything else rather than trust the database blindly.
export function receiptFile(receiptPath: string) {
  if (!/^[0-9a-f]{32}\.(jpg|png|webp|pdf)$/.test(receiptPath)) throw new Error(`Bad receipt path ${receiptPath}`);
  return path.join(config.uploadsDir, receiptPath);
}

// Never throws: a file that can't be removed is only wasted space.
export async function deleteReceiptFile(receiptPath: string | null | undefined) {
  if (!receiptPath) return;
  try {
    await unlink(receiptFile(receiptPath));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.error("[receipts] couldn't delete", receiptPath, err);
  }
}

// Stores the file (if any), runs `fn`, and removes the file again if `fn`
// fails, so a rejected expense write leaves nothing behind.
export async function withStoredReceipt<T>(
  file: Express.Multer.File | undefined,
  fn: (receipt: StoredReceipt | null) => Promise<T>,
): Promise<T> {
  const receipt = file ? await storeReceipt(file) : null;
  try {
    return await fn(receipt);
  } catch (err) {
    await deleteReceiptFile(receipt?.receiptPath);
    throw err;
  }
}

// The uploader's file name, only ever shown back as text: no directories or
// control characters, a sane length, and an extension that matches the content.
function displayName(original: string, ext: string) {
  const base = path.basename(original.replace(/\\/g, "/")).replace(/[\u0000-\u001f\u007f"]/g, "").trim();
  const stem = base.replace(/\.[^.]*$/, "").slice(0, 100) || "receipt";
  return stem + ext;
}
