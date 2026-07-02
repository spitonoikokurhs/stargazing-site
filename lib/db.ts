import { PrismaClient } from '@prisma/client'

// Standard Next.js singleton pattern: in dev, module reloads on every edit
// would each spawn a new PrismaClient (and exhaust DB connections), so we
// cache the instance on globalThis. In production each serverless instance
// creates exactly one client anyway.
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
