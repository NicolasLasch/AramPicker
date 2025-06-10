class MemoryPickMode {
    static getSettings() {
        return {
            name: 'Memory Pick',
            description: 'See 5 champions, watch them shuffle, then pick one by memory',
            hasRerollTokens: false,
            hasCardPick: true,
            timerDuration: 90
        };
    }

    static initializePlayer(player, settings) {
        player.rerollTokens = 0;
        player.cardOptions = [];
        player.memoryCards = [];
        player.shuffledPositions = [];
        player.hasMemoryPicked = false;
        player.memoryPhase = 'reveal'; 
        player.champion = null;
        console.log(`Initialized ${player.name} for memory-pick mode`);
    }

    static async assignChampions(gameRoom) {
        console.log('MemoryPickMode: assigning 5 memory cards to each player');
        return gameRoom.assignMemoryCards();
    }

    static canReroll(player) {
        return false;
    }

    static canPickCard(player) {
        return !player.hasMemoryPicked && player.memoryPhase === 'pick';
    }
}

module.exports = MemoryPickMode;