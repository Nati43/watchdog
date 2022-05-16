import fs from 'fs';
import path from 'path';
import chokidar from 'chokidar'
import express from'express';
import http from 'http';
import { Server } from 'socket.io';
import { spawn, exec } from 'child_process';
import axios from 'axios';

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
    var tail; // Tail object for log subscription
    var intervalHandle; // Interval handle for refresh loop

    axios.get('http://v1.40/containers/json?all=1', {
        socketPath: 'docker.sock'
    }).then((rs) => {
        rs.data.forEach(container => {
            meta[container.Id] = {
                id: container.Id,
                name: container.Names[0],
                logFileName: path.join(pathToContainers, container.Id, container.Id+'-json.log'),
                state: container.State
            };

            // Start event
            socket.on(container.Id+'-start', () => {
                changeState(container.Id, 'start');
            });

            // Restart event
            socket.on(container.Id+'-restart', () => {
                changeState(container.Id, 'restart');
            });

            // Stop event
            socket.on(container.Id+'-stop', () => {
                changeState(container.Id, 'stop');
            });

            // Remove event
            socket.on(container.Id+'-remove', () => {
                changeState(container.Id, 'remove');
            });

            // Event: Subscribe to log file
            socket.on(container.Id+'-subscribe', () => {
                let logFilename = path.join(pathToContainers, container.Id, container.Id+'-json.log');
                socket.emit(container.Id+'-subscribed');

                // Close tail on unsubscribe
                socket.on(container.Id+'-unsubscribe', () => {
                    if(tail && tail.kill) {
                        tail.kill();
                    }
                    socket.emit(container.Id+'-unsubscribed');
                });

                fs.readFile(logFilename, 'utf8', function(err, data) {
                    if(err) {
                        console.log('Error reading log file : ', err);
                        return
                    }

                    if(data.split('\n').length > 50)
                        socket.emit(container.Id+'-init', data.split('\n').slice(data.split('\n').length - 50));
                    else 
                        socket.emit(container.Id+'-init', data.split('\n'));

                    // Tail log file
                    tail = spawn('tail', ['-n', 0, '-f', logFilename]);
                    tail.stdout.on('data', (data) => {
                        data.toString().trim().split('\n').forEach(line => {
                            try {
                                socket.emit(container.Id+'-line', JSON.parse(line.toString('utf-8')).log);
                            } catch(err) {
                                socket.emit(container.Id+'-line', line.toString('utf-8'));
                            }
                        });
                    });
                });
            });

        });

        // Send meta
        socket.emit("meta", meta);

        // Update meta info every 5 seconds
        intervalHandle = setInterval(() => {
            axios.get('http://v1.40/containers/json?all=1', {
                socketPath: 'docker.sock'
            }).then((rs) => {
                rs.data.forEach(container => {
                    if(!Object.keys(meta).includes(container.Id)) {
                        // New container added
                        meta[container.Id] = {
                            id: container.Id,
                            name: container.Names[0],
                            logFileName: path.join(pathToContainers, container.Id, container.Id+'-json.log'),
                            state: container.State
                        };
                        // Send container configs
                        socket.emit('added', meta[container.Id]);

                        // Start event
                        socket.on(container.Id+'-start', () => {
                            changeState(container.Id, 'start');
                        });

                        // Restart event
                        socket.on(container.Id+'-restart', () => {
                            changeState(container.Id, 'restart');
                        });

                        // Stop event
                        socket.on(container.Id+'-stop', () => {
                            changeState(container.Id, 'stop');
                        });

                        // Remove event
                        socket.on(container.Id+'-remove', () => {
                            changeState(container.Id, 'remove');
                        });

                        // Close tail on unsubscribe
                        socket.on(container.Id+'-unsubscribe', () => {
                            if(tail && tail.kill) {
                                tail.kill();
                            }
                            socket.emit(container.Id+'-unsubscribed');
                        });

                        // Event: Subscribe to log file
                        socket.on(container.Id+'-subscribe', () => {
                            let logFilename = path.join(pathToContainers, container.Id, container.Id+'-json.log');
                            socket.emit(container.Id+'-subscribed');

                            fs.readFile(logFilename, 'utf8', function(err, data) {
                                if(err) {
                                    console.log('Error reading log file: ', err);
                                    return
                                }

                                if(data.split('\n').length > 50)
                                    socket.emit(container.Id+'-init', data.split('\n').slice(data.split('\n').length - 50));
                                else 
                                    socket.emit(container.Id+'-init', data.split('\n'));

                                // Tail log file
                                let tail = spawn('tail', ['-n', 0, '-f', logFilename]);
                                tail.stdout.on('data', (data) => {
                                    data.toString().trim().split('\n').forEach(line => {
                                        socket.emit(container.Id+'-line', JSON.parse(line.toString('utf-8')).log);
                                    });
                                });
                            });
                        });

                    } else if( container.State != meta[container.Id].State ) {
                        // Container state has changed
                        socket.emit('state-change', {
                            id: container.Id,
                            state: container.State
                        });
                    }
                });

                // Check for removed container
                Object.keys(meta).forEach(containerID => {
                    if(rs.data.find(x => x.Id == containerID) == undefined) {
                        // Container removed
                        delete meta[containerID];
                        socket.emit('removed', containerID);
                    }
                });
            }).catch(err => {
                console.log('Error getting list of containers: ', err);
            });
        }, 5000);

    }).catch(err => {
        console.log('Error getting list of containers: ', err);
    });

    // Clear the refresh interval and close any open tail
    socket.on('disconnect', () => {
        clearInterval(intervalHandle);
        // Kill the tail process
        if(tail && tail.kill) {
            tail.kill();
        }
    });

    function changeState(containerID, action) {
        // State to emit before performing action on container
        let statesToEmitBeforeChange = {
            'start': 'starting',
            'restart': 'restarting',
            'stop': 'stopping',
            'remove': 'removing',
        }

        // State to emit after performing action on container
        let statesToEmitAfterChange = {
            'start': 'running',
            'restart': 'running',
            'stop': 'exited',
        }
        
        // Emit state before performing action if set
        if(statesToEmitBeforeChange[action])
            socket.emit('state-change', {
                id: containerID,
                state: statesToEmitBeforeChange[action]
            });

        // Send request to docker engine API change container state
        exec(`curl -X POST --unix-socket docker.sock http://v1.40/containers/${containerID.substring(0, 12)}/${action}`, (error) => {
            if (error)
                console.log(`Exec error on ${action} : ${error.message}`);
            else {
                if(Object.keys(statesToEmitAfterChange).includes(action))
                    // Container state has changed
                    socket.emit('state-change', {
                        id: containerID,
                        state: statesToEmitAfterChange[action]
                    });
                else if(action=='remove') {
                    // Container state has changed
                    delete meta[containerID];
                    socket.emit('removed', containerID);
                }
            }
            
        });

    }
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