import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const editor = document.getElementById('editor')
const status = document.getElementById('status')

const ydoc = new Y.Doc()
const provider = new WebsocketProvider('ws://localhost:1234', 'my-room', ydoc)
const ytext = ydoc.getText('test-doc')

provider.on('status', event => {
    status.innerText = `Status: ${event.status}`
})

// Synchronization: Yjs -> DOM
ytext.observe(() => {
    const text = ytext.toString()
    if (editor.innerText !== text) {
        // Simple cursor preservation logic
        const selection = window.getSelection()
        let offset = 0
        if (selection.rangeCount > 0 && document.activeElement === editor) {
            const range = selection.getRangeAt(0)
            offset = range.startOffset
        }

        editor.innerText = text

        if (document.activeElement === editor) {
            const range = document.createRange()
            const textNode = editor.firstChild || editor
            const safeOffset = Math.min(offset, textNode.length || 0)
            try {
                range.setStart(textNode, safeOffset)
                range.collapse(true)
                selection.removeAllRanges()
                selection.addRange(range)
            } catch (e) { }
        }
    }
})

// Synchronization: DOM -> Yjs
editor.addEventListener('input', () => {
    const localText = editor.innerText
    const remoteText = ytext.toString()

    if (localText !== remoteText) {
        // For a simple test, we just update the whole text
        // (In a real app, use a proper binder like y-quill)
        ydoc.transact(() => {
            ytext.delete(0, ytext.length)
            ytext.insert(0, localText)
        })
    }
})



