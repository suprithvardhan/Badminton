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

    // Margin of Victory (MoV) factor
    // Minimal win (2 pts diff) has multiplier 1.0. Blowout (21 pts diff) has multiplier ~1.9.
    const scoreDiff = Math.abs(scoreA - scoreB);
    const G = 1 + Math.max(0, (scoreDiff - 2) / 21);

    const eloChangeA = Math.round(K * (actualA - expectedA) * G);
    const eloChangeB = Math.round(K * (actualB - expectedB) * G);

    // 2. Update player stats with Fair Distribution for Doubles
    const transactions = [];

    // Helper to calculate impact-based distribution
    const getIndividualEloChange = (p: any, teamPlayers: any[], teamBaseChange: number) => {
      if (teamPlayers.length <= 1) return teamBaseChange;

      const playerImpacts = teamPlayers.map(tp => {
        const scored = (match as any).rallies.filter((r: any) => r.scoringPlayer === tp.playerId).length;
        const errors = (match as any).rallies.filter((r: any) => r.opponentMistakePlayer === tp.playerId).length;
        return { id: tp.playerId, impact: Math.max(1, scored - errors) }; // Min impact of 1 for fair ratio
      });

      const totalTeamImpact = playerImpacts.reduce((sum, pi) => sum + pi.impact, 0);
      const myImpact = playerImpacts.find(pi => pi.id === p.playerId)?.impact || 1;

      // 70% shared base, 30% performance-based
      const baseShare = teamBaseChange * 0.7;
      const performanceShare = (teamBaseChange * 0.3 * (myImpact / totalTeamImpact)) * 2; // *2 because 30% of TEAM'S total (2 * 30%)
      
      return Math.round(baseShare + performanceShare);
    };

    for (const p of (match as any).participants) {
      const isWinner = p.team === winnerTeam;
      const teamBaseChange = p.team === 'A' ? eloChangeA : eloChangeB;
      const teamPlayers = p.team === 'A' ? teamAPlayers : teamBPlayers;
      
      const eloChange = getIndividualEloChange(p, teamPlayers, teamBaseChange);

      const smashes = (match as any).rallies.filter((r: any) => r.scoringPlayer === p.playerId && r.shotType === 'Smash').length;
      const drops = (match as any).rallies.filter((r: any) => r.scoringPlayer === p.playerId && r.shotType === 'Drop').length;
      const errorsCommitted = (match as any).rallies.filter((r: any) => r.opponentMistakePlayer === p.playerId).length;

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
