import { Server } from 'socket.io';
import { prisma } from './lib/prisma';

export const configureSocket = (io: Server) => {
  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Join a specific match room to receive updates
    socket.on('match:join', (matchId: string) => {
      socket.join(`match_${matchId}`);
      console.log(`Socket ${socket.id} joined room match_${matchId}`);
    });

    socket.on('match:leave', (matchId: string) => {
      socket.leave(`match_${matchId}`);
      console.log(`Socket ${socket.id} left room match_${matchId}`);
    });

    // Score update from scorer
    socket.on('match:updateScore', async (data: { matchId: string, teamA: number, teamB: number }) => {
      const { matchId, teamA, teamB } = data;
      try {
        const match = await prisma.match.update({
          where: { id: matchId },
          data: { scoreA: teamA, scoreB: teamB }
        });
        
        // Broadcast the new score to everyone in the room
        io.to(`match_${matchId}`).emit('match:scoreUpdated', {
          matchId,
          scoreA: match.scoreA,
          scoreB: match.scoreB
        });
      } catch (err) {
        console.error('Error updating score', err);
      }
    });

    // Rally event containing detailed point info
    socket.on('match:rallyEvent', async (data: { 
      matchId: string, 
      scoringTeam: string, 
      scoringPlayer: string, 
      shotType: string, 
      opponentMistakePlayer?: string 
    }) => {
      try {
        const rally = await prisma.rally.create({
          data: {
            matchId: data.matchId,
            scoringTeam: data.scoringTeam,
            scoringPlayer: data.scoringPlayer,
            shotType: data.shotType,
            opponentMistakePlayer: data.opponentMistakePlayer
          }
        });

        // Broadcast rally event
        io.to(`match_${data.matchId}`).emit('match:newRally', rally);
      } catch (err) {
        console.error('Error saving rally event', err);
      }
    });

    // End match and aggregate stats
    socket.on('match:end', async (data: { matchId: string, winnerTeam: string, scoreA?: number, scoreB?: number }) => {
      try {
        const match = await prisma.match.update({
          where: { id: data.matchId },
          data: { 
            status: 'COMPLETED',
            ...(data.scoreA !== undefined && { scoreA: data.scoreA }),
            ...(data.scoreB !== undefined && { scoreB: data.scoreB })
          },
          include: { participants: true, rallies: true }
        });

        // Loop through participants to update wins/losses and aggregated points
        for (const p of match.participants) {
          const isWinner = p.team === data.winnerTeam;
          
          // Calculate specific player stats from rallies
          const smashes = match.rallies.filter(r => r.scoringPlayer === p.playerId && r.shotType === 'Smash').length;
          const drops = match.rallies.filter(r => r.scoringPlayer === p.playerId && r.shotType === 'Drop').length;
          const errorsCommitted = match.rallies.filter(r => r.opponentMistakePlayer === p.playerId).length;
          // Note: errorsForced could be calculated based on specific logic. We'll simplify here.

          await prisma.player.update({
            where: { id: p.playerId },
            data: {
              matchesPlayed: { increment: 1 },
              wins: { increment: isWinner ? 1 : 0 },
              losses: { increment: isWinner ? 0 : 1 },
              smashPoints: { increment: smashes },
              dropPoints: { increment: drops },
              errorsCommitted: { increment: errorsCommitted }
            }
          });
        }

        io.to(`match_${data.matchId}`).emit('match:ended', match);
      } catch (err) {
        console.error('Error ending match', err);
      }
    });

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.id}`);
    });
  });
};
