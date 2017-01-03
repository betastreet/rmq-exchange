const amqp = require('amqplib');
const http = require('http');
const rabbitConfig = require('rabbit-config.js') || null;


class RMQ {
    constructor() {
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


        if (rabbitConfig) this.config(rabbitConfig);
    }


    config(cfg) {
        let self = this;

        const config = Object.keys(cfg).reduce((acc, key) => {
            if (acc[key]) acc[key] = cfg[key];

            return acc;
        }, self);

        this._configured = true;

        return this;
    }


    connection() {
        const self = this;

        return new Promise((resolve, reject) => {
            if (self.existingConnection) return resolve(self.existingConnection);

            return resolve(this._createConnection());
        })
        .catch(err => { throw err; });
    }


    close() {
        const self = this;

        return self.connection()
            .then(connection => connection.close())
            .then(() => self.existingConnection = null)
            .catch(err => { throw err; });
    }


    connect(host) {
        const self = this;

        self.url = `${this.protocol}${this.user}:${this.pass}@${host}`;

        return self._createConnection();

        return
    }


    channel() {
        const self = this;

        return new Promise((resolve, reject) => {
            if (self.existingChannel) return resolve(self.existingChannel);

            return resolve(self._createChannel());
        })
        .catch(err => { throw err; });
    }


    create(cfg) {
        const self = this;

        if (cfg) this.config(cfg);

        if (!this._configured) throw new Error('No configuration');

        return this.connection()
            .then(() => Promise.all([
                this._createQueues(),
                this._createExchanges(),
                this._createPolicies(),
                this._createUpstreams(),
            ]))
            .then(() => Promise.all([
                this._bindQueues(),
                this._createConsumers(),
            ]))
            .then(() => self)
            .catch(err => { throw err; });
    }


    _createConnection(options) {
        const self = this;

        console.log(self.url);

        return amqp.connect(this.url, options)
            .then(connection => self.existingConnection = connection)
            .catch(err => { throw err; });
    }


    _createChannel() {
        const self = this;

        return self.connection()
            .then(connection => connection.createChannel())
            .then(channel => {
                self.existingChannel = channel;
                self.existingChannel.publishTo = self.publishTo.bind({ self: self, channel });
                self.existingChannel.queue = self.queue.bind({ self: self, channel });

                return self.existingChannel;
            })
            .catch(err => { throw err; });
    }


    _createQueues() {
        const self = this;

        return this._createChannel()
            .then(channel => Promise.all(self.queues.reduce((acc, q) => {
                Object.keys(q.actions).forEach(action => {
                    acc.concat([channel.assertQueue(`${q.key}.${action}`, q.actions[action].options)]);
                });

                return acc;
            }, [self._createChannel()])))
            .then(response => response[0].close())
            .catch(err => { throw err; });
    }


    _createExchanges() {
        const self = this;

        return this._createChannel()
            .then(channel => Promise.all(self.exchanges.reduce((acc, x) => {
                acc.concat([channel.assertExchange(x.key, x.type, x.options)]);

                return acc;
            }, [self._createChannel()])))
            .then(response => response[0].close())
            .catch(err => { throw err; });
    }


    _createPolicies() {
        const self = this;

        return Promise.all(self.policies.reduce((acc, p) => {
            acc.concat([self._createPolicy(p)]);

            return acc;
        }, []))
        .catch(err => { throw err; });
    }


    _createUpstreams() {
        const self = this;

        return Promise.all(self.upstreams.reduce((acc, u) => {
            return acc.concat([self._createUpstream(u)]);
        }, []))
        .catch(err => { throw err; });
    }


    _createConsumers() {
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
        return this.exchanges.find(obj => obj.name === name);
    }


    _bindQueues() {
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
            .then(response => response[0].close())
            .catch(err => { throw err; });
    }


    _createPolicy(policy) {
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
        const { self, channel } = this;

        return new Promise((resolve, reject) => {
            const queue = self.queues.filter(arr => arr.name === q)[0].actions[action];

            const exchange = self._findExchange(queue.source);
            const buffer = self._contentToBuffer(content);

            const results = this.channel.publish(exchange.key, queue.routingKey, buffer, options);

            // blocking loop
            while (results === undefined) { console.info('broadcasting'); };

            if (!results) return reject(results);

            return resolve(results);
        });
    }


    queue(q, action, content, options) {
        const queue = this.queues.filter(arr => arr.name = q)[0];

        return this.sendToQueue(`${queue.key}.${action}`, self._contentToBuffer(content), options);
    }

    _contentToBuffer(content) {
        return (typeof content === 'object')
            ? new Buffer(JSON.stringify(content))
            : new Buffer(content);
    }

}

module.exports = exports = new RMQ();

