/* global describe it expect */

process.on('unhandledRejection', (reason, promise) => {
    console.log(reason, promise);

    return Promise.resolve();
});


const RMQX = require('rmq-exchange');
const cfg = {
    user: 'guest',
    pass: 'guest',
    host: 'localhost',
    port: 5672,
    admin: 15672,
};

describe('RMQ-Exchange', () => {
    it('should pass', () => expect(true).toBe(true));
    it('should return a singleton', () => expect(typeof RMQX).toBe('object'));

    it('should be initialized', () => {
        const config = RMQX.config;

        expect(config.pass).toBe(cfg.pass);
        expect(config.user).toBe(cfg.user);
        expect(config.host).toBe(cfg.host);
        expect(config.port).toBe(cfg.port);
        expect(config.adminPort).toBe(cfg.admin);
    });

    it('should create a channel', () => {
        return RMQX.channel
            .then(Channel => {
                expect(RMQX.state.connection).toBeDefined();
                expect(RMQX.state.channel).toBeDefined();
                expect(Channel.connection).toBeDefined();
                expect(Channel.ch).toBe(1);
            })
    });

    it('should create and close a channel', () => {
        return RMQX.channel
            .then(() => RMQX.close)
            .then(() => {
                expect(RMQX.state.channel).toBe(undefined);
            });
    });

    it('should publish a message to a the exchange', () => {
        return RMQX.publishTo('Campaigns', 'create', { 'msg': 'Hello World' })
            .then(results => expect(results).toBe(true));
    });

    it('should publish a message to the queue', () => {
        return RMQX.queue('Campaigns', 'create', { 'msg': 'Hello World' })
            .then(results => expect(results).toBe(true));
    });

    it('should consume a message in the queue', (done) => {
        RMQX.queue('Campaigns', 'create', { 'msg': 'Hello World' })
            .then(() => RMQX.consumeFrom('Campaigns', 'create', (msg, ch) => {
                expect(msg.content.toString()).toBe(JSON.stringify({ msg: 'Hello World' }));
                ch.ack(msg);
            }));

        done();
    });
});
