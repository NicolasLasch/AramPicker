const { ChampionPoolDatabase, getAllChampionsFromRiot } = require('./database');

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
    86, 22, 13, 1, 89, 54, 17, 18, 19, 45  
];

async function getRiotChampionPool(riotId, region) {
    try {
        console.log(`Fetching champion pool for ${riotId} in ${region}`);
        
        const [gameName, tagLine] = riotId.split('#');
        if (!gameName || !tagLine) {
            throw new Error('Invalid Riot ID format. Use: GameName#TAG');
        }
        
        const regionCode = RIOT_REGIONS[region.toUpperCase()];
        if (!regionCode) {
            throw new Error('Invalid region');
        }

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
        
        console.log(`Found summoner: ${summonerName}, Level: ${summonerLevel}, PUUID: ${puuid}`);

        // Check if user has a saved champion pool in database
        try {
            const savedPool = await championPoolDB.getChampionPoolNames(puuid);
            
            if (savedPool.length > 0) {
                console.log(`Using saved champion pool for ${summonerName}: ${savedPool.length} champions`);
                console.log(`First 5 champions: ${savedPool.slice(0, 5)}`);
                return {
                    championIds: savedPool,
                    summonerName: summonerName,
                    summonerLevel: summonerLevel,
                    puuid: puuid,
                    region: regionCode,
                    source: 'database'
                };
            } else {
                console.log(`No saved champion pool found for ${summonerName} (PUUID: ${puuid})`);
            }
        } catch (dbError) {
            console.error('Database error while checking champion pool:', dbError);
        }
        
        // Fallback to estimated pool if no saved pool
        console.log(`Using estimated champion pool for ${summonerName}`);

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

        const ownedChampionIds = new Set([
            ...STARTER_CHAMPIONS,
            ...freeRotation,
            ...masteryChampions
        ]);

        const additionalChampions = estimateAdditionalChampions(summonerLevel, masteryChampions.length);
        additionalChampions.forEach(id => ownedChampionIds.add(id));

        console.log(`Estimated ${ownedChampionIds.size} total owned champion IDs`);
        
        const championNames = await convertChampionIdsToNames(Array.from(ownedChampionIds));
        
        console.log(`Converted to ${championNames.length} champion names`);
        
        return {
            championIds: championNames,
            summonerName: summonerName,
            summonerLevel: summonerLevel,
            masteryCount: masteryChampions.length,
            puuid: puuid,
            region: regionCode,
            source: 'estimated'
        };

    } catch (error) {
        console.error('Error fetching Riot data:', error);
        throw error;
    }
}

async function getChampionWinrate(puuid, region, championName) {
    try {
        console.log(`Fetching winrate for ${championName} for player ${puuid}`);
        
        const championIdMapping = await getChampionIdMapping();
        const championKey = getChampionKeyByName(championName, championIdMapping);
        
        if (!championKey) {
            console.log(`Champion ${championName} not found in mapping`);
            return null;
        }

        const regionMap = {
            'euw1': 'europe',
            'na1': 'americas',
            'eun1': 'europe',
            'kr': 'asia',
            'br1': 'americas',
            'la1': 'americas',
            'la2': 'americas',
            'oc1': 'asia',
            'tr1': 'europe',
            'ru': 'europe',
            'jp1': 'asia'
        };

        const regionalEndpoint = regionMap[region] || 'americas';
        
        const matchesResponse = await fetch(
            `https://${regionalEndpoint}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=450&count=20`,
            {
                headers: {
                    'X-Riot-Token': RIOT_API_KEY
                }
            }
        );

        if (!matchesResponse.ok) {
            if (matchesResponse.status === 429) {
                console.log(`Rate limited while fetching matches for ${championName} - skipping`);
                return null;
            }
            console.log(`Failed to fetch matches: ${matchesResponse.status}`);
            return null;
        }

        const matchIds = await matchesResponse.json();
        
        if (matchIds.length === 0) {
            console.log('No ARAM matches found');
            return null;
        }

        console.log(`Found ${matchIds.length} ARAM matches, checking for ${championName}`);

        let championGames = 0;
        let championWins = 0;

        for (const matchId of matchIds) {
            try {
                const matchResponse = await fetch(
                    `https://${regionalEndpoint}.api.riotgames.com/lol/match/v5/matches/${matchId}`,
                    {
                        headers: {
                            'X-Riot-Token': RIOT_API_KEY
                        }
                    }
                );

                if (!matchResponse.ok) {
                    if (matchResponse.status === 429) {
                        console.log(`Rate limited on match ${matchId} - stopping here`);
                        break;
                    }
                    console.log(`Failed to fetch match ${matchId}: ${matchResponse.status}`);
                    continue;
                }

                const matchData = await matchResponse.json();
                
                if (matchData.info.gameMode !== 'ARAM') {
                    continue;
                }

                const participant = matchData.info.participants.find(p => p.puuid === puuid);
                
                if (participant && participant.championId == championKey) {
                    championGames++;
                    if (participant.win) {
                        championWins++;
                    }
                    console.log(`Match ${matchId}: ${participant.win ? 'WIN' : 'LOSS'} with ${championName}`);
                }

                await new Promise(resolve => setTimeout(resolve, 100));
                
            } catch (error) {
                console.error(`Error processing match ${matchId}:`, error);
                continue;
            }
        }

        if (championGames === 0) {
            console.log(`No games found with ${championName} in recent matches`);
            return null;
        }

        const winrate = Math.round((championWins / championGames) * 100);
        console.log(`${championName} winrate: ${championWins}/${championGames} (${winrate}%)`);
        
        return {
            wins: championWins,
            games: championGames,
            winrate: winrate
        };

    } catch (error) {
        console.error('Error fetching champion winrate:', error);
        return null;
    }
}

