var util         = require('util'),
    EventEmitter = require('events').EventEmitter;

var co = require('co');

var apnagent = require('apnagent'),
    gcmagent = require('node-gcm');

var Agent = function(actualAgent) {
    this.actualAgent = actualAgent;
};
util.inherits(Agent, EventEmitter);

Object.defineProperty(Agent.prototype, "actualAgent", {
    enumerable: false,
    configurable: false,
    writable: true
})

Agent.prototype.send = function(token, message, callback) {
};

var GcmAgent = function(actualAgent) {Agent.call(this, actualAgent);};
GcmAgent.prototype = Object.create(Agent.prototype);
GcmAgent.prototype.constructor = GcmAgent;
GcmAgent.prototype.send = function(tokens, message, callback) {
    if (!(tokens instanceof Array))
        tokens = [tokens];

    var m = new gcmagent.Message();

    m.addDataWithObject({
        tickerText: message.alert,
        contentTitle: message.title,
        contentText: message.content,
        parameters: message.payload
    });;

    this.actualAgent.send(m, tokens, 4, function(err, res) {
        if (err)
            callback(err);
        else
        {
            var results = [];
            for (var i=0,l=res.results.length ; i<l ; i++) {
                var item = {
                    deviceType: "android",
                    token: tokens[i]
                };
                if (res.results[i].hasOwnProperty('error'))
                    item.error = res.results[i].error;
                results.push(item);
            }
            callback(null, results);    
        }
    });

    
};

var ApnAgent = function(database, actualAgent, feedback) {
    this.database = database;
    Agent.call(this, actualAgent);
    this.feedback = feedback;
    this.feedback.use(this.handleFeedback.bind(this));

};
ApnAgent.prototype = Object.create(Agent.prototype);
ApnAgent.prototype.constructor = ApnAgent;
ApnAgent.prototype.send = function(tokens, message, callback) {
    var self = this;
    co(function *() {
        var token;
        var functions = [];
        var timestamps = [];
        var a = [];
        for (var i=0,l=tokens.length ; i<l ; i++) {
            token = tokens[i];

            a.push({
                deviceType: "ios",
                deviceToken: token,
            });

            var m = self.actualAgent.createMessage();
            m.alert(message.alert)
            if (message.badge)
                m.badge(message.badge);
            if (message.sound)
                m.sound(message.sound);
            if (message.payload) {
                m.set("ctx", message.payload);
            }
            m.device(token);
            functions.push(m.send.bind(m));

            var flagTimestamp = yield self.database.get.bind(self.database, 'devices_to_remove:ios:' + m.device().toString());
            timestamps.push(flagTimestamp);
        }

        try {
            yield(functions);

            console.log(timestamps);
            for (var j=0,m=a.length ; j<m ; j++) {
                if (timestamps[j] != undefined)
                    a[j].timestamp = parseInt(timestamps[j],10);
            }

            callback(null, a);
        } catch (err) {
            callback(err);
        }
    })();
};
ApnAgent.prototype.handleFeedback = function(device, timestamp, done) {
    this.database.set('devices_to_remove:ios:' + device.toString(), timestamp.getTime(), function(err, res) {
        done();
    });
};

var Agents = function() {
    this._agents = {};
};

Agents.prototype = Object.create({}, {
    database: {
        enumerable: false,
        configurable: false,
        writable: true
    }
});

Agents.prototype.getAgentsFor = function(app, deviceType) {
    var appId = app.objectId;
    if (!this._agents.hasOwnProperty(appId)) {
        this._agents[appId] = {};
    }

    if (!deviceType || (deviceType === "android" && !this._agents[appId].android)) {
        this._agents[appId].android = createGcmAgent(app);
    }

    if (!deviceType || (deviceType === "ios" && !this._agents[appId].ios)) {
        this._agents[appId].ios = createApnAgent(this.database, app);
    }

    var theseAgents = this._agents[appId];
    return deviceType ? theseAgents[deviceType] : theseAgents;
};

var agents = new Agents();

var o = Object.create({}, {
    database: {
        enumerable: false,
        configurable: false,
        get: function() {
            return agents.database;
        },
        set: function(database) {
            agents.database = database;
        }
    }
});
o.send = function send(app, devices, message, callback) {
    var self = this;

    var iosDevices = filterDevicesAndMapTokens(devices, "ios");
    var androidDevices = filterDevicesAndMapTokens(devices, "android");

    var a = agents.getAgentsFor(app);

    co(function *() {
        var functions = [];
        if (iosDevices.length)
            functions.push(a.ios.send.bind(a.ios, iosDevices, message));
        if (androidDevices.length)
            functions.push(a.android.send.bind(a.android, androidDevices, message));

        try {
            var results = yield(functions);
            var res = [];
            for (var i=0,l=results.length ; i<l ; i++) {
                res = res.concat(results[i]);
            }
            callback(null, res);
        } catch (err) {
            callback(err);
        }

    })();
};

module.exports = o;

function filterDevicesAndMapTokens(devices, deviceType) {
    return devices.filter(function(item) {return item.deviceType === deviceType;})
                  .map(function(item) {return item.token;});
}

function createGcmAgent(app) {
    var gcmKey = app.google_gcm_key;
    if (!gcmKey)
        throw new Error("a google gcm key must be provided");

    return new GcmAgent(new gcmagent.Sender(gcmKey));
};

function createApnAgent(db, app) {
    var pfx = app.apple_pfx;
    if (!pfx)
        throw new Error("a pfx file content must be provided");
    var passphrase = app.apple_pfx_passphrase;

    var a = new apnagent.Agent();
    if (app.apple_pfx_dev)
        a.enable('sandbox');
    a.set('pfx', new Buffer(pfx, 'base64'));

    a.connect(function(err) {
        if (err)
            console.log(err);
    });

    var f = new apnagent.Feedback();
    f.set('pfx', new Buffer(pfx, 'base64'));
    if (app.apple_pfx_dev)
        f.enable('sandbox');

    f.connect(function(err) {
        if (err)
            console.log(err);
    });

    return new ApnAgent(db, a, f);
};