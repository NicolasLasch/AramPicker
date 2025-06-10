class TwoCardPickMode {
    static getSettings() {
        return {
            name: 'Two Card Pick',
            description: 'Choose between 2 random champions',
            hasRerollTokens: false,
            hasCardPick: true,
            timerDuration: 60
        };
    }

    static initializePlayer(player, settings) {
        player.rerollTokens = 0;
        player.cardOptions = [];
        player.hasPicked = false;
        player.champion = null; // Don't assign champion yet
        console.log(`Initialized ${player.name} for two-card-pick mode`);
    }

    static async assignChampions(gameRoom) {
        console.log('TwoCardPickMode: assigning card options instead of champions');
        return gameRoom.assignCardOptions();
    }

    static canReroll(player) {
        return false; // No rerolls in this mode
    }

    static canPickCard(player) {
        return !player.hasPicked && player.cardOptions && player.cardOptions.length === 2;
    }
}

module.exports = TwoCardPickMode;