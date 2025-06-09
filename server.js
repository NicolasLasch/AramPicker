const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

let GameRoom;
try {
    GameRoom = require('./game/GameRoom');
} catch (error) {
    console.error('Error loading GameRoom:', error);
    process.exit(1);
}

// Test if champions.json exists
const championsPath = path.join(__dirname, 'game', 'champions.json');
if (!fs.existsSync(championsPath)) {
    console.error('champions.json not found at:', championsPath);
    console.log('Creating default champions.json file...');
    
    const defaultChampions = [
        {"id": "ahri", "name": "Ahri", "title": "the Nine-Tailed Fox"},
        {"id": "ashe", "name": "Ashe", "title": "the Frost Archer"},
        {"id": "garen", "name": "Garen", "title": "the Might of Demacia"},
        {"id": "jinx", "name": "Jinx", "title": "the Loose Cannon"},
        {"id": "lux", "name": "Lux", "title": "the Lady of Luminosity"}
    ];
    
    try {
        fs.writeFileSync(championsPath, JSON.stringify(defaultChampions, null, 2));
        console.log('Default champions.json created successfully');
    } catch (writeError) {
        console.error('Could not create champions.json:', writeError);
    }
}

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.static('public'));

const gameRooms = new Map();

function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function createRoom(hostSocket, playerName) {
    let roomCode;
    do {
        roomCode = generateRoomCode();
    } while (gameRooms.has(roomCode));

    console.log(`Creating room with code: ${roomCode}`);
    const room = new GameRoom(roomCode, hostSocket.id, playerName);
    
    gameRooms.set(roomCode, room);
    hostSocket.join(roomCode);
    
    // Add the host player to the room
    room.addPlayer(hostSocket.id, playerName, hostSocket);
    console.log(`Host player ${playerName} added to room ${roomCode}`);
    
    return room;
}

function sendPersonalizedUpdates(room) {
    room.players.forEach((player, playerId) => {
        const playerSocket = player.socket;
        if (playerSocket) {
            playerSocket.emit('gameStateUpdate', room.getGameStateForPlayer(playerId));
        }
    });
}

function sendPersonalizedGameStart(room) {
    room.players.forEach((player, playerId) => {
        const playerSocket = player.socket;
        if (playerSocket) {
            playerSocket.emit('gameStarted', room.getGameStateForPlayer(playerId));
        }
    });
}

function sendPersonalizedGameEnd(room) {
    room.players.forEach((player, playerId) => {
        const playerSocket = player.socket;
        if (playerSocket) {
            playerSocket.emit('gameEnded', room.getGameState()); // Show all champions at end
        }
    });
}

