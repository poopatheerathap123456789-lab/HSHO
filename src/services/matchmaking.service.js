const http = require('http');
const url = require('url');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

class Logger extends EventEmitter {
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
        this.playerStats = new Map();
        this.matchHistory = [];
        this.inventoryData = new Map();
        this.friendLists = new Map();
        this.bans = new Map();
        this.guilds = new Map();
        this.reports = [];
        this.auditLogs = [];
        this.achievements = new Map();
        this.storeItems = new Map();
        this.playerWallets = new Map();
        this.chatLogs = [];
        this.serverConfigs = new Map();
        this.analyticsEvents = [];
        this.partyInvites = new Map();
        this.matchReplays = new Map();
        this.securityTokens = new Map();
        this.ipBlacklist = new Set();
        this.rateLimits = new Map();
        this.cacheStore = new Map();
        this.initDefaultData();
    }

    initDefaultData() {
        for (let i = 1; i <= 200; i++) {
            const id = `real_player_${i}`;
            this.users.set(id, {
                id,
                username: `Player_${i}`,
                email: `player${i}@hsho.internal`,
                passwordHash: crypto.createHash('sha256').update(`password${i}`).digest('hex'),
                createdAt: Date.now() - Math.floor(Math.random() * 1000000000),
                lastLogin: Date.now(),
                isBanned: false,
                role: i === 1 ? 'ADMIN' : 'USER'
            });
            this.playerStats.set(id, {
                playerId: id,
                rating: 1000 + Math.floor(Math.random() * 400) - 200,
                matchesPlayed: Math.floor(Math.random() * 50),
                matchesWon: Math.floor(Math.random() * 25),
                kills: Math.floor(Math.random() * 100),
                deaths: Math.floor(Math.random() * 100),
                score: Math.floor(Math.random() * 5000),
                level: Math.floor(Math.random() * 30) + 1,
                experience: Math.floor(Math.random() * 10000)
            });
            this.playerWallets.set(id, {
                gold: 500 + Math.floor(Math.random() * 1000),
                gems: 50 + Math.floor(Math.random() * 200)
            });
            this.inventoryData.set(id, new Map([
                ['item_bandage_1', 5],
                ['item_flashlight_2', 1],
                ['item_key_rusty', 2]
            ]));
            this.friendLists.set(id, new Set());
        }
        Logger.info(`Database simulator fully initialized with ${this.users.size} mock records and persistent memory maps.`);
    }

    getUser(id) { return this.users.get(id); }
    addUser(user) {
        this.users.set(user.id, user);
        this.playerStats.set(user.id, { playerId: user.id, rating: 1000, matchesPlayed: 0, matchesWon: 0, kills: 0, deaths: 0, score: 0, level: 1, experience: 0 });
        this.playerWallets.set(user.id, { gold: 100, gems: 10 });
        this.inventoryData.set(user.id, new Map());
        this.friendLists.set(user.id, new Set());
    }
    getStats(id) { return this.playerStats.get(id) || { playerId: id, rating: 1000, matchesPlayed: 0, matchesWon: 0 }; }
    saveMatch(match) {
        this.matchHistory.push(match);
        if (this.matchHistory.length > 5000) this.matchHistory.shift();
    }
    logAudit(action, actorId, details) {
        this.auditLogs.push({ id: `AUDIT_${Date.now()}_${Math.random()}`, action, actorId, details, timestamp: Date.now() });
    }
}

const db = new DatabaseSimulator();

