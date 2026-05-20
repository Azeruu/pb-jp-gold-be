import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool as any)
const prisma = new PrismaClient({ adapter })

async function main() {
  const sessions = await prisma.session.findMany({ take: 1, orderBy: { date: 'desc' } })
  console.log(JSON.stringify(sessions, null, 2))
}
main().finally(() => prisma.$disconnect())
