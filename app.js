/* PARIS NoteAI - Application Logic */

// API calls are now proxied through Netlify Function for security
const GEMINI_FUNCTION_URL = '/.netlify/functions/gemini';


// Global State
let currentUser = null;
let currentNoteId = null;
let notes = [];
let aiOutputData = { original: '', generated: '' };
let selectedElement = null;
let selectedCells = [];
let selectedTable = null;
let drawingShape = null;
let isDrawing = false;
let drawStart = { x: 0, y: 0 };

// Wait for Firebase
window.addEventListener('firebase-ready', initApp);

function initApp() {
    console.log('PARIS NoteAI initializing...');

    // Track if we've already initialized and previous user state
    let isInitialized = false;
    let wasLoggedIn = false;

    window.firebaseOnAuthStateChanged(window.firebaseAuth, (user) => {
        console.log('Auth state changed:', user ? 'logged in' : 'logged out', 'initialized:', isInitialized, 'wasLoggedIn:', wasLoggedIn);

        if (user) {
            currentUser = user;
            updateUserDisplay(user);

            // Navigate to dashboard if this is a new login (wasn't logged in before)
            if (!wasLoggedIn) {
                showScreen('dashboard-screen');
                loadNotes();
            }
            wasLoggedIn = true;
        } else {
            // User logged out
            currentUser = null;
            wasLoggedIn = false;
            showScreen('auth-screen');
        }

        isInitialized = true;
    });

    setupEditorEvents();
    setupKeyboardShortcuts();
    trackChanges();
}

function updateUserDisplay(user) {
    const displayName = user.displayName || user.email.split('@')[0];
    const initial = displayName.charAt(0).toUpperCase();

    // Update all user display elements
    const elements = {
        'user-email': user.email,
        'user-name': displayName,
        'user-initial': initial,
        'dropdown-avatar': initial,
        'welcome-name': displayName
    };

    Object.entries(elements).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    });
}

function setupEditorEvents() {
    const editor = document.getElementById('editor');
    const editorContainer = document.getElementById('editor-container');

    if (!editor) return;

    // Click to select elements
    editor.addEventListener('click', (e) => {
        const target = e.target;

        // Select images
        if (target.tagName === 'IMG') {
            e.preventDefault();
            selectElement(target, 'picture');
            return;
        }

        // Select SVG shapes
        if (target.closest('svg.shape')) {
            e.preventDefault();
            selectElement(target.closest('svg.shape'), 'shape');
            return;
        }

        // Select table cells
        if (target.tagName === 'TD' || target.tagName === 'TH') {
            e.stopPropagation();
            const table = target.closest('table');
            if (e.ctrlKey || e.metaKey) {
                toggleCellSelection(target);
            } else {
                selectCell(target, table);
            }
            return;
        }

        // Clicked elsewhere - deselect
        if (!target.closest('.resize-handles') && !target.closest('.table-handle')) {
            deselectAll();
        }
    });

    // Drawing shapes
    if (editorContainer) {
        editorContainer.addEventListener('mousedown', startDrawing);
        editorContainer.addEventListener('mousemove', drawShape);
        editorContainer.addEventListener('mouseup', finishDrawing);
    }

    // Close dropdowns
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.user-menu')) {
            const dropdown = document.getElementById('user-dropdown');
            if (dropdown) dropdown.classList.remove('show');
        }
        if (!e.target.closest('.ai-styles-dropdown')) {
            const s = document.getElementById('styles-dropdown');
            if (s) s.classList.remove('show');
        }
    });

    // Track toolbar state on selection change
    editor.addEventListener('keyup', updateToolbarState);
    editor.addEventListener('mouseup', updateToolbarState);
    document.addEventListener('selectionchange', updateToolbarState);
}

// Update toolbar buttons to reflect current formatting state
function updateToolbarState() {
    const editor = document.getElementById('editor');
    if (!editor || !document.activeElement?.closest('#editor')) return;

    // Update Bold/Italic/Underline buttons
    updateToolBtn('bold', document.queryCommandState('bold'));
    updateToolBtn('italic', document.queryCommandState('italic'));
    updateToolBtn('underline', document.queryCommandState('underline'));

    // Update alignment buttons
    updateToolBtn('justifyLeft', document.queryCommandState('justifyLeft'));
    updateToolBtn('justifyCenter', document.queryCommandState('justifyCenter'));
    updateToolBtn('justifyRight', document.queryCommandState('justifyRight'));
    updateToolBtn('justifyFull', document.queryCommandState('justifyFull'));

    // Update text color indicator
    const textColor = document.queryCommandValue('foreColor');
    const textColorInput = document.getElementById('text-color');
    if (textColorInput && textColor) {
        // Convert RGB to hex if needed
        const hex = rgbToHex(textColor);
        if (hex) textColorInput.value = hex;
    }
}

function updateToolBtn(cmd, isActive) {
    const btns = document.querySelectorAll(`[onclick*="${cmd}"]`);
    btns.forEach(btn => {
        if (btn.classList.contains('tool-btn')) {
            btn.classList.toggle('active', isActive);
        }
    });
}

function rgbToHex(rgb) {
    if (!rgb) return null;
    if (rgb.startsWith('#')) return rgb;
    const match = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (!match) return null;
    const r = parseInt(match[1]).toString(16).padStart(2, '0');
    const g = parseInt(match[2]).toString(16).padStart(2, '0');
    const b = parseInt(match[3]).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
}

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        const editorScreen = document.getElementById('editor-screen');
        if (!editorScreen?.classList.contains('active')) return;

        if (e.ctrlKey || e.metaKey) {
            switch (e.key.toLowerCase()) {
                case 's': e.preventDefault(); saveNote(); break;
                case 'b': e.preventDefault(); formatText('bold'); break;
                case 'i': e.preventDefault(); formatText('italic'); break;
                case 'u': e.preventDefault(); formatText('underline'); break;
                case 'f': e.preventDefault(); showFindReplace('find'); break;
                case 'h': e.preventDefault(); showFindReplace('replace'); break;
            }
        }

        if (e.key === 'Delete' && selectedElement) {
            selectedElement.remove();
            deselectAll();
        }

        if (e.key === 'Escape') {
            drawingShape = null;
            document.getElementById('editor-container')?.classList.remove('drawing-mode');
            deselectAll();
            closeFindModal();
        }
    });
}

