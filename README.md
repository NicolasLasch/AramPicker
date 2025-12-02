# Custom Drafting System - League of Legends ARAM Enhanced

A real-time multiplayer web application that transforms ARAM gameplay with strategic draft modes, Riot API integration, and live performance tracking.

![Tech Stack](https://img.shields.io/badge/Node.js-339933?style=flat&logo=nodedotjs&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-010101?style=flat&logo=socketdotio&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat&logo=sqlite&logoColor=white)

## 🎮 Overview

Built for competitive League of Legends players who want more control over ARAM champion selection. Handles 10-player concurrent games with <100ms latency, integrates with Riot Games API for live champion pools, and persists user data across sessions.

---

## ✨ Core Features

### Four Draft Modes
- **Classic ARAM**: Random with reroll tokens
- **Two-Card Pick**: Choose between 2 champions, rejected card goes to team bench
- **Memory Pick**: Memorize 5 champions → watch shuffle → pick from memory
- **Auction Mode**: Team-based bidding (20 coins/player) with live competitive bidding

### Riot API Integration
- Real-time ARAM winrate calculation per champion
- Smart champion pool estimation based on summoner level + mastery data
- Persistent storage with SQLite for offline access

### Real-Time Multiplayer
- Socket.IO architecture for instant game state sync
- Personalized views (opponents' champions hidden until lock-in)
- Live trading system between teammates
- Session persistence with reconnection support

---

## 🏗️ System Architecture

```
┌─────────────┐         WebSocket          ┌──────────────┐
│   Clients   │◄─────────────────────────►│   Server     │
│  (10 max)   │      Socket.IO Events      │  (Node.js)   │
└─────────────┘                            └──────┬───────┘
                                                  │
                                    ┌─────────────┼─────────────┐
                                    │             │             │
                              ┌─────▼────┐  ┌────▼─────┐  ┌───▼────┐
                              │ GameRoom │  │  SQLite  │  │  Riot  │
                              │  Manager │  │ Database │  │  API   │
                              └──────────┘  └──────────┘  └────────┘
```

### Room-Based Game Management
- Each room: isolated game state with 6-char code
- Mode-specific champion assignment algorithms
- Timer orchestration (90s main, 20s auction rounds)
- Auto-cleanup for abandoned rooms (5min interval)

### Data Flow
```javascript
Client Action → Socket Event → Server Validation → GameRoom Update → 
Broadcast Personalized States → Database Sync (if needed)
```

---

## 🔧 Technical Implementation

### Backend Stack
```javascript
Node.js + Express.js
├── Socket.IO          
├── SQLite3           
├── Riot Games API    
└── Custom GameRoom    
```

**Key Design Patterns**:
- **Factory Pattern**: Dynamic draft mode instantiation (`AramMode`, `AuctionMode`, etc.)
- **Observer Pattern**: Socket.IO event-driven state updates
- **Strategy Pattern**: Mode-specific champion assignment logic

### Frontend Stack
```javascript
Vanilla JavaScript (ES6+)
├── Socket.IO Client  
├── Fetch API        
└── CSS Glassmorphism  
```

**Performance Optimizations**:
- Personalized game states (each player only receives relevant data)
- Local caching of Data Dragon champion assets
- Debounced search for 166-champion grid

### Database Schema
```sql
users (id, puuid, summoner_name, region, last_updated)
champion_pools (user_id, champion_name, champion_id, is_owned)
  UNIQUE(user_id, champion_name)
```

---

## 🔒 Security & Privacy

### API Key Management
- Server-side only (never exposed to client)
- Rate limiting with exponential backoff (100ms delays)
- Graceful degradation on API failures

### User Privacy
- PUUID-based identification (no passwords)
- Champion pools stored locally, user controls sync
- Temporary PUUIDs for unlinked accounts
- No chat logs or personal data retention

### Socket Security
```javascript
// CORS configuration
origin: process.env.RENDER_EXTERNAL_URL || "http://localhost:3000"
credentials: true

// Input validation on all events
if (!playerName || playerName.trim() === '' || playerName === 'undefined') {
  throw new Error('Invalid player name');
}
```

---

## 🎨 UI/UX Highlights

### Glassmorphism Design System
- `backdrop-filter: blur(24px)` with RGBA overlays
- Gradient accents (Blue `#3b82f6`, Purple `#8b5cf6`, Gold `#f59e0b`)
- Smooth transitions with cubic-bezier easing

### Key Interactions
- **Card Flip**: 3D rotateY(180deg) for Two-Card Pick
- **Shuffle Animation**: 6-second choreographed center-stack motion
- **Live Auction**: Real-time bid updates with color-coded team displays
- **Responsive Grid**: CSS Grid with `auto-fill minmax(120px, 1fr)`

---

## 🚀 Deployment

**Platform**: Render.com (Automatic HTTPS + WebSocket support)

**Environment Variables**:
```bash
RIOT_API_KEY=RGAPI-xxxxx
RENDER_EXTERNAL_URL=https://aramchampionselector.onrender.com
PORT=3000
```

**Database**: SQLite file persisted on `/data` mount

---

## 📊 Performance Metrics

| Metric | Value |
|--------|-------|
| WebSocket Latency | <100ms (10 players) |
| Champion Load Time | <2s (Data Dragon CDN) |
| Database Query Speed | <50ms (indexed PUUID) |
| Concurrent Rooms Tested | 20+ simultaneous games |
| Memory per Room | ~50MB |

---

## 🛠️ Local Development

```bash
# Clone repository
git clone https://github.com/yourusername/aram-drafting-system.git

# Install dependencies
npm install

# Set environment variables
echo "RIOT_API_KEY=your_key_here" > .env

# Run server
node server.js

# Visit http://localhost:3000
```

**Requirements**: Node.js 16+, Riot Games API key

---

## 🎯 Key Challenges Solved

1. **Real-Time State Sync**: Personalized game states prevent cheating while maintaining <100ms latency
2. **Champion Pool Accuracy**: 3-tier fallback (Database → Riot API → Smart Estimation)
3. **Team Bidding Logic**: Individual contribution tracking within shared team pool
4. **Memory Card Shuffle**: Position mapping with animated card transitions
5. **Session Persistence**: Socket ID remapping on reconnection

---

## 🔮 Future Enhancements

- [ ] MMR-based team balancing
- [ ] Post-game detailed analytics dashboard
- [ ] Custom draft mode builder (user-defined rules)
- [ ] Tournament bracket system
- [ ] Discord bot integration

---

**Built with**: Node.js, Express, Socket.IO, SQLite, Riot Games API, Vanilla JavaScript, CSS3

**Author**: Nicolas Huart | [Portfolio](https://your-portfolio.com) | [LinkedIn](https://linkedin.com/in/yourprofile)
