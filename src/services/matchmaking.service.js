const http = require('http');
const url = require('url');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class Logger {
    static info(message, meta = {}) {
        const timestamp = new Date().toISOString();
        console.log(`[INFO] [${timestamp}] ${message}`, Object.keys(meta).length ? JSON.stringify(meta) : '');
    }
    static error(message, err = {}) {
        const timestamp = new Date().toISOString();
        console.error(`[ERROR] [${timestamp}] ${message}`, err.stack || err);
    }
    static warn(message, meta = {}) {
        const timestamp = new Date().toISOString();
        console.warn(`[WARN] [${timestamp}] ${message}`, Object.keys(meta).length ? JSON.stringify(meta) : '');
    }
    static debug(message, meta = {}) {
        if (process.env.DEBUG) {
            const timestamp = new Date().toISOString();
            console.debug(`[DEBUG] [${timestamp}] ${message}`, Object.keys(meta).length ? JSON.stringify(meta) : '');
        }
    }
}

class DatabaseSimulator {
    constructor() {
        this.users = new Map();
        this.sessions = new Map();
        this.playerStats = new Map();
        this.matchHistory = [];
        this.guilds = new Map();
        this.reports = [];
        this.items = new Map();
        this.inventory = new Map();
        this.initDefaultData();
    }

    initDefaultData() {
        for (let i = 1; i <= 50; i++) {
            const id = `bot_user_${i}`;
            this.users.set(id, {
                id,
                username: `BotPlayer_${i}`,
                email: `bot${i}@hsho.internal`,
                passwordHash: crypto.createHash('sha256').update(`password${i}`).digest('hex'),
                createdAt: Date.now() - Math.floor(Math.random() * 1000000000),
                banned: false,
                role: 'player'
            });
            this.playerStats.set(id, {
                playerId: id,
                rating: 1000 + Math.floor(Math.random() * 500) - 250,
                matchesPlayed: Math.floor(Math.random() * 50),
                matchesWon: Math.floor(Math.random() * 25),
                kills: Math.floor(Math.random() * 100),
                deaths: Math.floor(Math.random() * 100),
                survived: Math.floor(Math.random() * 30),
                level: Math.floor(Math.random() * 20) + 1,
                exp: Math.floor(Math.random() * 5000)
            });
        }
        Logger.info(`Database simulator initialized with ${this.users.size} mock user records.`);
    }

    getUser(id) {
        return this.users.get(id);
    }

    addUser(user) {
        this.users.set(user.id, user);
        this.playerStats.set(user.id, {
            playerId: user.id,
            rating: 1000,
            matchesPlayed: 0,
            matchesWon: 0,
            kills: 0,
            deaths: 0,
            survived: 0,
            level: 1,
            exp: 0
        });
    }

    getStats(id) {
        return this.playerStats.get(id);
    }

    updateStats(id, updater) {
        const stats = this.playerStats.get(id);
        if (stats) {
            Object.assign(stats, updater(stats));
            this.playerStats.set(id, stats);
        }
    }

    saveMatch(match) {
        this.matchHistory.push(match);
        if (this.matchHistory.length > 1000) {
            this.matchHistory.shift();
        }
    }
}

const db = new DatabaseSimulator();

class ConfigManager {
    constructor() {
        this.settings = {
            port: process.env.PORT || 3000,
            host: process.env.HOST || '0.0.0.0',
            jwtSecret: process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex'),
            matchmaking: {
                maxQueueSize: 5000,
                searchIntervalMs: 1000,
                ratingToleranceStep: 50,
                maxRatingTolerance: 400,
                partyMaxCapacity: 4,
                teamSize: 4,
                matchTimeoutMs: 30000,
                regionDefaults: ['Asia', 'NA', 'EU']
            },
            serverNode: {
                basePort: 7700,
                maxInstances: 50,
                heartbeatIntervalMs: 5000,
                timeoutThresholdMs: 15000
            },
            antiCheat: {
                maxSpeedLimit: 15.5,
                positionDeltaThreshold: 50.0,
                actionRateLimitMs: 100
            }
        };
    }

    get(keyPath) {
        return keyPath.split('.').reduce((obj, key) => (obj && obj[key] !== undefined) ? obj[key] : undefined, this.settings);
    }

    set(keyPath, value) {
        const keys = keyPath.split('.');
        let obj = this.settings;
        for (let i = 0; i < keys.length - 1; i++) {
            if (!obj[keys[i]]) obj[keys[i]] = {};
            obj = obj[keys[i]];
        }
        obj[keys[keys.length - 1]] = value;
    }
}