function cleanupRoom(roomCode) {
    const room = gameRooms.get(roomCode);
    if (room) {
        clearInterval(room.timerInterval);
        gameRooms.delete(roomCode);
        console.log(`Room ${roomCode} cleaned up`);
    }
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('createRoom', (playerName) => {
        try {
            console.log(`Attempting to create room for player: ${playerName}`);
            const room = createRoom(socket, playerName);
            console.log(`Room created successfully: ${room.code}`);
            
            socket.emit('roomCreated', {
                roomCode: room.code,
                isHost: true,
                gameState: room.getGameStateForPlayer(socket.id)
            });
            console.log(`Room ${room.code} created by ${playerName}`);
        } catch (error) {
            console.error('Error creating room:', error);
            socket.emit('error', `Failed to create room: ${error.message}`);
        }
    });

    socket.on('joinRoom', (data) => {
        const { roomCode, playerName } = data;
        const room = gameRooms.get(roomCode);
        
        if (!room) {
            socket.emit('error', 'Room not found');
            return;
        }

        if (room.players.size >= 10) {
            socket.emit('error', 'Room is full');
            return;
        }

        if (room.gamePhase !== 'lobby') {
            socket.emit('error', 'Game already in progress');
            return;
        }

        if (room.hasPlayerName(playerName)) {
            socket.emit('error', 'Name already taken');
            return;
        }

        try {
            socket.join(roomCode);
            room.addPlayer(socket.id, playerName, socket);
            
            socket.emit('roomJoined', {
                roomCode: room.code,
                isHost: false,
                gameState: room.getGameStateForPlayer(socket.id)
            });

            // Send personalized updates to each player
            room.players.forEach((player, playerId) => {
                const playerSocket = player.socket;
                if (playerSocket) {
                    playerSocket.emit('gameStateUpdate', room.getGameStateForPlayer(playerId));
                }
            });
            
            console.log(`${playerName} joined room ${roomCode}`);
        } catch (error) {
            socket.emit('error', 'Failed to join room');
        }
    });

    socket.on('rejoinRoom', (data) => {
        const { roomCode, playerName } = data;
        const room = gameRooms.get(roomCode);
        
        if (!room) {
            socket.emit('error', 'Room no longer exists');
            return;
        }

        // Find if player was already in the room
        let existingPlayer = null;
        let oldPlayerId = null;
        for (const [playerId, player] of room.players) {
            if (player.name === playerName) {
                existingPlayer = player;
                oldPlayerId = playerId;
                break;
            }
        }

        if (!existingPlayer) {
            socket.emit('error', 'Player not found in room');
            return;
        }

        try {
            socket.join(roomCode);
            
            // Update the socket ID and socket reference
            room.players.delete(oldPlayerId);
            room.players.set(socket.id, existingPlayer);
            existingPlayer.socketId = socket.id;
            existingPlayer.socket = socket;
            
            // Check if this player was the host (compare by name since socket ID changed)
            const isHost = room.hostId === oldPlayerId;
            if (isHost) {
                room.hostId = socket.id;
            }
            
            socket.emit('roomRejoined', {
                roomCode: room.code,
                isHost: isHost,
                gameState: room.getGameStateForPlayer(socket.id)
            });

            console.log(`${playerName} rejoined room ${roomCode}`);
        } catch (error) {
            console.error('Error rejoining room:', error);
            socket.emit('error', 'Failed to rejoin room');
        }
    });

    socket.on('joinTeam', (data) => {
        const { roomCode, team } = data;
        const room = gameRooms.get(roomCode);
        
        if (!room || !room.players.has(socket.id)) {
            socket.emit('error', 'Invalid room or player');
            return;
        }

        try {
            room.movePlayerToTeam(socket.id, team);
            sendPersonalizedUpdates(room);
        } catch (error) {
            socket.emit('error', error.message);
        }
    });

    socket.on('startGame', async (roomCode) => {
        const room = gameRooms.get(roomCode);
        
        if (!room || room.hostId !== socket.id) {
            socket.emit('error', 'Only host can start the game');
            return;
        }

        try {
            await room.startChampionSelect();
            sendPersonalizedGameStart(room);
            console.log(`Game started in room ${roomCode}`);
        } catch (error) {
            console.error(`Error starting game in room ${roomCode}:`, error.message);
            socket.emit('error', error.message);
        }
    });

    socket.on('rerollChampion', (roomCode) => {
        const room = gameRooms.get(roomCode);
        
        if (!room || !room.players.has(socket.id)) {
            socket.emit('error', 'Invalid room or player');
            return;
        }

        try {
            room.rerollChampion(socket.id);
            sendPersonalizedUpdates(room);
        } catch (error) {
            socket.emit('error', error.message);
        }
    });

    socket.on('swapWithBench', (data) => {
        const { roomCode, championId } = data;
        const room = gameRooms.get(roomCode);
        
        if (!room || !room.players.has(socket.id)) {
            socket.emit('error', 'Invalid room or player');
            return;
        }

        try {
            room.swapWithBench(socket.id, championId);
            sendPersonalizedUpdates(room);
        } catch (error) {
            socket.emit('error', error.message);
        }
    });

    socket.on('lockChampion', (roomCode) => {
        const room = gameRooms.get(roomCode);
        
        if (!room || !room.players.has(socket.id)) {
            socket.emit('error', 'Invalid room or player');
            return;
        }

        try {
            room.lockPlayer(socket.id);
            sendPersonalizedUpdates(room);
            
            if (room.allPlayersLocked()) {
                room.endChampionSelect();
                sendPersonalizedGameEnd(room);
            }
        } catch (error) {
            socket.emit('error', error.message);
        }
    });

    socket.on('offerTrade', (data) => {
        const { roomCode, targetPlayerId } = data;
        const room = gameRooms.get(roomCode);
        
        if (!room || !room.players.has(socket.id)) {
            socket.emit('error', 'Invalid room or player');
            return;
        }

        try {
            room.offerTrade(socket.id, targetPlayerId);
            const targetSocket = room.players.get(targetPlayerId).socket;
            targetSocket.emit('tradeOffer', {
                fromPlayer: room.players.get(socket.id).name,
                fromChampion: room.players.get(socket.id).champion,
                toChampion: room.players.get(targetPlayerId).champion
            });
        } catch (error) {
            socket.emit('error', error.message);
        }
    });

    socket.on('respondToTrade', (data) => {
        const { roomCode, accepted } = data;
        const room = gameRooms.get(roomCode);
        
        if (!room || !room.players.has(socket.id)) {
            socket.emit('error', 'Invalid room or player');
            return;
        }

        try {
            if (accepted) {
                room.acceptTrade(socket.id);
            } else {
                room.declineTrade(socket.id);
            }
            sendPersonalizedUpdates(room);
        } catch (error) {
            socket.emit('error', error.message);
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        for (const [roomCode, room] of gameRooms.entries()) {
            if (room.players.has(socket.id)) {
                room.removePlayer(socket.id);
                
                if (room.players.size === 0) {
                    cleanupRoom(roomCode);
                } else {
                    sendPersonalizedUpdates(room);
                }
                break;
            }
        }
    });
});

// Cleanup empty rooms every 5 minutes
setInterval(() => {
    for (const [roomCode, room] of gameRooms.entries()) {
        if (room.players.size === 0) {
            cleanupRoom(roomCode);
        }
    }
}, 300000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Visit http://localhost:${PORT} to play!`);
});