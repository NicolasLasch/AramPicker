const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const socketUrl = isDevelopment ? 'http://localhost:3000' : window.location.origin;
const socket = io(socketUrl, {
    transports: ['websocket', 'polling'],
    upgrade: true,
    rememberUpgrade: true
});

let LATEST_VERSION = '15.11.1'; 
let memoryPickTimer = null;
let memoryShuffleTimeout = null;

async function fetchLatestVersion() {
    try {
        const response = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
        const versions = await response.json();
        LATEST_VERSION = versions[0]; // First version is the latest
        console.log(`✅ Loaded latest Data Dragon version: ${LATEST_VERSION}`);
    } catch (error) {
        console.error('Failed to fetch latest version, using fallback:', error);
    }
}

// Store game state in sessionStorage to persist across page reloads
function saveGameSession() {
    if (gameState.roomCode && gameState.playerName) {
        const sessionData = {
            roomCode: gameState.roomCode,
            playerName: gameState.playerName,
            isHost: gameState.isHost,
            gamePhase: gameState.gamePhase
        };
        sessionStorage.setItem('aramGameSession', JSON.stringify(sessionData));
    }
}

function loadGameSession() {
    const sessionData = sessionStorage.getItem('aramGameSession');
    if (sessionData) {
        try {
            const parsed = JSON.parse(sessionData);
            // Only restore if the session is recent (within 1 hour)
            if (parsed.roomCode && parsed.playerName) {
                return parsed;
            }
        } catch (e) {
            console.error('Error parsing session data:', e);
        }
    }
    return null;
}

function clearGameSession() {
    sessionStorage.removeItem('aramGameSession');
}

// Try to reconnect on page load
function attemptReconnection() {
    const session = loadGameSession();
    if (session) {
        console.log('Attempting to reconnect to game:', session.roomCode);
        gameState.roomCode = session.roomCode;
        gameState.playerName = session.playerName;
        gameState.isHost = session.isHost;
        
        // Try to rejoin the room
        socket.emit('rejoinRoom', {
            roomCode: session.roomCode,
            playerName: session.playerName
        });
    }
}
let gameState = {
    roomCode: '',
    playerName: '',
    isHost: false,
    currentPlayerId: '',
    gamePhase: 'lobby',
    players: {},
    bench: [],
    timer: 90,
    pendingTrade: null
};

let elements = {};

function initializeElements() {
    console.log('🏗️ Initializing DOM elements...');
    
    elements = {
        connectionStatus: document.getElementById('connectionStatus'),
        mainMenu: document.getElementById('mainMenu'),
        lobbyScreen: document.getElementById('lobbyScreen'),
        gameInterface: document.getElementById('gameInterface'),
        tradeRequest: document.getElementById('tradeRequest'),
        errorModal: document.getElementById('errorModal'),
        successModal: document.getElementById('successModal'),
        
        playerName: document.getElementById('playerName'),
        joinPlayerName: document.getElementById('joinPlayerName'),
        roomCode: document.getElementById('roomCode'),
        createGameBtn: document.getElementById('createGameBtn'),
        joinGameBtn: document.getElementById('joinGameBtn'),
        
        displayRoomCode: document.getElementById('displayRoomCode'),
        playerCountNumber: document.getElementById('playerCountNumber'),
        startGameBtn: document.getElementById('startGameBtn'),
        joinBlueBtn: document.getElementById('joinBlueBtn'),
        joinRedBtn: document.getElementById('joinRedBtn'),
        blueTeamLobby: document.getElementById('blueTeamLobby'),
        redTeamLobby: document.getElementById('redTeamLobby'),
        
        phaseIndicator: document.getElementById('phaseIndicator'),
        timer: document.getElementById('timer'),
        blueTeam: document.getElementById('blueTeam'),
        redTeam: document.getElementById('redTeam'),
        benchChampions: document.getElementById('benchChampions'),
        
        tradeMessage: document.getElementById('tradeMessage'),
        acceptTradeBtn: document.getElementById('acceptTradeBtn'),
        declineTradeBtn: document.getElementById('declineTradeBtn'),
        
        errorMessage: document.getElementById('errorMessage'),
        closeErrorBtn: document.getElementById('closeErrorBtn'),
        finalTeams: document.getElementById('finalTeams'),
        backToMenuBtn: document.getElementById('backToMenuBtn')
    };
    
    // Debug: Check which elements are missing
    console.log('🔍 Element initialization results:');
    Object.entries(elements).forEach(([key, element]) => {
        if (!element) {
            console.error(`❌ Missing element: ${key}`);
        } else {
            console.log(`✅ Found element: ${key}`);
        }
    });
    
    // Special focus on trade elements
    console.log('🔍 Trade-related elements:');
    console.log('  - tradeRequest:', !!elements.tradeRequest, elements.tradeRequest);
    console.log('  - tradeMessage:', !!elements.tradeMessage, elements.tradeMessage);
    console.log('  - acceptTradeBtn:', !!elements.acceptTradeBtn, elements.acceptTradeBtn);
    console.log('  - declineTradeBtn:', !!elements.declineTradeBtn, elements.declineTradeBtn);
}

function setupEventListeners() {
    elements.createGameBtn.addEventListener('click', createGame);
    elements.joinGameBtn.addEventListener('click', joinGame);
    elements.startGameBtn.addEventListener('click', startChampionSelect);
    elements.joinBlueBtn.addEventListener('click', () => joinTeam('blue'));
    elements.joinRedBtn.addEventListener('click', () => joinTeam('red'));
    
    elements.acceptTradeBtn.addEventListener('click', acceptTrade);
    elements.declineTradeBtn.addEventListener('click', declineTrade);
    elements.closeErrorBtn.addEventListener('click', closeError);
    elements.backToMenuBtn.addEventListener('click', backToMenu);
    
    elements.playerName.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') createGame();
    });
    
    elements.roomCode.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') joinGame();
    });

    const rerollSlider = document.getElementById('rerollTokens');
    const rerollValue = document.getElementById('rerollValue');
    
    if (rerollSlider && rerollValue) {
        rerollSlider.addEventListener('input', (e) => {
            rerollValue.textContent = e.target.value;
            gameState.rerollTokens = parseInt(e.target.value);
        });
    }
    
    elements.roomCode.addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase();
    });
}

function setupSocketListeners() {
    socket.on('connect', () => {
        elements.connectionStatus.textContent = 'Connected';
        elements.connectionStatus.className = 'connection-status connected';
    });

    socket.on('disconnect', () => {
        elements.connectionStatus.textContent = 'Disconnected';
        elements.connectionStatus.className = 'connection-status disconnected';
    });

    socket.on('roomCreated', (data) => {
        gameState.roomCode = data.roomCode;
        gameState.isHost = data.isHost;
        gameState.currentPlayerId = socket.id;
        updateGameState(data.gameState);
        saveGameSession();
        showLobby();
    });

    socket.on('roomJoined', (data) => {
        gameState.roomCode = data.roomCode;
        gameState.isHost = data.isHost;
        gameState.currentPlayerId = socket.id;
        updateGameState(data.gameState);
        saveGameSession();
        showLobby();
    });

    socket.on('roomRejoined', (data) => {
        gameState.roomCode = data.roomCode;
        gameState.isHost = data.isHost;
        gameState.currentPlayerId = socket.id;
        updateGameState(data.gameState);
        
        // Show appropriate screen based on game phase
        if (data.gameState.gamePhase === 'lobby') {
            showLobby();
        } else {
            showGameInterface();
        }
    });

    socket.on('gameStateUpdate', (newGameState) => {
        console.log('🔄 Game state update received');
        console.log('Draft mode:', newGameState.draftMode);
        console.log('Auction phase:', newGameState.auctionPhase);
        console.log('Game phase:', newGameState.gamePhase);
        
        if (newGameState.players) {
            console.log('🎯 Players in update:');
            Object.values(newGameState.players).forEach(player => {
                console.log(`   ${player.name}: ${player.champion?.name || 'no champion'}`);
            });
        }
        
        updateGameState(newGameState);
        saveGameSession();
        
        // If this is after auction completion, force show main interface
        if (newGameState.draftMode === 'auction' && 
            (newGameState.auctionPhase === 'completed' || newGameState.auctionCompleted)) {
            
            console.log('🎯 Post-auction game state update - showing main interface');
            
            // Hide auction section
            const auctionSection = document.getElementById('auctionSection');
            if (auctionSection && !auctionSection.classList.contains('hidden')) {
                auctionSection.classList.add('hidden');
            }
            
            // Show main game interface
            showGameInterface();
        }
        
        updateDisplay();
    });

    socket.on('gameStarted', (newGameState) => {
        updateGameState(newGameState);
        showGameInterface();
    });

    socket.on('gameEnded', (newGameState) => {
        updateGameState(newGameState);
        showGameComplete();
    });

    socket.on('tradeOffer', (tradeData) => {
        console.log('📨 tradeOffer socket event received:', tradeData);
        console.log('  - From:', tradeData.fromPlayer);
        console.log('  - From champion:', tradeData.fromChampion?.name);
        console.log('  - To champion:', tradeData.toChampion?.name);
        console.log('  - Current player:', gameState.players[gameState.currentPlayerId]?.name);
        console.log('  - Draft mode:', gameState.draftMode);
        console.log('  - Auction phase:', gameState.auctionPhase);
        console.log('  - Socket connected:', socket.connected);
        console.log('  - Socket ID:', socket.id);
        
        // Force show trade request regardless of mode
        try {
            showTradeRequest(tradeData);
            console.log('✅ Trade request shown successfully');
        } catch (error) {
            console.error('❌ Error showing trade request:', error);
            
            // Fallback: simple alert if modal system fails
            const message = `${tradeData.fromPlayer} wants to trade ${tradeData.fromChampion.name} for your ${tradeData.toChampion.name}`;
            if (confirm(message + '\n\nAccept this trade?')) {
                socket.emit('respondToTrade', { roomCode: gameState.roomCode, accepted: true });
            } else {
                socket.emit('respondToTrade', { roomCode: gameState.roomCode, accepted: false });
            }
        }
    });

    socket.on('tradeOfferSent', (data) => {
        console.log('Trade offer sent successfully:', data);
        showTradeConfirmation(data.targetPlayerName);
    });

    socket.on('error', (message) => {
        showError(message);
    });

    socket.on('riotAccountLinked', (data) => {
        const statusDiv = document.getElementById('linkingStatus');
        
        if (data.success) {
            console.log('Riot account linked successfully:', data.championPool);
            
            const pendingAction = gameState.pendingAction;
            
            if (pendingAction && pendingAction.action === 'championPool') {
                // Open champion pool manager with real account data
                statusDiv.innerHTML = `<span style="color: #5cb85c;">✅ Account linked! Opening champion pool manager...</span>`;
                
                setTimeout(() => {
                    document.querySelector('.riot-account-modal').remove();
                    
                    showChampionPoolManager({
                        puuid: data.championPool.puuid,
                        summonerName: data.championPool.summonerName,
                        region: data.championPool.region,
                        action: pendingAction.originalAction,
                        playerName: pendingAction.playerName,
                        roomCode: pendingAction.roomCode
                    });
                    
                    gameState.pendingAction = null;
                }, 1000);
                
            } else {
                // Normal game creation/joining flow
                statusDiv.innerHTML = `<span style="color: #5cb85c;">✅ ${data.message}</span>`;
                
                setTimeout(() => {
                    document.querySelector('.riot-account-modal').remove();
                    
                    let playerName = data.championPool?.summonerName;
                    
                    if (!playerName || playerName === 'undefined') {
                        const riotId = document.getElementById('riotId').value.trim();
                        const [gameName] = riotId.split('#');
                        playerName = gameName || pendingAction.playerName;
                    }
                    
                    console.log(`Using player name: ${playerName}`);
                    console.log(`Champion pool size: ${data.championPool?.championIds?.length || 0}`);
                    
                    if (pendingAction.action === 'create') {
                        socket.emit('createRoom', { 
                            playerName: playerName,
                            championPool: data.championPool?.championIds || [],
                            riotData: data.riotData
                        });
                    } else {
                        socket.emit('joinRoom', { 
                            roomCode: pendingAction.roomCode,
                            playerName: playerName,
                            championPool: data.championPool?.championIds || [],
                            riotData: data.riotData
                        });
                    }
                    
                    gameState.pendingAction = null;
                }, 1500);
            }
            
        } else {
            statusDiv.innerHTML = `<span style="color: #d9534f;">❌ ${data.error}</span>`;
        }
    });

    socket.on('cardPicked', (data) => {
        console.log('Card picked:', data);
        resetCardDisplay();
        updateDisplay();
    });

    socket.on('memoryPhaseUpdate', (data) => {
        console.log('Memory phase update received:', data.phase);
        
        // Update game state
        updateGameState(data.gameState);
        
        // Refresh memory display
        updateMemoryPickDisplay();
    });

    socket.on('auctionUpdate', (auctionData) => {
        console.log('Auction update received:', auctionData.type);
        console.log('Auction data:', auctionData);
        
        // Update game state first
        updateGameState(auctionData.gameState);
        
        // Handle auction-specific updates
        if (auctionData.type === 'auctionCompleted') {
            console.log('🏁 Auction completed! Transitioning to trading phase...');
            
            // Mark auction as completed in game state
            gameState.auctionCompleted = true;
            gameState.auctionPhase = 'completed';
            
            // Hide auction interface immediately
            const auctionSection = document.getElementById('auctionSection');
            if (auctionSection) {
                auctionSection.classList.add('hidden');
            }
            
            // Show main game interface
            showGameInterface();
            
            // Force update display with new champion data
            setTimeout(() => {
                console.log('🔄 Force updating display after auction completion...');
                updateDisplay();
            }, 500);
            
        } else {
            // Update auction display for other auction events
            updateAuctionState(auctionData);
        }
    });

    socket.on('championWinrateResult', (data) => {
        if (data.error) {
            console.log('Winrate error:', data.error);
            const winrateElement = document.getElementById(`winrate-${gameState.currentPlayerId}`);
            if (winrateElement) {
                winrateElement.innerHTML = '<span style="color: #cdbe91; font-size: 11px;">Account not linked</span>';
            }
            return;
        }
        
        displayChampionWinrate(data.championName, data.winrate, gameState.currentPlayerId);
    });

    socket.on('forceDisplayRefresh', (newGameState) => {
        console.log('🔄 Force refreshing display for trading phase...');
        updateGameState(newGameState);
        
        updateDisplay();
        
        console.log('✅ Display refresh complete - trading should now be available');
    });
}

