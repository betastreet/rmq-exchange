const amqp = require('amqplib');
const http = require('http');
const rabbitConfig = require('rabbit-config.js') || null;
const log = require('debug')('rmq');


class RMQ {
    constructor(customConfig) {
        log('Constructing RMQ Class');

        const self = this;

        this.protocol = (process.env.RABBITMQ_SSL_ENABLED) ? 'amqps://' : 'amqp://';
        this.user = process.env.RABBITMQ_DEFAULT_USER || null;
        this.pass = process.env.RABBITMQ_DEFAULT_PASS || null;
        this.host = process.env.RABBITMQ_HOST || null;
        this.port = process.env.RABBITMQ_PORT || 5672;
        this.adminPort = process.env.RABBITMQ_ADMIN_PORT || 15672;
        this.url = `${this.protocol}${this.user}:${this.pass}@${this.host}`;
        this.queues = [];
        this.exchanges = [];
        this.policies = [];
        this.upstreams = [];
        this.existingConnection = null;
        this.existingChannel = null;

        this._configured = false;

        const cfg = rabbitConfig || customConfig || null;

        this.config(cfg)
            .then(() => self._pause())
            .then(() => self.create())
            .catch(err => { log(err); });
    }

    _pause() {
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                log('executing timeout');
                resolve(true)
            }, 15000);
        });
    }

    config(cfg) {
        log('config(cfg)');

        let self = this;

        const config = Object.keys(cfg).reduce((acc, key) => {
            if (acc[key]) acc[key] = cfg[key];

            return acc;
        }, self);

        this._configured = true;

        return Promise.resolve(this);
    }


    connection() {
        log('connection()');

        const self = this;

        return new Promise((resolve, reject) => {
            if (self.existingConnection) return resolve(self.existingConnection);

            return resolve(this._createConnection());
        })
        .catch(err => { throw err; });
    }


    // close() {
        // log('close()');

        // const self = this;

        // return self.connection()
            // .then(connection => connection.close())
            // .then(() => self.existingConnection = null)
            // .catch(err => { throw err; });
    // }


    connect(host) {
        log('connect(host)');

        const self = this;

        self.url = `${this.protocol}${this.user}:${this.pass}@${host}`;

        return self._createConnection();
    }


    channel() {
        log('channel()');

        return this._createChannel()
            .catch(err => { throw err; });
    }


    create(cfg) {
        log('create(cfg)');

        const self = this;

        if (cfg) this.config(cfg);

        if (!this._configured) throw new Error('No configuration');

        return this.connection()
            .then(() => self._createQueues())
            .then(() => self._createExchanges())
            .then(() => self._createPolicies())
            .then(() => self._createUpstreams())
            .then(() => self._bindQueues())
            .then(() => self._createConsumers())
            .then(() => self)
            .catch(err => { throw err; });
    }


    _createConnection(options) {
        log('_createConnection(options)');

        const self = this;

        return amqp.connect(this.url, options)
            .then(connection => self.existingConnection = connection)
            .catch(err => { throw err; });
    }


    _createChannel() {
        log('_createChannel()');

        return this.connection()
            .then(connection => connection.createChannel())
            .catch(err => { throw err; });
    }


    _createQueues() {
        log('_createQueues()');

        const self = this;

        return this._createChannel()
            .then(channel => Promise.all(self.queues.reduce((acc, q) => {
                Object.keys(q.actions).forEach(action => {
                    acc.concat([channel.assertQueue(`${q.key}.${action}`, q.actions[action].options)]);
                });

                return acc;
            }, [self._createChannel()])))
            // .then(response => response[0].close())
            .catch(err => { throw err; });
    }


    _createExchanges() {
        log('_createExchanges()');

        const self = this;

        return this._createChannel()
            .then(channel => Promise.all(self.exchanges.reduce((acc, x) => {
                acc.concat([channel.assertExchange(x.key, x.type, x.options)]);

                return acc;
            }, [self._createChannel()])))
            // .then(response => response[0].close())
            .catch(err => { throw err; });
    }


    _createPolicies() {
        log('_createPolicies()');

        const self = this;

        return Promise.all(self.policies.reduce((acc, p) => {
            acc.concat([self._createPolicy(p)]);

            return acc;
        }, []))
        .catch(err => { throw err; });
    }


    _createUpstreams() {
        log('_createUpstreams()');

        const self = this;

        return Promise.all(self.upstreams.reduce((acc, u) => {
            return acc.concat([self._createUpstream(u)]);
        }, []))
        .catch(err => { throw err; });
    }


    _createConsumers() {
        log('_createConsumers()');

        const self = this;

        return this._createChannel()
            .then(channel => {
                self.queues.forEach(q => {
                    Object.keys(q.actions).forEach(action => {
                        const queue = q.actions[action];

                        if (queue.consume && self._findExchange(queue.source)) {
                            channel.consume(`${q.key}.${action}`, (msg) => queue.consume(msg, channel));
                        }
                    });
                });
            })
            .catch(err => { throw err; });
    }


    _findExchange(name) {
        log('_findExchange(name)');

        return this.exchanges.find(obj => obj.name === name);
    }


    _bindQueues() {
        log('_bindQueues()');

        const self = this;

        return this._createChannel()
            .then(channel => Promise.all(self.queues.reduce((acc, q) => {
                Object.keys(q.actions).forEach(action => {
                    const queue = q.actions[action];

                    const exchange = self._findExchange(queue.source);
                    const queueAction = `${q.key}.${action}`;
                    const routing = queue.pattern || queue.routingKey;

                    if (exchange && !queue.noBind) {
                        acc.concat([
                            channel.bindQueue(queueAction, exchange.key, routing),
                        ]);
                    }
                });

                return acc;
            }, [self._createChannel()])))
            // .then(response => response[0].close())
            .catch(err => { throw err; });
    }


    _createPolicy(policy) {
        log('_createPolicy(policy');

        policy.vhost = policy.vhost || '/';

        const options = {
            method: 'PUT',
            path: `/api/policies/${encodeURIComponent(policy.vhost)}/${encodeURIComponent(policy.name)}`,
            auth: `${this.user}:${this.pass}`,
            hostname: `${this.host}`,
            port: this.adminPort,
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


    _createUpstream(upstream) {
        log('_createUpstream(upstream)');

        upstream.vhost = upstream.vhost || '/';
        const path = `${encodeURIComponent(upstream.vhost)}/${encodeURIComponent(upstream.name)}`;

        const options = {
            method: 'PUT',
            path: `/api/parameters/federation-upstream/${path}`,
            auth: `${this.user}:${this.pass}`,
            hostname: `${this.host}`,
            port: this.adminPort,
            headers: {
                'Content-Type': 'application/json',
            },
        };

        return new Promise((resolve, reject) => {
            const req = http.request(options, res => resolve(res));
            req.on('error', err => reject(err));
            req.write(JSON.stringify(upstream));
            req.end();
        })
        .catch(err => { throw err; });

    }


    publishTo(q, action, content, options) {
        log('publishTo(q, action, content, options)');

        const self = this;

        return self._createChannel()
            .then(channel => {
                const queue = self.queues.filter(arr => arr.name === q)[0].actions[action];

                const exchange = self._findExchange(queue.source);
                const buffer = self._contentToBuffer(content);

                const results = channel.publish(exchange.key, queue.routingKey, buffer, options);

                // blocking loop
                while (results === undefined) { console.info('broadcasting'); };

                if (!results) throw new Error(results);

                return results;
            })
            .catch(err => { throw err; });
    }


    queue(q, action, content, options) {
        log('queue(q, action, content, options)');

        const self = this;
        const queue = this.queues.filter(arr => arr.name = q)[0];

        return this._createChannel()
            .then(channel => {
                return channel.sendToQueue(`${queue.key}.${action}`, self._contentToBuffer(content), options);
            })
            .catch(err => { throw err; });
    }

    _contentToBuffer(content) {
        log('_contentToBuffer(content)');

        return (typeof content === 'object')
            ? new Buffer(JSON.stringify(content))
            : new Buffer(content);
    }

}

module.exports = exports = new RMQ();

