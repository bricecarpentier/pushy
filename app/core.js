var http = require('http');

var nconf = require('nconf'),
    redis = require('redis'),
    koa   = require('koa'),
    route = require('koa-route'),
    parse = require('co-body');

var agents = require('./agents');

var startPushy = function(options) {
    var db = createDatabase(options.db_port || 6379, options.db_host || 'localhost', options.db_password, options.db_index);
    db.on('error', function(err) {
        console.log('could not connect to the database server:', err);
        process.exit(2);
    });
    db.on('failed', function(err) {
        console.log('connection to the database server failed', err);
        process.exit(3);
    });

    agents.database = db;


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

        var message = yield parse(this, {limit: '100kb'});
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
        
        try {
            var results = yield agents.send.bind(agents, this.app, devices, message);
            this.body = JSON.stringify(results);
        } catch (err) {
            this.body = "KO";
        }
    }));

    var address = options.ip_address || "127.0.0.1";
    var port = options.port || 3000;
    app.listen(port, address, function() {
        console.log("%s: Pushy started on %s:%d", Date(Date.now()), address, port);
    });
};


function createDatabase(port, host, password, index) {
    var db = redis.createClient(port, host);
    if (password)
        db.auth(password);

    if (index)
        db.select(index);

    return db;
}

exports.startPushy = startPushy;