const RIOT_API_KEY = process.env.RIOT_API_KEY;

const RIOT_REGIONS = {
    'EUW': 'euw1',
    'NA': 'na1', 
    'EUNE': 'eun1',
    'KR': 'kr',
    'BR': 'br1',
    'LAN': 'la1',
    'LAS': 'la2',
    'OCE': 'oc1',
    'TR': 'tr1',
    'RU': 'ru',
    'JP': 'jp1'
};

const STARTER_CHAMPIONS = [
    86, 22, 13, 1, 89, 54, 17, 18, 19, 45  // Common starter champions by ID
];

async function getRiotChampionPool(riotId, region) {
    try {
        console.log(`Fetching champion pool for ${riotId} in ${region}`);
        
        // Parse Riot ID (TheSpattt#8839)
        const [gameName, tagLine] = riotId.split('#');
        if (!gameName || !tagLine) {
            throw new Error('Invalid Riot ID format. Use: GameName#TAG');
        }
        
        const regionCode = RIOT_REGIONS[region.toUpperCase()];
        if (!regionCode) {
            throw new Error('Invalid region');
        }

        // Step 1: Get account by Riot ID
        const accountResponse = await fetch(
            `https://americas.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
            {
                headers: {
                    'X-Riot-Token': RIOT_API_KEY
                }
            }
        );

        if (!accountResponse.ok) {
            if (accountResponse.status === 404) {
                throw new Error('Riot account not found. Check your Riot ID and try again.');
            }
            throw new Error(`Riot API error: ${accountResponse.status}`);
        }

        const accountData = await accountResponse.json();
        const puuid = accountData.puuid;

        // Step 2: Get summoner info by PUUID
        const summonerResponse = await fetch(
            `https://${regionCode}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`,
            {
                headers: {
                    'X-Riot-Token': RIOT_API_KEY
                }
            }
        );

        if (!summonerResponse.ok) {
            throw new Error('Summoner not found in this region');
        }

        const summonerData = await summonerResponse.json();
        const summonerName = summonerData.name || gameName;
        const summonerLevel = summonerData.summonerLevel || 30;
        
        console.log(`Found summoner: ${summonerName}, Level: ${summonerLevel}`);

        // Step 3: Get champion mastery
        const masteryResponse = await fetch(
            `https://${regionCode}.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-summoner/${summonerData.id}`,
            {
                headers: {
                    'X-Riot-Token': RIOT_API_KEY
                }
            }
        );

        let masteryChampions = [];
        if (masteryResponse.ok) {
            const masteryData = await masteryResponse.json();
            masteryChampions = masteryData.map(champ => champ.championId);
        }

        // Step 4: Get free rotation
        const rotationResponse = await fetch(
            `https://${regionCode}.api.riotgames.com/lol/platform/v3/champion-rotations`,
            {
                headers: {
                    'X-Riot-Token': RIOT_API_KEY
                }
            }
        );

        let freeRotation = [];
        if (rotationResponse.ok) {
            const rotationData = await rotationResponse.json();
            freeRotation = rotationData.freeChampionIds;
        }

        // Step 5: Estimate owned champions (IDs)
        const ownedChampionIds = new Set([
            ...STARTER_CHAMPIONS,
            ...freeRotation,
            ...masteryChampions
        ]);

        const additionalChampions = estimateAdditionalChampions(summonerLevel, masteryChampions.length);
        additionalChampions.forEach(id => ownedChampionIds.add(id));

        console.log(`Estimated ${ownedChampionIds.size} total owned champion IDs`);
        
        // Step 6: Convert IDs to champion names
        const championNames = await convertChampionIdsToNames(Array.from(ownedChampionIds));
        
        console.log(`Converted to ${championNames.length} champion names`);
        console.log(`Sample names: ${championNames.slice(0, 5)}`);
        
        return {
            championIds: championNames,
            summonerName: summonerName,
            summonerLevel: summonerLevel,
            masteryCount: masteryChampions.length
        };

    } catch (error) {
        console.error('Error fetching Riot data:', error);
        throw error;
    }
}

