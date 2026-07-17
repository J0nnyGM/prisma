// js/modules/remisiones.js

import { db, storage, functions, httpsCallable } from '../firebase-config.js';
import { collection, doc, updateDoc, addDoc, query, getDocs, where, writeBatch, runTransaction, arrayUnion, serverTimestamp, onSnapshot  } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { ref, uploadBytes } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";
import { 
    allRemisiones, setAllRemisiones, allClientes, allItems, allColores, allUsers,
    currentUser, currentUserData, 
    showModalMessage, hideModal, showTemporaryMessage, showPdfModal, initSearchableInput,
    populateDateFilters, invalidateFileCache
} from '../app.js';
import { renderClientes } from './clientes.js'; 
import { formatCurrency, unformatCurrency, unformatCurrencyInput, formatCurrencyInput } from '../utils.js';
import { ESTADOS_REMISION, METODOS_DE_PAGO } from '../constants.js';
import { renderFacturacion } from './facturacion.js';

let localElementCounter = 0; 

// --- CONFIGURACIÓN DE CACHÉ Y PAGINACIÓN ---
const CACHE_KEY = 'remisiones_cache';
const SYNC_KEY = 'remisiones_last_sync';

let currentPage = 1;
const itemsPerPage = 20;
let activePaymentModalRemisionId = null;

// --- CARGA DE DATOS (INTELIGENTE + TIEMPO REAL INFALIBLE) ---
export function loadRemisiones() {
    const cachedData = localStorage.getItem(CACHE_KEY);
    
    let mapRemisiones = new Map();
    let maxLastUpdated = 0; 

    if (cachedData) {
        try {
            const parsedData = JSON.parse(cachedData);
            parsedData.forEach(r => {
                mapRemisiones.set(r.id, r);
                if (r._lastUpdated && r._lastUpdated > maxLastUpdated) {
                    maxLastUpdated = r._lastUpdated;
                }
            });
            setAllRemisiones(Array.from(mapRemisiones.values()));
            renderRemisiones();
            renderFacturacion();
            renderClientes(); 
        } catch (e) {
            console.warn("Caché de remisiones corrupto. Se limpiará.");
            localStorage.removeItem(CACHE_KEY);
            localStorage.removeItem(SYNC_KEY);
        }
    }

    const colRef = collection(db, "remisiones");
    let q;

    if (maxLastUpdated > 0) {
        const syncTime = new Date(maxLastUpdated - 120000); 
        q = query(colRef, where("_lastUpdated", ">=", syncTime));
    } else {
        q = query(colRef);
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
        let huboCambios = false;

        snapshot.docChanges().forEach((change) => {
            const doc = change.doc;
            const data = doc.data();

            if (data._lastUpdated && typeof data._lastUpdated.toMillis === 'function') data._lastUpdated = data._lastUpdated.toMillis();
            if (data.timestamp && typeof data.timestamp.toMillis === 'function') data.timestamp = data.timestamp.toMillis();
            if (data.fechaFacturado && typeof data.fechaFacturado.toMillis === 'function') data.fechaFacturado = data.fechaFacturado.toMillis();
            
            if (Array.isArray(data.payments)) {
                data.payments.forEach(p => {
                    if (p.registeredAt && typeof p.registeredAt.toMillis === 'function') p.registeredAt = p.registeredAt.toMillis();
                    if (p.confirmedAt && typeof p.confirmedAt.toMillis === 'function') p.confirmedAt = p.confirmedAt.toMillis();
                });
            }

            if (change.type === "added" || change.type === "modified") {
                const prevDoc = mapRemisiones.get(doc.id);
                if (prevDoc && change.type === "modified") {
                    if (prevDoc.pdfPath) window.invalidateFileCache?.(prevDoc.pdfPath);
                    if (prevDoc.pdfPlantaPath) window.invalidateFileCache?.(prevDoc.pdfPlantaPath);
                }
                mapRemisiones.set(doc.id, { id: doc.id, ...data });
                huboCambios = true;
            }
            if (change.type === "removed") {
                mapRemisiones.delete(doc.id);
                huboCambios = true;
            }
        });

        if (huboCambios) {
            const finalArray = Array.from(mapRemisiones.values());
            finalArray.sort((a, b) => b.numeroRemision - a.numeroRemision);

            localStorage.setItem(CACHE_KEY, JSON.stringify(finalArray));
            setAllRemisiones(finalArray);
            
            renderRemisiones();
            renderFacturacion();
            renderClientes();
            
            document.dispatchEvent(new CustomEvent('remisionesChanged'));

            if (document.getElementById('close-pending-payments-modal') && !document.getElementById('modal').classList.contains('hidden')) {
                showPendingPaymentsModal();
            }

            const closePaymentBtn = document.getElementById('close-secondary-payment-modal');
            if (closePaymentBtn && activePaymentModalRemisionId && !document.getElementById('modal').classList.contains('hidden')) {
                const updatedRemision = mapRemisiones.get(activePaymentModalRemisionId);
                if (updatedRemision) {
                    showPaymentModal(updatedRemision);
                }
            }
        }
    }, (error) => {
        console.error("Error en onSnapshot diferencial de remisiones:", error);
    });

    return unsubscribe;
}

function updateLocalCache(newOrUpdatedRemision) {
    const cachedData = localStorage.getItem(CACHE_KEY);
    let remisiones = cachedData ? JSON.parse(cachedData) : [];
    
    const index = remisiones.findIndex(r => r.id === newOrUpdatedRemision.id);
    if (index !== -1) remisiones[index] = newOrUpdatedRemision;
    else remisiones.push(newOrUpdatedRemision);
    
    remisiones.sort((a, b) => b.numeroRemision - a.numeroRemision);
    
    localStorage.setItem(CACHE_KEY, JSON.stringify(remisiones));
    setAllRemisiones(remisiones);
    
    renderRemisiones();
    renderFacturacion();
    renderClientes();
}

