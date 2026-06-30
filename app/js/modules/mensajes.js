// js/modules/mensajes.js

import { db, storage, functions, httpsCallable } from '../firebase-config.js';
import { collection, query, onSnapshot, orderBy, doc, updateDoc, serverTimestamp, limit, getDocs, where, getDoc, writeBatch } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";
import { currentUserData, showModalMessage, showTemporaryMessage, allClientes, allRemisiones, hideModal } from '../app.js';
import { formatCurrency } from '../utils.js';
import { showPaymentModal } from './remisiones.js';

let unsubscribeChats = null;
let unsubscribeMessages = null;
let currentChatPhone = null;
let allChats = [];
let tempSendingMessage = null; 
let currentChatMessagesMap = new Map();
const updatingMessageIds = new Set();
// --- QUICK REPLIES ---
const QUICK_REPLIES = [
    { title: "saludo", text: "¡Hola! Gracias por escribir a PrismaColor. ¿En qué podemos ayudarte hoy?" },
    { title: "horarios", text: "Nuestros horarios de atención son:\n\n📅 Lunes a Viernes: 8:00 AM - 5:30 PM\n📅 Sábados: 8:00 AM - 12:15 PM" }
];

function formatMensajesText(text) {
    if (!text) return "";
    let safeText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return safeText
        .replace(/\*(.*?)\*/g, '<strong class="font-black">$1</strong>')
        .replace(/_(.*?)_/g, '<em class="italic">$1</em>')             
        .replace(/~(.*?)~/g, '<del class="line-through">$1</del>');    
}

// --- NUEVO: Variable para controlar el reloj en vivo ---
let chatTimerInterval = null;

// ESTADO DE LA BANDEJA (Por defecto mostramos los 'activos')
let currentInboxFilter = 'activo'; 

// --- NUEVO: ACTUALIZAR NOTIFICACIONES GLOBALES ---
function updateMensajesBadges() {
    // Sumamos todos los 'mensajesNoLeidos' de la lista de chats activos
    const totalUnread = allChats.reduce((sum, chat) => sum + (chat.mensajesNoLeidos || 0), 0);
    
    const desktopBadge = document.getElementById('global-unread-badge');
    const mobileBadge = document.getElementById('badge-mobile-wa');

    if (totalUnread > 0) {
        // Mostramos los globos rojos
        if (desktopBadge) { desktopBadge.textContent = totalUnread; desktopBadge.classList.remove('hidden'); }
        if (mobileBadge) { mobileBadge.textContent = totalUnread; mobileBadge.classList.remove('hidden'); }
    } else {
        // Ocultamos los globos si no hay mensajes
        if (desktopBadge) desktopBadge.classList.add('hidden');
        if (mobileBadge) mobileBadge.classList.add('hidden');
    }
}

window.viewWaImage = function(url) {
    const modal = document.getElementById('modal-secondary');
    const wrapper = document.getElementById('modal-secondary-content-wrapper');
    wrapper.innerHTML = `
        <div class="relative w-full h-[100dvh] flex items-center justify-center p-4">
            <button onclick="document.getElementById('modal-secondary').classList.add('hidden')" class="absolute top-4 right-4 text-white text-5xl font-bold z-50 hover:text-gray-300 transition">×</button>
            <img src="${url}" class="max-w-full max-h-full object-contain rounded-lg shadow-2xl">
        </div>
    `;
    modal.classList.remove('hidden');
};

// --- PANEL LATERAL DE CRM ---
window.closeCrmPanel = function() {
    const panel = document.getElementById('wa-crm-sidepanel');
    const backdrop = document.getElementById('wa-crm-backdrop');
    if (panel) panel.classList.add('translate-x-full');
    if (backdrop) backdrop.classList.add('hidden');
};

window.openCrmPanel = function(phone) {
    const client = buscarClientePorTelefono(phone);
    if (!client) return;

    const chatArea = document.getElementById('mensajes-chat-area');
    
    // Backdrop (fondo oscuro)
    let backdrop = document.getElementById('wa-crm-backdrop');
    if (!backdrop) {
        backdrop = document.createElement('div');
        backdrop.id = 'wa-crm-backdrop';
        backdrop.className = 'absolute inset-0 bg-black bg-opacity-40 z-30 hidden sm:hidden transition-opacity';
        backdrop.onclick = window.closeCrmPanel;
        chatArea.appendChild(backdrop);
    }
    backdrop.classList.remove('hidden');

    let panel = document.getElementById('wa-crm-sidepanel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'wa-crm-sidepanel';
        panel.className = 'absolute top-0 right-0 h-full w-4/5 sm:w-80 bg-gray-50 shadow-[0_0_30px_rgba(0,0,0,0.3)] transform translate-x-full transition-transform duration-300 z-40 flex flex-col border-l border-gray-200';
        
        panel.addEventListener('click', (e) => {
            const btnPago = e.target.closest('.wa-pago-btn');
            if (btnPago) {
                const remData = JSON.parse(decodeURIComponent(btnPago.dataset.remjson));
                document.dispatchEvent(new CustomEvent('openWaPaymentModal', { detail: remData }));
            }
        });
        chatArea.appendChild(panel);
    }

    const remisiones = allRemisiones.filter(r => r.idCliente === client.id && r.estado !== 'Anulada');
    let htmlDeuda = ''; let htmlPedidos = ''; let deudaTotal = 0; let pedidosPendientes = 0;

    remisiones.forEach(r => {
        const pagado = (r.payments || []).filter(p => p.status === 'confirmado').reduce((sum, p) => sum + p.amount, 0);
        const saldo = r.valorTotal - pagado;
        const remJsonEncoded = encodeURIComponent(JSON.stringify(r));
        const pdfButton = r.pdfPath ? `<button data-file-path="${r.pdfPath}" class="text-[10px] sm:text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded font-bold hover:bg-gray-300 transition">PDF</button>` : '';
        const pagoButton = `<button data-remjson="${remJsonEncoded}" class="wa-pago-btn text-[10px] sm:text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded font-bold hover:bg-purple-200 transition">Pagos</button>`;

        if (saldo > 0) {
            deudaTotal += saldo;
            htmlDeuda += `
                <div class="bg-white p-2 rounded-lg shadow-sm border border-red-100 mb-2">
                    <div class="flex justify-between items-center mb-1">
                        <span class="text-[10px] font-bold text-gray-500">REM-${r.numeroRemision}</span>
                        <span class="text-[10px] text-gray-400">${r.fechaRecibido}</span>
                    </div>
                    <div class="flex justify-between items-center mt-1 mb-2">
                        <span class="font-bold text-red-600 text-sm">${formatCurrency(saldo)}</span>
                    </div>
                    <div class="flex justify-end gap-1 pt-1 border-t border-gray-50">${pdfButton}${pagoButton}</div>
                </div>`;
        }

        if (r.estado !== 'Entregado') {
            pedidosPendientes++;
            const itemsResumen = r.items.map(i => `${i.descripcion} (x${i.cantidad})`).join(', ');
            htmlPedidos += `
                <div class="bg-white p-2 rounded-lg shadow-sm border border-amber-100 mb-2">
                    <div class="flex justify-between items-center mb-1">
                        <span class="text-[10px] font-bold text-gray-500">REM-${r.numeroRemision}</span>
                        <span class="text-[9px] font-bold text-amber-600 uppercase">${r.estado}</span>
                    </div>
                    <p class="text-[10px] text-gray-500 truncate mt-1 mb-2" title="${itemsResumen}">${itemsResumen}</p>
                    <div class="flex justify-end gap-1 pt-1 border-t border-gray-50">${pdfButton}${saldo > 0 ? pagoButton : ''}</div>
                </div>`;
        }
    });

    if (htmlDeuda === '') htmlDeuda = '<p class="text-xs text-gray-400 italic py-2">Sin saldos pendientes.</p>';
    if (htmlPedidos === '') htmlPedidos = '<p class="text-xs text-gray-400 italic py-2">Sin pedidos activos.</p>';

    panel.innerHTML = `
        <div class="p-3 sm:p-4 bg-indigo-600 text-white flex justify-between items-center flex-shrink-0 shadow-md">
            <div>
                <h3 class="font-bold text-sm">Estado de Cuenta</h3>
                <p class="text-[10px] text-indigo-200 truncate w-40 sm:max-w-[200px]">${client.nombreEmpresa || client.nombre}</p>
            </div>
            <button onclick="window.closeCrmPanel()" class="text-white text-2xl hover:text-indigo-200 leading-none">&times;</button>
        </div>
        <div class="flex-grow overflow-y-auto p-3 sm:p-4 space-y-4">
            <div>
                <div class="flex justify-between items-center border-b border-red-200 pb-1 mb-2">
                    <h4 class="font-bold text-gray-800 text-xs sm:text-sm">💰 Cartera</h4>
                    <span class="font-bold text-red-600 text-xs sm:text-sm">${formatCurrency(deudaTotal)}</span>
                </div>
                ${htmlDeuda}
            </div>
            <div>
                <div class="flex justify-between items-center border-b border-amber-200 pb-1 mb-2">
                    <h4 class="font-bold text-gray-800 text-xs sm:text-sm">📦 Activos</h4>
                    <span class="font-bold text-amber-600 text-[10px] bg-amber-50 px-1.5 py-0.5 rounded-full">${pedidosPendientes}</span>
                </div>
                ${htmlPedidos}
            </div>
        </div>
    `;
    setTimeout(() => panel.classList.remove('translate-x-full'), 10);
};