const config = new ConfigManager();

class SecurityManager {
    static hashPassword(password) {
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto.scryptSync(password, salt, 64).toString('hex');
        return `${salt}:${hash}`;
    }

    static verifyPassword(password, stored) {
        const [salt, key] = stored.split(':');
        const hash = crypto.scryptSync(password, salt, 64).toString('hex');
        return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(key, 'hex'));
    }

    static generateToken(payload) {
        const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
        const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 86400000 })).toString('base64url');
        const signature = crypto.createHmac('sha256', config.get('jwtSecret')).update(`${header}.${body}`).digest('base64url');
        return `${header}.${body}.${signature}`;
    }

    static verifyToken(token) {
        try {
            const [header, body, signature] = token.split('.');
            const validSig = crypto.createHmac('sha256', config.get('jwtSecret')).update(`${header}.${body}`).digest('base64url');
            if (signature !== validSig) return null;
            const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
            if (payload.exp < Date.now()) return null;
            return payload;
        } catch (e) {
            return null;
        }
    }
}

class TelemetryCollector {
    constructor() {
        this.metrics = {
            totalRequests: 0,
            activeConnections: 0,
            activeMatchesCount: 0,
            errorsCount: 0,
            packetLossRate: 0.01,
            avgPingMs: 35.4
        };
        this.startTime = Date.now();
    }

    increment(metricKey, amount = 1) {
        if (this.metrics[metricKey] !== undefined) {
            this.metrics[metricKey] += amount;
        }
    }

    decrement(metricKey, amount = 1) {
        if (this.metrics[metricKey] !== undefined) {
            this.metrics[metricKey] -= amount;
            if (this.metrics[metricKey] < 0) this.metrics[metricKey] = 0;
        }
    }

    set(metricKey, value) {
        if (this.metrics[metricKey] !== undefined) {
            this.metrics[metricKey] = value;
        }
    }

    getReport() {
        return {
            ...this.metrics,
            uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
            memoryUsage: process.memoryUsage(),
            cpuUsage: process.cpuUsage()
        };
    }
}

const telemetry = new TelemetryCollector();

class GameServerNode {
    constructor(nodeId, host, port) {
        this.nodeId = nodeId;
        this.host = host;
        this.port = port;
        this.status = 'IDLE'; // IDLE, STARTING, RUNNING, FULL, TERMINATED
        this.currentPlayers = new Set();
        this.maxPlayers = 8;
        this.matchId = null;
        this.lastHeartbeat = Date.now();
        this.mapName = 'Hospital_Ward_A';
        this.gameMode = 'Classic';
    }

    assignMatch(matchId, players) {
        this.matchId = matchId;
        this.status = 'RUNNING';
        this.currentPlayers.clear();
        players.forEach(p => this.currentPlayers.add(p.playerId));
        this.lastHeartbeat = Date.now();
        Logger.info(`GameServerNode [${this.nodeId}] assigned to match ${matchId} with ${players.length} players.`);
    }

    release() {
        this.matchId = null;
        this.status = 'IDLE';
        this.currentPlayers.clear();
    }

    heartbeat() {
        this.lastHeartbeat = Date.now();
    }
}

class GameServerManager {
    constructor() {
        this.nodes = new Map();
        this.initNodes();
    }

    initNodes() {
        const basePort = config.get('serverNode.basePort');
        const maxInstances = 10;
        for (let i = 1; i <= maxInstances; i++) {
            const nodeId = `node_${i}`;
            const port = basePort + i;
            this.nodes.set(nodeId, new GameServerNode(nodeId, '127.0.0.1', port));
        }
        Logger.info(`Initialized ${this.nodes.size} dedicated game server instance nodes.`);
    }

    allocateNode(matchId, players) {
        for (const [nodeId, node] of this.nodes.entries()) {
            if (node.status === 'IDLE') {
                node.assignMatch(matchId, players);
                return node;
            }
        }
        Logger.warn(`No idle game server nodes available for match ${matchId}! Spawning emergency fallback node.`);
        const emergencyId = `node_emergency_${Date.now()}`;
        const emergencyNode = new GameServerNode(emergencyId, '127.0.0.1', 8999 + Math.floor(Math.random() * 500));
        emergencyNode.assignMatch(matchId, players);
        this.nodes.set(emergencyId, emergencyNode);
        return emergencyNode;
    }