async function getChampionIdMapping() {
    try {
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

        return championData.data || {};
    } catch (error) {
        console.error('Error fetching champion mapping:', error);
        return {};
    }
}

function getChampionKeyByName(championName, championMapping) {
    for (const [id, champion] of Object.entries(championMapping)) {
        if (champion.name === championName) {
            return parseInt(champion.key);
        }
    }
    return null;
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

app.use(express.json({ limit: '10mb' }));

app.get('/api/champions', async (req, res) => {
    try {
        const champions = await getAllChampionsFromRiot();
        res.json(champions);
    } catch (error) {
        console.error('Error fetching champions:', error);
        res.status(500).json({ error: 'Failed to fetch champions' });
    }
});

app.get('/api/champion-pool/:puuid', async (req, res) => {
    try {
        const { puuid } = req.params;
        const championPool = await championPoolDB.getChampionPool(puuid);
        res.json(championPool);
    } catch (error) {
        console.error('Error fetching champion pool:', error);
        res.status(500).json({ error: 'Failed to fetch champion pool' });
    }
});

app.post('/api/save-champion-pool', async (req, res) => {
    try {
        console.log('Received champion pool save request');
        console.log('Request body:', req.body);
        
        if (!req.body) {
            return res.status(400).json({ error: 'No request body provided' });
        }
        
        const { puuid, summonerName, region, championPool } = req.body;
        
        if (!puuid || !summonerName || !region) {
            return res.status(400).json({ 
                error: 'Missing required fields: puuid, summonerName, or region' 
            });
        }
        
        if (!Array.isArray(championPool)) {
            return res.status(400).json({ 
                error: 'championPool must be an array' 
            });
        }
        
        console.log(`Processing champion pool for ${summonerName} (${puuid}): ${championPool.length} champions`);
        
        // Get or create user (this will now properly reuse existing users)
        const userId = await championPoolDB.saveUser(puuid, summonerName, region);
        console.log(`Using user ID: ${userId}`);
        
        // Save the champion pool
        await championPoolDB.saveChampionPool(userId, championPool);
        
        console.log('✅ Champion pool saved successfully');
        
        // Verify it was saved
        const verification = await championPoolDB.getChampionPoolNames(puuid);
        console.log(`Verification: Found ${verification.length} champions in database`);
        
        res.json({ 
            success: true, 
            message: 'Champion pool saved successfully',
            userId: userId,
            championCount: championPool.length
        });
        
    } catch (error) {
        console.error('Error saving champion pool:', error);
        res.status(500).json({ error: 'Failed to save champion pool: ' + error.message });
    }
});

app.get('/api/debug-users', async (req, res) => {
    try {
        // Get all users from database
        const users = await new Promise((resolve, reject) => {
            championPoolDB.db.all('SELECT * FROM users ORDER BY id DESC LIMIT 10', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        // Get all champion pools
        const pools = await new Promise((resolve, reject) => {
            championPoolDB.db.all(`
                SELECT cp.*, u.summoner_name, u.puuid 
                FROM champion_pools cp 
                JOIN users u ON cp.user_id = u.id 
                ORDER BY cp.user_id, cp.champion_name
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        res.json({ users, pools });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const championPoolDB = new ChampionPoolDatabase();

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
        let playerSocket = player.socket;
        
        // Ensure socket is still connected, if not try to find it
        if (!playerSocket || !playerSocket.connected) {
            const allSockets = io.sockets.sockets;
            playerSocket = allSockets.get(playerId);
            if (playerSocket) {
                player.socket = playerSocket; // Update reference
            }
        }
        
        if (playerSocket && playerSocket.connected) {
            playerSocket.emit('gameStateUpdate', room.getGameStateForPlayer(playerId));
        } else {
            console.log(`⚠️ Could not send update to ${player.name} - socket not available`);
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

    socket.on('createRoom', async (data) => {
        try {
            let { playerName, championPool, riotData } = data;
            
            if (!playerName || typeof playerName !== 'string' || playerName.trim() === '' || playerName === 'undefined') {
                throw new Error('Invalid player name provided');
            }
            
            playerName = playerName.trim();
            
            console.log(`Creating room for: "${playerName}"`);
            
            // If user has riot data, check database for saved champion pool
            if (riotData && riotData.puuid) {
                try {
                    const savedPool = await championPoolDB.getChampionPoolNames(riotData.puuid);
                    if (savedPool.length > 0) {
                        championPool = savedPool;
                        console.log(`🎯 FORCING DATABASE POOL for ${playerName}: ${savedPool.length} champions`);
                        console.log(`Database pool: ${savedPool.slice(0, 5)}`);
                    } else {
                        console.log(`No saved pool in database for ${playerName}`);
                    }
                } catch (dbError) {
                    console.error('Error checking database pool:', dbError);
                }
            }
            
            console.log(`Final champion pool:`, championPool ? `${championPool.length} champions` : 'all champions');
            
            const room = createRoom(socket, playerName);
            
            if (room.players.has(socket.id)) {
                const player = room.players.get(socket.id);
                player.setChampionPool(championPool);
                
                if (riotData) {
                    player.riotData = riotData;
                    console.log(`Stored Riot data for ${playerName}: ${riotData.puuid}`);
                }
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

    socket.on('joinRoom', async (data) => {
        let { roomCode, playerName, championPool, riotData } = data;
        
        if (!playerName || typeof playerName !== 'string' || playerName.trim() === '' || playerName === 'undefined') {
            socket.emit('error', 'Invalid player name provided');
            return;
        }
        
        playerName = playerName.trim();
        const room = gameRooms.get(roomCode);
        
        console.log(`"${playerName}" joining room ${roomCode}`);
        
        // If user has riot data, check database for saved champion pool
        if (riotData && riotData.puuid) {
            try {
                const savedPool = await championPoolDB.getChampionPoolNames(riotData.puuid);
                if (savedPool.length > 0) {
                    championPool = savedPool;
                    console.log(`🎯 FORCING DATABASE POOL for ${playerName}: ${savedPool.length} champions`);
                    console.log(`Database pool: ${savedPool.slice(0, 5)}`);
                } else {
                    console.log(`No saved pool in database for ${playerName}`);
                }
            } catch (dbError) {
                console.error('Error checking database pool:', dbError);
            }
        }
        
        console.log(`Final champion pool:`, championPool ? `${championPool.length} champions` : 'all champions');
        
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
            
            if (room.players.has(socket.id)) {
                const player = room.players.get(socket.id);
                player.setChampionPool(championPool);
                
                if (riotData) {
                    player.riotData = riotData;
                    console.log(`Stored Riot data for ${playerName}: ${riotData.puuid}`);
                }
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
                riotData: {
                    puuid: championPool.puuid,
                    region: championPool.region
                },
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
        let roomCode, rerollTokens, draftMode;
        
        if (typeof data === 'string') {
            // Old format - just room code
            roomCode = data;
            rerollTokens = 1;
            draftMode = 'aram';
        } else {
            // New format - object with settings
            roomCode = data.roomCode;
            rerollTokens = data.rerollTokens || 1;
            draftMode = data.draftMode || 'aram';
        }
        
        const room = gameRooms.get(roomCode);
        
        if (!room || room.hostId !== socket.id) {
            socket.emit('error', 'Only host can start the game');
            return;
        }

        try {
            console.log(`🎮 Starting game with mode: ${draftMode}, rerolls: ${rerollTokens}`);
            
            await room.startChampionSelect({
                rerollTokens: rerollTokens,
                draftMode: draftMode
            });
            
            sendPersonalizedGameStart(room);
            console.log(`✅ Game started in room ${roomCode} with ${draftMode} mode`);
        } catch (error) {
            console.error(`❌ Error starting game in room ${roomCode}:`, error.message);
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

    socket.on('pickCard', (data) => {
        const { roomCode, cardIndex } = data;
        const room = gameRooms.get(roomCode);
        
        if (!room || !room.players.has(socket.id)) {
            socket.emit('error', 'Invalid room or player');
            return;
        }

        try {
            console.log(`Player ${socket.id} picking card ${cardIndex} in room ${roomCode}`);
            room.pickCard(socket.id, cardIndex);
            sendPersonalizedUpdates(room);
            
            // Check if all players have picked
            const playersWithTeams = Array.from(room.players.values()).filter(p => p.team);
            const allPicked = playersWithTeams.every(p => p.hasPicked || p.champion);
            
            if (allPicked) {
                console.log('All players have picked their cards');
            }
        } catch (error) {
            console.error('Error in pickCard:', error);
            socket.emit('error', error.message);
        }
    });

    socket.on('placeBid', (data) => {
        const { roomCode, bidAmount } = data;
        const room = gameRooms.get(roomCode);
        
        if (!room || !room.players.has(socket.id)) {
            socket.emit('error', 'Invalid room or player');
            return;
        }

        try {
            console.log(`Player ${socket.id} placing bid ${bidAmount} in room ${roomCode}`);
            room.placeBid(socket.id, bidAmount);
            // broadcastAuctionUpdate is called inside placeBid method
        } catch (error) {
            console.error('Error in placeBid:', error);
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
            console.log(`🔄 Trade offer from ${socket.id} to ${targetPlayerId} in room ${roomCode}`);
            console.log(`   - Draft mode: ${room.currentDraftMode}`);
            console.log(`   - Auction phase: ${room.auctionPhase}`);
            
            const tradeResult = room.offerTrade(socket.id, targetPlayerId);
            
            // Send confirmation to initiating player
            socket.emit('tradeOfferSent', {
                targetPlayerName: tradeResult.toPlayerName,
                yourChampion: tradeResult.fromChampion.name,
                theirChampion: tradeResult.toChampion.name
            });
            
            // Find target player socket - with multiple fallback methods
            const targetPlayer = room.players.get(targetPlayerId);
            if (!targetPlayer) {
                throw new Error('Target player not found in room');
            }
            
            let targetSocket = targetPlayer.socket;
            
            // Fallback 1: Check if socket is still connected
            if (!targetSocket || !targetSocket.connected) {
                console.log(`⚠️ Target socket not connected, searching by ID...`);
                
                // Fallback 2: Find socket by ID in all connected sockets
                const allSockets = io.sockets.sockets;
                targetSocket = allSockets.get(targetPlayerId);
                
                if (targetSocket) {
                    console.log(`✅ Found target socket via ID lookup`);
                    targetPlayer.socket = targetSocket; // Update reference
                }
            }
            
            if (!targetSocket || !targetSocket.connected) {
                throw new Error('Target player is not connected');
            }
            
            // Send trade request to target player
            console.log(`📤 Sending trade offer to ${tradeResult.toPlayerName} (${targetPlayerId})`);
            targetSocket.emit('tradeOffer', {
                fromPlayer: tradeResult.fromPlayerName,
                fromChampion: tradeResult.fromChampion,
                toChampion: tradeResult.toChampion
            });
            
            console.log(`✅ Trade offer sent from ${tradeResult.fromPlayerName} to ${tradeResult.toPlayerName}`);
            
        } catch (error) {
            console.error('❌ Trade offer error:', error);
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

    socket.on('getChampionWinrate', async (data) => {
        const { championName, playerSocketId } = data;
        
        try {
            const room = findRoomByPlayer(playerSocketId);
            if (!room) {
                socket.emit('championWinrateResult', { error: 'Room not found' });
                return;
            }

            const player = room.players.get(playerSocketId);
            if (!player || !player.riotData) {
                socket.emit('championWinrateResult', { error: 'Player not linked to Riot account' });
                return;
            }

            const winrateData = await getChampionWinrate(
                player.riotData.puuid,
                player.riotData.region,
                championName
            );

            socket.emit('championWinrateResult', {
                championName: championName,
                winrate: winrateData
            });

        } catch (error) {
            console.error('Error getting champion winrate:', error);
            socket.emit('championWinrateResult', { error: 'Failed to fetch winrate data' });
        }
    });
});

function findRoomByPlayer(playerSocketId) {
    for (const [roomCode, room] of gameRooms.entries()) {
        if (room.players.has(playerSocketId)) {
            return room;
        }
    }
    return null;
}

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