function createGame() {
    const name = elements.playerName.value.trim();
    if (!name) {
        showError('Please enter your name');
        return;
    }
    
    // Show Riot linking modal with create room context
    showRiotAccountLinking('create', name);
}

function joinGame() {
    const name = elements.joinPlayerName.value.trim();
    const code = elements.roomCode.value.trim().toUpperCase();
    
    if (!name || !code) {
        showError('Please enter your name and room code');
        return;
    }
    
    // Show Riot linking modal with join room context
    showRiotAccountLinking('join', name, code);
}

function joinTeam(team) {
    socket.emit('joinTeam', { roomCode: gameState.roomCode, team: team });
}

function startChampionSelect() {
    const rerollTokens = gameState.rerollTokens || 1;
    socket.emit('startGame', { 
        roomCode: gameState.roomCode, 
        rerollTokens: rerollTokens 
    });
}

function rerollChampion() {
    socket.emit('rerollChampion', gameState.roomCode);
}

function swapWithBench(championId) {
    socket.emit('swapWithBench', { roomCode: gameState.roomCode, championId: championId });
}

function lockChampion() {
    socket.emit('lockChampion', gameState.roomCode);
}

function offerTrade(targetPlayerId) {
    console.log('🔄 offerTrade called:', {
        targetPlayerId,
        roomCode: gameState.roomCode,
        currentPlayer: gameState.players[gameState.currentPlayerId]?.name,
        targetPlayer: gameState.players[targetPlayerId]?.name,
        draftMode: gameState.draftMode,
        auctionPhase: gameState.auctionPhase,
        socketConnected: socket.connected
    });
    
    // Enhanced validation
    if (!socket.connected) {
        showError('Connection lost. Please refresh the page.');
        return;
    }
    
    if (!gameState.roomCode) {
        showError('No active room');
        return;
    }
    
    const currentPlayer = gameState.players[gameState.currentPlayerId];
    const targetPlayer = gameState.players[targetPlayerId];
    
    if (!currentPlayer || !targetPlayer) {
        showError('Invalid player selection');
        return;
    }
    
    if (!currentPlayer.champion || !targetPlayer.champion) {
        showError('Both players must have champions to trade');
        return;
    }
    
    if (currentPlayer.team !== targetPlayer.team) {
        showError('Can only trade with teammates');
        return;
    }
    
    if (currentPlayer.locked || targetPlayer.locked) {
        showError('Cannot trade with locked players');
        return;
    }
    
    console.log('📤 Sending trade offer to server...');
    socket.emit('offerTrade', { 
        roomCode: gameState.roomCode, 
        targetPlayerId: targetPlayerId 
    });
}

function acceptTrade() {
    console.log('✅ Accepting trade');
    if (socket.connected) {
        socket.emit('respondToTrade', { roomCode: gameState.roomCode, accepted: true });
    }
    hideTradeRequest();
}

function declineTrade() {
    console.log('❌ Declining trade');
    if (socket.connected) {
        socket.emit('respondToTrade', { roomCode: gameState.roomCode, accepted: false });
    }
    hideTradeRequest();
}

function hideTradeRequest() {
    if (elements.tradeRequest) {
        elements.tradeRequest.classList.add('hidden');
        elements.tradeRequest.style.display = 'none';
    }
    console.log('🚪 Trade request hidden');
}

function updateGameState(newGameState) {
    console.log('=== updateGameState ===');
    console.log('New game state received:', newGameState);
    console.log('Draft mode in state:', newGameState.draftMode);
    
    gameState = { ...gameState, ...newGameState };
    
    if (newGameState.players) {
        console.log('🎯 Player champions after state update:');
        Object.values(newGameState.players).forEach(player => {
            console.log(`   ${player.name} (${player.team}): ${player.champion?.name || 'no champion'}`);
        });
    }
    
    // Make sure current player data is properly updated
    if (gameState.currentPlayerId && gameState.players[gameState.currentPlayerId]) {
        const currentPlayer = gameState.players[gameState.currentPlayerId];
        console.log('Current player updated:', {
            name: currentPlayer.name,
            champion: currentPlayer.champion?.name || 'no champion',
            team: currentPlayer.team,
            locked: currentPlayer.locked
        });
    }
}

function showLobby() {
    elements.mainMenu.classList.add('hidden');
    elements.lobbyScreen.classList.remove('hidden');
    elements.gameInterface.classList.add('hidden');
    
    elements.displayRoomCode.textContent = gameState.roomCode;
    
    // Show/hide host-only elements
    const rerollSettings = document.getElementById('rerollSettings');
    const startButton = elements.startGameBtn;
    
    if (gameState.isHost) {
        startButton.classList.remove('hidden');
        if (rerollSettings) {
            rerollSettings.style.display = 'block';
        }
    } else {
        startButton.classList.add('hidden');
        if (rerollSettings) {
            rerollSettings.style.display = 'none';
        }
    }
    
    updateLobbyDisplay();
}

function showGameInterface() {
    console.log('🎮 Showing game interface');
    resetGameInterface();
    
    elements.mainMenu.classList.add('hidden');
    elements.lobbyScreen.classList.add('hidden');
    elements.gameInterface.classList.remove('hidden');
    
    updateDisplay();
}


function updateDisplay() {
    console.log('=== updateDisplay called ===');
    console.log('Game phase:', gameState.gamePhase);
    console.log('Draft mode:', gameState.draftMode);
    console.log('Auction phase:', gameState.auctionPhase);
    console.log('Current player ID:', gameState.currentPlayerId);
    
    if (gameState.currentPlayerId && gameState.players[gameState.currentPlayerId]) {
        const currentPlayer = gameState.players[gameState.currentPlayerId];
        console.log('Current player data:', {
            name: currentPlayer.name,
            champion: currentPlayer.champion?.name || 'none',
            team: currentPlayer.team,
            locked: currentPlayer.locked
        });
    }
    
    // If auction mode and auction is completed, show main game interface
    if (gameState.draftMode === 'auction' && gameState.auctionCompleted) {
        console.log('🎯 Auction completed, showing main game interface');
        
        // Hide auction section if still visible
        const auctionSection = document.getElementById('auctionSection');
        if (auctionSection && !auctionSection.classList.contains('hidden')) {
            auctionSection.classList.add('hidden');
        }
        
        // Show main game interface
        elements.mainMenu.classList.add('hidden');
        elements.lobbyScreen.classList.add('hidden');
        elements.gameInterface.classList.remove('hidden');
        
        // Update game display
        updateGameDisplay();
        return;
    }
    
    if (gameState.gamePhase === 'lobby') {
        updateLobbyDisplay();
    } else if (gameState.gamePhase === 'champion-select') {
        // Check if we should show auction or main game interface
        if (gameState.draftMode === 'auction' && gameState.auctionPhase !== 'completed') {
            updateAuctionDisplay();
        } else {
            updateGameDisplay();
        }
    }
}

function updateLobbyDisplay() {
    const playerCount = Object.keys(gameState.players).length;
    elements.playerCountNumber.textContent = playerCount;
    
    elements.blueTeamLobby.innerHTML = '';
    elements.redTeamLobby.innerHTML = '';
    
    let blueCount = 0;
    let redCount = 0;
    
    Object.values(gameState.players).forEach(player => {
        const playerElement = createLobbyPlayerElement(player);
        
        if (player.team === 'blue') {
            elements.blueTeamLobby.appendChild(playerElement);
            blueCount++;
        } else if (player.team === 'red') {
            elements.redTeamLobby.appendChild(playerElement);
            redCount++;
        }
    });
    
    // Update team join button states
    elements.joinBlueBtn.disabled = blueCount >= 5;
    elements.joinRedBtn.disabled = redCount >= 5;
    
    // Update start game button - need at least 1 player on each team
    if (gameState.isHost) {
        const canStart = blueCount >= 1 && redCount >= 1;
        elements.startGameBtn.disabled = !canStart;
        
        if (!canStart) {
            elements.startGameBtn.textContent = `Start Game (Need players on both teams)`;
        } else {
            elements.startGameBtn.textContent = `Start Champion Select (${blueCount}v${redCount})`;
        }
    }
}

function createLobbyPlayerElement(player) {
    const element = document.createElement('div');
    element.className = 'player-item';
    if (player.id === gameState.currentPlayerId) {
        element.classList.add('current-player');
    }
    
    const nameSpan = document.createElement('span');
    nameSpan.textContent = player.name;
    
    const statusSpan = document.createElement('span');
    statusSpan.style.fontSize = '12px';
    statusSpan.style.color = '#c89b3c';
    
    if (player.id === gameState.hostId) {
        statusSpan.textContent = 'HOST';
    }
    
    element.appendChild(nameSpan);
    if (statusSpan.textContent) {
        element.appendChild(statusSpan);
    }
    
    return element;
}

