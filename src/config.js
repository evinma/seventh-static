let path = require('path');

let config = {
    host: 'localhost',
    port: 8080,
    root: path.resolve(__dirname, '..', 'public'), // 静态文件目录
}
module.exports = config;