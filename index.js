const amqp = require('amqplib');
const http = require('http');
const rabbitConfig = require('rabbit-config.js');

const state = {
    connection: null,
    channel: null,
    config: {},
};

const _ = {
    contentToBuffer,
    generateConfiguration,
    create,
    connection,
    channel,
    createQueues,
    createExchanges,
    createPolicies,
    createUpstreams,
    bindQueues,
    findExchange,
    createConsumers,
    close,
};

// API for interacting with Rabbit MQ
// ==================================
// Public APIs
// - initialize - shouldn't be called all the time only on reconnection
// - channel
// - publishTo
// - consumeFrom
// - queue


class RMQ {
    constructor() {
        this.initialize();
        this.consumers = [];
    }

    initialize() {

        const promises = [];

        if (!Object.keys(state.config).length) {
            promises.push(_.generateConfiguration());
        }

        return Promise.all(promises)
            .then(() => _.create());
    }


    get config() {
        return state.config;
    }

    get state() {
        return state;
    }

    channel() {
        return _.channel();
    }

    close() {
        return _.close();
    }

    connect(host, port) {
        return _.generateConfiguration(host, port).then((config) => {
            return _.connection();
        }).then((con) => {
            return _.create();
        }).then(() => {
            if (this.consumers && this.consumers.length) {
                this.consumers.forEach((consumer) => {
                    this.consumeFromWaitQueue(consumer.q, consumer.action, consumer.callback);
                });
            }
        }).catch((err) => { throw err; });
    }

    publishTo(q, action, content, options) {
        return channel()
            .then(Channel => {
                const queue = state.config.queues.filter(arr => arr.name === q)[0].actions[action];

                const exchange = _.findExchange(queue.source);
                const buffer = _.contentToBuffer(content);

                const results = Channel.publish(exchange.key, queue.routingKey, buffer, options);

                // blocking loop
                while (!results) { console.info('broadcasting'); };

                if (!results) throw new Error(results);

                return results;
            })
            .catch(err => { throw err; });
    }

    /**
     * Wait for the queue to be created
     * @param q {String} Queue key
     * @param action {String} Queue action
     * @param opts {Object} An object that might carry options for channel.assertQueue
     * @returns {Promise}
     */
    assertQueue(q, action, opts = {}) {
        const queue = state.config.queues.filter(arr => arr.name === q)[0];

        if (!q) {
            return Promise.reject(`No queue ${q} with action ${action} found`);
        }

        return _.channel()
        .then(() => {
            return state.channel.then((ch) => {
                return ch.assertQueue(`${queue.key}.${action}`, opts);
            });
        })
        .catch(err => { throw err; });
    }

    /**
     * Set consuming callback to the queue that might not has been yet created
     * @param q {String} Queue key
     * @param action {String} Queue action
     * @param callback {Function} An object that might carry options for channel.assertQueue
     */
    consumeFromWaitQueue(q, action, callback) {
        this.consumers.push({ q, action, callback });
        return this.assertQueue(q, action)
        .then(() => {
            this.consumeFrom(q, action, (msg, _channel) => {
                callback(msg, _channel);
            });
        })
        .catch((err) => { console.error(`rmq-exchange failed setting up consumer ${q}-${action}.`, err.toString()); });
    }

    consumeFrom(q, action, callback) {
        const queue = state.config.queues.filter(arr => arr.name === q)[0];

        return new Promise((resolve, reject) => {
            _.channel()
                .then(channel => {
                    channel.consume(`${queue.key}.${action}`, (msg) => callback(msg, channel));
                })
                .catch(err => reject(err));
        });
    }


    queue(q, action, content, options) {
        const queue = state.config.queues.filter(arr => arr.name = q)[0];

        return _.channel()
            .then(Channel => {
                return Channel.sendToQueue(`${queue.key}.${action}`, _.contentToBuffer(content), options);
            })
            .catch(err => { throw err; });
    }
}

module.exports = new RMQ();


// -------------------------------------


function contentToBuffer(content) {
    return (typeof content === 'object')
        ? new Buffer(JSON.stringify(content))
        : new Buffer(content);
}


function generateConfiguration(host, port) {
    if (!host) host = process.env.RABBITMQ_HOST;
    if (!port) port = 5672;
    return new Promise((resolve, reject) => {
        state.config = {
            protocol: (process.env.RABBITMQ_SSL_ENABLED) ? 'amqps://' : 'amqp://',
            user: process.env.RABBITMQ_DEFAULT_USER || null,
            pass: process.env.RABBITMQ_DEFAULT_PASS || null,
            host: host,
            port: port,
            adminPort: process.env.RABBITMQ_ADMIN_PORT || 15672,
            queues: [],
            exchanges: [],
            policies: [],
            upstreams: [],
        };

        state.config.url = `${state.config.protocol}${state.config.user}:${state.config.pass}@${state.config.host}`;

        Object.keys(rabbitConfig).reduce((acc, key) => {
            acc[key] = rabbitConfig[key];

            return acc;
        }, state.config);

        return resolve(state.config);
    });
}

