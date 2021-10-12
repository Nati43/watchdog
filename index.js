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
const password = process.env.PASSWORD || '0000';
const io = new Server(server, {
    cors: {
        origin: '*',
    }
});

var meta = {}

// Serve meta content
io.of("/meta").on("connection", (socket) => {
    const pathToContainers = path.join('/', 'var', 'lib', 'docker', 'containers'); // /var/lib/docker/containers/
    const configFileName = 'config.v2.json';

    fs.readdir( pathToContainers, (err, directories) => {
        if(err) {
            // Failed to read containers list
            return socket.disconnect();
        }

        var configWatchers = {};
        var tailers = {};
    
        directories.forEach( containerDirectory => {
            const containerID = containerDirectory;

            // Read container config
            fs.readFile(path.join(pathToContainers, containerID, configFileName), (err, data) => {
                if(err) {
                    return 
                }

                var config = JSON.parse(data.toString());
                var containerName = config.Name;
                var containerState = config.State.Running;
                var fname = path.join(pathToContainers, containerID, containerID+'-json.log');
    
                meta[containerID] = {
                    id: containerID,
                    name: containerName,
                    logFileName: fname,
                    running: containerState
                }
    
                // Watch config for status change
                var configWatcher = chokidar.watch(path.join(pathToContainers, containerID, configFileName));
                configWatcher.on('change', () => {
                    fs.readFile(path.join(pathToContainers, containerID, configFileName), {}, (err, data)=> {
                        if(!err) {
                            var running = JSON.parse(data).State.Running;
                            if(meta[containerID] != undefined && meta[containerID].running && !running) {
                                meta[containerID].running = false;
                                socket.emit('down', containerID);
                            }else if(meta[containerID] != undefined && !meta[containerID].running && running) {
                                meta[containerID].running = true;
                                socket.emit('up', containerID);
                            }
                        }
                    });
                });
                configWatchers[containerID] = configWatcher;

                // Event: Subscribe to log file
                socket.on(containerID+'-subscribe', () => {
                    socket.emit(containerID+'-subscribed');
                    fs.readFile(fname, 'utf8', function(err, data) {
                        if(err) {
                            return
                        }

                        if(data.split('\n').length > 50)
                            socket.emit(containerID+'-init', data.split('\n').slice(data.split('\n').length - 50));
                        else 
                            socket.emit(containerID+'-init', data.split('\n'));

                        // Tail log file
                        var tail = spawn('tail', ['-n', 0, '-f', fname]);
                        tail.stdout.on('data', (data) => {
                            data.toString().trim().split('\n').forEach(line => {
                                socket.emit(containerID+'-line', JSON.parse(line.toString('utf-8')).log);
                            });
                        });
                        tailers[containerID] = tail;

                        // Close tail on disconnect (container)
                        socket.on(containerID+'-unsubscribe', () => {
                            tail.kill();
                            socket.emit(containerID+'-unsubscribed');
                        });
                    });
                });
            });
        });

        // Send meta
        socket.emit("meta", meta);

        // Watch containers to detect when containers are removed/added
        var containersWatcher = fs.watch(pathToContainers, (eventType, filename) => {
            if(eventType == 'rename') {
                var containerID = filename;
                if(meta[containerID] != undefined) {
                    delete meta[containerID];
                    if(configWatchers[containerID] != undefined) {
                        configWatchers[containerID].close();
                        delete configWatchers[containerID];
                    }
                    socket.emit('removed', containerID);
                } else {
                    setTimeout(()=>{ // Wait till all files are initialized and follow the log tail
                        // Read container config
                        fs.readFile(path.join(pathToContainers, containerID, configFileName), (err, data) => {
                            if(err) {
                                socket.emit('removed', containerID);
                                return 
                            }

                            var config = JSON.parse(data.toString());
                            var containerName = config.Name;
                            var containerState = config.State.Running;
                            var fname = path.join(pathToContainers, containerID, containerID+'-json.log');

                            meta[containerID] = {
                                id: containerID,
                                name: containerName,
                                logFileName: fname,
                                running: containerState
                            }

                            // Watch config for status change
                            var configWatcher = chokidar.watch(path.join(pathToContainers, containerID, configFileName));
                            configWatcher.on('change', () => {
                                fs.readFile(path.join(pathToContainers, containerID, configFileName), {}, (err, data)=> {
                                    if(!err) {
                                        var running = JSON.parse(data).State.Running;
                                        if(meta[containerID] != undefined && meta[containerID].running && !running) {
                                            meta[containerID].running = false;
                                            socket.emit('down', containerID);
                                        }else if(meta[containerID] != undefined && !meta[containerID].running && running) {
                                            meta[containerID].running = true;
                                            socket.emit('up', containerID);
                                        }
                                    }
                                });
                            });
                            configWatchers[containerID] = configWatcher;

                            // Event: Subscribe to log file
                            socket.on(containerID+'-subscribe', () => {
                                socket.emit(containerID+'-subscribed');
                                fs.readFile(fname, 'utf8', function(err, data) {
                                    if(err) {
                                        return
                                    }

                                    if(data.split('\n').length > 50)
                                        socket.emit(containerID+'-init', data.split('\n').slice(data.split('\n').length - 50));
                                    else 
                                        socket.emit(containerID+'-init', data.split('\n'));

                                    // Tail log file
                                    var tail = spawn('tail', ['-n', 0, '-f', fname]);
                                    tail.stdout.on('data', (data) => {
                                        data.toString().trim().split('\n').forEach(line => {
                                            socket.emit(containerID+'-line', JSON.parse(line.toString('utf-8')).log);
                                        });
                                    });
                                    tailers[containerID] = tail;

                                    // Close tail on disconnect (container)
                                    socket.on(containerID+'-unsubscribe', () => {
                                        tail.kill();
                                        socket.emit(containerID+'-unsubscribed');
                                    });
                                });
                            });

                            // Send container configs
                            socket.emit('added', meta[containerID]);
                        });
                    }, 5000);
                }
            }
        });

        socket.on('disconnect', () => {
            // Stop watching containers on disconnect (socket)
            containersWatcher.close();
            // Close container watcher on disconnect (socket)
            Object.values(configWatchers).forEach(configWatcher => {
                // Close container watcher on disconnect (socket)
                configWatcher.close();
            });
            // Close tailers on disconnect (socket)
            Object.values(tailers).forEach(tail => {
                // Close tailer on disconnect (socket)
                tail.kill();
            });
        });

    });

}).use(function(socket, next) {
    if(socket.handshake.query.pin != password) {
        socket.disconnect();
    }else{
        return next();
    }
});

// Serve static files (i.e front-end build)
console.log("Serving static assets...");
app.use(express.static('public'));

server.listen(port, () => {
    console.log(`Log server running at: ${port}`);
});