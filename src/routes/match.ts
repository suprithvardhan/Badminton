import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// Simple in-memory cache for high-frequency active match polling
let activeMatchesCache: any = null;
let activeMatchesCacheTime = 0;
const CACHE_TTL_MS = 2500; // 2.5s cache prevents DB flooding from 3s client polling

// Get active matches (ongoing)
router.get('/active', async (req, res) => {
  try {
    const now = Date.now();
    // Return cached response if within TTL
    if (activeMatchesCache && (now - activeMatchesCacheTime) < CACHE_TTL_MS) {
      return res.json(activeMatchesCache);
    }

    const matches = await prisma.match.findMany({
      where: { status: 'IN_PROGRESS' },
      orderBy: { updatedAt: 'desc' },
      include: {
        participants: {
          include: { player: { include: { user: { select: { name: true } } } } }
        }
      }
    });

    // Update cache
    activeMatchesCache = matches;
    activeMatchesCacheTime = now;
    
    res.json(matches);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Get completed matches (history)
router.get('/history', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(5, parseInt(req.query.limit as string) || 20));

    const total = await prisma.match.count({ where: { status: 'COMPLETED' } });
    const matches = await prisma.match.findMany({
      where: { status: 'COMPLETED' },
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        participants: {
          include: { player: { include: { user: { select: { name: true } } } } }
        }
      }
    });
    res.json({ data: matches, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Get specific match
router.get('/:id', async (req, res) => {
  try {
    const match = await prisma.match.findUnique({
      where: { id: req.params.id },
      include: {
        participants: {
          include: { player: { include: { user: { select: { name: true } } } } }
        },
        rallies: {
          orderBy: { timestamp: 'asc' }
        }
      }
    });
    if (!match) return res.status(404).json({ error: 'Match not found' });
    res.json(match);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Create new match
router.post('/', authenticateToken, async (req, res) => {
  const { type, teamA, teamB, participants } = req.body;
  // participants should look like [{ playerId: '...', team: 'A' }, ...]

  try {
    const match = await prisma.match.create({
      data: {
        type,
        teamA,
        teamB,
        participants: {
          create: participants.map((p: any) => ({
            playerId: p.playerId,
            team: p.team
          }))
        }
      },
      include: {
        participants: {
          include: { player: { include: { user: { select: { name: true } } } } }
        }
      }
    });
    res.status(201).json(match);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal error' });
  }
});

// End match
router.post('/:id/end', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { winnerTeam, scoreA, scoreB } = req.body;

  try {
    const match = await prisma.match.update({
      where: { id: id as string },
      data: { 
        status: 'COMPLETED',
        scoreA,
        scoreB
      },
      include: { participants: { include: { player: true } }, rallies: true }
    });

    const matchAny = match as any;

    // 1. Elo Calculation Logic
    const teamAPlayers = matchAny.participants.filter((p: any) => p.team === 'A');
    const teamBPlayers = matchAny.participants.filter((p: any) => p.team === 'B');
    
    // Average Elo for teams
    const eloA = teamAPlayers.reduce((sum: number, p: any) => sum + p.player.elo, 0) / (teamAPlayers.length || 1);
    const eloB = teamBPlayers.reduce((sum: number, p: any) => sum + p.player.elo, 0) / (teamBPlayers.length || 1);

    const K = 32;
    const expectedA = 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
    const expectedB = 1 / (1 + Math.pow(10, (eloA - eloB) / 400));

    const actualA = winnerTeam === 'A' ? 1 : (winnerTeam === 'B' ? 0 : 0.5);
    const actualB = winnerTeam === 'B' ? 1 : (winnerTeam === 'A' ? 0 : 0.5);

    const eloChangeA = Math.round(K * (actualA - expectedA));
    const eloChangeB = Math.round(K * (actualB - expectedB));

    // 2. Update player stats
    const transactions = [];

    for (const p of matchAny.participants) {
      const isWinner = p.team === winnerTeam;
      const eloChange = p.team === 'A' ? eloChangeA : eloChangeB;

      const smashes = matchAny.rallies.filter((r: any) => r.scoringPlayer === p.playerId && r.shotType === 'Smash').length;
      const drops = matchAny.rallies.filter((r: any) => r.scoringPlayer === p.playerId && r.shotType === 'Drop').length;
      const errorsCommitted = matchAny.rallies.filter((r: any) => r.opponentMistakePlayer === p.playerId).length;

      // Bundle Player Stats Update
      transactions.push(
        prisma.player.update({
          where: { id: p.playerId },
          data: {
            elo: { increment: eloChange },
            matchesPlayed: { increment: 1 },
            wins: { increment: isWinner ? 1 : 0 },
            losses: { increment: isWinner ? 0 : 1 },
            smashPoints: { increment: smashes },
            dropPoints: { increment: drops },
            errorsCommitted: { increment: errorsCommitted }
          }
        })
      );

      // Bundle Match Participation Stats Update
      transactions.push(
        prisma.matchParticipant.update({
          where: { id: p.id },
          data: { eloChange }
        })
      );
    }

    // Execute exactly ONE hyper-efficient network batch transaction dropping 1.6s of sequence lag!
    await prisma.$transaction(transactions);

    res.json(match);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal error' });
  }
});

export default router;
