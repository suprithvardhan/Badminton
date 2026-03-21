import express from 'express';
import http from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import { Server } from 'socket.io';

dotenv.config();

import authRoutes from './routes/auth';
import playerRoutes from './routes/player';
import matchRoutes from './routes/match';
import tournamentRoutes from './routes/tournamentRoutes';
import clubRoutes from './routes/club';
import { configureSocket } from './socket';

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/players', playerRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/tournaments', tournamentRoutes);
app.use('/api/clubs', clubRoutes);

app.get('/', (req, res) => {
  res.send('Badminton Platform API is running');
});

// Socket.io
const io = new Server(server, {
  cors: {
    origin: '*', // For dev
    methods: ['GET', 'POST']
  },
  pingInterval: 5000,
  pingTimeout: 10000
});
configureSocket(io);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
