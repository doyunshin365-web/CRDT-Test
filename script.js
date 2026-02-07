import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import diff from 'fast-diff'

const editor = document.getElementById('editor')
const status = document.getElementById('status')

// 💡 중요: contenteditable에서 줄바꿈이 \n으로 잘 인식되려면 이 스타일이 필수야!
editor.style.whiteSpace = 'pre-wrap'
editor.style.wordBreak = 'break-word'

const ydoc = new Y.Doc()
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
const wsHost = window.location.host
const provider = new WebsocketProvider(`${wsProtocol}//${wsHost}/ws`, 'my-room', ydoc)
const ytext = ydoc.getText('test-doc')
const yLog = ydoc.getArray('shared-log') // 💡 실시간 공유 로그를 위한 Y.Array

// --- AWARENESS & IDENTITY ---
const awareness = provider.awareness
const userName = prompt('아이디를 입력하세요:') || `User-${Math.floor(Math.random() * 1000)}`
const userColor = `hsl(${Math.floor(Math.random() * 360)}, 70%, 50%)`

awareness.setLocalStateField('user', {
    name: userName,
    color: userColor
})

// --- STATE ---
let lastSyncedContent = ''
let isComposing = false
let isLocalUpdate = false
let isRemoteUpdate = false
let savedRelativeCursor = null
const MAX_LOGS = 100

provider.on('status', event => {
    status.innerText = `Status: ${event.status}`
})

// --- HELPERS ---

const getCursorIndex = (element) => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return 0
    const range = selection.getRangeAt(0)
    if (!element.contains(range.startContainer)) return 0

    let index = 0
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false)
    while (walker.nextNode()) {
        const node = walker.currentNode
        if (node === range.startContainer) {
            index += range.startOffset
            break
        }
        index += node.textContent.length
    }
    return index
}

const updateRelativeCursor = () => {
    if (document.activeElement === editor && !isRemoteUpdate) {
        const index = getCursorIndex(editor)
        try {
            savedRelativeCursor = Y.createRelativePositionFromTypeIndex(ytext, index, -1)
            awareness.setLocalStateField('cursor', {
                index: index,
                updatedAt: Date.now()
            })
        } catch (e) {
            console.error("Failed to save relative cursor", e)
        }
    }
}

const getCoordinatesAtIndex = (element, index) => {
    const range = document.createRange()
    const selection = window.getSelection()
    let charCount = 0
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false)
    let found = false

    while (walker.nextNode()) {
        const node = walker.currentNode
        const nodeLength = node.textContent.length
        if (charCount + nodeLength >= index) {
            range.setStart(node, Math.max(0, index - charCount))
            range.collapse(true)
            found = true
            break
        }
        charCount += nodeLength
    }

    if (!found) {
        range.selectNodeContents(element)
        range.collapse(false)
    }

    const rects = range.getClientRects()
    if (rects.length > 0) {
        return {
            top: rects[0].top + window.scrollY,
            left: rects[0].left + window.scrollX
        }
    }
    return null
}

const awarenessContainer = document.getElementById('awareness-container')

const renderRemoteCursors = () => {
    awarenessContainer.innerHTML = ''
    const states = awareness.getStates()

    states.forEach((state, clientID) => {
        if (clientID === ydoc.clientID) return
        if (!state.user || !state.cursor) return

        const coords = getCoordinatesAtIndex(editor, state.cursor.index)
        if (coords) {
            const cursorDiv = document.createElement('div')
            cursorDiv.className = 'remote-cursor'
            cursorDiv.style.left = `${coords.left}px`
            cursorDiv.style.top = `${coords.top}px`
            cursorDiv.style.backgroundColor = state.user.color

            const labelDiv = document.createElement('div')
            labelDiv.className = 'remote-label'
            labelDiv.style.backgroundColor = state.user.color
            labelDiv.textContent = state.user.name

            cursorDiv.appendChild(labelDiv)
            awarenessContainer.appendChild(cursorDiv)
        }
    })
}

awareness.on('change', renderRemoteCursors)
window.addEventListener('resize', renderRemoteCursors)

// --- SHARED LOGGING ---
const logContent = document.getElementById('log-content')
const logToggle = document.getElementById('log-toggle')
const logHeader = document.getElementById('log-header')

logHeader.addEventListener('click', () => {
    const isVisible = logContent.style.display === 'block'
    logContent.style.display = isVisible ? 'none' : 'block'
    logToggle.innerText = isVisible ? '로그 펼치기' : '로그 접기'
})

