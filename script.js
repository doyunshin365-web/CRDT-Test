import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import diff from 'fast-diff'

const editor = document.getElementById('editor')
const status = document.getElementById('status')

const ydoc = new Y.Doc()
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
const wsHost = window.location.host
const provider = new WebsocketProvider(`${wsProtocol}//${wsHost}/ws`, 'my-room', ydoc)
const ytext = ydoc.getText('test-doc')

provider.on('status', event => {
    status.innerText = `Status: ${event.status}`
})

// Helper to get normalized text (textContent is more stable for CRDT)
const getNormalizedText = () => editor.textContent || ''

// Helper to get absolute cursor position
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

// --- STATE ---
let relCursor = null
let isComposing = false
let isApplyingRemoteChange = false

const updateRelCursor = () => {
    if (document.activeElement === editor && !isComposing) {
        const index = getCursorIndex(editor)
        relCursor = Y.createRelativePositionFromTypeIndex(ytext, index)
    }
}

document.addEventListener('selectionchange', updateRelCursor)

editor.addEventListener('compositionstart', () => {
    isComposing = true
})

editor.addEventListener('compositionend', () => {
    isComposing = false
    // Sync final state after composition ends
    syncLocalToRemote()
})

// Synchronization: Yjs -> DOM
ytext.observe(event => {
    if (event.transaction.local) return

    // IME 작업 중일 때는 원격 변경 사항을 즉시 반영하지 않음 (글자 뒤섞임 및 가나다 중복 방지)
    if (isComposing) return

    isApplyingRemoteChange = true

    const newText = ytext.toString()
    if (getNormalizedText() !== newText) {
        editor.textContent = newText

        if (relCursor && document.activeElement === editor) {
            const absStart = Y.createAbsolutePositionFromRelativePosition(relCursor, ydoc)
            if (absStart) {
                setCursorIndex(editor, absStart.index)
            }
        }
    }

    isApplyingRemoteChange = false
})

const syncLocalToRemote = () => {
    if (isApplyingRemoteChange || isComposing) return

    const localText = getNormalizedText()
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
}

// Synchronization: DOM -> Yjs
editor.addEventListener('input', syncLocalToRemote)