class ConfigManager {
    constructor() {
        this.config = {
            env: 'production',
            port: process.env.PORT || 3000,
            host: '0.0.0.0',
            jwtSecret: crypto.randomBytes(64).toString('hex'),
            matchmaking: {
                maxQueueSize: 10000,
                evaluationIntervalMs: 1000,
                ratingToleranceStep: 25,
                maxRatingTolerance: 300,
                requiredPlayersDefault: 2,
                matchTimeoutMs: 60000
            },
            gameServer: {
                basePort: 7700,
                maxInstances: 50,
                heartbeatTimeoutMs: 15000
            },
            security: {
                maxSpeedLimit: 18.5,
                rateLimitMaxRequests: 100,
                rateLimitWindowMs: 60000
            }
        };
    }
    get(path) {
        return path.split('.').reduce((obj, key) => (obj && obj[key] !== undefined) ? obj[key] : undefined, this.config);
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
        try {
            const [salt, key] = stored.split(':');
            const hash = crypto.scryptSync(password, salt, 64).toString('hex');
            return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(key, 'hex'));
        } catch (e) {
            return false;
        }
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
            packetsProcessed: 0,
            cpuLoadAvg: 0.12,
            memoryUsageBytes: 0
        };
        this.startTime = Date.now();
    }
    increment(key, val = 1) { if (this.metrics[key] !== undefined) this.metrics[key] += val; }
    decrement(key, val = 1) { if (this.metrics[key] !== undefined) { this.metrics[key] -= val; if (this.metrics[key] < 0) this.metrics[key] = 0; } }
    set(key, val) { if (this.metrics[key] !== undefined) this.metrics[key] = val; }
    getReport() {
        return {
            ...this.metrics,
            uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
            memory: process.memoryUsage(),
            cpu: process.cpuUsage()
        };
    }
}

const telemetry = new TelemetryCollector();

class GameServerNode {
    constructor(nodeId, host, port) {
        this.nodeId = nodeId;
        this.host = host;
        this.port = port;
        this.status = 'IDLE'; // IDLE, RUNNING, FULL, MAINTENANCE, OFFLINE
        this.matchId = null;
        this.currentPlayers = new Set();
        this.lastHeartbeat = Date.now();
        this.metrics = { fps: 60.0, packetLoss: 0.0, activeEntities: 0 };
    }
    assignMatch(matchId, players) {
        this.matchId = matchId;
        this.status = 'RUNNING';
        this.currentPlayers.clear();
        players.forEach(p => this.currentPlayers.add(p.playerId));
        this.lastHeartbeat = Date.now();
        Logger.info(`Game Server Node [${this.nodeId}] assigned to match ${matchId} with ${players.length} players.`);
    }
    release() {
        this.matchId = null;
        this.status = 'IDLE';
        this.currentPlayers.clear();
    }
    ping() {
        this.lastHeartbeat = Date.now();
    }
}

class GameServerManager {
    constructor() {
        this.nodes = new Map();
        this.initNodes();
    }
    initNodes() {
        const basePort = config.get('gameServer.basePort');
        const maxInstances = config.get('gameServer.maxInstances');
        for (let i = 1; i <= maxInstances; i++) {
            const nodeId = `node_${i}`;
            const port = basePort + i;
            this.nodes.set(nodeId, new GameServerNode(nodeId, '127.0.0.1', port));
        }
        Logger.info(`Initialized ${this.nodes.size} game server worker nodes in cluster.`);
    }
    allocateNode(matchId, players) {
        for (const [nodeId, node] of this.nodes.entries()) {
            if (node.status === 'IDLE') {
                node.assignMatch(matchId, players);
                return node;
            }
        }
        const emergencyId = `node_emergency_${Date.now()}_${Math.floor(Math.random()*1000)}`;
        const emergencyNode = new GameServerNode(emergencyId, '127.0.0.1', 9900 + Math.floor(Math.random() * 500));
        emergencyNode.assignMatch(matchId, players);
        this.nodes.set(emergencyId, emergencyNode);
        Logger.warn(`All standard nodes occupied. Spawned dynamic emergency node: ${emergencyId}`);
        return emergencyNode;
    }
    getNodeByMatchId(matchId) {
        for (const node of this.nodes.values()) {
            if (node.matchId === matchId) return node;
        }
        return null;
    }
    releaseNodeByMatchId(matchId) {
        for (const node of this.nodes.values()) {
            if (node.matchId === matchId) {
                node.release();
                Logger.info(`Released game server node [${node.nodeId}] from match ${matchId}.`);
                return true;
            }
        }
        return false;
    }
}

const serverManager = new GameServerManager();

