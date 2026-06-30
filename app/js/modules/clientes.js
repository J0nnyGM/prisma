// js/modules/clientes.js

import { db, storage } from '../firebase-config.js';
import { collection, doc, getDoc, addDoc, updateDoc, query, getDocs, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";
import { allClientes, setAllClientes, allRemisiones, currentUserData, showModalMessage, hideModal, showTemporaryMessage } from '../app.js';
import { normalizeText, formatCurrency } from '../utils.js';

// --- CONFIGURACIÓN DE CACHÉ Y PAGINACIÓN ---
const CACHE_KEY = 'clientes_cache';
const SYNC_KEY = 'clientes_last_sync';

// Variables de Paginación
let currentPage = 1;
const itemsPerPage = 20;

export async function loadClientes() {
    const cachedData = localStorage.getItem(CACHE_KEY);
    const lastSyncStr = localStorage.getItem(SYNC_KEY);
    
    let lastSync = null;
    let mapClientes = new Map();

    if (cachedData) {
        try {
            const parsedData = JSON.parse(cachedData);
            parsedData.forEach(c => mapClientes.set(c.id, c));
            setAllClientes(Array.from(mapClientes.values()));
            renderClientes();
        } catch (e) {
            console.warn("Caché de clientes corrupto. Se limpiará.", e);
            localStorage.removeItem(CACHE_KEY);
            localStorage.removeItem(SYNC_KEY);
        }
    }

    if (lastSyncStr) lastSync = new Date(parseInt(lastSyncStr));

    try {
        const colRef = collection(db, "clientes");
        let q;

        if (lastSync) {
            const syncTime = new Date(lastSync.getTime() - 60000); 
            q = query(colRef, where("_lastUpdated", ">=", syncTime));
        } else {
            q = query(colRef);
        }

        const snapshot = await getDocs(q);
        let huboCambios = false;

        snapshot.forEach(doc => {
            const data = doc.data();
            if (data._lastUpdated && typeof data._lastUpdated.toMillis === 'function') data._lastUpdated = data._lastUpdated.toMillis();
            if (data.fechaCreacion && typeof data.fechaCreacion.toMillis === 'function') data.fechaCreacion = data.fechaCreacion.toMillis();
            
            mapClientes.set(doc.id, { id: doc.id, ...data });
            huboCambios = true;
        });

        if (huboCambios || !lastSync) {
            const finalArray = Array.from(mapClientes.values());
            finalArray.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
            localStorage.setItem(CACHE_KEY, JSON.stringify(finalArray));
            localStorage.setItem(SYNC_KEY, Date.now().toString());

            setAllClientes(finalArray);
            renderClientes();
            console.log(`[Caché] Clientes sincronizados. ${snapshot.size} lecturas de Firebase.`);
        }
    } catch (error) {
        console.error("Error sincronizando clientes:", error);
    }
}

function updateLocalCache(newOrUpdatedClient) {
    const cachedData = localStorage.getItem(CACHE_KEY);
    let clientes = cachedData ? JSON.parse(cachedData) : [];
    
    const index = clientes.findIndex(c => c.id === newOrUpdatedClient.id);
    if (index !== -1) clientes[index] = newOrUpdatedClient;
    else clientes.push(newOrUpdatedClient);
    
    clientes.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
    
    localStorage.setItem(CACHE_KEY, JSON.stringify(clientes));
    setAllClientes(clientes);
    renderClientes();
}


// --- RENDERIZADO CON PAGINACIÓN Y OPTIMIZACIÓN EXTREMA ---
export function renderClientes() {
    const clientesListEl = document.getElementById('clientes-list');
    if (!clientesListEl) return;

    const searchInput = document.getElementById('search-clientes');
    const normalizedSearchTerm = searchInput ? normalizeText(searchInput.value) : '';

    // 1. Filtrar primero TODO el listado (Búsqueda rápida en texto, sin cálculos pesados)
    let filtered = allClientes;
    if (normalizedSearchTerm) {
        filtered = filtered.filter(c => {
            const clientDataString = [c.nombre, c.nombreEmpresa, c.contacto, c.email, c.telefono1, c.telefono2, c.nit].join(' ');
            return normalizeText(clientDataString).includes(normalizedSearchTerm);
        });
    }

    // 2. Lógica de Paginación
    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;

    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    
    // Obtenemos solo los 20 clientes de esta página
    const paginatedClients = filtered.slice(startIndex, endIndex);

    // 3. Calcular "Total Comprado" SOLO para los 20 clientes en pantalla
    // ¡Esto nos ahorra miles de iteraciones sobre las remisiones!
    const clientsToRender = paginatedClients.map(cliente => {
        const remisionesCliente = allRemisiones.filter(r => r.idCliente === cliente.id && r.estado !== 'Anulada');
        const totalComprado = remisionesCliente.reduce((sum, r) => sum + r.valorTotal, 0);
        let ultimaCompra = 'N/A';
        if (remisionesCliente.length > 0) {
            // Buscamos la fecha más reciente (como ya vienen ordenadas, solemos tomar la primera, pero ordenamos por si acaso)
            remisionesCliente.sort((a, b) => new Date(b.fechaRecibido) - new Date(a.fechaRecibido));
            ultimaCompra = remisionesCliente[0].fechaRecibido;
        }
        return { ...cliente, totalComprado, ultimaCompra };
    });

    clientesListEl.innerHTML = '';
    
    if (totalItems === 0) {
        clientesListEl.innerHTML = '<p class="text-center text-gray-500 py-8">No se encontraron clientes.</p>';
        return;
    }

    // 4. Dibujar Tarjetas
    clientsToRender.forEach(cliente => {
        const clienteDiv = document.createElement('div');
        clienteDiv.className = 'premium-card premium-card-orange p-5 flex flex-col sm:flex-row justify-between sm:items-center gap-4 bg-white shadow-sm hover:shadow-md transition';

        const nameInitial = (cliente.nombreEmpresa || cliente.nombre || 'C').charAt(0).toUpperCase();
        const telefonos = [cliente.telefono1, cliente.telefono2].filter(Boolean).join(' | ');
        const editButton = (currentUserData && currentUserData.role === 'admin')
            ? `<button data-client-json='${JSON.stringify(cliente)}' class="edit-client-btn btn-premium-outline px-4 py-2 rounded-lg text-sm hover:bg-slate-50 transition w-full text-center">Editar Cliente</button>`
            : '';

        const nombreContactoHtml = cliente.contacto ? `<p class="text-sm text-slate-600"><span class="font-medium text-slate-800">Contacto:</span> ${cliente.contacto}</p>` : '';

        clienteDiv.innerHTML = `
            <div class="flex items-center gap-4 flex-grow min-w-0">
                <div class="premium-avatar premium-avatar-orange flex-shrink-0">${nameInitial}</div>
                <div class="flex-grow min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                        <p class="font-bold text-lg text-slate-900 truncate" title="${cliente.nombre}">${cliente.nombreEmpresa || cliente.nombre}</p>
                        ${cliente.nit ? `<span class="bg-indigo-50 text-indigo-700 text-xs font-semibold px-2 py-0.5 rounded border border-indigo-100">NIT: ${cliente.nit}</span>` : ''}
                    </div>
                    ${nombreContactoHtml}
                    <p class="text-xs text-slate-500 mt-1">${cliente.email || 'Sin correo'} &bull; ${telefonos}</p>
                </div>
            </div>
            
            <div class="flex flex-col gap-2 flex-shrink-0 w-full sm:w-56 mt-2 sm:mt-0">
                <div class="bg-slate-50 p-2.5 rounded-lg border border-slate-100 text-xs text-slate-600 space-y-1">
                    <p><span class="font-bold text-slate-700">Última Compra:</span> ${cliente.ultimaCompra}</p>
                    <p><span class="font-bold text-slate-700">Total Comprado:</span> <span class="font-bold text-indigo-600">${formatCurrency(cliente.totalComprado)}</span></p>
                </div>
                ${editButton}
            </div>
        `;
        clientesListEl.appendChild(clienteDiv);
    });

    // 5. Dibujar Controles de Paginación
    const paginationEl = document.createElement('div');
    paginationEl.className = 'premium-pagination-container flex justify-between items-center mt-6';
    paginationEl.innerHTML = `
        <span class="text-xs font-medium text-slate-500">Mostrando ${startIndex + 1} - ${Math.min(endIndex, totalItems)} de ${totalItems} clientes</span>
        <div class="flex gap-2">
            <button id="prev-page-btn" class="premium-pagination-btn" ${currentPage === 1 ? 'disabled' : ''}>&larr; Anterior</button>
            <span class="px-3 py-1 text-xs font-bold text-slate-700 flex items-center bg-slate-50 border rounded-full">Pág ${currentPage} de ${totalPages}</span>
            <button id="next-page-btn" class="premium-pagination-btn" ${currentPage === totalPages ? 'disabled' : ''}>Siguiente &rarr;</button>
        </div>
    `;
    clientesListEl.appendChild(paginationEl);

    // Eventos de Paginación
    const prevBtn = document.getElementById('prev-page-btn');
    const nextBtn = document.getElementById('next-page-btn');
    
    if (prevBtn && currentPage > 1) {
        prevBtn.addEventListener('click', () => { currentPage--; renderClientes(); });
    }
    if (nextBtn && currentPage < totalPages) {
        nextBtn.addEventListener('click', () => { currentPage++; renderClientes(); });
    }

    // Eventos de Edición
    document.querySelectorAll('.edit-client-btn').forEach(btn => btn.addEventListener('click', (e) => showEditClientModal(JSON.parse(e.currentTarget.dataset.clientJson))));
}


// --- MODALES ---
export function showEditClientModal(cliente) {
    let rutHtml = '';

    if (cliente.rutUrl) {
        let rutPath = '';
        try {
            const urlString = cliente.rutUrl;
            const bucketEndMarker = '.app/';
            const bucketEndIndex = urlString.indexOf(bucketEndMarker);
            if (bucketEndIndex !== -1) {
                const queryStartIndex = urlString.indexOf('?');
                rutPath = decodeURIComponent(urlString.substring(bucketEndIndex + bucketEndMarker.length, queryStartIndex));
            } else throw new Error("La URL no contiene un nombre de bucket reconocible (.app/).");
        } catch (e) {
            rutPath = '';
        }

        rutHtml = `
            <div class="mt-4 pt-4 border-t">
                <p class="block text-sm font-medium text-gray-700 mb-2">Gestión de RUT</p>
                <div class="flex gap-2">
                    <button type="button" data-file-path="${rutPath}" data-file-title="RUT de ${cliente.nombre}" class="flex-1 text-center bg-green-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-green-600">Ver</button>
                    <button type="button" id="btn-actualizar-rut-cliente" class="flex-1 bg-yellow-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-yellow-600">Actualizar</button>
                </div>
                <div id="rut-upload-container-cliente" class="hidden mt-2">
                    <input type="file" id="edit-cliente-rut" class="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-blue-100"/>
                </div>
            </div>
        `;
    } else {
        rutHtml = `
            <div class="mt-4 pt-4 border-t">
                <label for="edit-cliente-rut" class="block text-sm font-medium text-gray-700">Subir RUT (Opcional)</label>
                <input type="file" id="edit-cliente-rut" class="mt-1 w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-blue-100"/>
            </div>
        `;
    }

    const modalContent = `
        <div class="bg-white p-6 rounded-xl shadow-lg max-w-md mx-auto">
            <h2 class="text-xl font-semibold mb-4">Editar Cliente</h2>
            <form id="edit-cliente-form" data-id="${cliente.id}" class="space-y-3">
                <input type="text" id="edit-cliente-nombre-empresa" value="${cliente.nombreEmpresa || cliente.nombre}" placeholder="Nombre Empresa" class="w-full p-3 border rounded-lg" required>
                <input type="text" id="edit-cliente-contacto" value="${cliente.contacto || ''}" placeholder="Nombre del Contacto" class="w-full p-3 border rounded-lg">
                <input type="email" id="edit-cliente-email" value="${cliente.email || ''}" placeholder="Correo" class="w-full p-3 border rounded-lg">
                <input type="tel" id="edit-cliente-telefono1" value="${cliente.telefono1 || ''}" placeholder="Teléfono 1" class="w-full p-3 border rounded-lg" required oninput="this.value = this.value.replace(/[^0-9]/g, '')">
                <input type="tel" id="edit-cliente-telefono2" value="${cliente.telefono2 || ''}" placeholder="Teléfono 2" class="w-full p-3 border rounded-lg" oninput="this.value = this.value.replace(/[^0-9]/g, '')">
                <input type="text" id="edit-cliente-nit" value="${cliente.nit || ''}" placeholder="NIT" class="w-full p-3 border rounded-lg">
                ${rutHtml}
                <div class="mt-6 flex justify-end gap-3">
                    <button type="button" id="cancel-edit-client" class="bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded-lg">Cancelar</button>
                    <button type="submit" class="bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-indigo-700">Guardar Cambios</button>
                </div>
            </form>
        </div>
    `;
    document.getElementById('modal-content').innerHTML = modalContent;
    document.getElementById('modal').classList.remove('hidden');

    const btnActualizarRutCliente = document.getElementById('btn-actualizar-rut-cliente');
    if (btnActualizarRutCliente) {
        btnActualizarRutCliente.addEventListener('click', () => {
            document.getElementById('rut-upload-container-cliente').classList.remove('hidden');
            btnActualizarRutCliente.classList.add('hidden');
        });
    }

    document.getElementById('cancel-edit-client').addEventListener('click', () => {
        document.getElementById('modal').classList.add('hidden');
    });
}


// --- CONFIGURACIÓN DE EVENTOS Y DEBOUNCE ---
export function setupClientesEvents() {
    if (window.__setupClientesEventsInit) return;
    window.__setupClientesEventsInit = true;

    const searchInput = document.getElementById('search-clientes');
    let debounceTimer;

    if (searchInput) {
        // BUSCADOR INTELIGENTE: Espera 300ms antes de buscar
        searchInput.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                currentPage = 1; // Al buscar, volvemos a la página 1
                renderClientes();
            }, 300);
        });
    }

    document.body.addEventListener('submit', async (e) => {
        // --- 1. NUEVO CLIENTE ---
        if (e.target && e.target.id === 'add-cliente-form') {
            e.preventDefault();
            const nombreEmpresa = document.getElementById('nuevo-cliente-nombre-empresa').value;
            const contacto = document.getElementById('nuevo-cliente-contacto').value;
            const email = document.getElementById('nuevo-cliente-email').value;
            const telefono1 = document.getElementById('nuevo-cliente-telefono1').value;
            const telefono2 = document.getElementById('nuevo-cliente-telefono2').value;
            const nit = document.getElementById('nuevo-cliente-nit').value;
            const rutFile = document.getElementById('nuevo-cliente-rut').files[0];

            const submitButton = e.target.querySelector('button[type="submit"]');
            submitButton.disabled = true;
            submitButton.textContent = 'Registrando...';

            const clienteData = {
                nombre: nombreEmpresa, 
                nombreEmpresa: nombreEmpresa,
                contacto: contacto,
                email: email,
                telefono1: telefono1,
                telefono2: telefono2,
                nit: nit,
                fechaCreacion: serverTimestamp(),
                _lastUpdated: serverTimestamp()
            };

            try {
                if (rutFile) {
                    const storageRef = ref(storage, `ruts_clientes/${Date.now()}-${rutFile.name}`);
                    const snapshot = await uploadBytes(storageRef, rutFile);
                    clienteData.rutUrl = await getDownloadURL(snapshot.ref);
                }
                const docRef = await addDoc(collection(db, 'clientes'), clienteData);
                
                // Actualizar caché
                clienteData.id = docRef.id;
                clienteData._lastUpdated = Date.now();
                clienteData.fechaCreacion = Date.now();
                updateLocalCache(clienteData);

                if(window.Swal) Swal.fire('¡Cliente Registrado!', 'El nuevo cliente ha sido guardado con éxito.', 'success');
                else showTemporaryMessage('Cliente registrado', 'success');
                e.target.reset();
                document.getElementById('cliente-form-container')?.classList.remove('show-modal');
            } catch (error) {
                console.error("Error al registrar cliente:", error);
                if(window.Swal) Swal.fire('Error', 'Hubo un problema al registrar el cliente.', 'error');
                else showModalMessage('Error al registrar');
            } finally {
                submitButton.disabled = false;
                submitButton.textContent = 'Registrar';
            }
        }

        // --- 2. EDITAR CLIENTE ---
        if (e.target && e.target.id === 'edit-cliente-form') {
            e.preventDefault();
            const form = e.target;
            const clienteId = form.dataset.id;
            const submitButton = form.querySelector('button[type="submit"]');
            submitButton.disabled = true;
            submitButton.textContent = 'Guardando...';

            const nombreEmpresa = form.querySelector('#edit-cliente-nombre-empresa').value;
            const updatedData = {
                nombre: nombreEmpresa,
                nombreEmpresa: nombreEmpresa,
                contacto: form.querySelector('#edit-cliente-contacto').value,
                email: form.querySelector('#edit-cliente-email').value,
                telefono1: form.querySelector('#edit-cliente-telefono1').value,
                telefono2: form.querySelector('#edit-cliente-telefono2').value,
                nit: form.querySelector('#edit-cliente-nit').value,
                _lastUpdated: serverTimestamp()
            };

            const rutFile = form.querySelector('#edit-cliente-rut')?.files[0];

            try {
                if (rutFile) {
                    const clienteDoc = await getDoc(doc(db, 'clientes', clienteId));
                    const clienteActual = clienteDoc.data();
                    if (clienteActual.rutUrl) {
                        try {
                            await deleteObject(ref(storage, clienteActual.rutUrl));
                        } catch (e) {}
                    }
                    const newStorageRef = ref(storage, `ruts_clientes/${Date.now()}-${rutFile.name}`);
                    const snapshot = await uploadBytes(newStorageRef, rutFile);
                    updatedData.rutUrl = await getDownloadURL(snapshot.ref);
                }

                await updateDoc(doc(db, 'clientes', clienteId), updatedData);
                
                // Actualizar caché local
                const existingClient = allClientes.find(c => c.id === clienteId) || {};
                const updatedForCache = { ...existingClient, ...updatedData, id: clienteId, _lastUpdated: Date.now() };
                updateLocalCache(updatedForCache);

                if(window.Swal) Swal.fire('¡Éxito!', 'Cliente actualizado correctamente.', 'success');
                else showTemporaryMessage('Cliente actualizado', 'success');
                document.getElementById('modal').classList.add('hidden');
            } catch (error) {
                console.error("Error al actualizar cliente: ", error);
                if(window.Swal) Swal.fire('Error', 'No se pudo actualizar el cliente.', 'error');
                else showModalMessage('Error al actualizar');
            } finally {
                submitButton.disabled = false;
                submitButton.textContent = 'Guardar Cambios';
            }
        }
    });
}