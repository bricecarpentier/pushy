var fs = require('fs');

var nconf = require('nconf'),
    redis = require('redis'),
    co    = require('co');

nconf.env();

const REDIS_HOST     = nconf.get('DB_REDIS_HOST');
const REDIS_PORT     = parseInt(nconf.get('DB_REDIS_PORT'), 10);
const REDIS_PASSWORD = nconf.get('DB_REDIS_PASSWORD');
const REDIS_INDEX    = nconf.get('DB_REDIS_INDEX');

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

var appid = process.argv[2]
var path = process.argv[3];

var readFile = function(path, encoding) {
    return function(cb) {
        fs.readFile(path, encoding, cb);
    };
}

co(function *() {

    try {
        var b = yield readFile(path);
        var content = b.toString('base64');
        var res = yield db.hset.bind(db, 'app:' + appid, 'apple_pfx', content);
    } catch (err) {
        console.log('an error occured:', err);
    }

    db.end();
})();