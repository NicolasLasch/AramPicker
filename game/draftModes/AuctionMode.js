class AuctionMode {
    static getSettings() {
        return {
            name: 'Auction Mode',
            description: 'Bid on champions with your team (20 coins per player)',
            hasRerollTokens: false,
            hasCardPick: false,
            hasAuction: true,
            timerDuration: 20
        };
    }

    static initializePlayer(player, settings) {
        player.rerollTokens = 0;
        player.cardOptions = [];
        player.auctionCoins = 20;
        player.currentBid = 0;
        player.hasAuctionChampion = false;
        player.champion = null;
        console.log(`Initialized ${player.name} for auction mode with 20 coins`);
    }

    static async assignChampions(gameRoom) {
        console.log('AuctionMode: setting up auction pool and starting auction');
        return gameRoom.setupAuctionPool();
    }

    static canReroll(player) {
        return false;
    }

    static canPickCard(player) {
        return false;
    }

    static canBid(player, gameRoom) {
        return gameRoom.auctionPhase === 'bidding' && !player.hasAuctionChampion;
    }
}

module.exports = AuctionMode;