// Custom font size function for editable input
function changeFontSizeCustom(size) {
    const editor = document.getElementById('editor');
    if (!editor) return;

    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    if (range.collapsed) return;

    const span = document.createElement('span');
    span.style.fontSize = size + 'px';

    try {
        range.surroundContents(span);
    } catch (e) {
        // If selection spans multiple elements, use execCommand fallback
        document.execCommand('fontSize', false, '7');
        const fontElements = editor.querySelectorAll('font[size="7"]');
        fontElements.forEach(el => {
            el.removeAttribute('size');
            el.style.fontSize = size + 'px';
        });
    }
}

// Custom Font Dropdown Functions
function toggleFontDropdown() {
    const dropdown = document.getElementById('font-dropdown');
    dropdown?.classList.toggle('open');

    // Close when clicking outside
    if (dropdown?.classList.contains('open')) {
        setTimeout(() => {
            document.addEventListener('click', closeFontDropdownOnOutsideClick);
        }, 0);
    }
}

function closeFontDropdownOnOutsideClick(e) {
    const dropdown = document.getElementById('font-dropdown');
    if (dropdown && !dropdown.contains(e.target)) {
        dropdown.classList.remove('open');
        document.removeEventListener('click', closeFontDropdownOnOutsideClick);
    }
}

function selectFont(fontFamily, displayName) {
    // Update display
    const display = document.getElementById('font-display');
    if (display) display.textContent = displayName;

    // Close dropdown
    const dropdown = document.getElementById('font-dropdown');
    dropdown?.classList.remove('open');
    document.removeEventListener('click', closeFontDropdownOnOutsideClick);

    // Apply font to selection
    const editor = document.getElementById('editor');
    if (!editor) return;

    const selection = window.getSelection();
    if (!selection.rangeCount) {
        // No selection, apply to entire editor
        editor.style.fontFamily = fontFamily;
        return;
    }

    const range = selection.getRangeAt(0);
    if (range.collapsed) {
        // Cursor only, apply to editor
        editor.style.fontFamily = fontFamily;
        return;
    }

    // Apply to selected text
    const span = document.createElement('span');
    span.style.fontFamily = fontFamily;

    try {
        range.surroundContents(span);
    } catch (e) {
        // Complex selection, use execCommand fallback
        document.execCommand('fontName', false, fontFamily);
    }
}

// Element Selection
function selectElement(el, type) {
    deselectAll();
    selectedElement = el;
    el.classList.add('selected');
    showResizeHandles(el);
    showFormatPanel(type);
    switchToolbarTab('format');
}

function selectCell(cell, table) {
    deselectAll();
    cell.classList.add('selected');
    selectedCells = [cell];
    selectedTable = table;
    showTableHandle(table);
    showFormatPanel('table');
    switchToolbarTab('format');
}

function toggleCellSelection(cell) {
    if (cell.classList.contains('selected')) {
        cell.classList.remove('selected');
        selectedCells = selectedCells.filter(c => c !== cell);
    } else {
        cell.classList.add('selected');
        selectedCells.push(cell);
    }
}

function deselectAll() {
    document.querySelectorAll('#editor .selected').forEach(el => el.classList.remove('selected'));
    selectedElement = null;
    selectedCells = [];
    selectedTable = null;
    hideResizeHandles();
    hideTableHandle();
    showFormatPanel('none');
}

// Resize Handles
function showResizeHandles(el) {
    const handles = document.getElementById('resize-handles');
    if (!handles) return;

    const rect = el.getBoundingClientRect();
    const editorContainer = document.getElementById('editor-container');
    const containerRect = editorContainer ? editorContainer.getBoundingClientRect() : { left: 0, top: 0 };

    // Position relative to the viewport
    handles.style.display = 'block';
    handles.style.left = rect.left + 'px';
    handles.style.top = rect.top + 'px';
    handles.style.width = rect.width + 'px';
    handles.style.height = rect.height + 'px';

    // Store element reference for scroll updates
    handles.dataset.targetId = el.id || '';
    handles._targetElement = el;

    // Setup resize handlers
    handles.querySelectorAll('.resize-handle').forEach(h => {
        h.onmousedown = (e) => startResize(e, h.dataset.dir, el);
    });
}

// Update handles position on scroll
function updateResizeHandlesPosition() {
    const handles = document.getElementById('resize-handles');
    if (!handles || handles.style.display === 'none') return;

    const el = handles._targetElement;
    if (!el || !document.body.contains(el)) {
        hideResizeHandles();
        return;
    }

    const rect = el.getBoundingClientRect();
    handles.style.left = rect.left + 'px';
    handles.style.top = rect.top + 'px';
    handles.style.width = rect.width + 'px';
    handles.style.height = rect.height + 'px';
}

// Add scroll listener for editor container
document.addEventListener('DOMContentLoaded', () => {
    const editorContainer = document.getElementById('editor-container');
    if (editorContainer) {
        editorContainer.addEventListener('scroll', updateResizeHandlesPosition);
    }
    window.addEventListener('scroll', updateResizeHandlesPosition);
    window.addEventListener('resize', updateResizeHandlesPosition);
});

function hideResizeHandles() {
    const handles = document.getElementById('resize-handles');
    if (handles) {
        handles.style.display = 'none';
        handles._targetElement = null;
    }
}

