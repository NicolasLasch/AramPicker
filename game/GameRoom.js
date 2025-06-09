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

    async startChampionSelect(rerollTokens = 2) {
        const playersWithTeams = Array.from(this.players.values()).filter(p => p.team);
        const blueTeam = playersWithTeams.filter(p => p.team === 'blue');
        const redTeam = playersWithTeams.filter(p => p.team === 'red');
        
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
        
        // Set reroll tokens for all players
        playersWithTeams.forEach(player => {
            player.rerollTokens = rerollTokens;
        });
        
        console.log(`Set ${rerollTokens} reroll tokens for all players`);
        
        // Assign random champions
        this.assignRandomChampions();
        
        // Initialize empty team benches
        this.blueBench = [];
        this.redBench = [];
        
        this.startTimer();
    }

    assignRandomChampions() {
        const playersWithTeams = Array.from(this.players.values()).filter(p => p.team);
        
        // Track assigned champions by team to prevent duplicates
        const teamAssignments = {
            blue: new Set(),
            red: new Set()
        };
        
        playersWithTeams.forEach(player => {
            console.log(`\n=== Assigning champion for ${player.name} (${player.team} team) ===`);
            console.log(`Player champion pool:`, player.championPool ? player.championPool.length : 'none');
            
            let availableChampions;
            
            if (player.championPool && player.championPool.length > 0) {
                console.log(`🎯 Using custom pool: ${player.championPool.length} champions`);
                availableChampions = this.champions.filter(c => 
                    player.championPool.includes(c.name)
                );
                
                if (availableChampions.length === 0) {
                    console.log(`⚠️  No matching champions in pool, using all champions`);
                    availableChampions = this.champions;
                }
            } else {
                console.log(`🎯 Using all champions: ${this.champions.length} champions`);
                availableChampions = this.champions;
            }
            
            // Get champions already taken by this team
            const teamTaken = teamAssignments[player.team];
            console.log(`🚫 Team ${player.team} already has: ${Array.from(teamTaken)}`);
            
            // Filter out champions already taken by team
            const validChampions = availableChampions.filter(c => 
                !teamTaken.has(c.name)
            );
            
            console.log(`✅ Valid options: ${validChampions.length} champions`);
            
            if (validChampions.length === 0) {
                console.log(`⚠️  No valid champions left, using any available champion`);
                // Fallback: any champion not taken by team
                const fallbackChampions = this.champions.filter(c => 
                    !teamTaken.has(c.name)
                );
                
                if (fallbackChampions.length > 0) {
                    const randomChampion = fallbackChampions[Math.floor(Math.random() * fallbackChampions.length)];
                    player.champion = randomChampion;
                    teamTaken.add(randomChampion.name);
                    console.log(`🔧 Fallback assigned: ${randomChampion.name}`);
                } else {
                    // Ultimate fallback: just assign any champion (shouldn't happen)
                    const randomChampion = this.champions[Math.floor(Math.random() * this.champions.length)];
                    player.champion = randomChampion;
                    console.log(`🆘 Emergency assigned: ${randomChampion.name}`);
                }
            } else {
                const randomChampion = validChampions[Math.floor(Math.random() * validChampions.length)];
                player.champion = randomChampion;
                teamTaken.add(randomChampion.name);
                console.log(`✅ Assigned: ${randomChampion.name}`);
            }
            
            console.log(`=== End ${player.name} ===`);
        });
        
        console.log(`\n📋 Final assignments:`);
        console.log(`Blue team: ${Array.from(teamAssignments.blue)}`);
        console.log(`Red team: ${Array.from(teamAssignments.red)}\n`);
    }

    rerollChampion(socketId) {
        const player = this.players.get(socketId);
        if (!player || player.rerollTokens <= 0 || player.locked || !player.champion) {
            throw new Error('Cannot reroll');
        }

        const oldChampion = player.champion;
        console.log(`\n🎲 ${player.name} rerolling ${oldChampion.name}`);

        // Get player's available champions
        let availableChampions;
        if (player.championPool && player.championPool.length > 0) {
            availableChampions = this.champions.filter(c => 
                player.championPool.includes(c.name)
            );
            
            if (availableChampions.length === 0) {
                availableChampions = this.champions;
            }
            console.log(`🎯 Using player pool: ${availableChampions.length} champions`);
        } else {
            availableChampions = this.champions;
            console.log(`🎯 Using all champions: ${availableChampions.length} champions`);
        }

        // DEBUG: Log all players and their champions
        console.log(`🔍 All players in room:`);
        for (const [playerId, p] of this.players) {
            console.log(`   - ${p.name} (${p.team}): ${p.champion ? p.champion.name : 'no champion'} [ID: ${playerId}]`);
        }

        // Get ALL champions currently held by teammates on same team
        const teammates = Array.from(this.players.values()).filter(p => 
            p.team === player.team && 
            p.id !== player.id && 
            p.champion
        );
        
        console.log(`🤝 Teammates on ${player.team} team:`);
        teammates.forEach(teammate => {
            console.log(`   - ${teammate.name}: ${teammate.champion.name}`);
        });

        const teammateCurrentChampions = teammates.map(p => p.champion.name);

        // Get team bench champions
        const teamBench = player.team === 'blue' ? this.blueBench : this.redBench;
        const benchChampions = teamBench ? teamBench.map(c => c.name) : [];
        
        // Exclude: current champion + ALL teammate current champions + ALL bench champions
        const excludeNames = [
            oldChampion.name, 
            ...teammateCurrentChampions, 
            ...benchChampions
        ];
        
        // Remove duplicates
        const uniqueExcluded = [...new Set(excludeNames)];
        
        const validChampions = availableChampions.filter(c => !uniqueExcluded.includes(c.name));

        console.log(`🚫 Excluding:`);
        console.log(`   - Current: ${oldChampion.name}`);
        console.log(`   - Teammates have: ${teammateCurrentChampions}`);
        console.log(`   - In bench: ${benchChampions}`);
        console.log(`   - Total excluded: ${uniqueExcluded}`);
        console.log(`✅ Valid options: ${validChampions.length}`);
        
        if (validChampions.length > 0) {
            console.log(`✅ Valid champions: ${validChampions.slice(0, 5).map(c => c.name)}...`);
        }

        if (validChampions.length === 0) {
            throw new Error('No available champions to reroll to - all champions from your pool are taken by teammates or in bench');
        }

        // Add old champion to bench
        if (player.team === 'blue') {
            if (!this.blueBench) this.blueBench = [];
            this.blueBench.push(oldChampion);
        } else {
            if (!this.redBench) this.redBench = [];
            this.redBench.push(oldChampion);
        }

        // Assign new champion
        const randomChampion = validChampions[Math.floor(Math.random() * validChampions.length)];
        player.champion = randomChampion;
        player.rerollTokens--;
        
        console.log(`✅ Rerolled to: ${randomChampion.name} (${player.rerollTokens} tokens left)`);
        
        // Final verification
        const finalTeammates = Array.from(this.players.values()).filter(p => 
            p.team === player.team && p.champion
        );
        
        console.log(`🔍 Final team state:`);
        finalTeammates.forEach(p => {
            console.log(`   - ${p.name}: ${p.champion.name}`);
        });
        
        const currentTeamChampions = finalTeammates.map(p => p.champion.name);
        const duplicates = currentTeamChampions.filter((name, index) => 
            currentTeamChampions.indexOf(name) !== index
        );
        
        if (duplicates.length > 0) {
            console.error(`🚨 ERROR: Duplicate found after reroll: ${duplicates}`);
            console.error(`🚨 Team champions: ${currentTeamChampions}`);
        } else {
            console.log(`✅ Team verification passed: ${currentTeamChampions}`);
        }
        
        console.log(`🎲 Reroll complete\n`);
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
            throw new Error('Champion not in team bench');
        }

        const benchChampion = teamBench[benchIndex];

        // Check ownership
        if (player.championPool && player.championPool.length > 0) {
            if (!player.championPool.includes(benchChampion.name)) {
                throw new Error(`You do not own ${benchChampion.name}`);
            }
        }

        // Check team duplicates
        const teammateHasChampion = Array.from(this.players.values()).some(p => 
            p.team === player.team && 
            p.id !== player.id && 
            p.champion && 
            p.champion.name === benchChampion.name
        );

        if (teammateHasChampion) {
            throw new Error(`A teammate already has ${benchChampion.name}`);
        }

        // Perform swap
        const oldChampion = player.champion;
        teamBench[benchIndex] = oldChampion;
        player.champion = benchChampion;
        
        console.log(`${player.name} swapped ${oldChampion.name} ↔ ${benchChampion.name}`);
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
        
        if (!fromPlayer || !toPlayer) {
            throw new Error('Invalid trade players');
        }

        if (!fromPlayer.champion || !toPlayer.champion) {
            throw new Error('Both players must have champions to trade');
        }

        if (fromPlayer.team !== toPlayer.team) {
            throw new Error('Can only trade with teammates');
        }

        if (fromPlayer.locked || toPlayer.locked) {
            throw new Error('Cannot trade with locked players');
        }

        console.log(`Trade offer: ${fromPlayer.name} (${fromPlayer.champion.name}) wants to trade with ${toPlayer.name} (${toPlayer.champion.name})`);

        this.pendingTrades.set(toSocketId, {
            from: fromSocketId,
            to: toSocketId,
            timestamp: Date.now()
        });

        return {
            success: true,
            fromPlayerName: fromPlayer.name,
            toPlayerName: toPlayer.name,
            fromChampion: fromPlayer.champion,
            toChampion: toPlayer.champion
        };
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