function updateGameDisplay() {
    // Don't show normal timer/phase if auction is still in progress
    if (gameState.draftMode === 'auction' && gameState.auctionPhase !== 'completed') {
        console.log('⏰ Skipping normal game display - auction still in progress');
        return;
    }
    
    const allPlayersLocked = Object.values(gameState.players)
        .filter(p => p.team)
        .every(p => p.locked);
    
    const timerEnded = gameState.timer <= 0;
    
    if (allPlayersLocked || timerEnded) {
        elements.phaseIndicator.textContent = 'Champion Select Complete!';
        elements.timer.textContent = 'READY';
    } else {
        // Show appropriate phase text based on draft mode
        if (gameState.draftMode === 'auction') {
            elements.phaseIndicator.textContent = 'Trading & Lock Phase';
        } else {
            elements.phaseIndicator.textContent = 'Champion Select Phase';
        }
        elements.timer.textContent = gameState.timer;
    }
    
    updateTeamDisplay('blue');
    updateTeamDisplay('red');
    updateBenchDisplay();
    
    // ALWAYS update card/memory displays for non-auction modes
    if (gameState.draftMode === 'two-card-pick') {
        updateCardPickDisplay();
    } else if (gameState.draftMode === 'memory-pick') {
        updateMemoryPickDisplay();
    }
}

function updateTeamDisplay(team) {
    const container = team === 'blue' ? elements.blueTeam : elements.redTeam;
    
    // CRITICAL: Clear container completely to avoid showing previous room's champions
    container.innerHTML = '';
    
    // Only show players from current game state
    if (!gameState.players || Object.keys(gameState.players).length === 0) {
        console.log(`No players in gameState for team ${team}`);
        return;
    }
    
    const teamPlayers = Object.values(gameState.players).filter(p => p.team === team);
    
    console.log(`🎯 Updating ${team} team display:`, teamPlayers.map(p => `${p.name}: ${p.champion?.name || 'no champion'}`));
    
    teamPlayers.forEach(player => {
        const slot = createPlayerSlot(player);
        container.appendChild(slot);
    });
    
    // If no players on this team, show empty message
    if (teamPlayers.length === 0) {
        const emptySlot = document.createElement('div');
        emptySlot.className = 'empty-team-slot';
        emptySlot.textContent = `No players on ${team} team`;
        emptySlot.style.color = '#888';
        emptySlot.style.padding = '20px';
        emptySlot.style.textAlign = 'center';
        container.appendChild(emptySlot);
    }
}

function resetGameInterface() {
    console.log('🔄 Resetting game interface to prevent cross-room contamination');
    
    // Clear all team displays
    if (elements.blueTeam) elements.blueTeam.innerHTML = '';
    if (elements.redTeam) elements.redTeam.innerHTML = '';
    
    // Clear bench display
    if (elements.benchChampions) elements.benchChampions.innerHTML = '';
    
    // Clear any card displays
    const cardSection = document.getElementById('cardPickSection');
    if (cardSection) cardSection.classList.add('hidden');
    
    const memorySection = document.getElementById('memoryPickSection');
    if (memorySection) memorySection.classList.add('hidden');
    
    const auctionSection = document.getElementById('auctionSection');
    if (auctionSection) auctionSection.classList.add('hidden');
    
    // Clear any trade requests
    if (elements.tradeRequest) elements.tradeRequest.classList.add('hidden');
    
    // Reset timer display
    if (elements.timer) elements.timer.textContent = '90';
    if (elements.phaseIndicator) elements.phaseIndicator.textContent = 'Champion Select Phase';
    
    console.log('✅ Game interface reset complete');
}

function createPlayerSlot(player) {
    const slot = document.createElement('div');
    slot.className = 'player-slot';
    
    if (player.id === gameState.currentPlayerId) {
        slot.classList.add('current-player');
    }
    
    if (player.locked) {
        slot.classList.add('locked');
    }

    const portrait = createChampionPortrait(player.champion, () => {
        if (player.id === gameState.currentPlayerId && !player.locked && player.champion) {
            
        }
    });

    const info = document.createElement('div');
    info.className = 'champion-info';
    
    const name = document.createElement('div');
    name.className = 'player-name';
    name.textContent = player.name;
    
    const champion = document.createElement('div');
    champion.className = 'champion-name';
    champion.textContent = player.champion ? player.champion.name : 'No Champion';

    const winrateDiv = document.createElement('div');
    winrateDiv.className = 'champion-winrate';
    winrateDiv.id = `winrate-${player.id}`;
    
    if (player.champion && player.id === gameState.currentPlayerId) {
        loadChampionWinrate(player.champion.name, player.id);
    }

    if (player.id === gameState.currentPlayerId && !player.locked) {
        const controls = createPlayerControls(player);
        info.appendChild(controls);
    }

    if (player.locked) {
        const lockStatus = document.createElement('div');
        lockStatus.className = 'lock-status';
        lockStatus.textContent = 'LOCKED';
        slot.appendChild(lockStatus);
    }

    info.appendChild(name);
    info.appendChild(champion);
    info.appendChild(winrateDiv);
    slot.appendChild(portrait);
    slot.appendChild(info);

    return slot;
}

function createPlayerControls(player) {
    const controls = document.createElement('div');
    controls.className = 'player-controls';

    const draftMode = gameState.draftMode || 'aram';
    
    console.log(`🎮 Creating controls for ${player.name}:`);
    console.log(`   - Draft mode: ${draftMode}`);
    console.log(`   - Has champion: ${!!player.champion} (${player.champion?.name || 'none'})`);
    console.log(`   - Is locked: ${player.locked}`);
    console.log(`   - Auction phase: ${gameState.auctionPhase}`);
    
    if (draftMode === 'aram') {
        const rerollBtn = document.createElement('button');
        rerollBtn.className = 'control-btn';
        rerollBtn.textContent = `Reroll (${player.rerollTokens})`;
        rerollBtn.disabled = player.rerollTokens <= 0 || !player.champion;
        rerollBtn.onclick = () => {
            rerollChampion();
            setTimeout(() => {
                if (player.champion) {
                    loadChampionWinrate(player.champion.name, player.id);
                }
            }, 500);
        };
        controls.appendChild(rerollBtn);
        
    } else if (draftMode === 'two-card-pick') {
        if (!player.hasPicked && player.cardOptions && player.cardOptions.length > 0) {
            const pickStatus = document.createElement('div');
            pickStatus.className = 'pick-status';
            pickStatus.textContent = 'Choose your champion from the cards above';
            pickStatus.style.color = '#c89b3c';
            pickStatus.style.fontWeight = 'bold';
            pickStatus.style.padding = '5px';
            controls.appendChild(pickStatus);
        } else if (player.hasPicked) {
            const pickStatus = document.createElement('div');
            pickStatus.className = 'pick-status';
            pickStatus.textContent = 'Champion selected!';
            pickStatus.style.color = '#5cb85c';
            pickStatus.style.fontWeight = 'bold';
            pickStatus.style.padding = '5px';
            controls.appendChild(pickStatus);
        }
        
    } else if (draftMode === 'memory-pick') {
        if (!player.hasMemoryPicked && player.memoryCards && player.memoryCards.length > 0) {
            const memoryStatus = document.createElement('div');
            memoryStatus.className = 'pick-status';
            
            if (player.memoryPhase === 'reveal') {
                memoryStatus.textContent = 'Memorizing champions...';
                memoryStatus.style.color = '#c89b3c';
            } else if (player.memoryPhase === 'shuffle') {
                memoryStatus.textContent = 'Cards shuffling...';
                memoryStatus.style.color = '#f0ad4e';
            } else if (player.memoryPhase === 'pick') {
                memoryStatus.textContent = 'Pick your champion from memory!';
                memoryStatus.style.color = '#5bc0de';
            }
            
            memoryStatus.style.fontWeight = 'bold';
            memoryStatus.style.padding = '5px';
            controls.appendChild(memoryStatus);
        } else if (player.hasMemoryPicked) {
            const pickStatus = document.createElement('div');
            pickStatus.className = 'pick-status';
            pickStatus.textContent = 'Champion selected!';
            pickStatus.style.color = '#5cb85c';
            pickStatus.style.fontWeight = 'bold';
            pickStatus.style.padding = '5px';
            controls.appendChild(pickStatus);
        }
        
    } else if (draftMode === 'auction') {
        if (gameState.auctionPhase !== 'completed') {
            if (player.champion) {
                const auctionStatus = document.createElement('div');
                auctionStatus.className = 'pick-status';
                auctionStatus.textContent = `Won: ${player.champion.name}`;
                auctionStatus.style.color = '#5cb85c';
                auctionStatus.style.fontWeight = 'bold';
                auctionStatus.style.padding = '5px';
                controls.appendChild(auctionStatus);
            } else {
                const auctionStatus = document.createElement('div');
                auctionStatus.className = 'pick-status';
                auctionStatus.textContent = 'Waiting for auction...';
                auctionStatus.style.color = '#c89b3c';
                auctionStatus.style.fontWeight = 'bold';
                auctionStatus.style.padding = '5px';
                controls.appendChild(auctionStatus);
            }
        }
    }

    // LOCK BUTTON
    const canLock = player.champion && (
        draftMode === 'aram' || 
        (draftMode === 'two-card-pick' && player.hasPicked) ||
        (draftMode === 'memory-pick' && player.hasMemoryPicked) ||
        (draftMode === 'auction')
    );
    
    if (canLock && !player.locked) {
        const lockBtn = document.createElement('button');
        lockBtn.className = 'control-btn';
        lockBtn.textContent = 'Lock In';
        lockBtn.onclick = () => lockChampion();
        controls.appendChild(lockBtn);
        console.log(`   ✅ Added lock button`);
    }

    // BUILD BUTTON
    if (player.champion) {
        const buildBtn = document.createElement('button');
        buildBtn.className = 'control-btn build-btn';
        buildBtn.textContent = 'View Build & Runes';
        buildBtn.onclick = () => {
            const championId = player.champion.id.toLowerCase();
            const buildUrl = `https://u.gg/lol/champions/aram/${championId}-aram`;
            window.open(buildUrl, '_blank');
        };
        controls.appendChild(buildBtn);
        console.log(`   ✅ Added build button`);
    }

    // TRADE BUTTONS
    const isCurrentPlayer = player.id === gameState.currentPlayerId;
    const canTrade = isCurrentPlayer && player.champion && !player.locked && (
        draftMode === 'aram' || 
        (draftMode === 'two-card-pick' && player.hasPicked) ||
        (draftMode === 'memory-pick' && player.hasMemoryPicked) ||
        (draftMode === 'auction')
    );
    
    console.log(`   🔄 Trade check: isCurrentPlayer=${isCurrentPlayer}, canTrade=${canTrade}`);
    
    if (canTrade) {
        const teammates = Object.values(gameState.players).filter(p => 
            p.team === player.team && 
            p.id !== player.id && 
            p.champion && 
            !p.locked
        );

        console.log(`   🤝 Found ${teammates.length} tradeable teammates:`, teammates.map(t => `${t.name}(${t.champion?.name})`));

        teammates.forEach(teammate => {
            const tradeBtn = document.createElement('button');
            tradeBtn.className = 'control-btn trade-btn';
            tradeBtn.textContent = `Trade ${teammate.name}`;
            tradeBtn.style.backgroundColor = '#e67e22';
            tradeBtn.style.color = 'white';
            
            tradeBtn.onclick = () => {
                console.log(`🔄 Clicking trade button: ${player.champion.name} ↔ ${teammate.champion.name}`);
                offerTrade(teammate.id);
            };
            tradeBtn.title = `Trade your ${player.champion.name} for their ${teammate.champion.name}`;
            
            controls.appendChild(tradeBtn);
            console.log(`   ✅ Added trade button: Trade ${teammate.name} (${teammate.champion.name})`);
        });
        
        if (teammates.length === 0) {
            console.log(`   ⚠️ No valid teammates to trade with`);
        }
    } else {
        console.log(`   ❌ Cannot show trade buttons`);
    }

    return controls;
}

function loadChampionWinrate(championName, playerId) {
    const winrateElement = document.getElementById(`winrate-${playerId}`);
    if (!winrateElement) return;
    
    winrateElement.innerHTML = '<span style="color: #c89b3c; font-size: 11px;">Loading winrate...</span>';
    
    socket.emit('getChampionWinrate', { 
        championName: championName,
        playerSocketId: playerId
    });
}