function estimateAdditionalChampions(summonerLevel, masteryCount) {
    
    const baseChampions = 20;
    
    let levelBasedChampions = 0;
    if (summonerLevel >= 30) {
        // Level 30+ players typically have many champions
        levelBasedChampions = Math.min(Math.floor(summonerLevel * 1.2), 100);
    }
    
    // Estimate based on mastery count (more mastery = more champions)
    const masteryBasedChampions = Math.min(masteryCount * 2, 50);
    
    // High level accounts likely have most/all champions
    if (summonerLevel >= 100) {
        levelBasedChampions = Math.min(120 + Math.floor((summonerLevel - 100) * 0.8), 166);
    }
    
    const totalEstimated = 166;
    
    console.log(`Champion estimation for level ${summonerLevel}:`);
    console.log(`  - Base: ${baseChampions}`);
    console.log(`  - Level-based: ${levelBasedChampions}`);
    console.log(`  - Mastery-based: ${masteryBasedChampions}`);
    console.log(`  - Total estimated: ${totalEstimated}`);
    
    // Get popular champions to fill the estimation
    const popularChampionIds = [
        1, 22, 51, 69, 31, 36, 81, 61, 74, 85, 121, 11, 21, 37, 16,
        99, 90, 20, 2, 14, 15, 72, 27, 86, 75, 103, 84, 120, 96, 77,
        25, 53, 18, 32, 92, 104, 24, 34, 39, 40, 41, 42, 43, 44, 45,
        112, 8, 106, 19, 62, 101, 5, 115, 26, 91, 3, 79, 114, 122,
        136, 127, 13, 33, 58, 113, 35, 60, 28, 38, 55, 10, 85, 121,
        131, 9, 30, 38, 55, 10, 4, 31, 6, 7, 23, 63, 89, 17, 18, 48,
        68, 102, 23, 29, 56, 78, 80, 133, 497, 498, 516, 517, 518,
        141, 142, 143, 145, 150, 154, 157, 161, 163, 164, 166, 200,
        201, 202, 203, 222, 223, 234, 235, 236, 238, 240, 245, 246,
        254, 266, 267, 268, 350, 360, 412, 420, 421, 427, 429, 432,
        526, 555, 711, 777, 875, 876, 887, 888, 895, 897, 902, 950
    ];
    
    return popularChampionIds.slice(0, Math.max(0, totalEstimated - baseChampions));
}

async function convertChampionIdsToNames(championIds) {
    try {
        // Get champion data from Riot API (same as your game uses)
        const https = require('https');
        
        const championData = await new Promise((resolve, reject) => {
            const req = https.get('https://ddragon.leagueoflegends.com/cdn/13.24.1/data/en_US/champion.json', (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            req.on('error', reject);
            req.setTimeout(5000, () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });
        });

        if (!championData.data) {
            throw new Error('Failed to get champion data');
        }

        // Create mapping: championKey (number) -> championName (string)
        const keyToNameMap = {};
        Object.values(championData.data).forEach(champ => {
            keyToNameMap[parseInt(champ.key)] = champ.name;
        });

        // Convert champion IDs to names
        const championNames = championIds
            .map(id => keyToNameMap[id])
            .filter(name => name !== undefined); // Remove any that couldn't be converted

        console.log(`ID to Name conversion examples:`);
        championIds.slice(0, 3).forEach(id => {
            console.log(`  ${id} -> ${keyToNameMap[id]}`);
        });
        
        return championNames;
        
    } catch (error) {
        console.error('Error converting champion IDs to names:', error);
        // Return empty array to fallback to all champions
        return [];
    }
}

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

const isDevelopment = !process.env.RENDER_EXTERNAL_URL;
const allowedOrigins = isDevelopment 
    ? ["http://localhost:3000", "http://127.0.0.1:3000"]
    : [process.env.RENDER_EXTERNAL_URL];

console.log('Environment:', isDevelopment ? 'Development' : 'Production');
console.log('Allowed origins:', allowedOrigins);

const io = socketIo(server, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true
    }
});

