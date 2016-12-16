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
        .then(() => Promise.all([
            bindQueues(),
            createConsumers(),
        ]))
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
            channel.publishTo = publishTo;
            channel.queue = queue;

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
            Object.keys(q.actions).forEach(action => {
                acc.concat([channel.assertQueue(`${q.key}.${action}`, q.actions[action].options)]);
            });

            return acc;
        }, [createChannel()])))
        .then(response => response[0].close())
        .catch(err => { throw err; });
}

function createExchanges() {
    return createChannel()
        .then(channel => Promise.all(config.exchanges.reduce((acc, x) => {
            acc.concat([channel.assertExchange(x.key, x.type, x.options)]);
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

function createConsumers() {
    return createChannel()
        .then(channel => {
            config.queues.forEach(q => {
                Object.keys(q.actions).forEach(action => {
                    const queue = q.actions[action];

                    if (findExchange(queue.source)) {
                        channel.consume(`${q.key}.${action}`, (msg) => queue.consume(msg, channel));
                    }
                });
            });
        })
        .catch(err => { throw err; });
}

function findExchange(name) {
    return config.exchanges.find(obj => obj.name === name);
}

function bindQueues() {
    return createChannel()
        .then(channel => Promise.all(config.queues.reduce((acc, q) => {
            Object.keys(q.actions).forEach(action => {
                const queue = q.actions[action];

                const exchange = findExchange(queue.source);

                if (findExchange(queue.source) && !queue.noBind) {
                    acc.concat([channel.bindQueue(`${q.key}.${action}`, exchange.key, `${queue.pattern || queue.routingKey}`)]);
                }
            });

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

function publishTo(q, action, content, options) {
    const queue = config.queues.filter(arr => {
        return arr.name = q;
    })[0].actions[action];

    return this.publish(queue.key, queue.routingKey, Buffer.from(content), options);
}

function queue(q, action, content, options) {
    const queue = config.queues.filter(arr => {
        return arr.name = q;
    })[0];

    return this.sendToQueue(`${queue.key}.${action}`, Buffer.from(content), options);
}
