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

// --- STATE ---
let lastSyncedContent = ''
let isComposing = false
let isApplyingRemoteChange = false
let relCursor = null

provider.on('status', event => {
    status.innerText = `Status: ${event.status}`
})

// --- ROBUST HELPERS ---

// Normalizes text by removing browser-specific quirks like trailing newlines
const getNormalizedText = () => {
    let text = editor.textContent || ''
    // Strip a single trailing newline if the browser added it for the contenteditable box
    return text.replace(/\n$/, '')
}

// Robust character-based cursor index calculation
const getCursorIndex = (element) => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return 0
    const range = selection.getRangeAt(0)

    // Create a copy to traverse nodes and count characters
    const preRange = range.cloneRange()
    preRange.selectNodeContents(element)
    preRange.setEnd(range.startContainer, range.startOffset)

    // Using textContent of the preRange content instead of toString() 
    // to match ytext.toString() behavior more closely.
    const container = document.createElement('div')
    container.appendChild(preRange.cloneContents())
    return container.textContent.length
}

// Robust character-based cursor restoration
const setCursorIndex = (element, index) => {
    const selection = window.getSelection()
    if (!selection) return

    const range = document.createRange()
    let charCount = 0
    let nodeStack = [element]

    while (nodeStack.length > 0) {
        let node = nodeStack.pop()
        if (node.nodeType === 3) { // Text node
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
            // Push children in reverse for correct order
            for (let i = node.childNodes.length - 1; i >= 0; i--) {
                nodeStack.push(node.childNodes[i])
            }
        }
    }

    // Fallback: If index is at the very end
    if (index >= charCount) {
        range.selectNodeContents(element)
        range.collapse(false) // Set to end
        selection.removeAllRanges()
        selection.addRange(range)
    }
}

const updateDOMFromYjs = () => {
    if (isComposing) return

    const newText = ytext.toString()
    if (getNormalizedText() !== newText) {
        isApplyingRemoteChange = true

        // 1. Capture relative cursor
        if (document.activeElement === editor) {
            const index = getCursorIndex(editor)
            relCursor = Y.createRelativePositionFromTypeIndex(ytext, index)
        }

        // 2. Update Content
        editor.textContent = newText
        lastSyncedContent = newText

        // 3. Restore Cursor
        if (relCursor && document.activeElement === editor) {
            const absPos = Y.createAbsolutePositionFromRelativePosition(relCursor, ydoc)
            if (absPos) {
                setCursorIndex(editor, absPos.index)
            }
        }

        isApplyingRemoteChange = false
    }
}

const syncLocalToRemote = () => {
    if (isApplyingRemoteChange) return

    const localText = getNormalizedText()
    if (localText !== lastSyncedContent) {
        const changes = diff(lastSyncedContent, localText)

        ydoc.transact(() => {
            let index = 0
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
        }, 'local-input') // Tagging local transaction

        lastSyncedContent = localText
    }
}

// --- EVENT HANDLERS ---

editor.addEventListener('compositionstart', () => {
    isComposing = true
})

editor.addEventListener('compositionend', () => {
    isComposing = false
    // When Korean typing ends, sync the final composed text immediately
    syncLocalToRemote()
    // Then pull any remote changes that were blocked during composition
    updateDOMFromYjs()
})

editor.addEventListener('input', () => {
    if (isComposing) return
    syncLocalToRemote()
})

// Listen to focus to capture initial state if needed
editor.addEventListener('focus', () => {
    updateRelCursor()
})

const updateRelCursor = () => {
    if (document.activeElement === editor && !isComposing) {
        const index = getCursorIndex(editor)
        relCursor = Y.createRelativePositionFromTypeIndex(ytext, index)
    }
}

// Capture cursor movement to keep relCursor fresh
document.addEventListener('selectionchange', () => {
    if (document.activeElement === editor && !isApplyingRemoteChange && !isComposing) {
        updateRelCursor()
    }
})

ytext.observe(event => {
    if (event.transaction.local) return
    updateDOMFromYjs()
})

// Initial load
lastSyncedContent = ytext.toString()
editor.textContent = lastSyncedContent