class AdvancedMatchmakingSystem {
    constructor() {
        this.queue = [];
        this.activeMatches = new Map();
        this.requiredPlayers = config.get('matchmaking.requiredPlayersDefault');
        this.isRunning = false;
        this.intervalId = null;
        this.matchHistoryBuffer = [];
    }

    startEvaluationLoop() {
        if (this.isRunning) return;
        this.isRunning = true;
        const intervalMs = config.get('matchmaking.evaluationIntervalMs');
        this.intervalId = setInterval(() => {
            this.evaluateQueueCycle();
        }, intervalMs);
        Logger.info(`Advanced matchmaking evaluation engine started with interval ${intervalMs}ms.`);
    }

    stopEvaluationLoop() {
        if (!this.isRunning) return;
        clearInterval(this.intervalId);
        this.isRunning = false;
        Logger.info('Advanced matchmaking evaluation engine stopped.');
    }

    addPlayer(playerData) {
        if (!playerData.playerId) {
            return { success: false, reason: 'INVALID_PLAYER_ID' };
        }

        const existingIndex = this.queue.findIndex(p => p.playerId === playerData.playerId);
        if (existingIndex !== -1) {
            return { success: false, reason: 'ALREADY_IN_QUEUE' };
        }

        const stats = db.getStats(playerData.playerId);
        const playerEntry = {
            playerId: playerData.playerId,
            username: playerData.username || `User_${playerData.playerId}`,
            rating: stats.rating,
            region: playerData.region || 'Asia',
            joinedAt: Date.now(),
            tolerance: 0
        };

        this.queue.push(playerEntry);
        telemetry.set('activeQueueSize', this.queue.length);
        Logger.info(`Player ${playerEntry.playerId} queued successfully. Current queue depth: ${this.queue.length}`);

        return this.evaluateQueueImmediate();
    }

    removePlayer(playerId) {
        const initialLength = this.queue.length;
        this.queue = this.queue.filter(p => p.playerId !== playerId);
        if (this.queue.length < initialLength) {
            telemetry.set('activeQueueSize', this.queue.length);
            Logger.info(`Player ${playerId} safely removed from matchmaking queue.`);
            return true;
        }
        return false;
    }

    evaluateQueueImmediate() {
        if (this.queue.length >= this.requiredPlayers) {
            return this.formMatchFromQueue();
        }
        return {
            success: true,
            status: 'SEARCHING',
            playersInQueue: this.queue.length,
            requiredPlayers: this.requiredPlayers
        };
    }

    evaluateQueueCycle() {
        if (this.queue.length < this.requiredPlayers) return;

        const now = Date.now();
        for (let i = 0; i < this.queue.length; i++) {
            const player = this.queue[i];
            const waitTime = now - player.joinedAt;
            player.tolerance = Math.floor(waitTime / 5000) * config.get('matchmaking.ratingToleranceStep');
        }

        while (this.queue.length >= this.requiredPlayers) {
            const result = this.formMatchFromQueue();
            if (!result.success) break;
        }
    }

