import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();

// Get robust admin stats
router.get('/stats', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user?.id } });
    if (user?.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Forbidden. Admin only access.' });
    }

    const totalUsers = await prisma.user.count({ where: { role: 'USER' } });
    const proUsers = await prisma.user.count({ where: { plan: 'PRO' } });
    const eliteUsers = await prisma.user.count({ where: { plan: 'ELITE' } });
    const totalMatches = await prisma.match.count();
    
    const payments = await prisma.payment.findMany();
    const totalRevenue = payments.reduce((acc, p) => acc + p.amount, 0);

    const totalClubs = await prisma.club.count();
    const singlesMatches = await prisma.match.count({ where: { type: 'SINGLES' } });
    const doublesMatches = await prisma.match.count({ where: { type: 'DOUBLES' } });
    
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const weeklyMatches = await prisma.match.count({ where: { createdAt: { gte: oneWeekAgo } } });

    res.json({
      totalUsers,
      proUsers,
      eliteUsers,
      totalMatches,
      totalRevenue,
      totalClubs,
      singlesMatches,
      doublesMatches,
      weeklyMatches
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch admin stats' });
  }
});

export default router;