// --- CAMBIAR ESTADO DEL CHAT ---
window.toggleChatStatus = async function(phone, currentStatus) {
    const newStatus = currentStatus === 'resuelto' ? 'activo' : 'resuelto';
    showModalMessage(`Moviendo chat a ${newStatus}...`, true);
    try {
        await updateDoc(doc(db, "chats", phone), {
            estadoChat: newStatus,
            _lastUpdated: serverTimestamp()
        });
        
        if (newStatus === 'resuelto') {
            document.getElementById('mensajes-chat-area').classList.add('hidden');
            document.getElementById('mensajes-sidebar').classList.remove('hidden');
            document.getElementById('mensajes-sidebar').classList.add('flex');
            currentChatPhone = null;
        } else {
            document.getElementById('wa-chat-header-actions').innerHTML = `
                <button onclick="window.toggleChatStatus('${phone}', 'activo')" class="bg-gray-100 text-gray-700 hover:bg-gray-200 text-xs sm:text-sm font-bold py-1.5 px-3 rounded-lg shadow-sm flex items-center gap-1 transition">
                    <span class="text-green-500">✔️</span> Resolver
                </button>
            `;
        }
        hideModal();
        showTemporaryMessage(`Chat marcado como ${newStatus}`, "success");
    } catch(e) {
        hideModal();
        showModalMessage("Error al cambiar estado del chat.");
    }
};

export function loadChats() {
    if (!currentUserData || (currentUserData.role !== 'admin' && !currentUserData.permissions?.mensajes)) return;

    const q = query(collection(db, "chats"), orderBy("fechaUltimo", "desc"));
    
    unsubscribeChats = onSnapshot(q, (snapshot) => {
        allChats = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderChatList();
        updateMensajesBadges(); // <--- ¡ESTA ES LA MAGIA QUE AÑADIMOS!
    }, (error) => {
        if (currentUser && error.code !== 'permission-denied') {
            console.warn("Error en onSnapshot de chats:", error.message || error);
        } else if (currentUser) {
            console.warn("Error en onSnapshot de chats (Permisos denegados):", error.message || error);
        }
    });
}