function displayChampionWinrate(championName, winrateData, playerId) {
    const winrateElement = document.getElementById(`winrate-${playerId}`);
    if (!winrateElement) return;
    
    if (!winrateData) {
        winrateElement.innerHTML = '<span style="color: #cdbe91; font-size: 11px;">No recent ARAM data</span>';
        return;
    }
    
    const winrateColor = winrateData.winrate >= 60 ? '#5cb85c' : 
                       winrateData.winrate >= 50 ? '#f0ad4e' : '#d9534f';
    
    winrateElement.innerHTML = `
        <span style="color: ${winrateColor}; font-size: 12px; font-weight: bold;">
            ${winrateData.winrate}% WR (${winrateData.wins}W/${winrateData.games}G)
        </span>
    `;
    
    winrateElement.title = `ARAM Winrate with ${championName}: ${winrateData.wins} wins out of ${winrateData.games} games (${winrateData.winrate}%)`;
}

function createChampionPortrait(champion, onClick) {
    const portrait = document.createElement('div');
    portrait.className = 'champion-portrait';
    if (onClick) portrait.addEventListener('click', onClick);
    
    if (champion) {
        const img = document.createElement('img');
        img.src = `https://ddragon.leagueoflegends.com/cdn/${LATEST_VERSION}/img/champion/${champion.id}.png`;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        img.style.borderRadius = '9px';
        img.onerror = function() {
            portrait.textContent = champion.name.substring(0, 3);
            portrait.style.fontSize = '14px';
            portrait.style.fontWeight = 'bold';
        };
        portrait.appendChild(img);
        portrait.title = champion.name;
    } else {
        portrait.textContent = '?';
        portrait.style.fontSize = '24px';
        portrait.style.fontWeight = 'bold';
    }
    
    return portrait;
}

function updateBenchDisplay() {
    console.log('=== updateBenchDisplay called ===');
    elements.benchChampions.innerHTML = '';

    // Get the current player's team bench
    const currentPlayer = gameState.players[gameState.currentPlayerId];
    console.log('Current player:', currentPlayer);
    console.log('Current player team:', currentPlayer?.team);
    console.log('GameState bench:', gameState.bench);
    
    if (!currentPlayer || !currentPlayer.team) {
        const noBench = document.createElement('div');
        noBench.textContent = 'Join a team to see available champions';
        noBench.style.color = '#cdbe91';
        noBench.style.textAlign = 'center';
        noBench.style.padding = '20px';
        elements.benchChampions.appendChild(noBench);
        console.log('No current player or team, showing join message');
        return;
    }

    const teamBench = gameState.bench || [];
    console.log(`Team bench for ${currentPlayer.team} team:`, teamBench);
    console.log('Team bench length:', teamBench.length);

    if (teamBench.length === 0) {
        const noBench = document.createElement('div');
        noBench.textContent = 'No champions in team bench yet - reroll to add champions here!';
        noBench.style.color = '#cdbe91';
        noBench.style.textAlign = 'center';
        noBench.style.padding = '20px';
        elements.benchChampions.appendChild(noBench);
        console.log('Team bench is empty, showing empty message');
        return;
    }

    // Update bench title to show it's team-specific
    const teamColor = currentPlayer.team === 'blue' ? 'Blue' : 'Red';
    const benchTitle = elements.benchChampions.parentElement.querySelector('.bench-title');
    if (benchTitle) {
        benchTitle.textContent = `${teamColor} Team Bench - Available Champions (${teamBench.length})`;
        console.log('Updated bench title');
    }

    console.log('Creating bench cards for champions:', teamBench.map(c => c.name));
    teamBench.forEach((champion, index) => {
        console.log(`Creating bench card ${index + 1}/${teamBench.length} for ${champion.name}`);
        const card = createBenchChampionCard(champion);
        elements.benchChampions.appendChild(card);
    });
    
    console.log('=== updateBenchDisplay completed ===');
}

function createBenchChampionCard(champion) {
    const card = document.createElement('div');
    card.className = 'bench-champion';
    
    const img = document.createElement('img');
    img.src = `https://ddragon.leagueoflegends.com/cdn/${LATEST_VERSION}/img/champion/${champion.id}.png`;
    img.alt = champion.name;
    img.onerror = function() {
        this.style.display = 'none';
        card.textContent = champion.name;
        card.style.fontSize = '12px';
        card.style.fontWeight = 'bold';
    };
    
    card.appendChild(img);
    card.title = champion.name;
    
    const currentPlayer = gameState.players[gameState.currentPlayerId];
    if (currentPlayer && !currentPlayer.locked) {
        card.addEventListener('click', () => {
            swapWithBench(champion.id);
            setTimeout(() => {
                loadChampionWinrate(champion.name, gameState.currentPlayerId);
            }, 500);
        });
        card.style.cursor = 'pointer';
    } else {
        card.style.cursor = 'not-allowed';
        card.style.opacity = '0.5';
    }
    
    return card;
}

function showTradeRequest(tradeData) {
    console.log('🔄 showTradeRequest called with:', tradeData);
    console.log('  - Current game state:', {
        draftMode: gameState.draftMode,
        auctionPhase: gameState.auctionPhase,
        gamePhase: gameState.gamePhase
    });
    
    // Ensure elements are properly initialized
    if (!elements || !elements.tradeRequest) {
        console.error('❌ Trade elements not initialized, reinitializing...');
        initializeElements();
        
        if (!elements.tradeRequest) {
            console.error('❌ Still no trade elements after reinit');
            // Create elements manually if needed
            createTradeElementsManually();
        }
    }
    
    if (!elements.tradeRequest || !elements.tradeMessage) {
        console.error('❌ Critical: Trade elements still missing after all attempts');
        return;
    }
    
    // Force reset any existing state
    elements.tradeRequest.classList.remove('hidden');
    elements.tradeRequest.style.display = 'flex';
    elements.tradeRequest.style.position = 'fixed';
    elements.tradeRequest.style.top = '50%';
    elements.tradeRequest.style.left = '50%';
    elements.tradeRequest.style.transform = 'translate(-50%, -50%)';
    elements.tradeRequest.style.zIndex = '10000';
    elements.tradeRequest.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
    elements.tradeRequest.style.padding = '20px';
    elements.tradeRequest.style.borderRadius = '10px';
    elements.tradeRequest.style.border = '2px solidrgb(0, 38, 255)';
    
    // Set the message
    const message = `${tradeData.fromPlayer} wants to trade ${tradeData.fromChampion.name} for your ${tradeData.toChampion.name}`;
    elements.tradeMessage.textContent = message;
    elements.tradeMessage.style.color = '#cdbe91';
    elements.tradeMessage.style.marginBottom = '15px';
    
    console.log('✅ Trade request modal should now be visible');
    
    // Add timeout to auto-decline after 30 seconds
    setTimeout(() => {
        if (!elements.tradeRequest.classList.contains('hidden')) {
            console.log('⏰ Trade request timed out, auto-declining');
            declineTrade();
        }
    }, 30000);
}

function createTradeElementsManually() {
    console.log('🔧 Creating trade elements manually...');
    
    // Remove any existing trade request
    const existing = document.getElementById('tradeRequest');
    if (existing) existing.remove();
    
    // Create trade request modal
    const tradeRequest = document.createElement('div');
    tradeRequest.id = 'tradeRequest';
    tradeRequest.className = 'trade-request hidden';
    tradeRequest.innerHTML = `
        <h3>Trade Request</h3>
        <p id="tradeMessage"></p>
        <div style="margin-top: 15px;">
            <button class="menu-button" id="acceptTradeBtn">Accept</button>
            <button class="menu-button decline-btn" id="declineTradeBtn">Decline</button>
        </div>
    `;
    
    document.body.appendChild(tradeRequest);
    
    // Update elements object
    elements.tradeRequest = tradeRequest;
    elements.tradeMessage = document.getElementById('tradeMessage');
    elements.acceptTradeBtn = document.getElementById('acceptTradeBtn');
    elements.declineTradeBtn = document.getElementById('declineTradeBtn');
    
    // Reattach event listeners
    if (elements.acceptTradeBtn) {
        elements.acceptTradeBtn.addEventListener('click', acceptTrade);
    }
    if (elements.declineTradeBtn) {
        elements.declineTradeBtn.addEventListener('click', declineTrade);
    }
    
    console.log('✅ Trade elements created manually');
}

function showTradeConfirmation(targetPlayerName) {
    // Remove any existing trade confirmation
    const existingConfirmation = document.querySelector('.trade-confirmation');
    if (existingConfirmation) {
        existingConfirmation.remove();
    }

    const confirmation = document.createElement('div');
    confirmation.className = 'trade-confirmation';
    confirmation.innerHTML = `
        <div class="trade-confirmation-content">
            <h4>Trade Offer Sent!</h4>
            <p>You sent a trade request to <strong>${targetPlayerName}</strong></p>
            <p>Waiting for their response...</p>
            <button class="menu-button" onclick="hideTradeConfirmation()">OK</button>
        </div>
    `;
    
    document.body.appendChild(confirmation);
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
        hideTradeConfirmation();
    }, 3000);
}

function hideTradeConfirmation() {
    const confirmation = document.querySelector('.trade-confirmation');
    if (confirmation) {
        confirmation.remove();
    }
}

function showGameComplete() {
    const blueTeam = Object.values(gameState.players).filter(p => p.team === 'blue');
    const redTeam = Object.values(gameState.players).filter(p => p.team === 'red');
    
    let summary = '';
    
    if (blueTeam.length > 0) {
        summary += '<div class="team-result blue"><h4>Blue Team:</h4>';
        blueTeam.forEach(p => {
            const champImage = p.champion ? 
                `<img src="https://ddragon.leagueoflegends.com/cdn/${LATEST_VERSION}/img/champion/${p.champion.id}.png" 
                      style="width: 32px; height: 32px; border-radius: 4px; margin-right: 8px; vertical-align: middle;"
                      onerror="this.style.display='none'">` : '';
            summary += `<div style="margin: 8px 0; display: flex; align-items: center;">
                         ${champImage}
                         <span><strong>${p.name}:</strong> ${p.champion ? p.champion.name : 'No Champion'}</span>
                       </div>`;
        });
        summary += '</div>';
    }
    
    if (redTeam.length > 0) {
        summary += '<div class="team-result red"><h4>Red Team:</h4>';
        redTeam.forEach(p => {
            const champImage = p.champion ? 
                `<img src="https://ddragon.leagueoflegends.com/cdn/${LATEST_VERSION}/img/champion/${p.champion.id}.png" 
                      style="width: 32px; height: 32px; border-radius: 4px; margin-right: 8px; vertical-align: middle;"
                      onerror="this.style.display='none'">` : '';
            summary += `<div style="margin: 8px 0; display: flex; align-items: center;">
                         ${champImage}
                         <span><strong>${p.name}:</strong> ${p.champion ? p.champion.name : 'No Champion'}</span>
                       </div>`;
        });
        summary += '</div>';
    }
    
    elements.finalTeams.innerHTML = summary;
    elements.successModal.classList.remove('hidden');
}

function showError(message) {
    elements.errorMessage.textContent = message;
    elements.errorModal.classList.remove('hidden');
}

function closeError() {
    elements.errorModal.classList.add('hidden');
}

function backToMenu() {
    elements.successModal.classList.add('hidden');
    elements.gameInterface.classList.add('hidden');
    elements.lobbyScreen.classList.add('hidden');
    elements.mainMenu.classList.remove('hidden');
    
    // Reset game interface to prevent contamination
    resetGameInterface();
    
    // Clear session and reset game state
    clearGameSession();
    gameState = {
        roomCode: '',
        playerName: '',
        isHost: false,
        currentPlayerId: '',
        gamePhase: 'lobby',
        players: {},
        bench: [],
        timer: 90,
        pendingTrade: null,
        draftMode: 'aram',
        auctionPhase: 'ready',
        auctionCompleted: false
    };
    
    // Clear input fields
    elements.playerName.value = '';
    elements.joinPlayerName.value = '';
    elements.roomCode.value = '';
    
    console.log('🏠 Returned to main menu with clean state');
}

