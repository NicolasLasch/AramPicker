const sqlite3 = require('sqlite3').verbose();
const path = require('path');

async function getAllChampionsFromRiot() {
    try {
        const https = require('https');
        
        console.log('🔍 Fetching latest Data Dragon version...');
        const latestVersion = await new Promise((resolve, reject) => {
            const req = https.get('https://ddragon.leagueoflegends.com/api/versions.json', (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const versions = JSON.parse(data);
                        resolve(versions[0]); 
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

        console.log(`✅ Latest Data Dragon version: ${latestVersion}`);
        
        // Get champion data using latest version
        const championData = await new Promise((resolve, reject) => {
            const url = `https://ddragon.leagueoflegends.com/cdn/${latestVersion}/data/en_US/champion.json`;
            console.log(`🔍 Fetching champions from: ${url}`);
            
            const req = https.get(url, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            req.on('error', reject);
            req.setTimeout(10000, () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });
        });

        if (championData.data) {
            const champions = Object.values(championData.data).map(champ => ({
                id: champ.id,
                name: champ.name,
                title: champ.title,
                key: champ.key
            }));
            
            console.log(`✅ Loaded ${champions.length} champions from Data Dragon ${latestVersion}`);
            console.log(`📋 Latest 5 champions: ${champions.slice(-5).map(c => c.name)}`);
            console.log(`📋 First 5 champions: ${champions.slice(0, 5).map(c => c.name)}`);
            
            return champions;
        }
        
        return [];
    } catch (error) {
        console.error('❌ Error fetching champions from Riot API:', error);
        
        // Fallback to hardcoded version if API fails
        console.log('⚠️  Falling back to version 14.1.1...');
        return await getFallbackChampions();
    }
}

async function getFallbackChampions() {
    try {
        const https = require('https');
        
        const championData = await new Promise((resolve, reject) => {
            const req = https.get('https://ddragon.leagueoflegends.com/cdn/14.1.1/data/en_US/champion.json', (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
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
            const champions = Object.values(championData.data).map(champ => ({
                id: champ.id,
                name: champ.name,
                title: champ.title,
                key: champ.key
            }));
            
            console.log(`⚠️  Fallback: Loaded ${champions.length} champions from 14.1.1`);
            return champions;
        }
        
        return [];
    } catch (error) {
        console.error('❌ Fallback also failed:', error);
        return [];
    }
}

class ChampionPoolDatabase {
    constructor() {
        this.dbPath = path.join(__dirname, 'champion_pools.db');
        this.db = null;
        this.initializeDatabase();
    }

    initializeDatabase() {
        this.db = new sqlite3.Database(this.dbPath, (err) => {
            if (err) {
                console.error('Error opening database:', err);
                throw err;
            }
            console.log('Connected to SQLite database');
        });

        this.createTables();
    }

    createTables() {
        const createUsersTable = `
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                puuid TEXT UNIQUE NOT NULL,
                summoner_name TEXT NOT NULL,
                region TEXT NOT NULL,
                last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `;

        const createChampionPoolsTable = `
            CREATE TABLE IF NOT EXISTS champion_pools (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                champion_name TEXT NOT NULL,
                champion_id TEXT NOT NULL,
                is_owned INTEGER DEFAULT 1,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id),
                UNIQUE(user_id, champion_name)
            )
        `;

        this.db.serialize(() => {
            this.db.run(createUsersTable, (err) => {
                if (err) console.error('Error creating users table:', err);
                else console.log('Users table ready');
            });

            this.db.run(createChampionPoolsTable, (err) => {
                if (err) console.error('Error creating champion_pools table:', err);
                else console.log('Champion pools table ready');
            });
        });
    }

    async saveUser(puuid, summonerName, region) {
        return new Promise((resolve, reject) => {
            // First, try to get existing user
            this.db.get('SELECT id FROM users WHERE puuid = ?', [puuid], (err, existingUser) => {
                if (err) {
                    console.error('Error checking for existing user:', err);
                    reject(err);
                    return;
                }

                if (existingUser) {
                    // Update existing user
                    console.log(`Updating existing user ID ${existingUser.id} for PUUID ${puuid}`);
                    const updateQuery = `
                        UPDATE users 
                        SET summoner_name = ?, region = ?, last_updated = CURRENT_TIMESTAMP
                        WHERE puuid = ?
                    `;
                    
                    this.db.run(updateQuery, [summonerName, region, puuid], function(err) {
                        if (err) {
                            console.error('Error updating user:', err);
                            reject(err);
                        } else {
                            console.log(`✅ Updated user ID ${existingUser.id}`);
                            resolve(existingUser.id);
                        }
                    });
                } else {
                    // Create new user
                    console.log(`Creating new user for PUUID ${puuid}`);
                    const insertQuery = `
                        INSERT INTO users (puuid, summoner_name, region, last_updated)
                        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                    `;
                    
                    this.db.run(insertQuery, [puuid, summonerName, region], function(err) {
                        if (err) {
                            console.error('Error creating user:', err);
                            reject(err);
                        } else {
                            console.log(`✅ Created new user ID ${this.lastID}`);
                            resolve(this.lastID);
                        }
                    });
                }
            });
        });
    }

    async getUser(puuid) {
        return new Promise((resolve, reject) => {
            const query = 'SELECT * FROM users WHERE puuid = ?';
            
            this.db.get(query, [puuid], (err, row) => {
                if (err) {
                    console.error('Error getting user:', err);
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    async saveChampionPool(userId, championPool) {
        return new Promise((resolve, reject) => {
            console.log(`\n🔄 Saving champion pool for user ID ${userId}`);
            
            this.db.serialize(() => {
                this.db.run('BEGIN TRANSACTION');

                // Delete existing pool for this user
                this.db.run('DELETE FROM champion_pools WHERE user_id = ?', [userId], (err) => {
                    if (err) {
                        console.error('❌ Error deleting old champion pool:', err);
                        this.db.run('ROLLBACK');
                        reject(err);
                        return;
                    }
                    console.log(`🗑️  Deleted old champion pool for user ${userId}`);
                });

                const insertQuery = `
                    INSERT INTO champion_pools (user_id, champion_name, champion_id, is_owned)
                    VALUES (?, ?, ?, 1)
                `;

                let completed = 0;
                let hasError = false;

                if (championPool.length === 0) {
                    this.db.run('COMMIT', (err) => {
                        if (err) {
                            console.error('❌ Error committing empty pool:', err);
                            reject(err);
                        } else {
                            console.log('✅ Saved empty champion pool');
                            resolve(true);
                        }
                    });
                    return;
                }

                console.log(`📝 Inserting ${championPool.length} champions for user ${userId}`);

                championPool.forEach((champion, index) => {
                    this.db.run(insertQuery, [userId, champion.name, champion.id], (err) => {
                        if (err && !hasError) {
                            hasError = true;
                            console.error(`❌ Error inserting champion ${champion.name}:`, err);
                            this.db.run('ROLLBACK');
                            reject(err);
                            return;
                        }

                        if (!hasError) {
                            completed++;
                            
                            if (completed === championPool.length) {
                                this.db.run('COMMIT', (err) => {
                                    if (err) {
                                        console.error('❌ Error committing transaction:', err);
                                        reject(err);
                                    } else {
                                        console.log(`✅ Successfully saved ${completed} champions for user ${userId}\n`);
                                        resolve(true);
                                    }
                                });
                            }
                        }
                    });
                });
            });
        });
    }

    async getChampionPool(puuid) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT cp.champion_name, cp.champion_id
                FROM champion_pools cp
                JOIN users u ON cp.user_id = u.id
                WHERE u.puuid = ? AND cp.is_owned = 1
                ORDER BY cp.champion_name
            `;
            
            this.db.all(query, [puuid], (err, rows) => {
                if (err) {
                    console.error('Error getting champion pool:', err);
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });
    }

    async getChampionPoolNames(puuid) {
        const pool = await this.getChampionPool(puuid);
        return pool.map(champion => champion.champion_name);
    }

    close() {
        if (this.db) {
            this.db.close((err) => {
                if (err) console.error('Error closing database:', err);
                else console.log('Database connection closed');
            });
        }
    }
}

module.exports = { ChampionPoolDatabase, getAllChampionsFromRiot };