function startResize(e, dir, el) {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const startW = el.offsetWidth;
    const startH = el.offsetHeight;
    const aspectRatio = startW / startH;

    // Check if it's a corner resize (should maintain aspect ratio)
    const isCorner = (dir === 'nw' || dir === 'ne' || dir === 'sw' || dir === 'se');

    function resize(e) {
        let w = startW, h = startH;

        if (isCorner) {
            // Corner resize - maintain aspect ratio
            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;

            // Use the larger delta to determine scale
            let delta;
            if (dir === 'se') {
                delta = Math.max(deltaX, deltaY * aspectRatio);
                w = startW + delta;
                h = w / aspectRatio;
            } else if (dir === 'nw') {
                delta = Math.max(-deltaX, -deltaY * aspectRatio);
                w = startW + delta;
                h = w / aspectRatio;
            } else if (dir === 'ne') {
                delta = Math.max(deltaX, -deltaY * aspectRatio);
                w = startW + delta;
                h = w / aspectRatio;
            } else if (dir === 'sw') {
                delta = Math.max(-deltaX, deltaY * aspectRatio);
                w = startW + delta;
                h = w / aspectRatio;
            }
        } else {
            // Edge resize - change only width or height
            if (dir === 'e') w = startW + (e.clientX - startX);
            if (dir === 'w') w = startW - (e.clientX - startX);
            if (dir === 's') h = startH + (e.clientY - startY);
            if (dir === 'n') h = startH - (e.clientY - startY);
        }

        // Apply minimum size
        if (w > 20 && h > 20) {
            el.style.width = w + 'px';
            el.style.height = h + 'px';

            // For SVG elements, also set the attributes
            if (el.tagName.toLowerCase() === 'svg') {
                el.setAttribute('width', w);
                el.setAttribute('height', h);
            }
        }

        // Update handles position
        updateResizeHandlesPosition();
    }

    function stopResize() {
        document.removeEventListener('mousemove', resize);
        document.removeEventListener('mouseup', stopResize);
    }

    document.addEventListener('mousemove', resize);
    document.addEventListener('mouseup', stopResize);
}

// Table Handle
function showTableHandle(table) {
    const handle = document.getElementById('table-handle');
    if (!handle || !table) return;

    const rect = table.getBoundingClientRect();
    handle.style.display = 'block';
    handle.style.left = (rect.left - 28) + 'px';
    handle.style.top = (rect.top - 28) + 'px';

    const moveHandle = handle.querySelector('.table-move-handle');
    if (moveHandle) {
        moveHandle.onmousedown = (e) => startTableMove(e, table);
    }
}

function hideTableHandle() {
    const handle = document.getElementById('table-handle');
    if (handle) handle.style.display = 'none';
}

function startTableMove(e, table) {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = table.offsetLeft;
    const startTop = table.offsetTop;

    table.style.position = 'relative';

    function move(e) {
        table.style.left = (startLeft + e.clientX - startX) + 'px';
        table.style.top = (startTop + e.clientY - startY) + 'px';
        showTableHandle(table);
    }

    function stopMove() {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', stopMove);
    }

    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', stopMove);
}