// --- RENDERIZADO CON PAGINACIÓN Y FILTROS ---
export function renderRemisiones() {
    const remisionesListEl = document.getElementById('remisiones-list');
    if (!remisionesListEl) return;

    const isPlanta = currentUserData && currentUserData.role === 'planta';
    const month = document.getElementById('filter-remisiones-month').value;
    const year = document.getElementById('filter-remisiones-year').value;
    const searchInput = document.getElementById('search-remisiones');
    const rawSearch = searchInput ? searchInput.value : '';
    const hasTrailingSpace = rawSearch.endsWith(' ');
    const searchTerm = rawSearch.trim().toLowerCase();
    
    let filtered = allRemisiones;

    if (isPlanta) {
        const allowedStates = ['Recibido', 'En Proceso', 'Procesado'];
        filtered = filtered.filter(r => allowedStates.includes(r.estado));
    }
    if (year !== 'all') {
        filtered = filtered.filter(r => new Date(r.fechaRecibido).getFullYear() == year);
    }
    if (month !== 'all') {
        filtered = filtered.filter(r => new Date(r.fechaRecibido).getMonth() == month);
    }
    if (searchTerm) {
        filtered = filtered.filter(r => {
            const clientMatch = r.clienteNombre && r.clienteNombre.toLowerCase().includes(searchTerm);
            const remisionMatch = hasTrailingSpace
                ? (r.numeroRemision && r.numeroRemision.toString() === searchTerm)
                : (r.numeroRemision && r.numeroRemision.toString().includes(searchTerm));
            return clientMatch || remisionMatch;
        });
    }
    
    filtered.sort((a, b) => new Date(b.fechaRecibido) - new Date(a.fechaRecibido));

    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;

    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const paginatedRemisiones = filtered.slice(startIndex, endIndex);

    remisionesListEl.innerHTML = '';
    if (totalItems === 0) {
        remisionesListEl.innerHTML = '<p class="text-center text-gray-500 py-8">No se encontraron remisiones.</p>';
        return;
    }

    paginatedRemisiones.forEach((remision) => {
        const el = document.createElement('div');
        const esAnulada = remision.estado === 'Anulada';
        const esEntregada = remision.estado === 'Entregado';
        const remColorClass = esAnulada ? 'premium-card-red' : 'premium-card-indigo';
        el.className = `premium-card ${remColorClass} p-5 flex flex-col lg:flex-row justify-between lg:items-center gap-4 bg-white shadow-sm hover:shadow-md transition`;

        const nameInitial = (remision.clienteNombre || 'C').charAt(0).toUpperCase();
        const paymentsArray = Array.isArray(remision.payments) ? remision.payments : [];
        const totalPagadoConfirmado = paymentsArray.filter(p => p.status === 'confirmado').reduce((sum, p) => sum + p.amount, 0);
        const saldoPendiente = remision.valorTotal - totalPagadoConfirmado;

        let paymentStatusBadge = '';
        if (!esAnulada) {
            if (saldoPendiente <= 0) paymentStatusBadge = `<span class="payment-status payment-pagado">Pagado</span>`;
            else if (totalPagadoConfirmado > 0) paymentStatusBadge = `<span class="payment-status payment-abono">Abono</span>`;
            else paymentStatusBadge = `<span class="payment-status payment-pendiente">Pendiente</span>`;
        }

        const pdfPath = isPlanta ? remision.pdfPlantaPath : remision.pdfPath;
        const pdfButton = pdfPath
            ? `<button data-file-path="${pdfPath}" data-file-title="Remisión N° ${remision.numeroRemision}" class="w-full bg-green-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-green-700 transition text-center shadow-sm">Ver PDF</button>`
            : `<button class="w-full bg-slate-300 text-slate-500 border border-slate-200 px-4 py-2.5 rounded-lg text-sm font-semibold cursor-not-allowed" disabled>Generando PDF...</button>`;

        const anularButton = (esAnulada || esEntregada || isPlanta || paymentsArray.length > 0) ? '' : `<button data-remision-id="${remision.id}" class="anular-btn w-full bg-red-50 text-red-650 border border-red-200 px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-red-100 hover:text-red-700 transition shadow-sm">Anular</button>`;
        const pagosButton = esAnulada || isPlanta ? '' : `<button data-remision-json='${JSON.stringify(remision)}' class="payment-btn w-full bg-purple-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-purple-700 transition shadow-sm">Abonar (${formatCurrency(saldoPendiente)})</button>`;
        const descuentoButton = (esAnulada || esEntregada || isPlanta || remision.discount) ? '' : `<button data-remision-json='${JSON.stringify(remision)}' class="discount-btn w-full bg-cyan-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-cyan-700 transition shadow-sm">Descuento</button>`;
        
        const enviarFacturarBtn = (!remision.incluyeIVA && !esAnulada && !isPlanta) 
            ? `<button data-remision-id="${remision.id}" class="enviar-facturar-btn w-full bg-indigo-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-indigo-700 transition shadow-sm">Enviar a Facturar</button>` 
            : '';

        let discountInfo = '';
        if (remision.discount && remision.discount.percentage > 0) {
            discountInfo = `<span class="bg-cyan-50 text-cyan-700 text-xs font-semibold px-2 py-0.5 rounded border border-cyan-150">DTO ${remision.discount.percentage.toFixed(2)}%</span>`;
        }
        
        const statusClasses = { 'Recibido': 'status-recibido', 'En Proceso': 'status-en-proceso', 'Procesado': 'status-procesado', 'Entregado': 'status-entregado' };
        const statusBadge = `<span class="status-badge ${statusClasses[remision.estado] || ''}">${remision.estado}</span>`;
        
        let statusButton = '';
        const currentIndex = ESTADOS_REMISION.indexOf(remision.estado);
        if (!esAnulada && currentIndex < ESTADOS_REMISION.length - 1) {
            const nextStatus = ESTADOS_REMISION[currentIndex + 1];
            statusButton = `<button data-remision-id="${remision.id}" data-current-status="${remision.estado}" class="status-update-btn w-full bg-indigo-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-indigo-700 transition shadow-sm">Listo: ${nextStatus}</button>`;
        }

        el.innerHTML = `
            <div class="flex-grow min-w-0 text-left">
                <div class="flex items-center gap-3 flex-wrap">
                    <span class="remision-id font-bold text-slate-800">N° ${remision.numeroRemision}</span>
                    <p class="font-bold text-lg text-slate-900 truncate" title="${remision.clienteNombre}">${remision.clienteNombre}</p>
                    ${statusBadge} ${paymentStatusBadge} ${discountInfo}
                    ${esAnulada ? '<span class="px-2.5 py-0.5 bg-red-100 text-red-800 text-[10px] font-extrabold border border-red-200 rounded-full">ANULADA</span>' : ''}
                </div>
                <p class="text-xs text-slate-500 mt-2 font-medium">Recibido: ${remision.fechaRecibido} &bull; ${remision.fechaEntrega ? `Entregado: ${remision.fechaEntrega}` : 'Entrega: Pendiente'}</p>
                ${!isPlanta ? `<p class="text-xs text-slate-600 mt-1 font-semibold">Monto Total: <span class="text-sm font-extrabold text-indigo-650">${formatCurrency(remision.valorTotal)}</span></p>` : ''}
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 flex-shrink-0 w-full sm:max-w-xs mt-2 lg:mt-0">
                ${statusButton} ${pdfButton} ${pagosButton} ${descuentoButton} ${enviarFacturarBtn} ${anularButton}
            </div>`;
        remisionesListEl.appendChild(el);
    });

    const paginationEl = document.createElement('div');
    paginationEl.className = 'premium-pagination-container flex justify-between items-center mt-6';
    paginationEl.innerHTML = `
        <span class="text-xs font-medium text-slate-500">Mostrando ${startIndex + 1} - ${Math.min(endIndex, totalItems)} de ${totalItems} remisiones</span>
        <div class="flex gap-2">
            <button id="prev-page-rem-btn" class="premium-pagination-btn" ${currentPage === 1 ? 'disabled' : ''}>&larr; Anterior</button>
            <span class="px-3 py-1 text-xs font-bold text-slate-700 flex items-center bg-slate-50 border rounded-full">Pág ${currentPage} de ${totalPages}</span>
            <button id="next-page-rem-btn" class="premium-pagination-btn" ${currentPage === totalPages ? 'disabled' : ''}>Siguiente &rarr;</button>
        </div>
    `;
    remisionesListEl.appendChild(paginationEl);

    const prevBtn = document.getElementById('prev-page-rem-btn');
    const nextBtn = document.getElementById('next-page-rem-btn');
    if (prevBtn && currentPage > 1) prevBtn.addEventListener('click', () => { currentPage--; renderRemisiones(); });
    if (nextBtn && currentPage < totalPages) nextBtn.addEventListener('click', () => { currentPage++; renderRemisiones(); });

    remisionesListEl.querySelectorAll('.anular-btn').forEach(button => button.addEventListener('click', (e) => { 
        const remisionId = e.currentTarget.dataset.remisionId; 
        if (confirm(`¿Estás seguro de que quieres ANULAR esta remisión?`)) handleAnularRemision(remisionId); 
    }));
    remisionesListEl.querySelectorAll('.status-update-btn').forEach(button => button.addEventListener('click', (e) => { 
        handleStatusUpdate(e.currentTarget.dataset.remisionId, e.currentTarget.dataset.currentStatus); 
    }));
    remisionesListEl.querySelectorAll('.payment-btn').forEach(button => button.addEventListener('click', (e) => {
        const remisionData = JSON.parse(e.currentTarget.dataset.remisionJson);
        if (!Array.isArray(remisionData.payments)) remisionData.payments = [];
        showPaymentModal(remisionData); 
    })); 
    remisionesListEl.querySelectorAll('.discount-btn').forEach(button => button.addEventListener('click', (e) => { 
        showDiscountModal(JSON.parse(e.currentTarget.dataset.remisionJson)); 
    }));
    remisionesListEl.querySelectorAll('.enviar-facturar-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            handleEnviarAFacturar(e.currentTarget.dataset.remisionId);
        });
    });

    updatePendingPaymentsBadge();
    
    // Precargar los enlaces de PDFs de manera inteligente y secuencial
    if (typeof window.scanAndPrefetchSecureFiles === 'function') {
        window.scanAndPrefetchSecureFiles();
    }
}

// --- LÓGICA DE ALGORITMO Y CÁLCULOS ---
function calcularCostoDeCortes(totalCortes) {
    if (totalCortes <= 3) return { costo: 0, descripcion: "Hasta 3 cortes sin costo", ivaIncluido: false };
    if (totalCortes <= 10) return { costo: 15000, descripcion: `Cargo por ${totalCortes} cortes`, ivaIncluido: true };
    return { costo: 20000, descripcion: `Cargo especial por ${totalCortes} cortes`, ivaIncluido: true };
}

function calcularTotales() {
    const ivaCheckbox = document.getElementById('incluir-iva');
    const subtotalEl = document.getElementById('subtotal');
    const valorIvaEl = document.getElementById('valor-iva');
    const valorTotalEl = document.getElementById('valor-total');
    if (!subtotalEl) return; 

    let subtotalItems = 0;
    const incluyeIVA = ivaCheckbox.checked;

    document.querySelectorAll('.item-row').forEach(itemRow => {
        const valorPorLamina = unformatCurrency(itemRow.querySelector('.item-valor-lamina').value);
        const cantidad = parseInt(itemRow.querySelector('.item-cantidad').value) || 0;
        subtotalItems += cantidad * valorPorLamina;
    });

    const subtotalGeneral = subtotalItems;
    const valorIVA = incluyeIVA ? subtotalGeneral * 0.19 : 0;
    const total = subtotalGeneral + valorIVA;

    subtotalEl.textContent = formatCurrency(Math.round(subtotalGeneral));
    valorIvaEl.textContent = formatCurrency(Math.round(valorIVA));
    valorTotalEl.textContent = formatCurrency(Math.round(total));

    return { subtotalGeneral, valorIVA, total };
}

