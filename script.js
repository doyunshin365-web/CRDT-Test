import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import diff from 'fast-diff'

const editor = document.getElementById('editor')
const status = document.getElementById('status')

const ydoc = new Y.Doc()
const provider = new WebsocketProvider('ws://localhost:1234', 'my-room', ydoc)
const ytext = ydoc.getText('test-doc')

provider.on('status', event => {
    status.innerText = `Status: ${event.status}`
})

// Helper to get absolute cursor position in contenteditable
const getCursorIndex = (element) => {
    const selection = window.getSelection()
    if (selection.rangeCount === 0) return 0
    const range = selection.getRangeAt(0)
    const preRange = range.cloneRange()
    preRange.selectNodeContents(element)
    preRange.setEnd(range.startContainer, range.startOffset)
    return preRange.toString().length
}

// Helper to set absolute cursor position
const setCursorIndex = (element, index) => {
    const selection = window.getSelection()
    const range = document.createRange()
    let charCount = 0
    let nodeStack = [element]

    while (nodeStack.length > 0) {
        let node = nodeStack.pop()
        if (node.nodeType === 3) {
            let nextCharCount = charCount + node.length
            if (index >= charCount && index <= nextCharCount) {
                range.setStart(node, index - charCount)
                range.collapse(true)
                selection.removeAllRanges()
                selection.addRange(range)
                return
            }
            charCount = nextCharCount
        } else {
            for (let i = node.childNodes.length - 1; i >= 0; i--) {
                nodeStack.push(node.childNodes[i])
            }
        }
    }
}

// Synchronization: Yjs -> DOM
ytext.observe(event => {
    if (event.transaction.local) return

    const selection = window.getSelection()
    let relStart = null

    if (selection.rangeCount > 0 && document.activeElement === editor) {
        const index = getCursorIndex(editor)
        relStart = Y.createRelativePositionFromTypeIndex(ytext, index)
    }

    editor.innerText = ytext.toString()

    if (relStart && document.activeElement === editor) {
        const absStart = Y.createAbsolutePositionFromRelativePosition(relStart, ydoc)
        if (absStart) {
            setCursorIndex(editor, absStart.index)
        }
    }
})

// Synchronization: DOM -> Yjs
editor.addEventListener('input', () => {
    const localText = editor.innerText
    const remoteText = ytext.toString()

    if (localText !== remoteText) {
        const changes = diff(remoteText, localText)
        let index = 0

        ydoc.transact(() => {
            changes.forEach(([type, value]) => {
                if (type === 0) { // Equal
                    index += value.length
                } else if (type === -1) { // Delete
                    ytext.delete(index, value.length)
                } else if (type === 1) { // Insert
                    ytext.insert(index, value)
                    index += value.length
                }
            })
        })
    }
})





