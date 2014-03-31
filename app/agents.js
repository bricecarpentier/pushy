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

Agent.prototype.send = function(db, token, message, callback) {
    console.log("Agent::send");
};

var GcmAgent = function(actualAgent) {Agent.call(this, actualAgent);};
GcmAgent.prototype = Object.create(Agent.prototype);
GcmAgent.prototype.constructor = GcmAgent;
GcmAgent.prototype.send = function(db, tokens, message, callback) {
    if (!(tokens instanceof Array))
        tokens = [tokens];
    console.log("GcmAgent::send", tokens, message);

    var m = new gcmagent.Message();

    m.addDataWithObject({
        tickerText: message.alert,
        contentTitle: message.title,
        contentText: message.content,
        parameters: message.payload
    });;

    this.actualAgent.send(m, tokens, 4, callback);
};

var ApnAgent = function(actualAgent, feedback) {
    Agent.call(this, actualAgent);
    this.feedback = feedback;
};
ApnAgent.prototype = Object.create(Agent.prototype);
ApnAgent.prototype.constructor = ApnAgent;
ApnAgent.prototype.send = function(db, tokens, message, callback) {
    var self = this;
    co(function *() {
        var token;
        var functions = [];
        for (var i=0,l=tokens.length ; i<l ; i++) {
            token = tokens[i];
            var isBlacklisted = yield db.isismember.bind(db, 'devices_to_remove:ios:' + token);
            if (isBlacklisted)
                continue;
            var m = self.actualAgent.createMessage();
            m.alert(message.alert)
            if (message.badge)
                m.badge(message.badge);
            if (message.sound)
                m.sound(message.sound);
            m.device(token);
            functions.push(m.send.bind(m));
        }

        callback(yield functions);
    });
}

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

    var type;
    if (iosDevices.length && androidDevices.length) {
        type = undefined;
    } else if (iosDevices.length) {
        type = "ios";
    } else {
        type = "android";
    }

    var a = agents.getAgentsFor(app, type);

    co(function *() {
        var functions = [];
        if (iosDevices.length)
            functions.push(a.ios.send.bind(self.database, a.ios, devices, message));
        if (androidDevices.length)
            functions.push(a.android.send.bind(self.database, a.android, devices, message));

        try {
            var res = yield(functions);
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
    a.set('pfx', new Buffer(pfx, 'base64'));
    if (passphrase)
        a.set('passphrase', passphrase);

    a.connect(function(err) {
        if (err)
            console.log(err);
        else
            console.log('YEAH!');
    });

    var f = new apnagent.Feedback();
    f.set('pfx', new Buffer(pfx, 'base64'));
    if (passphrase)
        f.set('passphrase', passphrase);

    f.connect(function(err) {
        if (err)
            console.log(err);
        else
            console.log('YEAH Feedback');
    });

    return new ApnAgent(a, f);



};