function renderChatList(searchTerm = '') {
    const listContainer = document.getElementById('chats-list');
    if (!listContainer) return;

    let filteredChats = allChats.filter(c => {
        const estado = c.estadoChat || 'activo'; 
        return estado === currentInboxFilter;
    });

    if (searchTerm) {
        filteredChats = filteredChats.filter(c => 
            (c.nombre && c.nombre.toLowerCase().includes(searchTerm.toLowerCase())) || 
            (c.telefono && c.telefono.includes(searchTerm))
        );
    }

    if (filteredChats.length === 0) {
        const msgEmpty = currentInboxFilter === 'activo' ? '¡Bandeja al día! No hay chats activos.' : 'No hay chats resueltos.';
        listContainer.innerHTML = `<p class="text-center text-gray-500 mt-10 text-sm font-medium">${msgEmpty}</p>`;
        return;
    }

    listContainer.innerHTML = filteredChats.map(chat => {
        const dateObj = chat.fechaUltimo?.toDate ? chat.fechaUltimo.toDate() : new Date();
        const now = new Date();
        let timeStr = "";
        if (dateObj.toDateString() === now.toDateString()) {
            timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else {
            const yesterday = new Date();
            yesterday.setDate(now.getDate() - 1);
            if (dateObj.toDateString() === yesterday.toDateString()) {
                timeStr = "Ayer";
            } else {
                const diffTime = Math.abs(now - dateObj);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                if (diffDays < 7) {
                    const daysOfWeek = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
                    timeStr = daysOfWeek[dateObj.getDay()];
                } else {
                    timeStr = dateObj.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
                }
            }
        }
        const unreadBadge = chat.mensajesNoLeidos > 0 ? `<div class="bg-green-500 text-white text-xs font-bold w-5 h-5 flex items-center justify-center rounded-full">${chat.mensajesNoLeidos}</div>` : '';
        const isSelected = currentChatPhone === chat.id ? 'bg-gray-200' : 'hover:bg-gray-100';
        
        const clientMatch = buscarClientePorTelefono(chat.id);
        const displayName = clientMatch ? (clientMatch.nombreEmpresa || clientMatch.nombre) : (chat.nombre || 'Desconocido');
        const inicial = displayName !== 'Desconocido' ? displayName.charAt(0).toUpperCase() : '#';

        let previewText = chat.ultimoMensaje || '...';
        const fallbacks = ['[IMAGE]', '[VIDEO]', '[AUDIO]', '[DOCUMENT]', '[STICKER]', '[CONTACTO(S) RECIBIDO(S)]'];
        if (fallbacks.includes(previewText.toUpperCase())) previewText = '📷 Archivo multimedia';
        if (previewText.startsWith('Ubicación:')) previewText = '📍 Ubicación';

        return `
            <div class="chat-item p-3 border-b cursor-pointer flex items-center gap-3 transition ${isSelected}" data-phone="${chat.id}" data-name="${displayName}">
                <div class="w-12 h-12 rounded-full ${clientMatch ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-700'} font-bold flex items-center justify-center flex-shrink-0" title="${clientMatch ? 'Cliente Registrado' : 'Prospecto'}">
                    ${inicial}
                </div>
                <div class="flex-grow overflow-hidden">
                    <div class="flex justify-between items-center mb-1">
                        <h4 class="font-bold text-gray-800 text-sm truncate">${displayName}</h4>
                        <span class="text-xs text-gray-500">${timeStr}</span>
                    </div>
                    <div class="flex justify-between items-center">
                        <p class="text-sm text-gray-600 truncate">${previewText}</p>
                        ${unreadBadge}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    document.querySelectorAll('.chat-item').forEach(el => {
        el.addEventListener('click', (e) => {
            const phone = e.currentTarget.dataset.phone;
            const name = e.currentTarget.dataset.name;
            openChat(phone, name);
        });
    });
}

function buscarClientePorTelefono(phone) {
    const cleanPhone = phone.replace(/\D/g, '');
    const localPhone = cleanPhone.startsWith('57') ? cleanPhone.substring(2) : cleanPhone;
    
    return allClientes.find(c => {
        const t1 = String(c.telefono1 || '').replace(/\D/g, '');
        const t2 = String(c.telefono2 || '').replace(/\D/g, '');
        return t1 === cleanPhone || t1 === localPhone || t2 === cleanPhone || t2 === localPhone;
    });
}

function generarBannerCRM(phone) {
    const client = buscarClientePorTelefono(phone);
    if (!client) return ''; 

    const remisiones = allRemisiones.filter(r => r.idCliente === client.id && r.estado !== 'Anulada');
    let deudaTotal = 0;
    let pendientesEntrega = 0;
    
    remisiones.forEach(r => {
        const pagado = (r.payments || []).filter(p => p.status === 'confirmado').reduce((sum, p) => sum + p.amount, 0);
        const saldo = r.valorTotal - pagado;
        if (saldo > 0) deudaTotal += saldo;
        if (r.estado !== 'Entregado') pendientesEntrega++;
    });

    const deudaBadge = deudaTotal > 0 
        ? `<span class="bg-red-100 text-red-800 text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap">Debe: ${formatCurrency(deudaTotal)}</span>`
        : `<span class="bg-green-100 text-green-800 text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap">Al día</span>`;
        
    const pedidosBadge = pendientesEntrega > 0 
        ? `<span class="bg-amber-100 text-amber-800 text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap flex items-center gap-1">📦 ${pendientesEntrega}</span>`
        : '';

    return `
        <div class="bg-indigo-50 border-b border-indigo-100 p-2 sm:px-4 flex justify-between items-center shadow-sm w-full gap-1 sm:gap-2">
            <div class="text-[10px] sm:text-xs font-semibold text-indigo-900 flex items-center gap-1 truncate max-w-[40%] sm:max-w-none">
                <svg class="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2"></path></svg>
                <span class="truncate hidden sm:inline">Cliente: </span>
                <span class="truncate">${client.nombreEmpresa || client.nombre}</span>
            </div>
            <div class="flex gap-1 sm:gap-2 items-center flex-shrink-0">
                <div class="flex gap-1 flex-col sm:flex-row items-end sm:items-center">
                    ${deudaBadge}
                    ${pedidosBadge}
                </div>
                <button onclick="window.openCrmPanel('${phone}')" class="bg-indigo-600 text-white text-[10px] sm:text-xs font-bold px-2 py-1 sm:px-3 sm:py-1.5 rounded shadow hover:bg-indigo-700 transition flex items-center whitespace-nowrap">
                    Detalles
                </button>
            </div>
        </div>
    `;
}

function openChat(phone, name) {
    currentChatPhone = phone;
    const chatInfo = allChats.find(c => c.id === phone) || {};
    const estadoActual = chatInfo.estadoChat || 'activo';
    
    document.getElementById('mensajes-sidebar').classList.add('hidden', 'md:flex');
    document.getElementById('mensajes-chat-area').classList.remove('hidden');
    document.getElementById('mensajes-chat-area').classList.add('flex');

    const noChatSelectedEl = document.getElementById('wa-no-chat-selected');
    const chatActiveEl = document.getElementById('wa-chat-active');
    if (noChatSelectedEl) noChatSelectedEl.classList.add('hidden');
    if (chatActiveEl) {
        chatActiveEl.classList.remove('hidden');
        chatActiveEl.classList.add('flex');
    }

    document.getElementById('wa-contact-name').textContent = name;
    
    // Dejamos el teléfono listo, el temporizador lo rellenará en `renderMessagesFromMap`
    document.getElementById('wa-contact-phone').innerHTML = `+${phone}`;
    
    document.getElementById('wa-avatar').textContent = name !== 'Desconocido' ? name.charAt(0).toUpperCase() : '#';
    document.getElementById('wa-current-phone').value = phone;
    document.getElementById('wa-send-form').classList.remove('hidden');

    const headerActions = document.getElementById('wa-chat-header-actions');
    if (headerActions) {
        if (estadoActual === 'resuelto') {
            headerActions.innerHTML = `<button onclick="window.toggleChatStatus('${phone}', 'resuelto')" class="bg-blue-100 text-blue-700 hover:bg-blue-200 text-xs sm:text-sm font-bold py-1.5 px-3 rounded-lg shadow-sm flex items-center gap-1 transition"><span class="text-blue-500">🔄</span> Reabrir Chat</button>`;
        } else {
            headerActions.innerHTML = `<button onclick="window.toggleChatStatus('${phone}', 'activo')" class="bg-gray-100 text-gray-700 hover:bg-gray-200 text-xs sm:text-sm font-bold py-1.5 px-3 rounded-lg shadow-sm flex items-center gap-1 transition"><span class="text-green-500">✔️</span> Resolver</button>`;
        }
    }
    
    window.closeCrmPanel();



    const msgContainer = document.getElementById('wa-messages-container');
    msgContainer.innerHTML = '<div class="text-center p-4 text-sm text-gray-500">Cargando mensajes...</div>';

    // Limpieza al cambiar de chat
    if (unsubscribeMessages) unsubscribeMessages();
    if (chatTimerInterval) clearInterval(chatTimerInterval); // Limpiamos el reloj anterior
    currentChatMessagesMap.clear();

    const CACHE_KEY_MSG = `wa_msgs_${phone}`;
    const cachedMsgs = localStorage.getItem(CACHE_KEY_MSG);
    if (cachedMsgs) {
        try {
            JSON.parse(cachedMsgs).forEach(m => currentChatMessagesMap.set(m.id, m));
            renderMessagesFromMap(phone, msgContainer, true); // Renderizar cache instantáneamente y forzar scroll
        } catch(e) { localStorage.removeItem(CACHE_KEY_MSG); }
    }

    // Marcar como leído directamente en Firestore
    updateDoc(doc(db, "chats", phone), { mensajesNoLeidos: 0 }).catch(e => console.error("Error al marcar leído localmente:", e));

    const q = query(collection(db, `chats/${phone}/mensajes`), orderBy("fecha", "desc"), limit(20));
    
    let isFirstLoadOfChat = true;
    unsubscribeMessages = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach(change => {
            const data = change.doc.data();
            if (data.fecha && typeof data.fecha.toMillis === 'function') data.fecha = data.fecha.toMillis();
            
            if (change.type === 'removed') {
                currentChatMessagesMap.delete(change.doc.id);
            } else {
                currentChatMessagesMap.set(change.doc.id, { id: change.doc.id, ...data });
            }
        });

        renderMessagesFromMap(phone, msgContainer, isFirstLoadOfChat);

        // Marcar mensajes entrantes como leídos localmente en Firestore (Optimizado con Batch y Set)
        const messagesArray = Array.from(currentChatMessagesMap.values());
        const unread = messagesArray.filter(m => m.tipo === 'entrante' && !m.leido && !updatingMessageIds.has(m.id));
        if (unread.length > 0) {
            const batch = writeBatch(db);
            unread.forEach(msg => {
                updatingMessageIds.add(msg.id);
                batch.update(doc(db, "chats", phone, "mensajes", msg.id), { leido: true });
            });
            batch.commit().then(() => {
                unread.forEach(msg => updatingMessageIds.delete(msg.id));
            }).catch(e => {
                unread.forEach(msg => updatingMessageIds.delete(msg.id));
                console.error("Error al marcar como leídos:", e);
            });
        }

        isFirstLoadOfChat = false;
    }, (error) => {
        if (currentUser && error.code !== 'permission-denied') {
            console.warn("Error en onSnapshot de mensajes:", error.message || error);
        } else if (currentUser) {
            console.warn("Error en onSnapshot de mensajes (Permisos denegados):", error.message || error);
        }
    });

    renderChatList(); 
}

function renderMessagesFromMap(phone, msgContainer, forceScroll = false) {
    const messagesArray = Array.from(currentChatMessagesMap.values());
    messagesArray.sort((a, b) => (a.fecha || 0) - (b.fecha || 0));
    localStorage.setItem(`wa_msgs_${phone}`, JSON.stringify(messagesArray));

    let html = '';
    let ultimoMsgDelCliente = null;

    if (messagesArray.length >= 20) {
        html += `<div class="text-center my-2"><button onclick="window.loadOlderMessages('${phone}')" class="bg-white border border-gray-300 text-gray-600 text-xs font-bold py-1 px-3 rounded-full hover:bg-gray-100 shadow-sm">Cargar mensajes anteriores</button></div>`;
    }

    if (messagesArray.length === 0 && !tempSendingMessage) {
        msgContainer.innerHTML = '<div class="text-center p-4 text-sm text-gray-500">No hay mensajes.</div><div id="optimistic-anchor"></div>';
        // Si no hay mensajes, asumimos ventana cerrada
        manejarTemporizador(phone, null);
        return;
    }

    let lastDateStr = null;

    messagesArray.forEach(msg => {
        const isSaliente = msg.tipo === 'saliente';
        const dateObj = new Date(msg.fecha || Date.now());
        const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        // Separador de fecha dinámico
        const dateStr = dateObj.toDateString();
        if (dateStr !== lastDateStr) {
            lastDateStr = dateStr;
            const now = new Date();
            let label = "";
            if (dateStr === now.toDateString()) {
                label = "Hoy";
            } else {
                const yesterday = new Date();
                yesterday.setDate(now.getDate() - 1);
                if (dateStr === yesterday.toDateString()) {
                    label = "Ayer";
                } else {
                    const diffTime = Math.abs(now - dateObj);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    if (diffDays < 7) {
                        const daysOfWeek = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
                        label = daysOfWeek[dateObj.getDay()];
                    } else {
                        label = dateObj.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: 'numeric' });
                    }
                }
            }
            html += `
                <div class="flex items-center justify-center my-4 w-full">
                    <span class="bg-indigo-50 border border-indigo-150 text-indigo-700 text-xs font-bold px-3 py-1 rounded-full shadow-sm">
                        ${label}
                    </span>
                </div>
            `;
        }

        // Guardar el más reciente que NO sea nuestro
        if (!isSaliente) ultimoMsgDelCliente = dateObj;

        let tick = '';
        if (isSaliente) {
            if (msg.status === 'read') tick = '<span class="text-blue-500 ml-1 font-bold">✓✓</span>';
            else if (msg.status === 'delivered') tick = '<span class="text-gray-400 ml-1 font-bold">✓✓</span>';
            else if (msg.status === 'sent') tick = '<span class="text-gray-400 ml-1">✓</span>';
            else tick = '<span class="text-gray-300 ml-1">🕒</span>';
        }

        let mediaHTML = '';
        let showText = msg.contenido && msg.contenido.trim() !== '';
        
        const fallbacks = ['[IMAGE]', '[VIDEO]', '[AUDIO]', '[DOCUMENT]', '[STICKER]', '[CONTACTO(S) RECIBIDO(S)]'];
        if (fallbacks.includes(msg.contenido?.toUpperCase()) || (msg.mimeType === 'location' && msg.contenido?.startsWith('Ubicación:'))) {
            showText = false;
        }

        if (msg.mimeType === 'image') {
            mediaHTML = `<img src="${msg.mediaUrl}" class="rounded-lg mb-1 max-w-[220px] sm:max-w-[280px] cursor-pointer hover:opacity-90 transition object-cover" onclick="viewWaImage('${msg.mediaUrl}')">`;
        } else if (msg.mimeType === 'sticker') {
            mediaHTML = `<img src="${msg.mediaUrl}" class="w-32 h-32 object-contain drop-shadow-md">`;
        } else if (msg.mimeType === 'video') {
            mediaHTML = `<video controls src="${msg.mediaUrl}" class="rounded-lg mb-1 max-w-[220px] sm:max-w-[280px] bg-black"></video>`;
        } else if (msg.mimeType === 'audio' || msg.mimeType === 'voice') {
            mediaHTML = `<audio controls src="${msg.mediaUrl}" class="w-56 sm:w-64 mb-1 h-10"></audio>`;
        } else if (msg.mimeType === 'document') {
            mediaHTML = `
                <a href="${msg.mediaUrl}" target="_blank" class="flex items-center gap-3 bg-black/5 p-3 rounded-lg mb-1 hover:bg-black/10 transition shadow-sm border border-gray-100">
                    <div class="bg-red-500 text-white rounded p-2 flex-shrink-0">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>
                    </div>
                    <span class="text-sm font-semibold truncate max-w-[150px] text-gray-800">${msg.fileName || 'Ver Documento'}</span>
                </a>`;
        } else if (msg.mimeType === 'location') {
            const loc = msg.location || {};
            let lat = loc.lat;
            let lng = loc.lng;
            if (!lat && msg.mediaUrl) {
                const match = msg.mediaUrl.match(/query=([-\d.]+),([-\d.]+)/);
                if (match) {
                    lat = match[1];
                    lng = match[2];
                }
            }
            const mapUrl = msg.mediaUrl || `http://googleusercontent.com/maps.google.com/maps?q=${lat || ''},${lng || ''}`;
            const address = loc.address || msg.contenido?.replace('📍 Ubicación: ', '') || 'Ver en Google Maps';
            const name = loc.name || 'Ubicación Compartida';
            
            mediaHTML = `
                <a href="${mapUrl}" target="_blank" class="block w-48 sm:w-56 rounded-lg overflow-hidden border border-gray-200 shadow-sm hover:shadow-md transition mb-1 bg-[#e5e3df]">
                    <div class="h-24 flex items-center justify-center text-4xl relative">
                        <div class="absolute inset-0 opacity-40" style="background-image: linear-gradient(#d1cec7 2px, transparent 2px), linear-gradient(90deg, #d1cec7 2px, transparent 2px); background-size: 20px 20px;"></div>
                        <div class="z-10 drop-shadow-md pb-4 text-red-500 animate-bounce">📍</div>
                    </div>
                    <div class="p-3 bg-white flex flex-col">
                        <span class="text-sm font-bold text-gray-800 truncate">${name}</span>
                        <span class="text-xs font-medium text-gray-500 truncate">${address}</span>
                    </div>
                </a>`;
        } else if (msg.mimeType === 'contacts') {
            let contactos = msg.contactos;
            if (!contactos) {
                const formattedName = msg.contenido?.replace('👤 Contacto: ', '') || 'Contacto';
                const phone = msg.mediaUrl || '';
                contactos = [{
                    name: { formatted_name: formattedName },
                    phones: [{ phone: phone }]
                }];
            }
            mediaHTML = `
                <div class="bg-white border border-gray-200 rounded-lg mb-1 w-48 sm:w-56 shadow-sm divide-y divide-gray-100">
                   ${contactos.map(c => {
                     const phoneNumber = c.phones?.[0]?.phone || '';
                     const cleanPhone = phoneNumber.replace(/\D/g,'');
                     return `
                     <div class="flex items-center gap-3 p-3">
                       <div class="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center text-xl flex-shrink-0">👤</div>
                       <div class="overflow-hidden">
                         <p class="font-bold text-sm truncate text-gray-800">${c.name?.formatted_name || 'Contacto'}</p>
                         <p class="text-xs text-blue-600 truncate hover:underline cursor-pointer font-semibold"><a href="tel:+${cleanPhone}">${phoneNumber || 'Sin número'}</a></p>
                       </div>
                     </div>`;
                   }).join('')}
                </div>`;
        }

        const alignClass = isSaliente ? 'ml-auto bg-[#dcf8c6] rounded-lg rounded-tr-none' : 'mr-auto bg-white rounded-lg rounded-tl-none';
        let bubbleClass = alignClass;
        let shadowPadding = 'p-2 px-3 shadow-sm';
        
        if (msg.mimeType === 'sticker' && !showText) {
            bubbleClass = isSaliente ? 'ml-auto' : 'mr-auto';
            shadowPadding = 'p-0 shadow-none bg-transparent';
        }

        html += `
            <div class="${bubbleClass} ${shadowPadding} max-w-[85%] w-fit relative group flex flex-col mb-1.5">
                ${mediaHTML}
                ${showText ? `<p class="text-[15px] text-gray-800 break-words whitespace-pre-wrap leading-tight">${formatMensajesText(msg.contenido)}</p>` : ''}
                
                <div class="${(msg.mimeType === 'sticker' && !showText) ? 'absolute bottom-0 right-0 bg-white/80 rounded-full px-1.5 py-0.5' : 'text-right mt-1'} text-[10px] text-gray-500 flex justify-end items-center gap-1">
                    ${timeStr}${tick}
                </div>
            </div>
        `;
    });

    html += `<div id="optimistic-anchor"></div>`;
    
    const isAtBottom = msgContainer.scrollHeight - msgContainer.scrollTop <= msgContainer.clientHeight + 150;
    
    msgContainer.innerHTML = html;
    
    if (isAtBottom || tempSendingMessage || forceScroll) {
        msgContainer.scrollTop = msgContainer.scrollHeight;
        setTimeout(() => {
            msgContainer.scrollTop = msgContainer.scrollHeight;
        }, 50);
    }

    // Iniciar Temporizador de 24H y Contexto CRM
    manejarTemporizador(phone, ultimoMsgDelCliente);
    updateClientContext(phone, messagesArray);
}

