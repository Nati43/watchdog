## Intro

Watchdog is an open source real-time monitoring tool for your docker environment.
Using watchdog, you can monitor the active statuses and logs of your docker containers 
on your development and/or production servers in real-time without having to 
remotely SSH into you servers. 
It watches over the docker containers that are on the machine it is deployed on and 
sends log and status updates to any logged in subscribers if any.

[![Watch the video](https://img.youtube.com/vi/5eGYpKO5AaY/maxresdefault.jpg)](https://youtu.be/5eGYpKO5AaY)

## Installation

### Docker
```sh
sudo docker run --volume /var/lib/docker/containers:/var/lib/docker/containers -p 9000:9000 -w /app -e PORT=9000 -e PASSWORD=1234 --name watchdog -d nati43/watchdog:1.02
```
Use your prefered PORT and PASSWORD.
Make sure the internal port and the environment variable port match.
The host mount volume is "/var/lib/docker/containers" assuming you are 
deploying this on a linux host.

### Docker-compose
```yaml
watchdog:
    image: nati43/watchdog:1.02
    volumes:
      - /var/lib/docker/containers:/var/lib/docker/containers
    ports:
      - 9999:9999
    environment:
      PORT: 9999
      PASSWORD: 1234
    working_dir: /app
    command: node index.js
```
