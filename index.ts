import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { cors } from 'hono/cors'
import { PrismaClient } from '@prisma/client'
import { clerkMiddleware, getAuth } from '@hono/clerk-auth'
import * as dotenv from 'dotenv'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'

dotenv.config()

const app = new Hono()

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool as any)
const prisma = new PrismaClient({ adapter })

// Middleware
app.use('*', cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}))
app.use('*', clerkMiddleware())

// Routes
app.get('/', (c) => c.text('Badminton Tracker API with Prisma'))

// Get all sessions - PUBLIC ACCESS
app.get('/sessions', async (c) => {
  try {
    const sessions = await prisma.session.findMany({
      include: {
        expenses: true,
        players: true
      },
      orderBy: {
        date: 'desc'
      }
    })
    return c.json(sessions)
  } catch (error: any) {
    console.error('Fetch error:', error)
    return c.json({ error: 'Failed to fetch sessions' }, 500)
  }
})

// Create a new session - AUTH REQUIRED
app.post('/sessions', async (c) => {
  const auth = getAuth(c)
  const userId = auth?.userId

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  // Get user info from Clerk (Hono clerk auth might not have full info, but we can try)
  // For now, let's assume frontend sends user_name and user_email if we need them,
  // or we can just use the userId and let the frontend handle display if it has user info.
  // Actually, Session model has user_name and user_email.
  
  const body = await c.req.json()
  const { date, initial_cash, shuttlecocks_remaining, expenses, players, user_name, user_email } = body

  if (!date || initial_cash === undefined) {
    return c.json({ error: 'Missing required fields' }, 400)
  }

  try {
    const session = await prisma.session.create({
      data: {
        date: new Date(date),
        initial_cash,
        shuttlecocks_remaining,
        user_id: userId,
        user_name,
        user_email,
        expenses: {
          create: expenses?.map((e: any) => ({
            name: e.name,
            amount: e.amount
          })) || []
        },
        players: {
          create: players?.map((p: any) => ({
            name: p.name,
            contribution_amount: p.contribution_amount || 20000,
            has_paid: p.has_paid ?? true
          })) || []
        }
      },
      include: {
        expenses: true,
        players: true
      }
    })

    return c.json(session, 201)
  } catch (error) {
    console.error('Session creation error:', error)
    return c.json({ error: 'Failed to create session' }, 500)
  }
})

// Update a session - OWNER ONLY
app.put('/sessions/:id', async (c) => {
  const auth = getAuth(c)
  const userId = auth?.userId
  const id = c.req.param('id')

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  try {
    const existingSession = await prisma.session.findUnique({
      where: { id }
    })

    if (!existingSession || existingSession.user_id !== userId) {
      return c.json({ error: 'Session not found or unauthorized' }, 404)
    }

    const body = await c.req.json()
    const { date, initial_cash, shuttlecocks_remaining, expenses, players, user_name, user_email } = body

    const updatedSession = await prisma.$transaction(async (tx) => {
      // 1. Delete existing expenses and players
      await tx.expense.deleteMany({ where: { session_id: id } })
      await tx.player.deleteMany({ where: { session_id: id } })

      // 2. Update session and create new nested records
      return await tx.session.update({
        where: { id },
        data: {
          date: new Date(date),
          initial_cash,
          shuttlecocks_remaining,
          user_name,
          user_email,
          expenses: {
            create: expenses?.map((e: any) => ({
              name: e.name,
              amount: e.amount
            })) || []
          },
          players: {
            create: players?.map((p: any) => ({
              name: p.name,
              contribution_amount: p.contribution_amount || 20000,
              has_paid: p.has_paid ?? true
            })) || []
          }
        },
        include: {
          expenses: true,
          players: true
        }
      })
    })

    return c.json(updatedSession)
  } catch (error) {
    console.error('Update error:', error)
    return c.json({ error: 'Failed to update session' }, 500)
  }
})

// Delete a session - OWNER ONLY
app.delete('/sessions/:id', async (c) => {
  const auth = getAuth(c)
  const userId = auth?.userId
  const id = c.req.param('id')

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  try {
    const session = await prisma.session.findUnique({
      where: { id }
    })

    if (!session || session.user_id !== userId) {
      return c.json({ error: 'Session not found or unauthorized' }, 404)
    }

    await prisma.session.delete({
      where: { id }
    })

    return c.json({ message: 'Session deleted successfully' })
  } catch (error) {
    console.error('Delete error:', error)
    return c.json({ error: 'Failed to delete session' }, 500)
  }
})

const port = Number(process.env.PORT) || 3000
console.log(`Server is running on port ${port}`)

serve({
  fetch: app.fetch,
  port
})
