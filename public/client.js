const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const socketUrl = isDevelopment ? 'http://localhost:3000' : window.location.origin;
const socket = io(socketUrl, {
    transports: ['websocket', 'polling'],
    upgrade: true,
    rememberUpgrade: true
});

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
        console.log('Received game state update');
        console.log('Current player team:', gameState.players[gameState.currentPlayerId]?.team);
        console.log('Bench data received:', newGameState.bench);
        console.log('Bench length:', newGameState.bench?.length);
        
        updateGameState(newGameState);
        saveGameSession();
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
        showTradeRequest(tradeData);
    });

    socket.on('error', (message) => {
        showError(message);
    });

    socket.on('riotAccountLinked', (data) => {
        const statusDiv = document.getElementById('linkingStatus');
        
        if (data.success) {
            console.log('Riot account linked successfully:', data.championPool);
            
            statusDiv.innerHTML = `<span style="color: #5cb85c;">✅ ${data.message}</span>`;
            
            const pendingAction = gameState.pendingAction;
            
            setTimeout(() => {
                document.querySelector('.riot-account-modal').remove();
                
                // Use Riot summoner name, with fallbacks
                let playerName = data.championPool?.summonerName;
                
                // Fallback chain if summonerName is undefined
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
                        championPool: data.championPool?.championIds || []
                    });
                } else {
                    socket.emit('joinRoom', { 
                        roomCode: pendingAction.roomCode,
                        playerName: playerName,
                        championPool: data.championPool?.championIds || []
                    });
                }
                
                // Clear pending action
                gameState.pendingAction = null;
            }, 1500);
            
        } else {
            statusDiv.innerHTML = `<span style="color: #d9534f;">❌ ${data.error}</span>`;
        }
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
    socket.emit('startGame', gameState.roomCode);
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
    socket.emit('offerTrade', { roomCode: gameState.roomCode, targetPlayerId: targetPlayerId });
}

function acceptTrade() {
    socket.emit('respondToTrade', { roomCode: gameState.roomCode, accepted: true });
    elements.tradeRequest.classList.add('hidden');
}

function declineTrade() {
    socket.emit('respondToTrade', { roomCode: gameState.roomCode, accepted: false });
    elements.tradeRequest.classList.add('hidden');
}

function updateGameState(newGameState) {
    gameState = { ...gameState, ...newGameState };
}

function showLobby() {
    elements.mainMenu.classList.add('hidden');
    elements.lobbyScreen.classList.remove('hidden');
    elements.gameInterface.classList.add('hidden');
    
    elements.displayRoomCode.textContent = gameState.roomCode;
    
    if (gameState.isHost) {
        elements.startGameBtn.classList.remove('hidden');
    }
    
    updateLobbyDisplay();
}

function showGameInterface() {
    elements.mainMenu.classList.add('hidden');
    elements.lobbyScreen.classList.add('hidden');
    elements.gameInterface.classList.remove('hidden');
    
    updateDisplay();
}

function updateDisplay() {
    if (gameState.gamePhase === 'lobby') {
        updateLobbyDisplay();
    } else if (gameState.gamePhase === 'champion-select') {
        updateGameDisplay();
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
    const allPlayersLocked = Object.values(gameState.players)
        .filter(p => p.team)
        .every(p => p.locked);
    
    const timerEnded = gameState.timer <= 0;
    
    if (allPlayersLocked || timerEnded) {
        elements.phaseIndicator.textContent = 'Champion Select Complete!';
        elements.timer.textContent = 'READY';
    } else {
        elements.phaseIndicator.textContent = 'Champion Select Phase';
        elements.timer.textContent = gameState.timer;
    }
    
    updateTeamDisplay('blue');
    updateTeamDisplay('red');
    updateBenchDisplay();
}

function updateTeamDisplay(team) {
    const container = team === 'blue' ? elements.blueTeam : elements.redTeam;
    const teamPlayers = Object.values(gameState.players).filter(p => p.team === team);
    
    container.innerHTML = '';
    teamPlayers.forEach(player => {
        const slot = createPlayerSlot(player);
        container.appendChild(slot);
    });
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
            // Could implement unselect functionality here
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
    slot.appendChild(portrait);
    slot.appendChild(info);

    return slot;
}

function createPlayerControls(player) {
    const controls = document.createElement('div');
    controls.className = 'player-controls';

    const rerollBtn = document.createElement('button');
    rerollBtn.className = 'control-btn';
    rerollBtn.textContent = `Reroll (${player.rerollTokens})`;
    rerollBtn.disabled = player.rerollTokens <= 0 || !player.champion;
    rerollBtn.onclick = () => rerollChampion();

    const lockBtn = document.createElement('button');
    lockBtn.className = 'control-btn';
    lockBtn.textContent = 'Lock In';
    lockBtn.disabled = !player.champion;
    lockBtn.onclick = () => lockChampion();

    controls.appendChild(rerollBtn);
    controls.appendChild(lockBtn);

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
    }

    const teammates = Object.values(gameState.players).filter(p => 
        p.team === player.team && 
        p.id !== player.id && 
        p.champion && 
        player.champion &&
        !p.locked && 
        !player.locked
    );

    teammates.forEach(teammate => {
        const tradeBtn = document.createElement('button');
        tradeBtn.className = 'control-btn';
        tradeBtn.textContent = `Trade ${teammate.name}`;
        tradeBtn.onclick = () => offerTrade(teammate.id);
        controls.appendChild(tradeBtn);
    });

    return controls;
}