const renderLogs = () => {
    if (!logContent) return
    const logs = yLog.toArray().slice().reverse() // 최신순
    logContent.innerHTML = logs.map(log => `
        <div class="log-entry">
            <span class="log-time">[${log.time}]</span>
            <span class="log-user" style="color: ${log.color}">${log.user}</span>
            <span class="log-action ${log.actionClass}">${log.action}</span>
        </div>
    `).join('')
}

yLog.observe(() => {
    renderLogs()
})

const addSharedLogEntry = (action, text) => {
    const now = new Date()
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`

    let actionText = ''
    let actionClass = ''
    if (action === 'insert') {
        actionText = `➕ 추가: "${text}"`
        actionClass = 'insert'
    } else if (action === 'delete') {
        actionText = `➖ 삭제: ${text.length}자`
        actionClass = 'delete'
    }

    ydoc.transact(() => {
        yLog.push([{
            user: userName,
            color: userColor,
            time: timeStr,
            action: actionText,
            actionClass: actionClass
        }])
        if (yLog.length > MAX_LOGS) {
            yLog.delete(0, yLog.length - MAX_LOGS)
        }
    })
}

// --- DOM & SYNC ---

const setCursorIndex = (element, index) => {
    const range = document.createRange()
    const selection = window.getSelection()
    let charCount = 0
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false)
    let found = false

    while (walker.nextNode()) {
        const node = walker.currentNode
        const nodeLength = node.textContent.length
        if (charCount + nodeLength >= index) {
            range.setStart(node, Math.max(0, index - charCount))
            range.collapse(true)
            found = true
            break
        }
        charCount += nodeLength
    }

    if (!found) {
        range.selectNodeContents(element)
        range.collapse(false)
    }

    selection.removeAllRanges()
    selection.addRange(range)
}

const updateDOMFromYjs = () => {
    // 💡 한글 조합 중에도 업데이트는 하되, DOM 수정만 syncLocalToRemote와 조율
    if (isComposing || isLocalUpdate) return
    const newText = ytext.toString()
    const currentText = editor.textContent

    if (currentText !== newText) {
        isRemoteUpdate = true
        editor.textContent = newText
        lastSyncedContent = newText

        if (savedRelativeCursor && document.activeElement === editor) {
            try {
                const absPos = Y.createAbsolutePositionFromRelativePosition(savedRelativeCursor, ydoc)
                if (absPos) setCursorIndex(editor, absPos.index)
            } catch (e) {
                console.error("Cursor restore failed", e)
            }
        }
        isRemoteUpdate = false
    }
}

const syncLocalToRemote = () => {
    if (isRemoteUpdate) return
    const localText = editor.textContent
    if (localText === lastSyncedContent) return

    isLocalUpdate = true
    const changes = diff(lastSyncedContent, localText)

    ydoc.transact(() => {
        let index = 0
        changes.forEach(([type, value]) => {
            if (type === 0) {
                index += value.length
            } else if (type === -1) {
                ytext.delete(index, value.length)
                addSharedLogEntry('delete', ' '.repeat(value.length))
            } else if (type === 1) {
                ytext.insert(index, value)
                addSharedLogEntry('insert', value)
                index += value.length
            }
        })
    }, 'local-input')

    updateRelativeCursor() // 💡 실시간 커서 위치 갱신
    lastSyncedContent = localText
    isLocalUpdate = false
}

// --- EVENT HANDLERS ---
editor.addEventListener('compositionstart', () => { isComposing = true })
editor.addEventListener('compositionend', () => {
    isComposing = false
    // 💡 조합이 끝난 즉시 원격 변경사항이 반영되도록 유도 (필요한 경우)
    updateDOMFromYjs()
})

editor.addEventListener('input', () => {
    syncLocalToRemote()
})

editor.addEventListener('mouseup', updateRelativeCursor)
editor.addEventListener('keyup', (e) => {
    if (e.key.startsWith('Arrow') || ['Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
        updateRelativeCursor()
    }
})
document.addEventListener('selectionchange', () => {
    if (document.activeElement === editor) updateRelativeCursor()
})

// 옵저버
ytext.observe(event => {
    if (event.transaction.origin === 'local-input') return
    // 💡 한글 입력 중이면 원격 업데이트를 DOM에 바르지 않고 대기 (커서 밀림 방지)
    if (isComposing) return
    updateDOMFromYjs()
})

// 초기 로딩
lastSyncedContent = ytext.toString()
editor.textContent = lastSyncedContent
renderLogs()