// --- LÓGICA DEL RELOJ DE 24 HORAS EN VIVO ---
function manejarTemporizador(phone, ultimoMsgDate) {
    if (chatTimerInterval) clearInterval(chatTimerInterval);

    const warningEl = document.getElementById('wa-24h-warning');
    const inputEl = document.getElementById('wa-msg-input');
    const btnEl = document.getElementById('wa-send-btn');
    const fileInput = document.getElementById('wa-file-input');
    const phoneEl = document.getElementById('wa-contact-phone');
    const slashMenu = document.getElementById('wa-slash-menu');

    if (!ultimoMsgDate) {
        if(phoneEl) phoneEl.innerHTML = `<span class="text-gray-500 font-bold"><i class="fa-solid fa-clock"></i> Esperando</span>`;
        if(warningEl) warningEl.classList.remove('hidden');
        if(slashMenu) slashMenu.classList.add('hidden');
        if(inputEl) { inputEl.disabled = true; inputEl.placeholder = "Esperando respuesta..."; inputEl.classList.add('bg-gray-200'); }
        if(btnEl) btnEl.disabled = true;
        if(fileInput) fileInput.disabled = true;
        return;
    }

    const updateTimer = () => {
        const now = new Date();
        const diffMs = now - ultimoMsgDate;
        const limitMs = 24 * 60 * 60 * 1000;
        const leftMs = limitMs - diffMs;

        if (leftMs <= 0) {
            if(phoneEl) phoneEl.innerHTML = `<span class="text-rose-600 font-bold"><i class="fa-solid fa-circle-exclamation"></i> Ventana cerrada</span>`;
            if(warningEl) warningEl.classList.remove('hidden');
            if(slashMenu) slashMenu.classList.add('hidden');
            
            if(inputEl) { 
                inputEl.disabled = true; 
                inputEl.placeholder = "Ventana cerrada."; 
                inputEl.classList.add('bg-gray-200'); 
            }
            if(btnEl) btnEl.disabled = true;
            if(fileInput) fileInput.disabled = true;
            clearInterval(chatTimerInterval);
        } else {
            const h = Math.floor(leftMs / (1000 * 60 * 60));
            const m = Math.floor((leftMs % (1000 * 60 * 60)) / (1000 * 60));
            const s = Math.floor((leftMs % (1000 * 60)) / 1000);
            
            if(phoneEl) phoneEl.innerHTML = `<span class="text-emerald-600 font-bold"><i class="fa-solid fa-clock"></i> Ventana: ${h}h ${m}m</span>`;
            
            if(warningEl) warningEl.classList.add('hidden');
            if(inputEl && inputEl.disabled) { 
                inputEl.disabled = false; 
                inputEl.placeholder = "Mensaje..."; 
                inputEl.classList.remove('bg-gray-200'); 
                if(btnEl) btnEl.disabled = false;
                if(fileInput) fileInput.disabled = false;
            }
        }
    };

    updateTimer(); 
    chatTimerInterval = setInterval(updateTimer, 1000);
}


