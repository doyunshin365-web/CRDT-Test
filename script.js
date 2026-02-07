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

// --- STATE ---
let lastSyncedContent = ''
let isComposing = false
// 💡 뮤텍스: 로컬 변경 중일 때 리모트 패치를 막고, 리모트 패치 중일 때 로컬 싱크를 막음
let isLocalUpdate = false
let isRemoteUpdate = false
let savedRelativeCursor = null

provider.on('status', event => {
    status.innerText = `Status: ${event.status}`
})

// --- HELPERS ---

// 텍스트 노드 사이를 탐색하며 정확한 위치를 찾는 함수
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

// 상대적 커서 위치를 현재 DOM 상태를 기반으로 업데이트
const updateRelativeCursor = () => {
    if (document.activeElement === editor && !isRemoteUpdate && !isComposing) {
        const index = getCursorIndex(editor)
        try {
            // assoc = -1: 왼쪽 문자에 달라붙게 하여 타이핑 시 자연스럽게 이동하도록 함
            savedRelativeCursor = Y.createRelativePositionFromTypeIndex(ytext, index, -1)
        } catch (e) {
            console.error("Failed to save relative cursor", e)
        }
    }
}

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
            // 인덱스 0인 경우 빈 텍스트 노드에서도 동작하도록 함
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

// Yjs 변경사항을 DOM에 반영 (리모트 변경 시 실행)
const updateDOMFromYjs = () => {
    // 내가 입력 중이거나(한글 조합 중), 내가 발생시킨 변경사항이면 무시
    if (isComposing || isLocalUpdate) return

    const newText = ytext.toString()
    const currentText = editor.textContent

    if (currentText !== newText) {
        isRemoteUpdate = true // 🔒 락 걸기

        // 💡 중요: 커서 위치는 관찰자(observe)가 불리기 전이나 
        // 외부에서 이미 savedRelativeCursor에 업데이트되어 있어야 함.
        // 여기(업데이트 시점)에서 계산하면 이미 ytext가 바뀐 상태라 늦음.

        // 2. 내용 업데이트
        editor.textContent = newText
        lastSyncedContent = newText

        // 3. 커서 복원
        if (savedRelativeCursor && document.activeElement === editor) {
            try {
                const absPos = Y.createAbsolutePositionFromRelativePosition(savedRelativeCursor, ydoc)
                if (absPos) {
                    setCursorIndex(editor, absPos.index)
                }
            } catch (e) {
                console.error("Cursor restore failed", e)
            }
        }

        isRemoteUpdate = false // 🔓 락 해제
    }
}

// 로컬 변경사항을 Yjs로 전송
const syncLocalToRemote = () => {
    // 리모트 변경사항을 DOM에 바르는 중이면 로컬 싱크 중단 (무한루프 방지)
    if (isRemoteUpdate) return

    const localText = editor.innerText

    // 💡 중요: innerText는 브라우저마다 줄바꿈 처리가 다를 수 있음. 
    // 여기서는 동기화 일관성을 위해 획득한 텍스트를 기반으로 diff를 수행함.

    // 변경된 게 없으면 패스
    if (localText === lastSyncedContent) return

    isLocalUpdate = true // 🔒 로컬 업데이트 시작임을 표시

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
    }, 'local-input') // origin을 명시

    lastSyncedContent = localText
    isLocalUpdate = false // 🔓 로컬 업데이트 끝
}

// --- EVENT HANDLERS ---

editor.addEventListener('compositionstart', () => {
    isComposing = true
})

editor.addEventListener('compositionend', () => {
    isComposing = false
    // ⚠️ 중요: 여기서 syncLocalToRemote()를 호출하지 마!
    // compositionend 직후에 input 이벤트가 무조건 발생하므로 거기서 처리해야
    // "글자 두 번 입력됨" 문제를 막을 수 있어.
})

editor.addEventListener('input', (e) => {
    // 조합 중일 때는 Yjs에 반영하지 않음 (한글 깨짐 방지)
    if (isComposing) return

    syncLocalToRemote()
    updateRelativeCursor() // 입력 후 커서 위치 갱신
})

// 커서 이동 감지하여 상대적 위치 저장
editor.addEventListener('mouseup', updateRelativeCursor)
editor.addEventListener('keyup', (e) => {
    // 화살표 키 등으로 이동했을 때 갱신
    if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown') {
        updateRelativeCursor()
    }
})
document.addEventListener('selectionchange', () => {
    // selectionchange는 너무 자주 발생하므로 포커스 확인 후 조심스럽게 사용하거나
    // 필요한 이벤트들에서만 갱신
    if (document.activeElement === editor) {
        updateRelativeCursor()
    }
})

// Yjs 관찰자
ytext.observe(event => {
    // 내가 발생시킨 트랜잭션이면 무시 (무한루프 방지 핵심)
    if (event.transaction.origin === 'local-input') return

    updateDOMFromYjs()
})

// 초기 로딩
lastSyncedContent = ytext.toString()
editor.innerText = lastSyncedContent