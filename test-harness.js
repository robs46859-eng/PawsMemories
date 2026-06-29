const server = require('./dist/server.cjs');

// wait, I don't know what is exported by server.cjs.
console.log(Object.keys(server));