window.loadOlderMessages = async function(phone) {
    if (currentChatMessagesMap.size === 0) return;
    
    const msgContainer = document.getElementById('wa-messages-container');
    const oldScrollHeight = msgContainer.scrollHeight;

    const messagesArray = Array.from(currentChatMessagesMap.values());
    messagesArray.sort((a, b) => (a.fecha || 0) - (b.fecha || 0));
    const oldestDate = messagesArray[0].fecha;

    const btnObj = event.target;
    btnObj.textContent = "Cargando...";
    btnObj.disabled = true;

    try {
        const q = query(
            collection(db, `chats/${phone}/mensajes`), 
            where("fecha", "<", new Date(oldestDate)),
            orderBy("fecha", "desc"), 
            limit(20)
        );
        
        const snapshot = await getDocs(q);
        if (snapshot.empty) {
            btnObj.textContent = "No hay más mensajes";
            return;
        }

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (data.fecha && typeof data.fecha.toMillis === 'function') data.fecha = data.fecha.toMillis();
            currentChatMessagesMap.set(docSnap.id, { id: docSnap.id, ...data });
        });

        renderMessagesFromMap(phone, msgContainer);
        
        msgContainer.scrollTop = msgContainer.scrollHeight - oldScrollHeight;

    } catch (error) {
        console.error("Error cargando mensajes antiguos:", error);
        btnObj.textContent = "Error al cargar";
        btnObj.disabled = false;
    }
}

