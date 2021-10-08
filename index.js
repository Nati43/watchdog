import fs from 'fs';
import path from 'path';
import Tail from 'tail';
import express from'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors'

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

// // Socket events
// io.of("/containers").on("connection", (socket) => {
//     socket.on('meta', () => {
//         console.log("Sending meta ...");
//         socket.emit("meta", meta);
//     });

//     socket.on("subscribe", (subscription)=>{
//         console.log("Subscribing to ...", subscription.containerID);

//         fs.readFile(meta[subscription.containerID].logFileName, 'utf8', function(err, data){
//             if(data.split('\n').length > 50)
//                 socket.emit(subscription.containerID+'-init', data.split('\n').slice(data.split('\n').length - 50));
//             else 
//                 socket.emit(subscription.containerID+'-init', data.split('\n'));
            
//             socket.join(subscription.containerID);

//             // let tail = new Tail.Tail(meta[subscription.containerID].logFileName);
    
//             // tail.on("line", (line) => {
//             //     socket.emit("line", JSON.parse(line).log);
//             // });

//             // socket.on("unsubscribe", () => {
//             //     console.log("Unsubscribing...", meta[subscription.containerID].logFileName);
//             //     tail.unwatch();
//             // });
//         });
//     });

//     socket.on("unsubscribe", (data) => {
//         console.log("Unsubscribing from ..", data.containerID);
//         socket.leave(data.containerID);
//         socket.emit('unsubscribed', data.containerID);
//     });
// });


// function main() {
//     const pathToContainers = path.join('/', 'var', 'lib', 'docker', 'containers'); // /var/lib/docker/containers/
//     const configFileName = 'hostconfig.json';

//     var directories = fs.readdirSync( pathToContainers );

//     directories.forEach( containerDirectory => {
//         const containerID = containerDirectory;
//         const containerName = JSON.parse( fs.readFileSync(path.join(pathToContainers, containerID, configFileName) ).toString() ).Binds[0].split(":")[0].split("/").last();
//         var fname = path.join(pathToContainers, containerID, containerID+'-json.log');

//         meta[containerID] = {
//             id: containerID,
//             name: containerName,
//             logFileName: fname
//         }

//         let tail = new Tail.Tail(fname);

//         tail.on("line", (line) => {
//             io.of('/containers').to(containerID).emit(containerID+'-line', JSON.parse(line).log);
//         });
//     });

//     server.listen(port, () => {
//         console.log(`Log server running at: ${port}`);
//     });
// }
// main();

app.get('/meta', function (req, res) {
    var metaInfo = {};
    const pathToContainers = path.join('/', 'var', 'lib', 'docker', 'containers'); // /var/lib/docker/containers/
    const configFileName = 'hostconfig.json';

    var directories = fs.readdirSync( pathToContainers );

    directories.forEach( containerDirectory => {
        const containerID = containerDirectory;
        const containerName = JSON.parse( fs.readFileSync(path.join(pathToContainers, containerID, configFileName) ).toString() ).Binds[0].split(":")[0].split("/").last();
        var fname = path.join(pathToContainers, containerID, containerID+'-json.log');

        metaInfo[containerID] = {
            id: containerID,
            name: containerName,
            logFileName: fname
        }
    });
    
    res.status(200).send(metaInfo)
});

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

                try {
                    var tail = new Tail.Tail(fname);

                    tail.on("line", (line) => {
                        socket.emit(containerID+'-line', JSON.parse(line).log);
                        // io.of('/containers').to(containerID).emit(containerID+'-line', JSON.parse(line).log);
                    });

                    tail.on("error", (err) => {
                        socket.emit(containerID+'-error', err);
                        socket.disconnect();
                    });
                } catch (err) {
                    socket.emit(containerID+'-error', err);
                    socket.disconnect();
                    return
                }
            });

            socket.on("unsubscribe", (data) => {
                // console.log("Unsubscribing from ..", data.containerID);
                // socket.leave(data.containerID);
                // socket.emit('unsubscribed', data.containerID);
                socket.disconnect();
            });
        });

    });
    
    console.log(`Log server running at: ${port}`);
});