app.use(cors({
    origin: allowedOrigins,
    credentials: true
}));

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
            playerSocket.emit('gameEnded', room.getGameState());
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

    socket.on('createRoom', (data) => {
        try {
            let { playerName, championPool } = data;
            
            // Validate player name
            if (!playerName || typeof playerName !== 'string' || playerName.trim() === '' || playerName === 'undefined') {
                throw new Error('Invalid player name provided');
            }
            
            playerName = playerName.trim();
            
            console.log(`Creating room for: "${playerName}"`);
            console.log(`Champion pool:`, championPool ? `${championPool.length} champions` : 'all champions');
            
            const room = createRoom(socket, playerName);
            
            // Set champion pool for the player
            if (room.players.has(socket.id)) {
                const player = room.players.get(socket.id);
                player.setChampionPool(championPool);
            }
            
            socket.emit('roomCreated', {
                roomCode: room.code,
                isHost: true,
                gameState: room.getGameStateForPlayer(socket.id)
            });
            
            console.log(`Room ${room.code} created by "${playerName}"`);
        } catch (error) {
            console.error('Error creating room:', error);
            socket.emit('error', `Failed to create room: ${error.message}`);
        }
    });

    socket.on('joinRoom', (data) => {
        let { roomCode, playerName, championPool } = data;
        
        // Validate player name
        if (!playerName || typeof playerName !== 'string' || playerName.trim() === '' || playerName === 'undefined') {
            socket.emit('error', 'Invalid player name provided');
            return;
        }
        
        playerName = playerName.trim();
        const room = gameRooms.get(roomCode);
        
        console.log(`"${playerName}" joining room ${roomCode}`);
        console.log(`Champion pool:`, championPool ? `${championPool.length} champions` : 'all champions');
        
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
            
            // Set champion pool for the player
            if (room.players.has(socket.id)) {
                const player = room.players.get(socket.id);
                player.setChampionPool(championPool);
            }
            
            socket.emit('roomJoined', {
                roomCode: room.code,
                isHost: false,
                gameState: room.getGameStateForPlayer(socket.id)
            });

            sendPersonalizedUpdates(room);
            
            console.log(`"${playerName}" joined room ${roomCode}`);
        } catch (error) {
            console.error('Error joining room:', error);
            socket.emit('error', 'Failed to join room');
        }
    });

    socket.on('linkRiotAccount', async (data) => {
        const { riotId, region } = data;
        
        try {
            const championPool = await getRiotChampionPool(riotId, region);
            
            socket.emit('riotAccountLinked', {
                success: true,
                championPool: championPool,
                message: `Successfully linked ${championPool.summonerName} (Level ${championPool.summonerLevel})`
            });
            
        } catch (error) {
            socket.emit('riotAccountLinked', {
                success: false,
                error: error.message
            });
        }
    });

    socket.on('rejoinRoom', (data) => {
        const { roomCode, playerName } = data;
        const room = gameRooms.get(roomCode);
        
        if (!room) {
            socket.emit('error', 'Room no longer exists');
            return;
        }

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
            
            room.players.delete(oldPlayerId);
            room.players.set(socket.id, existingPlayer);
            existingPlayer.socketId = socket.id;
            existingPlayer.socket = socket;
            
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

    socket.on('startGame', async (data) => {
        let roomCode, rerollTokens;
        
        if (typeof data === 'string') {
            // Old format - just room code
            roomCode = data;
            rerollTokens = 1; // default
        } else {
            // New format - object with settings
            roomCode = data.roomCode;
            rerollTokens = data.rerollTokens || 1;
        }
        
        const room = gameRooms.get(roomCode);
        
        if (!room || room.hostId !== socket.id) {
            socket.emit('error', 'Only host can start the game');
            return;
        }

        try {
            console.log(`Starting game with ${rerollTokens} reroll tokens per player`);
            await room.startChampionSelect(rerollTokens);
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

setInterval(() => {
    for (const [roomCode, room] of gameRooms.entries()) {
        if (room.players.size === 0) {
            cleanupRoom(roomCode);
        }
    }
}, 300000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    if (process.env.RENDER_EXTERNAL_URL) {
        console.log(`Visit ${process.env.RENDER_EXTERNAL_URL} to play!`);
    } else {
        console.log(`Visit http://localhost:${PORT} to play!`);
    }
});