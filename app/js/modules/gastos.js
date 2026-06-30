// js/modules/gastos.js

import { db, functions } from '../firebase-config.js';
import { collection, addDoc, updateDoc, doc, query, getDocs, where, serverTimestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { 
    allGastos, setAllGastos, currentUser, currentUserData, allUsers,
    showModalMessage, hideModal, showTemporaryMessage,
    populateDateFilters, initSearchableInput, allProveedores 
} from '../app.js';
import { formatCurrency, unformatCurrency } from '../utils.js';

// --- CONFIGURACIÓN DE CACHÉ Y PAGINACIÓN ---
const CACHE_KEY = 'gastos_cache';
const SYNC_KEY = 'gastos_last_sync';

let currentPage = 1;
const itemsPerPage = 20;

// --- CARGA DE DATOS (TIEMPO REAL + BORRADO LÓGICO) ---
export function loadGastos() {
    const cachedData = localStorage.getItem(CACHE_KEY);
    
    let mapGastos = new Map();
    let maxLastUpdated = 0; 

    if (cachedData) {
        try {
            const parsedData = JSON.parse(cachedData);
            parsedData.forEach(g => {
                mapGastos.set(g.id, g);
                if (g._lastUpdated && g._lastUpdated > maxLastUpdated) {
                    maxLastUpdated = g._lastUpdated;
                }
            });
            setAllGastos(Array.from(mapGastos.values()));
            renderGastos();
        } catch (e) {
            console.warn("Caché de gastos corrupto. Se limpiará.");
            localStorage.removeItem(CACHE_KEY);
            localStorage.removeItem(SYNC_KEY);
        }
    }

    const colRef = collection(db, "gastos");
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
            const document = change.doc;
            const data = document.data();

            if (data._lastUpdated && typeof data._lastUpdated.toMillis === 'function') data._lastUpdated = data._lastUpdated.toMillis();
            if (data.timestamp && typeof data.timestamp.toMillis === 'function') data.timestamp = data.timestamp.toMillis();
            
            if (change.type === "added" || change.type === "modified") {
                if (data.estado === 'eliminado') {
                    mapGastos.delete(document.id);
                } else {
                    mapGastos.set(document.id, { id: document.id, ...data });
                }
                huboCambios = true;
            }
            if (change.type === "removed") {
                mapGastos.delete(document.id);
                huboCambios = true;
            }
        });

        if (huboCambios) {
            const finalArray = Array.from(mapGastos.values());
            finalArray.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
            
            localStorage.setItem(CACHE_KEY, JSON.stringify(finalArray));
            setAllGastos(finalArray);
            
            renderGastos();
            
            document.dispatchEvent(new CustomEvent('gastosChanged'));
        }
    }, (error) => {
        console.error("Error en onSnapshot diferencial de gastos:", error);
    });

    return unsubscribe;
}

