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

// --- CURSOR TRACKING ---
let relCursor = null

const updateRelCursor = () => {
    if (document.activeElement === editor) {
        const index = getCursorIndex(editor)
        // 왼쪽 캐릭터와의 거리를 유지하도록 설정 (데이터 삽입 시 뒤로 밀림)
        relCursor = Y.createRelativePositionFromTypeIndex(ytext, index)
    }
}

// 사용자가 클릭하거나 타이핑할 때마다 상대 위치 기록
document.addEventListener('selectionchange', updateRelCursor)

let isApplyingRemoteChange = false

// Synchronization: Yjs -> DOM
ytext.observe(event => {
    if (event.transaction.local) return

    isApplyingRemoteChange = true

    // 중요: 여기서 updateRelCursor()를 호출하면 안 됨! 
    // 이미 selectionchange에서 이전 상태의 상대 위치를 잘 보관하고 있음.

    const newText = ytext.toString()
    if (editor.innerText !== newText) {
        editor.innerText = newText

        if (relCursor && document.activeElement === editor) {
            const absStart = Y.createAbsolutePositionFromRelativePosition(relCursor, ydoc)
            if (absStart) {
                setCursorIndex(editor, absStart.index)
            }
        }
    }

    isApplyingRemoteChange = false
})

// Synchronization: DOM -> Yjs
editor.addEventListener('input', () => {
    if (isApplyingRemoteChange) return

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







