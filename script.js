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
let lastSyncedContent = '' // The state of the DOM as we last verified it against Yjs
let isComposing = false
let isApplyingRemoteChange = false
let relCursor = null

provider.on('status', event => {
    status.innerText = `Status: ${event.status}`
})

// --- HELPERS ---

const getNormalizedText = () => {
    // Browsers often add a trailing newline to contenteditable; we strip it for consistency
    return (editor.textContent || '')
}

const getCursorIndex = (element) => {
    const selection = window.getSelection()
    if (selection.rangeCount === 0) return 0
    const range = selection.getRangeAt(0)
    const preRange = range.cloneRange()
    preRange.selectNodeContents(element)
    preRange.setEnd(range.startContainer, range.startOffset)
    return preRange.toString().length
}

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

const updateDOMFromYjs = () => {
    if (isComposing) return

    isApplyingRemoteChange = true
    const newText = ytext.toString()

    if (getNormalizedText() !== newText) {
        // Save relative cursor position before update
        if (document.activeElement === editor) {
            const index = getCursorIndex(editor)
            relCursor = Y.createRelativePositionFromTypeIndex(ytext, index)
        }

        editor.textContent = newText
        lastSyncedContent = newText

        // Restore cursor
        if (relCursor && document.activeElement === editor) {
            const absStart = Y.createAbsolutePositionFromRelativePosition(relCursor, ydoc)
            if (absStart) {
                setCursorIndex(editor, absStart.index)
            }
        }
    }
    isApplyingRemoteChange = false
}

const syncLocalToRemote = () => {
    if (isApplyingRemoteChange) return

    const localText = getNormalizedText()
    // CRITICAL: We diff against the last state the DOM was in sync with.
    // This ignores any remote changes that ytext has but the DOM doesn't yet.
    if (localText !== lastSyncedContent) {
        const changes = diff(lastSyncedContent, localText)

        ydoc.transact(() => {
            let index = 0
            changes.forEach(([type, value]) => {
                if (type === 0) {
                    index += value.length
                } else if (type === -1) {
                    ytext.delete(index, value.length)
                } else if (type === 1) {
                    ytext.insert(index, value)
                    index += value.length
                }
            })
        })
        lastSyncedContent = localText
    }
}

// --- EVENTS ---

editor.addEventListener('compositionstart', () => {
    isComposing = true
})

editor.addEventListener('compositionend', () => {
    isComposing = false
    syncLocalToRemote()
    updateDOMFromYjs()
})

editor.addEventListener('input', () => {
    if (isComposing) return
    syncLocalToRemote()
})

ytext.observe(event => {
    if (event.transaction.local) return
    // If composing, we skip DOM update to protect IME state.
    // The next compositionend will handle merging.
    updateDOMFromYjs()
})

// Initialize state
lastSyncedContent = ytext.toString()
editor.textContent = lastSyncedContent
