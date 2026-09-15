const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Multer memory storage for Excel upload
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Application State (In-Memory Database)
let state = {
    athletes: [],          // [{ name: "John", avgScore: 120, attempts: [null, null, null], bestScore: 0 }]
    activeAthleteIndex: null,
    guesses: {},           // { socketId: { visitorName: "Alice", athleteIndex: 0, guess: 125 } }
    organizerLoggedIn: false
};

// Route: Upload Excel File
app.post('/api/upload', upload.single('file'), (req, res) => {
    try {
        if (!req.file) return res.status(400).send('No file uploaded.');

        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

        // Expecting Excel columns like "Name" and "AverageScore" (or "Average")
        state.athletes = sheet.map(row => ({
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
        res.status(500).json({ error: 'Failed to process Excel file.' });
    }
});

// Socket.IO Communication
io.on('connection', (socket) => {
    console.log('A user connected');

    // Send current state immediately upon connection
    socket.emit('stateUpdate', state);

    // Organizer Login
    socket.on('organizerLogin', (passcode) => {
        if (passcode === ORGANIZER_PASSWORD) {
            socket.emit('loginResult', { success: true });
        } else {
            socket.emit('loginResult', { success: false, message: 'Invalid Passcode' });
        }
    });

    // Organizer selects active athlete
    socket.on('setActiveAthlete', (index) => {
        state.activeAthleteIndex = index;
        io.emit('stateUpdate', state);
    });

    // Organizer logs an attempt distance
    socket.on('recordAttempt', ({ athleteIndex, attemptNum, distance }) => {
        const athlete = state.athletes[athleteIndex];
        if (athlete) {
            const distNum = parseFloat(distance) || 0;
            athlete.attempts[attemptNum] = distNum;
            // Update furthest/best score
            athlete.bestScore = Math.max(...athlete.attempts.filter(a => a !== null));
            io.emit('stateUpdate', state);
        }
    });

    // Visitor submits a guess
    socket.on('submitGuess', ({ visitorName, guess }) => {
        if (state.activeAthleteIndex === null) return;

        state.guesses[socket.id] = {
            visitorName,
            athleteIndex: state.activeAthleteIndex,
            guess: parseFloat(guess)
        };
        
        io.emit('stateUpdate', state);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