function createChampionPortrait(champion, onClick) {
    const portrait = document.createElement('div');
    portrait.className = 'champion-portrait';
    if (onClick) portrait.addEventListener('click', onClick);
    
    if (champion) {
        const img = document.createElement('img');
        img.src = `https://ddragon.leagueoflegends.com/cdn/13.24.1/img/champion/${champion.id}.png`;
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
    img.src = `https://ddragon.leagueoflegends.com/cdn/13.24.1/img/champion/${champion.id}.png`;
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
        card.addEventListener('click', () => swapWithBench(champion.id));
        card.style.cursor = 'pointer';
    } else {
        card.style.cursor = 'not-allowed';
        card.style.opacity = '0.5';
    }
    
    return card;
}

function showTradeRequest(tradeData) {
    elements.tradeMessage.textContent = 
        `${tradeData.fromPlayer} wants to trade ${tradeData.fromChampion.name} for your ${tradeData.toChampion.name}`;
    elements.tradeRequest.classList.remove('hidden');
}

function showGameComplete() {
    const blueTeam = Object.values(gameState.players).filter(p => p.team === 'blue');
    const redTeam = Object.values(gameState.players).filter(p => p.team === 'red');
    
    let summary = '';
    
    if (blueTeam.length > 0) {
        summary += '<div class="team-result blue"><h4>Blue Team:</h4>';
        blueTeam.forEach(p => {
            const champImage = p.champion ? 
                `<img src="https://ddragon.leagueoflegends.com/cdn/13.24.1/img/champion/${p.champion.id}.png" 
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
                `<img src="https://ddragon.leagueoflegends.com/cdn/13.24.1/img/champion/${p.champion.id}.png" 
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
        pendingTrade: null
    };
    
    // Clear input fields
    elements.playerName.value = '';
    elements.joinPlayerName.value = '';
    elements.roomCode.value = '';
}

// Initialize everything when the page loads
document.addEventListener('DOMContentLoaded', () => {
    initializeElements();
    setupEventListeners();
    setupSocketListeners();
    
    elements.connectionStatus.textContent = 'Connecting...';
    elements.connectionStatus.className = 'connection-status connecting';
    
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
                <button class="menu-button" onclick="linkAndProceed('${action}', '${playerName}', '${roomCode || ''}')">Link & ${action === 'create' ? 'Create Room' : 'Join Room'}</button>
                <button class="menu-button decline-btn" onclick="skipAndProceed('${action}', '${playerName}', '${roomCode || ''}')">Skip (Use All Champions)</button>
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
            championPool: null // null means use all champions
        });
    }
}

// Updated Riot account response handler
socket.on('riotAccountLinked', (data) => {
    const statusDiv = document.getElementById('linkingStatus');
    
    if (data.success) {
        statusDiv.innerHTML = `<span style="color: #5cb85c;">✅ ${data.message}</span>`;
        
        const pendingAction = gameState.pendingAction;
        
        setTimeout(() => {
            document.querySelector('.riot-account-modal').remove();
            
            // Use Riot summoner name instead of entered name
            const riotName = data.championPool.summonerName;
            
            if (pendingAction.action === 'create') {
                socket.emit('createRoom', { 
                    playerName: riotName,
                    championPool: data.championPool.championIds
                });
            } else {
                socket.emit('joinRoom', { 
                    roomCode: pendingAction.roomCode,
                    playerName: riotName,
                    championPool: data.championPool.championIds
                });
            }
            
            // Clear pending action
            gameState.pendingAction = null;
        }, 1500);
        
    } else {
        statusDiv.innerHTML = `<span style="color: #d9534f;">❌ ${data.error}</span>`;
    }
});