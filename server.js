const WebSocket = require('ws')
const http = require('http')
const express = require('express') // 추가
const path = require('path') // 추가
const setupWSConnection = require('y-websocket/bin/utils').setupWSConnection

const app = express()
const port = process.env.PORT || 3001

// 1. HTML/JS 파일이 있는 폴더를 지정 (예: 현재 폴더가 public일 때)
// 만약 파일들이 서버랑 같은 폴더에 있다면 '.'으로 수정
app.use(express.static(__dirname))

const server = http.createServer(app)
const wss = new WebSocket.Server({ server })

wss.on('connection', (conn, req) => {
    setupWSConnection(conn, req)
})

server.listen(port, () => {
    console.log(`CRDT Server running on http://localhost:${port}`)
})