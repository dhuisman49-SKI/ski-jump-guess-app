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

const ORGANIZER_PASSWORD = process.env.ORGANIZER_PASSWORD || 'skijump2026!';

// Global In-Memory Application State (Multi-Tournament)
let tournaments = {};

// Helper function to initialize or retrieve a tournament
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

// Serve static frontend files from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/favicon.ico', (req, res) => res.status(204).end());

// API: Excel Roster Upload
app.post('/api/upload', upload.single('file'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

        state.athletes = sheetData.map(row => ({
            name: row.Name || row.name || 'Unknown Athlete',
            avgScore: parseFloat(row.AverageScore || row.avgScore || row.Average || 0),
            attempts: [null, null, null],
            bestScore: 0
        }));

        state.activeAthleteIndex = null;
        state.guesses = {};

        io.emit('stateUpdate', state);
        res.json({ success: true, count: state.athletes.length });
    } catch (err) {
        console.error('Upload Error:', err);
        res.status(500).json({ success: false, message: 'Error processing file' });
    }
});

// Socket.IO Communication
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Send the current state immediately upon initial connection
    socket.emit('stateUpdate', state);

    // Organizer/Scorer Login
    socket.on('organizerLogin', (passcode) => {
        if (passcode === ORGANIZER_PASSWORD) {
            socket.emit('loginResult', { success: true });
        } else {
            socket.emit('loginResult', { success: false, message: 'Invalid Passcode' });
        }
    });// Socket.IO Communication
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // 1. Send list of active tournaments to newly connected spectator
    socket.on('getTournamentList', () => {
        socket.emit('tournamentList', Object.keys(tournaments));
    });

    // 2. Assign user's socket connection to a specific tournament room
    socket.on('joinTournament', (tournamentName) => {
        socket.join(tournamentName);
        socket.currentTournament = tournamentName; // Store room on socket object
        
        const tourney = getOrCreateTournament(tournamentName);
        // Send state for ONLY this tournament to the joining client
        socket.emit('stateUpdate', tourney);
    });

    // 3. Organizer/Scorer Login
    socket.on('organizerLogin', (passcode) => {
        if (passcode === ORGANIZER_PASSWORD) {
            socket.emit('loginResult', { success: true });
        } else {
            socket.emit('loginResult', { success: false, message: 'Invalid Passcode' });
        }
    });

    // ... rest of socket event handlers (setActiveAthlete, recordAttempt, submitGuess) ...
});

    // Set Active Athlete
    socket.on('setActiveAthlete', (index) => {
        state.activeAthleteIndex = index;
        io.emit('stateUpdate', state);
    });

    // Record Attempt Score
    socket.on('recordAttempt', (data) => {
        const { athleteIndex, attemptNum, distance } = data;
        if (state.athletes[athleteIndex]) {
            state.athletes[athleteIndex].attempts[attemptNum] = distance;
            
            // Recalculate best score using valid numeric attempts
            const validAttempts = state.athletes[athleteIndex].attempts.filter(a => a !== null && !isNaN(a));
            if (validAttempts.length > 0) {
                state.athletes[athleteIndex].bestScore = Math.max(...validAttempts);
            }
            
            io.emit('stateUpdate', state);
        }
    });

    // Submit Visitor/Spectator Guess
    socket.on('submitGuess', (data) => {
        const { visitorName, guess } = data;
        if (state.activeAthleteIndex !== null) {
            const key = `${socket.id}_${state.activeAthleteIndex}`;
            state.guesses[key] = {
                visitorName,
                guess: parseFloat(guess),
                athleteIndex: state.activeAthleteIndex
            };
            io.emit('stateUpdate', state);
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
