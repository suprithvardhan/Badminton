"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const socket_io_1 = require("socket.io");
dotenv_1.default.config();
const auth_1 = __importDefault(require("./routes/auth"));
const player_1 = __importDefault(require("./routes/player"));
const match_1 = __importDefault(require("./routes/match"));
const tournamentRoutes_1 = __importDefault(require("./routes/tournamentRoutes"));
const club_1 = __importDefault(require("./routes/club"));
const socket_1 = require("./socket");
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Routes
app.use('/api/auth', auth_1.default);
app.use('/api/players', player_1.default);
app.use('/api/matches', match_1.default);
app.use('/api/tournaments', tournamentRoutes_1.default);
app.use('/api/clubs', club_1.default);
app.get('/', (req, res) => {
    res.send('Badminton Platform API is running');
});
// Socket.io
const io = new socket_io_1.Server(server, {
    cors: {
        origin: '*', // For dev
        methods: ['GET', 'POST']
    },
    pingInterval: 5000,
    pingTimeout: 10000
});
(0, socket_1.configureSocket)(io);
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