    getNodeByMatchId(matchId) {
        for (const node of this.nodes.values()) {
            if (node.matchId === matchId) return node;
        }
        return null;
    }

    releaseNode(matchId) {
        const node = this.getNodeByMatchId(matchId);
        if (node) {
            node.release();
            Logger.info(`Game server node [${node.nodeId}] released from match ${matchId}.`);
        }
    }
}

const serverManager = new GameServerManager();

class MatchmakingQueue {
    constructor() {
        this.queue = [];
        this.parties = new Map();
        this.bannedPlayers = new Set();
    }

    addPlayer(playerData) {
        if (this.bannedPlayers.has(playerData.playerId)) {
            return { success: false, reason: 'PLAYER_BANNED' };
        }
        if (this.queue.some(p => p.playerId === playerData.playerId)) {
            return { success: false, reason: 'ALREADY_IN_QUEUE' };
        }

        const stats = db.getStats(playerData.playerId) || { rating: 1000 };
        const entry = {
            playerId: playerData.playerId,
            username: playerData.username || `User_${playerData.playerId}`,
            rating: stats.rating,
            region: playerData.region || 'Asia',
            partyId: playerData.partyId || null,
            joinedAt: Date.now(),
            tolerance: 0
        };

        this.queue.push(entry);
        telemetry.set('activeQueueSize', this.queue.length);
        Logger.debug(`Player ${entry.playerId} joined MM queue with rating ${entry.rating}.`);
        return { success: true, position: this.queue.length };
    }

    removePlayer(playerId) {
        const index = this.queue.findIndex(p => p.playerId === playerId);
        if (index !== -1) {
            this.queue.splice(index, 1);
            telemetry.set('activeQueueSize', this.queue.length);
            Logger.debug(`Player ${playerId} removed from MM queue.`);
            return true;
        }
        return false;
    }

    isQueued(playerId) {
        return this.queue.some(p => p.playerId === playerId);
    }

    getQueueLength() {
        return this.queue.length;
    }

    clear() {
        this.queue = [];
        telemetry.set('activeQueueSize', 0);
    }
}

class Matchmaker {
    constructor(queueInstance) {
        this.queueInstance = queueInstance;
        this.isRunning = false;
        this.intervalId = null;
        this.activeMatches = new Map();
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        const intervalMs = config.get('matchmaking.searchIntervalMs');
        this.intervalId = setInterval(() => this.processQueue(), intervalMs);
        Logger.info(`Matchmaker background evaluation loop started (Interval: ${intervalMs}ms).`);
    }

    stop() {
        if (!this.isRunning) return;
        clearInterval(this.intervalId);
        this.isRunning = false;
        Logger.info('Matchmaker background evaluation loop stopped.');
    }

    processQueue() {
        if (this.queueInstance.queue.length === 0) return;

        const teamSize = config.get('matchmaking.teamSize');
        const now = Date.now();

        for (let i = 0; i < this.queueInstance.queue.length; i++) {
            const player = this.queueInstance.queue[i];
            const waitTime = now - player.joinedAt;
            player.tolerance = Math.floor(waitTime / 5000) * config.get('matchmaking.ratingToleranceStep');

            const candidates = this.findCompatibleCandidates(player, teamSize - 1);
            if (candidates.length >= teamSize - 1) {
                const matchGroup = [player, ...candidates];
                const matchedPlayerIds = matchGroup.map(p => p.playerId);

                for (const p of matchGroup) {
                    this.queueInstance.removePlayer(p.playerId);
                }

                this.createMatch(matchGroup);
                break;
            }
        }
    }

    findCompatibleCandidates(targetPlayer, requiredCount) {
        const compatible = [];
        const maxTolerance = config.get('matchmaking.maxRatingTolerance');
        const currentTolerance = Math.min(targetPlayer.tolerance, maxTolerance);

        for (const candidate of this.queueInstance.queue) {
            if (candidate.playerId === targetPlayer.playerId) continue;
            if (candidate.region !== targetPlayer.region) continue;

            const ratingDiff = Math.abs(candidate.rating - targetPlayer.rating);
            if (ratingDiff <= (50 + currentTolerance)) {
                compatible.push(candidate);
                if (compatible.length >= requiredCount) break;
            }
        }
        return compatible;
    }