// Format Panel Switching
function showFormatPanel(type) {
    ['format-none', 'format-picture', 'format-shape', 'format-table'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    const panel = document.getElementById(`format-${type}`);
    if (panel) panel.style.display = 'flex';
}

// Drawing Shapes
function selectShapeToDraw(shape) {
    drawingShape = shape;
    document.querySelectorAll('.shape-btn').forEach(b => b.classList.remove('selected'));
    event.target.closest('.shape-btn')?.classList.add('selected');

    closeShapesModal();
    document.getElementById('editor-container')?.classList.add('drawing-mode');
    showToast('Click and drag on the editor to draw the shape', 'success');
}

function startDrawing(e) {
    if (!drawingShape) return;
    const editor = document.getElementById('editor');
    if (!e.target.closest('.editor')) return;

    isDrawing = true;
    const rect = editor.getBoundingClientRect();
    drawStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function drawShape(e) {
    if (!isDrawing || !drawingShape) return;
}

function finishDrawing(e) {
    if (!isDrawing || !drawingShape) return;
    isDrawing = false;

    const editor = document.getElementById('editor');
    const rect = editor.getBoundingClientRect();
    const endX = e.clientX - rect.left;
    const endY = e.clientY - rect.top;

    const width = Math.abs(endX - drawStart.x);
    const height = Math.abs(endY - drawStart.y);

    if (width < 10 || height < 10) {
        // Too small, insert default size
        insertShapeAtCursor(drawingShape, 100, 100);
    } else {
        insertShapeAtCursor(drawingShape, width, height);
    }

    drawingShape = null;
    document.getElementById('editor-container')?.classList.remove('drawing-mode');
}

function insertShapeAtCursor(shape, w, h) {
    const fill = document.getElementById('shape-fill-color')?.value || '#4472C4';
    const stroke = document.getElementById('shape-border-color')?.value || '#2F528F';

    let svg = '';
    const common = `class="shape" style="width:${w}px;height:${h}px;display:inline-block;vertical-align:middle;" preserveAspectRatio="xMidYMid meet"`;

    switch (shape) {
        case 'circle':
            svg = `<svg ${common} viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="${fill}" stroke="${stroke}" stroke-width="2"/></svg>`;
            break;
        case 'rectangle':
            svg = `<svg ${common} viewBox="0 0 100 70"><rect x="2" y="2" width="96" height="66" fill="${fill}" stroke="${stroke}" stroke-width="2"/></svg>`;
            break;
        case 'rounded-rect':
            svg = `<svg ${common} viewBox="0 0 100 70"><rect x="2" y="2" width="96" height="66" rx="12" fill="${fill}" stroke="${stroke}" stroke-width="2"/></svg>`;
            break;
        case 'triangle':
            svg = `<svg ${common} viewBox="0 0 100 100"><polygon points="50,5 95,95 5,95" fill="${fill}" stroke="${stroke}" stroke-width="2"/></svg>`;
            break;
        case 'diamond':
            svg = `<svg ${common} viewBox="0 0 100 100"><polygon points="50,2 98,50 50,98 2,50" fill="${fill}" stroke="${stroke}" stroke-width="2"/></svg>`;
            break;
        case 'star':
            svg = `<svg ${common} viewBox="0 0 100 100"><polygon points="50,5 61,35 95,35 68,57 79,91 50,70 21,91 32,57 5,35 39,35" fill="${fill}" stroke="${stroke}" stroke-width="2"/></svg>`;
            break;
        case 'arrow':
            svg = `<svg ${common} viewBox="0 0 100 60"><polygon points="95,30 60,5 60,20 5,20 5,40 60,40 60,55" fill="${fill}" stroke="${stroke}" stroke-width="2"/></svg>`;
            break;
        case 'line':
            svg = `<svg ${common} viewBox="0 0 100 20"><line x1="0" y1="10" x2="100" y2="10" stroke="${stroke}" stroke-width="4"/></svg>`;
            break;
    }

    const editor = document.getElementById('editor');
    editor.focus();
    document.execCommand('insertHTML', false, svg + ' ');
    showToast('Shape inserted!', 'success');
}

// Format Functions - Picture
function applyPictureBorder() {
    if (!selectedElement || selectedElement.tagName !== 'IMG') return;
    const color = document.getElementById('pic-border-color')?.value || '#000';
    const width = document.getElementById('pic-border-width')?.value || 0;
    selectedElement.style.border = `${width}px solid ${color}`;
}

function applyPictureOpacity(val) {
    if (!selectedElement) return;
    selectedElement.style.opacity = val / 100;
    document.getElementById('pic-opacity-val').textContent = val + '%';
}

function applyPictureRadius(val) {
    if (!selectedElement) return;
    selectedElement.style.borderRadius = val + 'px';
}

// Format Functions - Shape
function applyShapeFill(color) {
    if (!selectedElement?.classList.contains('shape')) return;
    selectedElement.querySelectorAll('circle,rect,polygon,ellipse,path').forEach(s => s.setAttribute('fill', color));
}

function applyShapeStroke(color) {
    if (!selectedElement?.classList.contains('shape')) return;
    selectedElement.querySelectorAll('circle,rect,polygon,ellipse,path,line').forEach(s => s.setAttribute('stroke', color));
}

function applyShapeStrokeWidth(val) {
    if (!selectedElement?.classList.contains('shape')) return;
    selectedElement.querySelectorAll('circle,rect,polygon,ellipse,path,line').forEach(s => s.setAttribute('stroke-width', val));
}

function applyShapeOpacity(val) {
    if (!selectedElement) return;
    selectedElement.style.opacity = val / 100;
    document.getElementById('shape-opacity-val').textContent = val + '%';
}

// Format Functions - Table
function applyCellBgColor(color) {
    selectedCells.forEach(c => c.style.backgroundColor = color);
}

function alignCellH(align) {
    selectedCells.forEach(c => c.style.textAlign = align);
}

function alignCellV(align) {
    selectedCells.forEach(c => c.style.verticalAlign = align);
}

function mergeCells() {
    if (selectedCells.length < 2) {
        showToast('Select 2+ cells with Ctrl+Click', 'error');
        return;
    }

    // Check same row
    const firstRow = selectedCells[0].parentElement;
    const sameRow = selectedCells.every(c => c.parentElement === firstRow);

    if (!sameRow) {
        // Try vertical merge
        const firstCol = Array.from(firstRow.children).indexOf(selectedCells[0]);
        const sameCol = selectedCells.every(c => {
            const row = c.parentElement;
            return Array.from(row.children).indexOf(c) === firstCol;
        });

        if (sameCol) {
            // Vertical merge
            let content = selectedCells.map(c => c.innerHTML).join('<br>');
            selectedCells[0].setAttribute('rowspan', selectedCells.length);
            selectedCells[0].innerHTML = content;
            for (let i = 1; i < selectedCells.length; i++) {
                selectedCells[i].remove();
            }
            showToast('Cells merged vertically!', 'success');
        } else {
            showToast('Select cells in same row or column', 'error');
        }
    } else {
        // Horizontal merge
        let content = selectedCells.map(c => c.innerHTML).join(' ');
        selectedCells[0].setAttribute('colspan', selectedCells.length);
        selectedCells[0].innerHTML = content;
        for (let i = 1; i < selectedCells.length; i++) {
            selectedCells[i].remove();
        }
        showToast('Cells merged!', 'success');
    }

    deselectAll();
}

function addTableRow() {
    if (!selectedTable && selectedCells.length === 0) {
        showToast('Select a table cell first', 'error');
        return;
    }

    const table = selectedTable || selectedCells[0]?.closest('table');
    if (!table) return;

    const row = selectedCells[0]?.parentElement || table.querySelector('tr');
    const cols = row.children.length;

    const newRow = document.createElement('tr');
    for (let i = 0; i < cols; i++) {
        const td = document.createElement('td');
        td.style.cssText = 'border:1px solid #ccc;padding:10px;';
        td.innerHTML = '&nbsp;';
        newRow.appendChild(td);
    }

    row.parentNode.insertBefore(newRow, row.nextSibling);
    showToast('Row added!', 'success');
}

function addTableColumn() {
    if (!selectedTable && selectedCells.length === 0) {
        showToast('Select a table cell first', 'error');
        return;
    }

    const table = selectedTable || selectedCells[0]?.closest('table');
    if (!table) return;

    table.querySelectorAll('tr').forEach((tr, i) => {
        const cell = document.createElement(i === 0 ? 'th' : 'td');
        cell.style.cssText = i === 0 ? 'border:1px solid #ccc;padding:10px;background:#e8e8e8;font-weight:600;' : 'border:1px solid #ccc;padding:10px;';
        cell.innerHTML = '&nbsp;';
        tr.appendChild(cell);
    });

    showToast('Column added!', 'success');
}

function deleteTableRow() {
    if (selectedCells.length === 0) {
        showToast('Select a cell first', 'error');
        return;
    }
    selectedCells[0].parentElement.remove();
    deselectAll();
    showToast('Row deleted!', 'success');
}

function deleteTableColumn() {
    if (selectedCells.length === 0) {
        showToast('Select a cell first', 'error');
        return;
    }

    const table = selectedCells[0].closest('table');
    const cell = selectedCells[0];
    const colIndex = Array.from(cell.parentElement.children).indexOf(cell);

    table.querySelectorAll('tr').forEach(tr => {
        if (tr.children[colIndex]) tr.children[colIndex].remove();
    });

    deselectAll();
    showToast('Column deleted!', 'success');
}

// Screen Management
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id)?.classList.add('active');
}