document.addEventListener('DOMContentLoaded', async () => {
    // Load latest version first
    await fetchLatestVersion();
    
    initializeElements();
    setupEventListeners();
    setupSocketListeners();
    
    elements.connectionStatus.textContent = 'Connecting...';
    elements.connectionStatus.className = 'connection-status connecting';

    const placeBidBtn = document.getElementById('placeBidBtn');
    if (placeBidBtn) {
        placeBidBtn.addEventListener('click', placeBid);
    }
    
    const bidInput = document.getElementById('bidInput');
    if (bidInput) {
        bidInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                placeBid();
            }
        });
        
        // Prevent invalid input
        bidInput.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            const currentPlayer = gameState.players[gameState.currentPlayerId];
            
            if (currentPlayer && value > currentPlayer.auctionCoins) {
                e.target.value = currentPlayer.auctionCoins;
            }
        });
    }
    
    const proceedBtn = document.getElementById('proceedToGameBtn');
    if (proceedBtn) {
        proceedBtn.addEventListener('click', proceedToGame);
    }

    // Try to reconnect if there's a saved session
    setTimeout(attemptReconnection, 1000);
});

// Handle page visibility changes
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        // Page is hidden
    } else {
        // Page is visible again
        if (gameState.gamePhase === 'champion-select') {
            updateDisplay();
        }
    }
});

// Handle window resize for responsive design
window.addEventListener('resize', () => {
    // Could add responsive layout adjustments here
});

// Export functions for debugging (optional)
if (typeof window !== 'undefined') {
    window.gameDebug = {
        gameState,
        socket,
        rerollChampion,
        swapWithBench,
        lockChampion,
        offerTrade
    };
}

function showRiotAccountLinking(action, playerName, roomCode = null) {
    const modal = document.createElement('div');
    modal.className = 'riot-account-modal';
    modal.innerHTML = `
        <div class="riot-account-content">
            <h3>Link Your Riot Account (Optional)</h3>
            <p>Link your account to play with your real champion pool, or skip to use all champions!</p>
            
            <div class="riot-input-group">
                <label>Riot ID:</label>
                <input type="text" id="riotId" placeholder="TheSpattt#8839" class="input-field">
                <small>Format: GameName#TAG (without spaces)</small>
            </div>
            
            <div class="riot-input-group">
                <label>Region:</label>
                <select id="riotRegion" class="input-field">
                    <option value="EUW">EUW - Europe West</option>
                    <option value="NA">NA - North America</option>
                    <option value="EUNE">EUNE - Europe Nordic East</option>
                    <option value="KR">KR - Korea</option>
                    <option value="BR">BR - Brazil</option>
                    <option value="LAN">LAN - Latin America North</option>
                    <option value="LAS">LAS - Latin America South</option>
                    <option value="OCE">OCE - Oceania</option>
                    <option value="TR">TR - Turkey</option>
                    <option value="RU">RU - Russia</option>
                    <option value="JP">JP - Japan</option>
                </select>
            </div>
            
            <div class="riot-buttons">
                <button class="menu-button primary" onclick="linkAndProceed('${action}', '${playerName}', '${roomCode || ''}')">
                    Link & ${action === 'create' ? 'Create Room' : 'Join Room'}
                </button>
                <button class="menu-button secondary" onclick="manageChampionPool('${action}', '${playerName}', '${roomCode || ''}')">
                    Manage Champion Pool
                </button>
                <button class="menu-button decline-btn" onclick="skipAndProceed('${action}', '${playerName}', '${roomCode || ''}')">
                    Skip (Use All Champions)
                </button>
            </div>
            
            <div id="linkingStatus" class="linking-status"></div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

function linkAndProceed(action, playerName, roomCode) {
    const riotId = document.getElementById('riotId').value.trim();
    const region = document.getElementById('riotRegion').value;
    const statusDiv = document.getElementById('linkingStatus');
    
    if (!riotId || !riotId.includes('#')) {
        statusDiv.innerHTML = '<span style="color: #d9534f;">Please enter a valid Riot ID (GameName#TAG)</span>';
        return;
    }
    
    statusDiv.innerHTML = '<span style="color: #c89b3c;">🔄 Linking account and proceeding...</span>';
    
    const [gameName] = riotId.split('#');
    
    gameState.pendingAction = { 
        action, 
        playerName: playerName, 
        roomCode, 
        useRiot: true,
        fallbackName: gameName 
    };
    
    socket.emit('linkRiotAccount', { riotId, region });
}

function skipAndProceed(action, playerName, roomCode) {
    document.querySelector('.riot-account-modal').remove();
    
    // Proceed without Riot account - use all champions
    if (action === 'create') {
        socket.emit('createRoom', { 
            playerName: playerName,
            championPool: null // null means use all champions
        });
    } else {
        socket.emit('joinRoom', { 
            roomCode: roomCode,
            playerName: playerName,
            championPool: null
        });
    }
}

const styles = `
.champion-winrate {
    margin-top: 4px;
    min-height: 16px;
}

.champion-winrate span {
    display: inline-block;
    padding: 2px 6px;
    border-radius: 3px;
    background: rgba(0, 0, 0, 0.3);
}
`;

const styleSheet = document.createElement('style');
styleSheet.textContent = styles;
document.head.appendChild(styleSheet);

function manageChampionPool(action, playerName, roomCode) {
    console.log('Manage Champion Pool clicked!', { action, playerName, roomCode });
    
    const riotId = document.getElementById('riotId');
    const region = document.getElementById('riotRegion');
    const statusDiv = document.getElementById('linkingStatus');
    
    if (!riotId || !riotId.value.trim() || !riotId.value.includes('#')) {
        statusDiv.innerHTML = '<span style="color: #d9534f;">Please enter a valid Riot ID first</span>';
        return;
    }
    
    statusDiv.innerHTML = '<span style="color: #c89b3c;">🔄 Linking account to manage champion pool...</span>';
    
    // First link the account to get real PUUID, then open champion pool
    gameState.pendingAction = { 
        action: 'championPool', 
        playerName: playerName, 
        roomCode: roomCode,
        originalAction: action
    };
    
    const riotData = {
        riotId: riotId.value.trim(),
        region: region.value
    };
    
    socket.emit('linkRiotAccount', riotData);
}

function showChampionPoolManager(userData) {
    const existingModal = document.querySelector('.champion-pool-modal');
    if (existingModal) {
        existingModal.remove();
    }

    const modal = document.createElement('div');
    modal.className = 'champion-pool-modal';
    modal.innerHTML = `
        <div class="champion-pool-content">
            <div class="champion-pool-header">
                <h3>Manage Your Champion Pool</h3>
                <p>Select the champions you own to create your personalized champion pool</p>
                <div class="pool-stats">
                    <span>Selected: <strong id="selectedCount">0</strong></span>
                    <span>Total: <strong id="totalCount">0</strong></span>
                    <span>Account: <strong id="accountName">${userData.summonerName || 'Not linked'}</strong></span>
                </div>
            </div>

            <div id="loadingIndicator" class="loading-indicator">
                Loading champions...
            </div>

            <div id="errorMessage" class="error-message" style="display: none;"></div>
            <div id="successMessage" class="success-message" style="display: none;"></div>

            <div id="championPoolContent" style="display: none;">
                <div class="search-section">
                    <input type="text" id="championSearch" class="search-input" placeholder="Search champions..." />
                </div>

                <div id="championGrid" class="champion-grid">
                </div>

                <div class="pool-actions">
                    <button class="pool-btn select-all" id="selectAllBtn">Select All</button>
                    <button class="pool-btn save" id="savePoolBtn">Save Champion Pool</button>
                    <button class="pool-btn cancel" id="cancelPoolBtn">Cancel</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    initializeChampionPool(userData);
}

function initializeChampionPool(userData) {
    let allChampions = [];
    let selectedChampions = new Set();

    async function loadChampionPool() {
        const loadingEl = document.getElementById('loadingIndicator');
        const contentEl = document.getElementById('championPoolContent');
        const errorEl = document.getElementById('errorMessage');

        try {
            loadingEl.style.display = 'block';
            contentEl.style.display = 'none';
            errorEl.style.display = 'none';

            console.log('🔄 Loading champions and existing pool...');
            
            // Load all available champions
            const championsResponse = await fetch('/api/champions');
            if (!championsResponse.ok) {
                throw new Error(`Failed to load champions: ${championsResponse.status}`);
            }
            
            allChampions = await championsResponse.json();
            console.log(`✅ Loaded ${allChampions.length} total champions`);
            
            // Clear selection first
            selectedChampions.clear();
            
            // Load existing saved champion pool
            if (userData.puuid && !userData.puuid.startsWith('temp_')) {
                console.log(`🔍 Loading existing champion pool for PUUID: ${userData.puuid}`);
                
                try {
                    const poolResponse = await fetch(`/api/champion-pool/${userData.puuid}`);
                    if (poolResponse.ok) {
                        const existingPool = await poolResponse.json();
                        console.log(`📋 Found existing pool: ${existingPool.length} champions`);
                        
                        if (existingPool.length > 0) {
                            console.log(`First 5 saved champions: ${existingPool.slice(0, 5).map(c => c.champion_name)}`);
                            
                            // Pre-select all saved champions
                            existingPool.forEach(savedChamp => {
                                selectedChampions.add(savedChamp.champion_name);
                            });
                            
                            console.log(`✅ Pre-selected ${selectedChampions.size} champions from database`);
                            console.log(`Pre-selected champions: ${Array.from(selectedChampions).slice(0, 10)}`);
                        } else {
                            console.log('📋 Existing pool is empty');
                        }
                    } else {
                        console.log('📋 No existing champion pool found in database');
                    }
                } catch (poolError) {
                    console.error('❌ Error loading existing pool:', poolError);
                }
            } else {
                console.log('⚠️  Using temporary PUUID, no existing pool to load');
            }
            
            // Render the grid with pre-selections
            renderChampionGrid();
            updateStats();

            loadingEl.style.display = 'none';
            contentEl.style.display = 'block';

        } catch (error) {
            console.error('❌ Error loading champion pool:', error);
            showError(`Failed to load champions: ${error.message}`);
            loadingEl.style.display = 'none';
        }
    }

    function renderChampionGrid(filter = '') {
        const grid = document.getElementById('championGrid');
        if (!grid) return;
        
        grid.innerHTML = '';

        const filteredChampions = allChampions.filter(champ => 
            champ.name.toLowerCase().includes(filter.toLowerCase())
        );

        console.log(`🎨 Rendering ${filteredChampions.length} champions (${selectedChampions.size} pre-selected)`);

        filteredChampions.forEach(champion => {
            const card = createChampionCard(champion);
            grid.appendChild(card);
        });
    }

    function createChampionCard(champion) {
        const card = document.createElement('div');
        card.className = 'champion-card';
        
        const isSelected = selectedChampions.has(champion.name);
        if (isSelected) {
            card.classList.add('selected');
        }

        card.innerHTML = `
            <img src="https://ddragon.leagueoflegends.com/cdn/${LATEST_VERSION}/img/champion/${champion.id}.png" 
                alt="${champion.name}" 
                onerror="this.style.display='none';">
            <div class="champion-name">${champion.name}</div>
            ${isSelected ? '<div class="selected-indicator">✓</div>' : ''}
        `;

        card.addEventListener('click', () => toggleChampion(champion.name, card));
        return card;
    }

    function toggleChampion(championName, cardElement) {
        if (selectedChampions.has(championName)) {
            // Deselect
            selectedChampions.delete(championName);
            cardElement.classList.remove('selected');
            const indicator = cardElement.querySelector('.selected-indicator');
            if (indicator) indicator.remove();
            console.log(`❌ Deselected: ${championName}`);
        } else {
            // Select
            selectedChampions.add(championName);
            cardElement.classList.add('selected');
            const indicator = document.createElement('div');
            indicator.className = 'selected-indicator';
            indicator.textContent = '✓';
            cardElement.appendChild(indicator);
            console.log(`✅ Selected: ${championName}`);
        }
        updateStats();
    }

    function updateStats() {
        const selectedEl = document.getElementById('selectedCount');
        const totalEl = document.getElementById('totalCount');
        if (selectedEl) selectedEl.textContent = selectedChampions.size;
        if (totalEl) totalEl.textContent = allChampions.length;
    }

    function selectAllChampions() {
        console.log('🎯 Selecting all champions');
        selectedChampions.clear();
        allChampions.forEach(champ => selectedChampions.add(champ.name));
        const searchValue = document.getElementById('championSearch')?.value || '';
        renderChampionGrid(searchValue);
        updateStats();
    }

    async function saveChampionPool() {
        const saveBtn = document.getElementById('savePoolBtn');
        if (!saveBtn) return;
        
        const originalText = saveBtn.textContent;
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        try {
            const championPool = allChampions.filter(champ => 
                selectedChampions.has(champ.name)
            );

            console.log(`💾 Saving ${championPool.length} champions for ${userData.summonerName}`);
            console.log(`Selected champions: ${Array.from(selectedChampions).slice(0, 10)}`);

            const response = await fetch('/api/save-champion-pool', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    puuid: userData.puuid,
                    summonerName: userData.summonerName,
                    region: userData.region,
                    championPool: championPool
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to save champion pool');
            }

            const result = await response.json();
            console.log('💾 Save response:', result);

            showSuccess(`Champion pool saved! ${selectedChampions.size} champions selected.`);
            
            // Don't auto-close, let user decide when to close
            setTimeout(() => {
                if (userData.action && userData.playerName) {
                    showSuccess(`Champion pool saved! Now proceeding to ${userData.action} game...`);
                    
                    setTimeout(() => {
                        hideChampionPoolModal();
                        
                        // Proceed with the original action
                        if (userData.action === 'create') {
                            socket.emit('createRoom', { 
                                playerName: userData.playerName,
                                championPool: championPool.map(c => c.name),
                                riotData: {
                                    puuid: userData.puuid,
                                    region: userData.region
                                }
                            });
                        } else if (userData.action === 'join') {
                            socket.emit('joinRoom', { 
                                roomCode: userData.roomCode,
                                playerName: userData.playerName,
                                championPool: championPool.map(c => c.name),
                                riotData: {
                                    puuid: userData.puuid,
                                    region: userData.region
                                }
                            });
                        }
                    }, 1500);
                }
            }, 1000);

        } catch (error) {
            console.error('❌ Error saving champion pool:', error);
            showError(`Failed to save champion pool: ${error.message}`);
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = originalText;
        }
    }

    function showError(message) {
        const errorEl = document.getElementById('errorMessage');
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.style.display = 'block';
            
            setTimeout(() => {
                errorEl.style.display = 'none';
            }, 5000);
        }
    }

    function showSuccess(message) {
        const successEl = document.getElementById('successMessage');
        if (successEl) {
            successEl.textContent = message;
            successEl.style.display = 'block';
        }
    }

    function hideChampionPoolModal() {
        const modal = document.querySelector('.champion-pool-modal');
        if (modal) {
            modal.remove();
        }
    }

    // Event listeners
    const searchInput = document.getElementById('championSearch');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            renderChampionGrid(e.target.value);
        });
    }

    const selectAllBtn = document.getElementById('selectAllBtn');
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', selectAllChampions);
    }

    const saveBtn = document.getElementById('savePoolBtn');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveChampionPool);
    }

    const cancelBtn = document.getElementById('cancelPoolBtn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', hideChampionPoolModal);
    }

    // Start loading
    console.log('🚀 Initializing champion pool for:', userData.summonerName);
    loadChampionPool();
}

