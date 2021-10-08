import fs from 'fs';
import path from 'path';
import Tail from 'tail';
import express from'express';
import http from 'http';
import { Server } from 'socket.io';

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

// Socket events
io.of("/containers").on("connection", (socket) => {
    socket.on('meta', () => {
        console.log("Sending meta ...");
        socket.emit("meta", meta);
    });

    socket.on("subscribe", (subscription)=>{
        console.log("Subscribing to ...", subscription.containerID);

        fs.readFile(meta[subscription.containerID].logFileName, 'utf8', function(err, data){
            socket.emit("init", data.split('\n').slice(data.split('\n').length - 20));
            
            let tail = new Tail.Tail(meta[subscription.containerID].logFileName);
    
            tail.on("line", (line) => {
                socket.emit("line", JSON.parse(line).log.replace(/(\r\n|\n|\r)/gm, ""));
            });

            socket.on("unsubscribe", () => {
                console.log("Unsubscribing...", meta[subscription.containerID].logFileName);
                tail.unwatch();
            });
        });
    });
});


function main() {
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
    });

    server.listen(port, () => {
        console.log(`Log server running at: ${port}`);
    });
}
main();