const amqp = require('amqplib');
const http = require('http');

let config = {
    _constructed: false,
    user: process.env.RABBITMQ_DEFAULT_USER || null,
    pass: process.env.RABBITMQ_DEFAULT_PASS || null,
    host: process.env.RABBITMQ_HOST || null,
    ssl: process.env.RABBITMQ_SSL_ENABLED || false,
    port: process.env.RABBITMQ_PORT || 5672,
    adminPort: process.env.RABBITMQ_ADMIN_PORT || 15672,
    queues: [],
    exchanges: [],
    policies: [],
};

exports = module.exports = createRMQ.rmq = createRMQ.default = createRMQ;

function createRMQ(cfg) {
    const rmq = {};
    rmq.config = initializeConfig(cfg);

    connection()
        .then(() => Promise.all([
            createQueues(),
            createExchanges(),
            createPolicies(),
            createUpstreams(),
        ]))
        .then(() => bindQueues())
        .catch(err => { throw err; });

    rmq.channel = createChannel;
    rmq.connect = createConnection;

    return rmq;
}

function initializeConfig(cfg) {
    if (!cfg) return config;

    // setup configuration
    config = Object.keys(cfg).reduce((acc, key) => {
        if (key) acc[key] = cfg[key];

        return acc;
    }, config);

    const protocol = (config.ssl) ? 'amqps://' : 'amqp://';
    config.url = `${protocol}${config.user}:${config.pass}@${config.host}`;

    config._constructed = true;
    return config;
}

function createConnection(options) {
    return amqp.connect(config.url, options)
        .then(connection => {
            config.connection = connection;
            return connection;
        })
        .catch(err => { throw err; });
}

function createChannel() {
    return connection()
        .then(() => config.connection.createChannel())
        .then(channel => {
            channel.queue = sendToQueueOverride;
            return channel;
        })
        .catch(err => { throw err; });
}

function connection() {
    return new Promise((resolve, reject) => {
        if (config.connection) return resolve(config.connection);

        return resolve(createConnection());
    });
}

function createQueues() {
    return createChannel()
        .then(channel => Promise.all(config.queues.reduce((acc, q) => {
            acc.concat([channel.assertQueue(q.name, q.options)]);
            return acc;
        }, [createChannel()])))
        .then(response => response[0].close())
        .catch(err => { throw err; });
}

function createExchanges() {
    return createChannel()
        .then(channel => Promise.all(config.exchanges.reduce((acc, x) => {
            acc.concat([channel.assertExchange(x.name, x.type, x.options)]);
            return acc;
        }, [createChannel()])))
        .then(response => response[0].close())
        .catch(err => { throw err; });
}

function createPolicies() {
    return Promise.all(config.policies.reduce((acc, p) => {
        acc.concat([createPolicy(p)]);
        return acc;
    }, []))
        .catch(err => { throw err; });
}

function createUpstreams() {
    return Promise.all(config.upstreams.reduce((acc, u) => {
        acc.concat([createUpstream(u)]);
        return acc;
    }, []))
        .catch(err => { throw err; });
}

function bindQueues() {
    return createChannel()
        .then(channel => Promise.all(config.queues.reduce((acc, q) => {
            acc.concat([channel.bindQueue(q.name, q.binding.source, q.binding.routingKey)]);
            return acc;
        }, [createChannel()])))
        .then(response => response[0].close())
        .catch(err => { throw err; });
}

function createPolicy(policy) {
    policy.vhost = policy.vhost || '/';

    const options = {
        method: 'PUT',
        path: `/api/policies/${encodeURIComponent(policy.vhost)}/${encodeURIComponent(policy.name)}`,
        auth: `${config.user}:${config.pass}`,
        hostname: `${config.host}`,
        port: config.adminPort,
        headers: {
            'Content-Type': 'application/json',
        },
    };

    return new Promise((resolve, reject) => {
        const req = http.request(options, res => resolve(res));
        req.on('error', err => reject(err));
        req.write(JSON.stringify(policy));
        req.end();
    });
}

function createUpstream(upstream) {
    upstream.vhost = upstream.vhost || '/';
    const path = `${encodeURIComponent(upstream.vhost)}/${encodeURIComponent(upstream.name)}`;

    const options = {
        method: 'PUT',
        path: `/api/parameters/federation-upstream/${path}`,
        auth: `${config.user}:${config.pass}`,
        hostname: `${config.host}`,
        port: config.adminPort,
        headers: {
            'Content-Type': 'application/json',
        },
    };

    return new Promise((resolve, reject) => {
        const req = http.request(options, res => resolve(res));
        req.on('error', err => reject(err));
        req.write(JSON.stringify(upstream));
        req.end();
    });
}

function sendToQueueOverride(queue, content, options) {
    return this.sendToQueue(queue, Buffer.from(content), options);
}