function create() {
    const promises = [];

    if (!state.config) {
        promises.push(generateConfiguration());
    }

    return Promise.all(promises)
        .then(() => {
            if (!state.config) {
                throw new Error('No Configuration');
            }

            return;
        })
        .then(() => _.createQueues())
        .then(() => _.createExchanges())
        .then(() => _.createPolicies())
        .then(() => _.createUpstreams())
        .then(() => _.bindQueues())
        .then(() => _.createConsumers())
        .catch(err => { console.error('rmq-exchange failed to create all resources.', err.toString()); });
}

function connection() {
    if (state.connection) {
        return state.connection;
    }

    state.connection = amqp.connect(state.config.url)
        .then(con => {
            return con;
        })
        .catch(err => { throw err; });
    return state.connection;
}

function channel() {
    if (state.channel) return state.channel;

    state.channel = connection().then(con => {

            return con.createChannel();
        })
        .catch(err => { throw err; });
    return state.channel;
}


function createQueues() {
    return _.channel()
        .then(Channel => Promise.all(state.config.queues.reduce((acc, q) => {
            Object.keys(q.actions).forEach(action => {
                acc.concat([Channel.assertQueue(`${q.key}.${action}`, q.actions[action].options)]);
            });

            return acc;
        }, [Channel])))
        .catch(err => { throw err; });
}

function createExchanges() {
    return _.channel()
        .then(Channel => Promise.all(state.config.exchanges.reduce((acc, x) => {
            acc.concat([Channel.assertExchange(x.key, x.type, x.options)]);

            return acc;
        }, [Channel])))
        .catch(err => { throw err; });
}

function createPolicies() {
    const promises = state.config.policies.reduce((acc, p) => {
        acc.concat([createPolicy(p)]);
        return acc;
    }, []);

    return Promise.all(promises);


    function createPolicy(policy) {
        policy.vhost = policy.vhost || '/';

        const options = {
            method: 'PUT',
            path: `/api/policies/${encodeURIComponent(policy.vhost)}/${encodeURIComponent(policy.name)}`,
            auth: `${state.config.user}:${state.config.pass}`,
            hostname: `${state.config.host}`,
            port: state.config.adminPort,
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
}



function createUpstreams() {
    return Promise.all(state.config.upstreams.reduce((acc, u) => {
        return acc.concat([_.createUpstream(u)]);
    }, []));


    function createUpstream(upstream) {
        upstream.vhost = upstream.vhost || '/';
        const path = `${encodeURIComponent(upstream.vhost)}/${encodeURIComponent(upstream.name)}`;

        const options = {
            method: 'PUT',
            path: `/api/parameters/federation-upstream/${path}`,
            auth: `${state.config.user}:${state.config.pass}`,
            hostname: `${state.config.host}`,
            port: state.config.adminPort,
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
}


function bindQueues() {
    return _.channel()
        .then(Channel => Promise.all(state.config.queues.reduce((acc, q) => {
            Object.keys(q.actions).forEach(action => {
                const queue = q.actions[action];

                const exchange = _.findExchange(queue.source);
                const queueAction = `${q.key}.${action}`;
                const routing = queue.pattern || queue.routingKey;

                if (exchange && !queue.noBind) {
                    acc.concat([
                        Channel.bindQueue(queueAction, exchange.key, routing),
                    ]);
                }
            });

            return acc;
        }, [Channel])))
        .catch(err => { throw err; });
}

function findExchange(name) {
    return state.config.exchanges.find(obj => obj.name === name);
}

function createConsumers() {
    return _.channel()
        .then(Channel => {
            state.config.queues.forEach(q => {
                Object.keys(q.actions).forEach(action => {
                    const queue = q.actions[action];

                    if (queue.consume && _.findExchange(queue.source)) {
                        Channel.consume(`${q.key}.${action}`, (msg) => queue.consume(msg, Channel));
                    }
                });
            });
        })
        .catch(err => { throw err; });
}

function close() {
    if (!state.connection) {
        return Promise.resolve();
    }
    return state.channel.then((ch) => {
            if (ch) ch.close();
        }).then(() => {
            state.channel = null;
            return state.connection;
        }).then((con) => {
            if (con) con.close();
        }).then(() => {
            state.connection = null;
        }).catch((err) => {
            state.channel = null;
            state.connection = null;
        });
}