    formMatchFromQueue() {
        if (this.queue.length < this.requiredPlayers) {
            return { success: false, reason: 'NOT_ENOUGH_PLAYERS' };
        }

        const target = this.queue[0];
        const candidates = [target];
        const maxTolerance = config.get('matchmaking.maxRatingTolerance');
        const currentTolerance = Math.min(target.tolerance, maxTolerance);

        for (let i = 1; i < this.queue.length && candidates.length < this.requiredPlayers; i++) {
            const candidate = this.queue[i];
            if (candidate.region !== target.region) continue;
            const ratingDiff = Math.abs(candidate.rating - target.rating);
            if (ratingDiff <= (50 + currentTolerance)) {
                candidates.push(candidate);
            }
        }

        if (candidates.length < this.requiredPlayers) {
            for (let i = 1; i < this.queue.length && candidates.length < this.requiredPlayers; i++) {
                if (!candidates.includes(this.queue[i])) {
                    candidates.push(this.queue[i]);
                }
            }
        }

        const matchedPlayers = candidates.slice(0, this.requiredPlayers);
        const matchedIds = new Set(matchedPlayers.map(p => p.playerId));
        this.queue = this.queue.filter(p => !matchedIds.has(p.playerId));
        telemetry.set('activeQueueSize', this.queue.length);

        const matchId = `MATCH_${Date.now()}_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        const assignedNode = serverManager.allocateNode(matchId, matchedPlayers);

        const matchData = {
            matchId: matchId,
            serverIp: assignedNode.host,
            port: assignedNode.port,
            nodeId: assignedNode.nodeId,
            players: matchedPlayers,
            createdAt: Date.now(),
            status: 'INITIALIZED'
        };

        this.activeMatches.set(matchId, matchData);
        db.saveMatch(matchData);
        telemetry.set('activeMatchesCount', this.activeMatches.size);

        Logger.info(`Advanced Matchmaker successfully formed match ${matchId} on node ${assignedNode.nodeId} (${assignedNode.host}:${assignedNode.port}).`);

        return {
            success: true,
            status: 'MATCH_FOUND',
            matchData: matchData
        };
    }

    findMatchByPlayerId(playerId) {
        for (const match of this.activeMatches.values()) {
            if (match.players.some(p => p.playerId === playerId)) {
                return match;
            }
        }
        return null;
    }

    isPlayerQueued(playerId) {
        return this.queue.some(p => p.playerId === playerId);
    }

    terminateMatch(matchId) {
        const match = this.activeMatches.get(matchId);
        if (match) {
            serverManager.releaseNodeByMatchId(matchId);
            this.activeMatches.delete(matchId);
            telemetry.set('activeMatchesCount', this.activeMatches.size);
            Logger.info(`Match ${matchId} forcefully terminated and resources reclaimed.`);
            return true;
        }
        return false;
    }
}

const matchmakingSystem = new AdvancedMatchmakingSystem();
matchmakingSystem.startEvaluationLoop();

class PartyManagementSystem {
    constructor() {
        this.parties = new Map();
        this.playerPartyMap = new Map();
    }
    createParty(leaderId) {
        if (this.playerPartyMap.has(leaderId)) return { success: false, reason: 'ALREADY_IN_PARTY' };
        const partyId = `PARTY_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        const party = { partyId, leaderId, members: new Set([leaderId]), createdAt: Date.now() };
        this.parties.set(partyId, party);
        this.playerPartyMap.set(leaderId, partyId);
        return { success: true, partyId };
    }
    disbandParty(partyId) {
        const party = this.parties.get(partyId);
        if (!party) return false;
        for (const memberId of party.members) {
            this.playerPartyMap.delete(memberId);
        }
        this.parties.delete(partyId);
        return true;
    }
}

const partySystem = new PartyManagementSystem();

class AntiCheatModule {
    static evaluateMovementVector(previousState, currentState) {
        const dx = currentState.x - previousState.x;
        const dy = currentState.y - previousState.y;
        const dz = currentState.z - previousState.z;
        const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
        const dt = (currentState.timestamp - previousState.timestamp) / 1000;
        if (dt <= 0) return { valid: false, code: 'ZERO_DELTA_TIME' };
        const calculatedSpeed = distance / dt;
        const limit = config.get('security.maxSpeedLimit');
        if (calculatedSpeed > limit) {
            Logger.warn(`AntiCheat flagged player [${previousState.playerId}]: Speed ${calculatedSpeed.toFixed(2)} exceeds threshold ${limit}`);
            return { valid: false, code: 'SPEED_HACK_VIOLATION', speed: calculatedSpeed };
        }
        return { valid: true };
    }
}

class InventoryManagerSystem {
    constructor() {}
    getInventory(playerId) {
        const inv = db.inventoryData.get(playerId);
        if (!inv) return {};
        return Object.fromEntries(inv);
    }
    addItem(playerId, itemId, amount = 1) {
        let inv = db.inventoryData.get(playerId);
        if (!inv) {
            inv = new Map();
            db.inventoryData.set(playerId, inv);
        }
        const current = inv.get(itemId) || 0;
        inv.set(itemId, current + amount);
        return inv.get(itemId);
    }
    removeItem(playerId, itemId, amount = 1) {
        const inv = db.inventoryData.get(playerId);
        if (!inv) return false;
        const current = inv.get(itemId) || 0;
        if (current < amount) return false;
        inv.set(itemId, current - amount);
        return true;
    }
}