// Save and go back to dashboard
async function saveAndGoBack() {
    const title = document.getElementById('note-title')?.value || 'Untitled Note';
    const content = document.getElementById('editor')?.innerHTML || '';

    // Only save if there's content
    if (content.trim() && currentUser) {
        try {
            if (currentNoteId) {
                await window.firebaseSetDoc(
                    window.firebaseDoc(window.firebaseDb, 'notes', currentNoteId),
                    { title, content, userId: currentUser.uid, updatedAt: Date.now() },
                    { merge: true }
                );
            }
        } catch (e) {
            console.error('Error saving:', e);
        }
    }

    currentNoteId = null;
    showScreen('dashboard-screen');
    loadNotes();
}

// Auth
async function handleLogin() {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    if (!email || !password) return showAuthError('Please fill all fields');
    try {
        await window.firebaseSignIn(window.firebaseAuth, email, password);
        showToast('Welcome back!', 'success');
    } catch (e) { showAuthError(getAuthErrorMessage(e.code)); }
}

async function handleSignup() {
    const name = document.getElementById('signup-name').value;
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    if (!name || !email || !password) return showAuthError('Please fill all fields');
    if (password.length < 6) return showAuthError('Password must be 6+ characters');
    try {
        const cred = await window.firebaseCreateUser(window.firebaseAuth, email, password);
        await window.firebaseUpdateProfile(cred.user, { displayName: name });
        showToast('Account created!', 'success');
    } catch (e) { showAuthError(getAuthErrorMessage(e.code)); }
}

function switchAuthForm(form) {
    document.getElementById('login-form')?.classList.toggle('active', form === 'login');
    document.getElementById('signup-form')?.classList.toggle('active', form === 'signup');
    document.getElementById('auth-error')?.classList.remove('show');
}

function showAuthError(msg) {
    const el = document.getElementById('auth-error');
    if (el) { el.textContent = msg; el.classList.add('show'); }
}

function getAuthErrorMessage(code) {
    const msgs = {
        'auth/email-already-in-use': 'Email already registered',
        'auth/invalid-email': 'Invalid email',
        'auth/user-not-found': 'No account found',
        'auth/wrong-password': 'Incorrect password',
        'auth/invalid-credential': 'Invalid credentials'
    };
    return msgs[code] || 'An error occurred';
}

async function signOut() {
    await window.firebaseSignOut(window.firebaseAuth);
    showToast('Signed out');
}

function toggleUserMenu() {
    document.getElementById('user-dropdown')?.classList.toggle('show');
}

// Notes
async function loadNotes() {
    if (!currentUser) return;
    try {
        const q = window.firestoreQuery(
            window.firestoreCollection(window.firebaseDb, 'notes'),
            window.firestoreWhere('userId', '==', currentUser.uid)
        );
        const snap = await window.firestoreGetDocs(q);
        notes = [];
        snap.forEach(doc => notes.push({ id: doc.id, ...doc.data() }));
        notes.sort((a, b) => (b.updatedAt?.toDate?.() || 0) - (a.updatedAt?.toDate?.() || 0));
        renderNotes();
    } catch (e) {
        console.error('Error loading notes:', e);
        renderNotes();
    }
}

function renderNotes(filtered = null) {
    const container = document.getElementById('notes-container');
    const empty = document.getElementById('empty-state');
    const list = filtered || notes;

    if (!list.length) {
        container.innerHTML = '';
        empty?.classList.add('show');
        return;
    }

    empty?.classList.remove('show');
    container.innerHTML = list.map(n => `
        <div class="note-card" onclick="openNote('${n.id}')">
            <h3 class="note-card-title">${escapeHtml(n.title) || 'Untitled'}</h3>
            <p class="note-card-preview">${getPreview(n.content)}</p>
            <div class="note-card-footer">
                <span class="note-card-date">${formatDate(n.updatedAt)}</span>
                <button class="note-card-delete" onclick="deleteNote(event,'${n.id}')">
                    <span class="material-icons-round">delete</span>
                </button>
            </div>
        </div>
    `).join('');
}

function searchNotes(query) {
    if (!query.trim()) return renderNotes();
    const term = query.toLowerCase();
    const filtered = notes.filter(n =>
        (n.title || '').toLowerCase().includes(term) ||
        (n.content || '').toLowerCase().includes(term)
    );
    renderNotes(filtered);
}

function getPreview(content) {
    if (!content) return 'No content';
    const div = document.createElement('div');
    div.innerHTML = content;
    const text = div.textContent || '';
    return text.substring(0, 150) + (text.length > 150 ? '...' : '');
}