async function handleSendMessage(e) {
    e.preventDefault();
    const phone = document.getElementById('wa-current-phone').value;
    const inputEl = document.getElementById('wa-msg-input');
    const fileInput = document.getElementById('wa-file-input');
    const text = inputEl.value.trim();
    const file = fileInput.files[0];

    if (!phone || (!text && !file)) return;

    if (file) {
        showTemporaryMessage("El envío de archivos multimedia no está soportado en esta versión. Envía un mensaje de texto.", "error");
        fileInput.value = '';
        return;
    }

    inputEl.value = '';
    const btnEl = document.getElementById('wa-send-btn');
    btnEl.disabled = true;

    const anchor = document.getElementById('optimistic-anchor');
    if (anchor) {
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        tempSendingMessage = true; 
        anchor.innerHTML = `
            <div class="ml-auto bg-[#dcf8c6] rounded-lg rounded-tr-none p-2 px-3 max-w-[85%] w-fit shadow-sm relative group mb-2 flex flex-col opacity-60">
                ${text ? `<p class="text-[15px] text-gray-800 break-words whitespace-pre-wrap leading-tight">${text}</p>` : ''}
                <div class="text-right mt-1 text-[10px] text-gray-500 flex justify-end items-center gap-1">
                    ${timeStr} <span class="text-gray-400 ml-1 font-bold">🕒</span>
                </div>
            </div>
        `;
        const msgContainer = document.getElementById('wa-messages-container');
        msgContainer.scrollTop = msgContainer.scrollHeight;
    }

    try {
        const enviarFn = httpsCallable(functions, 'sendWhatsAppMessage');
        await enviarFn({ telefono: phone, mensaje: text });
        
    } catch (error) {
        console.error("Error al enviar MSJ:", error);
        showModalMessage("Error al enviar mensaje. Revisa tu conexión o si la sesión de 24h caducó.");
    } finally {
        tempSendingMessage = null;
        const checkAnchor = document.getElementById('optimistic-anchor');
        if (checkAnchor) checkAnchor.innerHTML = '';
        btnEl.disabled = false;
        document.getElementById('wa-msg-input').focus();
    }
}

export function setupMensajesEvents() {
    if (window.__setupMensajesEventsInit) return;
    window.__setupMensajesEventsInit = true;

    setupMobileInfoToggle();

    const searchInput = document.getElementById('mensajes-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => renderChatList(e.target.value));
    }

    const tabActivos = document.getElementById('wa-tab-activos');
    const tabResueltos = document.getElementById('wa-tab-resueltos');
    
    if (tabActivos && tabResueltos) {
        tabActivos.addEventListener('click', () => {
            currentInboxFilter = 'activo';
            tabActivos.className = "flex-1 py-2 text-sm font-bold text-indigo-600 border-b-2 border-indigo-600 transition";
            tabResueltos.className = "flex-1 py-2 text-sm font-bold text-gray-500 border-b-2 border-transparent hover:text-gray-700 transition";
            renderChatList();
        });
        
        tabResueltos.addEventListener('click', () => {
            currentInboxFilter = 'resuelto';
            tabResueltos.className = "flex-1 py-2 text-sm font-bold text-indigo-600 border-b-2 border-indigo-600 transition";
            tabActivos.className = "flex-1 py-2 text-sm font-bold text-gray-500 border-b-2 border-transparent hover:text-gray-700 transition";
            renderChatList();
        });
    }

    const sendForm = document.getElementById('wa-send-form');
    if (sendForm) {
        sendForm.addEventListener('submit', handleSendMessage);
        
        const textarea = document.getElementById('wa-msg-input');
        
        const updateSlashMenuSelection = (menu, oldIdx, newIdx) => {
            menu.dataset.selectedIndex = newIdx.toString();
            
            const oldOpt = document.getElementById(`slash-option-${oldIdx}`);
            if (oldOpt) {
                oldOpt.classList.add('border-transparent');
                oldOpt.classList.remove('bg-slate-100', 'border-indigo-600');
            }
            
            const newOpt = document.getElementById(`slash-option-${newIdx}`);
            if (newOpt) {
                newOpt.classList.remove('border-transparent');
                newOpt.classList.add('bg-slate-100', 'border-indigo-600');
                newOpt.scrollIntoView({ block: 'nearest' });
            }
        };

        textarea.addEventListener('keydown', function(e) {
            let slashMenu = document.getElementById('wa-slash-menu');
            if (slashMenu && !slashMenu.classList.contains('hidden')) {
                const selectedIndex = parseInt(slashMenu.dataset.selectedIndex || "0");
                const maxIndex = parseInt(slashMenu.dataset.maxIndex || "0");

                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    let nextIndex = selectedIndex + 1;
                    if (nextIndex > maxIndex) nextIndex = 0;
                    updateSlashMenuSelection(slashMenu, selectedIndex, nextIndex);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    let prevIndex = selectedIndex - 1;
                    if (prevIndex < 0) prevIndex = maxIndex;
                    updateSlashMenuSelection(slashMenu, selectedIndex, prevIndex);
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const activeOption = document.getElementById(`slash-option-${selectedIndex}`);
                    if (activeOption) {
                        activeOption.click();
                    }
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    slashMenu.classList.add('hidden');
                }
            } else {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (this.value.trim() !== '' || document.getElementById('wa-file-input').files.length > 0) {
                        sendForm.dispatchEvent(new Event('submit'));
                    }
                }
            }
        });

        // Menú de Respuestas Rápidas con '/'
        textarea.addEventListener('input', function(e) {
            const text = this.value;
            let slashMenu = document.getElementById('wa-slash-menu');
            
            if (!slashMenu) {
                slashMenu = document.createElement('div');
                slashMenu.id = 'wa-slash-menu';
                slashMenu.className = 'absolute bottom-16 left-4 bg-white border border-slate-200 rounded-lg shadow-lg z-50 max-h-40 overflow-y-auto hidden flex flex-col divide-y divide-slate-100 min-w-[200px]';
                document.getElementById('mensajes-chat-area').appendChild(slashMenu);
            }

            if (this.disabled) {
                slashMenu.classList.add('hidden');
                return;
            }

            if (text.startsWith('/')) {
                const queryText = text.substring(1).toLowerCase().trim();
                const filtered = QUICK_REPLIES.filter(reply => 
                    reply.title.toLowerCase().includes(queryText) || 
                    reply.text.toLowerCase().includes(queryText)
                );

                if (filtered.length > 0) {
                    slashMenu.classList.remove('hidden');
                    slashMenu.innerHTML = filtered.map((reply, index) => {
                        return `<button type="button" class="slash-option-btn w-full text-left px-3 py-2 text-xs text-slate-700 font-semibold transition border-l-4 border-transparent hover:bg-slate-50" data-index="${index}" id="slash-option-${index}">
                            <span class="font-bold text-indigo-600">/${reply.title}</span> - <span class="text-slate-400 truncate inline-block max-w-[150px] align-bottom">${reply.text.substring(0, 30)}...</span>
                        </button>`;
                    }).join('');

                    slashMenu.querySelectorAll('.slash-option-btn').forEach((btn) => {
                        btn.onclick = () => {
                            const idx = parseInt(btn.dataset.index);
                            const replyText = filtered[idx].text;
                            textarea.value = replyText;
                            slashMenu.classList.add('hidden');
                            textarea.focus();
                        };
                    });

                    slashMenu.dataset.selectedIndex = "0";
                    slashMenu.dataset.maxIndex = (filtered.length - 1).toString();
                    
                    const firstOption = document.getElementById('slash-option-0');
                    if (firstOption) {
                        firstOption.classList.remove('border-transparent');
                        firstOption.classList.add('bg-slate-100', 'border-indigo-600');
                    }
                } else {
                    slashMenu.classList.add('hidden');
                }
            } else {
                slashMenu.classList.add('hidden');
            }
        });

        // Ocultar menú al hacer click fuera
        document.addEventListener('click', function(e) {
            const slashMenu = document.getElementById('wa-slash-menu');
            if (slashMenu && !e.target.closest('#wa-slash-menu') && e.target !== textarea) {
                slashMenu.classList.add('hidden');
            }
        });
    }

    const backBtn = document.getElementById('wa-back-btn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            document.getElementById('mensajes-chat-area').classList.add('hidden');
            document.getElementById('mensajes-sidebar').classList.remove('hidden');
            document.getElementById('mensajes-sidebar').classList.add('flex');
            currentChatPhone = null;
            if (unsubscribeMessages) unsubscribeMessages();
            if (chatTimerInterval) clearInterval(chatTimerInterval);
            window.closeCrmPanel(); 
            renderChatList();
        });
    }
}

