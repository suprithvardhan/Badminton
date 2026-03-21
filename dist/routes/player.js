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
const express_1 = require("express");
const prisma_1 = require("../lib/prisma");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// Get all players for search/selection
router.get('/', auth_1.authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const players = yield prisma_1.prisma.player.findMany({
            include: {
                user: { select: { name: true, email: true, avatar: true } }
            }
        });
        res.json(players);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
}));
// Get player leaderboard
router.get('/leaderboard', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const players = yield prisma_1.prisma.player.findMany({
            orderBy: [
                { elo: 'desc' },
                { wins: 'desc' }
            ],
            include: {
                user: { select: { name: true, avatar: true } }
            },
            take: 50
        });
        res.json(players);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
}));
// Get specific player by userId or playerId
router.get('/:id', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    try {
        const player = yield prisma_1.prisma.player.findFirst({
            where: {
                OR: [{ id }, { userId: id }]
            },
            include: {
                user: { select: { name: true, email: true, avatar: true } },
                participants: {
                    include: {
                        match: {
                            include: { rallies: true }
                        }
                    }
                }
            }
        });
        if (!player)
            return res.status(404).json({ error: 'Player not found' });
        // Compute stats on the fly for now (optimize later with a view or materialized stats)
        let totalSmashes = 0, totalDrops = 0;
        let errorsCommitted = 0, errorsForced = 0;
        player.participants.forEach((p) => {
            p.match.rallies.forEach((r) => {
                if (r.scoringPlayer === player.id) {
                    if (r.shotType === 'Smash')
                        totalSmashes++;
                    if (r.shotType === 'Drop')
                        totalDrops++;
                    errorsForced++;
                }
                if (r.opponentMistakePlayer === player.id)
                    errorsCommitted++;
            });
        });
        const response = Object.assign(Object.assign({}, player), { smashPoints: totalSmashes, dropPoints: totalDrops, errorsCommitted,
            errorsForced });
        // Remove heavy participants from final response
        delete response.participants;
        res.json(response);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
}));
// Get player match history
router.get('/:id/history', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    try {
        const matches = yield prisma_1.prisma.match.findMany({
            where: {
                participants: {
                    some: { playerId: id }
                }
            },
            orderBy: { createdAt: 'desc' },
            include: {
                participants: {
                    include: { player: { include: { user: { select: { name: true } } } } }
                },
                rallies: true
            }
        });
        res.json(matches);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
}));
exports.default = router;