export function optimizarCortes(sheetW, sheetH, cortes, opts = {}) {
    const KERF = Math.max(0, opts.kerf ?? 0);
    const MARGIN = Math.max(0, opts.margin ?? 0);
    const ALLOW_SHEET_ROTATION = opts.allowSheetRotation ?? false;
    const ALLOW_PIECE_ROTATION = opts.allowPieceRotation ?? true;
    const HEUR = opts.heuristic ?? "BAF";
    const PREFERENCE = opts.preference;

    class MRBin {
        constructor(W, H, kerf = 0) { this.kerf = kerf; this.free = [{ x: 0, y: 0, w: W, h: H }]; }
        _score(node, fr, heur) {
            switch (heur) {
                case 'BSSF': {
                    const ssf = Math.min(Math.abs(fr.w - node.w), Math.abs(fr.h - node.h));
                    const lsf = Math.max(Math.abs(fr.w - node.w), Math.abs(fr.h - node.h));
                    return { primary: ssf, secondary: lsf };
                }
                case 'BL': return { primary: node.y, secondary: node.x };
                default: {
                    const fit = fr.w * fr.h - node.w * node.h;
                    const ssf = Math.min(Math.abs(fr.w - node.w), Math.abs(fr.h - node.h));
                    return { primary: fit, secondary: ssf };
                }
            }
        }
        find(w, h, rotOK, heur) {
            let best = null;
            const tryR = (rw, rh, rot) => {
                for (const fr of this.free) {
                    if (rw <= fr.w && rh <= fr.h) {
                        const node = { x: fr.x, y: fr.y, w: rw, h: rh };
                        const sc = this._score(node, fr, heur);
                        if (!best || sc.primary < best.score.primary ||
                            (sc.primary === best.score.primary && sc.secondary < best.score.secondary)) {
                            best = { node, score: sc, rot };
                        }
                    }
                }
            };
            tryR(w, h, false);
            if (rotOK && w !== h) tryR(h, w, true);
            return best;
        }
        place(n) {
            const out = [];
            for (const fr of this.free) {
                if (!(n.x >= fr.x + fr.w || n.x + n.w <= fr.x || n.y >= fr.y + fr.h || n.y + n.h <= fr.y)) {
                    if (n.y > fr.y) { const h = n.y - fr.y - this.kerf; if (h > 0) out.push({ x: fr.x, y: fr.y, w: fr.w, h }); }
                    if (n.y + n.h < fr.y + fr.h) {
                        const y = n.y + n.h + this.kerf, h = fr.y + fr.h - (n.y + n.h) - this.kerf; if (h > 0) out.push({ x: fr.x, y, w: fr.w, h });
                    }
                    if (n.x > fr.x) { const w = n.x - fr.x - this.kerf; if (w > 0) out.push({ x: fr.x, y: fr.y, w, h: fr.h }); }
                    if (n.x + n.w < fr.x + fr.w) {
                        const x = n.x + n.w + this.kerf, w = fr.x + fr.w - (n.x + n.w) - this.kerf; if (w > 0) out.push({ x, y: fr.y, w, h: fr.h });
                    }
                } else out.push(fr);
            }
            const pr = [];
            for (let i = 0; i < out.length; i++) {
                let ok = true;
                for (let j = 0; j < out.length; j++) {
                    if (i !== j && out[i].x >= out[j].x && out[i].y >= out[j].y &&
                        out[i].x + out[i].w <= out[j].x + out[j].w && out[i].y + out[i].h <= out[j].y + out[j].h) { ok = false; break; }
                }
                if (ok && out[i].w > 0 && out[i].h > 0) pr.push(out[i]);
            }
            this.free = pr;
        }
    }

    function maxRectsMulti(pieces, SW, SH, { margin = 0, kerf = 0, heuristic = "BAF", allowRotate = true }) {
        const W = SW - 2 * margin, H = SH - 2 * margin, sheets = [];
        const list = pieces.slice().map(p => ({ ...p })).sort((a, b) => b.area - a.area);
        let i = 0;
        while (i < list.length) {
            const bin = new MRBin(W, H, kerf);
            const placed = [];
            let moved = true;
            while (moved && i < list.length) {
                moved = false;
                let best = null, idx = -1;
                for (let k = i; k < list.length; k++) {
                    const p = list[k];
                    const pos = bin.find(p.w0, p.h0, allowRotate, heuristic);
                    if (pos && (!best ||
                        pos.score.primary < best.score.primary ||
                        (pos.score.primary === best.score.primary && pos.score.secondary < best.score.secondary))) {
                        best = pos; idx = k;
                    }
                }
                if (best) {
                    bin.place(best.node);
                    const p = list[idx];
                    placed.push({ id: p.id, x: best.node.x + margin, y: best.node.y + margin, w: best.node.w, h: best.node.h, w0: p.w0, h0: p.h0, rot: best.rot });
                    [list[idx], list[i]] = [list[i], list[idx]]; i++; moved = true;
                }
            }
            if (placed.length > 0) sheets.push({ placed });
        }
        if (sheets.length === 0 && list.length > 0) return null;
        const waste = sheets.reduce((t, sh) => t + (W * H - sh.placed.reduce((s, r) => s + r.w * r.h, 0)), 0);
        return { count: sheets.length, sheets, waste };
    }

    function allIdentical(arr) { const a = arr[0]; return arr.every(p => p.w0 === a.w0 && p.h0 === a.h0); }
    function exactPatternCols(W, H, w, h, allowRotate) {
        const rowsU = Math.floor(H / h), rowsR = allowRotate ? Math.floor(H / w) : 0;
        let best = { cap: 0, c: 0, d: 0, modo: 'cols' };
        for (let d = 0; d <= (allowRotate ? Math.floor(W / h) : 0); d++) {
            const rem = W - d * h; if (rem < 0) break;
            const c = Math.floor(rem / w);
            const cap = c * rowsU + d * rowsR;
            if (cap > best.cap) best = { cap, c, d, modo: 'cols' };
        }
        best.cutsSeq = [{ lamina: 1, verticales: [] }];
        return best;
    }
    function exactPatternRows(W, H, w, h, allowRotate) {
        const colsU = Math.floor(W / w), colsR = allowRotate ? Math.floor(W / h) : 0;
        let best = { cap: 0, a: 0, b: 0, modo: 'rows' };
        for (let b = 0; b <= (allowRotate ? Math.floor(H / w) : 0); b++) {
            const rem = H - b * w; if (rem < 0) break;
            const a = Math.floor(rem / h);
            const cap = a * colsU + b * colsR;
            if (cap > best.cap) best = { cap, a, b, modo: 'rows' };
        }
        best.cutsSeq = [{ lamina: 1, horizontales: [] }];
        return best;
    }
    function chooseBestPattern(A, B) {
        if (A.cap > B.cap) return A;
        if (B.cap > A.cap) return B;
        return A; 
    }
    function renderExactPattern(pat, take, w, h, m, SW, SH) {
        const placed = []; if (take <= 0) return placed;
        if (pat.modo === 'cols') {
            let x = m;
            const rowsR = Math.floor((SH - 2 * m) / w);
            for (let j = 0; j < pat.d && placed.length < take; j++) {
                let y = m; for (let i = 0; i < rowsR && placed.length < take; i++) { placed.push({ x, y, w: h, h: w, rot: true }); y += w; }
                x += h;
            }
            const rowsU = Math.floor((SH - 2 * m) / h);
            for (let j = 0; j < pat.c && placed.length < take; j++) {
                let y = m; for (let i = 0; i < rowsU && placed.length < take; i++) { placed.push({ x, y, w: w, h: h, rot: false }); y += h; }
                x += w;
            }
            return placed;
        } else {
            let y = m;
            const colsU = Math.floor((SW - 2 * m) / w);
            for (let i = 0; i < pat.a && placed.length < take; i++) {
                let x = m; for (let j = 0; j < colsU && placed.length < take; j++) { placed.push({ x, y, w: w, h: h, rot: false }); x += w; }
                y += h;
            }
            const colsR = Math.floor((SW - 2 * m) / h);
            for (let i = 0; i < pat.b && placed.length < take; i++) {
                let x = m; for (let j = 0; j < colsR && placed.length < take; j++) { placed.push({ x, y, w: h, h: w, rot: true }); x += h; }
                y += w;
            }
            return placed;
        }
    }
    function guillotineColumns(pieces, SW, SH, { margin = 0, kerf = 0, allowRotate = true }) {
        const W = SW - 2 * margin, H = SH - 2 * margin;
        const items = pieces.map(p => ({ ...p }));
        const cols = [];
        const sorted = items.sort((a, b) => Math.max(b.w0, b.h0) - Math.max(a.w0, a.h0) || (b.w0 * b.h0 - a.w0 * a.h0));
        const orient = (p) => {
            const o = [{ w: p.w0, h: p.h0, rot: false }];
            if (allowRotate && p.w0 !== p.h0) o.push({ w: p.h0, h: p.w0, rot: true });
            return o;
        };

        for (const p of sorted) {
            let best = null, bestCol = -1, bestOpt = null;
            const opts = orient(p);
            for (let ci = 0; ci < cols.length; ci++) {
                const col = cols[ci];
                for (const o of opts) {
                    const need = (col.pieces.length ? kerf : 0) + o.h;
                    if (col.usedH + need <= H) {
                        const dW = Math.max(0, o.w - col.width);
                        const slack = H - (col.usedH + need);
                        const score = dW * 1e6 + slack;
                        if (!best || score < best.score) { best = { score }, bestCol = ci, bestOpt = o; }
                    }
                }
            }
            if (best) {
                const col = cols[bestCol];
                col.width = Math.max(col.width, bestOpt.w);
                if (col.pieces.length) col.usedH += kerf;
                col.pieces.push({ id: p.id, w: bestOpt.w, h: bestOpt.h, rot: bestOpt.rot, w0: p.w0, h0: p.h0 });
                col.usedH += bestOpt.h;
                continue;
            }
            const feas = opts.filter(o => o.h <= H).sort((a, b) => (a.w - b.w) || (b.h - a.h));
            if (!feas.length) return null;
            const o = feas[0];
            cols.push({ width: o.w, usedH: o.h, pieces: [{ id: p.id, w: o.w, h: o.h, rot: o.rot, w0: p.w0, h0: p.h0 }] });
        }

        const sheets = [];
        const colsSorted = cols.sort((a, b) => b.width - a.width);
        for (const c of colsSorted) {
            let ok = false;
            for (const sh of sheets) {
                const need = (sh.cols.length ? kerf : 0) + c.width;
                if (sh.usedW + need <= (W)) { sh.cols.push(c); sh.usedW += need; ok = true; break; }
            }
            if (!ok) sheets.push({ usedW: c.width, cols: [c] });
        }

        const outSheets = [], cutsSeq = [];
        for (let si = 0; si < sheets.length; si++) {
            const sh = sheets[si];
            let x = MARGIN;
            const placed = [];
            const vCuts = []; const hPerCol = [];
            for (let ci = 0; ci < sh.cols.length; ci++) {
                const col = sh.cols[ci];
                if (ci > 0) x += KERF;
                let y = MARGIN;
                const yCuts = [];
                for (let k = 0; k < col.pieces.length; k++) {
                    const it = col.pieces[k];
                    if (k > 0) y += KERF;
                    placed.push({ id: it.id, x, y, w: it.w, h: it.h, w0: it.w0, h0: it.h0, rot: it.rot });
                    y += it.h;
                    if (k < col.pieces.length - 1) yCuts.push(y + KERF / 2);
                }
                hPerCol.push({ columna: ci + 1, x0: x, x1: x + col.width, yCuts });
                x += col.width;
                if (ci < sh.cols.length - 1) vCuts.push(x);
            }
            outSheets.push({ placed });
            cutsSeq.push({ lamina: si + 1, verticales: vCuts, horizontalesPorColumna: hPerCol });
        }
        const areaNet = (W * H);
        const waste = outSheets.reduce((t, sh) => t + (areaNet - sh.placed.reduce((s, r) => s + r.w * r.h, 0)), 0);
        return { count: outSheets.length, sheets: outSheets, waste, cutsSeq };
    }
    function guillotineRows(pieces, SW, SH, { margin = 0, kerf = 0, allowRotate = true }) {
        const W = SW - 2 * margin, H = SH - 2 * margin;
        const items = pieces.map(p => ({ ...p }));
        const rows = [];
        const sorted = items.sort((a, b) => Math.max(b.w0, b.h0) - Math.max(a.w0, a.h0) || (b.w0 * b.h0 - a.w0 * a.h0));
        const orient = (p) => {
            const o = [{ w: p.w0, h: p.h0, rot: false }];
            if (allowRotate && p.w0 !== p.h0) o.push({ w: p.h0, h: p.w0, rot: true });
            return o;
        };

        for (const p of sorted) {
            let best = null, bestRow = -1, bestOpt = null;
            const opts = orient(p);
            for (let ri = 0; ri < rows.length; ri++) {
                const row = rows[ri];
                for (const o of opts) {
                    const need = (row.pieces.length ? kerf : 0) + o.w;
                    if (row.usedW + need <= W) {
                        const dH = Math.max(0, o.h - row.height);
                        const score = dH * 1e6 + (W - (row.usedW + need));
                        if (!best || score < best.score) { best = { score }, bestRow = ri, bestOpt = o; }
                    }
                }
            }
            if (best) {
                const row = rows[bestRow];
                row.height = Math.max(row.height, bestOpt.h);
                if (row.pieces.length) row.usedW += kerf;
                row.pieces.push({ id: p.id, w: bestOpt.w, h: bestOpt.h, rot: bestOpt.rot, w0: p.w0, h0: p.h0 });
                row.usedW += bestOpt.w;
                continue;
            }
            const feas = opts.filter(o => o.w <= W).sort((a, b) => (a.h - b.h) || (b.w - a.w));
            if (!feas.length) return null;
            const o = feas[0];
            rows.push({ height: o.h, usedW: o.w, pieces: [{ id: p.id, w: o.w, h: o.h, rot: o.rot, w0: p.w0, h0: p.h0 }] });
        }

        const sheets = [];
        const rowsSorted = rows.sort((a, b) => b.height - a.height);
        for (const r of rowsSorted) {
            let ok = false;
            for (const sh of sheets) {
                const usedH = sh.rows.reduce((s, rr) => s + rr.height, 0) + (sh.rows.length > 1 ? kerf * (sh.rows.length - 1) : 0);
                const need = (sh.rows.length ? kerf : 0) + r.height;
                if (usedH + need <= H) { sh.rows.push(r); ok = true; break; }
            }
            if (!ok) sheets.push({ rows: [r] });
        }

        const outSheets = [], cutsSeq = [];
        for (let si = 0; si < sheets.length; si++) {
            const sh = sheets[si];
            let y = MARGIN;
            const placed = []; const hCuts = []; const vPerRow = [];
            for (let ri = 0; ri < sh.rows.length; ri++) {
                const row = sh.rows[ri];
                if (ri > 0) y += KERF;
                let x = MARGIN;
                const xCuts = [];
                for (let k = 0; k < row.pieces.length; k++) {
                    const it = row.pieces[k];
                    if (k > 0) x += KERF;
                    placed.push({ id: it.id, x, y, w: it.w, h: it.h, w0: it.w0, h0: it.h0, rot: it.rot });
                    x += it.w;
                    if (k < row.pieces.length - 1) xCuts.push(x + KERF / 2);
                }
                vPerRow.push({ fila: ri + 1, y0: y, y1: y + row.height, xCuts });
                y += row.height;
                if (ri < sh.rows.length - 1) hCuts.push(y);
            }
            outSheets.push({ placed });
            cutsSeq.push({ lamina: si + 1, horizontales: hCuts, verticalesPorFila: vPerRow });
        }
        const areaNet = (W * H);
        const waste = outSheets.reduce((t, sh) => t + (areaNet - sh.placed.reduce((s, r) => s + r.w * r.h, 0)), 0);
        return { count: outSheets.length, sheets: outSheets, waste, cutsSeq };
    }

    const piezas = [];
    let gid = 1;
    for (const c of cortes) for (let i = 0; i < c.cantidad; i++) {
        piezas.push({ id: gid++, w0: c.ancho, h0: c.alto, area: c.ancho * c.alto });
    }
    if (!piezas.length) return { numeroLaminas: 0, plano: [], cortesSecuencia: [] };

    const innerW = sheetW - 2 * MARGIN;
    const innerH = sheetH - 2 * MARGIN;
    const fitsAny = (p, W, H) => (p.w0 <= W && p.h0 <= H) || (ALLOW_PIECE_ROTATION && p.h0 <= W && p.w0 <= H);
    const innerWrot = sheetH - 2 * MARGIN, innerHrot = sheetW - 2 * MARGIN;
    for (const p of piezas) {
        const okN = fitsAny(p, innerW, innerH);
        const okR = ALLOW_SHEET_ROTATION ? fitsAny(p, innerWrot, innerHrot) : false;
        if (!okN && !okR) throw new Error(`La pieza ${p.w0}x${p.h0} no cabe en la lámina ${sheetW}x${sheetH} (margen ${MARGIN}).`);
    }

    if (KERF === 0 && allIdentical(piezas)) {
        const w = piezas[0].w0, h = piezas[0].h0, N = piezas.length;
        const patV = exactPatternCols(innerW, innerH, w, h, ALLOW_PIECE_ROTATION);
        const patH = exactPatternRows(innerW, innerH, w, h, ALLOW_PIECE_ROTATION);
        const bestPat = chooseBestPattern(patV, patH);
        const cap = bestPat.cap;
        if (cap === 0) return { numeroLaminas: Infinity, plano: [], error: "No se pudo colocar ninguna pieza." };
        const hojas = Math.ceil(N / cap);
        const plano = []; let used = 0;
        for (let s = 0; s < hojas; s++) {
            const take = Math.min(cap, N - used);
            const placed = renderExactPattern(bestPat, take, w, h, MARGIN, sheetW, sheetH);
            plano.push({ numero: s + 1, cortes: placed.map((r, idx) => ({ id: piezas[used + idx]?.id ?? (used + idx + 1), ancho: r.w, alto: r.h, x: r.x, y: r.y, descripcion: `${w}x${h}${r.rot ? ' (R)' : ''}` })) });
            used += take;
        }
        return { numeroLaminas: plano.length, plano, cortesSecuencia: bestPat.cutsSeq };
    }

    const base = maxRectsMulti(piezas, sheetW, sheetH, { margin: MARGIN, kerf: KERF, heuristic: HEUR, allowRotate: ALLOW_PIECE_ROTATION });
    const gVert = guillotineColumns(piezas, sheetW, sheetH, { margin: MARGIN, kerf: KERF, allowRotate: ALLOW_PIECE_ROTATION });
    const gHorz = guillotineRows(piezas, sheetW, sheetH, { margin: MARGIN, kerf: KERF, allowRotate: ALLOW_PIECE_ROTATION });
    const baseSheets = base ? base.count : Infinity;

    const candidates = [];
    if (gVert) candidates.push({ tag: 'gV', ...gVert });
    if (gHorz) candidates.push({ tag: 'gH', ...gHorz });
    if (base) candidates.push({ tag: 'base', ...base });

    candidates.sort((a, b) => (a.count - b.count) || (a.waste - b.waste));

    let chosen = null;
    if (opts.strategy && candidates.some(c => c.tag === opts.strategy)) {
        chosen = candidates.find(c => c.tag === opts.strategy);
    } else {
        const equalOrBetter = candidates.filter(c => c.tag !== 'base' && c.count <= baseSheets);

        if (equalOrBetter.length > 0) {
            if (PREFERENCE === 'prefer-vertical') {
                const prefer = equalOrBetter.find(c => c.tag === 'gV' && c.count === equalOrBetter[0].count);
                chosen = prefer ?? equalOrBetter[0];
            } else {
                chosen = equalOrBetter[0];
            }
        } else {
            chosen = candidates.find(c => c.tag === 'base');
        }
    }

    if (!chosen) {
        return { numeroLaminas: Infinity, plano: [], error: "No se encontró una solución de corte." };
    }

    const plano = chosen.sheets.map((sh, i) => ({
        numero: i + 1,
        cortes: sh.placed.map(r => ({
            id: r.id, ancho: r.w, alto: r.h, x: r.x, y: r.y,
            descripcion: `${r.w0}x${r.h0}${r.rot ? ' (R)' : ''}`
        }))
    }));
    const out = { numeroLaminas: chosen.count, plano };
    if (chosen.cutsSeq) out.cortesSecuencia = chosen.cutsSeq;
    return out;
}

