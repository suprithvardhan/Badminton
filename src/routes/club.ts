import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticateToken } from '../middleware/auth';
import crypto from 'crypto';

const router = Router();

// Create a new club
router.post('/', authenticateToken, async (req: any, res) => {
  const { name, description } = req.body;
  const userId = req.user?.id;

  try {
    const player = await prisma.player.findUnique({ where: { userId } });
    if (!player) return res.status(404).json({ error: 'Player not found' });

    const joinCode = crypto.randomBytes(3).toString('hex').toUpperCase(); // e.g., A1B2C3

    const club = await prisma.club.create({
      data: {
        name,
        description,
        joinCode,
        ownerId: player.id,
        members: {
          create: {
            playerId: player.id,
            role: 'ADMIN' // Creator is ADMIN
          }
        }
      }
    });

    res.status(201).json(club);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create club' });
  }
});

// Join a club via code
router.post('/join', authenticateToken, async (req: any, res) => {
  const { joinCode } = req.body;
  const userId = req.user?.id;

  try {
    const player = await prisma.player.findUnique({ where: { userId } });
    if (!player) return res.status(404).json({ error: 'Player not found' });

    const club = await prisma.club.findUnique({ where: { joinCode: joinCode.toUpperCase() } });
    if (!club) return res.status(404).json({ error: 'Invalid join code or club not found' });

    // Check if already a member
    const existingMember = await prisma.clubMember.findUnique({
      where: { clubId_playerId: { clubId: club.id, playerId: player.id } }
    });

    if (existingMember) {
      return res.status(400).json({ error: 'You are already a member of this club' });
    }

    const membership = await prisma.clubMember.create({
      data: {
        clubId: club.id,
        playerId: player.id
      }
    });

    res.json({ message: 'Joined successfully', club });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to join club' });
  }
});

// Get user's clubs
router.get('/my', authenticateToken, async (req: any, res) => {
  const userId = req.user?.id;
  try {
    const player = await prisma.player.findUnique({ where: { userId } });
    if (!player) return res.status(404).json({ error: 'Player not found' });

    const memberships = await prisma.clubMember.findMany({
      where: { playerId: player.id },
      include: {
        club: {
          include: {
            _count: { select: { members: true } }
          }
        }
      }
    });

    res.json(memberships.map((m: any) => m.club));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch clubs' });
  }
});

// Get single club details & leaderboard
router.get('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const club = await prisma.club.findUnique({
      where: { id: id as string },
      include: {
        members: {
          include: {
            player: {
              include: { user: { select: { name: true, avatar: true } } }
            }
          },
          orderBy: {
            player: { elo: 'desc' } // The Private Leaderboard sorted by Elo
          }
        }
      }
    });

    if (!club) return res.status(404).json({ error: 'Club not found' });

    res.json(club);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Get club match history
router.get('/:id/matches', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const matches = await prisma.match.findMany({
      where: { clubId: id as string },
      orderBy: { createdAt: 'desc' },
      include: {
        participants: {
          include: { player: { include: { user: { select: { name: true } } } } }
        }
      },
      take: 20
    });
    res.json(matches);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal error' });
  }
});

export default router;
