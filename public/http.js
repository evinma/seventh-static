let http = require('http');
let path = require('path');
let fs = require('fs');
console.log(3333);

let server = http.createServer(function(req, res){
    fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
});
server.listen(3000);
