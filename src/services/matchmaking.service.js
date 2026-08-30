const http = require('http');
const url = require('url');
const crypto = require('crypto');
const { EventEmitter } = require('events');

class Logger extends EventEmitter {
    static info(msg, meta = {}) {
        console.log(`[INFO] [${new Date().toISOString()}] ${msg}`, Object.keys(meta).length ? JSON.stringify(meta) : '');
    }
    static error(msg, err = {}) {
        console.error(`[ERROR] [${new Date().toISOString()}] ${msg}`, err.stack || err);
    }
    static warn(msg, meta = {}) {
        console.warn(`[WARN] [${new Date().toISOString()}] ${msg}`, Object.keys(meta).length ? JSON.stringify(meta) : '');
    }
}

class DatabaseSimulator {
    constructor() {
        this.users = new Map();
        this.playerStats = new Map();
        this.matchHistory = [];
        this.inventoryData = new Map();
        this.friendLists = new Map();
        this.initDefaultData();
    }

    initDefaultData() {
        for (let i = 1; i <= 50; i++) {
            const id = `player_${i}`;
            this.users.set(id, {
                id,
                username: `Survivor_${i}`,
                email: `player${i}@hsho.internal`,
                passwordHash: crypto.createHash('sha256').update(`password${i}`).digest('hex'),
                createdAt: Date.now(),
                isBanned: false,
                role: i === 1 ? 'ADMIN' : 'USER'
            });
            this.playerStats.set(id, {
                playerId: id,
                rating: 1000 + Math.floor(Math.random() * 200),
                matchesPlayed: Math.floor(Math.random() * 20),
                matchesWon: Math.floor(Math.random() * 10),
                score: Math.floor(Math.random() * 3000)
            });
            this.inventoryData.set(id, new Map([['item_bandage', 5], ['item_battery', 2]]));
            this.friendLists.set(id, new Set());
        }
    }

    getUser(id) { return this.users.get(id); }
    addUser(user) {
        this.users.set(user.id, user);
        this.playerStats.set(user.id, { playerId: user.id, rating: 1000, matchesPlayed: 0, matchesWon: 0, score: 0 });
        this.inventoryData.set(user.id, new Map());
        this.friendLists.set(user.id, new Set());
    }
    getStats(id) { return this.playerStats.get(id) || { playerId: id, rating: 1000, matchesPlayed: 0, matchesWon: 0, score: 0 }; }
    saveMatch(match) {
        this.matchHistory.push(match);
        if (this.matchHistory.length > 1000) this.matchHistory.shift();
    }
}

const db = new DatabaseSimulator();

class ConfigManager {
    constructor() {
        this.config = {
            env: 'production',
            port: process.env.PORT || 10000,
            host: '0.0.0.0',
            publicServerUrl: 'https://hshgobackobt4.onrender.com',
            jwtSecret: process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex'),
            matchmaking: {
                evaluationIntervalMs: 1000,
                requiredPlayersDefault: 1, // ปรับเป็น 1 เพื่อให้เชื่อมต่อสร้างห้องได้ทันที ไม่ค้าง 00:00
                maxRatingTolerance: 500
            },
            gameServer: {
                domain: 'hshgobackobt4.onrender.com',
                port: 443
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
        this.metrics = { totalRequests: 0, activeQueueSize: 0, activeMatchesCount: 0, errorsCount: 0 };
    }
    increment(key, val = 1) { if (this.metrics[key] !== undefined) this.metrics[key] += val; }
    set(key, val) { if (this.metrics[key] !== undefined) this.metrics[key] = val; }
    getReport() { return { ...this.metrics, uptime: process.uptime() }; }
}

const telemetry = new TelemetryCollector();

class GameServerNode {
    constructor(nodeId, host, port) {
        this.nodeId = nodeId;
        this.host = host;
        this.port = port;
        this.status = 'IDLE';
        this.matchId = null;
        this.currentPlayers = new Set();
    }
    assignMatch(matchId, players) {
        this.matchId = matchId;
        this.status = 'RUNNING';
        this.currentPlayers.clear();
        players.forEach(p => this.currentPlayers.add(p.playerId));
    }
    release() {
        this.matchId = null;
        this.status = 'IDLE';
        this.currentPlayers.clear();
    }
}

class GameServerManager {
    constructor() {
        this.nodes = new Map();
        const domain = config.get('gameServer.domain');
        const port = config.get('gameServer.port');
        for (let i = 1; i <= 20; i++) {
            this.nodes.set(`node_${i}`, new GameServerNode(`node_${i}`, domain, port));
        }
    }
    allocateNode(matchId, players) {
        for (const node of this.nodes.values()) {
            if (node.status === 'IDLE') {
                node.assignMatch(matchId, players);
                return node;
            }
        }
        const fallbackNode = new GameServerNode(`node_dynamic_${Date.now()}`, config.get('gameServer.domain'), config.get('gameServer.port'));
        fallbackNode.assignMatch(matchId, players);
        this.nodes.set(fallbackNode.nodeId, fallbackNode);
        return fallbackNode;
    }
}

const serverManager = new GameServerManager();

class MatchmakingSystem {
    constructor() {
        this.queue = [];
        this.activeMatches = new Map();
        this.requiredPlayers = config.get('matchmaking.requiredPlayersDefault');
    }

    addPlayer(playerData) {
        if (!playerData.playerId) return { success: false, reason: 'INVALID_PLAYER_ID' };

        this.removePlayer(playerData.playerId);

        const stats = db.getStats(playerData.playerId);
        const entry = {
            playerId: playerData.playerId,
            username: playerData.username || `Player_${playerData.playerId}`,
            rating: stats.rating,
            region: playerData.region || 'Asia',
            joinedAt: Date.now()
        };

        this.queue.push(entry);
        telemetry.set('activeQueueSize', this.queue.length);

        return this.evaluateMatch();
    }

    removePlayer(playerId) {
        const len = this.queue.length;
        this.queue = this.queue.filter(p => p.playerId !== playerId);
        for (const [mId, match] of this.activeMatches.entries()) {
            if (match.players && match.players.some(p => p.playerId === playerId)) {
                this.activeMatches.delete(mId);
            }
        }
        if (this.queue.length < len) {
            telemetry.set('activeQueueSize', this.queue.length);
            return true;
        }
        return false;
    }

    evaluateMatch() {
        if (this.queue.length >= this.requiredPlayers) {
            const matchedPlayers = this.queue.splice(0, this.requiredPlayers);
            telemetry.set('activeQueueSize', this.queue.length);

            const matchId = `HSHO_MATCH_${Date.now()}_${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
            const node = serverManager.allocateNode(matchId, matchedPlayers);

            // Payload โครงสร้างสมบูรณ์ ป้องกันหลุดเชื่อมต่อ และแก้ตัวนับเวลาค้าง 00:00
            const matchResponse = {
                success: true,
                status: 'MATCH_FOUND',
                matchData: {
                    matchId: matchId,
                    serverIp: node.host,
                    port: node.port,
                    ssl: true,
                    connectionUrl: `https://${node.host}/api/v1/game/connect?matchId=${matchId}`,
                    nodeId: node.nodeId,
                    players: matchedPlayers,
                    createdAt: Date.now()
                }
            };

            this.activeMatches.set(matchId, matchResponse.matchData);
            db.saveMatch(matchResponse.matchData);
            telemetry.set('activeMatchesCount', this.activeMatches.size);

            Logger.info(`Match created successfully: ${matchId}`);
            return matchResponse;
        }

        return {
            success: true,
            status: 'SEARCHING',
            playersInQueue: this.queue.length,
            requiredPlayers: this.requiredPlayers
        };
    }

