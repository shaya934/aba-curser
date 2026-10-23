import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { HttpError } from './auth';
import { storageDriver, s3Configuration } from './deployment';
export const MAX_UPLOAD_BYTES = 3_000_000;
function key() {
  const v = process.env.STORAGE_KEY;
  if (!v || !/^[a-f0-9]{64}$/i.test(v))
    throw new Error('STORAGE_KEY must contain 32 random bytes encoded as hex');
  return Buffer.from(v, 'hex');
}
function validateId(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new HttpError(404, 'File not found.');
}
function filePath(id: string) {
  validateId(id);
  return path.join(process.env.STORAGE_DIR || './var/private', id);
}
function cloud() {
  const { bucket, options } = s3Configuration();
  return { bucket, client: new S3Client(options) };
}
async function put(id: string, bytes: Buffer) {
  if (storageDriver() === 'local') {
    await mkdir(path.dirname(filePath(id)), { recursive: true, mode: 0o700 });
    await writeFile(filePath(id), bytes, { mode: 0o600, flag: 'wx' });
    return;
  }
  const { bucket, client } = cloud();
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: `brightpath/${id}`,
        Body: bytes,
        ContentType: 'application/octet-stream',
        IfNoneMatch: '*',
      }),
    );
  } finally {
    client.destroy();
  }
}
async function get(id: string) {
  if (storageDriver() === 'local') return readFile(filePath(id));
  const { bucket, client } = cloud();
  try {
    const result = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: `brightpath/${id}` }),
    );
    if (!result.Body) throw Error('Stored object has no body.');
    return Buffer.from(await result.Body.transformToByteArray());
  } finally {
    client.destroy();
  }
}
export async function store(data: Buffer) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const id = randomUUID();
  await put(id, Buffer.concat([iv, cipher.getAuthTag(), encrypted]));
  return id;
}
export async function retrieve(id: string) {
  validateId(id);
  const data = await get(id);
  const decipher = createDecipheriv('aes-256-gcm', key(), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]);
}
export async function removeStored(id: string) {
  validateId(id);
  if (storageDriver() === 'local') {
    await unlink(filePath(id)).catch((e) => {
      if (e.code !== 'ENOENT') throw e;
    });
    return;
  }
  const { bucket, client } = cloud();
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: `brightpath/${id}` }));
  } finally {
    client.destroy();
  }
}
export function validateFile(data: Buffer, mime: string) {
  if (data.length === 0 || data.length > MAX_UPLOAD_BYTES)
    throw new HttpError(400, 'Files must be between 1 byte and 3 MB.');
  const matches =
    (mime === 'application/pdf' && data.subarray(0, 5).toString() === '%PDF-') ||
    (mime === 'image/png' &&
      data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (mime === 'image/jpeg' && data[0] === 255 && data[1] === 216 && data[2] === 255);
  if (!matches) throw new HttpError(400, 'Upload a PDF, PNG, or JPEG matching its file type.');
}