// --- RENDERIZADO CON PAGINACIÓN Y FILTROS ---
export function renderGastos() {
    const gastosListEl = document.getElementById('gastos-list');
    if (!gastosListEl) return;

    const month = document.getElementById('filter-gastos-month').value;
    const year = document.getElementById('filter-gastos-year').value;
    const searchInput = document.getElementById('search-gastos');
    const rawSearch = searchInput ? searchInput.value : '';
    const hasTrailingSpace = rawSearch.endsWith(' ');
    const searchTerm = rawSearch.trim().toLowerCase();

    let filtered = allGastos;

    if (year !== 'all') {
        filtered = filtered.filter(g => new Date(g.fecha).getFullYear() == year);
    }
    if (month !== 'all') {
        filtered = filtered.filter(g => new Date(g.fecha).getMonth() == month);
    }
    if (searchTerm) {
        filtered = filtered.filter(g => {
            const proveedorMatch = g.proveedorNombre && g.proveedorNombre.toLowerCase().includes(searchTerm);
            const facturaMatch = hasTrailingSpace
                ? (g.numeroFactura && g.numeroFactura.toLowerCase() === searchTerm)
                : (g.numeroFactura && g.numeroFactura.toLowerCase().includes(searchTerm));
            return proveedorMatch || facturaMatch;
        });
    }

    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;

    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const paginatedGastos = filtered.slice(startIndex, endIndex);

    gastosListEl.innerHTML = '';
    if (totalItems === 0) {
        gastosListEl.innerHTML = '<p class="text-center text-gray-500 py-8">No hay gastos registrados en este periodo.</p>';
        return;
    }

    const isAdmin = currentUserData && currentUserData.role === 'admin';

    paginatedGastos.forEach((gasto) => {
        const el = document.createElement('div');
        el.className = 'premium-card premium-card-orange p-5 flex flex-col sm:flex-row justify-between sm:items-center gap-4 bg-white shadow-sm hover:shadow-md transition';
        
        const nameInitial = (gasto.proveedorNombre || 'G').charAt(0).toUpperCase();
        let deleteBtnHTML = '';
        if (isAdmin && !gasto.isEmployeePayment && !gasto.isTransfer && !gasto.isImportacionGasto) {
            deleteBtnHTML = `<button data-gasto-id="${gasto.id}" class="delete-gasto-btn bg-red-50 text-red-600 w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold hover:bg-red-100 hover:text-red-700 transition border border-red-200 shadow-sm" title="Eliminar Gasto">✕</button>`;
        }

        let badgeFactura = gasto.numeroFactura 
            ? `<span class="bg-orange-50 text-orange-700 text-[10px] font-bold px-2 py-0.5 rounded border border-orange-100 font-mono">Factura: ${gasto.numeroFactura}</span>`
            : '';

        el.innerHTML = `
            <div class="flex items-center gap-4 flex-grow min-w-0">
                <div class="premium-avatar premium-avatar-orange flex-shrink-0">${nameInitial}</div>
                <div class="flex-grow min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                        <p class="font-bold text-base text-slate-900 truncate" title="${gasto.proveedorNombre}">${gasto.proveedorNombre}</p>
                        ${badgeFactura}
                    </div>
                    <p class="text-xs text-slate-500 mt-1">Fecha: ${gasto.fecha}</p>
                </div>
            </div>
            
            <div class="flex items-center justify-between sm:justify-end gap-4 flex-shrink-0 w-full sm:w-auto mt-2 sm:mt-0">
                <div class="text-left sm:text-right">
                    <p class="font-extrabold text-lg text-red-600 leading-none">-${formatCurrency(gasto.valorTotal)}</p>
                    <p class="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-1">${gasto.fuentePago}</p>
                </div>
                ${deleteBtnHTML}
            </div>
        `;
        gastosListEl.appendChild(el);
    });

    const paginationEl = document.createElement('div');
    paginationEl.className = 'premium-pagination-container flex justify-between items-center mt-6';
    paginationEl.innerHTML = `
        <span class="text-xs font-medium text-slate-500">Mostrando ${startIndex + 1} - ${Math.min(endIndex, totalItems)} de ${totalItems} gastos</span>
        <div class="flex gap-2">
            <button id="prev-page-gastos-btn" class="premium-pagination-btn" ${currentPage === 1 ? 'disabled' : ''}>&larr; Anterior</button>
            <span class="px-3 py-1 text-xs font-bold text-slate-700 flex items-center bg-slate-50 border rounded-full">Pág ${currentPage} de ${totalPages}</span>
            <button id="next-page-gastos-btn" class="premium-pagination-btn" ${currentPage === totalPages ? 'disabled' : ''}>Siguiente &rarr;</button>
        </div>
    `;
    gastosListEl.appendChild(paginationEl);

    // Eventos Paginación
    const prevBtn = document.getElementById('prev-page-gastos-btn');
    const nextBtn = document.getElementById('next-page-gastos-btn');
    if (prevBtn && currentPage > 1) prevBtn.onclick = () => { currentPage--; renderGastos(); };
    if (nextBtn && currentPage < totalPages) nextBtn.onclick = () => { currentPage++; renderGastos(); };

    // --- EVENTO DE BORRADO LÓGICO ---
    document.querySelectorAll('.delete-gasto-btn').forEach(btn => {
        btn.onclick = async (e) => {
            if (!confirm("¿Seguro que deseas eliminar este gasto de forma permanente? El dinero se devolverá al saldo de la cuenta.")) return;
            
            const gastoId = e.currentTarget.dataset.gastoId;
            showModalMessage("Eliminando gasto...", true);
            
            try {
                await updateDoc(doc(db, "gastos", gastoId), {
                    estado: 'eliminado',
                    deletedAt: Date.now(), 
                    deletedBy: currentUser.uid,
                    _lastUpdated: serverTimestamp()
                });
                hideModal();
                showTemporaryMessage("Gasto eliminado con éxito", "success");
            } catch (error) {
                console.error("Error al eliminar gasto:", error);
                hideModal();
                showModalMessage("Error al eliminar el gasto.");
            }
        };
    });
}