const inventoryManager = new InventoryManagerSystem();

class LeaderboardSystem {
    getTopRankings(limit = 10) {
        const statsArray = Array.from(db.playerStats.values());
        statsArray.sort((a, b) => b.rating - a.rating);
        return statsArray.slice(0, limit).map((s, index) => ({
            rank: index + 1,
            playerId: s.playerId,
            rating: s.rating,
            matchesWon: s.matchesWon,
            score: s.score
        }));
    }
}

const leaderboardSystem = new LeaderboardSystem();

class WebRouter {
    constructor() {
        this.routes = new Map();
    }
    add(method, path, handler) {
        this.routes.set(`${method.toUpperCase()}:${path}`, handler);
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
                    try { req.body = JSON.parse(body); } catch (e) { req.body = {}; }
                } else {
                    req.body = {};
                }
                req.query = parsedUrl.query;
                try {
                    handler(req, res);
                } catch (err) {
                    telemetry.increment('errorsCount');
                    Logger.error(`Route execution exception on ${method} ${pathname}`, err);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'INTERNAL_SERVER_ERROR', message: err.message }));
                }
            });
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'ENDPOINT_NOT_FOUND', path: pathname }));
        }
    }
}

const router = new WebRouter();

router.add('POST', '/api/v1/auth/register', (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'MISSING_REQUIRED_FIELDS' }));
    }
    const userId = `user_${crypto.randomBytes(8).toString('hex')}`;
    const passwordHash = SecurityManager.hashPassword(password);
    db.addUser({ id: userId, username, email, passwordHash, createdAt: Date.now(), lastLogin: Date.now(), isBanned: false, role: 'USER' });
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, userId, username }));
});

router.add('POST', '/api/v1/auth/login', (req, res) => {
    const { email, password } = req.body;
    let found = null;
    for (const user of db.users.values()) {
        if (user.email === email) { found = user; break; }
    }
    if (!found || !SecurityManager.verifyPassword(password, found.passwordHash)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'INVALID_CREDENTIALS' }));
    }
    const token = SecurityManager.generateToken({ userId: found.id, role: found.role });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, token, userId: found.id, username: found.username }));
});

router.add('POST', '/api/v1/matchmaking/find', (req, res) => {
    const { playerId, username, region } = req.body;
    if (!playerId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'MISSING_PLAYER_ID' }));
    }

    const activeMatch = matchmakingSystem.findMatchByPlayerId(playerId);
    if (activeMatch) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, status: 'MATCH_FOUND', matchData: activeMatch }));
    }

    const result = matchmakingSystem.addPlayer({ playerId, username, region });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
});

router.add('POST', '/api/v1/matchmaking/cancel', (req, res) => {
    const { playerId } = req.body;
    if (!playerId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'MISSING_PLAYER_ID' }));
    }
    const removed = matchmakingSystem.removePlayer(playerId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, removed }));
});

router.add('GET', '/api/v1/matchmaking/status/:playerId', (req, res) => {
    const playerId = req.params.playerId;
    const match = matchmakingSystem.findMatchByPlayerId(playerId);
    if (match) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, status: 'MATCH_FOUND', matchData: match }));
    }
    const isQueued = matchmakingSystem.isPlayerQueued(playerId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, status: isQueued ? 'SEARCHING' : 'IDLE', isQueued }));
});

router.add('GET', '/api/v1/inventory/:playerId', (req, res) => {
    const playerId = req.params.playerId;
    const inventory = inventoryManager.getInventory(playerId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, inventory }));
});

router.add('GET', '/api/v1/leaderboard', (req, res) => {
    const top = leaderboardSystem.getTopRankings(10);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, leaderboard: top }));
});

router.add('GET', '/api/v1/telemetry/metrics', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, telemetry: telemetry.getReport() }));
});

router.add('GET', '/health', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', queueSize: matchmakingSystem.queue.length, uptime: process.uptime() }));
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
    Logger.info(`HSHO Enterprise Core Server operational on http://${HOST}:${PORT}`);
});

module.exports = server;