const draftModeSelect = document.getElementById('draftMode');
if (draftModeSelect) {
    draftModeSelect.addEventListener('change', (e) => {
        const descriptions = {
            'aram': 'Random champion with reroll tokens',
            'two-card-pick': 'Choose between 2 random champions',
            'memory-pick': 'See 5 champions, watch them shuffle, then pick one by memory',
            'auction': 'Bid on 10 champions with your team (20 coins per player)'
        };
        document.getElementById('draftModeDescription').textContent = descriptions[e.target.value];
    });
}

function startChampionSelect() {
    const rerollTokens = gameState.rerollTokens || 2;
    const draftMode = document.getElementById('draftMode')?.value || 'aram';
    
    socket.emit('startGame', { 
        roomCode: gameState.roomCode, 
        rerollTokens: rerollTokens,
        draftMode: draftMode
    });
}

// Update Two Card pick display -> For draft mode 'two-card-pick'

function updateCardPickDisplay() {
    const cardSection = document.getElementById('cardPickSection');
    const currentPlayer = gameState.players[gameState.currentPlayerId];
    
    console.log('=== updateCardPickDisplay ===');
    console.log('Draft mode:', gameState.draftMode);
    console.log('Current player:', currentPlayer);
    console.log('Card options:', currentPlayer?.cardOptions);
    console.log('Has picked:', currentPlayer?.hasPicked);
    
    // Only show cards in two-card-pick mode
    if (gameState.draftMode !== 'two-card-pick') {
        cardSection.classList.add('hidden');
        return;
    }
    
    if (!currentPlayer || !currentPlayer.cardOptions || currentPlayer.hasPicked) {
        cardSection.classList.add('hidden');
        return;
    }
    
    if (currentPlayer.cardOptions.length === 2) {
        console.log('Showing card options:', currentPlayer.cardOptions.map(c => c.name));
        cardSection.classList.remove('hidden');
        
        // Set up the cards
        currentPlayer.cardOptions.forEach((champion, index) => {
            const cardElement = document.getElementById(`cardOption${index}`);
            const cardImage = cardElement.querySelector('.card-champion-image');
            const cardName = cardElement.querySelector('.card-champion-name');
            const pickButton = cardElement.querySelector('.pick-card-btn');
            
            // Set up the champion data
            cardImage.src = `https://ddragon.leagueoflegends.com/cdn/${LATEST_VERSION}/img/champion/${champion.id}.png`;
            cardImage.onerror = function() {
                this.style.display = 'none';
                cardName.style.fontSize = '16px';
                cardName.style.marginTop = '20px';
            };
            cardName.textContent = champion.name;
            
            // Reset button state
            pickButton.disabled = false;
            pickButton.textContent = 'Pick This Champion';
            
            // Reset any special styling
            cardElement.style.border = '';
            cardElement.style.boxShadow = '';
            
            console.log(`Card ${index} set up: ${champion.name}`);
        });
    } else {
        cardSection.classList.add('hidden');
    }
}

function pickCard(cardIndex) {
    console.log(`Attempting to pick card ${cardIndex}`);
    
    const currentPlayer = gameState.players[gameState.currentPlayerId];
    if (!currentPlayer || !currentPlayer.cardOptions || currentPlayer.cardOptions.length <= cardIndex) {
        console.error('Invalid card pick - no valid options');
        showError('Invalid card selection');
        return;
    }
    
    const chosenChampion = currentPlayer.cardOptions[cardIndex];
    console.log(`Picking champion: ${chosenChampion.name}`);
    
    // Show visual feedback on the chosen card
    const cardElement = document.getElementById(`cardOption${cardIndex}`);
    if (cardElement) {
        cardElement.style.border = '3px solid #5cb85c';
        cardElement.style.boxShadow = '0 0 20px rgba(92, 184, 92, 0.8)';
    }
    
    // Disable both buttons and show loading state
    const buttons = document.querySelectorAll('.pick-card-btn');
    buttons.forEach((btn, index) => {
        btn.disabled = true;
        if (index === cardIndex) {
            btn.textContent = 'Selecting...';
            btn.style.background = '#5cb85c';
        } else {
            btn.textContent = 'Not Selected';
            btn.style.opacity = '0.5';
        }
    });
    
    // Send the pick to server
    socket.emit('pickCard', { roomCode: gameState.roomCode, cardIndex: cardIndex });
}

function resetCardDisplay() {
    const cardSection = document.getElementById('cardPickSection');
    
    // Reset all card styling
    const cards = cardSection.querySelectorAll('.champion-card-option');
    cards.forEach(card => {
        card.style.border = '';
        card.style.boxShadow = '';
    });
    
    // Reset button states
    const buttons = cardSection.querySelectorAll('.pick-card-btn');
    buttons.forEach(btn => {
        btn.disabled = false;
        btn.textContent = 'Pick This Champion';
        btn.style.background = '';
        btn.style.opacity = '';
    });
    
    cardSection.classList.add('hidden');
    console.log('Card display reset and hidden');
}

// Update memory pick display -> For draft mode memory-pick

function updateMemoryPickDisplay() {
    const memorySection = document.getElementById('memoryPickSection');
    const currentPlayer = gameState.players[gameState.currentPlayerId];
    
    console.log('=== updateMemoryPickDisplay ===');
    console.log('Draft mode:', gameState.draftMode);
    console.log('Current player:', currentPlayer);
    console.log('Memory cards:', currentPlayer?.memoryCards);
    console.log('Memory phase:', currentPlayer?.memoryPhase);
    
    // Only show in memory-pick mode
    if (gameState.draftMode !== 'memory-pick') {
        memorySection.classList.add('hidden');
        return;
    }
    
    if (!currentPlayer || !currentPlayer.memoryCards || currentPlayer.hasMemoryPicked) {
        memorySection.classList.add('hidden');
        return;
    }
    
    if (currentPlayer.memoryCards.length === 5) {
        console.log('Showing memory cards:', currentPlayer.memoryCards.map(c => c.name));
        memorySection.classList.remove('hidden');
        
        // Set up the cards based on phase
        setupMemoryDisplay(currentPlayer);
    } else {
        memorySection.classList.add('hidden');
    }
}

function setupMemoryDisplay(player) {
    const titleEl = document.getElementById('memoryPhaseTitle');
    const descEl = document.getElementById('memoryPhaseDescription');
    const timerEl = document.getElementById('memoryTimer');
    const reminderEl = document.getElementById('championsReminder');
    
    // Set up champion cards
    player.memoryCards.forEach((champion, index) => {
        const cardElement = document.getElementById(`memoryCard${index}`);
        const cardImage = cardElement.querySelector('.memory-champion-image');
        const cardName = cardElement.querySelector('.memory-champion-name');
        
        cardImage.src = `https://ddragon.leagueoflegends.com/cdn/${LATEST_VERSION}/img/champion/${champion.id}.png`;
        cardImage.onerror = function() {
            this.style.display = 'none';
            cardName.style.fontSize = '10px';
        };
        cardName.textContent = champion.name;
    });
    
    // Set up reminder list
    reminderEl.innerHTML = '';
    player.memoryCards.forEach(champion => {
        const reminderItem = document.createElement('div');
        reminderItem.className = 'champion-reminder-item';
        reminderItem.innerHTML = `
            <img class="reminder-champion-image" 
                 src="https://ddragon.leagueoflegends.com/cdn/${LATEST_VERSION}/img/champion/${champion.id}.png" 
                 alt="${champion.name}">
            <div class="reminder-champion-name">${champion.name}</div>
        `;
        reminderEl.appendChild(reminderItem);
    });
    
    // Update display based on current phase
    if (player.memoryPhase === 'reveal') {
        showRevealPhase(titleEl, descEl, timerEl);
    } else if (player.memoryPhase === 'shuffle') {
        showShufflePhase(titleEl, descEl, timerEl);
    } else if (player.memoryPhase === 'pick') {
        showPickPhase(titleEl, descEl, timerEl);
    }
}

function showRevealPhase(titleEl, descEl, timerEl) {
    titleEl.textContent = 'Memorize Your Champions';
    descEl.textContent = 'Study these 5 champions carefully - they will be shuffled!';
    timerEl.style.display = 'block';
    
    // Show cards face up
    for (let i = 0; i < 5; i++) {
        const cardElement = document.getElementById(`memoryCard${i}`);
        cardElement.classList.remove('flipped', 'picking-enabled');
        cardElement.onclick = null;
    }
    
    // Start countdown
    let countdown = 5;
    timerEl.textContent = countdown;
    
    if (memoryPickTimer) clearInterval(memoryPickTimer);
    memoryPickTimer = setInterval(() => {
        countdown--;
        timerEl.textContent = countdown;
        
        if (countdown <= 0) {
            clearInterval(memoryPickTimer);
            memoryPickTimer = null;
        }
    }, 1000);
}

