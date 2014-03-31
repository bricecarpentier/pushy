var http = require('http');

var nconf = require('nconf'),
    redis = require('redis'),
    async = require('async'),
    koa   = require('koa'),
    route = require('koa-route'),
    parse = require('co-body');

var agents = require('./agents');

nconf.env().argv();

const REDIS_HOST     = nconf.get('DB_REDIS_HOST') || "localhost";
const REDIS_PORT     = parseInt(nconf.get('DB_REDIS_PORT') || "6379", 10) ;
const REDIS_PASSWORD = nconf.get('DB_REDIS_PASSWORD');
const REDIS_INDEX    = nconf.get('DB_REDIS_INDEX');

const MASTER_KEY = nconf.get('MASTER_KEY');
if (!MASTER_KEY) {
    console.log("a master key needs to be set");
    process.exit(1);
}

/*****************************************************************************
 *                               REDIS SETUP                                 *
 *****************************************************************************/

var db = redis.createClient(REDIS_PORT, REDIS_HOST);

if (REDIS_PASSWORD)
    db.auth(REDIS_PASSWORD);

if (REDIS_INDEX)
    db.select(REDIS_INDEX);

db.on('error', function() {
    console.log('could not connect to the database server');
    process.exit(2);
});
db.on('failed', function() {
    console.log('connection to the database server failed');
    process.exit(3);
})

/*****************************************************************************
 *                               ACTUAL APP                                  *
 *****************************************************************************/

var app = koa();

app.use(function *(next) {
    try {
        yield next;
    } catch (err) {
        console.log(err);
        this.status = err.status || 500;
        this.body = err.message || http.STATUS_CODES[this.status];
    }
});

var require_app_authentication = function *(next) {
    console.log('require_app_authentication');
    console.log(this.request);
    var headers = this.request.header;
    var applicationId = headers['x-pushy-application-id'];
    var apiKey = headers['x-pushy-rest-api-key'];

    if (!applicationId) {
        this.throw('the X-Pushy-Application-Id header must be provided', 401);
        return;
    }

    if (!apiKey) {
        this.throw('the X-Pushy-REST-API-Key header must be provided', 401);
        return;
    }

    console.log("looking for app:" + applicationId);
    var app = yield db.hgetall.bind(db, "app:" + applicationId);

    if (!app) {
        this.throw('no application found for id "' + applicationId + '"', 404);
        return;
    } else if (app.rest_api_key !== apiKey) {
        this.throw('wrong api key', 401);
        return;
    }
    app.objectId = applicationId;

    this.app = app;

    yield next;
};

app.use(route.post('/1/push', require_app_authentication));
app.use(route.post('/1/push', function *() {

    var message = yield parse(this, {limit: '1kb'});
    var devices = message.devices || [];
    delete message.devices;

    if (!devices.length) {
        this.throw("no device to send to");
        return;
    }

    for (var i=0,l=devices.length ; i<l ; i++) {
        var device = devices[i];
        if (!(typeof(device) == "object" && device.hasOwnProperty('deviceType') && device.hasOwnProperty('token'))) {
            this.throw("unrecognizable device: " + JSON.stringify(device), 400);
        }
    }
    
    var results = yield agents.send.bind(agents, app, devices, message);

    this.body = "OK";
}));

app.listen(parseInt(nconf.get('PORT'), 10) || 3000);
