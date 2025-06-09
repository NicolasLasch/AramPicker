class Player {
    constructor(socketId, name, socket = null) {
        if (!socketId) {
            throw new Error('Socket ID is required for player creation');
        }
        
        if (!name || typeof name !== 'string' || name.trim() === '') {
            console.error('Invalid player name:', name, typeof name);
            throw new Error(`Invalid player name: "${name}". Name must be a non-empty string.`);
        }
        
        this.socketId = socketId;
        this.name = name.trim();
        this.socket = socket;
        this.team = null;
        this.champion = null;
        this.rerollTokens = 1;
        this.locked = false;
        this.ready = false;
        this.championPool = null;
        this.joinedAt = Date.now();
        
        console.log(`Player created successfully: "${this.name}" (${this.socketId})`);
    }

    setChampionPool(championIds) {
        this.championPool = championIds;
        if (championIds && Array.isArray(championIds)) {
            console.log(`Set champion pool for ${this.name}: ${championIds.length} champions`);
        } else {
            console.log(`${this.name} using all champions (no pool restriction)`);
        }
    }

    hasChampion(championId) {
        if (!this.championPool || !Array.isArray(this.championPool)) {
            return true; // No restriction - has all champions
        }
        return this.championPool.includes(championId);
    }

    toJSON() {
        return {
            socketId: this.socketId,
            name: this.name,
            team: this.team,
            champion: this.champion,
            rerollTokens: this.rerollTokens,
            locked: this.locked,
            ready: this.ready,
            championPoolSize: this.championPool ? this.championPool.length : 'all',
            joinedAt: this.joinedAt
        };
    }
}

module.exports = Player;