import { z } from 'zod';
import { PDFDocument } from 'pdf-lib';
import { db } from './db';
import {
  type Actor,
  roles,
  requireClient,
  clientScope,
  HttpError,
  passwordHash,
  publicUser,
  audit,
} from './auth';
import { clientInput, staffInput, json } from './validation';
import { store, retrieve, removeStored, validateFile } from './storage';
export async function profiles(
  actor: Actor,
  path: string[],
  req: Request,
): Promise<Response | null> {
  const [resource, id, action] = path;
  const method = req.method;
  if (resource === 'clients') {
    if (method === 'GET' && !id)
      return Response.json(
        await db.client.findMany({
          where: clientScope(actor),
          include: {
            assignments: { include: { user: { select: { id: true, name: true, role: true } } } },
          },
          orderBy: { name: 'asc' },
        }),
      );
    if (method === 'POST' && !id) {
      roles(actor, 'ADMIN');
      const client = await db.client.create({
        data: { ...clientInput.parse(await json(req)), orgId: actor.orgId },
      });
      await audit(actor, 'client.create', client.id);
      return Response.json(client, { status: 201 });
    }
    if (id) {
      const client = await requireClient(actor, id);
      if (method === 'GET')
        return Response.json({
          ...client,
          assignments: await db.assignment.findMany({
            where: { clientId: id },
            include: { user: { select: { id: true, name: true, role: true } } },
          }),
        });
      if (method === 'PATCH') {
        roles(actor, 'ADMIN');
        const result = await db.client.update({
          where: { id },
          data: clientInput.parse(await json(req)),
        });
        await audit(actor, 'client.update', id);
        return Response.json(result);
      }
      if (action === 'assignments' && method === 'POST') {
        roles(actor, 'ADMIN');
        const input = z
          .object({ userId: z.string().min(1), remove: z.boolean().default(false) })
          .parse(await json(req));
        const staff = await db.user.findFirst({
          where: { id: input.userId, orgId: actor.orgId, status: 'Active' },
        });
        if (!staff) throw new HttpError(404, 'Staff member not found.');
        if (input.remove)
          await db.assignment.deleteMany({ where: { clientId: id, userId: staff.id } });
        else
          await db.assignment.upsert({
            where: { clientId_userId: { clientId: id, userId: staff.id } },
            update: {},
            create: { clientId: id, userId: staff.id },
          });
        await audit(actor, input.remove ? 'assignment.remove' : 'assignment.create', id);
        return Response.json({ ok: true });
      }
    }
  }
  if (resource === 'staff') {
    if (method === 'GET' && !id) {
      return Response.json(
        (
          await db.user.findMany({
            where: { orgId: actor.orgId, ...(actor.role === 'ADMIN' ? {} : { id: actor.id }) },
            include: { assignments: { include: { client: { select: { id: true, name: true } } } } },
            orderBy: { name: 'asc' },
          })
        ).map(publicUser),
      );
    }
    roles(actor, 'ADMIN');
    if (method === 'POST' && !id) {
      const input = staffInput.parse(await json(req));
      if (!input.password) throw new HttpError(400, 'Initial password is required.');
      const { password, ...data } = input;
      const user = await db.user.create({
        data: { ...data, orgId: actor.orgId, passwordHash: passwordHash(password) },
      });
      await audit(actor, 'staff.create', user.id);
      return Response.json(publicUser(user), { status: 201 });
    }
    if (id && method === 'PATCH') {
      const user = await db.user.findFirst({ where: { id, orgId: actor.orgId } });
      if (!user) throw new HttpError(404, 'Staff not found.');
      const { password, ...data } = staffInput.parse(await json(req));
      if (id === actor.id && (data.status !== 'Active' || data.role !== 'ADMIN'))
        throw new HttpError(400, 'You cannot deactivate or demote your own administrator account.');
      const result = await db.$transaction(async (tx) => {
        const u = await tx.user.update({
          where: { id },
          data: { ...data, ...(password ? { passwordHash: passwordHash(password) } : {}) },
        });
        if (password || data.status !== 'Active' || data.role !== user.role)
          await tx.authSession.deleteMany({ where: { userId: id } });
        return u;
      });
      await audit(actor, 'staff.update', id);
      return Response.json(publicUser(result));
    }
  }
  if (resource === 'documents') {
    if (method === 'GET' && !id) {
      return Response.json(
        await db.document.findMany({
          where: {
            orgId: actor.orgId,
            ...(actor.role === 'ADMIN'
              ? {}
              : { OR: [{ client: clientScope(actor) }, { staffId: actor.id }] }),
          },
          select: {
            id: true,
            name: true,
            category: true,
            mimeType: true,
            size: true,
            createdAt: true,
            clientId: true,
            staffId: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
      );
    }
    if (method === 'POST' && !id) {
      const input = z
        .object({
          clientId: z.string().optional(),
          staffId: z.string().optional(),
          name: z
            .string()
            .min(1)
            .max(200)
            .regex(/^[^\x00-\x1F\x7F/\\]+$/),
          category: z.enum([
            'Assessment',
            'Treatment plan',
            'Authorization',
            'Certification',
            'License',
            'Other',
          ]),
          mimeType: z.enum(['application/pdf', 'image/png', 'image/jpeg']),
          data: z.string().max(7000000),
        })
        .refine(
          (v) => Boolean(v.clientId) !== Boolean(v.staffId),
          'Choose one client or staff owner',
        )
        .parse(await json(req));
      if (input.clientId) await requireClient(actor, input.clientId);
      if (input.staffId) {
        if (actor.role !== 'ADMIN' && input.staffId !== actor.id)
          throw new HttpError(403, 'Cannot upload to another staff profile.');
        if (!(await db.user.findFirst({ where: { id: input.staffId, orgId: actor.orgId } })))
          throw new HttpError(404, 'Staff not found.');
      }
      const buffer = Buffer.from(input.data, 'base64');
      validateFile(buffer, input.mimeType);
      const key = await store(buffer);
      try {
        const doc = await db.document.create({
          data: {
            orgId: actor.orgId,
            clientId: input.clientId,
            staffId: input.staffId,
            name: input.name,
            category: input.category,
            mimeType: input.mimeType,
            size: buffer.length,
            storageKey: key,
            uploadedBy: actor.id,
          },
        });
        await audit(actor, 'document.upload', doc.id);
        return Response.json({ id: doc.id }, { status: 201 });
      } catch (e) {
        await removeStored(key);
        throw e;
      }
    }
    if (id && method === 'GET') {
      const doc = await db.document.findFirst({ where: { id, orgId: actor.orgId } });
      if (!doc) throw new HttpError(404, 'Document not found.');
      if (doc.clientId) await requireClient(actor, doc.clientId);
      else if (actor.role !== 'ADMIN' && doc.staffId !== actor.id)
        throw new HttpError(404, 'Document not found.');
      await audit(actor, 'document.download', id);
      return new Response(new Uint8Array(await retrieve(doc.storageKey)), {
        headers: {
          'Content-Type': doc.mimeType,
          'Content-Disposition': `attachment; filename="${doc.name.replace(/[^\w. -]/g, '_')}"`,
          'Cache-Control': 'private, no-store',
        },
      });
    }
  }
  if (resource === 'settings') {
    roles(actor, 'ADMIN');
    if (id === 'logo' && method === 'POST') {
      const input = z
        .object({ mimeType: z.enum(['image/png', 'image/jpeg']), data: z.string().max(750000) })
        .parse(await json(req));
      const bytes = Buffer.from(input.data, 'base64');
      validateFile(bytes, input.mimeType);
      if (bytes.length > 512000) throw new HttpError(400, 'Agency logos must be under 500 KB.');
      try {
        const pdf = await PDFDocument.create();
        if (input.mimeType === 'image/png') await pdf.embedPng(bytes);
        else await pdf.embedJpg(bytes);
      } catch {
        throw new HttpError(400, 'This image could not be read. Choose another PNG or JPEG.');
      }
      const key = await store(bytes);
      try {
        await db.organization.update({
          where: { id: actor.orgId },
          data: { logoKey: key, logoMimeType: input.mimeType },
        });
      } catch (e) {
        await removeStored(key);
        throw e;
      }
      await audit(actor, 'organization.logo', actor.orgId);
      return Response.json({ ok: true });
    }

    if (method === 'GET')
      return Response.json({
        organization: await db.organization.findUnique({ where: { id: actor.orgId } }),
        audit: await db.auditLog.findMany({
          where: { orgId: actor.orgId },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
      });
    if (method === 'PATCH') {
      const data = z
        .object({
          name: z.string().trim().min(1).max(200),
          timezone: z.string().refine((v) => {
            try {
              Intl.DateTimeFormat('en', { timeZone: v });
              return true;
            } catch {
              return false;
            }
          }, 'Invalid IANA timezone'),
          requireApproval: z.boolean(),
        })
        .parse(await json(req));
      const result = await db.organization.update({ where: { id: actor.orgId }, data });
      await audit(actor, 'organization.update', actor.orgId);
      return Response.json(result);
    }
  }
  return null;
}
