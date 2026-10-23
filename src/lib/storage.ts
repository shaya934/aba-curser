import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from './auth';
function key() {
  const v = process.env.STORAGE_KEY;
  if (!v || !/^[a-f0-9]{64}$/i.test(v))
    throw new Error('STORAGE_KEY must contain 32 random bytes encoded as hex');
  return Buffer.from(v, 'hex');
}
function filePath(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new HttpError(404, 'File not found.');
  return path.join(process.env.STORAGE_DIR || './var/private', id);
}
export async function store(data: Buffer) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const id = randomUUID();
  await mkdir(path.dirname(filePath(id)), { recursive: true, mode: 0o700 });
  await writeFile(filePath(id), Buffer.concat([iv, cipher.getAuthTag(), encrypted]), {
    mode: 0o600,
    flag: 'wx',
  });
  return id;
}
export async function retrieve(id: string) {
  const data = await readFile(filePath(id));
  const decipher = createDecipheriv('aes-256-gcm', key(), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]);
}
export async function removeStored(id: string) {
  await unlink(filePath(id)).catch(() => undefined);
}
export function validateFile(data: Buffer, mime: string) {
  if (data.length === 0 || data.length > 5 * 1024 * 1024)
    throw new HttpError(400, 'Files must be between 1 byte and 5 MB.');
  const matches =
    (mime === 'application/pdf' && data.subarray(0, 5).toString() === '%PDF-') ||
    (mime === 'image/png' &&
      data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (mime === 'image/jpeg' && data[0] === 255 && data[1] === 216 && data[2] === 255);
  if (!matches) throw new HttpError(400, 'Upload a PDF, PNG, or JPEG matching its file type.');
}