// --- LOGICA DE ACCIONES RAPIDAS Y CONTEXTO CRM ---

async function updateClientContext(phone, messages) {
    const cliente = buscarClientePorTelefono(phone);
    const sideCompras = document.getElementById('wa-side-total-compras');
    const sideDeuda = document.getElementById('wa-side-total-deuda');
    const sideList = document.getElementById('wa-side-remisiones-list');
    
    if (!cliente) {
        if (sideList) sideList.innerHTML = '<p class="text-center text-[10px] text-gray-400 py-4 italic">Cliente no registrado</p>';
        if (sideCompras) sideCompras.textContent = "$ 0";
        if (sideDeuda) sideDeuda.textContent = "$ 0";
        return;
    }

    try {
        const resumen = await getResumenFinancieroOptimizado(cliente.id);
        if (sideCompras) sideCompras.textContent = formatCurrency(resumen.comprasMes);
        if (sideDeuda) sideDeuda.textContent = formatCurrency(resumen.totalDeuda);
        if (sideList) {
            let remisionesHTML = '';
            resumen.listaPendientes.sort((a, b) => b.numeroRemision - a.numeroRemision).forEach(r => {
                remisionesHTML += `
                <div class="bg-white border border-gray-100 p-3 rounded-xl shadow-sm hover:border-emerald-500 cursor-pointer transition-all group text-left"
                     onclick="window.prepararAbonoDesdeCRM('${r.id}')">
                    <div class="flex justify-between items-center">
                        <span class="font-black text-gray-700 text-[11px]">#${r.numeroRemision}</span>
                        <span class="text-rose-600 font-black text-[11px]">${formatCurrency(r.saldoCalculado)}</span>
                    </div>
                    <p class="text-[9px] text-gray-400 font-medium mt-1">${r.fechaRecibido}</p>
                </div>`;
            });
            sideList.innerHTML = remisionesHTML || '<div class="text-center py-4 text-gray-400 text-[10px] uppercase font-bold">Sin deudas</div>';
        }

        const reportBtn = document.getElementById('wa-side-report-payment');
        if (reportBtn) {
            reportBtn.onclick = () => {
                if (resumen.listaPendientes.length === 0) showTemporaryMessage("No hay deudas activas");
                else if (resumen.listaPendientes.length === 1) prepararAbonoDesdeCRM(resumen.listaPendientes[0].id);
                else showRemisionSelectorModal(resumen.listaPendientes, cliente.nombreEmpresa || cliente.nombre);
            };
        }

        const statementBtn = document.getElementById('wa-side-send-statement');
        if (statementBtn) {
            statementBtn.onclick = () => sendAccountStatement(phone);
        }
    } catch (error) {
        console.error("Error al actualizar contexto:", error);
    }
}

async function getResumenFinancieroOptimizado(clienteId) {
    const remisionesRef = collection(db, "remisiones");
    const ahora = new Date();
    const primerDiaMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).toISOString().split('T')[0];
    
    // Obtener deudas de los últimos 4 meses
    const fechaCorteDeudas = new Date();
    fechaCorteDeudas.setMonth(fechaCorteDeudas.getMonth() - 4);
    const fechaCorteStr = fechaCorteDeudas.toISOString().split('T')[0];

    const q = query(
        remisionesRef,
        where("idCliente", "==", clienteId),
        where("fechaRecibido", ">=", fechaCorteStr),
        where("estado", "!=", "Anulada")
    );
    
    const snapshot = await getDocs(q);
    let comprasMesActual = 0;
    let acumuladoDeudaTotal = 0;
    let remisionesConSaldo = [];

    snapshot.forEach(docSnap => {
        const r = docSnap.data();
        const id = docSnap.id;
        
        if (r.fechaRecibido >= primerDiaMes) {
            comprasMesActual += (r.valorTotal || 0);
        }
        
        const pagado = (r.payments || [])
            .filter(p => p.status === 'confirmado')
            .reduce((acc, p) => acc + p.amount, 0);
            
        const saldo = r.valorTotal - pagado;
        if (saldo > 100) {
            acumuladoDeudaTotal += saldo;
            remisionesConSaldo.push({ id, ...r, saldoCalculado: saldo });
        }
    });

    return {
        comprasMes: comprasMesActual,
        totalDeuda: acumuladoDeudaTotal,
        listaPendientes: remisionesConSaldo
    };
}