// --- CREACIÓN DE ELEMENTOS DINÁMICOS ---
function createItemElement() {
    localElementCounter++;
    const itemRow = document.createElement('div');
    itemRow.className = 'item-row border border-gray-300 p-4 rounded-xl bg-slate-50 space-y-3 relative';
    itemRow.id = `item-row-${localElementCounter}`;

    itemRow.innerHTML = `
        <div class="relative">
            <input type="text" placeholder="Buscar ítem..." class="item-search-input w-full p-2.5 border border-gray-300 rounded-lg text-sm" autocomplete="off" required>
            <input type="hidden" class="item-id-hidden" name="itemId">
            <div class="search-results hidden"></div>
        </div>
        
        <div class="relative">
            <input type="text" placeholder="Buscar color..." class="color-search-input w-full p-2.5 border border-gray-300 rounded-lg text-sm" autocomplete="off" required>
            <div class="color-search-results search-results hidden"></div>
        </div>
        
        <div class="flex items-center gap-3">
            <div class="w-24">
                <input type="number" class="item-cantidad w-full p-2.5 border border-gray-300 rounded-lg text-sm text-center font-semibold" placeholder="Cant." min="1" required>
            </div>
            <div class="flex-grow">
                <input type="text" class="item-valor-lamina cost-input-cop w-full p-2.5 border border-gray-300 rounded-lg text-sm font-semibold" placeholder="Vlr. Unit." required>
            </div>
            <button type="button" class="remove-item-btn bg-red-500 hover:bg-red-600 text-white font-extrabold px-5 py-2.5 rounded-lg text-sm transition">Eliminar</button>
        </div>
    `;

    initSearchableInput(
        itemRow.querySelector('.item-search-input'),
        itemRow.querySelector('.search-results'),
        () => allItems,
        (item) => `${item.referencia} - ${item.descripcion}`,
        (selectedItem, searchInputElement) => {
            const row = searchInputElement.closest('.item-row');
            if (!row) return; 
            
            if (selectedItem) {
                row.querySelector('.item-id-hidden').value = selectedItem.id;
            } else {
                row.querySelector('.item-id-hidden').value = '';
            }
            calcularTotales();
        }
    );

    initSearchableInput(
        itemRow.querySelector('.color-search-input'),
        itemRow.querySelector('.color-search-results'),
        () => allColores,
        (color) => color.nombre,
        (selectedColor, searchInputElement) => {
            // Se actualiza el color en el input al seleccionar de la lista
        }
    );

    const valorLaminaInput = itemRow.querySelector('.item-valor-lamina');
    valorLaminaInput.addEventListener('focus', (e) => unformatCurrencyInput(e.target));
    valorLaminaInput.addEventListener('blur', (e) => formatCurrencyInput(e.target));

    return itemRow;
}

