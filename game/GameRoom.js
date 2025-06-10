const Player = require('./Player');
const champions = require('./champions.json');

const AramMode = require('./draftModes/AramMode');
const TwoCardPickMode = require('./draftModes/TwoCardPickMode');
const MemoryPickMode = require('./draftModes/MemoryPickMode');
const AuctionMode = require('./draftModes/AuctionMode'); // Add this

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
        this.draftModes = {
            'aram': AramMode,
            'two-card-pick': TwoCardPickMode,
            'memory-pick': MemoryPickMode,
            'auction': AuctionMode 
        };
        this.currentDraftMode = 'aram';
        
        this.auctionPool = [];
        this.auctionPhase = 'ready';
        this.currentAuctionIndex = 0;
        this.currentChampion = null;
        this.auctionTimer = 20;
        this.auctionTimerInterval = null;
        this.teamBids = { blue: { amount: 0, bidders: [] }, red: { amount: 0, bidders: [] } };
        this.auctionResults = [];
        
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

    getDraftModeSettings(mode) {
        if (!this.draftModes[mode]) {
            throw new Error(`Unknown draft mode: ${mode}`);
        }
        return this.draftModes[mode].getSettings();
    }

    setDraftMode(mode) {
        if (!this.draftModes[mode]) {
            throw new Error(`Unknown draft mode: ${mode}`);
        }
        this.currentDraftMode = mode;
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

    async startChampionSelect(settings = {}) {
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

        await this.loadChampions();
        
        this.gamePhase = 'champion-select';
        
        // Set draft mode FIRST
        const draftMode = settings.draftMode || 'aram';
        this.setDraftMode(draftMode);
        
        const modeClass = this.draftModes[draftMode];
        const modeSettings = modeClass.getSettings();
        
        console.log(`Starting ${draftMode} mode with settings:`, modeSettings);
        
        // Initialize players based on mode
        playersWithTeams.forEach(player => {
            modeClass.initializePlayer(player, settings);
        });
        
        this.timer = modeSettings.timerDuration;
        this.blueBench = [];
        this.redBench = [];
        
        // Assign champions/cards based on mode
        await modeClass.assignChampions(this);
        
        console.log(`Draft initialization complete for ${draftMode} mode`);
        
        this.startTimer();
    }

    assignCardOptions() {
        const playersWithTeams = Array.from(this.players.values()).filter(p => p.team);
        
        console.log(`\n🃏 Assigning card options for ${playersWithTeams.length} players`);
        
        const teamAssignments = {
            blue: new Set(),
            red: new Set()
        };
        
        playersWithTeams.forEach(player => {
            console.log(`\n=== Assigning card options for ${player.name} (${player.team} team) ===`);
            
            const availableChampions = this.getPlayerAvailableChampions(player);
            console.log(`Available champions: ${availableChampions.length}`);
            
            // Get champions already assigned to team (none yet, but keep for consistency)
            const teamTaken = teamAssignments[player.team];
            const validChampions = availableChampions.filter(c => !teamTaken.has(c.name));
            
            console.log(`Valid champions after team filter: ${validChampions.length}`);
            
            if (validChampions.length >= 2) {
                // Shuffle and pick 2 random champions
                const shuffled = [...validChampions].sort(() => 0.5 - Math.random());
                player.cardOptions = shuffled.slice(0, 2);
                
                console.log(`✅ ${player.name} got card options:`);
                player.cardOptions.forEach((champ, index) => {
                    console.log(`   Card ${index + 1}: ${champ.name}`);
                });
                
                // Don't assign to team yet - player hasn't picked
                player.champion = null;
                player.hasPicked = false;
            } else {
                console.error(`❌ Not enough valid champions for ${player.name}`);
                // Fallback: give them any 2 champions
                const fallbackChampions = [...this.champions].sort(() => 0.5 - Math.random());
                player.cardOptions = fallbackChampions.slice(0, 2);
                player.champion = null;
                player.hasPicked = false;
            }
        });
        
        console.log(`🃏 Card assignment complete\n`);
    }

    getPlayerAvailableChampions(player) {
        if (player.championPool && player.championPool.length > 0) {
            return this.champions.filter(c => player.championPool.includes(c.name));
        }
        return this.champions;
    }

    getTeamChampionNames(team) {
        return Array.from(this.players.values())
            .filter(p => p.team === team && p.champion)
            .map(p => p.champion.name);
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
        // Don't start normal timer during auction mode
        if (this.currentDraftMode === 'auction' && this.auctionPhase !== 'completed') {
            console.log('⏰ Skipping normal timer during auction mode');
            return;
        }
        
        console.log('⏰ Starting normal champion select timer');
        
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
        if (this.currentDraftMode === 'auction') {
            console.log('Skipping auto-lock during auction mode');
            return;
        }
        
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
            // Get this player's current bid contribution for auction mode
            let currentBidContribution = 0;
            if (this.currentDraftMode === 'auction' && player.team && this.teamBids[player.team] && this.teamBids[player.team].playerBids) {
                currentBidContribution = this.teamBids[player.team].playerBids.get(socketId) || 0;
            }
            
            playerStates[socketId] = {
                id: socketId,
                name: player.name,
                team: player.team,
                champion: (socketId === requestingSocketId || 
                        (requestingPlayer && player.team === requestingPlayer.team) ||
                        this.gamePhase === 'completed' ||
                        (this.currentDraftMode === 'auction' && this.auctionPhase === 'completed')) ? player.champion : null,
                rerollTokens: socketId === requestingSocketId ? player.rerollTokens : 0,
                locked: player.locked,
                cardOptions: socketId === requestingSocketId ? (player.cardOptions || []) : [],
                hasPicked: socketId === requestingSocketId ? (player.hasPicked || false) : false,
                memoryCards: socketId === requestingSocketId ? (player.memoryCards || []) : [],
                shuffledPositions: socketId === requestingSocketId ? (player.shuffledPositions || []) : [],
                hasMemoryPicked: socketId === requestingSocketId ? (player.hasMemoryPicked || false) : false,
                memoryPhase: socketId === requestingSocketId ? (player.memoryPhase || 'reveal') : 'reveal',
                auctionCoins: this.auctionPhase !== 'completed' ? (player.auctionCoins || 20) : 0,
                currentBid: socketId === requestingSocketId ? currentBidContribution : 0, // Send player's current contribution
                hasAuctionChampion: player.hasAuctionChampion || false
            };
        });

        let playerBench = [];
        if (requestingPlayer && requestingPlayer.team && 
            this.currentDraftMode !== 'memory-pick' && 
            this.currentDraftMode !== 'auction') {
            playerBench = requestingPlayer.team === 'blue' ? this.blueBench : this.redBench;
        }

        return {
            code: this.code,
            hostId: this.hostId,
            gamePhase: this.gamePhase,
            timer: this.timer,
            players: playerStates,
            bench: playerBench || [],
            pendingTrades: Object.fromEntries(this.pendingTrades),
            draftMode: this.currentDraftMode,
            auctionPhase: this.auctionPhase || 'ready',
            auctionCompleted: this.auctionPhase === 'completed'
        };
    }

    assignMemoryCards() {
        const playersWithTeams = Array.from(this.players.values()).filter(p => p.team);
        
        console.log(`\n🧠 Assigning memory cards for ${playersWithTeams.length} players`);
        
        const teamAssignments = {
            blue: new Set(),
            red: new Set()
        };
        
        playersWithTeams.forEach(player => {
            console.log(`\n=== Assigning memory cards for ${player.name} (${player.team} team) ===`);
            
            const availableChampions = this.getPlayerAvailableChampions(player);
            const teamTaken = teamAssignments[player.team];
            const validChampions = availableChampions.filter(c => !teamTaken.has(c.name));
            
            if (validChampions.length >= 5) {
                const shuffled = [...validChampions].sort(() => 0.5 - Math.random());
                player.memoryCards = shuffled.slice(0, 5);
                player.shuffledPositions = [0, 1, 2, 3, 4].sort(() => 0.5 - Math.random());
                
                console.log(`✅ ${player.name} got memory cards:`);
                player.memoryCards.forEach((champ, index) => {
                    console.log(`   Card ${index}: ${champ.name} -> Position ${player.shuffledPositions[index]}`);
                });
                
                player.champion = null;
                player.hasMemoryPicked = false;
                player.memoryPhase = 'reveal';
            } else {
                console.error(`❌ Not enough valid champions for ${player.name}`);
                const fallbackChampions = [...this.champions].sort(() => 0.5 - Math.random());
                player.memoryCards = fallbackChampions.slice(0, 5);
                player.shuffledPositions = [0, 1, 2, 3, 4].sort(() => 0.5 - Math.random());
                player.champion = null;
                player.hasMemoryPicked = false;
                player.memoryPhase = 'reveal';
            }
        });
        
        // Start the memory phase progression automatically
        this.startMemoryPhaseProgression();
        
        console.log(`🧠 Memory card assignment complete\n`);
    }

    startMemoryPhaseProgression() {
        console.log('🧠 Starting memory phase progression...');
        
        // Phase 1: Reveal (5 seconds)
        setTimeout(() => {
            this.progressToMemoryPhase('shuffle');
        }, 5000);
        
        // Phase 2: Shuffle (3 seconds)
        setTimeout(() => {
            this.progressToMemoryPhase('pick');
        }, 8000);
    }

    progressToMemoryPhase(phase) {
        console.log(`🧠 Progressing to memory phase: ${phase}`);
        
        const playersWithTeams = Array.from(this.players.values()).filter(p => p.team);
        playersWithTeams.forEach(player => {
            if (player.memoryCards && !player.hasMemoryPicked) {
                player.memoryPhase = phase;
                console.log(`   ${player.name} -> ${phase} phase`);
            }
        });
        
        // Send update to all players
        this.players.forEach((player, playerId) => {
            const playerSocket = player.socket;
            if (playerSocket) {
                playerSocket.emit('memoryPhaseUpdate', {
                    phase: phase,
                    gameState: this.getGameStateForPlayer(playerId)
                });
            }
        });
    }

    pickMemoryCard(socketId, position) {
        const player = this.players.get(socketId);
        
        if (!player) {
            throw new Error('Player not found');
        }
        
        if (this.currentDraftMode !== 'memory-pick') {
            throw new Error('Memory picking not available in this mode');
        }
        
        if (player.hasMemoryPicked) {
            throw new Error('Player has already picked a champion');
        }
        
        if (player.memoryPhase !== 'pick') {
            throw new Error(`Not in picking phase yet. Current phase: ${player.memoryPhase}`);
        }
        
        if (!player.memoryCards || player.memoryCards.length !== 5) {
            throw new Error('Player does not have memory cards');
        }
        
        if (position < 0 || position >= 5) {
            throw new Error('Invalid card position');
        }
        
        // Find which original card is at this shuffled position
        const originalIndex = player.shuffledPositions.indexOf(position);
        if (originalIndex === -1) {
            throw new Error('Invalid position mapping');
        }
        
        const chosenChampion = player.memoryCards[originalIndex];
        
        console.log(`\n🧠 ${player.name} picking memory card at position ${position}`);
        console.log(`   ✅ Position ${position} contains: ${chosenChampion.name} (original index ${originalIndex})`);
        
        // Check if chosen champion conflicts with teammates
        const teammateHasChampion = Array.from(this.players.values()).some(p => 
            p.team === player.team && 
            p.id !== player.id && 
            p.champion && 
            p.champion.name === chosenChampion.name
        );

        if (teammateHasChampion) {
            throw new Error(`A teammate already has ${chosenChampion.name}`);
        }
        
        // Assign chosen champion
        player.champion = chosenChampion;
        player.hasMemoryPicked = true;
        player.memoryPhase = 'completed';
        
        console.log(`   🏆 ${player.name} successfully picked ${chosenChampion.name}`);
        console.log(`🧠 Memory pick complete\n`);
    }

    setupAuctionPool() {
        console.log('\n💰 Setting up auction pool...');
        
        // Count total players with teams
        const playersWithTeams = Array.from(this.players.values()).filter(p => p.team);
        const totalPlayers = playersWithTeams.length;
        
        console.log(`📊 Total players: ${totalPlayers}`);
        
        // Create pool of X random champions where X = number of players
        const allPlayersChampions = new Set();
        
        playersWithTeams.forEach(player => {
            const playerChampions = this.getPlayerAvailableChampions(player);
            playerChampions.forEach(c => allPlayersChampions.add(c));
        });
        
        const availableChampions = Array.from(allPlayersChampions);
        const shuffled = [...availableChampions].sort(() => 0.5 - Math.random());
        this.auctionPool = shuffled.slice(0, totalPlayers);
        
        console.log(`📋 Auction pool (${this.auctionPool.length} champions, hidden from players):`);
        this.auctionPool.forEach((champ, index) => {
            console.log(`   ${index + 1}. ${champ.name}`);
        });
        
        // Initialize auction state
        this.auctionPhase = 'ready';
        this.currentAuctionIndex = 0;
        this.currentChampion = null;
        this.auctionTimer = 20;
        this.teamBids = {
            blue: { amount: 0, bidders: [] },
            red: { amount: 0, bidders: [] }
        };
        this.auctionResults = [];
        
        console.log('💰 Auction setup complete, starting first champion...\n');
        
        // Start first auction after a short delay
        setTimeout(() => {
            this.startNextChampionAuction();
        }, 2000);
    }

    startNextChampionAuction() {
        if (this.currentAuctionIndex >= this.auctionPool.length) {
            this.endAuction();
            return;
        }
        
        if (this.areAllTeamsFull()) {
            console.log('All teams are full, ending auction early');
            this.endAuction();
            return;
        }
        
        this.currentChampion = this.auctionPool[this.currentAuctionIndex];
        this.auctionPhase = 'bidding';
        this.auctionTimer = 20;
        
        this.teamBids = {
            blue: { 
                amount: 0, 
                bidders: [],
                playerBids: new Map()
            },
            red: { 
                amount: 0, 
                bidders: [],
                playerBids: new Map()
            }
        };
        
        console.log(`\n💰 === AUCTION ${this.currentAuctionIndex + 1}/${this.auctionPool.length} ===`);
        console.log(`🏆 Champion: ${this.currentChampion.name}`);
        console.log(`⏰ Timer: ${this.auctionTimer} seconds`);
        
        const blueTeam = Array.from(this.players.values()).filter(p => p.team === 'blue');
        const redTeam = Array.from(this.players.values()).filter(p => p.team === 'red');
        
        const blueChampionCount = blueTeam.filter(p => p.champion).length;
        const redChampionCount = redTeam.filter(p => p.champion).length;
        
        const blueTeamFull = blueChampionCount >= blueTeam.length;
        const redTeamFull = redChampionCount >= redTeam.length;
        
        // FIX 1: Only auto-assign if exactly one team can bid, and prevent double resolution
        if (blueTeamFull && !redTeamFull) {
            console.log('🎯 Only red team can bid, auto-assigning to red team');
            this.auctionPhase = 'resolving'; // Prevent normal resolution
            this.assignChampionToTeam('red', 0);
            this.auctionResults.push({
                champion: this.currentChampion,
                winningTeam: 'red',
                winningBid: 0,
                blueBid: 0,
                redBid: 0
            });
            this.broadcastAuctionUpdate('auctionResolved');
            setTimeout(() => {
                this.currentAuctionIndex++;
                this.startNextChampionAuction();
            }, 2000);
            return; // Exit early to prevent timer start
        } else if (redTeamFull && !blueTeamFull) {
            console.log('🎯 Only blue team can bid, auto-assigning to blue team');
            this.auctionPhase = 'resolving'; // Prevent normal resolution
            this.assignChampionToTeam('blue', 0);
            this.auctionResults.push({
                champion: this.currentChampion,
                winningTeam: 'blue',
                winningBid: 0,
                blueBid: 0,
                redBid: 0
            });
            this.broadcastAuctionUpdate('auctionResolved');
            setTimeout(() => {
                this.currentAuctionIndex++;
                this.startNextChampionAuction();
            }, 2000);
            return; // Exit early to prevent timer start
        }
        
        // Normal bidding phase for both teams
        this.broadcastAuctionUpdate('championRevealed');
        this.startAuctionTimer();
    }

    startAuctionTimer() {
        if (this.auctionTimerInterval) {
            clearInterval(this.auctionTimerInterval);
        }
    
        this.auctionTimerInterval = setInterval(() => {
            this.auctionTimer--;
            
            if (this.auctionTimer <= 0) {
                this.resolveAuction();
            } else {
                // Send timer update
                this.broadcastAuctionUpdate('timerUpdate');
            }
        }, 1000);
    }

    areAllTeamsFull() {
        const blueTeam = Array.from(this.players.values()).filter(p => p.team === 'blue');
        const redTeam = Array.from(this.players.values()).filter(p => p.team === 'red');
        
        const blueChampionCount = blueTeam.filter(p => p.champion).length;
        const redChampionCount = redTeam.filter(p => p.champion).length;
        
        // Teams are only "full" if they have as many champions as team members AND both teams exist
        const blueTeamFull = blueTeam.length > 0 && blueChampionCount >= blueTeam.length;
        const redTeamFull = redTeam.length > 0 && redChampionCount >= redTeam.length;
        
        console.log(`📊 Team status: Blue ${blueChampionCount}/${blueTeam.length}, Red ${redChampionCount}/${redTeam.length}`);
        console.log(`📊 Team full status: Blue ${blueTeamFull}, Red ${redTeamFull}`);
        
        // Only end auction if BOTH teams exist AND BOTH are full
        return blueTeamFull && redTeamFull && blueTeam.length > 0 && redTeam.length > 0;
    }

    // GameRoom.js
    placeBid(socketId, bidAmount) {
        const player = this.players.get(socketId);
        
        if (!player) {
            throw new Error('Player not found');
        }
        
        if (this.auctionPhase !== 'bidding') {
            throw new Error('Not in bidding phase');
        }
        
        if (!player.team) {
            throw new Error('Player must be on a team to bid');
        }
        
        if (bidAmount <= 0 || isNaN(bidAmount)) {
            throw new Error('Bid must be a positive number');
        }
        
        const team = player.team;
        
        const teamPlayers = Array.from(this.players.values()).filter(p => p.team === team);
        const teamChampionCount = teamPlayers.filter(p => p.champion).length;
        
        if (teamChampionCount >= teamPlayers.length) {
            throw new Error('Your team already has maximum champions');
        }
        
        if (bidAmount > player.auctionCoins) {
            throw new Error(`You only have ${player.auctionCoins} coins. You cannot bid ${bidAmount}.`);
        }
        
        if (!this.teamBids[team].playerBids) {
            this.teamBids[team].playerBids = new Map();
        }
        
        // CHECK: Prevent reducing individual contribution
        const currentPlayerBid = this.teamBids[team].playerBids.get(socketId) || 0;
        if (bidAmount < currentPlayerBid) {
            throw new Error(`You already contributed ${currentPlayerBid} coins. You can only add more, not reduce your contribution.`);
        }
        
        const previousContribution = currentPlayerBid;
        const additionalAmount = bidAmount - previousContribution;
        
        if (additionalAmount > player.auctionCoins) {
            throw new Error(`You need ${additionalAmount} more coins but only have ${player.auctionCoins}.`);
        }
        
        const currentTeamTotal = this.teamBids[team].amount || 0;
        const newTeamTotal = currentTeamTotal - previousContribution + bidAmount;
        
        const otherTeam = team === 'blue' ? 'red' : 'blue';
        const otherTeamBid = this.teamBids[otherTeam].amount || 0;
        
        if (newTeamTotal <= otherTeamBid) {
            throw new Error(`Your team total would be ${newTeamTotal}, but you need more than ${otherTeamBid} to outbid the other team`);
        }
        
        console.log(`💰 ${player.name} (${team}) updates bid: ${previousContribution} → ${bidAmount} (adding ${additionalAmount})`);
        console.log(`💳 Team ${team} total: ${currentTeamTotal} → ${newTeamTotal}`);
        
        // Deduct only the additional amount
        player.auctionCoins -= additionalAmount;
        console.log(`💳 Deducted ${additionalAmount} additional coins from ${player.name} (now has ${player.auctionCoins})`);
        
        // Update player's total contribution
        this.teamBids[team].playerBids.set(socketId, bidAmount);
        
        // Update team total
        this.teamBids[team].amount = newTeamTotal;
        
        const bidders = Array.from(this.teamBids[team].playerBids.keys());
        this.teamBids[team].bidders = bidders;
        
        console.log(`🏆 Team ${team} new total bid: ${newTeamTotal} (from ${bidders.length} players)`);
        
        this.teamBids[team].playerBids.forEach((totalBid, playerId) => {
            const bidPlayer = this.players.get(playerId);
            console.log(`   ${bidPlayer.name}: ${totalBid} coins total`);
        });
        
        console.log(`📊 Current bids - Blue: ${this.teamBids.blue.amount}, Red: ${this.teamBids.red.amount}`);
        
        if (this.auctionTimer < 5) {
            this.auctionTimer = 5;
            console.log(`⏰ Timer reset to 5 seconds due to new bid`);
        }
        
        const otherTeamPlayers = Array.from(this.players.values()).filter(p => p.team === otherTeam);
        const otherTeamChampionCount = otherTeamPlayers.filter(p => p.champion).length;
        
        if (otherTeamPlayers.length > 0 && otherTeamChampionCount >= otherTeamPlayers.length) {
            console.log(`${otherTeam} team is full, ending auction immediately`);
            setTimeout(() => {
                this.resolveAuction();
            }, 1000);
        }
        
        this.broadcastAuctionUpdate('bidPlaced');
    }

    resolveAuction() {
        // FIX 1: Don't resolve if already resolving (prevents double resolution)
        if (this.auctionPhase === 'resolving') {
            console.log('🛑 Auction already resolving, skipping...');
            return;
        }
        
        clearInterval(this.auctionTimerInterval);
        this.auctionPhase = 'resolving';
        
        const blueBid = this.teamBids.blue.amount;
        const redBid = this.teamBids.red.amount;
        
        console.log(`\n🔨 Resolving auction for ${this.currentChampion.name}`);
        console.log(`   Blue team total bid: ${blueBid}`);
        console.log(`   Red team total bid: ${redBid}`);
        
        if (this.teamBids.blue.playerBids && this.teamBids.blue.playerBids.size > 0) {
            console.log(`   Blue team breakdown:`);
            this.teamBids.blue.playerBids.forEach((bid, playerId) => {
                const player = this.players.get(playerId);
                console.log(`     ${player.name}: ${bid} coins`);
            });
        }
        
        if (this.teamBids.red.playerBids && this.teamBids.red.playerBids.size > 0) {
            console.log(`   Red team breakdown:`);
            this.teamBids.red.playerBids.forEach((bid, playerId) => {
                const player = this.players.get(playerId);
                console.log(`     ${player.name}: ${bid} coins`);
            });
        }
        
        let winningTeam = null;
        let losingTeam = null;
        let winningBid = 0;
        
        if (blueBid > redBid) {
            winningTeam = 'blue';
            losingTeam = 'red';
            winningBid = blueBid;
        } else if (redBid > blueBid) {
            winningTeam = 'red';
            losingTeam = 'blue';
            winningBid = redBid;
        } else if (blueBid === redBid && blueBid > 0) {
            winningTeam = Math.random() < 0.5 ? 'blue' : 'red';
            losingTeam = winningTeam === 'blue' ? 'red' : 'blue';
            winningBid = blueBid;
            console.log(`   🎲 Tie broken randomly, ${winningTeam} wins!`);
        } else {
            const blueTeam = Array.from(this.players.values()).filter(p => p.team === 'blue');
            const redTeam = Array.from(this.players.values()).filter(p => p.team === 'red');
            
            const blueChampionCount = blueTeam.filter(p => p.champion).length;
            const redChampionCount = redTeam.filter(p => p.champion).length;
            
            const blueCanReceive = blueChampionCount < blueTeam.length;
            const redCanReceive = redChampionCount < redTeam.length;
            
            if (blueCanReceive && !redCanReceive) {
                console.log(`   🎁 No bids, but only blue team can receive champions - giving to blue`);
                winningTeam = 'blue';
                winningBid = 0;
            } else if (redCanReceive && !blueCanReceive) {
                console.log(`   🎁 No bids, but only red team can receive champions - giving to red`);
                winningTeam = 'red';
                winningBid = 0;
            } else if (blueCanReceive && redCanReceive) {
                console.log(`   🎲 No bids, both teams can receive - random assignment`);
                winningTeam = Math.random() < 0.5 ? 'blue' : 'red';
                winningBid = 0;
            } else {
                console.log(`   ❌ Champion discarded - no teams can receive more champions`);
            }
        }
        
        if (losingTeam && this.teamBids[losingTeam].playerBids) {
            console.log(`💰 Returning individual bids to losing team: ${losingTeam}`);
            this.teamBids[losingTeam].playerBids.forEach((bidAmount, playerId) => {
                const player = this.players.get(playerId);
                if (player && bidAmount > 0) {
                    player.auctionCoins += bidAmount;
                    console.log(`   💸 Returned ${bidAmount} coins to ${player.name} (now has ${player.auctionCoins})`);
                }
            });
        }
        
        if (!winningTeam) {
            ['blue', 'red'].forEach(team => {
                if (this.teamBids[team].playerBids) {
                    console.log(`💰 Returning bids to ${team} team (no winner)`);
                    this.teamBids[team].playerBids.forEach((bidAmount, playerId) => {
                        const player = this.players.get(playerId);
                        if (player && bidAmount > 0) {
                            player.auctionCoins += bidAmount;
                            console.log(`   💸 Returned ${bidAmount} coins to ${player.name}`);
                        }
                    });
                }
            });
        }
        
        if (winningTeam && (winningBid >= 0)) {
            console.log(`   🏆 ${winningTeam} team wins with total bid of ${winningBid}`);
            if (winningBid > 0) {
                console.log(`   💸 Winning team individual costs (coins already deducted):`);
                this.teamBids[winningTeam].playerBids.forEach((bidAmount, playerId) => {
                    const player = this.players.get(playerId);
                    console.log(`     ${player.name}: spent ${bidAmount} coins`);
                });
            }
            this.assignChampionToTeam(winningTeam, winningBid, false);
        } else {
            console.log(`   ❌ Champion discarded - no valid winner`);
        }
        
        this.teamBids.blue.playerBids = new Map();
        this.teamBids.red.playerBids = new Map();
        
        this.auctionResults.push({
            champion: this.currentChampion,
            winningTeam: winningTeam,
            winningBid: winningBid,
            blueBid: blueBid,
            redBid: redBid
        });
        
        this.broadcastAuctionUpdate('auctionResolved');
        
        setTimeout(() => {
            this.currentAuctionIndex++;
            this.startNextChampionAuction();
        }, 3000);
    }

    assignChampionToTeam(team, bidAmount, deductCoins = true) {
        const teamPlayers = Array.from(this.players.values())
            .filter(p => p.team === team)
            .sort((a, b) => {
                // Prioritize players without champions first
                if (!a.champion && b.champion) return -1;
                if (a.champion && !b.champion) return 1;
                return 0;
            });
        
        console.log(`🎯 Assigning ${this.currentChampion.name} to ${team} team`);
        console.log(`📋 Team ${team} players:`, teamPlayers.map(p => `${p.name} (has: ${p.champion?.name || 'none'})`));
        
        const assignedPlayer = teamPlayers.find(p => !p.champion); // Find first player without champion
        
        if (!assignedPlayer) {
            console.error(`❌ No available player found on ${team} team to assign champion`);
            return;
        }
        
        // Create a deep copy of the champion to avoid reference issues
        const championCopy = {
            id: this.currentChampion.id,
            name: this.currentChampion.name,
            title: this.currentChampion.title
        };
        
        // Assign the champion directly to the player object in the map
        const playerInMap = this.players.get(assignedPlayer.socketId);
        if (playerInMap) {
            playerInMap.champion = championCopy;
            console.log(`✅ ${championCopy.name} assigned to ${playerInMap.name} (${team} team)`);
            console.log(`🔍 Verification: Player ${playerInMap.name} now has champion: ${playerInMap.champion?.name}`);
        } else {
            console.error(`❌ Could not find player ${assignedPlayer.name} in players map`);
            return;
        }
        
        // Only deduct coins if specified (for winning bids, coins already deducted in placeBid)
        if (deductCoins && bidAmount > 0) {
            this.deductTeamCoins(team, bidAmount);
            console.log(`💸 ${bidAmount} coins deducted from ${team} team`);
        } else if (bidAmount > 0) {
            console.log(`💳 ${bidAmount} coins already deducted from ${team} team during bidding`);
        } else {
            console.log(`🆓 Champion assigned for free (no bids)`);
        }
        
        // Final verification - check all players on team
        const verificationPlayers = Array.from(this.players.values()).filter(p => p.team === team);
        console.log(`🔍 Final team ${team} verification:`);
        verificationPlayers.forEach(p => {
            console.log(`   ${p.name}: ${p.champion?.name || 'no champion'} (${p.auctionCoins} coins)`);
        });
    }

    deductTeamCoins(team, amount) {
        const teamPlayers = Array.from(this.players.values())
            .filter(p => p.team === team)
            .sort((a, b) => b.auctionCoins - a.auctionCoins); // Start with players with most coins
        
        let remainingCost = amount;
        
        teamPlayers.forEach(player => {
            const deduction = Math.min(player.auctionCoins, remainingCost);
            player.auctionCoins -= deduction;
            remainingCost -= deduction;
            
            console.log(`     ${player.name}: -${deduction} coins (${player.auctionCoins} remaining)`);
        });
    }

    endAuction() {
        this.auctionPhase = 'completed';
        console.log('\n🏁 Auction completed!');
        console.log('📊 Final results:');
        
        this.auctionResults.forEach((result, index) => {
            console.log(`   ${index + 1}. ${result.champion.name}: ${result.winningTeam || 'No winner'} (${result.winningBid} coins)`);
        });
        
        this.assignRemainingChampions();
        
        if (this.auctionTimerInterval) {
            clearInterval(this.auctionTimerInterval);
            this.auctionTimerInterval = null;
            console.log('🛑 Cleared auction timer');
        }
        
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
            console.log('🛑 Cleared normal timer');
        }
        
        this.currentChampion = null;
        this.auctionTimer = 0;
        this.teamBids = {
            blue: { amount: 0, bidders: [] },
            red: { amount: 0, bidders: [] }
        };
        
        this.timer = 90;
        
        console.log('\n🔍 Final verification - all players:');
        Array.from(this.players.values()).forEach(player => {
            console.log(`   ${player.name} (${player.team}): ${player.champion?.name || 'NO CHAMPION - ERROR!'}`);
        });
        
        this.broadcastAuctionUpdate('auctionCompleted');
        
        setTimeout(() => {
            console.log('🔄 Starting trading phase with 90 seconds...');
            this.startTimer();
            
            // Send normal game state updates
            this.players.forEach((player, playerId) => {
                const playerSocket = player.socket;
                if (playerSocket) {
                    const gameState = this.getGameStateForPlayer(playerId);
                    console.log(`📤 Sending trading phase state to ${player.name}: champion = ${gameState.players[playerId]?.champion?.name}`);
                    playerSocket.emit('gameStateUpdate', gameState);
                }
            });
        }, 2000);
        
        console.log('\n🔄 Entering trading phase...');
    }

    assignRemainingChampions() {
        console.log('\n🎲 Assigning remaining champions to players without champions...');
        
        // Find all players without champions
        const playersWithoutChampions = Array.from(this.players.values())
            .filter(p => p.team && !p.champion);
        
        if (playersWithoutChampions.length === 0) {
            console.log('✅ All players already have champions');
            return;
        }
        
        // Get champions that were not won in auction
        const auctionedChampions = this.auctionResults
            .filter(result => result.winningTeam)
            .map(result => result.champion.name);
        
        const remainingChampions = this.auctionPool.filter(champ => 
            !auctionedChampions.includes(champ.name)
        );
        
        console.log('🎯 Auctioned champions:', auctionedChampions);
        console.log('🎲 Remaining champions:', remainingChampions.map(c => c.name));
        console.log('👥 Players without champions:', playersWithoutChampions.map(p => `${p.name} (${p.team})`));
        
        // If we don't have enough remaining champions, get more from the full champion pool
        let availableChampions = [...remainingChampions];
        if (availableChampions.length < playersWithoutChampions.length) {
            console.log('⚠️ Not enough remaining champions, adding more from pool...');
            
            const usedChampionNames = new Set([
                ...auctionedChampions,
                ...Array.from(this.players.values())
                    .filter(p => p.champion)
                    .map(p => p.champion.name)
            ]);
            
            const additionalChampions = this.champions
                .filter(champ => !usedChampionNames.has(champ.name))
                .sort(() => 0.5 - Math.random())
                .slice(0, playersWithoutChampions.length - availableChampions.length);
            
            availableChampions.push(...additionalChampions);
        }
        
        // Assign champions to players randomly
        const shuffledChampions = availableChampions.sort(() => 0.5 - Math.random());
        
        playersWithoutChampions.forEach((player, index) => {
            if (index < shuffledChampions.length) {
                const champion = shuffledChampions[index];
                player.champion = {
                    id: champion.id,
                    name: champion.name,
                    title: champion.title
                };
                console.log(`🎁 ${player.name} (${player.team}) gets ${champion.name}`);
            } else {
                // Fallback: random champion from entire pool
                const randomChampion = this.champions[Math.floor(Math.random() * this.champions.length)];
                player.champion = {
                    id: randomChampion.id,
                    name: randomChampion.name,
                    title: randomChampion.title
                };
                console.log(`🎲 ${player.name} (${player.team}) gets random ${randomChampion.name}`);
            }
        });
        
        console.log('✅ All players now have champions');
    }

    broadcastAuctionUpdate(updateType) {
        console.log(`📡 Broadcasting auction update: ${updateType}`);
        let successCount = 0;
        let failCount = 0;
        
        this.players.forEach((player, playerId) => {
            let playerSocket = player.socket;
            
            // Ensure socket is still connected
            if (!playerSocket || !playerSocket.connected) {
                // Try to find socket in global socket collection
                if (typeof io !== 'undefined' && io.sockets && io.sockets.sockets) {
                    playerSocket = io.sockets.sockets.get(playerId);
                    if (playerSocket && playerSocket.connected) {
                        player.socket = playerSocket; // Update reference
                        console.log(`🔄 Updated socket reference for ${player.name}`);
                    }
                }
            }
            
            if (playerSocket && playerSocket.connected) {
                try {
                    playerSocket.emit('auctionUpdate', {
                        type: updateType,
                        gameState: this.getGameStateForPlayer(playerId),
                        currentChampion: this.currentChampion,
                        auctionPhase: this.auctionPhase,
                        auctionTimer: this.auctionTimer,
                        teamBids: this.teamBids,
                        auctionIndex: this.currentAuctionIndex,
                        totalAuctions: this.auctionPool.length,
                        auctionResults: this.auctionResults,
                        currentHighestBid: Math.max(this.teamBids.blue.amount, this.teamBids.red.amount)
                    });
                    successCount++;
                } catch (error) {
                    console.error(`❌ Failed to send auction update to ${player.name}:`, error);
                    failCount++;
                }
            } else {
                console.log(`⚠️ No valid socket for ${player.name} (${playerId})`);
                failCount++;
            }
        });
        
        console.log(`📡 Auction update sent: ${successCount} success, ${failCount} failed`);
    }

    pickCard(socketId, cardIndex) {
        const player = this.players.get(socketId);
        
        if (!player) {
            throw new Error('Player not found');
        }
        
        if (this.currentDraftMode === 'two-card-pick') {
            // Existing two-card-pick logic
            if (player.hasPicked) {
                throw new Error('Player has already picked a champion');
            }
            
            if (!player.cardOptions || player.cardOptions.length !== 2) {
                throw new Error('Player does not have card options');
            }
            
            if (cardIndex < 0 || cardIndex >= player.cardOptions.length) {
                throw new Error('Invalid card index');
            }
            
            const chosenChampion = player.cardOptions[cardIndex];
            const rejectedChampion = player.cardOptions[1 - cardIndex];
            
            // Check conflicts and assign
            const teammateHasChampion = Array.from(this.players.values()).some(p => 
                p.team === player.team && 
                p.id !== player.id && 
                p.champion && 
                p.champion.name === chosenChampion.name
            );

            if (teammateHasChampion) {
                throw new Error(`A teammate already has ${chosenChampion.name}`);
            }
            
            player.champion = chosenChampion;
            player.hasPicked = true;
            player.cardOptions = [];
            
            // Add to bench
            const teamBench = player.team === 'blue' ? this.blueBench : this.redBench;
            if (!teamBench) {
                if (player.team === 'blue') this.blueBench = [];
                else this.redBench = [];
            }
            (player.team === 'blue' ? this.blueBench : this.redBench).push(rejectedChampion);
            
        } else if (this.currentDraftMode === 'memory-pick') {
            // Memory pick mode - cardIndex is actually the position
            this.pickMemoryCard(socketId, cardIndex);
        } else {
            throw new Error('Card picking not available in this mode');
        }
    }
}

module.exports = GameRoom;