// --- FUNCIONALIDAD: PAPELERA DE GASTOS ---
async function showDeletedGastosModal() {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    
    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg shadow-xl w-full max-w-4xl mx-auto flex flex-col" style="max-height: 85vh;">
            <div class="flex justify-between items-center p-4 border-b">
                <h2 class="text-xl font-semibold text-red-600 flex items-center gap-2">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    Historial de Gastos Eliminados
                </h2>
                <button id="close-deleted-gastos-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <div class="bg-yellow-50 text-yellow-800 p-3 text-sm text-center border-b">
                Estos gastos han sido eliminados del sistema y sus montos devueltos a los saldos principales.
            </div>
            <div class="p-4 overflow-y-auto bg-gray-50 flex-grow" id="deleted-gastos-list">
                <p class="text-center text-gray-500 py-8">Cargando papelera...</p>
            </div>
        </div>
    `;
    
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-deleted-gastos-modal').onclick = hideModal;

    try {
        const q = query(collection(db, "gastos"), where("estado", "==", "eliminado"));
        const snapshot = await getDocs(q);
        
        let deletedGastos = [];
        snapshot.forEach(doc => {
            deletedGastos.push({ id: doc.id, ...doc.data() });
        });

        deletedGastos.sort((a, b) => {
            const dateA = a.deletedAt || 0;
            const dateB = b.deletedAt || 0;
            return dateB - dateA;
        });

        const listContainer = document.getElementById('deleted-gastos-list');
        
        if (deletedGastos.length === 0) {
            listContainer.innerHTML = '<p class="text-center text-gray-500 py-8">La papelera está vacía.</p>';
            return;
        }

        let html = '';
        deletedGastos.forEach(gasto => {
            const deletedByName = allUsers.find(u => u.id === gasto.deletedBy)?.nombre || 'Usuario Desconocido';
            const deletedDateStr = gasto.deletedAt ? new Date(gasto.deletedAt).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : 'Fecha desconocida';

            html += `
                <div class="bg-white p-4 rounded-lg shadow-sm border border-red-200 mb-3 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 opacity-80 hover:opacity-100 transition">
                    <div>
                        <p class="font-bold text-gray-800 line-through decoration-red-500">${gasto.proveedorNombre}</p>
                        <p class="text-sm text-gray-600">Fecha Original: ${gasto.fecha} ${gasto.numeroFactura ? `| Factura: ${gasto.numeroFactura}` : ''}</p>
                        <div class="mt-2 text-xs bg-red-50 text-red-700 p-2 rounded-md border border-red-100 inline-block">
                            <span class="font-bold">Eliminado por:</span> ${deletedByName}<br>
                            <span class="font-bold">El:</span> ${deletedDateStr}
                        </div>
                    </div>
                    <div class="text-left sm:text-right">
                        <p class="font-bold text-xl text-gray-500 line-through decoration-red-500">${formatCurrency(gasto.valorTotal)}</p>
                        <p class="text-xs text-gray-400 uppercase tracking-wider">${gasto.fuentePago}</p>
                    </div>
                </div>
            `;
        });
        listContainer.innerHTML = html;

    } catch (error) {
        console.error("Error cargando la papelera:", error);
        document.getElementById('deleted-gastos-list').innerHTML = '<p class="text-center text-red-500 py-8">Error al cargar la papelera. Revisa tu conexión.</p>';
    }
}

// --- SETUP EVENTOS PRINCIPALES (PROTEGIDO CONTRA DUPLICADOS) ---
export function setupGastosEvents() {
    if (window.__setupGastosEventsInit) return;
    window.__setupGastosEventsInit = true;

    populateDateFilters('filter-gastos');

    const resetAndRender = () => {
        currentPage = 1;
        renderGastos();
    };

    // Usamos .onchange en vez de addEventListener para evitar apilamiento
    const filterGastosMonth = document.getElementById('filter-gastos-month');
    const filterGastosYear = document.getElementById('filter-gastos-year');
    if (filterGastosMonth) filterGastosMonth.onchange = resetAndRender;
    if (filterGastosYear) filterGastosYear.onchange = resetAndRender;

    const searchGastos = document.getElementById('search-gastos');
    let debounceTimer;
    if (searchGastos) {
        searchGastos.oninput = () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(resetAndRender, 300);
        };
    }

    const proveedorSearchInput = document.getElementById('proveedor-search-input');
    const proveedorSearchResults = document.getElementById('proveedor-search-results');
    if (proveedorSearchInput && proveedorSearchResults) {
        initSearchableInput(
            proveedorSearchInput,
            proveedorSearchResults,
            () => allProveedores,
            (proveedor) => proveedor.nombre,
            (selectedItem) => {
                document.getElementById('proveedor-id-hidden').value = selectedItem ? selectedItem.id : '';
            }
        );
    }

    // BOTÓN SYNC
    const syncGastosBtn = document.getElementById('sync-gastos-btn');
    if (syncGastosBtn) {
        syncGastosBtn.onclick = () => {
            const modalContentWrapper = document.getElementById('modal-content-wrapper');
            modalContentWrapper.innerHTML = `
                <div class="bg-white rounded-lg p-6 shadow-xl max-w-md w-full mx-auto text-left">
                    <div class="flex justify-between items-center mb-4">
                        <h2 class="text-xl font-semibold text-orange-600 flex items-center gap-2">
                            ⚠️ Sincronización Forzada
                        </h2>
                        <button id="close-sync-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
                    </div>
                    <div class="bg-orange-50 text-orange-800 p-3 rounded-md text-sm mb-4">
                        <strong>Atención:</strong> Esta acción borrará el caché y descargará todos los gastos nuevamente desde el servidor. Solo debe usarse si los datos en pantalla presentan errores.
                    </div>
                    <form id="sync-reason-form" class="space-y-4">
                        <div>
                            <label class="block text-sm font-medium">Motivo de la sincronización:</label>
                            <textarea id="sync-reason" class="w-full p-2 border rounded-lg mt-1" rows="3" placeholder="Ej: No veo un gasto que acaban de registrar en otro computador..." required minlength="10"></textarea>
                        </div>
                        <button type="submit" class="w-full bg-orange-600 text-white font-bold py-2 rounded-lg hover:bg-orange-700 shadow">Confirmar Sincronización</button>
                    </form>
                </div>
            `;
            document.getElementById('modal').classList.remove('hidden');
            document.getElementById('close-sync-modal').onclick = hideModal;

            document.getElementById('sync-reason-form').onsubmit = async (e) => {
                e.preventDefault();
                const reason = document.getElementById('sync-reason').value;
                const submitBtn = e.target.querySelector('button[type="submit"]');
                submitBtn.disabled = true;
                submitBtn.textContent = 'Procesando...';

                try {
                    await addDoc(collection(db, "syncLogs"), {
                        module: 'gastos',
                        reason: reason,
                        userId: currentUser.uid,
                        userName: currentUserData.nombre || 'Desconocido',
                        timestamp: serverTimestamp()
                    });

                    localStorage.removeItem(CACHE_KEY);
                    localStorage.removeItem(SYNC_KEY);
                    showModalMessage("Sincronizando base de datos completa...", true);
                    setTimeout(() => window.location.reload(), 1000);
                } catch (error) {
                    console.error("Error al guardar log de sync:", error);
                    showModalMessage("Error de conexión. Intenta de nuevo.");
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Confirmar Sincronización';
                }
            };
        };
    }

    // BOTÓN PAPELERA
    const viewDeletedBtn = document.getElementById('view-deleted-gastos-btn');
    if (viewDeletedBtn) {
        viewDeletedBtn.onclick = showDeletedGastosModal;
    }

    // FORMULARIO: CREAR NUEVO GASTO (Usamos onsubmit para evitar duplicados)
    const addGastoForm = document.getElementById('add-gasto-form');
    if (addGastoForm) {
        addGastoForm.onsubmit = async (e) => {
            e.preventDefault();
            const valorTotal = unformatCurrency(document.getElementById('gasto-valor-total').value);
            const ivaIncluido = document.getElementById('gasto-iva').checked;
            const valorBase = ivaIncluido ? valorTotal / 1.19 : valorTotal;
            const proveedorId = document.getElementById('proveedor-id-hidden').value;
            const proveedorNombre = document.getElementById('proveedor-search-input').value;

            if (!proveedorId) return showModalMessage("Por favor, selecciona un proveedor de la lista.");

            const submitBtn = e.target.querySelector('button[type="submit"]');
            if(submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Registrando...'; }

            const nuevoGasto = {
                fecha: document.getElementById('gasto-fecha').value,
                proveedorId: proveedorId,
                proveedorNombre: proveedorNombre,
                numeroFactura: document.getElementById('gasto-factura').value,
                valorBase: valorBase,
                ivaIncluido: ivaIncluido,
                valorTotal: valorTotal,
                fuentePago: document.getElementById('gasto-fuente').value,
                estado: 'activo', 
                registradoPor: currentUser.uid,
                timestamp: Date.now(),
                _lastUpdated: serverTimestamp() 
            };
            
            try {
                await addDoc(collection(db, "gastos"), nuevoGasto);
                
                e.target.reset();
                const searchInput = document.getElementById('proveedor-search-input');
                const hiddenInput = document.getElementById('proveedor-id-hidden');
                if (searchInput) searchInput.value = '';
                if (hiddenInput) hiddenInput.value = '';

                if(window.Swal) Swal.fire('¡Éxito!', 'Gasto registrado correctamente.', 'success');
                else showTemporaryMessage('Gasto registrado', 'success');

                currentPage = 1; 
                document.getElementById('gasto-form-container')?.classList.remove('show-modal'); 

            } catch (error) {
                console.error("Error al registrar gasto:", error);
                showModalMessage("Error al registrar el gasto.");
            } finally {
                if(submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Registrar'; }
            }
        };
    }
}   