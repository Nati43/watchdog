import fs from 'fs';
import path from 'path';
// import Tail from 'tail';
// import chokidar from 'chokidar'
import express from'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors'
import { spawn } from 'child_process';

if (!Array.prototype.last){
    Array.prototype.last = function(){
        return this[this.length - 1];
    };
};

const app = express();
app.use(cors());
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
    const configFileName = 'hostconfig.json';

    var directories = fs.readdirSync( pathToContainers );

    directories.forEach( containerDirectory => {
        const containerID = containerDirectory;
        const containerName = JSON.parse( fs.readFileSync(path.join(pathToContainers, containerID, configFileName) ).toString() ).Binds[0].split(":")[0].split("/").last();
        var fname = path.join(pathToContainers, containerID, containerID+'-json.log');

        meta[containerID] = {
            id: containerID,
            name: containerName,
            logFileName: fname
        }

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
    });

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
                    var containerName = JSON.parse( fs.readFileSync(path.join(pathToContainers, containerID, configFileName) ).toString() ).Binds[0].split(":")[0].split("/").last();
                    var fname = path.join(pathToContainers, containerID, containerID+'-json.log');
                    
                    meta[containerID] = {
                        id: containerID,
                        name: containerName,
                        logFileName: fname
                    }

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

    // Socket events
    io.of("/meta").on("connection", (socket) => {
        socket.emit("meta", meta);
    });

    console.log(`Log server running at: ${port}`);
});