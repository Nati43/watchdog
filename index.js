import fs from 'fs';
import path from 'path';
import chokidar from 'chokidar'
import express from'express';
import http from 'http';
import { Server } from 'socket.io';
import { spawn } from 'child_process';

if (!Array.prototype.last){
    Array.prototype.last = function(){
        return this[this.length - 1];
    };
};

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3000;
const io = new Server(server, {
    cors: {
        origin: '*',
    }
});

var meta = {}

// Serve static files (i.e front-end build)
console.log("Serving static assets...");
app.use(express.static('public'));

server.listen(port, () => {
    const pathToContainers = path.join('/', 'var', 'lib', 'docker', 'containers'); // /var/lib/docker/containers/
    const configFileName = 'config.v2.json';

    var directories = fs.readdirSync( pathToContainers );

    directories.forEach( containerDirectory => {
        const containerID = containerDirectory;
        var containerName = JSON.parse( fs.readFileSync(path.join(pathToContainers, containerID, configFileName) ).toString() ).Name;
        var fname = path.join(pathToContainers, containerID, containerID+'-json.log');

        meta[containerID] = {
            id: containerID,
            name: containerName,
            logFileName: fname
        }

        chokidar
        .watch(path.join(pathToContainers, containerID, configFileName))
        .on('change', () => {
            fs.readFile(path.join(pathToContainers, containerID, configFileName), {}, (err, data)=> {
                if(!err) {
                    var running = JSON.parse(data).State.Running;
                    if(!running) {
                        console.log("Emitting down ...!");
                        io.of('/'+containerID).sockets.forEach(socket => {
                            socket.emit(containerID+'-down');
                        });
                    }
                }
            });
        });

        // Socket events
        io.of("/"+containerID).on("connection", (socket) => {
            console.log("Connected ...");
            fs.readFile(fname, 'utf8', function(err, data){
                if(data.split('\n').length > 50)
                    socket.emit(containerID+'-init', data.split('\n').slice(data.split('\n').length - 50));
                else 
                    socket.emit(containerID+'-init', data.split('\n'));

                var running = JSON.parse(fs.readFileSync(path.join(pathToContainers, containerID, configFileName) ).toString()).State.Running;
                if(!running) {
                    console.log("Emitting down ...!");
                    io.of('/'+containerID).sockets.forEach(socket => {
                        socket.emit(containerID+'-down');
                    });
                }

                var tail = spawn('tail', ['-n', 0, '-f', fname]);
                tail.stdout.on('data', (data) => {
                    data.toString().trim().split('\n').forEach(line => {
                        socket.emit(containerID+'-line', JSON.parse(line.toString('utf-8')).log);
                    });
                });
            });
        });
    });

    // Detect when containers are removed ...
    fs.watch(pathToContainers, (eventType, filename) => {
        if(eventType == 'rename') {
            var containerID = filename;
            if(meta[containerID]) {
                delete meta[containerID];
                
                io.of('/meta').sockets.forEach(socket => {
                    socket.emit('removed', containerID);
                });
            } else {
                setTimeout(()=>{ // Wait till all files are initialized and follow the log tail
                    var containerName = JSON.parse( fs.readFileSync(path.join(pathToContainers, containerID, configFileName) ).toString() ).Name;
                    var fname = path.join(pathToContainers, containerID, containerID+'-json.log');
                    
                    meta[containerID] = {
                        id: containerID,
                        name: containerName,
                        logFileName: fname
                    }

                    chokidar
                    .watch(path.join(pathToContainers, containerID, configFileName))
                    .on('change', () => {
                        fs.readFile(path.join(pathToContainers, containerID, configFileName), {}, (err, data)=> {
                            if(!err) {
                                var running = JSON.parse(data).State.Running;
                                if(!running) {
                                    io.of('/'+containerID).sockets.forEach(socket => {
                                        socket.emit(containerID+'-down');
                                    });
                                }
                            }
                        });
                    });

                    // Socket events
                    io.of("/"+containerID).on("connection", (socket) => {
                        console.log("Connected ...");
                        fs.readFile(fname, 'utf8', function(err, data){
                            if(data.split('\n').length > 50)
                                socket.emit(containerID+'-init', data.split('\n').slice(data.split('\n').length - 50));
                            else 
                                socket.emit(containerID+'-init', data.split('\n'));
    
                            var tail = spawn('tail', ['-n', 0, '-f', fname]);
                            tail.stdout.on('data', (data) => {
                                data.toString().trim().split('\n').forEach(line => {
                                    socket.emit(containerID+'-line', JSON.parse(line.toString('utf-8')).log);
                                });
                            });
                        });
                    });

                    // Send container configs meta subscribers
                    io.of('/meta').sockets.forEach(socket => {
                        socket.emit('added', meta[containerID]);
                    });
                }, 5000);
            }
        }
    });

    // Serve meta content
    io.of("/meta").on("connection", (socket) => {
        socket.emit("meta", meta);
    });

    console.log(`Log server running at: ${port}`);
});