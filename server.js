const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const upload = multer({ storage: multer.memoryStorage() });

const ORGANIZER_PASSWORD = process.env.ORGANIZER_PASSWORD || 'sk1jump2026!';

// Global In-Memory Application State (Multi-Tournament)
let tournaments = {};

function getOrCreateTournament(name) {
    if (!tournaments[name]) {
        tournaments[name] = {
            athletes: [],
            activeAthleteIndex: null,
            guesses: {}
        };
    }
    return tournaments[name];
}

// Serve static frontend files from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Quiet Favicon 404 logs
app.get('/favicon.ico', (req, res) => res.status(204).end());

// API: Excel Roster Upload
app.post('/api/upload', upload.single('file'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

        const tournamentName = req.body.tournamentName || 'Default Event';
        const tourney = getOrCreateTournament(tournamentName);

        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

        tourney.athletes = sheetData.map(row => ({
            name: row.Name || row.name || 'Unknown Athlete',
            avgScore: parseFloat(row.AverageScore || row.avgScore || row.Average || 0),
            attempts: [null, null, null],
            bestScore: 0
        }));

        tourney.activeAthleteIndex = null;
        tourney.guesses = {};

        io.to(tournamentName).emit('stateUpdate', tourney);
        res.json({ success: true, count: tourney.athletes.length });
    } catch (err) {
        console.error('Upload Error:', err);
        res.status(500).json({ success: false, message: 'Error processing file' });
    }
});

// Socket.IO Communication
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // List active tournaments for spectators
    socket.on('getTournamentList', () => {
        socket.emit('tournamentList', Object.keys(tournaments));
    });

    // Join a tournament room
    socket.on('joinTournament', (tournamentName) => {
        socket.join(tournamentName);
        socket.currentTournament = tournamentName;
        
        const tourney = getOrCreateTournament(tournamentName);
        socket.emit('stateUpdate', tourney);
    });

    // Organizer Login
    socket.on('organizerLogin', (passcode) => {
        if (passcode === ORGANIZER_PASSWORD) {
            socket.emit('loginResult', { success: true });
        } else {
            socket.emit('loginResult', { success: false, message: 'Invalid Passcode' });
        }
    });

    // Set Active Athlete (Room Scoped)
    socket.on('setActiveAthlete', (index) => {
        const room = socket.currentTournament;
        if (!room || !tournaments[room]) return;

        const tourney = tournaments[room];
        tourney.activeAthleteIndex = index;
        io.to(room).emit('stateUpdate', tourney);
    });

    // Record Attempt Score (Room Scoped)
    socket.on('recordAttempt', (data) => {
        const room = socket.currentTournament;
        if (!room || !tournaments[room]) return;

        const tourney = tournaments[room];
        const { athleteIndex, attemptNum, distance } = data;

        if (tourney.athletes[athleteIndex]) {
            tourney.athletes[athleteIndex].attempts[attemptNum] = distance;
            
            const valid = tourney.athletes[athleteIndex].attempts.filter(a => a !== null && !isNaN(a));
            if (valid.length > 0) {
                tourney.athletes[athleteIndex].bestScore = Math.max(...valid);
            }
            
            io.to(room).emit('stateUpdate', tourney);
        }
    });

    // Submit Visitor Guess (Room Scoped)
    socket.on('submitGuess', (data) => {
        const room = socket.currentTournament;
        if (!room || !tournaments[room]) return;

        const tourney = tournaments[room];
        const { visitorName, guess } = data;

        if (tourney.activeAthleteIndex !== null) {
            const key = `${socket.id}_${tourney.activeAthleteIndex}`;
            tourney.guesses[key] = {
                visitorName,
                guess: parseFloat(guess),
                athleteIndex: tourney.activeAthleteIndex
            };
            io.to(room).emit('stateUpdate', tourney);
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