function showShufflePhase(titleEl, descEl, timerEl) {
    titleEl.textContent = 'Shuffling...';
    descEl.textContent = 'Watch the cards shuffle! Remember where your champions go.';
    timerEl.style.display = 'none';
    
    // Clear any existing timer
    if (memoryPickTimer) {
        clearInterval(memoryPickTimer);
        memoryPickTimer = null;
    }
    
    // Flip all cards face down
    for (let i = 0; i < 5; i++) {
        const cardElement = document.getElementById(`memoryCard${i}`);
        cardElement.classList.add('flipped');
        cardElement.classList.remove('picking-enabled');
        cardElement.onclick = null;
    }
    
    // Add shuffle animation
    animateCardShuffle();
}

function showPickPhase(titleEl, descEl, timerEl) {
    titleEl.textContent = 'Pick Your Champion!';
    descEl.textContent = 'Click on the card you think contains the champion you want.';
    timerEl.style.display = 'none';
    
    // Clear any existing timer
    if (memoryPickTimer) {
        clearInterval(memoryPickTimer);
        memoryPickTimer = null;
    }
    
    // Enable clicking on cards
    for (let i = 0; i < 5; i++) {
        const cardElement = document.getElementById(`memoryCard${i}`);
        cardElement.classList.add('picking-enabled');
        cardElement.classList.add('flipped'); // Make sure they stay flipped
        cardElement.onclick = () => pickMemoryCard(i);
    }
}

function setupMemoryRevealPhase(player) {
    const titleEl = document.getElementById('memoryPhaseTitle');
    const descEl = document.getElementById('memoryPhaseDescription');
    const timerEl = document.getElementById('memoryTimer');
    const reminderEl = document.getElementById('championsReminder');
    
    titleEl.textContent = 'Memorize Your Champions';
    descEl.textContent = 'Study these 5 champions carefully - they will be shuffled!';
    timerEl.style.display = 'block';
    
    // Set up champion cards (face up)
    player.memoryCards.forEach((champion, index) => {
        const cardElement = document.getElementById(`memoryCard${index}`);
        const cardImage = cardElement.querySelector('.memory-champion-image');
        const cardName = cardElement.querySelector('.memory-champion-name');
        
        cardImage.src = `https://ddragon.leagueoflegends.com/cdn/${LATEST_VERSION}/img/champion/${champion.id}.png`;
        cardImage.onerror = function() {
            this.style.display = 'none';
            cardName.style.fontSize = '10px';
        };
        cardName.textContent = champion.name;
        
        // Make sure cards are face up
        cardElement.classList.remove('flipped');
        cardElement.classList.remove('picking-enabled');
        cardElement.onclick = null;
    });
    
    // Set up reminder list
    reminderEl.innerHTML = '';
    player.memoryCards.forEach(champion => {
        const reminderItem = document.createElement('div');
        reminderItem.className = 'champion-reminder-item';
        reminderItem.innerHTML = `
            <img class="reminder-champion-image" 
                 src="https://ddragon.leagueoflegends.com/cdn/${LATEST_VERSION}/img/champion/${champion.id}.png" 
                 alt="${champion.name}">
            <div class="reminder-champion-name">${champion.name}</div>
        `;
        reminderEl.appendChild(reminderItem);
    });
    
    // Start 5 second countdown
    let countdown = 5;
    timerEl.textContent = countdown;
    
    memoryPickTimer = setInterval(() => {
        countdown--;
        timerEl.textContent = countdown;
        
        if (countdown <= 0) {
            clearInterval(memoryPickTimer);
            startMemoryShufflePhase(player);
        }
    }, 1000);
}

function startMemoryShufflePhase(player) {
    const titleEl = document.getElementById('memoryPhaseTitle');
    const descEl = document.getElementById('memoryPhaseDescription');
    const timerEl = document.getElementById('memoryTimer');
    
    titleEl.textContent = 'Shuffling...';
    descEl.textContent = 'Watch the cards shuffle! Remember where your champions go.';
    timerEl.style.display = 'none';
    
    // Flip all cards face down
    for (let i = 0; i < 5; i++) {
        const cardElement = document.getElementById(`memoryCard${i}`);
        cardElement.classList.add('flipped');
    }
    
    // Animate shuffle - move cards to their new positions
    setTimeout(() => {
        animateCardShuffle(player);
    }, 1000);
}

function animateCardShuffle() {
    const cards = [];
    for (let i = 0; i < 5; i++) {
        cards.push(document.getElementById(`memoryCard${i}`));
    }
    
    // Add shuffling class for smooth transitions
    cards.forEach(card => {
        if (card) card.classList.add('shuffling');
    });
    
    // Create shuffle animation
    const positions = [
        { x: -100, y: -50 },
        { x: 100, y: -50 },
        { x: -100, y: 50 },
        { x: 100, y: 50 },
        { x: 0, y: 0 }
    ];
    
    // Animate cards moving around
    cards.forEach((card, index) => {
        if (!card) return;
        
        const randomPos = positions[Math.floor(Math.random() * positions.length)];
        
        setTimeout(() => {
            card.style.transform = `translate(${randomPos.x}px, ${randomPos.y}px) rotate(${Math.random() * 180 - 90}deg)`;
        }, index * 100);
        
        setTimeout(() => {
            card.style.transform = '';
            card.classList.remove('shuffling');
        }, 2000 + index * 100);
    });
}

function rearrangeCardsAfterShuffle(player) {
    const container = document.querySelector('.memory-cards-container');
    const cards = [];
    
    // Collect all cards
    for (let i = 0; i < 5; i++) {
        cards.push(document.getElementById(`memoryCard${i}`));
    }
    
    // Clear container
    container.innerHTML = '';
    
    // Re-add cards in shuffled order
    player.shuffledPositions.forEach((originalIndex, newPosition) => {
        const card = cards[originalIndex];
        card.style.transform = '';
        card.classList.remove('shuffling');
        card.id = `memoryCard${newPosition}`;
        container.appendChild(card);
    });
}

function startMemoryPickPhase(player) {
    const titleEl = document.getElementById('memoryPhaseTitle');
    const descEl = document.getElementById('memoryPhaseDescription');
    
    titleEl.textContent = 'Pick Your Champion!';
    descEl.textContent = 'Click on the card you think contains the champion you want.';
    
    // Enable clicking on cards
    for (let i = 0; i < 5; i++) {
        const cardElement = document.getElementById(`memoryCard${i}`);
        cardElement.classList.add('picking-enabled');
        cardElement.onclick = () => pickMemoryCard(i);
    }
    
    // Update player phase
    const currentPlayer = gameState.players[gameState.currentPlayerId];
    currentPlayer.memoryPhase = 'pick';
}

function pickMemoryCard(position) {
    console.log(`Picking memory card at position ${position}`);
    
    const currentPlayer = gameState.players[gameState.currentPlayerId];
    if (!currentPlayer || currentPlayer.memoryPhase !== 'pick') {
        console.error('Cannot pick card right now, phase:', currentPlayer?.memoryPhase);
        return;
    }
    
    // Disable all cards
    for (let i = 0; i < 5; i++) {
        const cardElement = document.getElementById(`memoryCard${i}`);
        if (cardElement) {
            cardElement.classList.remove('picking-enabled');
            cardElement.onclick = null;
            
            if (i === position) {
                cardElement.style.border = '3px solid #5cb85c';
                cardElement.style.boxShadow = '0 0 20px rgba(92, 184, 92, 0.8)';
            } else {
                cardElement.style.opacity = '0.5';
            }
        }
    }
    
    // Send pick to server
    socket.emit('pickCard', { roomCode: gameState.roomCode, cardIndex: position });
}

function resetMemoryDisplay() {
    const memorySection = document.getElementById('memoryPickSection');
    
    // Clear any timers
    if (memoryPickTimer) {
        clearInterval(memoryPickTimer);
        memoryPickTimer = null;
    }
    
    // Reset all card styling
    for (let i = 0; i < 5; i++) {
        const cardElement = document.getElementById(`memoryCard${i}`);
        if (cardElement) {
            cardElement.classList.remove('flipped', 'shuffling', 'picking-enabled');
            cardElement.style.transform = '';
            cardElement.style.border = '';
            cardElement.style.boxShadow = '';
            cardElement.style.opacity = '';
            cardElement.onclick = null;
        }
    }
    
    memorySection.classList.add('hidden');
    console.log('Memory display reset and hidden');
}

function updateAuctionDisplay() {
    const auctionSection = document.getElementById('auctionSection');
    const currentPlayer = gameState.players[gameState.currentPlayerId];
    
    console.log('=== updateAuctionDisplay ===');
    console.log('Draft mode:', gameState.draftMode);
    console.log('Current player:', currentPlayer);
    
    // Only show in auction mode
    if (gameState.draftMode !== 'auction') {
        auctionSection.classList.add('hidden');
        return;
    }
    
    if (!currentPlayer) {
        auctionSection.classList.add('hidden');
        return;
    }
    
    auctionSection.classList.remove('hidden');
}

function setBidAmount(amount) {
    const bidInput = document.getElementById('bidInput');
    const currentPlayer = gameState.players[gameState.currentPlayerId];
    
    if (!currentPlayer) return;
    
    const currentTeamBid = getCurrentTeamBid();
    const otherTeamBid = getOtherTeamBid();
    const myCurrentContribution = getCurrentPlayerContribution();
    
    console.log(`📊 Bid calculation for ${amount}:`, {
        currentTeamBid,
        otherTeamBid,
        myCurrentContribution,
        availableCoins: currentPlayer.auctionCoins
    });
    
    let targetContribution;
    
    if (amount === 'all') {
        // Contribute all available coins (current + remaining)
        targetContribution = myCurrentContribution + currentPlayer.auctionCoins;
        console.log(`💰 ALL: Contributing all ${currentPlayer.auctionCoins} remaining coins`);
        
    } else {
        // Calculate what we need to beat the other team
        const minimumTeamTotal = otherTeamBid + 1;
        const teamWithoutMe = currentTeamBid - myCurrentContribution;
        const minimumNeeded = Math.max(1, minimumTeamTotal - teamWithoutMe);
        
        // For shortcuts, add the shortcut amount to current contribution
        const shortcutTarget = myCurrentContribution + amount;
        
        // Use whichever is higher: shortcut or minimum needed
        targetContribution = Math.max(shortcutTarget, minimumNeeded);
        
        console.log(`🎯 Shortcut ${amount}:`, {
            shortcutTarget: `${myCurrentContribution} + ${amount} = ${shortcutTarget}`,
            minimumNeeded: `Need ${minimumNeeded} to beat other team`,
            chosen: targetContribution
        });
    }
    
    // Make sure we don't exceed what we can afford
    const maxPossible = myCurrentContribution + currentPlayer.auctionCoins;
    const finalContribution = Math.min(targetContribution, maxPossible);
    
    // Make sure we're not reducing our contribution
    const actualContribution = Math.max(finalContribution, myCurrentContribution);
    
    bidInput.value = actualContribution;
    
    console.log(`✅ Final bid amount: ${actualContribution} (was ${myCurrentContribution})`);
    
    // Update button state
    const placeBidBtn = document.getElementById('placeBidBtn');
    if (placeBidBtn) {
        const additionalCost = actualContribution - myCurrentContribution;
        placeBidBtn.disabled = additionalCost > currentPlayer.auctionCoins || actualContribution <= 0;
        
        if (additionalCost === 0) {
            placeBidBtn.textContent = 'No Change';
        } else {
            placeBidBtn.textContent = `Add ${additionalCost} Coins`;
        }
    }
}

