                // js/modules/items.js

                import { db } from '../firebase-config.js';
                import { collection, doc, addDoc, updateDoc, query, getDocs, where, serverTimestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
                import { allItems, setAllItems, allItemAverageCosts, showModalMessage, hideModal, showTemporaryMessage } from '../app.js';
                import { formatCurrency } from '../utils.js';

                // --- CONFIGURACIÓN DE CACHÉ Y PAGINACIÓN ---
                const CACHE_KEY = 'items_cache';
                const SYNC_KEY = 'items_last_sync';

                // Variables de Paginación
                let currentPage = 1;
                const itemsPerPage = 20;

                // --- CARGA DE DATOS (INTELIGENTE + TIEMPO REAL INFALIBLE) ---
                export function loadItems() {
                    const cachedData = localStorage.getItem(CACHE_KEY);
                    
                    let mapItems = new Map();
                    let maxLastUpdated = 0; // Guardará la fecha exacta del documento más reciente

                    // 1. Cargar desde el caché local (Velocidad instantánea)
                    if (cachedData) {
                        try {
                            const parsedData = JSON.parse(cachedData);
                            parsedData.forEach(i => {
                                mapItems.set(i.id, i);
                                // Buscamos cuál es el timestamp más reciente que tenemos guardado
                                if (i._lastUpdated && i._lastUpdated > maxLastUpdated) {
                                    maxLastUpdated = i._lastUpdated;
                                }
                            });
                            setAllItems(Array.from(mapItems.values()));
                            renderItems();
                        } catch (e) {
                            console.warn("Caché de ítems corrupto. Se limpiará.", e);
                            localStorage.removeItem(CACHE_KEY);
                            localStorage.removeItem(SYNC_KEY);
                        }
                    }

                    // 2. onSnapshot Diferencial basado en la información real del servidor
                    const colRef = collection(db, "items");
                    let q;

                    if (maxLastUpdated > 0) {
                        // Restamos 2 minutos de margen de seguridad a la fecha del último documento
                        const syncTime = new Date(maxLastUpdated - 120000); 
                        q = query(colRef, where("_lastUpdated", ">=", syncTime));
                    } else {
                        // Si no hay caché, descarga todo
                        q = query(colRef);
                    }

                    // 3. Quedarse escuchando los cambios en vivo
                    let isInitial = true;
                    const unsubscribe = onSnapshot(q, (snapshot) => {
                        let huboCambios = false;

                        snapshot.docChanges().forEach((change) => {
                            const doc = change.doc;
                            const data = doc.data();

                            // Limpieza de Timestamps para poder serializar en JSON local
                            if (data._lastUpdated && typeof data._lastUpdated.toMillis === 'function') data._lastUpdated = data._lastUpdated.toMillis();
                            if (data.creadoEn && typeof data.creadoEn.toMillis === 'function') data.creadoEn = data.creadoEn.toMillis();
                            
                            if (change.type === "added" || change.type === "modified") {
                                mapItems.set(doc.id, { id: doc.id, ...data });
                                huboCambios = true;
                            }
                            if (change.type === "removed") {
                                mapItems.delete(doc.id);
                                huboCambios = true;
                            }
                        });

                        // 4. Si hubo un cambio, actualizamos la memoria, el caché local y la pantalla
                        if (huboCambios) {
                            const finalArray = Array.from(mapItems.values());
                            
                            // Ordenamos alfabéticamente por la referencia
                            finalArray.sort((a, b) => (a.referencia || '').localeCompare(b.referencia || ''));
                            
                            localStorage.setItem(CACHE_KEY, JSON.stringify(finalArray));
                            setAllItems(finalArray);
                            
                            renderItems();
                            
                            // Si el usuario está creando una remisión y tiene el buscador desplegado,
                            // esto asegura que los nuevos ítems y su stock estén disponibles de inmediato.
                            if (!isInitial) {
                                console.log(`[Ítems] ${snapshot.docChanges().length} cambios detectados en tiempo real.`);
                            }
                        }
                        isInitial = false;
                    }, (error) => {
                        console.error("Error en onSnapshot diferencial de ítems:", error);
                    });

                    return unsubscribe;
                }

                function updateLocalCache(newOrUpdatedItem) {
                    const cachedData = localStorage.getItem(CACHE_KEY);
                    let items = cachedData ? JSON.parse(cachedData) : [];
                    
                    const index = items.findIndex(i => i.id === newOrUpdatedItem.id);
                    if (index !== -1) items[index] = newOrUpdatedItem;
                    else items.push(newOrUpdatedItem);
                    
                    items.sort((a, b) => (a.referencia || '').localeCompare(b.referencia || ''));
                    
                    localStorage.setItem(CACHE_KEY, JSON.stringify(items));
                    setAllItems(items);
                    renderItems();
                }

                export function renderItems() {
                    const itemsListEl = document.getElementById('items-list');
                    if (!itemsListEl) return;
                    
                    const searchInput = document.getElementById('search-items');
                    const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';

                    let filtered = allItems;
                    if (searchTerm) {
                        filtered = filtered.filter(i =>
                            (i.descripcion && i.descripcion.toLowerCase().includes(searchTerm)) ||
                            (i.referencia && i.referencia.toLowerCase().includes(searchTerm))
                        );
                    }

                    const totalItemsCount = filtered.length;
                    const totalPages = Math.ceil(totalItemsCount / itemsPerPage) || 1;

                    if (currentPage > totalPages) currentPage = totalPages;
                    if (currentPage < 1) currentPage = 1;

                    const startIndex = (currentPage - 1) * itemsPerPage;
                    const endIndex = startIndex + itemsPerPage;
                    const paginatedItems = filtered.slice(startIndex, endIndex);

                    itemsListEl.innerHTML = '';
                    if (totalItemsCount === 0) {
                        itemsListEl.innerHTML = '<p class="text-center text-gray-500 py-4">No hay ítems que coincidan con la búsqueda.</p>';
                        return;
                    }

                    paginatedItems.forEach(item => {
                        const itemDiv = document.createElement('div');
                        itemDiv.className = 'premium-card premium-card-indigo p-4 flex justify-between items-center gap-4 bg-white shadow-sm hover:shadow-md transition';

                        itemDiv.innerHTML = `
                            <div class="min-w-0">
                                <p class="font-bold text-slate-800 flex items-center gap-3 flex-wrap">
                                    <span class="item-ref bg-indigo-50 text-indigo-700 text-xs font-semibold px-2.5 py-1 rounded border border-indigo-150">${item.referencia}</span>
                                    <span class="text-sm font-semibold text-slate-700">${item.descripcion}</span>
                                </p>
                            </div>
                            <div class="flex-shrink-0">
                                <button data-item-json='${JSON.stringify(item)}' class="edit-item-btn btn-premium-outline px-3.5 py-1.5 rounded-lg text-xs hover:bg-slate-50 transition font-bold">
                                    Editar Ítem
                                </button>
                            </div>
                        `;
                        itemsListEl.appendChild(itemDiv);
                    });

                    const paginationEl = document.createElement('div');
                    paginationEl.className = 'premium-pagination-container flex justify-between items-center mt-6';
                    paginationEl.innerHTML = `
                        <span class="text-xs font-medium text-slate-500">Mostrando ${startIndex + 1} - ${Math.min(endIndex, totalItemsCount)} de ${totalItemsCount} ítems</span>
                        <div class="flex gap-2">
                            <button id="prev-page-items-btn" class="premium-pagination-btn" ${currentPage === 1 ? 'disabled' : ''}>&larr; Anterior</button>
                            <span class="px-3 py-1 text-xs font-bold text-slate-700 flex items-center bg-slate-50 border rounded-full">Pág ${currentPage} de ${totalPages}</span>
                            <button id="next-page-items-btn" class="premium-pagination-btn" ${currentPage === totalPages ? 'disabled' : ''}>Siguiente &rarr;</button>
                        </div>
                    `;
                    itemsListEl.appendChild(paginationEl);

                    const prevBtn = document.getElementById('prev-page-items-btn');
                    const nextBtn = document.getElementById('next-page-items-btn');
                    
                    if (prevBtn && currentPage > 1) {
                        prevBtn.addEventListener('click', () => { currentPage--; renderItems(); });
                    }
                    if (nextBtn && currentPage < totalPages) {
                        nextBtn.addEventListener('click', () => { currentPage++; renderItems(); });
                    }
                }

                export function showEditItemModal(item) {
                    const modalContentWrapper = document.getElementById('modal-content-wrapper');

                    modalContentWrapper.innerHTML = `
                        <div class="bg-white rounded-lg p-6 shadow-xl max-w-lg w-full mx-auto text-left">
                            <div class="flex justify-between items-center mb-4">
                                <h2 class="text-xl font-bold text-slate-800">Editar Ítem</h2>
                                <button id="close-edit-item-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
                            </div>
                            <form id="edit-item-form" class="space-y-4">
                                <input type="hidden" id="edit-item-id" value="${item.id}">
                                
                                <div>
                                    <label class="block text-sm font-semibold text-slate-600 uppercase">Referencia</label>
                                    <input type="text" id="edit-item-referencia" class="w-full p-2 border rounded-lg mt-1" value="${item.referencia || ''}" required>
                                </div>
                                <div>
                                    <label class="block text-sm font-semibold text-slate-600 uppercase">Descripción</label>
                                    <input type="text" id="edit-item-descripcion" class="w-full p-2 border rounded-lg mt-1" value="${item.descripcion || ''}" required>
                                </div>
                                
                                <div class="flex justify-end pt-4">
                                    <button type="submit" class="bg-indigo-600 text-white font-bold py-2.5 px-6 rounded-lg hover:bg-indigo-700 transition">Guardar Cambios</button>
                                </div>
                            </form>
                        </div>
                    `;

                    document.getElementById('modal').classList.remove('hidden');
                    document.getElementById('close-edit-item-modal').addEventListener('click', hideModal);
                }

                export function setupItemsEvents() {
                    if (window.__setupItemsEventsInit) return;
                    window.__setupItemsEventsInit = true;

                    const searchInput = document.getElementById('search-items');
                    let debounceTimer;

                    if (searchInput) {
                        searchInput.addEventListener('input', () => {
                            clearTimeout(debounceTimer);
                            debounceTimer = setTimeout(() => {
                                currentPage = 1;
                                renderItems();
                            }, 300);
                        });
                    }

                    document.body.addEventListener('click', (e) => {
                        const editBtn = e.target.closest('.edit-item-btn');
                        if (editBtn) {
                            const itemData = JSON.parse(editBtn.dataset.itemJson);
                            showEditItemModal(itemData);
                        }
                    });

                    document.body.addEventListener('submit', async (e) => {
                        // --- 1. CREAR NUEVO ÍTEM ---
                        if (e.target && e.target.id === 'add-item-form') {
                            e.preventDefault();
                            
                            const referencia = document.getElementById('nuevo-item-ref').value.trim();
                            const descripcion = document.getElementById('nuevo-item-desc').value.trim();

                            if (!referencia || !descripcion) {
                                return showModalMessage("Por favor, completa los campos requeridos.");
                            }

                            const submitBtn = e.target.querySelector('button[type="submit"]');
                            if(submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Guardando...'; }

                            const nuevoItem = {
                                referencia,
                                descripcion,
                                creadoEn: Date.now(),
                                _lastUpdated: serverTimestamp() 
                            };

                            try {
                                const docRef = await addDoc(collection(db, "items"), nuevoItem);
                                
                                nuevoItem.id = docRef.id;
                                nuevoItem._lastUpdated = Date.now();
                                updateLocalCache(nuevoItem);

                                e.target.reset();

                                if(window.Swal) Swal.fire('¡Éxito!', 'Ítem guardado con éxito.', 'success');
                                else showTemporaryMessage('Ítem guardado', 'success');

                                currentPage = 1;
                                renderItems();
                                document.getElementById('item-form-container')?.classList.remove('show-modal');

                            } catch (error) {
                                console.error("Error al guardar el ítem:", error);
                                showModalMessage("Error al guardar el ítem.");
                            } finally {
                                if(submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Guardar Ítem'; }
                            }
                        }

                        // --- 2. EDITAR ÍTEM ---
                        if (e.target && e.target.id === 'edit-item-form') {
                            e.preventDefault();
                            const itemId = document.getElementById('edit-item-id').value;
                            const referencia = document.getElementById('edit-item-referencia').value.trim();
                            const descripcion = document.getElementById('edit-item-descripcion').value.trim();

                            if (!referencia || !descripcion) return showModalMessage("La referencia y la descripción son obligatorias.");

                            const submitBtn = e.target.querySelector('button[type="submit"]');
                            if(submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Guardando...'; }

                            const updatedData = {
                                referencia,
                                descripcion,
                                _lastUpdated: serverTimestamp() 
                            };

                            try {
                                const itemRef = doc(db, "items", itemId);
                                await updateDoc(itemRef, updatedData);
                                
                                const existingItem = allItems.find(i => i.id === itemId) || {};
                                const updatedForCache = { ...existingItem, ...updatedData, id: itemId, _lastUpdated: Date.now() };
                                updateLocalCache(updatedForCache);

                                hideModal();
                                if(window.Swal) Swal.fire('¡Éxito!', 'Ítem actualizado con éxito.', 'success');
                                else showTemporaryMessage('Ítem actualizado', 'success');

                            } catch (error) {
                                console.error("Error al actualizar el ítem:", error);
                                showModalMessage("Error al guardar los cambios.");
                            } finally {
                                if(submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Guardar Cambios'; }
                            }
                        }
                    });
                }