export function showRemisionSelectorModal(pendientes, clienteNombre) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    const listaHTML = pendientes.map(r => `
    <div class="flex justify-between items-center p-4 border rounded-xl hover:bg-green-50 hover:border-green-300 cursor-pointer transition shadow-sm group"
         onclick="window.prepararAbonoDesdeCRM('${r.id}')">
        <div class="text-left">
            <p class="font-black text-gray-800">Remisión N° ${r.numeroRemision}</p>
            <p class="text-xs text-gray-500">Fecha: ${r.fechaRecibido}</p>
        </div>
        <div class="text-right">
            <p class="text-xs text-gray-450">Saldo pendiente:</p>
            <p class="font-bold text-red-600 text-lg">${formatCurrency(r.saldoCalculado)}</p>
            <span class="text-[10px] text-green-600 font-bold uppercase opacity-0 group-hover:opacity-100">Seleccionar para pago</span>
        </div>
    </div>
    `).join('');

    modalContentWrapper.innerHTML = `
    <div class="bg-white rounded-2xl p-6 shadow-2xl max-w-md w-full mx-auto">
        <div class="flex justify-between items-center mb-6">
            <div class="text-left">
                <h2 class="text-xl font-black text-gray-800">Seleccionar Remisión</h2>
                <p class="text-sm text-gray-500">${clienteNombre}</p>
            </div>
            <button id="close-selector-modal" class="text-gray-400 hover:text-gray-800 text-3xl">&times;</button>
        </div>
        <div class="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
            ${listaHTML}
        </div>
        <p class="text-center text-[10px] text-gray-400 mt-6 uppercase tracking-widest">Se muestran solo remisiones con saldo pendiente</p>
    </div>
    `;

    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-selector-modal').onclick = hideModal;
}

export async function prepararAbonoDesdeCRM(remisionId) {
    let remision = allRemisiones.find(r => r.id === remisionId);
    if (!remision) {
        showModalMessage("Buscando información de remisión...", true);
        try {
            const remDoc = await getDoc(doc(db, "remisiones", remisionId));
            if (remDoc.exists()) {
                remision = { id: remDoc.id, ...remDoc.data() };
            }
        } catch (error) {
            console.error("Error al recuperar remisión remota:", error);
        }
    }
    
    if (remision) {
        hideModal();
        setTimeout(() => {
            showPaymentModal(remision);
        }, 150);
    } else {
        hideModal();
        showTemporaryMessage("No se pudo cargar la remisión. Intente de nuevo.", "error");
    }
}

async function sendAccountStatement(phone) {
    const cliente = buscarClientePorTelefono(phone);
    if (!cliente) return showTemporaryMessage("Cliente no encontrado", "error");
    
    showModalMessage("Generando estado de cuenta...", true);
    
    try {
        const remisionesRef = collection(db, "remisiones");
        const q = query(remisionesRef, where("idCliente", "==", cliente.id), where("estado", "!=", "Anulada"));
        const snap = await getDocs(q);
        
        let totalDeuda = 0;
        let detalleMensaje = "";
        let tienePendientes = false;
        
        const docs = snap.docs.map(d => d.data()).sort((a, b) => new Date(a.fechaRecibido) - new Date(b.fechaRecibido));
        
        docs.forEach(r => {
            const pagado = (r.payments || []).filter(p => p.status === 'confirmado').reduce((acc, p) => acc + p.amount, 0);
            const saldo = r.valorTotal - pagado;
            if (saldo > 100) {
                tienePendientes = true;
                totalDeuda += saldo;
                detalleMensaje += `*• Remisión #${r.numeroRemision}* (${r.fechaRecibido})\n   Saldo: _${formatCurrency(saldo)}_\n`;
            }
        });

        const fechaHoy = new Date().toLocaleDateString();
        let mensajeFinal = `*ESTADO DE CUENTA - PRISMACALOR SAS*\n`;
        mensajeFinal += `*Cliente:* ${cliente.nombreEmpresa || cliente.nombre}\n`;
        mensajeFinal += `*Fecha de corte:* ${fechaHoy}\n`;
        mensajeFinal += `------------------------------------------\n\n`;

        if (tienePendientes) {
            mensajeFinal += `Hola, adjuntamos el detalle de tus cuentas pendientes:\n\n`;
            mensajeFinal += detalleMensaje;
            mensajeFinal += `\n*TOTAL PENDIENTE: ${formatCurrency(totalDeuda)}*\n\n`;
            mensajeFinal += `------------------------------------------\n`;
            mensajeFinal += `*Medios de Pago:*\n`;
            mensajeFinal += `• Llave: @9010430572\n`;
            mensajeFinal += `• Davivienda: Corriente #477669995664\n`;
            mensajeFinal += `• Nequi: 3132522810\n`;
            mensajeFinal += `Por favor envíanos el comprobante por este medio. ¡Gracias!`;
        } else {
            mensajeFinal += `🎉 *¡Felicidades!* No tienes cuentas pendientes a la fecha.\n\nGracias por ser un cliente.`;
        }

        const sendMsgFn = httpsCallable(functions, 'sendWhatsAppMessage');
        await sendMsgFn({ telefono: phone, mensaje: mensajeFinal });

        hideModal();
        showTemporaryMessage("Estado de cuenta enviado con éxito", "success");
    } catch (error) {
        console.error("Error al enviar estado de cuenta:", error);
        hideModal();
        showModalMessage("Error al enviar el estado de cuenta.");
    }
}



function setupMobileInfoToggle() {
    const trigger = document.getElementById('wa-header-info-trigger');
    const sidebar = document.getElementById('wa-client-sidebar');
    const closeBtn = document.getElementById('close-info-mobile');
    
    if (trigger && sidebar) {
        trigger.addEventListener('click', (e) => {
            if (e.target.closest('#wa-back-btn') || e.target.closest('#wa-chat-header-actions')) return;
            if (window.innerWidth < 1024) {
                sidebar.classList.add('active-mobile');
            }
        });
    }
    
    if (closeBtn && sidebar) {
        closeBtn.addEventListener('click', () => {
            sidebar.classList.remove('active-mobile');
        });
    }
}

// Exponer funciones necesarias al objeto window
window.prepararAbonoDesdeCRM = prepararAbonoDesdeCRM;
window.showRemisionSelectorModal = showRemisionSelectorModal;

export function cleanupMensajesListeners() {
    if (unsubscribeChats) {
        try {
            unsubscribeChats();
        } catch (e) {
            console.warn("Error al desuscribir chats:", e);
        }
        unsubscribeChats = null;
    }
    if (unsubscribeMessages) {
        try {
            unsubscribeMessages();
        } catch (e) {
            console.warn("Error al desuscribir mensajes:", e);
        }
        unsubscribeMessages = null;
    }
}