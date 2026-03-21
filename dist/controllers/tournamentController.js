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
exports.updateTournamentMatch = exports.getTournamentById = exports.getTournaments = exports.createTournament = void 0;
// Types are inferred from shared prisma client or used as any to bypass file lock
// import { Tournament, TournamentMatch, TournamentPlayer, Player, User } from '@prisma/client';
const prisma_1 = require("../lib/prisma");
const createTournament = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, type, format, playerIds } = req.body;
        const tournament = yield prisma_1.prisma.tournament.create({
            data: {
                name,
                type,
                format,
                stage: format === 'Hybrid' ? 'LEAGUE' : (format === 'Round Robin' ? 'LEAGUE' : 'KNOCKOUT'),
                participants: {
                    create: playerIds.map((pid) => ({ playerId: pid }))
                }
            },
            include: {
                participants: { include: { player: { include: { user: true } } } }
            }
        });
        const teams = tournament.participants.map((p) => ({
            id: p.playerId,
            name: p.player.user.name,
            playerIds: [p.playerId]
        }));
        const matchesData = [];
        if (format === 'Round Robin' || format === 'Hybrid') {
            for (let i = 0; i < teams.length; i++) {
                for (let j = i + 1; j < teams.length; j++) {
                    matchesData.push({
                        tournamentId: tournament.id,
                        round: 0,
                        teamAName: teams[i].name,
                        teamBName: teams[j].name,
                        playerAIds: teams[i].playerIds,
                        playerBIds: teams[j].playerIds,
                    });
                }
            }
        }
        else {
            const numRounds = Math.ceil(Math.log2(teams.length));
            const totalMatches = Math.pow(2, numRounds) - 1;
            for (let i = 0; i < totalMatches; i++) {
                const round = Math.floor(Math.log2(totalMatches - i + 1)) - 1;
                matchesData.push({
                    tournamentId: tournament.id,
                    round: Math.max(0, round),
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
            // Seed first round
            const firstRoundMatches = matchesData.filter(m => m.round === numRounds - 1);
            for (let i = 0; i < teams.length; i += 2) {
                const match = firstRoundMatches[Math.floor(i / 2)];
                if (match) {
                    match.teamAName = teams[i].name;
                    match.playerAIds = teams[i].playerIds;
                    if (teams[i + 1]) {
                        match.teamBName = teams[i + 1].name;
                        match.playerBIds = teams[i + 1].playerIds;
                    }
                    else {
                        match.teamBName = 'BYE';
                        match.status = 'COMPLETED';
                        match.winnerTeam = 'A';
                        match.scoreA = 21;
                    }
                }
            }
        }
        yield prisma_1.prisma.tournamentMatch.createMany({ data: matchesData });
        const updatedTournament = yield prisma_1.prisma.tournament.findUnique({
            where: { id: tournament.id },
            include: { matches: true, participants: { include: { player: { include: { user: true } } } } }
        });
        res.status(201).json(updatedTournament);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
exports.createTournament = createTournament;
const getTournaments = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const tournaments = yield prisma_1.prisma.tournament.findMany({
            include: {
                matches: true,
                participants: { include: { player: { include: { user: true } } } }
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(tournaments);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
exports.getTournaments = getTournaments;
const getTournamentById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = req.params.id;
        const tournament = yield prisma_1.prisma.tournament.findUnique({
            where: { id },
            include: {
                matches: { orderBy: { round: 'desc' } },
                participants: { include: { player: { include: { user: true } } } }
            }
        });
        if (!tournament)
            return res.status(404).json({ error: 'Tournament not found' });
        res.json(tournament);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
exports.getTournamentById = getTournamentById;
const updateTournamentMatch = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const id = req.params.id;
        const matchId = req.params.matchId;
        const { winnerTeam, scoreA, scoreB, realMatchId } = req.body;
        yield prisma_1.prisma.tournamentMatch.update({
            where: { id: matchId },
            data: {
                winnerTeam,
                scoreA,
                scoreB,
                status: 'COMPLETED',
                matchId: realMatchId
            }
        });
        const tournament = yield prisma_1.prisma.tournament.findUnique({
            where: { id },
            include: {
                matches: true,
                participants: { include: { player: { include: { user: true } } } }
            }
        });
        if (!tournament)
            return res.status(404).json({ error: 'Tournament not found' });
        // Handle Hybrid Stage Transition
        if (tournament.format === 'Hybrid' && tournament.stage === 'LEAGUE') {
            const allLeagueDone = tournament.matches.every((m) => m.status === 'COMPLETED');
            if (allLeagueDone) {
                // Calculate Standings
                const stats = {};
                tournament.participants.forEach((p) => {
                    stats[p.playerId] = { name: p.player.user.name, wins: 0, matches: 0 };
                });
                tournament.matches.forEach((m) => {
                    if (m.status !== 'COMPLETED')
                        return;
                    const winnerIds = m.winnerTeam === 'A' ? m.playerAIds : m.playerBIds;
                    const allPlayerIds = [...m.playerAIds, ...m.playerBIds];
                    allPlayerIds.forEach((pid) => { if (stats[pid])
                        stats[pid].matches++; });
                    winnerIds.forEach((wid) => { if (stats[wid])
                        stats[wid].wins++; });
                });
                const top4 = Object.entries(stats)
                    .map(([pid, s]) => (Object.assign({ id: pid }, s)))
                    .sort((a, b) => b.wins - a.wins)
                    .slice(0, 4);
                if (top4.length >= 2) {
                    yield prisma_1.prisma.tournament.update({
                        where: { id },
                        data: { stage: 'KNOCKOUT' }
                    });
                    const knockoutMatches = [];
                    // Semis
                    knockoutMatches.push({
                        tournamentId: tournament.id,
                        round: 1,
                        teamAName: top4[0].name,
                        teamBName: ((_a = top4[3]) === null || _a === void 0 ? void 0 : _a.name) || 'BYE',
                        playerAIds: [top4[0].id],
                        playerBIds: top4[3] ? [top4[3].id] : [],
                        status: top4[3] ? 'PENDING' : 'COMPLETED',
                        winnerTeam: top4[3] ? null : 'A',
                        scoreA: top4[3] ? 0 : 21
                    });
                    knockoutMatches.push({
                        tournamentId: tournament.id,
                        round: 1,
                        teamAName: ((_b = top4[1]) === null || _b === void 0 ? void 0 : _b.name) || 'TBD',
                        teamBName: ((_c = top4[2]) === null || _c === void 0 ? void 0 : _c.name) || 'TBD',
                        playerAIds: top4[1] ? [top4[1].id] : [],
                        playerBIds: top4[2] ? [top4[2].id] : [],
                        status: 'PENDING'
                    });
                    // Final
                    knockoutMatches.push({
                        tournamentId: tournament.id,
                        round: 0,
                        teamAName: !top4[3] ? top4[0].name : '',
                        teamBName: '',
                        playerAIds: !top4[3] ? [top4[0].id] : [],
                        playerBIds: [],
                        status: 'PENDING'
                    });
                    yield prisma_1.prisma.tournamentMatch.createMany({ data: knockoutMatches });
                }
            }
        }
        // Knockout progression
        if (tournament.format === 'Knockout' || tournament.stage === 'KNOCKOUT') {
            const currentMatch = tournament.matches.find(m => m.id === matchId);
            if (currentMatch) {
                const nextRound = currentMatch.round - 1;
                if (nextRound >= 0) {
                    const roundMatches = tournament.matches.filter(m => m.round === currentMatch.round);
                    const matchIdx = roundMatches.findIndex(m => m.id === matchId);
                    const nextRoundMatches = tournament.matches.filter(m => m.round === nextRound);
                    const nextMatch = nextRoundMatches[Math.floor(matchIdx / 2)];
                    if (nextMatch) {
                        const winnerName = winnerTeam === 'A' ? currentMatch.teamAName : currentMatch.teamBName;
                        const winnerIds = winnerTeam === 'A' ? currentMatch.playerAIds : currentMatch.playerBIds;
                        yield prisma_1.prisma.tournamentMatch.update({
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
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
exports.updateTournamentMatch = updateTournamentMatch;
