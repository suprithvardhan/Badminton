"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.configureSocket = void 0;
const prisma_1 = require("./lib/prisma");
const configureSocket = (io) => {
    io.on('connection', (socket) => {
        console.log(`User connected: ${socket.id}`);
        // Join a specific match room to receive updates
        socket.on('match:join', (matchId) => {
            socket.join(`match_${matchId}`);
            console.log(`Socket ${socket.id} joined room match_${matchId}`);
        });
        socket.on('match:leave', (matchId) => {
            socket.leave(`match_${matchId}`);
            console.log(`Socket ${socket.id} left room match_${matchId}`);
        });
        // Score update from scorer
        socket.on('match:updateScore', (data) => __awaiter(void 0, void 0, void 0, function* () {
            const { matchId, teamA, teamB } = data;
            try {
                const match = yield prisma_1.prisma.match.update({
                    where: { id: matchId },
                    data: { scoreA: teamA, scoreB: teamB }
                });
                // Broadcast the new score to everyone in the room
                io.to(`match_${matchId}`).emit('match:scoreUpdated', {
                    matchId,
                    scoreA: match.scoreA,
                    scoreB: match.scoreB
                });
            }
            catch (err) {
                console.error('Error updating score', err);
            }
        }));
        // Rally event containing detailed point info
        socket.on('match:rallyEvent', (data) => __awaiter(void 0, void 0, void 0, function* () {
            try {
                const rally = yield prisma_1.prisma.rally.create({
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
            }
            catch (err) {
                console.error('Error saving rally event', err);
            }
        }));
        // End match and aggregate stats
        socket.on('match:end', (data) => __awaiter(void 0, void 0, void 0, function* () {
            try {
                const match = yield prisma_1.prisma.match.update({
                    where: { id: data.matchId },
                    data: Object.assign(Object.assign({ status: 'COMPLETED' }, (data.scoreA !== undefined && { scoreA: data.scoreA })), (data.scoreB !== undefined && { scoreB: data.scoreB })),
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
                    yield prisma_1.prisma.player.update({
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
            }
            catch (err) {
                console.error('Error ending match', err);
            }
        }));
        socket.on('disconnect', () => {
            console.log(`User disconnected: ${socket.id}`);
        });
    });
};
exports.configureSocket = configureSocket;
