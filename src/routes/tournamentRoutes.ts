import { Router } from 'express';
import { createTournament, getTournaments, getTournamentById, updateTournamentMatch, finishTournament } from '../controllers/tournamentController';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.use(authenticateToken);

router.post('/', createTournament);
router.get('/', getTournaments);
router.get('/:id', getTournamentById);
router.patch('/:id/matches/:matchId', updateTournamentMatch);
router.post('/:id/finish', finishTournament);

export default router;
