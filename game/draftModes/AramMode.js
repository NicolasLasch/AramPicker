class AramMode {
    static getSettings() {
        return {
            name: 'Classic ARAM',
            description: 'Random champion with reroll tokens',
            hasRerollTokens: true,
            hasCardPick: false,
            timerDuration: 90
        };
    }

    static initializePlayer(player, settings) {
        player.rerollTokens = settings.rerollTokens || 2;
        player.cardOptions = null;
        player.hasPicked = false;
    }

    static async assignChampions(gameRoom) {
        return gameRoom.assignRandomChampions();
    }
}

module.exports = AramMode;