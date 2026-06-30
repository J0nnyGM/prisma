// js/modules/proveedores.js

import { db, storage } from '../firebase-config.js';
import { collection, doc, getDoc, addDoc, updateDoc, query, getDocs, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";
import { 
    allProveedores, setAllProveedores, currentUserData, 
    showModalMessage, hideModal, showTemporaryMessage 
} from '../app.js';

// --- CONFIGURACIÓN DE CACHÉ Y PAGINACIÓN ---
const CACHE_KEY = 'proveedores_cache';
const SYNC_KEY = 'proveedores_last_sync';

// Variables de Paginación
let currentPage = 1;
const itemsPerPage = 20;

export async function loadProveedores() {
    // 1. Intentar cargar desde el caché local primero
    const cachedData = localStorage.getItem(CACHE_KEY);
    const lastSyncStr = localStorage.getItem(SYNC_KEY);
    
    let lastSync = null;
    let mapProveedores = new Map();

    if (cachedData) {
        try {
            const parsedData = JSON.parse(cachedData);
            parsedData.forEach(p => mapProveedores.set(p.id, p));
            setAllProveedores(Array.from(mapProveedores.values()));
            renderProveedores();
        } catch (e) {
            console.warn("Caché de proveedores corrupto. Se limpiará.", e);
            localStorage.removeItem(CACHE_KEY);
            localStorage.removeItem(SYNC_KEY);
        }
    }

    if (lastSyncStr) lastSync = new Date(parseInt(lastSyncStr));

    // 2. Sincronización Diferencial con Firebase
    try {
        const colRef = collection(db, "proveedores");
        let q;

        if (lastSync) {
            const syncTime = new Date(lastSync.getTime() - 60000); // 1 min de margen
            q = query(colRef, where("_lastUpdated", ">=", syncTime));
        } else {
            q = query(colRef); // Si no hay caché, descargar todo
        }

        const snapshot = await getDocs(q);
        let huboCambios = false;

        snapshot.forEach(doc => {
            const data = doc.data();
            if (data._lastUpdated && typeof data._lastUpdated.toMillis === 'function') data._lastUpdated = data._lastUpdated.toMillis();
            if (data.fechaCreacion && typeof data.fechaCreacion.toMillis === 'function') data.fechaCreacion = data.fechaCreacion.toMillis();
            
            mapProveedores.set(doc.id, { id: doc.id, ...data });
            huboCambios = true;
        });

        // 3. Guardar en caché si hubo cambios
        if (huboCambios || !lastSync) {
            const finalArray = Array.from(mapProveedores.values());
            finalArray.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
            
            localStorage.setItem(CACHE_KEY, JSON.stringify(finalArray));
            localStorage.setItem(SYNC_KEY, Date.now().toString());

            setAllProveedores(finalArray);
            renderProveedores();
            console.log(`[Caché] Proveedores sincronizados. ${snapshot.size} lecturas de Firebase.`);
        }
    } catch (error) {
        console.error("Error sincronizando proveedores:", error);
    }
}

// Función auxiliar para actualizar el caché localmente al editar/crear
function updateLocalCache(newOrUpdatedProvider) {
    const cachedData = localStorage.getItem(CACHE_KEY);
    let proveedores = cachedData ? JSON.parse(cachedData) : [];
    
    const index = proveedores.findIndex(p => p.id === newOrUpdatedProvider.id);
    if (index !== -1) proveedores[index] = newOrUpdatedProvider;
    else proveedores.push(newOrUpdatedProvider);
    
    proveedores.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
    
    localStorage.setItem(CACHE_KEY, JSON.stringify(proveedores));
    setAllProveedores(proveedores);
    renderProveedores();
}

// --- RENDERIZADO CON PAGINACIÓN Y OPTIMIZACIÓN ---
export function renderProveedores() {
    const proveedoresListEl = document.getElementById('proveedores-list');
    if (!proveedoresListEl) return;
    
    const searchInput = document.getElementById('search-proveedores');
    const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
    
    // 1. Filtrar lista completa en memoria
    let filtered = allProveedores;
    if (searchTerm) {
        filtered = filtered.filter(p => p.nombre.toLowerCase().includes(searchTerm));
    }

    // 2. Lógica de Paginación
    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;

    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    
    // Extraer solo los proveedores de la página actual
    const paginatedProviders = filtered.slice(startIndex, endIndex);

    proveedoresListEl.innerHTML = '';
    if (totalItems === 0) { 
        proveedoresListEl.innerHTML = '<p class="text-center text-gray-500 py-8">No hay proveedores registrados.</p>'; 
        return; 
    }

    // 3. Dibujar Tarjetas
    paginatedProviders.forEach(proveedor => {
        const el = document.createElement('div');
        el.className = 'premium-card premium-card-teal p-5 flex flex-col sm:flex-row justify-between sm:items-center gap-4 bg-white shadow-sm hover:shadow-md transition';
        
        const nameInitial = (proveedor.nombre || 'P').charAt(0).toUpperCase();
        const editButton = (currentUserData && currentUserData.role === 'admin')
            ? `<button data-provider-json='${JSON.stringify(proveedor)}' class="edit-provider-btn btn-premium-outline px-4 py-2 rounded-lg text-sm hover:bg-slate-50 transition w-full sm:w-auto text-center">Editar Proveedor</button>`
            : '';

        el.innerHTML = `
            <div class="flex items-center gap-4 flex-grow min-w-0">
                <div class="premium-avatar premium-avatar-teal flex-shrink-0">${nameInitial}</div>
                <div class="flex-grow min-w-0">
                    <p class="font-bold text-lg text-slate-900 truncate" title="${proveedor.nombre}">${proveedor.nombre}</p>
                    <p class="text-xs text-slate-500 mt-1">${proveedor.email || 'Sin correo'} &bull; ${proveedor.telefono || 'Sin teléfono'}</p>
                    ${proveedor.contacto ? `<p class="text-xs text-teal-800 font-semibold bg-teal-50 border border-teal-100 rounded px-2 py-0.5 mt-1 inline-block">Contacto: ${proveedor.contacto}</p>` : ''}
                </div>
            </div>
            <div class="flex-shrink-0 w-full sm:w-auto">
                ${editButton}
            </div>
        `;
        proveedoresListEl.appendChild(el);
    });

    // 4. Dibujar Controles de Paginación
    const paginationEl = document.createElement('div');
    paginationEl.className = 'premium-pagination-container flex justify-between items-center mt-6';
    paginationEl.innerHTML = `
        <span class="text-xs font-medium text-slate-500">Mostrando ${startIndex + 1} - ${Math.min(endIndex, totalItems)} de ${totalItems} proveedores</span>
        <div class="flex gap-2">
            <button id="prev-page-prov-btn" class="premium-pagination-btn" ${currentPage === 1 ? 'disabled' : ''}>&larr; Anterior</button>
            <span class="px-3 py-1 text-xs font-bold text-slate-700 flex items-center bg-slate-50 border rounded-full">Pág ${currentPage} de ${totalPages}</span>
            <button id="next-page-prov-btn" class="premium-pagination-btn" ${currentPage === totalPages ? 'disabled' : ''}>Siguiente &rarr;</button>
        </div>
    `;
    proveedoresListEl.appendChild(paginationEl);

    // Eventos de Paginación
    const prevBtn = document.getElementById('prev-page-prov-btn');
    const nextBtn = document.getElementById('next-page-prov-btn');
    
    if (prevBtn && currentPage > 1) {
        prevBtn.addEventListener('click', () => { currentPage--; renderProveedores(); });
    }
    if (nextBtn && currentPage < totalPages) {
        nextBtn.addEventListener('click', () => { currentPage++; renderProveedores(); });
    }

    // Eventos para Editar
    document.querySelectorAll('.edit-provider-btn').forEach(btn => 
        btn.addEventListener('click', (e) => showEditProviderModal(JSON.parse(e.currentTarget.dataset.providerJson)))
    );
}

// --- MODALES Y FORMULARIOS ---
export function showEditProviderModal(proveedor) {
    let rutHtml = '';

    if (proveedor.rutUrl) {
        let rutPath = '';
        try {
            const urlString = proveedor.rutUrl;
            const bucketEndMarker = '.app/';
            const bucketEndIndex = urlString.indexOf(bucketEndMarker);
            if (bucketEndIndex !== -1) {
                const queryStartIndex = urlString.indexOf('?');
                rutPath = decodeURIComponent(urlString.substring(bucketEndIndex + bucketEndMarker.length, queryStartIndex));
            } else throw new Error("La URL no contiene un nombre de bucket.");
        } catch (e) {
            rutPath = '';
        }

        rutHtml = `
            <div class="mt-4 pt-4 border-t">
                <p class="block text-sm font-medium text-gray-700 mb-2">Gestión de RUT</p>
                <div class="flex gap-2">
                    <button type="button" data-file-path="${rutPath}" data-file-title="RUT de ${proveedor.nombre}" class="flex-1 text-center bg-green-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-green-600">Ver</button>
                    <button type="button" id="btn-actualizar-rut" class="flex-1 bg-yellow-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-yellow-600">Actualizar</button>
                </div>
                <div id="rut-upload-container" class="hidden mt-2">
                    <input type="file" id="edit-proveedor-rut" class="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-teal-50 file:text-teal-700 hover:file:bg-teal-100"/>
                </div>
            </div>
        `;
    } else {
        rutHtml = `
            <div class="mt-4 pt-4 border-t">
                <label for="edit-proveedor-rut" class="block text-sm font-medium text-gray-700">Subir RUT (Opcional)</label>
                <input type="file" id="edit-proveedor-rut" class="mt-1 w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-teal-50 file:text-teal-700 hover:file:bg-teal-100"/>
            </div>
        `;
    }

    const modalContent = `
        <div class="bg-white p-6 rounded-xl shadow-lg max-w-md mx-auto">
            <h2 class="text-xl font-semibold mb-4">Editar Proveedor</h2>
            <form id="edit-proveedor-form" data-id="${proveedor.id}">
                <input type="text" id="edit-proveedor-nombre" value="${proveedor.nombre}" class="w-full p-3 border rounded-lg mb-2" required>
                <input type="text" id="edit-proveedor-contacto" value="${proveedor.contacto || ''}" placeholder="Nombre de Contacto" class="w-full p-3 border rounded-lg mb-2">
                <input type="tel" id="edit-proveedor-telefono" value="${proveedor.telefono || ''}" placeholder="Teléfono" class="w-full p-3 border rounded-lg mb-2">
                <input type="email" id="edit-proveedor-email" value="${proveedor.email || ''}" placeholder="Correo" class="w-full p-3 border rounded-lg">
                ${rutHtml}
                <div class="mt-6 flex justify-end gap-3">
                    <button type="button" id="cancel-edit-provider" class="bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded-lg hover:bg-gray-400">Cancelar</button>
                    <button type="submit" class="bg-teal-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-teal-700">Guardar Cambios</button>
                </div>
            </form>
        </div>
    `;
    document.getElementById('modal-content').innerHTML = modalContent;
    document.getElementById('modal').classList.remove('hidden');

    const btnActualizarRut = document.getElementById('btn-actualizar-rut');
    if (btnActualizarRut) {
        btnActualizarRut.addEventListener('click', () => {
            document.getElementById('rut-upload-container').classList.remove('hidden');
            btnActualizarRut.classList.add('hidden');
        });
    }

    document.getElementById('cancel-edit-provider').addEventListener('click', () => {
        document.getElementById('modal').classList.add('hidden');
    });
}

// --- SETUP DE EVENTOS ---
export function setupProveedoresEvents() {
    if (window.__setupProveedoresEventsInit) return;
    window.__setupProveedoresEventsInit = true;

    const searchInput = document.getElementById('search-proveedores');
    let debounceTimer;

    if (searchInput) {
        // BUSCADOR INTELIGENTE: Espera 300ms antes de buscar
        searchInput.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                currentPage = 1; // Volver a la pag 1 al buscar
                renderProveedores();
            }, 300);
        });
    }

    document.body.addEventListener('submit', async (e) => {
        // --- 1. NUEVO PROVEEDOR ---
        if (e.target && e.target.id === 'add-proveedor-form') {
            e.preventDefault();
            const nombre = document.getElementById('nuevo-proveedor-nombre').value;
            const contacto = document.getElementById('nuevo-proveedor-contacto').value;
            const telefono = document.getElementById('nuevo-proveedor-telefono').value;
            const email = document.getElementById('nuevo-proveedor-email').value;
            const rutFile = document.getElementById('nuevo-proveedor-rut').files[0];

            const submitButton = e.target.querySelector('button[type="submit"]');
            submitButton.disabled = true;
            submitButton.textContent = 'Guardando...';

            const proveedorData = {
                nombre: nombre,
                contacto: contacto,
                telefono: telefono,
                email: email,
                fechaCreacion: serverTimestamp(),
                _lastUpdated: serverTimestamp() // Importante para el caché
            };

            try {
                if (rutFile) {
                    const storageRef = ref(storage, `ruts_proveedores/${Date.now()}-${rutFile.name}`);
                    const snapshot = await uploadBytes(storageRef, rutFile);
                    proveedorData.rutUrl = await getDownloadURL(snapshot.ref);
                }

                const docRef = await addDoc(collection(db, 'proveedores'), proveedorData);
                
                // Actualizar Caché Local
                proveedorData.id = docRef.id;
                proveedorData._lastUpdated = Date.now();
                proveedorData.fechaCreacion = Date.now();
                updateLocalCache(proveedorData);

                if(window.Swal) Swal.fire('¡Éxito!', 'Proveedor registrado correctamente.', 'success');
                else showTemporaryMessage('Proveedor registrado', 'success');
                e.target.reset();
                document.getElementById('proveedor-form-container')?.classList.remove('show-modal');
            } catch (error) {
                console.error("Error al registrar el proveedor: ", error);
                if(window.Swal) Swal.fire('Error', 'No se pudo registrar el proveedor.', 'error');
                else showModalMessage('Error al registrar');
            } finally {
                submitButton.disabled = false;
                submitButton.textContent = 'Registrar';
            }
        }

        // --- 2. EDITAR PROVEEDOR ---
        if (e.target && e.target.id === 'edit-proveedor-form') {
            e.preventDefault();
            const form = e.target;
            const proveedorId = form.dataset.id;
            const submitButton = form.querySelector('button[type="submit"]');

            submitButton.disabled = true;
            submitButton.textContent = 'Guardando...';

            const updatedData = {
                nombre: form.querySelector('#edit-proveedor-nombre').value,
                contacto: form.querySelector('#edit-proveedor-contacto').value,
                telefono: form.querySelector('#edit-proveedor-telefono').value,
                email: form.querySelector('#edit-proveedor-email').value,
                _lastUpdated: serverTimestamp() // Importante para el caché
            };

            const rutFile = form.querySelector('#edit-proveedor-rut')?.files[0];

            try {
                if (rutFile) {
                    const proveedorDoc = await getDoc(doc(db, 'proveedores', proveedorId));
                    const proveedorActual = proveedorDoc.data();
                    if (proveedorActual.rutUrl) {
                        try { await deleteObject(ref(storage, proveedorActual.rutUrl)); } 
                        catch (e) { console.warn("No se pudo eliminar el archivo antiguo."); }
                    }

                    const newStorageRef = ref(storage, `ruts_proveedores/${Date.now()}-${rutFile.name}`);
                    const snapshot = await uploadBytes(newStorageRef, rutFile);
                    updatedData.rutUrl = await getDownloadURL(snapshot.ref);
                }

                await updateDoc(doc(db, 'proveedores', proveedorId), updatedData);
                
                // Actualizar Caché Local
                const existingProvider = allProveedores.find(p => p.id === proveedorId) || {};
                const updatedForCache = { ...existingProvider, ...updatedData, id: proveedorId, _lastUpdated: Date.now() };
                updateLocalCache(updatedForCache);

                if(window.Swal) Swal.fire('¡Éxito!', 'Proveedor actualizado correctamente.', 'success');
                else showTemporaryMessage('Proveedor actualizado', 'success');
                document.getElementById('modal').classList.add('hidden');

            } catch (error) {
                console.error("Error al actualizar proveedor: ", error);
                if(window.Swal) Swal.fire('Error', 'No se pudo actualizar el proveedor.', 'error');
                else showModalMessage('Error al actualizar');
            } finally {
                submitButton.disabled = false;
                submitButton.textContent = 'Guardar Cambios';
            }
        }
    });
}