function createCutElement() {
    const cutRow = document.createElement('div');
    cutRow.className = 'cut-row flex items-center gap-2';
    cutRow.innerHTML = `
        <input type="number" class="cut-ancho w-full p-1 border rounded-md" placeholder="Ancho">
        <span class="text-gray-400">x</span>
        <input type="number" class="cut-alto w-full p-1 border rounded-md" placeholder="Alto">
        <input type="number" class="cut-cantidad w-20 p-1 border rounded-md" placeholder="Cant." min="1" value="1">
        <button type="button" class="remove-cut-btn bg-red-100 text-red-700 font-bold rounded p-1 text-xs">X</button>
    `;
    return cutRow;
}

// --- MANEJO DE ACCIONES ---
async function handleRemisionSubmit(e) {
    e.preventDefault();
    const clienteId = document.getElementById('cliente-id-hidden').value;
    const cliente = allClientes.find(c => c.id === clienteId);
    if (!clienteId || !cliente) return showModalMessage("Debes seleccionar un cliente válido de la lista.");

    showModalMessage("Validando stock y procesando remisión...", true);

    try {
        const itemsParaGuardar = [];
        const cargosAdicionales = [];
        const stockUpdates = {};
        const incluyeIVA = document.getElementById('incluir-iva').checked;
        const itemRows = document.querySelectorAll('.item-row');

        const stockNecesario = {};
        
        // FASE 1: Cálculo de stock necesario
        for (const itemRow of itemRows) {
            const itemId = itemRow.querySelector('.item-id-hidden').value;
            if (!itemId) continue;

            const itemSeleccionado = allItems.find(i => i.id === itemId);
            if (!itemSeleccionado) throw new Error("Has seleccionado un ítem inválido.");

            const cantidadNecesaria = parseInt(itemRow.querySelector('.item-cantidad').value) || 0;
            stockNecesario[itemId] = (stockNecesario[itemId] || 0) + cantidadNecesaria;
        }

        // FASE 2: Validación de stock
        for (const itemId in stockNecesario) {
            const itemEnInventario = allItems.find(i => i.id === itemId);
            
            // Si el ítem no tiene stock definido (o es infinito), no validamos stock
            if (!itemEnInventario || itemEnInventario.stock === undefined || itemEnInventario.stockInfinito) continue;

            const stockDisponible = itemEnInventario ? itemEnInventario.stock : 0;
            if (stockNecesario[itemId] > stockDisponible) {
                throw new Error(`Stock insuficiente para "${itemEnInventario.descripcion}". Necesitas ${stockNecesario[itemId]}, pero solo hay ${stockDisponible} disponibles.`);
            }
        }

        // FASE 3: Preparación de datos para guardar
        for (const itemRow of itemRows) {
            const itemId = itemRow.querySelector('.item-id-hidden').value;
            if (!itemId) continue;
            
            const itemSeleccionado = allItems.find(i => i.id === itemId);
            const valorPorLaminaConIVA = unformatCurrency(itemRow.querySelector('.item-valor-lamina').value);

            if (isNaN(valorPorLaminaConIVA) || valorPorLaminaConIVA <= 0) {
                throw new Error(`Debes ingresar un valor válido para el ítem: ${itemSeleccionado.descripcion}.`);
            }

            const valorPorLaminaBase = valorPorLaminaConIVA;
            const cantidad = parseInt(itemRow.querySelector('.item-cantidad').value) || 0;
            const color = itemRow.querySelector('.color-search-input').value || 'Sin Color';

            if (cantidad > 0) {
                itemsParaGuardar.push({
                    itemId, referencia: itemSeleccionado.referencia, descripcion: itemSeleccionado.descripcion,
                    color: color, cantidad, valorUnitario: valorPorLaminaBase, valorTotal: valorPorLaminaBase * cantidad
                });
                stockUpdates[itemId] = (stockUpdates[itemId] || 0) + cantidad;
            }
        }

        if (itemsParaGuardar.length === 0) throw new Error("No has añadido ítems válidos a la remisión.");

        const subtotalGeneral = itemsParaGuardar.reduce((sum, item) => sum + item.valorTotal, 0);
        const valorIVA = incluyeIVA ? subtotalGeneral * 0.19 : 0;
        const totalFinal = subtotalGeneral + valorIVA;

        const counterRef = doc(db, "counters", "remisionCounter");
        let newRemisionNumber;
        
        await runTransaction(db, async (t) => {
            const counterDoc = await t.get(counterRef);
            newRemisionNumber = (counterDoc.exists() ? counterDoc.data().currentNumber : 0) + 1;
            t.set(counterRef, { currentNumber: newRemisionNumber }, { merge: true });
        });

        const observaciones = document.getElementById('remision-observaciones').value;
        const formaPago = document.getElementById('forma-pago').value;
        const payments = [];
        let saldoPendiente = Math.round(totalFinal);
        let formaPagoFinal = "Pendiente";

        if (formaPago !== "Pendiente") {
            payments.push({
                amount: Math.round(totalFinal),
                method: formaPago.toLowerCase(),
                status: 'confirmado',
                registeredAt: Date.now(),
                confirmedAt: Date.now(),
                confirmedBy: currentUser.uid,
                registeredBy: currentUser.uid
            });
            saldoPendiente = 0;
            formaPagoFinal = "Cancelado";
        }

        const nuevaRemision = {
            numeroRemision: newRemisionNumber, idCliente: clienteId, clienteNombre: cliente.nombre,
            clienteNit: cliente.nit || 'N/A',
            clienteEmail: cliente.email, clienteTelefono: cliente.telefono1 || cliente.telefono2 || 'N/A',
            fechaRecibido: document.getElementById('fecha-recibido').value,
            formaPago: formaPagoFinal, saldoPendiente: saldoPendiente, payments: payments, observaciones: observaciones, 
            incluyeIVA, items: itemsParaGuardar, cargosAdicionales, subtotal: Math.round(subtotalGeneral),
            valorIVA: Math.round(valorIVA), valorTotal: Math.round(totalFinal), creadoPor: currentUser.uid,
            timestamp: Date.now(), estado: 'Recibido', _lastUpdated: serverTimestamp()
        };

        const batch = writeBatch(db);
        const newRemisionRef = doc(collection(db, "remisiones"));
        batch.set(newRemisionRef, nuevaRemision);

        for (const itemId in stockUpdates) {
            const itemRef = doc(db, "items", itemId);
            const itemActual = allItems.find(i => i.id === itemId);
            
            // Solo restamos de la base de datos si el ítem tiene stock definido y NO es infinito
            if (itemActual && itemActual.stock !== undefined && !itemActual.stockInfinito) {
                batch.update(itemRef, { 
                    stock: (itemActual.stock || 0) - stockUpdates[itemId], 
                    _lastUpdated: serverTimestamp() 
                });
            }
        }

        await batch.commit();
        
        nuevaRemision.id = newRemisionRef.id;
        nuevaRemision._lastUpdated = Date.now();
        updateLocalCache(nuevaRemision);

        e.target.reset();
        document.getElementById('items-container').innerHTML = '';
        document.getElementById('fecha-recibido').value = new Date().toISOString().split('T')[0];
        calcularTotales();
        hideModal();
        showTemporaryMessage("¡Remisión guardada con éxito!", "success");
        document.getElementById('remision-form-container')?.classList.remove('show-modal');

    } catch (error) {
        console.error("Error al procesar la remisión:", error);
        hideModal();
        showModalMessage(`Error: ${error.message}`);
    }
}