function getCurrentPlayerContribution() {
    const currentPlayer = gameState.players[gameState.currentPlayerId];
    
    if (!currentPlayer) {
        console.log('No current player found');
        return 0;
    }
    
    if (gameState.draftMode === 'auction') {
        const contribution = currentPlayer.currentBid || 0;
        console.log(`Current player contribution: ${contribution} coins`);
        return contribution;
    }
    
    return 0;
}

function placeBid() {
    const bidInput = document.getElementById('bidInput');
    const bidAmount = parseInt(bidInput.value);
    const currentPlayer = gameState.players[gameState.currentPlayerId];
    
    if (!bidInput.value || bidInput.value.trim() === '') {
        showError('Please enter a bid amount');
        return;
    }
    
    if (isNaN(bidAmount) || bidAmount <= 0) {
        showError('Please enter a valid positive number');
        return;
    }
    
    const myCurrentContribution = getCurrentPlayerContribution();
    const additionalCost = bidAmount - myCurrentContribution;
    
    // Validate we're not reducing contribution
    if (bidAmount < myCurrentContribution) {
        showError(`You already contributed ${myCurrentContribution} coins. You cannot reduce your contribution to ${bidAmount}.`);
        return;
    }
    
    // Validate we can afford the additional cost
    if (additionalCost > currentPlayer.auctionCoins) {
        showError(`You need ${additionalCost} additional coins but only have ${currentPlayer.auctionCoins} available.`);
        return;
    }
    
    // Show what will happen
    const currentTeamBid = getCurrentTeamBid();
    const newTeamTotal = currentTeamBid - myCurrentContribution + bidAmount;
    const otherTeamBid = getOtherTeamBid();
    
    if (newTeamTotal <= otherTeamBid) {
        showError(`Your contribution of ${bidAmount} would make team total ${newTeamTotal}, but you need more than ${otherTeamBid} to outbid the other team.`);
        return;
    }
    
    console.log(`💰 Placing bid:`, {
        previousContribution: myCurrentContribution,
        newContribution: bidAmount,
        additionalCost,
        newTeamTotal,
        otherTeamBid
    });
    
    const bidBtn = document.getElementById('placeBidBtn');
    bidBtn.disabled = true;
    bidBtn.textContent = 'Bidding...';
    
    socket.emit('placeBid', { roomCode: gameState.roomCode, bidAmount: bidAmount });
    
    setTimeout(() => {
        bidBtn.disabled = false;
        bidBtn.textContent = 'Add to Team Bid';
        bidInput.value = '';
    }, 1000);
}

function getCurrentTeamBid() {
    const currentPlayer = gameState.players[gameState.currentPlayerId];
    if (!currentPlayer || !currentPlayer.team) return 0;
    
    const blueBidEl = document.getElementById('blueBidAmount');
    const redBidEl = document.getElementById('redBidAmount');
    
    if (currentPlayer.team === 'blue') {
        return parseInt(blueBidEl.textContent) || 0;
    } else {
        return parseInt(redBidEl.textContent) || 0;
    }
}

function getOtherTeamBid() {
    const currentPlayer = gameState.players[gameState.currentPlayerId];
    if (!currentPlayer || !currentPlayer.team) return 0;
    
    const blueBidEl = document.getElementById('blueBidAmount');
    const redBidEl = document.getElementById('redBidAmount');
    
    if (currentPlayer.team === 'blue') {
        return parseInt(redBidEl.textContent) || 0;
    } else {
        return parseInt(blueBidEl.textContent) || 0;
    }
}

function updateAuctionState(auctionData) {
    console.log('Auction update received:', auctionData);
    
    const titleEl = document.getElementById('auctionTitle');
    const progressEl = document.getElementById('auctionProgress');
    const timerEl = document.getElementById('auctionTimer');
    
    if (auctionData.type === 'championRevealed' || auctionData.type === 'bidPlaced' || auctionData.type === 'timerUpdate') {
        if (auctionData.currentChampion) {
            const championImageEl = document.getElementById('auctionChampionImage');
            const championNameEl = document.getElementById('auctionChampionName');
            
            championImageEl.src = `https://ddragon.leagueoflegends.com/cdn/${LATEST_VERSION}/img/champion/${auctionData.currentChampion.id}.png`;
            championNameEl.textContent = auctionData.currentChampion.name;
        }
        
        progressEl.textContent = `Champion ${auctionData.auctionIndex + 1} of ${auctionData.totalAuctions}`;
        
        timerEl.textContent = auctionData.auctionTimer;
        if (auctionData.auctionTimer <= 5) {
            timerEl.classList.add('urgent');
        } else {
            timerEl.classList.remove('urgent');
        }
        
        const blueBidEl = document.getElementById('blueBidAmount');
        const redBidEl = document.getElementById('redBidAmount');
        
        blueBidEl.textContent = auctionData.teamBids.blue.amount;
        redBidEl.textContent = auctionData.teamBids.red.amount;
        
        updatePlayerCoinsDisplay();
        
        // FIX 2: Remove bid input minimum restriction for team-based bidding
        const bidInput = document.getElementById('bidInput');
        const currentPlayer = gameState.players[gameState.currentPlayerId];
        
        if (bidInput && currentPlayer) {
            // Set minimum to 1 (any positive bid allowed)
            bidInput.min = 1;
            bidInput.placeholder = `Your bid (You have: ${currentPlayer.auctionCoins})`;
        }
        
        const yourBidSection = document.getElementById('yourBidSection');
        
        if (auctionData.auctionPhase === 'bidding' && currentPlayer && currentPlayer.team) {
            const teamPlayers = Object.values(gameState.players).filter(p => p.team === currentPlayer.team);
            const teamChampionCount = teamPlayers.filter(p => p.champion).length;
            
            console.log(`Team check: ${currentPlayer.team} has ${teamChampionCount}/${teamPlayers.length} champions`);
            
            if (teamChampionCount >= teamPlayers.length) {
                yourBidSection.style.display = 'none';
                
                let teamFullMsg = document.querySelector('.team-full-message');
                if (!teamFullMsg) {
                    teamFullMsg = document.createElement('div');
                    teamFullMsg.className = 'team-full-message';
                    teamFullMsg.style.color = '#f0ad4e';
                    teamFullMsg.style.textAlign = 'center';
                    teamFullMsg.style.padding = '10px';
                    teamFullMsg.style.background = 'rgba(240, 173, 78, 0.1)';
                    teamFullMsg.style.borderRadius = '8px';
                    teamFullMsg.style.margin = '10px 0';
                    document.querySelector('.current-auction').appendChild(teamFullMsg);
                }
                teamFullMsg.textContent = 'Your team is full - cannot bid on more champions';
            } else {
                yourBidSection.style.display = 'block';
                
                const existingMsg = document.querySelector('.team-full-message');
                if (existingMsg) existingMsg.remove();
            }
        } else {
            yourBidSection.style.display = 'none';
        }
        
    } else if (auctionData.type === 'auctionResolved') {
        titleEl.textContent = 'Auction Resolved!';
        
        addAuctionResult(auctionData);
        
        document.getElementById('yourBidSection').style.display = 'none';
        
        const existingMsg = document.querySelector('.team-full-message');
        if (existingMsg) existingMsg.remove();
        
    } else if (auctionData.type === 'auctionCompleted') {
        document.getElementById('currentAuction').style.display = 'none';
        document.getElementById('auctionCompleted').style.display = 'block';
        titleEl.textContent = 'Auction Complete!';
        
        console.log('Auction completed, auto-proceeding to game in 3 seconds...');
        setTimeout(() => {
            proceedToGame();
        }, 3000);
    }
}

function updatePlayerCoinsDisplay() {
    const currentPlayer = gameState.players[gameState.currentPlayerId];
    if (!currentPlayer) return;
    
    const yourCoinsEl = document.getElementById('yourCoins');
    const teamCoinsEl = document.getElementById('teamCoins');
    
    if (!yourCoinsEl || !teamCoinsEl) return;
    
    // Show individual player coins
    yourCoinsEl.textContent = currentPlayer.auctionCoins || 0;
    
    // Show team total coins (sum of all team members)
    const teamPlayers = Object.values(gameState.players).filter(p => p.team === currentPlayer.team);
    const totalTeamCoins = teamPlayers.reduce((sum, p) => sum + (p.auctionCoins || 0), 0);
    teamCoinsEl.textContent = totalTeamCoins;
    
    // Update bid input limits based on INDIVIDUAL player coins
    const bidInput = document.getElementById('bidInput');
    if (bidInput) {
        bidInput.max = currentPlayer.auctionCoins; // Individual limit
        bidInput.placeholder = `Your bid (You have: ${currentPlayer.auctionCoins})`;
    }
    
    console.log(`💰 Your coins: ${currentPlayer.auctionCoins}, Team total available: ${totalTeamCoins}`);
    
    // Show team breakdown in console for debugging
    if (teamPlayers.length > 1) {
        console.log(`💳 Team breakdown:`, teamPlayers.map(p => `${p.name}: ${p.auctionCoins}`));
    }
}

function addAuctionResult(auctionData) {
    const resultsList = document.getElementById('resultsList');
    
    // Find the latest result
    const latestResult = auctionData.auctionResults[auctionData.auctionResults.length - 1];
    if (!latestResult) return;
    
    const resultItem = document.createElement('div');
    resultItem.className = 'result-item';
    
    if (latestResult.winningTeam === 'blue') {
        resultItem.classList.add('blue-won');
    } else if (latestResult.winningTeam === 'red') {
        resultItem.classList.add('red-won');
    } else {
        resultItem.classList.add('no-winner');
    }
    
    const winnerText = latestResult.winningTeam 
        ? `${latestResult.winningTeam.toUpperCase()} - ${latestResult.winningBid} coins`
        : 'No bids';
    
    resultItem.innerHTML = `
        <span class="result-champion">${latestResult.champion.name}</span>
        <span class="result-winner">${winnerText}</span>
    `;
    
    resultsList.appendChild(resultItem);
    
    // Scroll to bottom
    document.querySelector('.auction-results').scrollTop = document.querySelector('.auction-results').scrollHeight;
}

function resetAuctionUI() {
    console.log('Resetting auction UI...');
    
    // Reset bid input
    const bidInput = document.getElementById('bidInput');
    if (bidInput) {
        bidInput.value = '';
        bidInput.min = 1;
        bidInput.max = 999;
        bidInput.placeholder = 'Enter bid';
    }
    
    // Reset bid button
    const bidBtn = document.getElementById('placeBidBtn');
    if (bidBtn) {
        bidBtn.disabled = false;
        bidBtn.textContent = 'Place Bid';
    }
    
    // Reset team bids display
    const blueBidEl = document.getElementById('blueBidAmount');
    const redBidEl = document.getElementById('redBidAmount');
    if (blueBidEl) blueBidEl.textContent = '0';
    if (redBidEl) redBidEl.textContent = '0';
    
    // Remove any team full messages
    const teamFullMsg = document.querySelector('.team-full-message');
    if (teamFullMsg) teamFullMsg.remove();
    
    console.log('Auction UI reset complete');
}

// Update the proceedToGame function to include reset
function proceedToGame() {
    console.log('Proceeding from auction to main game interface...');
    
    // Reset auction UI first
    resetAuctionUI();
    
    // Hide auction section
    document.getElementById('auctionSection').classList.add('hidden');
    
    // Show main game interface
    showGameInterface();
    
    // Force refresh the display to show updated champions
    updateDisplay();
    
    console.log('Game interface shown, champions should now be visible for trading/locking');
}

function testTradePopup() {
    console.log('🧪 Testing trade popup manually...');
    
    const testTradeData = {
        fromPlayer: 'TestPlayer',
        fromChampion: { name: 'TestChampion1' },
        toChampion: { name: 'TestChampion2' }
    };
    
    showTradeRequest(testTradeData);
}

// Add this to window for debugging
if (typeof window !== 'undefined') {
    window.debugTrade = {
        testTradePopup,
        showTradeRequest,
        elements: () => elements,
        gameState: () => gameState
    };
}