    createMatch(players) {
        const matchId = `MATCH_${Date.now()}_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        const assignedNode = serverManager.allocateNode(matchId, players);

        const matchRecord = {
            matchId,
            nodeId: assignedNode.nodeId,
            serverIp: assignedNode.host,
            port: assignedNode.port,
            players: players.map(p => ({ playerId: p.playerId, username: p.username, rating: p.rating })),
            createdAt: Date.now(),
            status: 'PREPARING'
        };

        this.activeMatches.set(matchId, matchRecord);
        telemetry.set('activeMatchesCount', this.activeMatches.size);
        db.saveMatch(matchRecord);

        Logger.info(`Successfully formed match ${matchId} assigned to server node ${assignedNode.nodeId} (${assignedNode.host}:${assignedNode.port}) with ${players.length} players.`);
        return matchRecord;
    }

    getMatch(matchId) {
        return this.activeMatches.get(matchId);
    }

    terminateMatch(matchId) {
        const match = this.activeMatches.get(matchId);
        if (match) {
            serverManager.releaseNode(matchId);
            this.activeMatches.delete(matchId);
            telemetry.set('activeMatchesCount', this.activeMatches.size);
            Logger.info(`Match ${matchId} terminated and resources cleaned up.`);
            return true;
        }
        return false;
    }
}

const queueInstance = new MatchmakingQueue();
const matchmaker = new Matchmaker(queueInstance);
matchmaker.start();

class PartySystem {
    constructor() {
        this.parties = new Map();
        this.playerToParty = new Map();
    }

    createParty(leaderId) {
        if (this.playerToParty.has(leaderId)) {
            return { success: false, error: 'ALREADY_IN_PARTY' };
        }
        const partyId = `PARTY_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        const party = {
            partyId,
            leaderId,
            members: new Set([leaderId]),
            createdAt: Date.now()
        };
        this.parties.set(partyId, party);
        this.playerToParty.set(leaderId, partyId);
        Logger.info(`Party ${partyId} created by leader ${leaderId}.`);
        return { success: true, partyId };
    }

    invitePlayer(partyId, targetId) {
        const party = this.parties.get(partyId);
        if (!party) return { success: false, error: 'PARTY_NOT_FOUND' };
        if (party.members.size >= config.get('matchmaking.partyMaxCapacity')) {
            return { success: false, error: 'PARTY_FULL' };
        }
        if (this.playerToParty.has(targetId)) {
            return { success: false, error: 'PLAYER_ALREADY_IN_PARTY' };
        }
        party.members.add(targetId);
        this.playerToParty.set(targetId, partyId);
        Logger.info(`Player ${targetId} added to party ${partyId}.`);
        return { success: true };
    }

    leaveParty(playerId) {
        const partyId = this.playerToParty.get(playerId);
        if (!partyId) return false;
        const party = this.parties.get(partyId);
        if (party) {
            party.members.delete(playerId);
            this.playerToParty.delete(playerId);
            if (party.members.size === 0) {
                this.parties.delete(partyId);
                Logger.info(`Party ${partyId} disbanded as all members left.`);
            } else if (party.leaderId === playerId) {
                const newLeader = party.members.values().next().value;
                party.leaderId = newLeader;
                Logger.info(`Party ${partyId} leader reassigned to ${newLeader}.`);
            }
            return true;
        }
        return false;
    }
}

const partySystem = new PartySystem();

class AntiCheatEngine {
    static validateMovement(playerState, nextState) {
        const dx = nextState.x - playerState.x;
        const dy = nextState.y - playerState.y;
        const dz = nextState.z - playerState.z;
        const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
        const dt = (nextState.timestamp - playerState.timestamp) / 1000;

        if (dt <= 0) return { valid: false, flag: 'INVALID_TIMESTAMP' };

        const speed = distance / dt;
        const maxLimit = config.get('antiCheat.maxSpeedLimit');

        if (speed > maxLimit) {
            Logger.warn(`AntiCheat violation detected for player [${playerState.playerId}]: Speed ${speed.toFixed(2)} exceeds limit ${maxLimit}`);
            return { valid: false, flag: 'SPEED_HACK', speed };
        }
        return { valid: true };
    }

    static validateActionRate(lastActionTimestamp) {
        const now = Date.now();
        const limit = config.get('antiCheat.actionRateLimitMs');
        if (now - lastActionTimestamp < limit) {
            return { valid: false, flag: 'RATE_LIMIT_EXCEEDED' };
        }
        return { valid: true };
    }
}

class InventorySystem {
    constructor() {
        this.userInventories = new Map();
    }

