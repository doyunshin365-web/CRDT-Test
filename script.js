import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import Quill from 'quill'
import { QuillBinding } from 'y-quill'

const editorContainer = document.getElementById('editor')
const status = document.getElementById('status')

const ydoc = new Y.Doc()
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
const wsHost = window.location.host
const provider = new WebsocketProvider(`${wsProtocol}//${wsHost}/ws`, 'my-room', ydoc)
const ytext = ydoc.getText('test-doc')

provider.on('status', event => {
    status.innerText = `Status: ${event.status}`
})

// Initialize Quill
const quill = new Quill(editorContainer, {
    modules: {
        toolbar: [
            [{ header: [1, 2, false] }],
            ['bold', 'italic', 'underline'],
            ['image', 'code-block']
        ]
    },
    placeholder: '여기에 내용을 입력하세요...',
    theme: 'snow'
})

// Bind Quill to Yjs
const binding = new QuillBinding(ytext, quill, provider.awareness)
