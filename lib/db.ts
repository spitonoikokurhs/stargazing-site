import { PrismaClient } from '@prisma/client'

// schema.prisma's datasource reads env("DATABASE_URL"), but Vercel's Neon
// integration auto-provisions POSTGRES_PRISMA_URL (the pooled connection
// string) and NOT a bare DATABASE_URL — that has to be added by hand, and was
// briefly missing in production, taking down every DB-backed route with a
// PrismaClientInitializationError. Fall back to POSTGRES_PRISMA_URL so a
// missing manual DATABASE_URL degrades to "still works". Passed explicitly to
// the constructor rather than assigned onto process.env.DATABASE_URL: Prisma
// reads the connection string at client construction, so mutating process.env
// is order-dependent on when this module first runs relative to that read —
// passing the value directly is deterministic regardless of import order.
const url = process.env.DATABASE_URL ?? process.env.POSTGRES_PRISMA_URL

// Standard Next.js singleton pattern: in dev, module reloads on every edit
// would each spawn a new PrismaClient (and exhaust DB connections), so we
// cache the instance on globalThis. In production each serverless instance
// creates exactly one client anyway.
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }

const prismaOptions = url ? { datasources: { db: { url } } } : undefined

export const prisma = globalForPrisma.prisma ?? new PrismaClient(prismaOptions)

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
