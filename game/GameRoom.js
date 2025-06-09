const Player = require('./Player');
const champions = require('./champions.json');

class GameRoom {
    constructor(code, hostId, hostName) {
        this.code = code;
        this.hostId = hostId;
        this.players = new Map();
        this.gamePhase = 'lobby';
        this.blueBench = [];
        this.redBench = [];
        this.timer = 90;
        this.timerInterval = null;
        this.pendingTrades = new Map();
        
        this.champions = [];
        this.championsLoaded = false;
        
        console.log(`GameRoom created: ${code}`);
    }

    async loadChampions() {
        if (this.championsLoaded) return;
        
        try {
            console.log('Loading champions from Riot API...');
            const https = require('https');
            
            const championData = await new Promise((resolve, reject) => {
                const req = https.get('https://ddragon.leagueoflegends.com/cdn/13.24.1/data/en_US/champion.json', (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        try {
                            const parsed = JSON.parse(data);
                            resolve(parsed);
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

            if (championData.data) {
                this.champions = Object.values(championData.data);
                console.log(`Loaded ${this.champions.length} champions from Riot API`);
            } else {
                throw new Error('Invalid champion data structure');
            }
            
        } catch (error) {
            console.error('Failed to load champions from API:', error.message);
            console.log('Using fallback champion list...');
            this.champions = this.generateSampleChampions();
        }
        
        this.championsLoaded = true;
    }

    generateSampleChampions() {
        const sampleNames = [
            'Ahri', 'Akali', 'Ashe', 'Azir', 'Brand', 'Caitlyn', 'Darius', 'Diana', 
            'Ezreal', 'Fiora', 'Garen', 'Graves', 'Heimerdinger', 'Irelia', 'Jax', 
            'Jinx', 'Karma', 'Katarina', 'LeBlanc', 'Lee Sin', 'Lux', 'Malphite', 
            'Master Yi', 'Morgana', 'Nasus', 'Orianna', 'Pantheon', 'Quinn', 'Riven', 
            'Sona', 'Teemo', 'Thresh', 'Urgot', 'Vayne', 'Wukong', 'Xerath', 'Yasuo', 'Zed'
        ];
        
        return sampleNames.map(name => ({
            id: name.toLowerCase().replace(/\s+/g, ''),
            name: name,
            title: `the ${name} Champion`
        }));
    }

    addPlayer(socketId, name, socket = null) {
        console.log(`Adding player: ${name} with socketId: ${socketId}`);
        
        if (this.players.size >= 10) {
            throw new Error('Room is full');
        }
        
        if (this.hasPlayerName(name)) {
            throw new Error('Name already taken');
        }

        try {
            const player = new Player(socketId, name, socket);
            this.players.set(socketId, player);
            console.log(`Player ${name} successfully added. Total players: ${this.players.size}`);
        } catch (error) {
            console.error(`Error creating player ${name}:`, error);
            throw error;
        }
    }

    removePlayer(socketId) {
        const player = this.players.get(socketId);
        if (player && player.champion && player.team) {
            // Put the player's champion back in their team bench when they leave
            if (player.team === 'blue') {
                if (!this.blueBench) this.blueBench = [];
                this.blueBench.push(player.champion);
            } else if (player.team === 'red') {
                if (!this.redBench) this.redBench = [];
                this.redBench.push(player.champion);
            }
            console.log(`${player.name} left, their champion ${player.champion.name} added to ${player.team} bench`);
        }
        
        this.players.delete(socketId);
        
        // If the host left, assign a new host
        if (this.hostId === socketId && this.players.size > 0) {
            this.hostId = this.players.keys().next().value;
            console.log(`New host assigned: ${this.hostId}`);
        }
    }

    hasPlayerName(name) {
        return Array.from(this.players.values()).some(player => player.name === name);
    }

    movePlayerToTeam(socketId, team) {
        const player = this.players.get(socketId);
        if (!player) {
            throw new Error('Player not found');
        }

        const teamPlayers = this.getTeamPlayers(team);
        if (teamPlayers.length >= 5) {
            throw new Error('Team is full');
        }

        player.team = team;
    }

    getTeamPlayers(team) {
        return Array.from(this.players.values()).filter(p => p.team === team);
    }

    async startChampionSelect() {
        const playersWithTeams = Array.from(this.players.values()).filter(p => p.team);
        const blueTeam = Array.from(this.players.values()).filter(p => p.team === 'blue');
        const redTeam = Array.from(this.players.values()).filter(p => p.team === 'red');
        
        if (blueTeam.length === 0) {
            throw new Error('Blue team needs at least 1 player');
        }
        
        if (redTeam.length === 0) {
            throw new Error('Red team needs at least 1 player');
        }
        
        if (playersWithTeams.length < 2) {
            throw new Error('Need at least 2 players with teams to start');
        }

        // Load champions first
        await this.loadChampions();
        
        this.gamePhase = 'champion-select';
        
        // Assign random champions to all players
        this.assignRandomChampions();
        
        // Initialize empty team benches
        this.blueBench = [];
        this.redBench = [];
        
        this.startTimer();
    }

    assignRandomChampions() {
        const playersWithTeams = Array.from(this.players.values()).filter(p => p.team);
        
        playersWithTeams.forEach(player => {
            // Give each player a random champion from the full pool
            const randomChampion = this.champions[Math.floor(Math.random() * this.champions.length)];
            player.champion = randomChampion;
        });
        
        console.log('Assigned random champions to all players');
    }

    rerollChampion(socketId) {
        const player = this.players.get(socketId);
        if (!player || player.rerollTokens <= 0 || player.locked || !player.champion) {
            throw new Error('Cannot reroll');
        }

        const oldChampion = player.champion;
        console.log(`${player.name} is rerolling ${oldChampion.name} from team ${player.team}`);

        // Put current champion in team bench
        if (player.team === 'blue') {
            if (!this.blueBench) this.blueBench = [];
            this.blueBench.push(oldChampion);
            console.log(`Added ${oldChampion.name} to blue bench. Blue bench now has:`, this.blueBench.map(c => c.name));
        } else if (player.team === 'red') {
            if (!this.redBench) this.redBench = [];
            this.redBench.push(oldChampion);
            console.log(`Added ${oldChampion.name} to red bench. Red bench now has:`, this.redBench.map(c => c.name));
        }

        // Get a new random champion from full pool (excluding team bench)
        const teamBench = player.team === 'blue' ? this.blueBench : this.redBench;
        const availableChampions = this.champions.filter(c => 
            !teamBench.some(b => b.id === c.id)
        );
        
        if (availableChampions.length > 0) {
            const randomChampion = availableChampions[Math.floor(Math.random() * availableChampions.length)];
            player.champion = randomChampion;
            console.log(`${player.name} got new champion: ${randomChampion.name}`);
        } else {
            // Fallback: use any champion if somehow no available ones
            const fallbackChampion = this.champions[Math.floor(Math.random() * this.champions.length)];
            player.champion = fallbackChampion;
            console.log(`${player.name} got fallback champion: ${fallbackChampion.name}`);
        }

        player.rerollTokens--;
        console.log(`${player.name} has ${player.rerollTokens} reroll tokens left`);
        
        // Debug: Print both benches
        console.log('Current blue bench:', (this.blueBench || []).map(c => c.name));
        console.log('Current red bench:', (this.redBench || []).map(c => c.name));
    }

    swapWithBench(socketId, championId) {
        const player = this.players.get(socketId);
        if (!player || player.locked || !player.champion) {
            throw new Error('Cannot swap');
        }

        const teamBench = player.team === 'blue' ? this.blueBench : this.redBench;
        if (!teamBench) {
            throw new Error('Team bench not initialized');
        }
        
        const benchIndex = teamBench.findIndex(c => c.id === championId);
        
        if (benchIndex === -1) {
            console.log(`Champion ${championId} not found in ${player.team} bench:`, teamBench.map(c => c.name));
            throw new Error('Champion not in team bench');
        }

        const benchChampion = teamBench[benchIndex];
        const oldChampion = player.champion;
        
        console.log(`${player.name} swapping ${oldChampion.name} for ${benchChampion.name} from ${player.team} bench`);
        
        // Swap: put current champion in bench, take bench champion
        teamBench[benchIndex] = oldChampion;
        player.champion = benchChampion;
        
        console.log(`Swap complete. ${player.team} bench now has:`, teamBench.map(c => c.name));
    }

    getAvailableChampions() {
        const usedChampions = Array.from(this.players.values())
            .filter(p => p.champion)
            .map(p => p.champion.id);
        
        const benchChampions = this.bench.map(c => c.id);
        
        return this.champions.filter(c => 
            !usedChampions.includes(c.id) && 
            !benchChampions.includes(c.id)
        );
    }

    lockPlayer(socketId) {
        const player = this.players.get(socketId);
        if (!player || !player.champion) {
            throw new Error('Cannot lock without champion');
        }

        player.locked = true;
    }

    allPlayersLocked() {
        const playersWithTeams = Array.from(this.players.values()).filter(p => p.team);
        return playersWithTeams.length > 0 && playersWithTeams.every(p => p.locked);
    }

    offerTrade(fromSocketId, toSocketId) {
        const fromPlayer = this.players.get(fromSocketId);
        const toPlayer = this.players.get(toSocketId);
        
        if (!fromPlayer || !toPlayer || !fromPlayer.champion || !toPlayer.champion) {
            throw new Error('Invalid trade offer');
        }

        if (fromPlayer.team !== toPlayer.team || fromPlayer.locked || toPlayer.locked) {
            throw new Error('Cannot trade');
        }

        this.pendingTrades.set(toSocketId, {
            from: fromSocketId,
            to: toSocketId,
            timestamp: Date.now()
        });
    }

    acceptTrade(socketId) {
        const trade = this.pendingTrades.get(socketId);
        if (!trade) {
            throw new Error('No pending trade');
        }

        const playerA = this.players.get(trade.from);
        const playerB = this.players.get(trade.to);

        if (!playerA || !playerB) {
            throw new Error('Trade players not found');
        }

        [playerA.champion, playerB.champion] = [playerB.champion, playerA.champion];
        this.pendingTrades.delete(socketId);
    }

    declineTrade(socketId) {
        this.pendingTrades.delete(socketId);
    }

    startTimer() {
        this.timerInterval = setInterval(() => {
            this.timer--;
            
            this.players.forEach((player, playerId) => {
                const playerSocket = player.socket;
                if (playerSocket) {
                    playerSocket.emit('gameStateUpdate', this.getGameStateForPlayer(playerId));
                }
            });
            
            if (this.timer <= 0) {
                this.autoLockAllPlayers();
                this.endChampionSelect();
            }
        }, 1000);
    }

    autoLockAllPlayers() {
        const playersWithTeams = Array.from(this.players.values()).filter(p => p.team);
        
        playersWithTeams.forEach(player => {
            if (!player.locked) {
                // If somehow player has no champion, give them a random one
                if (!player.champion) {
                    player.champion = this.champions[Math.floor(Math.random() * this.champions.length)];
                }
                player.locked = true;
            }
        });
        
        console.log('Auto-locked all remaining players');
    }

    endChampionSelect() {
        clearInterval(this.timerInterval);
        this.gamePhase = 'completed';
        this.timer = 0;
    }

    getGameState() {
        const playerStates = {};
        this.players.forEach((player, socketId) => {
            playerStates[socketId] = {
                id: socketId,
                name: player.name,
                team: player.team,
                // Only show champion if it's the same team or game is completed
                champion: player.champion,
                rerollTokens: player.rerollTokens,
                locked: player.locked
            };
        });

        return {
            code: this.code,
            hostId: this.hostId,
            gamePhase: this.gamePhase,
            timer: this.timer,
            players: playerStates,
            bench: this.bench,
            pendingTrades: Object.fromEntries(this.pendingTrades)
        };
    }

    getGameStateForPlayer(requestingSocketId) {
        const requestingPlayer = this.players.get(requestingSocketId);
        const playerStates = {};
        
        this.players.forEach((player, socketId) => {
            playerStates[socketId] = {
                id: socketId,
                name: player.name,
                team: player.team,
                champion: (socketId === requestingSocketId || 
                        (requestingPlayer && player.team === requestingPlayer.team) ||
                        this.gamePhase === 'completed') ? player.champion : null,
                rerollTokens: socketId === requestingSocketId ? player.rerollTokens : 0,
                locked: player.locked
            };
        });

        let playerBench = [];
        if (requestingPlayer && requestingPlayer.team) {
            playerBench = requestingPlayer.team === 'blue' ? this.blueBench : this.redBench;
        }

        return {
            code: this.code,
            hostId: this.hostId,
            gamePhase: this.gamePhase,
            timer: this.timer,
            players: playerStates,
            bench: playerBench || [],
            pendingTrades: Object.fromEntries(this.pendingTrades)
        };
    }
}

module.exports = GameRoom;