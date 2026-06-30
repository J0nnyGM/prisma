// js/modules/facturacion.js

import { db, storage, functions, httpsCallable } from '../firebase-config.js'; 
import { doc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { ref, uploadBytes } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js"; 
import { allRemisiones, allClientes, currentUserData, showModalMessage, hideModal, showTemporaryMessage, invalidateFileCache } from '../app.js';
import { formatCurrency } from '../utils.js';
import { showRetentionModal } from './remisiones.js'; 

// --- VARIABLES DE PAGINACIÓN ---
let currentPagePendientes = 1;
let currentPageRealizadas = 1;
const itemsPerPage = 20;

export function renderFacturacion() {
    const pendientesListEl = document.getElementById('facturacion-pendientes-list');
    const realizadasListEl = document.getElementById('facturacion-realizadas-list');
    const searchInput = document.getElementById('search-facturacion');
    const startDateInput = document.getElementById('factura-filter-start');
    const endDateInput = document.getElementById('factura-filter-end');

    if (!pendientesListEl || !realizadasListEl) return;

    const rawSearch = searchInput ? searchInput.value : '';
    const hasTrailingSpace = rawSearch.endsWith(' ');
    const searchTerm = rawSearch.trim().toLowerCase();
    const startVal = startDateInput ? startDateInput.value : '';
    const endVal = endDateInput ? endDateInput.value : '';

    // 1. Aplicar Filtros Globales a TODA la lista
    let filtered = allRemisiones.filter(r => r.incluyeIVA && r.estado !== 'Anulada');

    if (startVal && endVal) {
        const startDate = new Date(startVal + '-01T00:00:00');
        const [endYear, endMonth] = endVal.split('-').map(Number);
        const endDate = new Date(endYear, endMonth, 0, 23, 59, 59);
        filtered = filtered.filter(r => {
            const rDate = new Date(r.fechaRecibido + 'T00:00:00');
            return rDate >= startDate && rDate <= endDate;
        });
    }

    if (searchTerm) {
        filtered = filtered.filter(r => {
            const clientMatch = r.clienteNombre && r.clienteNombre.toLowerCase().includes(searchTerm);
            const remisionMatch = hasTrailingSpace
                ? (r.numeroRemision && r.numeroRemision.toString() === searchTerm)
                : (r.numeroRemision && r.numeroRemision.toString().includes(searchTerm));
            const facturaMatch = hasTrailingSpace
                ? (r.numeroFactura && r.numeroFactura.toString().toLowerCase() === searchTerm)
                : (r.numeroFactura && r.numeroFactura.toString().toLowerCase().includes(searchTerm));
            return clientMatch || remisionMatch || facturaMatch;
        });
    }

    // 2. Separar en dos arreglos: Pendientes y Realizadas
    const allPendientes = filtered.filter(r => !r.facturado);
    const allRealizadas = filtered.filter(r => r.facturado === true);

    const isAdmin = currentUserData && currentUserData.role === 'admin';

    // ==========================================
    // RENDERIZAR PENDIENTES (Con Paginación)
    // ==========================================
    const totalPendientes = allPendientes.length;
    const totalPagesPendientes = Math.ceil(totalPendientes / itemsPerPage) || 1;
    if (currentPagePendientes > totalPagesPendientes) currentPagePendientes = totalPagesPendientes;
    if (currentPagePendientes < 1) currentPagePendientes = 1;
    
    const startPend = (currentPagePendientes - 1) * itemsPerPage;
    const paginatedPendientes = allPendientes.slice(startPend, startPend + itemsPerPage);

    pendientesListEl.innerHTML = '';
    if (totalPendientes === 0) {
        pendientesListEl.innerHTML = '<div class="bg-gray-50 rounded-lg p-8 text-center border border-gray-200"><p class="text-gray-500 font-medium">No se encontraron remisiones pendientes de facturar en este periodo.</p></div>';
    } else {
        paginatedPendientes.forEach(remision => {
            const el = document.createElement('div');
            el.className = 'premium-card premium-card-blue p-5 flex flex-col lg:flex-row justify-between gap-4 bg-white shadow-sm hover:shadow-md transition';
            
            const clienteDeRemision = allClientes.find(c => c.id === remision.idCliente);
            let botonRUT = '';
            let infoClienteExtra = '';
            
            if (clienteDeRemision) {
                let rutPath = '';
                if (clienteDeRemision.rutUrl) {
                    try {
                        const urlString = clienteDeRemision.rutUrl;
                        const pathStartIndex = urlString.indexOf('/o/');
                        if (pathStartIndex !== -1) {
                            rutPath = decodeURIComponent(urlString.substring(pathStartIndex + 3).split('?')[0]);
                        }
                    } catch (e) {}
                }
                if (rutPath) {
                    botonRUT = `<button data-file-path="${rutPath}" data-file-title="RUT de ${clienteDeRemision.nombre}" class="w-full bg-[#fbf7ff] text-purple-700 border border-purple-200 py-2 px-3 rounded-xl text-xs font-bold hover:bg-purple-100 transition flex items-center justify-center gap-1.5 shadow-sm">
                        📄 RUT
                    </button>`;
                } else {
                    botonRUT = `<button class="w-full bg-[#fbf7ff]/50 text-purple-300 border border-purple-100 py-2 px-3 rounded-xl text-xs font-bold cursor-not-allowed flex items-center justify-center gap-1.5 opacity-60" disabled title="Cliente sin RUT cargado">
                        📄 RUT
                    </button>`;
                }
                infoClienteExtra = `<p class="text-sm text-gray-500 mt-1">${clienteDeRemision.nit ? `NIT: <span class="font-medium">${clienteDeRemision.nit}</span>` : ''}${clienteDeRemision.nit && clienteDeRemision.email ? ' <span class="mx-1">&bull;</span> ' : ''}${clienteDeRemision.email ? `<span class="truncate block sm:inline">${clienteDeRemision.email}</span>` : ''}</p>`;
            } else {
                botonRUT = `<button class="w-full bg-[#fbf7ff]/50 text-purple-300 border border-purple-100 py-2 px-3 rounded-xl text-xs font-bold cursor-not-allowed flex items-center justify-center gap-1.5 opacity-60" disabled>
                    📄 RUT
                </button>`;
            }

            const remisionPdfButton = remision.pdfPath 
                ? `<button data-file-path="${remision.pdfPath}" data-file-title="Remisión N° ${remision.numeroRemision}" class="w-full bg-slate-50 text-slate-700 border border-slate-200 py-2 px-3 rounded-xl text-xs font-bold hover:bg-slate-100 transition flex items-center justify-center gap-1.5 shadow-sm">
                    📋 Remisión PDF
                </button>` 
                : `<button class="w-full bg-slate-50/50 text-slate-300 border border-slate-100 py-2 px-3 rounded-xl text-xs font-bold cursor-not-allowed flex items-center justify-center gap-1.5 opacity-60" disabled title="Generando PDF de la remisión...">
                    📋 Remisión PDF
                </button>`;
            
            let btnRetencion = '';
            if (!remision.retention || !remision.retention.amount) {
                btnRetencion = `<button data-remision-json='${JSON.stringify(remision)}' class="retention-btn w-full bg-amber-50 text-amber-800 border border-amber-200 py-2 px-3 rounded-xl text-xs font-bold hover:bg-amber-100 transition flex items-center justify-center gap-1.5 shadow-sm">
                    💰 Retención
                </button>`;
            } else {
                btnRetencion = `<button class="w-full bg-amber-50/50 text-amber-400 border border-amber-100 py-2 px-3 rounded-xl text-xs font-bold cursor-not-allowed flex items-center justify-center gap-1.5 opacity-60" disabled title="Retención ya aplicada">
                    💰 Retención
                </button>`;
            }

            let btnRevertir = '';
            if (isAdmin) {
                btnRevertir = `<button data-remision-id="${remision.id}" class="no-facturar-btn w-full bg-red-50 text-red-600 border border-red-200 py-2 px-3 rounded-xl text-xs font-bold hover:bg-red-100 transition flex items-center justify-center gap-1.5 shadow-sm">
                    🚫 Quitar IVA
                </button>`;
            } else {
                btnRevertir = `<button class="w-full bg-red-50/50 text-red-300 border border-red-100 py-2 px-3 rounded-xl text-xs font-bold cursor-not-allowed flex items-center justify-center gap-1.5 opacity-60" disabled title="Solo administradores">
                    🚫 Quitar IVA
                </button>`;
            }

            el.innerHTML = `
                <div class="flex-grow w-full lg:w-auto text-left">
                    <div class="flex flex-col sm:flex-row sm:items-center gap-2 mb-2">
                        <span class="inline-block bg-blue-100 text-blue-800 text-xs font-bold px-2 py-1 rounded-md self-start sm:self-auto uppercase tracking-wide">REM-${remision.numeroRemision}</span>
                        <h4 class="font-bold text-lg text-gray-900 leading-tight">${remision.clienteNombre}</h4>
                    </div>
                    ${infoClienteExtra}
                    <div class="mt-3 flex items-center gap-2 bg-gray-50 p-2 rounded-lg border border-gray-100 w-fit">
                        <span class="text-sm text-gray-500">Recibido: ${remision.fechaRecibido}</span>
                        <span class="text-gray-300">|</span>
                        <span class="text-sm text-gray-700">Total a Facturar: <span class="font-extrabold text-blue-700 ml-1">${formatCurrency(remision.valorTotal)}</span></span>
                    </div>
                </div>
                <div class="flex flex-col gap-2 w-full lg:w-72 flex-shrink-0 mt-4 lg:mt-0 lg:ml-4 border-t lg:border-t-0 pt-4 lg:pt-0 border-gray-100">
                    <div class="grid grid-cols-2 gap-2">
                        ${botonRUT}
                        ${remisionPdfButton}
                        ${btnRetencion}
                        ${btnRevertir}
                    </div>
                    <button data-remision-id="${remision.id}" class="facturar-btn facturacion-main-btn bg-blue-600 text-white py-3 px-4 rounded-xl text-xs font-bold hover:bg-blue-700 shadow-sm transition flex items-center justify-center gap-2 w-full">
                        🧾 Facturar
                    </button>
                </div>`;
            pendientesListEl.appendChild(el);
        });

        const pagPendEl = document.createElement('div');
        pagPendEl.className = 'premium-pagination-container flex justify-between items-center mt-6';
        pagPendEl.innerHTML = `
            <span class="text-xs font-medium text-slate-500">Mostrando ${startPend + 1} - ${Math.min(startPend + itemsPerPage, totalPendientes)} de ${totalPendientes} pendientes</span>
            <div class="flex gap-2">
                <button id="prev-pend-btn" class="premium-pagination-btn" ${currentPagePendientes === 1 ? 'disabled' : ''}>&larr; Anterior</button>
                <span class="px-3 py-1 text-xs font-bold text-slate-700 flex items-center bg-slate-50 border rounded-full">Pág ${currentPagePendientes} de ${totalPagesPendientes}</span>
                <button id="next-pend-btn" class="premium-pagination-btn" ${currentPagePendientes === totalPagesPendientes ? 'disabled' : ''}>Siguiente &rarr;</button>
            </div>
        `;
        pendientesListEl.appendChild(pagPendEl);

        const prevPend = document.getElementById('prev-pend-btn');
        const nextPend = document.getElementById('next-pend-btn');
        if(prevPend && currentPagePendientes > 1) prevPend.addEventListener('click', () => { currentPagePendientes--; renderFacturacion(); });
        if(nextPend && currentPagePendientes < totalPagesPendientes) nextPend.addEventListener('click', () => { currentPagePendientes++; renderFacturacion(); });
    }

    // ==========================================
    // RENDERIZAR REALIZADAS (Con Paginación)
    // ==========================================
    const totalRealizadas = allRealizadas.length;
    const totalPagesRealizadas = Math.ceil(totalRealizadas / itemsPerPage) || 1;
    if (currentPageRealizadas > totalPagesRealizadas) currentPageRealizadas = totalPagesRealizadas;
    if (currentPageRealizadas < 1) currentPageRealizadas = 1;
    
    const startReal = (currentPageRealizadas - 1) * itemsPerPage;
    const paginatedRealizadas = allRealizadas.slice(startReal, startReal + itemsPerPage);

    realizadasListEl.innerHTML = '';
    if (totalRealizadas === 0) {
        realizadasListEl.innerHTML = '<div class="bg-gray-50 rounded-lg p-8 text-center border border-gray-200"><p class="text-gray-500 font-medium">No se encontraron remisiones facturadas en este periodo.</p></div>';
    } else {
        paginatedRealizadas.forEach(remision => {
            const el = document.createElement('div');
            el.className = 'premium-card premium-card-teal p-5 flex flex-col lg:flex-row justify-between gap-4 bg-white shadow-sm hover:shadow-md transition';
            
            const clienteDeRemision = allClientes.find(c => c.id === remision.idCliente);
            let infoClienteExtra = '';
            if (clienteDeRemision) {
                infoClienteExtra = `<p class="text-sm text-gray-500 mt-1">${clienteDeRemision.nit ? `NIT: <span class="font-medium">${clienteDeRemision.nit}</span>` : ''}${clienteDeRemision.nit && clienteDeRemision.email ? ' <span class="mx-1">&bull;</span> ' : ''}${clienteDeRemision.email ? `<span class="truncate block sm:inline">${clienteDeRemision.email}</span>` : ''}</p>`;
            }

            const remisionPdfButton = remision.pdfPath 
                ? `<button data-file-path="${remision.pdfPath}" data-file-title="Remisión N° ${remision.numeroRemision}" class="w-full bg-slate-100 text-slate-700 border border-slate-200 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-slate-200 transition flex items-center justify-center gap-1">📋 Remisión PDF</button>` 
                : '';
            
            let facturaButtons = remision.facturaPdfPath
                ? `<button data-file-path="${remision.facturaPdfPath}" data-file-title="Factura N° ${remision.numeroFactura || remision.numeroRemision}" class="w-full bg-teal-50 text-teal-700 border border-teal-200 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-teal-100 transition flex items-center justify-center gap-1">👁️ Ver Factura</button>`
                : `<button data-remision-id="${remision.id}" class="facturar-btn w-full bg-orange-50 text-orange-600 border border-orange-200 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-orange-100 transition flex items-center justify-center gap-1">📎 Adjuntar PDF</button>`;

            let btnRetencion = '';
            if (!remision.retention || !remision.retention.amount) {
                 btnRetencion = `<button data-remision-json='${JSON.stringify(remision)}' class="retention-btn w-full bg-amber-50 text-amber-700 border border-amber-200 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-amber-100 transition flex items-center justify-center gap-1">💰 Retenciones</button>`;
            }

            el.innerHTML = `
                <div class="flex-grow w-full lg:w-auto">
                    <div class="flex flex-col sm:flex-row sm:items-center gap-2 mb-2">
                        <span class="inline-block bg-teal-100 text-teal-800 text-xs font-bold px-2 py-1 rounded-md self-start sm:self-auto uppercase tracking-wide">FACTURADA</span>
                        <h4 class="font-bold text-lg text-gray-900 leading-tight">${remision.clienteNombre}</h4>
                    </div>
                    ${infoClienteExtra}
                    <div class="mt-3 flex flex-wrap items-center gap-2 bg-gray-50 p-2 rounded-lg border border-gray-100 w-fit">
                        <span class="text-sm text-gray-600">Fecha: <span class="font-medium">${remision.fechaRecibido}</span></span>
                        <span class="text-gray-300 hidden sm:inline">|</span>
                        ${remision.numeroFactura ? `<span class="text-sm text-gray-600">Factura N°: <span class="font-bold text-gray-900">${remision.numeroFactura}</span></span><span class="text-gray-300 hidden sm:inline">|</span>` : ''}
                        <span class="text-sm text-gray-700">Total: <span class="font-extrabold text-teal-700 ml-1">${formatCurrency(remision.valorTotal)}</span></span>
                    </div>
                </div>
                <div class="facturacion-btn-container mt-4 lg:mt-0 lg:ml-4 border-t lg:border-t-0 pt-4 lg:pt-0 border-gray-100">
                    <div class="facturacion-secondary-row">
                        ${btnRetencion}
                        ${remisionPdfButton}
                    </div>
                    <div class="facturacion-main-btn">
                        ${facturaButtons}
                    </div>
                </div>`;
            realizadasListEl.appendChild(el);
        });

        const pagRealEl = document.createElement('div');
        pagRealEl.className = 'premium-pagination-container flex justify-between items-center mt-6';
        pagRealEl.innerHTML = `
            <span class="text-xs font-medium text-slate-500">Mostrando ${startReal + 1} - ${Math.min(startReal + itemsPerPage, totalRealizadas)} de ${totalRealizadas} facturadas</span>
            <div class="flex gap-2">
                <button id="prev-real-btn" class="premium-pagination-btn" ${currentPageRealizadas === 1 ? 'disabled' : ''}>&larr; Anterior</button>
                <span class="px-3 py-1 text-xs font-bold text-slate-700 flex items-center bg-slate-50 border rounded-full">Pág ${currentPageRealizadas} de ${totalPagesRealizadas}</span>
                <button id="next-real-btn" class="premium-pagination-btn" ${currentPageRealizadas === totalPagesRealizadas ? 'disabled' : ''}>Siguiente &rarr;</button>
            </div>
        `;
        realizadasListEl.appendChild(pagRealEl);

        const prevReal = document.getElementById('prev-real-btn');
        const nextReal = document.getElementById('next-real-btn');
        if(prevReal && currentPageRealizadas > 1) prevReal.addEventListener('click', () => { currentPageRealizadas--; renderFacturacion(); });
        if(nextReal && currentPageRealizadas < totalPagesRealizadas) nextReal.addEventListener('click', () => { currentPageRealizadas++; renderFacturacion(); });
    }

    // ASIGNAR EVENTOS DESPUÉS DE RENDERIZAR TODO
    document.querySelectorAll('.facturar-btn').forEach(btn => {
        btn.addEventListener('click', (e) => showFacturaModal(e.currentTarget.dataset.remisionId));
    });
    
    document.querySelectorAll('.retention-btn').forEach(btn => {
        btn.addEventListener('click', (e) => showRetentionModal(JSON.parse(e.currentTarget.dataset.remisionJson)));
    });

    document.querySelectorAll('.no-facturar-btn').forEach(btn => {
        btn.addEventListener('click', (e) => handleNoFacturar(e.currentTarget.dataset.remisionId));
    });

    // Precargar los enlaces de PDFs de manera inteligente y secuencial
    if (typeof window.scanAndPrefetchSecureFiles === 'function') {
        window.scanAndPrefetchSecureFiles();
    }
}

export function showFacturaModal(remisionId) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg p-6 shadow-xl max-w-md w-full mx-auto text-left">
            <div class="flex justify-between items-center mb-4"><h2 class="text-xl font-semibold">Registrar Factura</h2><button id="close-factura-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button></div>
            <form id="factura-form" class="space-y-4">
                <div><label class="block text-sm font-medium text-gray-700 mb-1">Número de Factura Oficial</label><input type="text" id="factura-numero" class="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" required placeholder="Ej: FV-1025"></div>
                <div><label class="block text-sm font-medium text-gray-700 mb-1">Adjuntar PDF de la Factura</label><input type="file" id="factura-pdf" class="w-full p-2 border border-gray-300 rounded-lg text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" accept=".pdf" required></div>
                <div class="pt-2">
                    <button type="submit" class="w-full bg-indigo-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-indigo-700 shadow-md transition-colors">Confirmar y Marcar como Facturado</button>
                </div>
            </form>
        </div>
    `;
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-factura-modal').addEventListener('click', hideModal);

    document.getElementById('factura-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const numeroFactura = document.getElementById('factura-numero').value;
        const file = document.getElementById('factura-pdf').files[0];
        if (!file) return showModalMessage("Debes seleccionar un archivo PDF.");

        const submitBtn = e.target.querySelector('button[type="submit"]');
        if(submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Procesando Archivo...'; }

        showModalMessage("Subiendo factura y actualizando base de datos...", true);
        try {
            const storagePath = `facturas/${remisionId}-${file.name}`;
            await uploadBytes(ref(storage, storagePath), file);
            
            // --- CORRECCIÓN CLAVE: serverTimestamp() ---
            await updateDoc(doc(db, "remisiones", remisionId), { 
                facturado: true, 
                numeroFactura: numeroFactura, 
                facturaPdfPath: storagePath, 
                fechaFacturado: new Date().toISOString(),
                _lastUpdated: serverTimestamp() // ESTO DISPARA EL ON-SNAPSHOT
            });

            // --- ACTUALIZACIÓN VISUAL INSTANTÁNEA ---
            const remLocal = allRemisiones.find(r => r.id === remisionId);
            if (remLocal) {
                remLocal.facturado = true;
                remLocal.numeroFactura = numeroFactura;
                remLocal.facturaPdfPath = storagePath;
                remLocal.fechaFacturado = new Date().toISOString();
                renderFacturacion();
            }

            hideModal(); 
            showTemporaryMessage("¡Remisión facturada con éxito!", "success");
        } catch (error) { 
            console.error(error);
            showModalMessage("Error al procesar la factura."); 
        } finally {
            if(submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Confirmar y Marcar como Facturado'; }
        }
    });
}

async function handleNoFacturar(remisionId) {
    if (!confirm(`¿Estás seguro de revertir esta remisión a 'No Facturable'?\nSe eliminará el IVA y el valor total volverá a su valor original sin IVA. Se regenerarán los PDFs de Remisión.`)) return;

    showModalMessage("Revirtiendo valores y regenerando PDFs en la nube...", true);
    
    try {
        const toggleIvaFn = httpsCallable(functions, 'toggleFacturacionIVA');
        await toggleIvaFn({ remisionId: remisionId, action: 'revert' });

        // --- ACTUALIZACIÓN VISUAL INSTANTÁNEA ---
        const remLocal = allRemisiones.find(r => r.id === remisionId);
        if (remLocal) {
            remLocal.incluyeIVA = false;
            if (remLocal.pdfPath) invalidateFileCache(remLocal.pdfPath);
            if (remLocal.pdfPlantaPath) invalidateFileCache(remLocal.pdfPlantaPath);
            renderFacturacion();
        }

        hideModal();
        showTemporaryMessage("¡Remisión retirada de facturación!", "success");

    } catch (error) {
        console.error("Error al revertir facturación:", error);
        hideModal();
        showModalMessage("Error al procesar la solicitud.");
    }
}

export function setupFacturacionEvents() {
    if (window.__setupFacturacionEventsInit) return;
    window.__setupFacturacionEventsInit = true;

    const facturacionPendientesTab = document.getElementById('tab-pendientes');
    const facturacionRealizadasTab = document.getElementById('tab-realizadas');
    const facturacionPendientesView = document.getElementById('view-pendientes');
    const facturacionRealizadasView = document.getElementById('view-realizadas');
    
    if (facturacionPendientesTab && facturacionRealizadasTab) {
        facturacionPendientesTab.addEventListener('click', () => {
            facturacionPendientesTab.classList.add('text-indigo-600', 'border-blue-600');
            facturacionPendientesTab.classList.remove('text-gray-500', 'border-transparent');
            
            facturacionRealizadasTab.classList.remove('text-indigo-600', 'border-blue-600');
            facturacionRealizadasTab.classList.add('text-gray-500', 'border-transparent');
            
            facturacionPendientesView.classList.remove('hidden');
            facturacionRealizadasView.classList.add('hidden');
        });
        
        facturacionRealizadasTab.addEventListener('click', () => {
            facturacionRealizadasTab.classList.add('text-indigo-600', 'border-blue-600');
            facturacionRealizadasTab.classList.remove('text-gray-500', 'border-transparent');
            
            facturacionPendientesTab.classList.remove('text-indigo-600', 'border-blue-600');
            facturacionPendientesTab.classList.add('text-gray-500', 'border-transparent');
            
            facturacionRealizadasView.classList.remove('hidden');
            facturacionPendientesView.classList.add('hidden');
        });

        facturacionPendientesTab.classList.add('text-indigo-600', 'border-blue-600');
        facturacionPendientesTab.classList.remove('text-gray-500', 'border-transparent');
    }

    const searchFactura = document.getElementById('search-facturacion');
    const filterFactStart = document.getElementById('factura-filter-start');
    const filterFactEnd = document.getElementById('factura-filter-end');

    if (filterFactStart && filterFactEnd && searchFactura) {
        const now = new Date();
        const currentMonthStr = now.toISOString().slice(0, 7); 
        filterFactStart.value = currentMonthStr;
        filterFactEnd.value = currentMonthStr;

        const resetAndRender = () => {
            currentPagePendientes = 1;
            currentPageRealizadas = 1;
            renderFacturacion();
        };

        let debounceTimer;
        searchFactura.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(resetAndRender, 300);
        });

        filterFactStart.addEventListener('change', resetAndRender);
        filterFactEnd.addEventListener('change', resetAndRender);
    }
}