let config = require('./config');

let http = require('http');
let Url = require('url');
let path = require('path');
let util = require('util');
let fs = require('fs');
let zlib = require('zlib');
let cypto = require('crypto');

let { promisify, inspect } = util;
let statPromise = promisify(fs.stat);
let readdirPromise = promisify(fs.readdir);
let readFilePromise = promisify(fs.readFile);
let gzipPromise = promisify(zlib.gzip);
let deflatePromise = promisify(zlib.deflate);

let chalk = require('chalk'); // 给文案加颜色
let mime = require('mime');
let handlebars = require('handlebars'); 
let listTemplatePath = path.join(__dirname, 'template', 'list.html');
let list = function () {
    let template = fs.readFileSync(listTemplatePath, 'utf8');
    return handlebars.compile(template);
}

let cacheTypes = ['text/css', 'application/javascript', 'image/jpeg', 'image/png'];
let rangeTypes = ['image/jpeg', 'image/png'];

let hostDomain = 'localhost:8080';

// 代码中读写环境变量的值
// console.log(process.env) // 输出
process.env.DEBUG = 'static:*';
// console.log(process.env.DEBUG)   
let debug = require('debug')('static:app'); // 控制台输出模块, 是否在控制台打印取决于在环境变量中DEBUG的值是否static:app
// static:app 第一部分是项目名，第二部分是模块名
// static:* 会打印出所有的日志
// 环境变量中设置debug值命令   set DEBUG=static:app Mac和linux下是 export DEBUG=static:app
// supervisor 帮助自动重启服务的包，全局安装

class Server {
     constructor(argv){
        this.request = this.request.bind(this);
        this.sendError = this.sendError .bind(this);
        this.list = list();
        this.config = Object.assign({}, config, argv);
        this.gzip = this.gzip.bind(this);
        this.toCache = this.toCache.bind(this);
        this.range = this.range.bind(this);
        this.notSteal = this.notSteal.bind(this);
    }
    start() {
        let server = http.createServer();
        server.on('request', this.request);
        server.listen(this.config.port, () => {
            let url = `http://${this.config.host}:${this.config.port}`;
            debug(`server started at ${chalk.green(url)}`)
        });
    }
    async request(req, res) {
        let { pathname } = Url.parse(req.url);
        let filepath = path.join(this.config.root, pathname);
        try {
            let stat = await statPromise(filepath)
            if (stat.isDirectory()) {
                // 自动返回目录下inde.html文件，没有的话返回目录
                let indexFilepath = path.join(filepath, '/', 'index.html');
                try {
                    let statIndex = await statPromise(indexFilepath);
                    if (statIndex) {
                        return this.sendFile(req, res, indexFilepath, stat);
                    }
                } catch (e) {}

                let files = await readdirPromise(filepath);
                files = files.map(file => ({
                    name: file,
                    url: path.join(pathname, file),
                    }))
                let html = this.list({
                    title: pathname,
                    files,
                });
                res.setHeader('Content-Type', 'text/html');
                let streamInfo = await this.gzip(req, res, html);
                html = streamInfo ? streamInfo : html;
                res.end(html);
            } else {
                this.sendFile(req, res, filepath, stat);
            }
        } catch(e) {
            debug(inspect(e)); //inspect把一个对象转成字符
            this.sendError(req, res, 404);
        }
    }
    async gzip(req, res, gzipInfo) {
        let encoding = req.headers['accept-encoding'];
        let gzipReg = /\bgzip\b/;
        let deflateReg = /\bdeflate\b/;
        let type, streamInfo;  
        if (gzipReg.test(encoding)) {
            streamInfo = gzipInfo ? await gzipPromise(gzipInfo) : zlib.createGzip();
            type = 'gzip';
        } else if (deflateReg.test(encoding)) {
            streamInfo = gzipInfo ? await deflatePromise(gzipInfo) : zlib.createDeflate();
            type = 'deflate';
        }
        if (type) {
            res.setHeader('Content-Encoding', type);
        }
        return streamInfo;
    }
    async sendFile(req, res, filepath, stat) {
        let fileType = mime.getType(filepath);
        if (cacheTypes.includes(fileType)) {
            let cache = this.toCache(req, res, filepath, stat);
            if (!cache) return;
        }
    
        // 防盗链
        let isSteal = rangeTypes.includes(fileType) ? this.notSteal(req, res) : null;
        let loadType = isSteal ? 'image/png' : null;
        // 是否需要分段传输数据
        let readStream = isSteal 
         ? isSteal 
         : (rangeTypes.includes(fileType)
            ? this.range(req, res, filepath, stat)
            : fs.createReadStream(filepath));
        
        res.setHeader('Content-Type', loadType || mime.getType(filepath));
        let streamInfo = await this.gzip(req, res);
        if (streamInfo) {
            readStream.pipe(streamInfo).pipe(res);
            return;
        }
        readStream(filepath).pipe(res);
    }
    notSteal (req, res) {
        console.log(path.join(process.cwd(), 'imgs/load.png'))
        let refer = req.headers['referer'] || req.headers['refer'];
        //如果说有refer的话，则表示是从HTML页面中引用过来的
        if (refer) {
            let { host } = Url.parse(refer);
            if (host !== hostDomain) {
                return fs.createReadStream(path.join(process.cwd(), 'imgs/load.png'));
            }
        }
    }
    range (req, res, filepath, stat) {
        res.setHeader('Accept-Range', 'bytes'); // 通知客户端支持获取部分资源
        let range = req.headers['range']; // Range: bytes=0-xxx
        let start = 0, end = stat.size;
        if (range) {
            let result = range.match(/bytes=(\d*)-(\d*)/);
            start = isNaN(result[1]) ? result[1] : start;
            end = isNaN(result[2]) ? result[2] : end;
        }
        return fs.createReadStream(filepath, {
            start,
            end,
        })
    }
    toCache (req, res, filepath, stat) {
        // 强制缓存
        res.setHeader('Cache-Control', 'private,max-age=60'); // http 1.1
        // private 客户端可以缓存
        // public 客户端和代理服务器都可以缓存
        // max-age=60 缓存内容将在60秒后失效
        // no-cache 需要使用对比缓存验证数据,强制向源服务器再次验证
        // no-store 所有内容都不会缓存，强制缓存和对比缓存都不会触发 
        res.setHeader('Expires', new Date(Date.now() + 60 * 1000).toUTCString()); // http 1.0


        // 对比缓存
        // last-modify
        let ifModifiedSince = req.headers['if-modified-since'];
        let lastModified = stat.ctime.toGMTString();
        // etag
        let ifNoneMatch = req.headers['if-none-match'];
        let eTag = cypto.createHash('sha1').update(stat.ctime.toGMTString() + stat.size).digest('hex');
        if (ifModifiedSince || ifNoneMatch) {
            if (ifNoneMatch === eTag && lastModified === ifModifiedSince) {
                res.statusCode = 304;
                res.end('');
                return false;
            }
            if ((ifModifiedSince && lastModified === ifModifiedSince) || (ifNoneMatch && ifNoneMatch === eTag)) {
                res.statusCode = 304;
                res.end('');
                return false;
            }
        }
        res.setHeader('Last-Modified', lastModified);
        res.setHeader('ETag', eTag);
        return true;
    }
    sendError(req, res, flag) {
        switch(flag) {
            case 404:
            res.statusCode = 404;
            res.end('not found');
            break;
        }
    }
       
}
// let server = new Server();
// server.start(); // 启动服务
module.exports = Server;