    findMatchByPlayerId(playerId) {
        for (const match of this.activeMatches.values()) {
            if (match.players && match.players.some(p => p.playerId === playerId)) {
                return { success: true, status: 'MATCH_FOUND', matchData: match };
            }
        }
        return null;
    }

    isPlayerQueued(playerId) {
        return this.queue.some(p => p.playerId === playerId);
    }
}

const matchmakingSystem = new MatchmakingSystem();

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
                    const rSegs = routePath.split('/');
                    const pSegs = pathname.split('/');
                    if (rSegs.length === pSegs.length) {
                        let match = true;
                        const params = {};
                        for (let i = 0; i < rSegs.length; i++) {
                            if (rSegs[i].startsWith(':')) {
                                params[rSegs[i].slice(1)] = pSegs[i];
                            } else if (rSegs[i] !== pSegs[i]) {
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
                    Logger.error(`Error processing route ${method} ${pathname}`, err);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'SERVER_ERROR', message: err.message }));
                }
            });
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'NOT_FOUND', path: pathname }));
        }
    }
}

const router = new WebRouter();

// -------------------------------------------------------------
// Core API Endpoints (รวมระบบ Authentication, Matchmaking, Game Sync)
// -------------------------------------------------------------

router.add('POST', '/api/v1/auth/register', (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'MISSING_FIELDS' }));
    }
    const userId = `user_${crypto.randomBytes(6).toString('hex')}`;
    const passwordHash = SecurityManager.hashPassword(password);
    db.addUser({ id: userId, username, email, passwordHash, createdAt: Date.now(), isBanned: false, role: 'USER' });
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

// Endpoint ดักหาห้อง HSHO เมื่อหาห้องได้จะรีเทิร์น Payload ทันที
router.add('POST', '/api/v1/matchmaking/find', (req, res) => {
    const playerId = req.body.playerId || req.body.userId || `Player_${Math.floor(Math.random() * 899999 + 100000)}`;
    const username = req.body.username || `Player_${playerId}`;
    const region = req.body.region || 'Asia';

    const activeMatch = matchmakingSystem.findMatchByPlayerId(playerId);
    if (activeMatch) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(activeMatch));
    }

    const result = matchmakingSystem.addPlayer({ playerId, username, region });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
});

router.add('POST', '/api/v1/matchmaking/cancel', (req, res) => {
    const playerId = req.body.playerId || req.body.userId;
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
    const activeMatch = matchmakingSystem.findMatchByPlayerId(playerId);
    if (activeMatch) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(activeMatch));
    }
    const isQueued = matchmakingSystem.isPlayerQueued(playerId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        success: true,
        status: isQueued ? 'SEARCHING' : 'IDLE',
        isQueued
    }));
});

router.add('GET', '/api/v1/game/connect', (req, res) => {
    const matchId = req.query.matchId;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        success: true,
        matchId: matchId || 'UNKNOWN',
        serverStatus: 'ONLINE',
        host: 'hshgobackobt4.onrender.com'
    }));
});

router.add('GET', '/api/v1/inventory/:playerId', (req, res) => {
    const inv = db.inventoryData.get(req.params.playerId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, inventory: inv ? Object.fromEntries(inv) : {} }));
});

router.add('GET', '/health', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: 'OK',
        server: config.get('publicServerUrl'),
        queueSize: matchmakingSystem.queue.length,
        activeMatches: matchmakingSystem.activeMatches.size,
        uptime: process.uptime()
    }));
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
    Logger.info(`HSHO Server listening on ${HOST}:${PORT} | Domain: ${config.get('publicServerUrl')}`);
});

module.exports = server;
