var nconf = require('nconf');

var core = require('./core');

nconf.env().argv();

const MASTER_KEY = nconf.get('MASTER_KEY');
if (!MASTER_KEY) {
    console.log("a master key needs to be set");
    process.exit(1);
}

core.startPushy({
    db_host: nconf.get('DB_REDIS_HOST'),
    db_port: parseInt(nconf.get('DB_REDIS_PORT'), 10),
    db_password: nconf.get('DB_REDIS_PASSWORD'),
    db_index: nconf.get('DB_REDIS_INDEX')
});