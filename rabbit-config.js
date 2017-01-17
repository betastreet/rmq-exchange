const $ = (process.env.NODE_ENV === 'production');

module.exports = {
    queues: [{
        name: 'Campaigns',
        key: ($) ? 'campaigns' : 'testCampaigns',
        actions: {
            update: {
                source: 'Campaigns',
                routingKey: ($) ? 'campaign.update' : 'test.campaign.update',
                noBind: true,
                consume: (msg, channel) => {
                    console.info(msg);
                    channel.ack(msg);
                },
            },
            create: {
                source: 'Campaigns',
                routingKey: ($) ? 'campaign.create' : 'test.campaign.create',
            },
            delete: {
                source: 'Campaigns',
                routingKey: ($) ? 'campaign.delete' : 'test.campaign.delete',
                consume: (msg, channel) => {
                    console.log(msg);
                    channel.ack(msg);
                },
            },
        },
    }],

    exchanges: [{
        name: 'Users',
        key: ($) ? 'Users' : 'testUsers',
        type: 'direct',
    }, {
        name: 'Campaigns',
        key: ($) ? 'Campaigns' : 'testCampaigns',
        type: 'direct',
    }],

    policies: [{
        name: ($) ? 'Users Federation' : 'Test Users Federation',
        pattern: ($) ? '^users' : '^testUsers',
        definition: { 'federation-upstream-set': 'all' },
        priority: 0,
        'apply-to': 'all',
    }],

    upstreams: [],
};
