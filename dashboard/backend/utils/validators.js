// utils/validators.js
// Phase 9: Input validation schemas with joi
// Centralizes all request validation for type safety

let Joi;
try {
    Joi = require('joi');
} catch (e) {
    // Fallback: no-op validator when joi isn't installed
    const noOp = () => (req, res, next) => next();
    noOp.schemas = {};
    module.exports = noOp;
    module.exports.schemas = {};
    module.exports.validate = noOp;
    return;
}

// ========================================
// Reusable field schemas
// ========================================
const fields = {
    ip: Joi.string().ip({ version: ['ipv4'] }).required(),
    ipOptional: Joi.string().ip({ version: ['ipv4'] }),
    pcName: Joi.string().min(1).max(64).pattern(/^[a-zA-Z0-9_\-. ]+$/).required(),
    username: Joi.string().min(2).max(64).required(),
    password: Joi.string().min(4).max(128).required(),
    url: Joi.string().uri({ allowRelative: true }).max(2048),
    domain: Joi.string().max(253).pattern(/^[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/),
    positiveInt: Joi.number().integer().positive(),
    limit: Joi.number().integer().min(1).max(1000).default(100),
    text: Joi.string().max(1024),
    role: Joi.string().valid('admin', 'viewer', 'operator').default('viewer'),
};

// ========================================
// Endpoint-specific schemas
// ========================================
const schemas = {
    // Auth
    login: Joi.object({
        username: fields.username,
        password: fields.password,
    }),

    // Deploy
    deploy: Joi.object({
        targetIP: fields.ip,
        username: fields.username,
        password: fields.password,
        credentialId: Joi.number().integer(),
    }).or('password', 'credentialId'),

    // PC status update
    pcStatus: Joi.object({
        pcName: Joi.string().max(64),
        ipAddress: fields.ipOptional,
        cpuUsage: Joi.number().min(0).max(100),
        memoryUsage: Joi.number().min(0).max(100),
    }),

    // PC command
    pcCommand: Joi.object({
        command: Joi.string().min(1).max(512).required(),
        params: Joi.object().default({}),
    }),

    // Blocked sites
    blockedSite: Joi.object({
        url: fields.domain.required(),
    }),

    // Credentials
    credential: Joi.object({
        name: Joi.string().min(1).max(64).default('default'),
        username: fields.username,
        password: fields.password,
        is_default: Joi.number().valid(0, 1).default(0),
    }),

    // Groups
    group: Joi.object({
        name: Joi.string().min(1).max(64).required(),
        description: Joi.string().max(256).allow(''),
        policy: Joi.object(),
    }),

    // Remote command
    remoteCommand: Joi.object({
        ip: fields.ip,
        command: Joi.string().min(1).max(2048).required(),
        credentialId: Joi.number().integer(),
    }),

    // Network scan
    networkScan: Joi.object({
        subnet: Joi.string().pattern(/^\d{1,3}\.\d{1,3}\.\d{1,3}$/).required(),
        startRange: Joi.number().integer().min(1).max(254).default(1),
        endRange: Joi.number().integer().min(1).max(254).default(254),
    }),

    // Query params
    logsQuery: Joi.object({
        pc_name: Joi.string().max(64),
        limit: fields.limit,
    }),

    // Pagination
    pagination: Joi.object({
        page: Joi.number().integer().min(1).default(1),
        limit: fields.limit,
        sort: Joi.string().max(64).default('id'),
        order: Joi.string().valid('asc', 'desc').default('desc'),
    }),
};

// ========================================
// Validation middleware factory
// ========================================
function validate(schemaName, source = 'body') {
    return (req, res, next) => {
        const schema = typeof schemaName === 'string' ? schemas[schemaName] : schemaName;
        if (!schema) return next();

        const data = source === 'body' ? req.body :
            source === 'query' ? req.query :
                source === 'params' ? req.params : req.body;

        const { error, value } = schema.validate(data, {
            abortEarly: false,
            stripUnknown: true,
            convert: true,
        });

        if (error) {
            const details = error.details.map(d => ({
                field: d.path.join('.'),
                message: d.message,
            }));
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                details,
            });
        }

        // Replace with validated + sanitized data
        if (source === 'body') req.body = value;
        else if (source === 'query') req.query = value;
        else if (source === 'params') req.params = value;

        next();
    };
}

module.exports = validate;
module.exports.schemas = schemas;
module.exports.validate = validate;
