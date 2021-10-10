FROM node:14-alpine as base

WORKDIR /app
COPY package*.json /app/
RUN npm ci --only=production && npm cache clean --force

EXPOSE 9000
ENV PORT=9000
ENV PASSWORD=1234
COPY . /app/
CMD node index.js
