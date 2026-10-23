import { z } from 'zod';
import { HttpError } from './auth';
export const text = z.string().trim().max(5000);
export const short = z.string().trim().max(200);
export const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v);
    return !isNaN(+d) && d.toISOString().slice(0, 10) === v;
  }, 'Use a valid date');
export const optionalDay = z.union([day, z.literal('')]);
export async function json(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Request body required.');
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 4_200_000) {
      await reader.cancel();
      throw new HttpError(413, 'Request is too large.');
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
export const clientInput = z
  .object({
    name: short.min(1),
    clientCode: short.min(1),
    dob: day,
    address: text.default(''),
    guardians: text.default(''),
    contact: text.default(''),
    diagnosis: text.default(''),
    insurance: short.default(''),
    authorizationStart: optionalDay.default(''),
    authorizationEnd: optionalDay.default(''),
    authorizationHours: z.coerce.number().min(0).max(100000).default(0),
    status: z.enum(['Active', 'Inactive']).default('Active'),
  })
  .refine(
    (x) =>
      !x.authorizationEnd || !x.authorizationStart || x.authorizationEnd >= x.authorizationStart,
    'Authorization end must follow its start',
  );
export const staffInput = z.object({
  name: short.min(1),
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  role: z.enum(['ADMIN', 'BCBA', 'RBT', 'BT']),
  phone: short.default(''),
  title: short.default(''),
  status: z.enum(['Active', 'Inactive']).default('Active'),
  startDate: optionalDay.default(''),
  certification: short.default(''),
  certificationExpiry: optionalDay.default(''),
  npi: short.default(''),
  availability: text.default(''),
  password: z.string().min(12).max(256).optional(),
});
