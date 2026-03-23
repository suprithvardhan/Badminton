import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// Get all players for search/selection
router.get('/', authenticateToken, async (req, res) => {
  try {
    const players = await prisma.player.findMany({
      include: {
        user: { select: { name: true, email: true, avatar: true } }
      }
    });
    res.json(players);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get player leaderboard
router.get('/leaderboard', async (req, res) => {
  try {
    const players = await prisma.player.findMany({
      orderBy: [
        { elo: 'desc' },
        { wins: 'desc' }
      ],
      include: {
        user: { select: { name: true, avatar: true } }
      },
      take: 50
    });
    res.json(players);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get specific player by userId or playerId
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const player = await prisma.player.findFirst({
      where: {
        OR: [{ id }, { userId: id }]
      },
      include: {
        user: { select: { name: true, email: true, avatar: true } }
      }
    });

    if (!player) return res.status(404).json({ error: 'Player not found' });

    // Instantly return the pre-calculated materialized database columns natively.
    res.json(player);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get player match history
router.get('/:id/history', async (req, res) => {
  const { id } = req.params;
  try {
    const matches = await prisma.match.findMany({
      where: {
        participants: {
          some: { playerId: id }
        }
      },
      orderBy: { createdAt: 'desc' },
      include: {
        participants: {
          include: { player: { include: { user: { select: { name: true } } } } }
        },
        rallies: true
      }
    });
    res.json(matches);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
