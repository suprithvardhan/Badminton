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

// Get player leaderboard with pagination, search, and position change calculation
router.get('/leaderboard', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(5, parseInt(req.query.limit as string) || 10));
    const search = (req.query.search as string || '').trim();

    const whereClause = search
      ? { user: { name: { contains: search, mode: 'insensitive' as const } } }
      : {};

    const totalCount = await prisma.player.count({ where: whereClause });

    const players = await prisma.player.findMany({
      where: whereClause,
      orderBy: [{ elo: 'desc' }, { wins: 'desc' }],
      include: {
        user: { select: { name: true, avatar: true } },
        participants: {
          orderBy: { match: { createdAt: 'desc' } },
          take: 1,
          select: { eloChange: true }
        }
      },
      skip: (page - 1) * limit,
      take: limit,
    });

    // For global position change: fetch all player IDs and their last eloChange  
    const allPlayers = await prisma.player.findMany({
      where: whereClause,
      orderBy: [{ elo: 'desc' }, { wins: 'desc' }],
      select: {
        id: true,
        elo: true,
        wins: true,
        participants: {
          orderBy: { match: { createdAt: 'desc' } },
          take: 1,
          select: { eloChange: true }
        }
      }
    });

    // Compute previous ranks by reversing last eloChange
    const withPrevElo = allPlayers.map((p: any) => {
      const lastChange = p.participants?.[0]?.eloChange ?? 0;
      return { id: p.id, prevElo: p.elo - lastChange };
    });
    withPrevElo.sort((a: any, b: any) => b.prevElo - a.prevElo);
    const prevRankMap: Record<string, number> = {};
    withPrevElo.forEach((p: any, i: number) => { prevRankMap[p.id] = i + 1; });

    const currentRankOffset = (page - 1) * limit;
    const result = players.map((p: any, i: number) => {
      const currentRank = currentRankOffset + i + 1;
      const prevRank = prevRankMap[p.id] ?? currentRank;
      const positionChange = prevRank - currentRank; // positive = moved up
      return {
        id: p.id,
        elo: p.elo,
        wins: p.wins,
        losses: p.losses,
        matchesPlayed: p.matchesPlayed,
        smashPoints: p.smashPoints,
        dropPoints: p.dropPoints,
        user: p.user,
        positionChange,
      };
    });

    res.json({
      data: result,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit),
      }
    });
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
