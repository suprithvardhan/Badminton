import { Request, Response } from 'express';
// Types are inferred from shared prisma client or used as any to bypass file lock
// import { Tournament, TournamentMatch, TournamentPlayer, Player, User } from '@prisma/client';
import { prisma } from '../lib/prisma';

interface TournamentMatchData {
  tournamentId: string;
  round: number;
  matchIndex: number;
  teamAName: string;
  teamBName: string;
  playerAIds: string[];
  playerBIds: string[];
  status?: string;
  winnerTeam?: string | null;
  scoreA?: number;
  scoreB?: number;
}

export const createTournament = async (req: Request, res: Response) => {
  try {
    const { name, type, format, playerIds } = req.body;

    const tournament = await prisma.tournament.create({
      data: {
        name,
        type,
        format,
        stage: format === 'Hybrid' ? 'LEAGUE' : (format === 'Round Robin' ? 'LEAGUE' : 'KNOCKOUT'),
        participants: {
          create: playerIds.map((pid: string) => ({ playerId: pid }))
        }
      },
      include: {
        participants: { include: { player: { include: { user: true } } } }
      }
    });

    let teams: any[] = [];
    if (type === 'Doubles') {
      let teamIndex = 1;
      for (let i = 0; i < tournament.participants.length; i += 2) {
        const p1 = tournament.participants[i];
        const p2 = tournament.participants[i + 1];
        if (p2) {
          teams.push({
            id: `team_${teamIndex}`,
            name: `${p1.player.user.name.split(' ')[0]} & ${p2.player.user.name.split(' ')[0]}`,
            playerIds: [p1.playerId, p2.playerId]
          });
        } else {
          teams.push({
            id: `team_${teamIndex}`,
            name: p1.player.user.name,
            playerIds: [p1.playerId]
          });
        }
        teamIndex++;
      }
    } else {
      teams = tournament.participants.map((p: any) => ({
        id: p.playerId,
        name: p.player.user.name,
        playerIds: [p.playerId]
      }));
    }

    const matchesData: TournamentMatchData[] = [];

    if (format === 'Round Robin' || format === 'Hybrid') {
      for (let i = 0; i < teams.length; i++) {
        for (let j = i + 1; j < teams.length; j++) {
          matchesData.push({
            tournamentId: tournament.id,
            round: 0,
            matchIndex: i * teams.length + j,
            teamAName: teams[i].name,
            teamBName: teams[j].name,
            playerAIds: teams[i].playerIds,
            playerBIds: teams[j].playerIds,
          });
        }
      }
    } else {
      const numRounds = Math.ceil(Math.log2(teams.length));
      for (let r = numRounds - 1; r >= 0; r--) {
        const matchesInRound = Math.pow(2, r);
        for (let m = 0; m < matchesInRound; m++) {
          matchesData.push({
            tournamentId: tournament.id,
            round: r,
            matchIndex: m,
            teamAName: '',
            teamBName: '',
            playerAIds: [],
            playerBIds: [],
            status: 'PENDING',
            winnerTeam: null,
            scoreA: 0,
            scoreB: 0,
          });
        }
      }
      
      const firstRoundMatches = matchesData.filter(m => m.round === numRounds - 1);
      const byes = Math.pow(2, numRounds) - teams.length;
      
      let teamIdx = 0;
      for (let m = 0; m < firstRoundMatches.length; m++) {
        const match = firstRoundMatches[m];
        match.teamAName = teams[teamIdx].name;
        match.playerAIds = teams[teamIdx].playerIds;
        teamIdx++;
        
        if (m >= firstRoundMatches.length - byes) {
          match.teamBName = 'BYE';
          match.status = 'COMPLETED';
          match.winnerTeam = 'A';
          match.scoreA = 21;
        } else {
          match.teamBName = teams[teamIdx].name;
          match.playerBIds = teams[teamIdx].playerIds;
          teamIdx++;
        }
      }
      
      // Cascade BYEs downwards structurally
      for (let r = numRounds - 1; r > 0; r--) {
        const currentRoundMatches = matchesData.filter(m => m.round === r);
        const nextRoundMatches = matchesData.filter(m => m.round === r - 1);
        
        for (let m = 0; m < currentRoundMatches.length; m++) {
           const match = currentRoundMatches[m];
           if (match.status === 'COMPLETED') {
             const advanceName = match.winnerTeam === 'A' ? match.teamAName : match.teamBName;
             const advanceIds = match.winnerTeam === 'A' ? match.playerAIds : match.playerBIds;
             const nextMatchIndex = Math.floor(m / 2);
             const nextMatch = nextRoundMatches[nextMatchIndex];
             if (m % 2 === 0) {
                nextMatch.teamAName = advanceName;
                nextMatch.playerAIds = advanceIds;
             } else {
                nextMatch.teamBName = advanceName;
                nextMatch.playerBIds = advanceIds;
             }
           }
        }
      }
    }

    await prisma.tournamentMatch.createMany({ data: matchesData });

    const updatedTournament = await prisma.tournament.findUnique({
      where: { id: tournament.id },
      include: { 
        matches: { orderBy: [{ round: 'desc' }, { matchIndex: 'asc' }] }, 
        participants: { include: { player: { include: { user: true } } } } 
      }
    });

    res.status(201).json(updatedTournament);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getTournaments = async (req: Request, res: Response) => {
  try {
    const tournaments = await prisma.tournament.findMany({
      include: { 
        matches: { orderBy: [{ round: 'desc' }, { matchIndex: 'asc' }] }, 
        participants: { include: { player: { include: { user: true } } } } 
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(tournaments);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getTournamentById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const tournament = await prisma.tournament.findUnique({
      where: { id },
      include: { 
        matches: { orderBy: [{ round: 'desc' }, { matchIndex: 'asc' }] }, 
        participants: { include: { player: { include: { user: true } } } } 
      }
    });
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    res.json(tournament);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const updateTournamentMatch = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const matchId = req.params.matchId as string;
    const { winnerTeam, scoreA, scoreB, realMatchId } = req.body;

    await prisma.tournamentMatch.update({
      where: { id: matchId },
      data: {
        winnerTeam,
        scoreA,
        scoreB,
        status: 'COMPLETED',
        matchId: realMatchId
      }
    });

    const tournament = await prisma.tournament.findUnique({
      where: { id },
      include: { 
        matches: { orderBy: [{ round: 'desc' }, { matchIndex: 'asc' }] }, 
        participants: { include: { player: { include: { user: true } } } } 
      }
    });

    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

    // Handle Hybrid Stage Transition
    if (tournament.format === 'Hybrid' && tournament.stage === 'LEAGUE') {
      const allLeagueDone = tournament.matches.every((m: any) => m.status === 'COMPLETED');
      if (allLeagueDone) {
        // Calculate Standings
        const stats: Record<string, any> = {};
        tournament.participants.forEach((p: any) => {
          stats[p.playerId] = { name: p.player.user.name, wins: 0, matches: 0 };
        });

        tournament.matches.forEach((m: any) => {
          if (m.status !== 'COMPLETED') return;
          const winnerIds = m.winnerTeam === 'A' ? m.playerAIds : m.playerBIds;
          const allPlayerIds = [...m.playerAIds, ...m.playerBIds];

          allPlayerIds.forEach((pid: string) => { if (stats[pid]) stats[pid].matches++; });
          winnerIds.forEach((wid: string) => { if (stats[wid]) stats[wid].wins++; });
        });

        const top4 = Object.entries(stats)
          .map(([pid, s]: any) => ({ id: pid, ...s }))
          .sort((a, b) => b.wins - a.wins)
          .slice(0, 4);

        if (top4.length >= 2) {
          await prisma.tournament.update({
            where: { id },
            data: { stage: 'KNOCKOUT' }
          });

          const knockoutMatches: TournamentMatchData[] = [];
          // Semis
          knockoutMatches.push({
            tournamentId: tournament.id,
            round: 1,
            matchIndex: 0,
            teamAName: top4[0].name,
            teamBName: top4[3]?.name || 'BYE',
            playerAIds: [top4[0].id],
            playerBIds: top4[3] ? [top4[3].id] : [],
            status: top4[3] ? 'PENDING' : 'COMPLETED',
            winnerTeam: top4[3] ? null : 'A',
            scoreA: top4[3] ? 0 : 21
          });
          knockoutMatches.push({
            tournamentId: tournament.id,
            round: 1,
            matchIndex: 1,
            teamAName: top4[1]?.name || 'TBD',
            teamBName: top4[2]?.name || 'TBD',
            playerAIds: top4[1] ? [top4[1].id] : [],
            playerBIds: top4[2] ? [top4[2].id] : [],
            status: 'PENDING'
          });
          // Final
          knockoutMatches.push({
            tournamentId: tournament.id,
            round: 0,
            matchIndex: 0,
            teamAName: !top4[3] ? top4[0].name : '',
            teamBName: '',
            playerAIds: !top4[3] ? [top4[0].id] : [],
            playerBIds: [],
            status: 'PENDING'
          });

          await prisma.tournamentMatch.createMany({ data: knockoutMatches });
        }
      }
    }

    // Knockout progression
    if (tournament.format === 'Knockout' || tournament.stage === 'KNOCKOUT') {
      const currentMatch = tournament.matches.find((m: any) => m.id === matchId);
      if (currentMatch) {
        if (currentMatch.round === 0) {
          // Final match completed! Auto-finish tournament
          const winningIds = winnerTeam === 'A' ? currentMatch.playerAIds : currentMatch.playerBIds;
          await prisma.tournament.update({
             where: { id },
             data: {
               status: 'FINISHED',
               winnerId: winningIds?.[0] || null
             }
          });
        } else {
          const nextRound = currentMatch.round - 1;
          if (nextRound >= 0) {
            const roundMatches = tournament.matches.filter((m: any) => m.round === currentMatch.round);
            const matchIdx = roundMatches.findIndex((m: any) => m.id === matchId);
            const nextRoundMatches = tournament.matches.filter((m: any) => m.round === nextRound);
            const nextMatch = nextRoundMatches[Math.floor(matchIdx / 2)];
            
            if (nextMatch) {
              const winnerName = winnerTeam === 'A' ? currentMatch.teamAName : currentMatch.teamBName;
              const winnerIds = winnerTeam === 'A' ? currentMatch.playerAIds : currentMatch.playerBIds;
              await prisma.tournamentMatch.update({
                where: { id: nextMatch.id },
                data: { 
                  [matchIdx % 2 === 0 ? 'teamAName' : 'teamBName']: winnerName,
                  [matchIdx % 2 === 0 ? 'playerAIds' : 'playerBIds']: winnerIds
                }
              });
            }
          }
        }
      }
    }

    // Round Robin Auto-finish
    if (tournament.format === 'Round Robin') {
      const allDone = tournament.matches.every((m: any) => m.id === matchId ? true : m.status === 'COMPLETED');
      if (allDone) {
        const stats: Record<string, any> = {};
        tournament.participants.forEach((p: any) => { stats[p.playerId] = { wins: 0 } });
        tournament.matches.forEach((m: any) => {
          let winIds = null;
          if (m.id === matchId) winIds = winnerTeam === 'A' ? m.playerAIds : m.playerBIds;
          else if (m.status === 'COMPLETED') winIds = m.winnerTeam === 'A' ? m.playerAIds : m.playerBIds;
          winIds?.forEach((pid: string) => { if (stats[pid]) stats[pid].wins++; });
        });
        const topPlayer = Object.entries(stats).sort(([, a]: any, [, b]: any) => b.wins - a.wins)[0];
        if (topPlayer) {
          await prisma.tournament.update({ where: { id }, data: { status: 'FINISHED', winnerId: topPlayer[0] } });
        }
      }
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const finishTournament = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const tournament = await prisma.tournament.findUnique({
      where: { id },
      include: {
        matches: true,
        participants: { include: { player: { include: { user: true } } } }
      }
    });

    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

    let topPlayerId = null;

    if (tournament.format === 'Round Robin') {
      const stats: Record<string, any> = {};
      tournament.participants.forEach((p: any) => {
        stats[p.playerId] = { name: p.player.user.name, wins: 0 };
      });
      tournament.matches.forEach((m: any) => {
        if (m.status === 'COMPLETED') {
          const winnerIds = m.winnerTeam === 'A' ? m.playerAIds : m.playerBIds;
          winnerIds?.forEach((pid: string) => { if (stats[pid]) stats[pid].wins++; });
        }
      });
      const topPlayer = Object.entries(stats)
        .sort(([, a]: any, [, b]: any) => b.wins - a.wins)[0];
      if (topPlayer) topPlayerId = topPlayer[0];
    } else {
      // Knockout or Hybrid
      // The final match is round: 0, matchIndex: 0
      const finalMatch = tournament.matches.find((m: any) => m.round === 0 && m.matchIndex === 0 && m.status === 'COMPLETED');
      if (finalMatch) {
         const winnerIds = finalMatch.winnerTeam === 'A' ? finalMatch.playerAIds : finalMatch.playerBIds;
         if (winnerIds && winnerIds.length > 0) {
            topPlayerId = winnerIds[0];
         }
      }
    }

    await prisma.tournament.update({
      where: { id },
      data: {
        status: 'FINISHED',
        winnerId: topPlayerId,
      }
    });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