async function handleStatusUpdate(remisionId, currentStatus) { 
    const currentIndex = ESTADOS_REMISION.indexOf(currentStatus); 
    if (currentIndex < ESTADOS_REMISION.length - 1) { 
        const nextStatus = ESTADOS_REMISION[currentIndex + 1]; 
        const updateData = { estado: nextStatus, _lastUpdated: serverTimestamp() }; 
        if (nextStatus === 'Entregado') updateData.fechaEntrega = new Date().toISOString().split('T')[0]; 
        
        showModalMessage("Actualizando estado...", true); 
        try { 
            await updateDoc(doc(db, "remisiones", remisionId), updateData); 
            
            const remisionActual = allRemisiones.find(r => r.id === remisionId);
            if (remisionActual) {
                const updatedRem = { ...remisionActual, ...updateData, _lastUpdated: Date.now() };
                updateLocalCache(updatedRem);
            }
            hideModal(); 
        } 
        catch (error) { console.error("Error al actualizar estado:", error); showModalMessage("Error al actualizar estado."); } 
    } 
}

async function handleAnularRemision(remisionId) { 
    showModalMessage("Anulando remisión...", true); 
    try { 
        await updateDoc(doc(db, "remisiones", remisionId), { estado: "Anulada", _lastUpdated: serverTimestamp() }); 
        
        const remisionActual = allRemisiones.find(r => r.id === remisionId);
        if (remisionActual) {
            updateLocalCache({ ...remisionActual, estado: "Anulada", _lastUpdated: Date.now() });
        }

        hideModal(); 
        showModalMessage("¡Remisión anulada con éxito!", false, 2000); 
    } 
    catch (error) { console.error("Error al anular la remisión:", error); hideModal(); showModalMessage("Error al anular la remisión."); } 
}

export function showPaymentModal(remision) {
    const modal = document.getElementById('modal');
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    if (!modal || !modalContentWrapper) return;

    activePaymentModalRemisionId = remision.id;

    const paymentsArray = Array.isArray(remision.payments) ? remision.payments : [];
    
    // Calculamos totales ignorando los rechazados
    const totalConfirmado = paymentsArray.filter(p => p.status === 'confirmado').reduce((sum, p) => sum + p.amount, 0);
    const totalPorConfirmar = paymentsArray.filter(p => p.status === 'por confirmar').reduce((sum, p) => sum + p.amount, 0);
    
    // Saldo Pendiente Real
    const saldoPendiente = remision.valorTotal - totalConfirmado;
    const saldoRealPendiente = remision.valorTotal - totalConfirmado - totalPorConfirmar;
    
    const metodosDePagoHTML = METODOS_DE_PAGO.map(metodo => `<option value="${metodo}">${metodo}</option>`).join('');

    const paymentsHTML = paymentsArray
        .map((p, i) => ({ ...p, originalIndex: i }))
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .map((p) => {
            let statusBadge = ''; let confirmButton = ''; let rejectButton = '';
            
            if (p.status === 'por confirmar') {
                statusBadge = `<span class="text-xs font-semibold bg-yellow-200 text-yellow-800 px-2 py-1 rounded-full">Por Confirmar</span>`;
                if (currentUserData.role === 'admin') {
                    if (p.registeredBy !== currentUser.uid) {
                        confirmButton = `<button data-remision-id="${remision.id}" data-payment-index="${p.originalIndex}" data-action="confirmar" class="action-payment-btn bg-green-500 text-white text-xs px-2 py-1 rounded hover:bg-green-600">Confirmar</button>`;
                        rejectButton = `<button data-remision-id="${remision.id}" data-payment-index="${p.originalIndex}" data-action="rechazar" class="action-payment-btn bg-red-500 text-white text-xs px-2 py-1 rounded hover:bg-red-600 mt-1 sm:mt-0 ml-0 sm:ml-1">Rechazar</button>`;
                    } else {
                        confirmButton = `<button class="bg-gray-400 text-white text-xs px-2 py-1 rounded cursor-not-allowed" disabled title="No puedes confirmar/rechazar tu propio registro.">Pendiente de Admin</button>`;
                    }
                }
            } else if (p.status === 'rechazado') {
                statusBadge = `<span class="text-xs font-semibold bg-red-200 text-red-800 px-2 py-1 rounded-full">Rechazado</span>`;
                // Si está rechazado, tachamos el monto para que sea visualmente claro que no suma
                p.amountHTML = `<span class="line-through text-gray-400">${formatCurrency(p.amount)}</span>`;
            } else { 
                statusBadge = `<span class="text-xs font-semibold bg-green-200 text-green-800 px-2 py-1 rounded-full">Confirmado</span>`; 
            }
            
            return `<tr class="border-b"> 
                        <td class="p-2 text-xs sm:text-sm">${p.date}</td> 
                        <td class="p-2 text-xs sm:text-sm">${p.method}</td> 
                        <td class="p-2 text-right text-xs sm:text-sm">${p.amountHTML || formatCurrency(p.amount)}</td> 
                        <td class="p-2 text-center">${statusBadge}</td> 
                        <td class="p-2 flex flex-col sm:flex-row justify-end">${confirmButton}${rejectButton}</td> 
                    </tr>`;
        }).join('');

    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg p-6 shadow-xl max-w-4xl w-full mx-auto text-left">
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-xl font-semibold">Gestionar Pagos (N° ${remision.numeroRemision})</h2>
                <button id="close-secondary-payment-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 text-center">
                 <div class="bg-indigo-50 p-2 sm:p-3 rounded-lg"><div class="text-xs sm:text-sm text-blue-800 font-semibold">VALOR TOTAL</div><div class="font-bold text-md sm:text-lg">${formatCurrency(remision.valorTotal)}</div></div>
                 <div class="bg-green-50 p-2 sm:p-3 rounded-lg"><div class="text-xs sm:text-sm text-green-800 font-semibold">PAGADO</div><div class="font-bold text-md sm:text-lg">${formatCurrency(totalConfirmado)}</div></div>
                 <div class="bg-yellow-50 p-2 sm:p-3 rounded-lg"><div class="text-xs sm:text-sm text-yellow-800 font-semibold">POR CONFIRMAR</div><div class="font-bold text-md sm:text-lg">${formatCurrency(totalPorConfirmar)}</div></div>
                 <div class="bg-red-50 p-2 sm:p-3 rounded-lg"><div class="text-xs sm:text-sm text-red-800 font-semibold">SALDO PENDIENTE</div><div class="font-bold text-md sm:text-lg">${formatCurrency(saldoPendiente)}</div></div>
            </div>
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                 <div>
                     <h3 class="font-semibold mb-2">Historial de Pagos</h3>
                     <div class="border rounded-lg max-h-60 overflow-y-auto">
                         <table class="w-full text-sm">
                             <thead class="bg-gray-50 sticky top-0"><tr><th class="p-2 text-left">Fecha</th><th class="p-2 text-left">Método</th><th class="p-2 text-right">Monto</th><th class="p-2 text-center">Estado</th><th></th></tr></thead>
                             <tbody>${paymentsHTML || '<tr><td colspan="5" class="p-4 text-center text-gray-500">No hay pagos registrados.</td></tr>'}</tbody>
                         </table>
                     </div>
                 </div>
                 <div>
                     <h3 class="font-semibold mb-2">Registrar Nuevo Pago</h3>
                     ${saldoRealPendiente > 0.01 ? `
                         <form id="add-payment-form" class="space-y-3 bg-gray-50 p-4 rounded-lg border">
                             <div> 
                                <label for="new-payment-amount" class="text-sm font-medium">Monto del Abono</label> 
                                <input type="text" inputmode="numeric" id="new-payment-amount" class="w-full p-2 border rounded-md mt-1" required> 
                                <p class="text-xs text-gray-500 mt-1">Saldo máximo a pagar: <span class="font-bold text-red-500">${formatCurrency(saldoRealPendiente)}</span></p>
                             </div>
                             <div> <label for="new-payment-date" class="text-sm font-medium">Fecha del Pago</label> <input type="date" id="new-payment-date" class="w-full p-2 border rounded-md mt-1" value="${new Date().toISOString().split('T')[0]}" required> </div>
                             <div> <label for="new-payment-method" class="text-sm font-medium">Método de Pago</label> <select id="new-payment-method" class="w-full p-2 border rounded-md mt-1 bg-white" required>${metodosDePagoHTML}</select> </div>
                             <button type="submit" class="w-full bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-indigo-700 shadow mt-2">Registrar Pago</button>
                         </form>
                     ` : `<div class="bg-green-100 text-green-800 p-4 rounded-lg text-center font-semibold border border-green-200">Esta remisión ya está completamente pagada o en proceso de confirmación total.</div>`}
                 </div>
             </div>
         </div>
     `;
     modal.classList.remove('hidden');
      modalContentWrapper.querySelector('#close-secondary-payment-modal').addEventListener('click', () => {
          activePaymentModalRemisionId = null;
          modal.classList.add('hidden');
          modalContentWrapper.innerHTML = '';
      });

     // Lógica de Confirmar o Rechazar
     modalContentWrapper.querySelectorAll('.action-payment-btn').forEach(btn => {
         btn.addEventListener('click', async (e) => {
             const remisionId = e.currentTarget.dataset.remisionId;
             const paymentIndex = parseInt(e.currentTarget.dataset.paymentIndex);
             const action = e.currentTarget.dataset.action; // 'confirmar' o 'rechazar'
             if (paymentIndex < 0 || isNaN(paymentIndex)) return;

             if (action === 'rechazar') {
                 if (!confirm("¿Estás seguro de RECHAZAR este pago? No se sumará al saldo.")) return;
             }

             showModalMessage(`Procesando ${action}...`, true);
             let updatedPayments = [];
             try {
                 await runTransaction(db, async (transaction) => {
                     const remisionRef = doc(db, "remisiones", remisionId);
                     const remisionDoc = await transaction.get(remisionRef);
                     updatedPayments = Array.isArray(remisionDoc.data().payments) ? remisionDoc.data().payments : [];
                     
                     if (updatedPayments[paymentIndex].registeredBy === currentUser.uid) {
                         throw "Error de Seguridad: No puedes confirmar/rechazar tu propio pago.";
                     }
                     
                     updatedPayments[paymentIndex].status = action === 'confirmar' ? 'confirmado' : 'rechazado';
                     updatedPayments[paymentIndex].confirmedBy = currentUser.uid;
                     updatedPayments[paymentIndex].confirmedAt = Date.now();
                     
                     transaction.update(remisionRef, { payments: updatedPayments, _lastUpdated: serverTimestamp() });
                 });

                 remision.payments = updatedPayments;
                 
                 const updatedRem = { ...remision, _lastUpdated: Date.now() };
                 updateLocalCache(updatedRem);

                 document.getElementById('modal-content').innerHTML = ''; 
                 document.getElementById('modal').classList.add('hidden'); 
                 
                 showTemporaryMessage(`¡Pago ${action === 'confirmar' ? 'confirmado' : 'rechazado'}!`, action === 'confirmar' ? "success" : "info");
                 showPaymentModal(updatedRem);

                 if (document.getElementById('close-pending-payments-modal')) {
                     showPendingPaymentsModal(); // Actualiza la lista global trasera si está abierta
                 }

             } catch (error) {
                 document.getElementById('modal').classList.add('hidden'); 
                 showModalMessage(typeof error === 'string' ? error : `Error al ${action} el pago.`);
             }
         });
     });

     if (saldoRealPendiente > 0.01) {
         const paymentAmountInput = modalContentWrapper.querySelector('#new-payment-amount');
         paymentAmountInput.addEventListener('focus', (e) => unformatCurrencyInput(e.target));
         paymentAmountInput.addEventListener('blur', (e) => formatCurrencyInput(e.target));

         modalContentWrapper.querySelector('#add-payment-form').addEventListener('submit', async (e) => {
             e.preventDefault();
             const submitBtn = e.target.querySelector('button[type="submit"]');
             if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Procesando..."; }

             const amount = unformatCurrency(paymentAmountInput.value);
             
             // VALIDACIÓN ESTRICTA DE SALDO
             if (amount <= 0 || isNaN(amount)) {
                 if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Registrar Pago"; }
                 return showModalMessage("El monto debe ser mayor a cero.");
             }
             if (amount > (saldoRealPendiente + 1)) { // Margen de 1 peso por posibles redondeos decimales
                 if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Registrar Pago"; }
                 return showModalMessage(`No puedes registrar un abono mayor al saldo pendiente de ${formatCurrency(saldoRealPendiente)}.`);
             }

             const newPayment = { amount, date: modalContentWrapper.querySelector('#new-payment-date').value, method: modalContentWrapper.querySelector('#new-payment-method').value, registeredAt: Date.now(), registeredBy: currentUser.uid, status: 'por confirmar' };

             showModalMessage("Registrando pago...", true);
             try {
                 await updateDoc(doc(db, "remisiones", remision.id), { payments: arrayUnion(newPayment), _lastUpdated: serverTimestamp() });
                 
                 if (!Array.isArray(remision.payments)) remision.payments = [];
                 remision.payments.push(newPayment);
                 
                 const updatedRem = { ...remision, _lastUpdated: Date.now() };
                 updateLocalCache(updatedRem);

                 hideModal(); showTemporaryMessage("¡Pago registrado! Pendiente de confirmación.", "success");
                 showPaymentModal(updatedRem);
             } catch (error) {
                 hideModal(); showModalMessage("Error al registrar el pago.");
             }
         });
     }
}

function showDiscountModal(remision) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg p-6 shadow-xl max-w-sm w-full mx-auto text-left">
            <div class="flex justify-between items-center mb-4"><h2 class="text-xl font-semibold">Aplicar Descuento</h2><button id="close-discount-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button></div>
            <p class="text-sm text-gray-600 mb-2">Remisión N°: <span class="font-bold">${remision.numeroRemision}</span></p>
            <p class="text-sm text-gray-600 mb-4">Subtotal: <span class="font-bold">${formatCurrency(remision.subtotal)}</span></p>
            <form id="discount-form" class="space-y-4">
                <div><label class="block text-sm font-medium">Valor del Descuento (COP)</label><input type="text" id="discount-amount" class="w-full p-2 border rounded-lg mt-1" inputmode="numeric" required></div>
                <button type="submit" class="w-full bg-cyan-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-cyan-700">Aplicar Descuento</button>
            </form>
        </div>
    `;
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-discount-modal').addEventListener('click', hideModal);

    const amountInput = document.getElementById('discount-amount');
    amountInput.addEventListener('focus', (e) => unformatCurrencyInput(e.target));
    amountInput.addEventListener('blur', (e) => formatCurrencyInput(e.target));

    document.getElementById('discount-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const discountAmount = unformatCurrency(amountInput.value);
        if (isNaN(discountAmount) || discountAmount <= 0) return showModalMessage("Por favor, ingresa un valor válido.");

        showModalMessage("Aplicando descuento...", true);
        try {
            const applyDiscountFn = httpsCallable(functions, 'applyDiscount');
            const result = await applyDiscountFn({ remisionId: remision.id, discountPercentage: (discountAmount / remision.subtotal) * 100 });
            
            if (result.data.success) { 
                const updatedDoc = await getDoc(doc(db, "remisiones", remision.id));
                const updatedData = updatedDoc.data();
                updateLocalCache({id: updatedDoc.id, ...updatedData});

                if (updatedData.pdfPath) invalidateFileCache(updatedData.pdfPath);
                if (updatedData.pdfPlantaPath) invalidateFileCache(updatedData.pdfPlantaPath);

                hideModal(); showModalMessage("¡Descuento aplicado con éxito!", false, 2000); 
            }
            else throw new Error(result.data.message || 'Error desconocido');
        } catch (error) { showModalMessage(`Error: ${error.message}`); }
    });
}

