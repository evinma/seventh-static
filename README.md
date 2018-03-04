# seventh-static
node static server 

## 静态文件服务器
可以在任意目录下启动一个静态文件服务器，并且把当前目录作为文件根目录

```
seven -d 指定静态文件根目录 -p指定端口号 -o指定监听的主机
```

* 读取静态文件或目录
* MIME类型支持
* 缓存支持/控制
* 支持gzip压缩
* 访问目录可以自动寻找下面的index.html文件
* Range支持，断点续传
* 图片防盗链
* 后台运行

```
npm install seventh-static -g
```