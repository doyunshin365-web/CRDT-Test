const WebSocket = require('ws')
const http = require('http')
const setupWSConnection = require('y-websocket/bin/utils').setupWSConnection

const port = process.env.PORT || 3001
const server = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain' })
    response.end('okay')
})

const wss = new WebSocket.Server({ server })

wss.on('connection', (conn, req) => {
    setupWSConnection(conn, req)
})

server.listen(port, () => {
    console.log(`CRDT Server running on port ${port}`)
})