export function showRetentionModal(remision) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    const currentRetention = remision.retention ? remision.retention.amount : 0;
    
    const paymentsArray = Array.isArray(remision.payments) ? remision.payments : [];
    const totalPagadoConfirmado = paymentsArray.filter(p => p.status === 'confirmado').reduce((sum, p) => sum + p.amount, 0);
    const saldoPendiente = remision.valorTotal - totalPagadoConfirmado;

    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg p-6 shadow-xl max-w-sm w-full mx-auto text-left">
            <div class="flex justify-between items-center mb-4"><h2 class="text-xl font-semibold">Aplicar Retenciones</h2><button id="close-retention-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button></div>
            <p class="text-sm text-gray-600 mb-1">Remisión N°: <span class="font-bold">${remision.numeroRemision}</span></p>
            <p class="text-sm text-gray-600 mb-1">Total Actual: <span class="font-bold">${formatCurrency(remision.valorTotal)}</span></p>
            <p class="text-sm text-gray-650 mb-4">Saldo Pendiente: <span class="font-bold text-red-600">${formatCurrency(saldoPendiente)}</span></p>
            <form id="retention-form" class="space-y-4">
                <div><label class="block text-sm font-medium">Valor Retención (COP)</label><input type="text" id="retention-amount" class="w-full p-2 border rounded-lg mt-1" inputmode="numeric" required value="${currentRetention > 0 ? formatCurrency(currentRetention) : ''}"></div>
                <button type="submit" class="w-full bg-amber-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-amber-700">Aplicar Retención</button>
            </form>
        </div>
    `;
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-retention-modal').addEventListener('click', hideModal);

    const amountInput = document.getElementById('retention-amount');
    amountInput.addEventListener('focus', (e) => unformatCurrencyInput(e.target));
    amountInput.addEventListener('blur', (e) => formatCurrencyInput(e.target));

    document.getElementById('retention-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const retentionAmount = unformatCurrency(amountInput.value);
        if (isNaN(retentionAmount) || retentionAmount < 0) return showModalMessage("Ingresa un valor válido.");
        if (retentionAmount > saldoPendiente) {
            return showModalMessage(`La retención no puede exceder el saldo pendiente de ${formatCurrency(saldoPendiente)}.`);
        }

        showModalMessage("Aplicando retención...", true);
        try {
            const applyRetentionFn = httpsCallable(functions, 'applyRetention');
            await applyRetentionFn({ remisionId: remision.id, retentionAmount: retentionAmount, amount: retentionAmount });

            const updatedDoc = await getDoc(doc(db, "remisiones", remision.id));
            updateLocalCache({id: updatedDoc.id, ...updatedDoc.data()});

            hideModal(); showTemporaryMessage("¡Retención aplicada con éxito!", "success");
        } catch (error) { showModalMessage(`Error: ${error.message}`); }
    });
}

// --- FUNCIONALIDAD: PAGOS POR CONFIRMAR GLOBALES ---

function updatePendingPaymentsBadge() {
    const btn = document.getElementById('btn-pending-payments');
    const badge = document.getElementById('badge-pending-payments');
    if (!btn || !badge) return;

    let pendingCount = 0;
    allRemisiones.forEach(r => {
        if (r.estado !== 'Anulada' && Array.isArray(r.payments)) {
            pendingCount += r.payments.filter(p => p.status === 'por confirmar').length;
        }
    });

    if (pendingCount > 0 && currentUserData?.role === 'admin') {
        badge.textContent = pendingCount;
        btn.classList.remove('hidden');
    } else {
        btn.classList.add('hidden');
    }
}

function showPendingPaymentsModal() {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');

    let pendingPayments = [];
    allRemisiones.forEach(r => {
        if (r.estado !== 'Anulada' && Array.isArray(r.payments)) {
            r.payments.forEach((p, index) => {
                if (p.status === 'por confirmar') {
                    pendingPayments.push({
                        remision: r,
                        paymentIndex: index,
                        ...p
                    });
                }
            });
        }
    });

    pendingPayments.sort((a, b) => new Date(a.date) - new Date(b.date));

    let html = '';
    if (pendingPayments.length === 0) {
        html = '<p class="text-center text-gray-500 py-6">¡Todo al día! No hay pagos pendientes de confirmación.</p>';
    } else {
        html = pendingPayments.map(p => {
            const isMe = p.registeredBy === currentUser.uid;
            const canVerify = currentUserData?.role === 'admin';
            const registradoPorNombre = allUsers.find(u => u.id === p.registeredBy)?.nombre || 'Desconocido';
            
            return `
            <div class="border p-4 rounded-lg flex flex-col sm:flex-row justify-between sm:items-center gap-4 bg-gray-50 mb-3 shadow-sm">
                <div>
                    <p class="font-bold text-gray-800 text-lg">${p.remision.clienteNombre}</p>
                    <p class="text-sm text-gray-600">Remisión N°: <span class="font-semibold">${p.remision.numeroRemision}</span></p>
                    <p class="text-xs text-gray-500 mt-1">Registrado por: ${registradoPorNombre}</p>
                    <p class="text-xs text-gray-500">Fecha de registro: ${p.registeredAt ? new Date(p.registeredAt).toLocaleDateString() : 'N/A'}</p>
                </div>
                <div class="flex flex-col sm:items-end text-left sm:text-right">
                    <p class="text-sm text-gray-600 font-semibold">${p.method} | ${p.date}</p>
                    <p class="font-bold text-xl text-indigo-700 mb-2">${formatCurrency(p.amount)}</p>
                    <div class="flex gap-2">
                        <button data-remision-id="${p.remision.id}" 
                            class="verify-global-payment-btn bg-indigo-500 text-white text-xs px-4 py-2 rounded-lg font-semibold hover:bg-indigo-600 transition shadow ${!canVerify ? 'opacity-50 cursor-not-allowed' : ''}" 
                            ${!canVerify ? 'disabled' : ''}>
                            Ver Detalles
                        </button>
                        <button data-remision-id="${p.remision.id}" data-payment-index="${p.paymentIndex}"
                            class="reject-global-payment-btn bg-red-500 text-white text-xs px-4 py-2 rounded-lg font-semibold hover:bg-red-600 transition shadow ${(!canVerify || isMe) ? 'hidden' : ''}">
                            Rechazar
                        </button>
                    </div>
                </div>
            </div>
            `;
        }).join('');
    }

    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg shadow-xl w-11/12 max-w-3xl mx-auto flex flex-col" style="max-height: 85vh;">
            <div class="flex justify-between items-center p-4 border-b">
                <h2 class="text-xl font-semibold text-yellow-600 flex items-center gap-2">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1m-4.5 9h11a2 2 0 002-2v-1a2 2 0 00-2-2h-1.5M7.5 17H4a2 2 0 01-2-2v-1a2 2 0 012-2h1.5"></path></svg>
                    Pagos Pendientes de Confirmar
                </h2>
                <button id="close-pending-payments-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <div class="p-4 overflow-y-auto bg-gray-100">
                ${html}
            </div>
        </div>
    `;

    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-pending-payments-modal').addEventListener('click', hideModal);

    // Lógica para Abrir Modal
    document.querySelectorAll('.verify-global-payment-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const remisionId = e.currentTarget.dataset.remisionId;
            const remisionData = allRemisiones.find(r => r.id === remisionId);
            if(remisionData) showPaymentModal(remisionData);
        });
    });

    // Lógica para Rechazo Rápido
    document.querySelectorAll('.reject-global-payment-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            if (!confirm("¿Seguro que deseas rechazar este pago definitivamente?")) return;
            
            const remisionId = e.currentTarget.dataset.remisionId;
            const paymentIndex = parseInt(e.currentTarget.dataset.paymentIndex);
            
            showModalMessage("Rechazando pago...", true);
            let updatedRem;
            try {
                await runTransaction(db, async (transaction) => {
                    const remisionRef = doc(db, "remisiones", remisionId);
                    const remisionDoc = await transaction.get(remisionRef);
                    let payments = Array.isArray(remisionDoc.data().payments) ? remisionDoc.data().payments : [];
                    
                    payments[paymentIndex].status = 'rechazado';
                    payments[paymentIndex].confirmedBy = currentUser.uid;
                    payments[paymentIndex].confirmedAt = Date.now();
                    
                    transaction.update(remisionRef, { payments: payments, _lastUpdated: serverTimestamp() });
                });

                // Forzamos la descarga del documento para que la caché se arregle sola
                const { getDoc } = await import("https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js");
                const remDocNew = await getDoc(doc(db, "remisiones", remisionId));
                updatedRem = { id: remDocNew.id, ...remDocNew.data() };
                updateLocalCache(updatedRem);

                document.getElementById('modal-content').innerHTML = ''; 
                document.getElementById('modal').classList.add('hidden'); 
                showPendingPaymentsModal(); // Recargamos el modal
                
            } catch (error) {
                document.getElementById('modal').classList.add('hidden'); 
                showModalMessage("Error al rechazar el pago.");
            }
        });
    });
}