    addItem(playerId, itemId, quantity = 1) {
        if (!this.userInventories.has(playerId)) {
            this.userInventories.set(playerId, new Map());
        }
        const inv = this.userInventories.get(playerId);
        const currentQty = inv.get(itemId) || 0;
        inv.set(itemId, currentQty + quantity);
        Logger.debug(`Added ${quantity} of item ${itemId} to player ${playerId} inventory.`);
        return inv.get(itemId);
    }

    removeItem(playerId, itemId, quantity = 1) {
        const inv = this.userInventories.get(playerId);
        if (!inv) return false;
        const currentQty = inv.get(itemId) || 0;
        if (currentQty < quantity) return false;
        inv.set(itemId, currentQty - quantity);
        return true;
    }

    getInventory(playerId) {
        const inv = this.userInventories.get(playerId);
        if (!inv) return {};
        return Object.fromEntries(inv);
    }
}

const inventorySystem = new InventorySystem();

class AchievementSystem {
    constructor() {
        this.userAchievements = new Map();
        this.definitions = [
            { id: 'ACH_FIRST_BLOOD', name: 'First Escape', desc: 'Survive your first match.' },
            { id: 'ACH_VETERAN', name: 'Insane Asylum Regular', desc: 'Play 50 matches.' },
            { id: 'ACH_MASTER_SURVIVOR', name: 'Ghost Hunter', desc: 'Achieve 25 wins.' }
        ];
    }

    checkAndAward(playerId, statKey, targetValue) {
        const stats = db.getStats(playerId);
        if (!stats) return [];
        const awarded = [];
        if (!this.userAchievements.has(playerId)) {
            this.userAchievements.set(playerId, new Set());
        }
        const userAch = this.userAchievements.get(playerId);

        for (const def of this.definitions) {
            if (userAch.has(def.id)) continue;
            let conditionMet = false;
            if (def.id === 'ACH_FIRST_BLOOD' && stats.survived >= 1) conditionMet = true;
            if (def.id === 'ACH_VETERAN' && stats.matchesPlayed >= 50) conditionMet = true;
            if (def.id === 'ACH_MASTER_SURVIVOR' && stats.matchesWon >= 25) conditionMet = true;

            if (conditionMet) {
                userAch.add(def.id);
                awarded.push(def);
                Logger.info(`Player ${playerId} unlocked achievement: ${def.name}`);
            }
        }
        return awarded;
    }
}

const achievementSystem = new AchievementSystem();

class RankingLeaderboard {
    getTopPlayers(limit = 10) {
        const allStats = Array.from(db.playerStats.values());
        allStats.sort((a, b) => b.rating - a.rating);
        return allStats.slice(0, limit).map((s, idx) => ({
            rank: idx + 1,
            playerId: s.playerId,
            rating: s.rating,
            level: s.level,
            matchesWon: s.matchesWon
        }));
    }
}

const leaderboard = new RankingLeaderboard();

class ReportSystem {
    constructor() {
        this.reports = [];
    }

    submitReport(reporterId, targetId, reason, details) {
        const report = {
            reportId: `REP_${Date.now()}_${Math.floor(Math.random()*1000)}`,
            reporterId,
            targetId,
            reason,
            details,
            timestamp: Date.now(),
            status: 'PENDING'
        };
        this.reports.push(report);
        Logger.warn(`Player report submitted against ${targetId} by ${reporterId} for reason: ${reason}`);
        return report.reportId;
    }
}

const reportSystem = new ReportSystem();

class WebRouter {
    constructor() {
        this.routes = new Map();
    }

    add(method, pathPattern, handler) {
        const key = `${method.toUpperCase()}:${pathPattern}`;
        this.routes.set(key, handler);
    }

    handle(req, res) {
        const parsedUrl = url.parse(req.url, true);
        const method = req.method.toUpperCase();
        const pathname = parsedUrl.pathname;

        telemetry.increment('totalRequests');

        let handler = this.routes.get(`${method}:${pathname}`);
        if (!handler) {
            for (const [routeKey, routeHandler] of this.routes.entries()) {
                const [routeMethod, routePath] = routeKey.split(':');
                if (routeMethod === method && routePath.includes(':')) {
                    const routeSegments = routePath.split('/');
                    const pathSegments = pathname.split('/');
                    if (routeSegments.length === pathSegments.length) {
                        let match = true;
                        const params = {};
                        for (let i = 0; i < routeSegments.length; i++) {
                            if (routeSegments[i].startsWith(':')) {
                                params[routeSegments[i].slice(1)] = pathSegments[i];
                            } else if (routeSegments[i] !== pathSegments[i]) {
                                match = false;
                                break;
                            }
                        }
                        if (match) {
                            req.params = params;
                            handler = routeHandler;
                            break;
                        }
                    }
                }
            }
        }

        if (handler) {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
                if (body) {
                    try {
                        req.body = JSON.parse(body);
                    } catch (e) {
                        req.body = {};
                    }
                } else {
                    req.body = {};
                }
                req.query = parsedUrl.query;

                try {
                    handler(req, res);
                } catch (err) {
                    telemetry.increment('errorsCount');
                    Logger.error(`Internal server error processing ${method} ${pathname}`, err);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'INTERNAL_SERVER_ERROR', message: err.message }));
                }
            });
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'ENDPOINT_NOT_FOUND' }));
        }
    }
}

