const amqp = require('amqplib');

const config = {
    queues: [
        // {
        //     name: null,
        //     options: {},
        //     binding: {
        //         source: null,
        //         routingKey: null,
        //     },
        // }
    ],
    exchange: null,
    user: process.env.RABBITMQ_DEFAULT_USER || null,
    pass: process.env.RABBITMQ_DEFAULT_PASS || null,
    host: process.env.RABBITMQ_HOST || null,
    ssl: false,
    port: 5672,
    connection: null,
};

module.exports = exports = function init(cfg, callback = checkCB) {
    return init(cfg, callback)
        .then((response) => {
            return {
                connect,
                channel,
            };
        })
        .catch((err) => fail(err, Promise.reject, callback));
};

// -------------------------------------

function init(cfg, callback = checkCB) {
    // setup configuration
    config = Object.keys(cfg).reduce((acc, key) => {
        if (key) acc[key] = cfg[key];

        return acc;
    }, config);

    return new Promise((resolve, reject) => {
        resolve(config);
        return callback(null, config);
    });
}

function connect(options, callback = checkCB) {
    return new Promise((resolve, reject) => {
        // define params
        const pcl = (config.ssl) ? 'amqps://' : 'amqp://';
        const url = `${pcl}${config.user}:${config.pass}@${config.host}`;

        // utilize promises, fallback to callback
        amqp.connect(url, options)
            .then((connection) => { 
                config.connection = connection;
                config.connection.channel = channel;
            })
            .then((connection) => respond(config.connection, resolve, callback))
            .catch((err) => fail(err, reject, null, callback));
    });
}

function channel(callback = checkCB) {
    return new Promise((resolve, reject) => {
        config.connection.createChannel()
            .then((channel) => patchChannel(channel))
            .then((channel) => respond(channel, resolve, callback))
            .catch((err) => fail(err, reject, null, callback));
    }); 
}

// -------------------------------------

function createQueues(queues, callback = checkCB) {
    let channel;

    return new Promise((resolve, reject) => {
        config.connection.createChannel()
            .then((response) => { channel = response; }) 
            .then(() => Promise.all(queues.reduce((acc, q) => {
                return acc.concat([channel.assertQueue(q.name, q.options)]);
            }, [])))
            .then((response) => respond(response, resolve, callback))
            .then(() => channel.close())
            .catch((err) => fail(err, reject, channel, callback));
    });
}

function bindQueues(queues, callback = checkCB) {
    let channel;

    return new Promise((resolve, reject) => {
        config.connection.createChannel()
            .then((response) => { channel = response; })
            .then(() => Promise.all(queues.reduce((acc, q) => {
                return acc.concat([channel.bindExchange(q.name, `${q.binding.source || config.exchange}` , q.binding.routingKey)]);
            }, [])))
            .then((response) => respond(response, resolve, callback))
            .then(() => channel.close())
            .catch((err) => fail(err, reject, channel,  callback));
    });
}

function publishToExchange(routingKey, content, options, callback = checkCB) {
    let channel;

    return new Promise((resolve, reject) => {
        config.connection.createChannel()
            .then((response) => { channel = response; })
            .then(() => channel.publish(config.exchange, routingKey, content, options))
            .then((response) => respond(response, resolve, callback))
            .then(() => channel.close())
            .catch((err) => fail(err, reject, channel, callback));
    });
}

function publishToQueue(queue, content, options, callback = checkCB) {
    let channel;

    return new Promise((resolve, reject) => {
        config.connection.createChannel()
            .then((response) => { channel = response; })
            .then(() => channel.sendToQueue(queue, content, options))
            .then((response) => respond(response, resolve, callback))
            .then(() => channel.close())
            .catch((err) => fail(err, reject, channel, callback));
    });
}

// -------------------------------------

/**
 * patchChannel
 * add aliases to the channel for sending messages to queue and exchange
 */
function patchChannel(channel) {
    channel.publishToExchange = publishToExchange;
    channel.publishToQueue = publishToQueue;

    return Promise.resolve(channel);
}

/**
 * checkCB
 * helper to instantiate a callback where required
 */
function checkCB(callback) {
    return (callback) ? callback : function() {};
}

/**
 * respond
 * helper to prevent writing the same promise/callback every time
 */
function respond(response, promiseResolver, callback) {
    promiseResolve(response);

    return callback(null, response);
}

/**
 * fail
 * helper to prevent writing the same promise/callback every time
 */
function fail(err, promiseRejecter, channel, callback) {
    if (channel) channel.close;

    promiseRejecter(err);

    return callback(err);
}
