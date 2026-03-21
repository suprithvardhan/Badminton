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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../lib/prisma");
const auth_1 = require("../middleware/auth");
const crypto_1 = __importDefault(require("crypto"));
const router = (0, express_1.Router)();
// Create a new club
router.post('/', auth_1.authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const { name, description } = req.body;
    const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
    try {
        const player = yield prisma_1.prisma.player.findUnique({ where: { userId } });
        if (!player)
            return res.status(404).json({ error: 'Player not found' });
        const joinCode = crypto_1.default.randomBytes(3).toString('hex').toUpperCase(); // e.g., A1B2C3
        const club = yield prisma_1.prisma.club.create({
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
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to create club' });
    }
}));
// Join a club via code
router.post('/join', auth_1.authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const { joinCode } = req.body;
    const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
    try {
        const player = yield prisma_1.prisma.player.findUnique({ where: { userId } });
        if (!player)
            return res.status(404).json({ error: 'Player not found' });
        const club = yield prisma_1.prisma.club.findUnique({ where: { joinCode: joinCode.toUpperCase() } });
        if (!club)
            return res.status(404).json({ error: 'Invalid join code or club not found' });
        // Check if already a member
        const existingMember = yield prisma_1.prisma.clubMember.findUnique({
            where: { clubId_playerId: { clubId: club.id, playerId: player.id } }
        });
        if (existingMember) {
            return res.status(400).json({ error: 'You are already a member of this club' });
        }
        const membership = yield prisma_1.prisma.clubMember.create({
            data: {
                clubId: club.id,
                playerId: player.id
            }
        });
        res.json({ message: 'Joined successfully', club });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to join club' });
    }
}));
// Get user's clubs
router.get('/my', auth_1.authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
    try {
        const player = yield prisma_1.prisma.player.findUnique({ where: { userId } });
        if (!player)
            return res.status(404).json({ error: 'Player not found' });
        const memberships = yield prisma_1.prisma.clubMember.findMany({
            where: { playerId: player.id },
            include: {
                club: {
                    include: {
                        _count: { select: { members: true } }
                    }
                }
            }
        });
        res.json(memberships.map((m) => m.club));
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch clubs' });
    }
}));
// Get single club details & leaderboard
router.get('/:id', auth_1.authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    try {
        const club = yield prisma_1.prisma.club.findUnique({
            where: { id: id },
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
        if (!club)
            return res.status(404).json({ error: 'Club not found' });
        res.json(club);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal error' });
    }
}));
// Get club match history
router.get('/:id/matches', auth_1.authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    try {
        const matches = yield prisma_1.prisma.match.findMany({
            where: { clubId: id },
            orderBy: { createdAt: 'desc' },
            include: {
                participants: {
                    include: { player: { include: { user: { select: { name: true } } } } }
                }
            },
            take: 20
        });
        res.json(matches);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal error' });
    }
}));
exports.default = router;