const router = new WebRouter();

router.add('POST', '/api/v1/auth/register', (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'MISSING_FIELDS' }));
    }
    const userId = `user_${crypto.randomBytes(8).toString('hex')} ` .trim();
    if (db.getUser(userId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'USER_ALREADY_EXISTS' }));
    }
    const passwordHash = SecurityManager.hashPassword(password);
    db.addUser({ id: userId, username, email, passwordHash, createdAt: Date.now(), banned: false, role: 'player' });

    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, userId, username }));
});

router.add('POST', '/api/v1/auth/login', (req, res) => {
    const { email, password } = req.body;
    let foundUser = null;
    for (const user of db.users.values()) {
        if (user.email === email) {
            foundUser = user;
            break;
        }
    }
    if (!foundUser || !SecurityManager.verifyPassword(password, foundUser.passwordHash)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'INVALID_CREDENTIALS' }));
    }
    const token = SecurityManager.generateToken({ userId: foundUser.id, role: foundUser.role });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, token, userId: foundUser.id, username: foundUser.username }));
});

router.add('POST', '/api/v1/matchmaking/find', (req, res) => {
    const { playerId, username, region, partyId } = req.body;
    if (!playerId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'MISSING_PLAYER_ID' }));
    }

    const result = queueInstance.addPlayer({ playerId, username, region, partyId });
    if (!result.success) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: result.reason }));
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        success: true,
        status: 'QUEUED',
        queuePosition: result.position,
        queueLength: queueInstance.getQueueLength()
    }));
});

router.add('POST', '/api/v1/matchmaking/cancel', (req, res) => {
    const { playerId } = req.body;
    if (!playerId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'MISSING_PLAYER_ID' }));
    }

    const removed = queueInstance.removePlayer(playerId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, removed }));
});

router.add('GET', '/api/v1/matchmaking/status/:playerId', (req, res) => {
    const playerId = req.params.playerId;
    const isQueued = queueInstance.isQueued(playerId);

    let foundMatch = null;
    for (const match of matchmaker.activeMatches.values()) {
        if (match.players.some(p => p.playerId === playerId)) {
            foundMatch = match;
            break;
        }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        success: true,
        isQueued,
        matchFound: !!foundMatch,
        matchData: foundMatch || null
    }));
});

router.add('POST', '/api/v1/party/create', (req, res) => {
    const { leaderId } = req.body;
    const result = partySystem.createParty(leaderId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
});

router.add('POST', '/api/v1/party/invite', (req, res) => {
    const { partyId, targetId } = req.body;
    const result = partySystem.invitePlayer(partyId, targetId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
});

router.add('GET', '/api/v1/stats/:playerId', (req, res) => {
    const playerId = req.params.playerId;
    const stats = db.getStats(playerId);
    if (!stats) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'STATS_NOT_FOUND' }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, stats }));
});

router.add('GET', '/api/v1/leaderboard', (req, res) => {
    const top = leaderboard.getTopPlayers(10);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, leaderboard: top }));
});

router.add('GET', '/api/v1/telemetry/metrics', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, telemetry: telemetry.getReport() }));
});

router.add('POST', '/api/v1/reports/submit', (req, res) => {
    const { reporterId, targetId, reason, details } = req.body;
    const reportId = reportSystem.submitReport(reporterId, targetId, reason, details);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, reportId }));
});

router.add('GET', '/health', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', timestamp: Date.now() }));
});

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    router.handle(req, res);
});

const PORT = config.get('port');
const HOST = config.get('host');

server.listen(PORT, HOST, () => {
    Logger.info(`HSHO Backend Engine active and listening on http://${HOST}:${PORT}`);
});

module.exports = {
    server,
    db,
    matchmaker,
    queueInstance,
    serverManager,
    AntiCheatEngine,
    InventorySystem,
    AchievementSystem
};