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

// Synchronization: Yjs -> DOM
ytext.observe(event => {
    // Only apply remote changes to avoid infinite loop and cursor issues
    if (event.transaction.local) return

    const selection = window.getSelection()
    let relStart = null
    let relEnd = null

    // 1. Save cursor position as Relative Position
    if (selection.rangeCount > 0 && document.activeElement === editor) {
        const range = selection.getRangeAt(0)
        const offset = range.startOffset
        relStart = Y.createRelativePositionFromTypeIndex(ytext, offset)
        relEnd = Y.createRelativePositionFromTypeIndex(ytext, range.endOffset)
    }

    // 2. Update content
    editor.innerText = ytext.toString()

    // 3. Restore cursor position using Relative Position
    if (relStart && document.activeElement === editor) {
        const absStart = Y.createAbsolutePositionFromRelativePosition(relStart, ydoc)
        const absEnd = Y.createAbsolutePositionFromRelativePosition(relEnd, ydoc)

        if (absStart && absEnd) {
            const range = document.createRange()
            const textNode = editor.firstChild || editor
            try {
                const start = Math.min(absStart.index, textNode.length || 0)
                const end = Math.min(absEnd.index, textNode.length || 0)

                range.setStart(textNode, start)
                range.setEnd(textNode, end)
                selection.removeAllRanges()
                selection.addRange(range)
            } catch (e) {
                console.warn('Failed to restore cursor', e)
            }
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




