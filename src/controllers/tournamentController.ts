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

    // 1. Fetch Elo for all players to enable Seeding
    const players = await prisma.player.findMany({
      where: { id: { in: playerIds } },
      include: { user: true }
    });

    let teams: any[] = [];
    if (type === 'Doubles') {
      let teamIndex = 1;
      // Pair players sequentially as before, but we'll sort these "teams" by Elo later
      for (let i = 0; i < tournament.participants.length; i += 2) {
        const p1 = tournament.participants[i] as any;
        const p2 = tournament.participants[i + 1] as any;
        
        const player1Obj = players.find((p: any) => p.id === p1.playerId);
        const player2Obj = p2 ? players.find((p: any) => p.id === p2.playerId) : null;

        if (player2Obj) {
          teams.push({
            id: `team_${teamIndex}`,
            name: `${player1Obj?.user?.name.split(' ')[0]} & ${player2Obj?.user?.name.split(' ')[0]}`,
            playerIds: [p1.playerId, p2.playerId],
            avgElo: ((player1Obj?.elo || 1200) + (player2Obj?.elo || 1200)) / 2
          });
        } else {
          teams.push({
            id: `team_${teamIndex}`,
            name: player1Obj?.user?.name || 'Unknown',
            playerIds: [p1.playerId],
            avgElo: player1Obj?.elo || 1200
          });
        }
        teamIndex++;
      }
      teams = tournament.participants.map((p: any) => {
        const pObj = players.find((px: any) => px.id === p.playerId);
        return {
          id: p.playerId,
          name: pObj?.user?.name || 'Unknown',
          playerIds: [p.playerId],
          avgElo: pObj?.elo || 1200
        };
      });
    }

    // 2. Sort teams by Elo for Seeding
    teams.sort((a, b) => b.avgElo - a.avgElo);

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
      const totalSlots = Math.pow(2, numRounds);
      
      // Standard Seeding Order Generation (e.g. [1, 8, 5, 4, 3, 6, 7, 2])
      const getSeedOrder = (n: number) => {
        let list = [1, 2];
        while (list.length < n) {
          let nextList = [];
          for (let i = 0; i < list.length; i++) {
            nextList.push(list[i]);
            nextList.push(list.length * 2 + 1 - list[i]);
          }
          list = nextList;
        }
        return list;
      };

      const seedOrder = getSeedOrder(totalSlots);
      
      // Initialize all matches
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
      
      // Assign teams to first round based on seedOrder
      for (let i = 0; i < totalSlots; i += 2) {
        const seedA = seedOrder[i];
        const seedB = seedOrder[i + 1];
        const matchIdx = Math.floor(i / 2);
        const match = firstRoundMatches[matchIdx];

        const teamA = teams[seedA - 1]; // seed is 1-indexed
        const teamB = teams[seedB - 1];

        if (teamA) {
          match.teamAName = teamA.name;
          match.playerAIds = teamA.playerIds;
        } else {
          match.teamAName = 'BYE';
          match.status = 'COMPLETED';
          match.winnerTeam = 'B';
        }

        if (teamB) {
          match.teamBName = teamB.name;
          match.playerBIds = teamB.playerIds;
        } else {
          match.teamBName = 'BYE';
          match.status = 'COMPLETED';
          match.winnerTeam = 'A';
          match.scoreA = 21; // auto-win
        }
      }
      
      // Cascade BYEs downward
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
          stats[p.playerId] = { name: p.player.user.name, wins: 0, matches: 0, pointsScored: 0, pointsConceded: 0 };
        });

        tournament.matches.forEach((m: any) => {
          if (m.status !== 'COMPLETED') return;
          const winnerIds = m.winnerTeam === 'A' ? m.playerAIds : m.playerBIds;
          const loserIds = m.winnerTeam === 'A' ? m.playerBIds : m.playerAIds;
          const allPlayerIds = [...m.playerAIds, ...m.playerBIds];

          allPlayerIds.forEach((pid: string) => { if (stats[pid]) stats[pid].matches++; });
          winnerIds.forEach((wid: string) => { 
            if (stats[wid]) {
              stats[wid].wins++; 
              stats[wid].pointsScored += (m.winnerTeam === 'A' ? m.scoreA : m.scoreB);
              stats[wid].pointsConceded += (m.winnerTeam === 'A' ? m.scoreB : m.scoreA);
            }
          });
          loserIds.forEach((lid: string) => {
            if (stats[lid]) {
              stats[lid].pointsScored += (m.winnerTeam === 'A' ? m.scoreB : m.scoreA);
              stats[lid].pointsConceded += (m.winnerTeam === 'A' ? m.scoreA : m.scoreB);
            }
          });
        });

        const top4 = Object.entries(stats)
          .map(([pid, s]: any) => ({ id: pid, ...s }))
          .sort((a, b) => {
            if (b.wins !== a.wins) return b.wins - a.wins;
            const diffA = a.pointsScored - a.pointsConceded;
            const diffB = b.pointsScored - b.pointsConceded;
            return diffB - diffA;
          })
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
          const winnerId = winningIds?.[0] || null;
          
          // Calculate Awards
          const fullTournament = await prisma.tournament.findUnique({
            where: { id },
            include: {
              matches: { include: { match: { include: { rallies: true } } } },
              participants: { include: { player: { include: { user: true } } } }
            }
          });

          const awards = calculateAwards(fullTournament);

          await prisma.tournament.update({
             where: { id },
             data: {
               status: 'FINISHED',
               winnerId,
               awards
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
        tournament.participants.forEach((p: any) => { stats[p.playerId] = { wins: 0, pointsScored: 0, pointsConceded: 0 } });
        tournament.matches.forEach((m: any) => {
          let winIds = null;
          let currentScoreA = m.scoreA;
          let currentScoreB = m.scoreB;
          let currentWinnerTeam = m.winnerTeam;

          if (m.id === matchId) {
            winIds = winnerTeam === 'A' ? m.playerAIds : m.playerBIds;
            currentWinnerTeam = winnerTeam;
            currentScoreA = scoreA;
            currentScoreB = scoreB;
          } else if (m.status === 'COMPLETED') {
            winIds = m.winnerTeam === 'A' ? m.playerAIds : m.playerBIds;
          }

          if (winIds) {
            winIds.forEach((pid: string) => { if (stats[pid]) stats[pid].wins++; });
            
            // Assign points to all participants in the match
            m.playerAIds.forEach((pid: string) => {
              if (stats[pid]) {
                stats[pid].pointsScored += currentScoreA;
                stats[pid].pointsConceded += currentScoreB;
              }
            });
            m.playerBIds.forEach((pid: string) => {
              if (stats[pid]) {
                stats[pid].pointsScored += currentScoreB;
                stats[pid].pointsConceded += currentScoreA;
              }
            });
          }
        });

        const topPlayer = Object.entries(stats).sort((a: any, b: any) => {
          if (b[1].wins !== a[1].wins) return b[1].wins - a[1].wins;
          const diffA = a[1].pointsScored - a[1].pointsConceded;
          const diffB = b[1].pointsScored - b[1].pointsConceded;
          return diffB - diffA;
        })[0];
        if (topPlayer) {
          const fullTournament = await prisma.tournament.findUnique({
            where: { id },
            include: {
              matches: { include: { match: { include: { rallies: true } } } },
              participants: { include: { player: { include: { user: true } } } }
            }
          });
          const awards = calculateAwards(fullTournament);

          await prisma.tournament.update({ 
            where: { id }, 
            data: { 
              status: 'FINISHED', 
              winnerId: topPlayer[0],
              awards
            } 
          });
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
        stats[p.playerId] = { name: p.player.user.name, wins: 0, pointsScored: 0, pointsConceded: 0 };
      });
      tournament.matches.forEach((m: any) => {
        if (m.status === 'COMPLETED') {
          const winnerIds = m.winnerTeam === 'A' ? m.playerAIds : m.playerBIds;
          winnerIds?.forEach((pid: string) => { if (stats[pid]) stats[pid].wins++; });

          m.playerAIds.forEach((pid: string) => {
            if (stats[pid]) {
              stats[pid].pointsScored += m.scoreA;
              stats[pid].pointsConceded += m.scoreB;
            }
          });
          m.playerBIds.forEach((pid: string) => {
            if (stats[pid]) {
              stats[pid].pointsScored += m.scoreB;
              stats[pid].pointsConceded += m.scoreA;
            }
          });
        }
      });
      const topPlayer = Object.entries(stats)
        .sort((a: any, b: any) => {
          if (b[1].wins !== a[1].wins) return b[1].wins - a[1].wins;
          const diffA = a[1].pointsScored - a[1].pointsConceded;
          const diffB = b[1].pointsScored - b[1].pointsConceded;
          return diffB - diffA;
        })[0];
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

    // Calculate Awards
    const fullTournament = await prisma.tournament.findUnique({
      where: { id },
      include: {
        matches: { include: { match: { include: { rallies: true } } } },
        participants: { include: { player: { include: { user: true } } } }
      }
    });

    const awards = calculateAwards(fullTournament);

    await prisma.tournament.update({
      where: { id },
      data: {
        status: 'FINISHED',
        winnerId: topPlayerId,
        awards: awards as any
      }
    });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

const calculateAwards = (tournament: any) => {
  const playerStats: Record<string, any> = {};
  tournament.participants.forEach((p: any) => {
    playerStats[p.playerId] = { points: 0, smashes: 0, drops: 0, errors: 0, name: p.player.user.name };
  });

  tournament.matches.forEach((tm: any) => {
    if (tm.match && tm.match.rallies) {
      tm.match.rallies.forEach((rally: any) => {
        if (rally.scoringPlayer && playerStats[rally.scoringPlayer]) {
          playerStats[rally.scoringPlayer].points++;
          if (rally.shotType === 'Smash') playerStats[rally.scoringPlayer].smashes++;
          if (rally.shotType === 'Drop') playerStats[rally.scoringPlayer].drops++;
        }
        if (rally.opponentMistakePlayer && playerStats[rally.opponentMistakePlayer]) {
          playerStats[rally.opponentMistakePlayer].errors++;
        }
      });
    }
  });

  const getTop = (key: string) => {
    return Object.values(playerStats).sort((a, b) => b[key] - a[key])[0]?.name || 'TBD';
  };

  return {
    mvp: getTop('points'),
    smashKing: getTop('smashes'),
    dropMaster: getTop('drops'),
    errorKing: getTop('errors')
  };
};