// --- FUNCIONALIDAD: EXTRAER IVA Y ENVIAR A FACTURAR ---
async function handleEnviarAFacturar(remisionId) {
    const remision = allRemisiones.find(r => r.id === remisionId);
    if (!remision) return;

    if (!confirm(`¿Estás seguro de enviar a facturar la remisión N° ${remision.numeroRemision}? Se le sumará el IVA (19%) al valor total de la remisión.`)) {
        return;
    }

    showModalMessage("Calculando IVA y regenerando PDFs en la nube...", true);
    
    try {
        const toggleIvaFn = httpsCallable(functions, 'toggleFacturacionIVA');
        await toggleIvaFn({ remisionId: remisionId, action: 'extract' });

        // Forzamos actualización local para mayor velocidad
        const { getDoc } = await import("https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js");
        const updatedDoc = await getDoc(doc(db, "remisiones", remisionId));
        const updatedData = updatedDoc.data();
        updateLocalCache({ id: updatedDoc.id, ...updatedData });

        if (updatedData.pdfPath) invalidateFileCache(updatedData.pdfPath);
        if (updatedData.pdfPlantaPath) invalidateFileCache(updatedData.pdfPlantaPath);

        hideModal();
        showTemporaryMessage("¡Remisión enviada a facturación!", "success");

    } catch (error) {
        console.error("Error al extraer IVA:", error);
        hideModal();
        showModalMessage("Error al procesar la solicitud.");
    }
}

export function setupRemisionesEvents() {
    if (window.__setupRemisionesEventsInit) return;
    window.__setupRemisionesEventsInit = true;

    populateDateFilters('filter-remisiones');
    
    const resetAndRender = () => {
        currentPage = 1;
        renderRemisiones();
    };

    const filterRemMonth = document.getElementById('filter-remisiones-month');
    const filterRemYear = document.getElementById('filter-remisiones-year');
    if (filterRemMonth) filterRemMonth.addEventListener('change', resetAndRender);
    if (filterRemYear) filterRemYear.addEventListener('change', resetAndRender);

    const searchRemisiones = document.getElementById('search-remisiones');
    let debounceTimer;
    if (searchRemisiones) {
        searchRemisiones.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(resetAndRender, 300);
        });
    }

    const btnPendingPayments = document.getElementById('btn-pending-payments');
    if (btnPendingPayments) {
        btnPendingPayments.addEventListener('click', showPendingPaymentsModal);
    }
    
    const clienteSearchInput = document.getElementById('cliente-search-input');
    const clienteSearchResults = document.getElementById('cliente-search-results');
    if (clienteSearchInput && clienteSearchResults) {
        initSearchableInput(
            clienteSearchInput,
            clienteSearchResults,
            () => allClientes,
            (cliente) => cliente.nombreEmpresa ? `${cliente.nombreEmpresa} (${cliente.nombre})` : cliente.nombre,
            (selectedItem) => {
                document.getElementById('cliente-id-hidden').value = selectedItem ? selectedItem.id : '';
            }
        );
    }

    const remisionForm = document.getElementById('remision-form');
    if (remisionForm) {
        remisionForm.addEventListener('submit', handleRemisionSubmit);
        document.getElementById('incluir-iva').addEventListener('input', calcularTotales);

        remisionForm.addEventListener('click', (e) => {
            const target = e.target;
            if (target.id === 'add-item-btn') {
                document.getElementById('items-container').appendChild(createItemElement());
            } else if (target.closest('.remove-item-btn')) {
                target.closest('.item-row').remove();
                calcularTotales();
            } else if (target.classList.contains('tipo-corte-radio')) {
                const itemRow = target.closest('.item-row');
                const completaDiv = itemRow.querySelector('.completa-container');
                const cortadaDiv = itemRow.querySelector('.cortada-container');
                if (target.value === 'completa') {
                    completaDiv.classList.remove('hidden');
                    cortadaDiv.classList.add('hidden');
                } else {
                    completaDiv.classList.add('hidden');
                    cortadaDiv.classList.remove('hidden');
                    if (cortadaDiv.querySelector('.cortes-list').children.length === 0) {
                        cortadaDiv.querySelector('.cortes-list').appendChild(createCutElement());
                    }
                }
                calcularTotales();
            } else if (target.closest('.add-cut-btn')) {
                target.closest('.cortada-container').querySelector('.cortes-list').appendChild(createCutElement());
            } else if (target.closest('.remove-cut-btn')) {
                target.closest('.cut-row').remove();
                calcularTotales();
            }
        });
        
        remisionForm.addEventListener('input', (e) => {
            // Escuchar cambios en los inputs para recalcular en vivo
            if (e.target.classList.contains('item-cantidad') || 
                e.target.classList.contains('item-valor-lamina')) {
                calcularTotales();
            }
        });
    }
}

// --- PUENTE PARA WHATSAPP CRM ---
// Escucha cuando el panel de WhatsApp pide abrir el modal de pagos
document.addEventListener('openWaPaymentModal', (e) => {
    if (e.detail) showPaymentModal(e.detail);
});