function formatDate(ts) {
    if (!ts) return 'Just now';
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    const diff = Date.now() - date;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function animateAndCreateNote() {
    createNewNote();
}

function createNewNote() {
    currentNoteId = null;
    document.getElementById('note-title').value = '';
    document.getElementById('editor').innerHTML = '';
    markChangesSaved(); // Reset change tracking
    showScreen('editor-screen');
    setTimeout(() => document.getElementById('editor')?.focus(), 100);
}

async function openNote(id) {
    const note = notes.find(n => n.id === id);
    if (!note) return;
    currentNoteId = id;
    document.getElementById('note-title').value = note.title || '';
    document.getElementById('editor').innerHTML = note.content || '';
    showScreen('editor-screen');
}

// Track unsaved changes
let hasUnsavedChanges = false;
let originalContent = '';
let originalTitle = '';

function trackChanges() {
    const editor = document.getElementById('editor');
    const titleInput = document.getElementById('note-title');
    if (editor) {
        editor.addEventListener('input', () => { hasUnsavedChanges = true; });
    }
    if (titleInput) {
        titleInput.addEventListener('input', () => { hasUnsavedChanges = true; });
    }
}

function markChangesSaved() {
    hasUnsavedChanges = false;
    originalContent = document.getElementById('editor')?.innerHTML || '';
    originalTitle = document.getElementById('note-title')?.value || '';
}

function checkForChanges() {
    const currentContent = document.getElementById('editor')?.innerHTML || '';
    const currentTitle = document.getElementById('note-title')?.value || '';
    return currentContent !== originalContent || currentTitle !== originalTitle;
}

async function saveNote() {
    if (!currentUser) return showToast('Sign in to save', 'error');
    const title = document.getElementById('note-title')?.value.trim();
    const content = document.getElementById('editor')?.innerHTML;
    if (!title && !content.replace(/<[^>]*>/g, '').trim()) return showToast('Cannot save empty note', 'error');

    // If no title and there's content, prompt for title
    if (!title && content.replace(/<[^>]*>/g, '').trim()) {
        showTitleModal();
        return;
    }

    await performSave(title, content);
}

async function performSave(title, content) {
    try {
        const data = { title: title || 'Untitled', content, userId: currentUser.uid, updatedAt: window.firestoreServerTimestamp() };
        if (currentNoteId) {
            await window.firestoreUpdateDoc(window.firestoreDoc(window.firebaseDb, 'notes', currentNoteId), data);
        } else {
            data.createdAt = window.firestoreServerTimestamp();
            const ref = await window.firestoreAddDoc(window.firestoreCollection(window.firebaseDb, 'notes'), data);
            currentNoteId = ref.id;
        }
        markChangesSaved();
        showSaveNotification();
        loadNotes();
    } catch (e) {
        console.error('Save error:', e);
        showToast('Error saving', 'error');
    }
}

// Title Modal
function showTitleModal() {
    document.getElementById('title-input').value = '';
    document.getElementById('title-modal')?.classList.add('show');
    setTimeout(() => document.getElementById('title-input')?.focus(), 100);
}

function closeTitleModal() {
    document.getElementById('title-modal')?.classList.remove('show');
}

async function saveWithTitle() {
    const title = document.getElementById('title-input')?.value.trim() || 'Untitled';
    const content = document.getElementById('editor')?.innerHTML;
    document.getElementById('note-title').value = title;
    closeTitleModal();
    await performSave(title, content);
}

// Unsaved Changes Modal
function showUnsavedModal() {
    document.getElementById('unsaved-modal')?.classList.add('show');
}

function closeUnsavedModal() {
    document.getElementById('unsaved-modal')?.classList.remove('show');
}

async function saveAndExit() {
    closeUnsavedModal();
    await saveNote();
    showScreen('dashboard-screen');
    loadNotes();
}

function discardAndExit() {
    closeUnsavedModal();
    hasUnsavedChanges = false;
    showScreen('dashboard-screen');
    loadNotes();
}

function showSaveNotification() {
    const n = document.getElementById('save-notification');
    n?.classList.add('show');
    setTimeout(() => n?.classList.remove('show'), 2000);
}

async function saveAndGoBack() {
    const title = document.getElementById('note-title')?.value.trim();
    const content = document.getElementById('editor')?.innerHTML;
    const hasContent = content.replace(/<[^>]*>/g, '').trim();

    // Check if there are unsaved changes
    if (checkForChanges() && hasContent) {
        showUnsavedModal();
        return;
    }

    showScreen('dashboard-screen');
    loadNotes();
}

// Profile Modal
function showProfileModal() {
    toggleUserMenu(); // Close dropdown
    const currentName = currentUser?.displayName || currentUser?.email?.split('@')[0] || '';
    document.getElementById('profile-name').value = currentName;
    document.getElementById('profile-modal')?.classList.add('show');
    setTimeout(() => document.getElementById('profile-name')?.focus(), 100);
}

function closeProfileModal() {
    document.getElementById('profile-modal')?.classList.remove('show');
}

async function updateDisplayName() {
    const newName = document.getElementById('profile-name')?.value.trim();
    if (!newName) return showToast('Please enter a name', 'error');

    try {
        await window.firebaseUpdateProfile(currentUser, { displayName: newName });
        updateUserDisplay(currentUser);
        closeProfileModal();
        showToast('Profile updated', 'success');
    } catch (e) {
        console.error('Profile update error:', e);
        showToast('Error updating profile', 'error');
    }
}

async function deleteNote(e, id) {
    e.stopPropagation();
    showDeleteModal(id);
}

let pendingDeleteId = null;

function showDeleteModal(id) {
    pendingDeleteId = id;
    document.getElementById('delete-modal')?.classList.add('show');
}

function closeDeleteModal() {
    pendingDeleteId = null;
    document.getElementById('delete-modal')?.classList.remove('show');
}

async function confirmDelete() {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;
    closeDeleteModal();
    try {
        await window.firestoreDeleteDoc(window.firestoreDoc(window.firebaseDb, 'notes', id));
        showToast('Deleted', 'success');
        loadNotes();
    } catch (e) { showToast('Error deleting', 'error'); }
}

// Setup delete confirmation button listener
document.addEventListener('DOMContentLoaded', () => {
    const confirmBtn = document.getElementById('confirm-delete-btn');
    if (confirmBtn) confirmBtn.onclick = confirmDelete;
});

// Toolbar
function switchToolbarTab(tab) {
    document.querySelectorAll('.toolbar-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.querySelectorAll('.toolbar-content').forEach(c => c.classList.remove('active'));
    document.getElementById(`${tab}-toolbar`)?.classList.add('active');
}

function formatText(cmd) { document.execCommand(cmd, false, null); focusEditor(); }
function changeFontFamily(f) { document.execCommand('fontName', false, f); focusEditor(); }
function changeFontSize(s) { document.execCommand('fontSize', false, s); focusEditor(); }
function changeTextColor(c) { document.execCommand('foreColor', false, c); focusEditor(); }
function changeHighlight(c) { document.execCommand('hiliteColor', false, c); focusEditor(); }
function changeLineSpacing() { /* toggle line spacing */ focusEditor(); }
function insertHeading(lvl) { document.execCommand('formatBlock', false, lvl); focusEditor(); }
function insertDivider() { document.execCommand('insertHorizontalRule', false, null); focusEditor(); }
function insertQuote() {
    const text = window.getSelection().toString() || 'Quote';
    document.execCommand('insertHTML', false, `<blockquote>${text}</blockquote><p></p>`);
    focusEditor();
}
function insertLink() {
    const url = prompt('Enter URL:');
    if (url) {
        const text = window.getSelection().toString() || url;
        document.execCommand('insertHTML', false, `<a href="${url}" target="_blank">${text}</a>`);
    }
    focusEditor();
}
function selectAllText() { document.getElementById('editor')?.focus(); document.execCommand('selectAll'); }
function focusEditor() { setTimeout(() => document.getElementById('editor')?.focus(), 10); }

// Table Dialog
function showTableDialog() { document.getElementById('table-modal')?.classList.add('show'); }
function closeTableModal() { document.getElementById('table-modal')?.classList.remove('show'); focusEditor(); }

function insertTableWithSize() {
    const rows = parseInt(document.getElementById('table-rows')?.value) || 4;
    const cols = parseInt(document.getElementById('table-cols')?.value) || 5;

    let html = '<table style="width:100%;border-collapse:collapse;margin:16px 0;">';
    for (let r = 0; r < rows; r++) {
        html += '<tr>';
        for (let c = 0; c < cols; c++) {
            const tag = r === 0 ? 'th' : 'td';
            const style = r === 0 ? 'border:1px solid #ccc;padding:10px;background:#e8e8e8;font-weight:600;' : 'border:1px solid #ccc;padding:10px;';
            html += `<${tag} style="${style}">&nbsp;</${tag}>`;
        }
        html += '</tr>';
    }
    html += '</table><p><br></p>';

    document.getElementById('editor')?.focus();
    document.execCommand('insertHTML', false, html);
    closeTableModal();
    showToast('Table inserted!', 'success');
}

// Image
function insertImageFromComputer() { document.getElementById('image-upload')?.click(); }

function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file?.type.startsWith('image/')) return showToast('Select an image', 'error');

    const reader = new FileReader();
    reader.onload = (ev) => {
        document.getElementById('editor')?.focus();
        document.execCommand('insertHTML', false, `<img src="${ev.target.result}" style="width:300px;height:auto;"><p><br></p>`);
        showToast('Image inserted!', 'success');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
}

// Shapes
function showShapesDialog() { document.getElementById('shapes-modal')?.classList.add('show'); }
function closeShapesModal() { document.getElementById('shapes-modal')?.classList.remove('show'); }

// Find/Replace
function showFindReplace(mode) {
    document.getElementById('find-modal')?.classList.add('show');
    document.getElementById('find-modal-title').textContent = mode === 'replace' ? 'Find & Replace' : 'Find';
    document.getElementById('replace-field').style.display = mode === 'replace' ? 'block' : 'none';
    document.getElementById('replace-btn').style.display = mode === 'replace' ? 'inline-block' : 'none';
}

function closeFindModal() { document.getElementById('find-modal')?.classList.remove('show'); focusEditor(); }
function executeFind() { window.find(document.getElementById('find-input')?.value || '', false, false, true); }
function executeReplace() {
    const find = document.getElementById('find-input')?.value;
    const replace = document.getElementById('replace-input')?.value;
    if (!find) return;
    const editor = document.getElementById('editor');
    editor.innerHTML = editor.innerHTML.split(find).join(replace);
    showToast('Replaced all', 'success');
    closeFindModal();
}

// AI Functions
function toggleStylesDropdown() { document.getElementById('styles-dropdown')?.classList.toggle('show'); }
function getSelectedText() { return window.getSelection().toString(); }
function showAILoading() { document.getElementById('ai-loading')?.classList.add('show'); }
function hideAILoading() { document.getElementById('ai-loading')?.classList.remove('show'); }

// AI Chat Functions
let chatHistory = [];

function toggleAIChat() {
    const wrapper = document.getElementById('editor-chat-wrapper');
    wrapper?.classList.toggle('chat-open');

    // Focus chat input and update username when opened
    if (wrapper?.classList.contains('chat-open')) {
        // Update chat username
        const userName = currentUser?.displayName || currentUser?.email?.split('@')[0] || 'User';
        const chatUsername = document.getElementById('chat-username');
        if (chatUsername) chatUsername.textContent = userName;

        setTimeout(() => document.getElementById('chat-input')?.focus(), 300);
    }
}

async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const message = input?.value.trim();
    if (!message) return;

    // Clear input
    input.value = '';

    // Remove welcome message if present
    const welcome = document.querySelector('.chat-welcome');
    if (welcome) welcome.remove();

    // Add user message
    addChatMessage(message, 'user');

    // Show loading
    showChatLoading();

    try {
        // Build context from chat history
        const contextHistory = chatHistory.slice(-6).map(m =>
            `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
        ).join('\n');

        const systemPrompt = `You are PARIS NoteAI, a helpful AI assistant for note-taking. Be concise, friendly, and helpful. If the user asks about notes, writing, or needs information, provide clear and useful responses.`;

        const fullPrompt = contextHistory
            ? `${systemPrompt}\n\nConversation history:\n${contextHistory}\n\nUser: ${message}\n\nAssistant:`
            : `${systemPrompt}\n\nUser: ${message}\n\nAssistant:`;

        const response = await callGeminiAPI(fullPrompt);

        // Store in history
        chatHistory.push({ role: 'user', content: message });
        chatHistory.push({ role: 'assistant', content: response });

        // Hide loading and show response
        hideChatLoading();
        addChatMessage(response, 'ai');

    } catch (e) {
        hideChatLoading();
        addChatMessage('Sorry, I encountered an error. Please try again.', 'ai');
        console.error('Chat error:', e);
    }
}

function addChatMessage(text, type) {
    const messages = document.getElementById('chat-messages');
    const msg = document.createElement('div');
    msg.className = `chat-message ${type}`;
    msg.textContent = text;
    messages.appendChild(msg);
    messages.scrollTop = messages.scrollHeight;
}

function showChatLoading() {
    const messages = document.getElementById('chat-messages');
    const loading = document.createElement('div');
    loading.className = 'chat-loading';
    loading.id = 'chat-loading';
    loading.innerHTML = '<span></span><span></span><span></span>';
    messages.appendChild(loading);
    messages.scrollTop = messages.scrollHeight;
}

function hideChatLoading() {
    document.getElementById('chat-loading')?.remove();
}

async function callGeminiAPI(prompt) {
    const res = await fetch(GEMINI_FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
    });
    if (!res.ok) throw new Error('API failed');
    const data = await res.json();
    return data.text;
}

function formatAIOutput(text) {
    return text
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/__(.+?)__/g, '<strong>$1</strong>')
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br>');
}

function showAIOutputModal(orig, gen, title) {
    aiOutputData = { original: orig, generated: gen };
    document.getElementById('ai-output-title').textContent = title;
    document.getElementById('ai-original-text').textContent = orig;
    document.getElementById('ai-generated-text').innerHTML = formatAIOutput(gen);
    document.getElementById('ai-output-modal')?.classList.add('show');
}

function closeAIOutputModal() { document.getElementById('ai-output-modal')?.classList.remove('show'); focusEditor(); }
function copyAIOutput() { navigator.clipboard.writeText(aiOutputData.generated); showToast('Copied!', 'success'); }
function insertAIOutput() {
    document.getElementById('editor')?.focus();
    document.execCommand('insertHTML', false, formatAIOutput(aiOutputData.generated));
    closeAIOutputModal();
    showToast('Inserted!', 'success');
}

async function aiRewrite() {
    const text = getSelectedText();
    if (!text.trim()) return showToast('Select text to rewrite', 'error');
    showAILoading();
    try {
        const result = await callGeminiAPI(`Rewrite this text clearly. Use **bold** for key terms:\n\n"${text}"`);
        hideAILoading();
        showAIOutputModal(text, result, 'Rewrite Result');
    } catch (e) { hideAILoading(); showToast('Error', 'error'); }
}

function aiCompose() {
    document.getElementById('compose-modal')?.classList.add('show');
    document.getElementById('compose-prompt').value = '';
}

function closeComposeModal() { document.getElementById('compose-modal')?.classList.remove('show'); focusEditor(); }

async function generateCompose() {
    const prompt = document.getElementById('compose-prompt')?.value.trim();
    if (!prompt) return showToast('Describe what to write', 'error');
    closeComposeModal();
    showAILoading();
    try {
        const result = await callGeminiAPI(`Write content about: "${prompt}". Use **bold** for key terms.`);
        hideAILoading();
        showAIOutputModal(prompt, result, 'Compose Result');
    } catch (e) { hideAILoading(); showToast('Error', 'error'); }
}

async function aiRefine() {
    const text = getSelectedText();
    if (!text.trim()) return showToast('Select text to refine', 'error');
    showAILoading();
    try {
        const result = await callGeminiAPI(`Refine this text for clarity and grammar:\n\n"${text}"`);
        hideAILoading();
        showAIOutputModal(text, result, 'Refine Result');
    } catch (e) { hideAILoading(); showToast('Error', 'error'); }
}

async function applyStyle(style) {
    document.getElementById('styles-dropdown')?.classList.remove('show');
    const text = getSelectedText();
    if (!text.trim()) return showToast('Select text first', 'error');
    showAILoading();
    try {
        const result = await callGeminiAPI(`Rewrite in ${style} style:\n\n"${text}"`);
        hideAILoading();
        showAIOutputModal(text, result, `${style} Style`);
    } catch (e) { hideAILoading(); showToast('Error', 'error'); }
}

async function applyCustomStyle() {
    const style = document.getElementById('custom-style')?.value.trim();
    if (!style) return showToast('Enter a style', 'error');
    document.getElementById('styles-dropdown')?.classList.remove('show');
    const text = getSelectedText();
    if (!text.trim()) return showToast('Select text first', 'error');
    showAILoading();
    try {
        const result = await callGeminiAPI(`Rewrite with style "${style}":\n\n"${text}"`);
        document.getElementById('custom-style').value = '';
        hideAILoading();
        showAIOutputModal(text, result, 'Custom Style');
    } catch (e) { hideAILoading(); showToast('Error', 'error'); }
}

function showToast(msg, type = '') {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = 'toast show' + (type ? ` ${type}` : '');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// Expose functions globally
Object.assign(window, {
    handleLogin, handleSignup, switchAuthForm, signOut, toggleUserMenu,
    createNewNote, openNote, saveNote, saveAndGoBack, deleteNote, searchNotes,
    switchToolbarTab, formatText, changeFontFamily, changeFontSize, changeTextColor,
    changeHighlight, changeLineSpacing, insertHeading, insertDivider, insertQuote, insertLink,
    selectAllText, showTableDialog, closeTableModal, insertTableWithSize,
    insertImageFromComputer, handleImageUpload, showShapesDialog, closeShapesModal,
    selectShapeToDraw, showFindReplace, closeFindModal, executeFind, executeReplace,
    toggleStylesDropdown, aiRewrite, aiCompose, closeComposeModal, generateCompose,
    aiRefine, applyStyle, applyCustomStyle, closeAIOutputModal, copyAIOutput, insertAIOutput,
    applyPictureBorder, applyPictureOpacity, applyPictureRadius,
    applyShapeFill, applyShapeStroke, applyShapeStrokeWidth, applyShapeOpacity,
    applyCellBgColor, alignCellH, alignCellV, mergeCells, addTableRow, addTableColumn,
    deleteTableRow, deleteTableColumn, closeDeleteModal, closeTitleModal, saveWithTitle,
    closeUnsavedModal, saveAndExit, discardAndExit,
    showProfileModal, closeProfileModal, updateDisplayName, animateAndCreateNote,
    changeFontSizeCustom, toggleAIChat, sendChatMessage,
    toggleFontDropdown, selectFont
});
