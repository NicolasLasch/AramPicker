class Player {
    constructor(socketId, name, socket = null) {
        if (!socketId || !name) {
            throw new Error('Socket ID and name are required');
        }
        
        this.socketId = socketId;
        this.name = name.trim();
        this.socket = socket;
        this.team = null;
        this.champion = null;
        this.rerollTokens = 1;
        this.locked = false;
        this.ready = false;
        this.joinedAt = Date.now();
        
        console.log(`Player created: ${this.name} (${this.socketId})`);
    }

    setTeam(team) {
        if (team !== 'blue' && team !== 'red' && team !== null) {
            throw new Error('Invalid team');
        }
        this.team = team;
    }

    setChampion(champion) {
        this.champion = champion;
    }

    useReroll() {
        if (this.rerollTokens <= 0) {
            throw new Error('No reroll tokens available');
        }
        this.rerollTokens--;
    }

    lock() {
        if (!this.champion) {
            throw new Error('Cannot lock without a champion');
        }
        this.locked = true;
    }

    unlock() {
        this.locked = false;
    }

    canTrade() {
        return this.champion && !this.locked && this.team;
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
            joinedAt: this.joinedAt
        };
    }
}

module.exports = Player;