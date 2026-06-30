
import { 
    allUsers, setAllUsers, allPendingLoans, setAllPendingLoans, 
    currentUser, currentUserData, 
    showModalMessage, hideModal, showTemporaryMessage, showPdfModal 
} from '../app.js';
import { formatCurrency, unformatCurrency, unformatCurrencyInput, formatCurrencyInput } from '../utils.js';
import { METODOS_DE_PAGO, RRHH_DOCUMENT_TYPES, ALL_MODULES } from '../constants.js';
import { loadIndividualDashboardIntoContainer } from './nomina.js';

let showInactiveEmployees = false;
let unsubscribeMyLoans = null;
import { doc,
    getDoc,
    collection,
    query,
    where,
    getDocs,
    orderBy,
    limit,
    onSnapshot,
    addDoc,
    serverTimestamp,
    deleteDoc,
    setDoc,
    writeBatch,
    collectionGroup, // Vital para el historial global
    increment,
    updateDoc
, arrayUnion } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

// Importaciones de Storage (Asegúrate de que esta línea sea exacta)
import {
    getStorage,
    ref,
    uploadBytes,
    getDownloadURL,
    deleteObject
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";

import { db, storage, functions, httpsCallable } from '../firebase-config.js';

// Constantes de caché local
const EMPLEADOS_CACHE_KEY = 'empleados_cache';
const EMPLEADOS_SYNC_KEY = 'empleados_last_sync';

let _db = db;
let _getUsersMap;
let _getCurrentUserRole;
let _showView;
let _openConfirmModal = function(message, onConfirm) {
    if (window.openConfirmModal) {
        window.openConfirmModal(message, onConfirm);
    } else {
        if (confirm(message)) {
            onConfirm();
        }
    }
};
let _getPayrollConfig;
let _getCurrentUserId;
let _setupCurrencyInput;

// Variables locales
let activeEmpleadoChart = null;
let unsubscribeEmpleadosTab = null;
const dotacionCatalogCache = new Map();

// --- CORRECCIÓN CRÍTICA: Declarar pero NO inicializar aquí ---
let _storage = null;

// Formateador de moneda
const currencyFormatter = new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
});

/**
 * Calcula la diferencia de días entre dos fechas usando el año comercial de 360 días.
 * (Meses de 30 días).
 * @param {Date} startDate 
 * @param {Date} endDate 
 * @returns {number} Días totales (inclusivo)
 */
export function initEmpleados(
    db,
    getUsersMap,
    getCurrentUserRole,
    showView,
    storage, // (Ignoramos este argumento para evitar conflictos)
    openConfirmModal,
    loadDotacionFunc,
    getPayrollConfig,
    getCurrentUserId,
    setupCurrencyInput
) {
    // 1. Recibir dependencias
    _db = db;
    _getUsersMap = () => {
        const originalMap = getUsersMap();
        const newMap = new Map();
        originalMap.forEach((user, id) => {
            const normalizedUser = { ...user };
            if (!normalizedUser.firstName && !normalizedUser.lastName && normalizedUser.nombre) {
                const parts = normalizedUser.nombre.trim().split(/\s+/);
                normalizedUser.firstName = parts[0] || '';
                normalizedUser.lastName = parts.slice(1).join(' ') || '';
            }
            newMap.set(id, normalizedUser);
        });
        return newMap;
    };
    _getCurrentUserRole = getCurrentUserRole;
    _showView = showView;
    _openConfirmModal = openConfirmModal;
    _getPayrollConfig = getPayrollConfig;
    _getCurrentUserId = getCurrentUserId;
    _setupCurrencyInput = setupCurrencyInput;
    _storage = getStorage(); // (o tu lógica de try/catch actual)

    // 2. Inicializar Storage de forma segura (Ahora que la App existe)
    try {
        _storage = getStorage();
    } catch (e) {
        console.warn("Advertencia: Storage no se pudo inicializar aún (normal si no has configurado buckets).", e);
    }

    // 3. Guardar referencia a función externa
    window.openPaymentVoucherModal = openPaymentVoucherModal;
    window.loadDotacionAsignaciones = loadDotacionFunc;

    window.showEmpleadoDetails = showEmpleadoDetails;

    // 4. Activar las pestañas (Esto hace que los botones funcionen)
    const tabsNav = document.getElementById('empleados-tabs-nav');
    if (tabsNav) {
        // Limpiamos listeners viejos clonando el elemento (truco para evitar duplicados)
        const newTabsNav = tabsNav.cloneNode(true);
        tabsNav.parentNode.replaceChild(newTabsNav, tabsNav);

        newTabsNav.addEventListener('click', (e) => {
            const button = e.target.closest('.empleados-tab-button');
            if (button && !button.classList.contains('active')) {
                switchEmpleadosTab(button.dataset.tab);
            }
        });
    } else {
        console.log("El menú de pestañas de empleados no está en el DOM todavía (se cargará al entrar a la vista).");
    }

    console.log("Módulo de Empleados inicializado correctamente.");
}

// 1. ACTUALIZAR loadEmpleadosView (Diseño Moderno)
export function loadEmpleadosView() {
    const role = _getCurrentUserRole();
    const tabsNav = document.getElementById('empleados-tabs-nav');
    const viewContainer = document.getElementById('empleados-view') || document.getElementById('view-empleados');

    if (!tabsNav || !viewContainer) return;

    // Configuración del botón de engranaje para nómina
    const settingsBtn = document.getElementById('payroll-config-settings-btn');
    if (settingsBtn) {
        if (!settingsBtn.dataset.listenerAttached) {
            settingsBtn.addEventListener('click', showPayrollConfigModal);
            settingsBtn.dataset.listenerAttached = "true";
        }
        if (role !== 'admin') {
            settingsBtn.classList.add('hidden');
        } else {
            settingsBtn.classList.remove('hidden');
        }
    }

    if (unsubscribeEmpleadosTab) {
        unsubscribeEmpleadosTab();
        unsubscribeEmpleadosTab = null;
    }

    // --- CONFIGURACIÓN DEL SELECTOR DE MES ---
    // Ya no lo inyectamos, solo configuramos el valor y el listener
    const monthSelector = document.getElementById('empleado-month-selector');
    if (monthSelector) {
        // Si está vacío, poner el mes actual
        if (!monthSelector.value) {
            const today = new Date();
            const year = today.getFullYear();
            const month = String(today.getMonth() + 1).padStart(2, '0');
            monthSelector.value = `${year}-${month}`;
        }

        // Listener para recargar la pestaña actual al cambiar fecha
        // Usamos una propiedad personalizada para evitar múltiples listeners
        if (!monthSelector.dataset.listenerAttached) {
            monthSelector.addEventListener('change', () => {
                const activeTabKey = tabsNav.querySelector('.active')?.dataset.tab || 'productividad';
                switchEmpleadosTab(activeTabKey);
            });
            monthSelector.dataset.listenerAttached = "true";
        }
    }

    // DEFINICIÓN DE PESTAÑAS
    const allTabs = {
        productividad: { label: 'Productividad', roles: ['admin'] },
        documentos: { label: 'RRHH (Expedientes)', roles: ['admin', 'sst'] },
        sst: { label: 'Centro de Control SST', roles: ['admin', 'sst'] }
    };

    // Filtrar pestañas según rol
    const availableTabs = Object.keys(allTabs).filter(key => {
        if (!allTabs[key].roles) return true; // Si no tiene roles definidos, es pública
        return allTabs[key].roles.includes(role);
    });

    // Generar HTML de los botones
    tabsNav.innerHTML = '';
    availableTabs.forEach(tabKey => {
        const tab = allTabs[tabKey];
        // Estilo base para botones inactivos
        tabsNav.innerHTML += `
            <button data-tab="${tabKey}"
                class="empleados-tab-button whitespace-nowrap py-4 px-2 border-b-2 font-bold text-sm transition-all duration-200 text-gray-500 border-transparent hover:text-gray-700 hover:border-gray-300">
                ${tab.label}
            </button>
        `;
    });

    // Activar la primera pestaña por defecto
    if (availableTabs.length > 0) {
        // Intentamos mantener la pestaña activa si ya había una
        const previousActive = document.querySelector('.empleados-tab-button.active');
        const defaultTab = previousActive ? previousActive.dataset.tab : availableTabs[0];

        // Verificamos que la pestaña previa siga siendo válida para el rol
        if (availableTabs.includes(defaultTab)) {
            switchEmpleadosTab(defaultTab);
        } else {
            switchEmpleadosTab(availableTabs[0]);
        }
    } else {
        document.getElementById('empleados-content-container').innerHTML =
            '<div class="p-10 text-center bg-gray-50 rounded-lg border border-gray-200"><p class="text-gray-500">No tienes permisos para ver ninguna sección de este módulo.</p></div>';
    }
}

// 2. ACTUALIZAR switchEmpleadosTab (Estilos Activos)

function switchEmpleadosTab(tabName) {
    // 1. Limpiar listener de productividad si existe
    if (typeof unsubscribeProductividad !== 'undefined' && unsubscribeProductividad) {
        unsubscribeProductividad();
        unsubscribeProductividad = null;
    }

    if (unsubscribeEmpleadosTab) {
        unsubscribeEmpleadosTab();
        unsubscribeEmpleadosTab = null;
    }

    // Limpiar el mapa de asistencia si venimos de ahí (importante)
    if (typeof attendanceMapInstance !== 'undefined' && attendanceMapInstance) {
        attendanceMapInstance.remove();
        attendanceMapInstance = null;
    }

    const container = document.getElementById('empleados-content-container');
    container.innerHTML = '<div class="py-16 text-center"><div class="loader mx-auto mb-2"></div><p class="text-xs text-gray-400">Cargando módulo...</p></div>';

    // Actualizar estilos de los botones (Visualización Activa)
    document.querySelectorAll('.empleados-tab-button').forEach(button => {
        const isActive = button.dataset.tab === tabName;

        if (isActive) {
            button.classList.add('active', 'border-slate-800', 'text-slate-800');
            button.classList.remove('border-transparent', 'text-gray-500', 'hover:text-gray-700', 'hover:border-gray-300');
        } else {
            button.classList.remove('active', 'border-slate-800', 'text-slate-800');
            button.classList.add('border-transparent', 'text-gray-500', 'hover:text-gray-700', 'hover:border-gray-300');
        }
    });

    // Cargar contenido
    switch (tabName) {
        case 'productividad':
            const prodDiv = document.createElement('div');
            container.innerHTML = ''; container.appendChild(prodDiv);
            loadProductividadTab(prodDiv);
            break;

        case 'documentos':
            const docsDiv = document.createElement('div');
            container.innerHTML = ''; container.appendChild(docsDiv);
            loadDocumentosTab(docsDiv);
            break;

        case 'sst':
            const sstDiv = document.createElement('div');
            container.innerHTML = ''; container.appendChild(sstDiv);
            loadSSTTab(sstDiv);
            break;

        default:
            container.innerHTML = '<p class="text-red-500 text-center p-4">Módulo no encontrado.</p>';
    }
}

// 3. ACTUALIZAR loadDocumentosTab (MODO RRHH)
async function loadDocumentosTab(container) {
    // --- CONFIGURACIÓN RRHH ---
    const REQUIRED_DOCS = [
        { id: 'contrato', label: 'Contrato Laboral', icon: 'fa-file-signature', color: 'text-blue-600', bg: 'bg-blue-50' },
        { id: 'cedula', label: 'Cédula Ciudadanía', icon: 'fa-id-card', color: 'text-indigo-600', bg: 'bg-indigo-50' },
        { id: 'hoja_vida', label: 'Hoja de Vida', icon: 'fa-user-tie', color: 'text-slate-600', bg: 'bg-slate-50' },
        { id: 'examen_medico', label: 'Examen Médico (Ingreso)', icon: 'fa-user-doctor', color: 'text-emerald-600', bg: 'bg-emerald-50' },
        { id: 'certificados', label: 'Certificados (ARL, EPS, CCF)', icon: 'fa-file-shield', color: 'text-rose-600', bg: 'bg-rose-50' }
        // Nota: "Otros" se maneja dinámicamente para permitir múltiples
    ];

    const currentYear = new Date().getFullYear();

    container.innerHTML = `
        <div class="max-w-6xl mx-auto space-y-6">
            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                <label class="block text-xs font-bold text-gray-500 uppercase mb-2">Buscar Colaborador (RRHH)</label>
                <div class="relative mt-1">
                    <input type="text" id="docs-employee-search" 
                        class="block w-full p-3 border border-gray-300 rounded-lg leading-5 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm transition-shadow shadow-sm" 
                        placeholder="Escribe el nombre o número de cédula...">
                </div>
                <div id="docs-search-results" class="hidden absolute z-20 bg-white border border-gray-200 rounded-lg shadow-xl mt-1 w-full max-w-2xl max-h-60 overflow-y-auto"></div>
            </div>

            <div id="selected-expediente-container" class="hidden space-y-6">
                <div class="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                    <div>
                        <h3 id="expediente-user-name" class="font-bold text-gray-800 text-lg">Nombre Colaborador</h3>
                        <p class="text-xs text-gray-500">Expediente Laboral (RRHH)</p>
                    </div>
                    <div class="flex items-center gap-2">
                        <label class="text-sm font-bold text-gray-600">Vigencia:</label>
                        <select id="expediente-year-filter" class="border border-indigo-300 bg-indigo-50 text-indigo-900 font-bold text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2">
                            <option value="${currentYear + 1}">${currentYear + 1}</option>
                            <option value="${currentYear}" selected>${currentYear}</option>
                            <option value="${currentYear - 1}">${currentYear - 1}</option>
                        </select>
                    </div>
                </div>

                <div id="documents-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"></div>
                
                <div class="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                    <div class="flex justify-between items-center mb-4">
                        <h4 class="font-bold text-gray-700 flex items-center"><i class="fa-solid fa-folder-open mr-2 text-gray-400"></i> Otros Documentos</h4>
                        <button id="btn-upload-other" class="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-2 px-3 rounded flex items-center transition-colors">
                            <i class="fa-solid fa-plus mr-1"></i> Agregar Otro
                        </button>
                    </div>
                    <div id="documents-others-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        </div>
                </div>
            </div>
            
            <div id="initial-state-msg" class="bg-slate-50 rounded-xl border-2 border-dashed border-slate-300 p-10 text-center min-h-[300px] flex flex-col items-center justify-center">
                <div class="bg-white p-5 rounded-full shadow-sm mb-4"><i class="fa-solid fa-folder-tree text-5xl text-indigo-200"></i></div>
                <h4 class="text-slate-600 font-bold text-lg">Selecciona un colaborador</h4>
            </div>
        </div>
        
        <input type="file" id="global-doc-upload" class="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp">
    `;

    // Referencias DOM
    const searchInput = document.getElementById('docs-employee-search');
    const resultsBox = document.getElementById('docs-search-results');
    const expedienteContainer = document.getElementById('selected-expediente-container');
    const initialStateMsg = document.getElementById('initial-state-msg');
    const gridContainer = document.getElementById('documents-grid');
    const othersGridContainer = document.getElementById('documents-others-grid');
    const yearFilter = document.getElementById('expediente-year-filter');
    const fileInput = document.getElementById('global-doc-upload');
    const userNameLabel = document.getElementById('expediente-user-name');
    const btnUploadOther = document.getElementById('btn-upload-other');

    let selectedUserId = null;
    let activeSlotId = null;

    // --- LÓGICA BUSCADOR (CORREGIDA) ---
    const usersMap = _getUsersMap();

    // CORRECCIÓN: Convertimos el Map a un array asegurándonos de incluir el 'id'
    const usersArray = Array.from(usersMap.entries())
        .map(([id, data]) => ({ id: id, ...data })) // <-- AQUÍ ESTABA EL PROBLEMA
        .filter(u => u.status === 'active');

    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        resultsBox.innerHTML = '';
        if (term.length < 2) { resultsBox.classList.add('hidden'); return; }

        const filtered = usersArray.filter(u =>
            `${u.firstName} ${u.lastName}`.toLowerCase().includes(term) ||
            (u.idNumber && u.idNumber.includes(term))
        );

        if (filtered.length === 0) resultsBox.innerHTML = '<div class="p-3 text-sm text-gray-500">No encontrado</div>';
        else {
            filtered.forEach(user => {
                const div = document.createElement('div');
                div.className = "p-3 hover:bg-indigo-50 cursor-pointer border-b border-gray-100 flex items-center gap-3";

                // Validación de iniciales para evitar errores si faltan nombres
                const initials = (user.firstName?.[0] || '') + (user.lastName?.[0] || '');

                div.innerHTML = `
                    <div class="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 text-xs font-bold">${initials}</div>
                    <div>
                        <p class="text-sm font-bold text-gray-800">${user.firstName} ${user.lastName}</p>
                        <p class="text-xs text-gray-500">CC: ${user.idNumber || 'N/A'}</p>
                    </div>
                `;

                div.onclick = () => {
                    // Ahora 'user.id' SÍ existe gracias al mapeo de arriba
                    if (!user.id) {
                        console.error("Error: Usuario sin ID", user);
                        alert("Error al seleccionar usuario.");
                        return;
                    }
                    searchInput.value = `${user.firstName} ${user.lastName}`;
                    resultsBox.classList.add('hidden');
                    loadUserExpediente(user.id, user.firstName + ' ' + user.lastName);
                };
                resultsBox.appendChild(div);
            });
        }
        resultsBox.classList.remove('hidden');
    });

    // --- CARGA DE EXPEDIENTE ---
    const loadUserExpediente = (userId, userName) => {
        selectedUserId = userId;
        userNameLabel.textContent = userName;
        initialStateMsg.classList.add('hidden');
        expedienteContainer.classList.remove('hidden');
        renderSlots(yearFilter.value);
    };

    const renderSlots = async (year) => {
        gridContainer.innerHTML = `<div class="col-span-full text-center py-4"><div class="loader-small mx-auto"></div></div>`;
        othersGridContainer.innerHTML = '';

        try {
            const q = query(collection(_db, "users", selectedUserId, "documents"));
            const snapshot = await getDocs(q);
            const docsMap = new Map(); // Para fijos
            const otherDocs = [];      // Para otros

            snapshot.forEach(docSnap => {
                const data = docSnap.data();
                let docYear = data.year || (data.uploadedAt ? data.uploadedAt.toDate().getFullYear() : null);

                if (String(docYear) === String(year)) {
                    if (data.category === 'otros_rrhh') {
                        otherDocs.push({ id: docSnap.id, ...data });
                    } else {
                        docsMap.set(data.category, { id: docSnap.id, ...data });
                    }
                }
            });

            gridContainer.innerHTML = '';

            // A. RENDERIZAR DOCUMENTOS FIJOS
            REQUIRED_DOCS.forEach(slot => {
                const existingDoc = docsMap.get(slot.id);
                const card = createDocCard(slot, existingDoc, year);
                gridContainer.appendChild(card);
            });

            // B. RENDERIZAR OTROS (Múltiples)
            if (otherDocs.length === 0) {
                othersGridContainer.innerHTML = `<p class="col-span-full text-center text-xs text-gray-400 italic py-4">No hay documentos adicionales para este año.</p>`;
            } else {
                otherDocs.forEach(doc => {
                    // Creamos un objeto slot simulado para usar la misma función de renderizado
                    const slotSim = { id: 'otros_rrhh', label: doc.description || 'Otro Documento', icon: 'fa-file', color: 'text-gray-600', bg: 'bg-gray-100' };
                    const card = createDocCard(slotSim, doc, year, true);
                    othersGridContainer.appendChild(card);
                });
            }

        } catch (error) {
            console.error(error);
            gridContainer.innerHTML = `<p class="text-red-500">Error cargando.</p>`;
        }
    };

    // Helper para crear tarjetas
    const createDocCard = (slot, existingDoc, year, isOther = false) => {
        const card = document.createElement('div');

        if (existingDoc) {
            // --- ESTADO: LLENO (DOCUMENTO EXISTE) ---
            const dateStr = existingDoc.uploadedAt ? existingDoc.uploadedAt.toDate().toLocaleDateString('es-CO') : 'N/A';
            let fileIcon = existingDoc.type?.includes('pdf') ? 'fa-file-pdf text-red-500' : 'fa-file-image text-blue-500';

            card.className = "bg-white border border-gray-200 rounded-xl p-3 shadow-sm hover:shadow-md transition-all relative group overflow-hidden";
            card.innerHTML = `
                <div class="absolute top-0 left-0 w-1 h-full bg-green-500"></div>
                <div class="flex justify-between items-start mb-2 pl-2">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-lg ${slot.bg} flex items-center justify-center"><i class="fa-solid ${slot.icon} ${slot.color}"></i></div>
                        <div>
                            <h5 class="text-xs font-bold text-gray-800 truncate max-w-[120px]" title="${isOther ? existingDoc.description : slot.label}">${isOther ? existingDoc.description : slot.label}</h5>
                            <span class="text-[9px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-bold">CARGADO</span>
                        </div>
                    </div>
                    <i class="fa-solid ${fileIcon}"></i>
                </div>
                <div class="pl-2 mb-2"><p class="text-[10px] text-gray-400">Subido: ${dateStr}</p></div>
                <div class="flex gap-2 pl-2">
                    <a href="${existingDoc.url}" target="_blank" class="flex-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[10px] font-bold py-1.5 rounded text-center transition-colors">Ver</a>
                    <button class="btn-delete-doc flex-1 bg-red-50 hover:bg-red-100 text-red-600 text-[10px] font-bold py-1.5 rounded text-center transition-colors" 
                        data-id="${existingDoc.id}" data-path="${existingDoc.storagePath}">Borrar</button>
                </div>`;

            // LISTENER DE BORRADO (CORREGIDO AQUÍ)
            card.querySelector('.btn-delete-doc').addEventListener('click', () => {
                // Usamos la variable con guion bajo que definimos al inicio del módulo
                if (_openConfirmModal) {
                    _openConfirmModal(`¿Eliminar este documento de forma permanente?`, async () => {
                        try {
                            // Usamos _storage y _db (variables del módulo)
                            await deleteObject(ref(_storage, existingDoc.storagePath));
                            await deleteDoc(doc(_db, "users", selectedUserId, "documents", existingDoc.id));

                            window.showToast("Documento eliminado.", "success");

                            // Registrar auditoría si existe la función
                            if (window.logAuditAction) {
                                window.logAuditAction("Eliminar Doc RRHH", `Borrado: ${existingDoc.name}`, selectedUserId);
                            }

                            renderSlots(year); // Recargar la vista
                        } catch (e) {
                            console.error(e);
                            window.showToast("Error al eliminar.", "error");
                        }
                    });
                } else {
                    // Fallback de emergencia por si la función no se inyectó
                    if (confirm("¿Eliminar este documento?")) {
                        // Misma lógica de borrado...
                        // (Por brevedad, mejor asegurar que _openConfirmModal esté bien iniciada)
                    }
                }
            });

        } else {
            // --- ESTADO: VACÍO (SUBIR) ---
            card.className = "border-2 border-dashed border-gray-300 rounded-xl p-4 flex flex-col items-center justify-center text-center hover:border-indigo-400 hover:bg-indigo-50 transition-all cursor-pointer group min-h-[140px]";
            card.innerHTML = `
                <i class="fa-solid ${slot.icon} text-gray-300 group-hover:text-indigo-500 text-2xl mb-2"></i>
                <h5 class="text-xs font-bold text-gray-500 group-hover:text-indigo-800">${slot.label}</h5>
                <p class="text-[10px] text-gray-400 mt-1">Vacío</p>
            `;
            card.onclick = () => {
                activeSlotId = slot.id;
                fileInput.click();
            };
        }
        return card;
    };

    // Listeners Subida
    btnUploadOther.addEventListener('click', () => {
        activeSlotId = 'otros_rrhh';
        fileInput.click();
    });

    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file || !activeSlotId) return;

        // Si cancela el modal, necesitamos limpiar el input para poder reintentar
        const resetInput = () => { fileInput.value = ''; activeSlotId = null; };

        const selectedYear = yearFilter.value;

        // Lógica para "Otros Documentos"
        let description = 'Documento RRHH';

        if (activeSlotId === 'otros_rrhh') {
            // USAMOS EL NUEVO MODAL FLOTANTE
            description = await openCustomInputModal(
                "Nuevo Documento Adicional",
                "Descripción del documento:",
                "text",
                "Ej: Memo Disciplinario, Carta de Recomendación..."
            );

            if (!description) { resetInput(); return; } // Si el usuario canceló
        } else {
            // Si es fijo (Cédula, Contrato), usamos la etiqueta predefinida
            const slot = REQUIRED_DOCS.find(s => s.id === activeSlotId);
            if (slot) description = slot.label;
        }

        window.showToast("Subiendo documento...", "info");

        try {
            const storagePath = `expedientes/${selectedUserId}/${selectedYear}/${activeSlotId}_${Date.now()}_${file.name}`;
            const storageRef = ref(_storage, storagePath);
            const snap = await uploadBytes(storageRef, file);
            const url = await getDownloadURL(snap.ref);

            await addDoc(collection(_db, "users", selectedUserId, "documents"), {
                name: file.name,
                category: activeSlotId,
                description: description,
                year: parseInt(selectedYear),
                url: url,
                storagePath: storagePath,
                type: file.type,
                uploadedAt: serverTimestamp(),
                uploadedBy: _getCurrentUserId()
            });

            window.showToast("Documento guardado exitosamente.", "success");
            renderSlots(selectedYear);

        } catch (error) {
            console.error(error);
            window.showToast("Error al subir archivo.", "error");
        } finally {
            resetInput();
        }
    });

    yearFilter.addEventListener('change', (e) => renderSlots(e.target.value));
}


// ==============================================================
//       MÓDULO SST: CENTRO DE CONTROL (NUEVA ESTRUCTURA)
// ==============================================================

/**
 * Carga el "Shell" del Centro de Control SST con navegación interna.
 */
function loadSSTTab(container) {
    // 1. Estructura del Menú Principal SST
    container.innerHTML = `
        <div class="bg-white p-6 rounded-lg shadow-md min-h-[600px]">
            
            <div class="flex flex-col md:flex-row justify-between items-center mb-6 border-b border-gray-100 pb-4 gap-4">
                <div>
                    <h2 class="text-2xl font-bold text-gray-800 flex items-center">
                        <i class="fa-solid fa-shield-halved text-emerald-500 mr-3"></i>
                        Centro de Control SG-SST
                    </h2>
                    <p class="text-sm text-gray-500 mt-1">Gestión integral de seguridad y salud en el trabajo.</p>
                </div>
                
                <div id="sst-nav-buttons" class="flex bg-gray-100 p-1 rounded-lg">
                    <button data-subtab="general" class="sst-nav-btn px-4 py-2 text-sm font-bold rounded-md text-gray-600 hover:text-emerald-600 transition-all">
                        <i class="fa-solid fa-folder-open mr-2"></i> Documentación
                    </button>
                    <button data-subtab="colaboradores" class="sst-nav-btn px-4 py-2 text-sm font-bold rounded-md text-gray-600 hover:text-blue-600 transition-all">
                        <i class="fa-solid fa-users-viewfinder mr-2"></i> Seguimiento
                    </button>
                    <button data-subtab="dotacion" class="sst-nav-btn px-4 py-2 text-sm font-bold rounded-md text-gray-600 hover:text-yellow-600 transition-all">
                        <i class="fa-solid fa-helmet-safety mr-2"></i> Dotación (EPP)
                    </button>
                </div>
            </div>

            <div id="sst-content-area" class="relative">
                </div>
        </div>
    `;

    // 2. Configurar Listeners del Menú SST
    const navContainer = document.getElementById('sst-nav-buttons');
    navContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.sst-nav-btn');
        if (btn) {
            switchSSTSubTab(btn.dataset.subtab);
        }
    });

    // 3. Cargar pestaña por defecto (General)
    switchSSTSubTab('general');
}

/**
 * Cambia entre las sub-pestañas de SST.
 */
function switchSSTSubTab(subTabName) {
    // A. Limpiar listeners anteriores (para evitar fugas de memoria en Dotación)
    if (unsubscribeEmpleadosTab) {
        unsubscribeEmpleadosTab();
        unsubscribeEmpleadosTab = null;
    }

    // B. Actualizar Estilos de Botones
    document.querySelectorAll('.sst-nav-btn').forEach(btn => {
        if (btn.dataset.subtab === subTabName) {
            btn.classList.add('bg-white', 'shadow-sm', 'text-gray-800');
            btn.classList.remove('text-gray-600', 'hover:text-emerald-600'); // Limpiar hovers específicos si quieres
        } else {
            btn.classList.remove('bg-white', 'shadow-sm', 'text-gray-800');
            btn.classList.add('text-gray-600');
        }
    });

    // C. Renderizar Contenido
    const contentArea = document.getElementById('sst-content-area');
    contentArea.innerHTML = '<div class="py-20 text-center"><div class="loader mx-auto"></div></div>';

    switch (subTabName) {
        case 'general':
            loadSSTGeneralSubTab(contentArea);
            break;
        case 'colaboradores':
            loadSSTColaboradoresSubTab(contentArea);
            break;
        case 'dotacion':
            loadSSTDotacionSubTab(contentArea);
            break;
    }
}

// ----------------------------------------------------------
// SUB-MÓDULO 1: DOCUMENTACIÓN GENERAL (LÓGICA COMPLETA)
// ----------------------------------------------------------
function loadSSTGeneralSubTab(container) {
    // 1. CONFIGURACIÓN DE CATEGORÍAS SG-SST POR DEFECTO
    const SST_CATEGORIES = [
        { id: 'politicas', label: 'Políticas y Reglamentos', icon: 'fa-scale-balanced', color: 'text-blue-650', bg: 'bg-blue-50' },
        { id: 'matriz', label: 'Matriz de Riesgos (IPERC)', icon: 'fa-table-list', color: 'text-orange-655', bg: 'bg-orange-50' },
        { id: 'emergencias', label: 'Plan de Emergencias', icon: 'fa-truck-medical', color: 'text-red-655', bg: 'bg-red-50' },
        { id: 'copasst', label: 'Actas COPASST / Vigía', icon: 'fa-users-line', color: 'text-indigo-650', bg: 'bg-indigo-50' },
        { id: 'capacitacion', label: 'Plan de Capacitación', icon: 'fa-chalkboard-user', color: 'text-emerald-650', bg: 'bg-emerald-50' },
        { id: 'legal', label: 'Requisitos Legales', icon: 'fa-gavel', color: 'text-slate-650', bg: 'bg-slate-50' },
        { id: 'otros_sst', label: 'Otros Documentos SST', icon: 'fa-folder-open', color: 'text-gray-650', bg: 'bg-gray-50' }
    ];

    let activeFolderId = null;
    let currentDocsSnapshot = null;

    // 2. SHELL INICIAL DEL REPOSITORIO
    container.innerHTML = `
        <div class="space-y-6">
            <!-- BANNER PRINCIPAL -->
            <div class="bg-indigo-50 border-l-4 border-indigo-500 p-4 rounded-r-lg flex justify-between items-center">
                <div>
                    <h4 class="text-indigo-900 font-bold text-sm">Repositorio Central SG-SST</h4>
                    <p class="text-indigo-700 text-xs mt-1">Los documentos cargados aquí son visibles para la gestión de Seguridad y Salud en el Trabajo.</p>
                </div>
                <div class="flex items-center gap-2">
                     <span id="sst-total-docs" class="bg-white text-indigo-600 px-3 py-1 rounded-full text-xs font-bold shadow-sm">0 Archivos</span>
                     <button id="btn-create-folder" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs py-2 px-3.5 rounded-xl shadow-md hover:shadow-lg transition-all flex items-center gap-1.5">
                         <i class="fa-solid fa-folder-plus text-xs"></i> Nueva Carpeta
                     </button>
                </div>
            </div>

            <!-- CONTENEDOR DINÁMICO DE CONTENIDO (Carpetas o Archivos) -->
            <div id="sst-dynamic-area" class="space-y-6">
                <!-- Carga dinámica -->
            </div>
        </div>
        <input type="file" id="sst-doc-upload" class="hidden" accept=".pdf,.jpg,.jpeg,.png,.xlsx,.docx">
    `;

    const dynamicArea = document.getElementById('sst-dynamic-area');
    const fileInput = document.getElementById('sst-doc-upload');
    const totalCountEl = document.getElementById('sst-total-docs');

    // 3. RENDERIZADO DEL REPOSITORIO (0MS NAVIGATION DESDE MEMORIA)
    const renderSSTRepository = () => {
        if (!currentDocsSnapshot || !dynamicArea) return;

        // Mezclar categorías por defecto con carpetas personalizadas cargadas desde Firestore (mismo snapshot)
        const mergedCategories = [...SST_CATEGORIES];
        
        // Identificar carpetas personalizadas en el snapshot de documentos
        currentDocsSnapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (data.isFolder) {
                if (!mergedCategories.some(c => c.id === data.id)) {
                    mergedCategories.push({
                        id: data.id,
                        label: data.label,
                        icon: data.icon || 'fa-folder-closed',
                        color: data.color || 'text-indigo-500',
                        bg: data.bg || 'bg-indigo-50',
                        isCustom: true,
                        createdAt: data.uploadedAt
                    });
                }
            }
        });

        // Filtrar y agrupar en memoria (ignora archivados y carpetas en el listado de archivos)
        let activeDocsCount = 0;
        const docsByCategory = {};
        mergedCategories.forEach(cat => docsByCategory[cat.id] = []);

        currentDocsSnapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (data.isFolder) return; // Omitir carpetas del conteo de archivos
            if (data.status === 'archived') return; // Filtro in-memory de archivados
            
            activeDocsCount++;
            const targetCat = docsByCategory[data.category] ? data.category : 'otros_sst';
            if (docsByCategory[targetCat]) {
                docsByCategory[targetCat].push({ id: docSnap.id, ...data });
            }
        });

        totalCountEl.textContent = `${activeDocsCount} Archivos`;

        if (activeFolderId === null) {
            // ==========================================
            // VISTA 1: LISTADO DE CARPETAS (TIPO DRIVE)
            // ==========================================
            let foldersHtml = `
                <div class="bg-white p-4 rounded-xl shadow-sm border border-gray-250 flex items-center gap-3">
                    <div class="relative flex-grow group">
                        <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400 group-focus-within:text-indigo-500 transition-colors">
                            <i class="fa-solid fa-magnifying-glass text-sm"></i>
                        </div>
                        <input type="text" id="sst-global-search" 
                            class="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none" 
                            placeholder="Buscar documentos por nombre o descripción en todo el repositorio...">
                    </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6" id="folders-grid">
            `;

            mergedCategories.forEach(cat => {
                const filesCount = docsByCategory[cat.id].length;
                foldersHtml += `
                    <div class="folder-card bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex items-center justify-between cursor-pointer hover:border-indigo-400 hover:shadow-md hover:-translate-y-1 transition-all duration-300" data-folder-id="${cat.id}">
                        <div class="flex items-center gap-4 min-w-0">
                            <!-- Icono de Carpeta Tipo Drive -->
                            <div class="w-14 h-14 rounded-2xl ${cat.bg} flex items-center justify-center text-3xl shrink-0 border border-gray-100 shadow-inner">
                                <i class="fa-solid fa-folder-closed text-amber-500"></i>
                            </div>
                            <div class="min-w-0">
                                <h5 class="font-bold text-gray-800 text-sm truncate" title="${cat.label}">${cat.label}</h5>
                                <span class="text-xs text-gray-500 font-semibold">${filesCount} documentos</span>
                            </div>
                        </div>
                        <div class="text-gray-300 hover:text-indigo-600 transition-colors pl-2 shrink-0">
                            <i class="fa-solid fa-chevron-right text-sm"></i>
                        </div>
                    </div>
                `;
            });

            foldersHtml += `</div>`;
            dynamicArea.innerHTML = foldersHtml;

            // Listener para crear nueva carpeta
            document.getElementById('btn-create-folder').style.display = ''; // Mostrar el botón
            document.getElementById('btn-create-folder').onclick = async () => {
                if (typeof openCustomInputModal !== 'function') {
                    const name = prompt("Nombre de la nueva carpeta:");
                    if (name && name.trim()) {
                        try {
                            await addDoc(collection(_db, "company_documents"), {
                                system: 'sst',
                                isFolder: true,
                                id: 'custom_' + Date.now(),
                                label: name.trim(),
                                icon: 'fa-folder-closed',
                                color: 'text-indigo-500',
                                bg: 'bg-indigo-50',
                                isCustom: true,
                                uploadedAt: serverTimestamp()
                            });
                            window.showToast("Carpeta creada correctamente.", "success");
                        } catch (e) {
                            console.error(e);
                        }
                    }
                    return;
                }

                const folderName = await openCustomInputModal(
                    "Nueva Carpeta SST",
                    "Escribe el nombre de la nueva carpeta:",
                    "text",
                    "Ej: Registros de Inspección..."
                );

                if (!folderName || !folderName.trim()) return;

                const folderId = 'custom_' + Date.now();
                try {
                    await addDoc(collection(_db, "company_documents"), {
                        system: 'sst',
                        isFolder: true,
                        id: folderId,
                        label: folderName.trim(),
                        icon: 'fa-folder-closed',
                        color: 'text-indigo-500',
                        bg: 'bg-indigo-50',
                        isCustom: true,
                        uploadedAt: serverTimestamp()
                    });
                    window.showToast("Carpeta creada correctamente.", "success");
                } catch (err) {
                    console.error("Error al crear carpeta:", err);
                    window.showToast("Error al crear: " + err.message, "error");
                }
            };

            // Listeners para abrir carpetas
            dynamicArea.querySelectorAll('.folder-card').forEach(card => {
                card.addEventListener('click', () => {
                    activeFolderId = card.dataset.folderId;
                    renderSSTRepository();
                });
            });

            // Buscador Global en tiempo real
            const globalSearch = document.getElementById('sst-global-search');
            globalSearch.addEventListener('input', (e) => {
                const term = e.target.value.toLowerCase();
                const cards = dynamicArea.querySelectorAll('.folder-card');
                
                cards.forEach(card => {
                    const catId = card.dataset.folderId;
                    const catFiles = docsByCategory[catId];
                    const catLabel = mergedCategories.find(c => c.id === catId)?.label.toLowerCase() || '';
                    
                    const matchesFiles = catFiles.some(file => 
                        file.name.toLowerCase().includes(term) || 
                        (file.description && file.description.toLowerCase().includes(term))
                    );

                    if (catLabel.includes(term) || matchesFiles) {
                        card.style.display = '';
                    } else {
                        card.style.display = 'none';
                    }
                });
            });

        } else {
            // ==========================================
            // VISTA 2: DENTRO DE UNA CARPETA (TIPO DRIVE)
            // ==========================================
            const currentCat = mergedCategories.find(c => c.id === activeFolderId);
            const files = docsByCategory[activeFolderId];

            // Ocultar botón de crear carpeta en vista interna
            document.getElementById('btn-create-folder').style.display = 'none';

            let filesHtml = '';
            if (files.length > 0) {
                filesHtml = `
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" id="files-grid">
                        ${files.map(file => {
                            let icon = 'fa-file text-gray-400';
                            if (file.type?.includes('pdf')) icon = 'fa-file-pdf text-red-500';
                            else if (file.type?.includes('sheet') || file.name.endsWith('xlsx')) icon = 'fa-file-excel text-green-600';
                            else if (file.type?.includes('word') || file.name.endsWith('docx')) icon = 'fa-file-word text-blue-600';
                            else if (file.type?.includes('image')) icon = 'fa-file-image text-purple-500';

                            const fileSizeStr = file.size ? (file.size < 1024 * 1024 
                                ? `${(file.size / 1024).toFixed(1)} KB` 
                                : `${(file.size / (1024 * 1024)).toFixed(1)} MB`) : 'N/A';

                            const dateStr = file.uploadedAt ? (file.uploadedAt.toDate ? file.uploadedAt.toDate().toLocaleDateString('es-CO') : new Date(file.uploadedAt).toLocaleDateString('es-CO')) : 'N/A';

                            return `
                                <div class="file-card bg-white p-4 rounded-2xl border border-gray-200 shadow-sm flex flex-col hover:shadow-md hover:border-indigo-200 transition-all group relative" data-name="${file.name.toLowerCase()}" data-desc="${(file.description || '').toLowerCase()}">
                                    <div class="flex items-start justify-between">
                                        <div class="flex items-center gap-3 min-w-0">
                                            <div class="w-10 h-10 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-center text-xl shrink-0 shadow-inner">
                                                <i class="fa-solid ${icon}"></i>
                                            </div>
                                            <div class="min-w-0">
                                                <h6 class="font-bold text-gray-800 text-xs truncate" title="${file.name}">${file.name}</h6>
                                                <span class="text-[9px] text-gray-400 font-semibold">${fileSizeStr} &bull; ${dateStr}</span>
                                            </div>
                                        </div>
                                        
                                        <div class="flex gap-1 shrink-0">
                                            <button class="btn-edit-sst-doc text-gray-400 hover:text-indigo-650 transition-colors p-1.5 rounded-full hover:bg-indigo-50" 
                                                data-id="${file.id}" data-name="${file.name}" data-desc="${file.description || ''}" title="Editar descripción">
                                                <i class="fa-solid fa-pen-to-square text-xs"></i>
                                            </button>
                                            <button class="btn-archive-sst-doc text-gray-300 hover:text-amber-600 transition-colors p-1.5 rounded-full hover:bg-amber-50" 
                                                data-id="${file.id}" data-name="${file.name}" title="Archivar documento">
                                                <i class="fa-solid fa-box-archive text-xs"></i>
                                            </button>
                                        </div>
                                    </div>

                                    <!-- DESCRIPCIÓN DEL ARCHIVO -->
                                    <div class="mt-3 flex-grow bg-slate-50/50 p-2.5 rounded-xl border border-slate-100/50">
                                        <p class="text-[9px] font-bold text-slate-400 uppercase tracking-wide mb-0.5">Descripción</p>
                                        <p class="text-[11px] text-slate-600 italic leading-snug">${file.description || 'Sin descripción detallada.'}</p>
                                    </div>

                                    <!-- BOTÓN DESCARGAR -->
                                    <a href="${file.url}" target="_blank" class="mt-3 w-full bg-slate-50 hover:bg-indigo-50 hover:text-indigo-600 border border-slate-200 hover:border-indigo-100 text-slate-600 text-center font-bold text-[10px] py-1.5 rounded-xl transition-all flex items-center justify-center gap-1">
                                        <i class="fa-solid fa-arrow-down-to-bracket"></i> Ver / Descargar
                                    </a>
                                </div>
                            `;
                        }).join('')}
                    </div>
                `;
            } else {
                filesHtml = `
                    <div class="py-16 text-center bg-white rounded-2xl border border-dashed border-slate-200">
                        <i class="fa-solid fa-folder-open text-slate-300 text-5xl mb-3"></i>
                        <p class="text-sm font-bold text-slate-500">Esta carpeta está vacía</p>
                        <p class="text-xs text-slate-400">Utiliza el formulario superior para añadir tu primer documento.</p>
                    </div>
                `;
            }

            dynamicArea.innerHTML = `
                <!-- BREADCRUMB & CARPETA TITULO -->
                <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                    <button id="btn-back-to-folders" class="text-xs bg-white text-gray-600 border border-slate-250 hover:bg-slate-50 px-3 py-2 rounded-xl font-bold flex items-center gap-1.5 transition-all shadow-sm">
                        <i class="fa-solid fa-arrow-left"></i> Volver a Carpetas
                    </button>
                    <div class="flex items-center gap-2">
                        <div class="w-8 h-8 rounded-lg ${currentCat.bg || 'bg-indigo-50'} flex items-center justify-center text-sm">
                            <i class="fa-solid ${currentCat.icon || 'fa-folder-closed'} ${currentCat.color || 'text-indigo-500'}"></i>
                        </div>
                        <h4 class="font-bold text-gray-800 text-xs uppercase tracking-wider">${currentCat.label}</h4>
                    </div>
                </div>

                <!-- FORMULARIO DE SUBIDA INLINE (PREMIUM) -->
                <div class="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-4">
                    <h5 class="font-black text-xs text-slate-700 uppercase tracking-wider flex items-center gap-2">
                        <i class="fa-solid fa-cloud-arrow-up text-indigo-500"></i> Subir Documento a esta Carpeta
                    </h5>
                    
                    <div class="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                        <!-- Selector de Archivo -->
                        <div class="md:col-span-4">
                            <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Archivo (PDF, Excel, Word, Imagen)</label>
                            <button id="btn-select-file" class="w-full bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 font-bold text-xs py-2 px-3 rounded-xl transition-all flex items-center justify-center gap-2 shadow-sm">
                                <i class="fa-solid fa-file-arrow-up"></i> Seleccionar Archivo
                            </button>
                            <span id="selected-file-label" class="text-[10px] text-slate-400 italic mt-1 block truncate">Ningún archivo seleccionado</span>
                        </div>

                        <!-- Descripción -->
                        <div class="md:col-span-6">
                            <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Descripción del Documento</label>
                            <input type="text" id="sst-file-description" 
                                class="w-full border border-slate-350 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all h-[36px]" 
                                placeholder="Escribe una breve descripción para identificar este archivo rápidamente...">
                        </div>

                        <!-- Botón Enviar -->
                        <div class="md:col-span-2">
                            <button id="btn-do-upload" class="w-full bg-indigo-650 hover:bg-indigo-750 text-white font-bold text-xs py-2 px-4 rounded-xl shadow-md hover:shadow-lg transition-all h-[36px] flex items-center justify-center gap-1.5">
                                <i class="fa-solid fa-paper-plane"></i> Publicar
                            </button>
                        </div>
                    </div>
                </div>

                <!-- BUSCADOR DE ARCHIVOS EN LA CARPETA -->
                <div class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                    <div class="relative group">
                        <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400 group-focus-within:text-indigo-500 transition-colors">
                            <i class="fa-solid fa-magnifying-glass text-sm"></i>
                        </div>
                        <input type="text" id="sst-folder-search" 
                            class="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none" 
                            placeholder="Buscar por nombre o descripción dentro de esta carpeta...">
                    </div>
                </div>

                <!-- LISTADO DE ARCHIVOS -->
                ${filesHtml}
            `;

            // Configurar Listeners de la vista interna
            document.getElementById('btn-back-to-folders').addEventListener('click', () => {
                activeFolderId = null;
                renderSSTRepository();
            });

            // Trigger file input
            const btnSelectFile = document.getElementById('btn-select-file');
            const selectedLabel = document.getElementById('selected-file-label');
            let selectedFile = null;

            btnSelectFile.addEventListener('click', () => {
                fileInput.click();
            });

            fileInput.onchange = (event) => {
                selectedFile = event.target.files[0];
                if (selectedFile) {
                    selectedLabel.textContent = selectedFile.name;
                    selectedLabel.className = "text-[10px] text-indigo-600 font-bold mt-1 block truncate";
                } else {
                    selectedLabel.textContent = "Ningún archivo seleccionado";
                    selectedLabel.className = "text-[10px] text-slate-400 italic mt-1 block truncate";
                }
            };

            // Ejecutar Subida
            const btnDoUpload = document.getElementById('btn-do-upload');
            btnDoUpload.addEventListener('click', async () => {
                if (!selectedFile) {
                    window.showToast("Por favor selecciona un archivo primero.", "error");
                    return;
                }

                if (selectedFile.size > 10 * 1024 * 1024) {
                    window.showToast("El archivo supera los 10MB.", "error");
                    return;
                }

                const descInput = document.getElementById('sst-file-description');
                const descriptionText = descInput.value.trim() || 'Sin descripción detallada.';

                btnDoUpload.disabled = true;
                btnDoUpload.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Subiendo...';

                try {
                    const storagePath = `company_docs/sst/${activeFolderId}/${Date.now()}_${selectedFile.name}`;
                    const storageRef = ref(_storage, storagePath);

                    const snapshot = await uploadBytes(storageRef, selectedFile);
                    const downloadURL = await getDownloadURL(snapshot.ref);

                    await addDoc(collection(_db, "company_documents"), {
                        name: selectedFile.name,
                        system: 'sst',
                        category: activeFolderId,
                        url: downloadURL,
                        storagePath: storagePath,
                        type: selectedFile.type,
                        size: selectedFile.size,
                        uploadedAt: serverTimestamp(),
                        uploadedBy: _getCurrentUserId(),
                        description: descriptionText
                    });

                    window.showToast("Documento publicado correctamente.", "success");
                    
                    selectedFile = null;
                    fileInput.value = '';
                    selectedLabel.textContent = "Ningún archivo seleccionado";
                    selectedLabel.className = "text-[10px] text-slate-400 italic mt-1 block truncate";
                    descInput.value = '';

                } catch (err) {
                    console.error("Error subiendo doc SST:", err);
                    window.showToast("Error en la carga: " + err.message, "error");
                } finally {
                    btnDoUpload.disabled = false;
                    btnDoUpload.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Publicar';
                }
            });

            // Buscador interno en tiempo real
            const folderSearch = document.getElementById('sst-folder-search');
            folderSearch.addEventListener('input', (e) => {
                const term = e.target.value.toLowerCase();
                const fileCards = dynamicArea.querySelectorAll('.file-card');
                fileCards.forEach(card => {
                    const name = card.dataset.name || '';
                    const desc = card.dataset.desc || '';
                    if (name.includes(term) || desc.includes(term)) {
                        card.style.display = '';
                    } else {
                        card.style.display = 'none';
                    }
                });
            });

            // Listeners: Editar Descripción
            dynamicArea.querySelectorAll('.btn-edit-sst-doc').forEach(btn => {
                btn.addEventListener('click', async function () {
                    const docId = this.dataset.id;
                    const name = this.dataset.name;
                    const oldDesc = this.dataset.desc || '';

                    if (typeof openCustomInputModal !== 'function') {
                        const newD = prompt("Nueva descripción:", oldDesc);
                        if (newD !== null) {
                            try {
                                await updateDoc(doc(_db, "company_documents", docId), {
                                    description: newD.trim() || 'Sin descripción detallada.'
                                });
                                window.showToast("Descripción actualizada.", "success");
                            } catch (e) { console.error(e); }
                        }
                        return;
                    }

                    const newDesc = await openCustomInputModal(
                        "Editar Descripción",
                        `Nueva descripción para "${name}":`,
                        "text",
                        oldDesc
                    );

                    if (newDesc === null) return;

                    try {
                        await updateDoc(doc(_db, "company_documents", docId), {
                            description: newDesc.trim() || 'Sin descripción detallada.'
                        });
                        window.showToast("Descripción actualizada.", "success");

                        if (typeof window.logAuditAction === 'function') {
                            window.logAuditAction("Editar Doc SST", `Descripción de "${name}" editada`, _getCurrentUserId());
                        }
                    } catch (err) {
                        console.error(err);
                        window.showToast("Error al editar descripción.", "error");
                    }
                });
            });

            // Listeners: Archivar Archivos (Ya no se eliminan!)
            dynamicArea.querySelectorAll('.btn-archive-sst-doc').forEach(btn => {
                btn.addEventListener('click', function () {
                    const docId = this.dataset.id;
                    const name = this.dataset.name;

                    if (_openConfirmModal) {
                        _openConfirmModal(`¿Archivar "${name}"? El documento dejará de ser visible en el repositorio activo pero se conservará en el archivo histórico.`, async () => {
                            try {
                                await updateDoc(doc(_db, "company_documents", docId), {
                                    status: 'archived',
                                    archivedAt: serverTimestamp(),
                                    archivedBy: _getCurrentUserId()
                                });

                                window.showToast("Documento archivado.", "success");
                                
                                if (typeof window.logAuditAction === 'function') {
                                    window.logAuditAction("Archivar Doc SST", `Archivado: ${name}`, _getCurrentUserId());
                                }

                            } catch (e) {
                                console.error(e);
                                window.showToast("Error al archivar.", "error");
                            }
                        });
                    }
                });
            });
        }
    };

    // 4. SUSCRIPCIÓN EN TIEMPO REAL A DOCUMENTOS (QUE AHORA INCLUYEN LAS CARPETAS PERSONALIZADAS)
    const qDocs = query(collection(_db, "company_documents"), where("system", "==", "sst"), orderBy("uploadedAt", "desc"));

    const unsubscribeDocs = onSnapshot(qDocs, (snapshot) => {
        currentDocsSnapshot = snapshot;
        renderSSTRepository();
    }, (error) => {
        console.error("Error cargando docs SST:", error);
    });

    // Limpiar suscripciones concurrentes
    unsubscribeEmpleadosTab = () => {
        unsubscribeDocs();
    };
}



// ----------------------------------------------------------
// SUB-MÓDULO 2: SEGUIMIENTO COLABORADORES (CORREGIDO)
// ----------------------------------------------------------
async function loadSSTColaboradoresSubTab(container) {
    // 1. ESTRUCTURA DE LA TABLA
    container.innerHTML = `
        <div class="space-y-4">
            <div class="flex justify-between items-center bg-white p-4 rounded-lg shadow-sm border border-gray-200">
                <h3 class="font-bold text-gray-700"><i class="fa-solid fa-traffic-light mr-2 text-blue-500"></i> Estado de Cumplimiento</h3>
                <input type="text" id="sst-colab-search" class="border border-gray-300 rounded-lg px-4 py-2 text-sm focus:ring-blue-500 focus:border-blue-500" placeholder="Filtrar empleado...">
            </div>

            <div class="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                <div class="overflow-x-auto">
                    <table class="w-full text-sm text-left">
                        <thead class="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                            <tr>
                                <th class="px-4 py-3">Colaborador</th>
                                <th class="px-4 py-3 text-center">Curso Alturas</th>
                                <th class="px-4 py-3 text-center">Examen Médico</th>
                                <th class="px-4 py-3 text-center">Inducción SST</th>
                                <th class="px-4 py-3 text-center">Acción</th>
                            </tr>
                        </thead>
                        <tbody id="sst-colab-table-body" class="divide-y divide-gray-100">
                            <tr><td colspan="5" class="text-center py-10"><div class="loader mx-auto"></div></td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    const tableBody = document.getElementById('sst-colab-table-body');
    const searchInput = document.getElementById('sst-colab-search');

    // --- CAMBIO 1: Cargar Configuración de Alertas ---
    let diasAlerta = 45; // Valor por defecto
    try {
        const configSnap = await getDoc(doc(_db, "config", "general"));
        if (configSnap.exists() && configSnap.data().alertas) {
            diasAlerta = configSnap.data().alertas.diasVencimientoSST || 45;
        }
    } catch (e) { console.warn("Usando alerta por defecto (45 días)", e); }
    // -----------------------------------------------

    const usersMap = _getUsersMap();

    // Mapeamos entries() para asegurar que el ID vaya dentro del objeto y filtramos administradores
    const activeUsers = Array.from(usersMap.entries())
        .map(([id, data]) => ({ id: id, ...data }))
        .filter(u => u.status === 'active' && u.role !== 'admin' && u.role !== 'administrador');

    tableBody.innerHTML = '';

    if (activeUsers.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-gray-400">No hay colaboradores activos.</td></tr>';
        return;
    }

    const roleMap = {
        'admin': 'Administrador',
        'administrador': 'Administrador',
        'sst': 'Responsable SST',
        'nomina': 'Gestor de Nómina',
        'bodega': 'Auxiliar de Bodega',
        'operario': 'Operario'
    };

    for (const user of activeUsers) {
        if (!user.id) continue;

        const tr = document.createElement('tr');
        tr.className = "hover:bg-blue-50 transition-colors group";
        tr.dataset.name = `${user.firstName || ''} ${user.lastName || ''} ${user.idNumber || ''}`.toLowerCase();

        const initials = (user.firstName?.[0] || '') + (user.lastName?.[0] || '');
        const roleDisplay = roleMap[user.role] || (user.role ? (user.role.charAt(0).toUpperCase() + user.role.slice(1)) : 'Operario');

        tr.innerHTML = `
            <td class="px-4 py-3 font-medium text-gray-900">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-600">
                        ${initials}
                    </div>
                    <div>
                        <p>${user.firstName} ${user.lastName}</p>
                        <p class="text-[10px] text-gray-400 font-medium">${roleDisplay}</p>
                    </div>
                </div>
            </td>
            <td class="px-4 py-3 text-center" id="status-alturas-${user.id}"><div class="loader-small mx-auto"></div></td>
            <td class="px-4 py-3 text-center" id="status-medico-${user.id}"><div class="loader-small mx-auto"></div></td>
            <td class="px-4 py-3 text-center" id="status-induccion-${user.id}"><div class="loader-small mx-auto"></div></td>
            <td class="px-4 py-3 text-center">
                <button class="btn-manage-sst text-blue-600 hover:bg-blue-100 p-2 rounded-full transition-colors" title="Gestionar Carpeta SST">
                    <i class="fa-solid fa-folder-open"></i>
                </button>
            </td>
        `;

        tr.querySelector('.btn-manage-sst').addEventListener('click', () => {
            loadSSTUserProfile(user.id, container);
        });

        tableBody.appendChild(tr);

        // --- CAMBIO 2: Pasamos 'diasAlerta' a la función ---
        checkUserSSTStatus(user.id, diasAlerta);
    }

    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const rows = tableBody.querySelectorAll('tr');
        rows.forEach(row => {
            const name = row.dataset.name || "";
            row.style.display = name.includes(term) ? '' : 'none';
        });
    });
}

/**
 * Verifica los documentos SST de un usuario y actualiza los semáforos en la tabla.
 */
async function checkUserSSTStatus(userId, alertDays = 30) {
    if (!userId) return;

    try {
        const q = query(collection(_db, "users", userId, "documents"),
            where("category", "in", ["sst_alturas", "sst_medico", "sst_induccion"]));

        const snapshot = await getDocs(q);
        const docs = {};
        snapshot.forEach(d => docs[d.data().category] = d.data());

        // Helper para generar el badge
        const getBadge = (category) => {
            const doc = docs[category];
            if (!doc) return `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700"><i class="fa-solid fa-xmark"></i> Falta</span>`;

            if (doc.expiresAt) {
                const today = new Date(); today.setHours(0, 0, 0, 0);
                const expiration = doc.expiresAt.toDate();
                const diffTime = expiration - today;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                if (diffDays < 0) return `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700" title="Venció el ${expiration.toLocaleDateString()}"><i class="fa-solid fa-triangle-exclamation"></i> Vencido</span>`;

                // --- USAMOS LA VARIABLE DINÁMICA AQUÍ ---
                if (diffDays <= alertDays) return `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-yellow-100 text-yellow-800" title="Vence en ${diffDays} días (Alerta: ${alertDays}d)"><i class="fa-solid fa-clock"></i> Vence pronto</span>`;
            }

            return `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-green-100 text-green-700"><i class="fa-solid fa-check"></i> Al día</span>`;
        };

        const cellAlturas = document.getElementById(`status-alturas-${userId}`);
        const cellMedico = document.getElementById(`status-medico-${userId}`);
        const cellInduccion = document.getElementById(`status-induccion-${userId}`);

        if (cellAlturas) cellAlturas.innerHTML = getBadge('sst_alturas');
        if (cellMedico) cellMedico.innerHTML = getBadge('sst_medico');
        if (cellInduccion) cellInduccion.innerHTML = getBadge('sst_induccion');

    } catch (error) {
        console.error(`Error loading SST for ${userId}`, error);
    }
}

/**
 * Vista Detallada de Gestión SST para un Usuario.
 * CORREGIDO: Ahora usa 'sst_induccion' en lugar de 'sst_aptitud' para coincidir con la tabla.
 */
async function loadSSTUserProfile(userId, container) {
    const usersMap = _getUsersMap();
    const rawUserData = usersMap.get(userId);

    if (!rawUserData) {
        container.innerHTML = `<div class="p-10 text-center text-red-500">Error: Usuario no encontrado en el sistema local.</div>`;
        return;
    }

    const user = { id: userId, ...rawUserData };

    // --- CORRECCIÓN AQUÍ: CAMBIAMOS LOS IDs DE LAS CATEGORÍAS ---
    const SST_USER_CATS = [
        { id: 'sst_alturas', label: 'Curso de Alturas', icon: 'fa-person-falling', color: 'text-orange-600', requiresDate: true, dateLabel: 'Realización', validityMonths: 18 },
        // ANTES: sst_aptitud (Certificado Aptitud) -> AHORA: sst_induccion (Inducción SST)
        { id: 'sst_induccion', label: 'Inducción SST', icon: 'fa-clipboard-check', color: 'text-emerald-600', requiresDate: true, dateLabel: 'Realización', validityMonths: 12 },
        { id: 'sst_medico', label: 'Examen Médico', icon: 'fa-user-doctor', color: 'text-blue-600', requiresDate: true, dateLabel: 'Realización', validityMonths: 12 },
        { id: 'sst_otros', label: 'Otros (SST)', icon: 'fa-folder-plus', color: 'text-gray-600', requiresDate: false }
    ];

    container.innerHTML = `
        <div class="max-w-4xl mx-auto space-y-6">
            
            <div class="flex justify-between items-center mb-4">
                <button id="btn-back-sst-table" class="text-sm text-gray-500 hover:text-indigo-600 font-bold flex items-center transition-colors">
                    <i class="fa-solid fa-arrow-left mr-2"></i> Volver a la lista
                </button>
                
                <button id="btn-download-zip" class="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold py-2 px-4 rounded-lg shadow-md flex items-center transition-all">
                    <i class="fa-solid fa-file-zipper mr-2"></i> Descargar Documentos (.ZIP)
                </button>
            </div>

            <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex items-center gap-4">
                <div class="w-16 h-16 rounded-full bg-indigo-100 flex items-center justify-center text-2xl font-bold text-indigo-600 border-2 border-indigo-200">
                    ${user.firstName[0]}${user.lastName[0]}
                </div>
                <div>
                    <h2 class="text-xl font-bold text-gray-800">${user.firstName} ${user.lastName}</h2>
                    <p class="text-sm text-gray-500">Carpeta de Seguridad y Salud en el Trabajo</p>
                    <p class="text-xs text-gray-400 mt-1">Cédula: ${user.idNumber}</p>
                </div>
            </div>

            <div id="sst-user-cards" class="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div class="col-span-3 text-center py-10"><div class="loader mx-auto"></div></div>
            </div>
            
            <div class="bg-white p-4 rounded-xl border border-gray-200">
                <div class="flex justify-between items-center mb-3">
                    <h4 class="font-bold text-gray-700">Otros Documentos SST</h4>
                    <button id="btn-sst-add-other" class="text-xs bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded font-bold">+ Agregar</button>
                </div>
                <div id="sst-others-grid" class="grid grid-cols-1 md:grid-cols-3 gap-4"></div>
            </div>
        </div>
        
        <input type="file" id="sst-user-upload-input" class="hidden" accept=".pdf,.jpg,.png,.jpeg">
    `;

    document.getElementById('btn-back-sst-table').addEventListener('click', () => {
        loadSSTColaboradoresSubTab(container);
    });

    document.getElementById('btn-download-zip').addEventListener('click', () => {
        openBatchDownloadModal(user);
    });

    const cardsContainer = document.getElementById('sst-user-cards');
    const othersContainer = document.getElementById('sst-others-grid');
    const fileInput = document.getElementById('sst-user-upload-input');

    let activeCatConfig = null;

    const renderCards = async () => {
        // --- CORRECCIÓN EN LA CONSULTA: BUSCAMOS sst_induccion ---
        const q = query(collection(_db, "users", userId, "documents"), 
            where("category", "in", ["sst_alturas", "sst_induccion", "sst_medico", "sst_otros"])); // Cambiado sst_aptitud por sst_induccion
        
        const snapshot = await getDocs(q);
        const docsMap = new Map();
        const otherDocs = [];

        snapshot.forEach(d => {
            if (d.data().category === 'sst_otros') otherDocs.push({ id: d.id, ...d.data() });
            else docsMap.set(d.data().category, { id: d.id, ...d.data() });
        });

        cardsContainer.innerHTML = '';
        othersContainer.innerHTML = '';

        SST_USER_CATS.filter(c => c.id !== 'sst_otros').forEach(cat => {
            const docData = docsMap.get(cat.id);
            const card = document.createElement('div');

            if (docData) {
                let statusHtml = '<span class="text-xs font-bold text-green-600 bg-green-100 px-2 py-1 rounded">Vigente</span>';
                let dateInfo = '';

                if (docData.expiresAt) {
                    const expDate = docData.expiresAt.toDate();
                    const today = new Date(); today.setHours(0, 0, 0, 0);
                    const diffDays = Math.ceil((expDate - today) / (1000 * 60 * 60 * 24));

                    dateInfo = `<p class="text-xs text-gray-500 mt-1">Vence: <strong>${expDate.toLocaleDateString('es-CO')}</strong></p>`;

                    if (diffDays < 0) statusHtml = '<span class="text-xs font-bold text-red-600 bg-red-100 px-2 py-1 rounded">VENCIDO</span>';
                    else if (diffDays <= 30) statusHtml = '<span class="text-xs font-bold text-yellow-700 bg-yellow-100 px-2 py-1 rounded">Vence Pronto</span>';
                }

                card.className = "bg-white p-5 rounded-xl border border-green-200 shadow-sm relative overflow-hidden group hover:shadow-md transition-all";
                card.innerHTML = `
                    <div class="absolute top-0 left-0 w-full h-1 bg-green-500"></div>
                    <div class="flex justify-between items-start mb-4">
                        <div class="w-12 h-12 rounded-lg bg-gray-50 flex items-center justify-center text-xl">
                            <i class="fa-solid ${cat.icon} ${cat.color}"></i>
                        </div>
                        ${statusHtml}
                    </div>
                    <h4 class="font-bold text-gray-800 text-sm h-10">${cat.label}</h4>
                    <div class="min-h-[40px]">${dateInfo}</div>
                    
                    <a href="${docData.url}" target="_blank" class="text-xs text-blue-600 hover:underline mt-3 block truncate bg-blue-50 p-2 rounded border border-blue-100">
                        <i class="fa-solid fa-paperclip mr-1"></i> ${docData.name}
                    </a>
                    
                    <div class="mt-4 pt-3 border-t border-gray-100 flex gap-2">
                        <button class="btn-delete-sst flex-1 text-xs text-red-500 hover:bg-red-50 py-2 rounded font-bold transition-colors" data-id="${docData.id}" data-path="${docData.storagePath}">
                            <i class="fa-solid fa-trash mr-1"></i> Eliminar
                        </button>
                    </div>
                `;

                card.querySelector('.btn-delete-sst').addEventListener('click', function () {
                    // Usamos la variable global del módulo _openConfirmModal
                    if (_openConfirmModal) {
                        _openConfirmModal("¿Eliminar este documento? Se perderá el historial.", async () => {
                            try {
                                await deleteObject(ref(_storage, this.dataset.path));
                                await deleteDoc(doc(_db, "users", userId, "documents", this.dataset.id));
                                window.showToast("Documento eliminado.", "success");
                                renderCards();
                            } catch (e) { console.error(e); window.showToast("Error al borrar.", "error"); }
                        });
                    }
                });

            } else {
                card.className = "border-2 border-dashed border-gray-300 rounded-xl p-5 flex flex-col items-center justify-center text-center hover:border-indigo-400 hover:bg-indigo-50 transition-all cursor-pointer group min-h-[240px]";
                card.innerHTML = `
                    <div class="w-14 h-14 rounded-full bg-gray-100 group-hover:bg-white flex items-center justify-center mb-3 shadow-sm transition-colors">
                        <i class="fa-solid ${cat.icon} text-gray-400 group-hover:text-indigo-600 text-2xl"></i>
                    </div>
                    <h5 class="font-bold text-gray-600 group-hover:text-indigo-800 text-sm mb-1">${cat.label}</h5>
                    <p class="text-xs text-gray-400 mt-1">No cargado</p>
                    ${cat.requiresDate ? `<p class="text-[10px] text-indigo-400 mt-2 font-medium">Vigencia: ${cat.validityMonths} meses</p>` : ''}
                `;
                card.onclick = () => {
                    activeCatConfig = cat;
                    fileInput.click();
                };
            }
            cardsContainer.appendChild(card);
        });

        // Renderizar Otros
        if (otherDocs.length === 0) othersContainer.innerHTML = '<p class="col-span-3 text-center text-xs text-gray-400 italic">No hay otros documentos.</p>';

        otherDocs.forEach(doc => {
            const card = document.createElement('div');
            card.className = "bg-white p-3 rounded border border-gray-200 shadow-sm flex justify-between items-center";
            card.innerHTML = `
                <div class="min-w-0 pr-2">
                    <p class="text-xs font-bold text-gray-700 truncate" title="${doc.description}">${doc.description}</p>
                    <p class="text-[10px] text-gray-400">${doc.uploadedAt ? doc.uploadedAt.toDate().toLocaleDateString() : ''}</p>
                </div>
                <div class="flex gap-1">
                    <button type="button" onclick="window.viewDocument('${doc.url}', '${doc.name}')" class="p-1.5 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded transition-colors" title="Ver documento">
                        <i class="fa-solid fa-eye"></i>
                    </button>
                    <button class="btn-del p-1.5 text-red-600 bg-red-50 rounded" data-path="${doc.storagePath}" data-id="${doc.id}"><i class="fa-solid fa-trash"></i></button>
                </div>
            `;
            card.querySelector('.btn-del').addEventListener('click', function () {
                if (_openConfirmModal) {
                    _openConfirmModal("¿Borrar?", async () => {
                        await deleteObject(ref(_storage, this.dataset.path));
                        await deleteDoc(doc(_db, "users", userId, "documents", this.dataset.id));
                        renderCards();
                    });
                }
            });
            othersContainer.appendChild(card);
        });
    };

    document.getElementById('btn-sst-add-other').addEventListener('click', () => {
        activeCatConfig = { id: 'sst_otros', requiresDate: false, label: 'Otros' };
        fileInput.click();
    });

    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file || !activeCatConfig) return;

        const resetInput = () => { fileInput.value = ''; activeCatConfig = null; };

        let executedDate = null;
        let expDate = null;
        let desc = activeCatConfig.label;

        if (activeCatConfig.requiresDate) {
            // USAMOS EL MODAL TIPO FECHA
            const dStr = await openCustomInputModal(
                `Registrar ${activeCatConfig.label}`,
                `Fecha de ${activeCatConfig.dateLabel || 'Realización'} (AAAA-MM-DD):`,
                "date"
            );

            if (!dStr) { resetInput(); return; }

            executedDate = new Date(dStr + 'T00:00:00');
            if (isNaN(executedDate.getTime())) {
                window.showToast("Fecha inválida.", "error");
                resetInput();
                return;
            }

            expDate = new Date(executedDate);
            expDate.setMonth(expDate.getMonth() + activeCatConfig.validityMonths);

            window.showToast(`Vencimiento calculado: ${expDate.toLocaleDateString()}`, "info");

        } else if (activeCatConfig.id === 'sst_otros') {
            desc = await openCustomInputModal(
                "Nuevo Documento SST",
                "Descripción del documento:",
                "text",
                "Ej: Entrega de EPP especial..."
            );
            if (!desc) { resetInput(); return; }
        }

        window.showToast("Subiendo...", "info");

        try {
            const path = `expedientes/${userId}/SST/${activeCatConfig.id}_${Date.now()}_${file.name}`;
            const snap = await uploadBytes(ref(_storage, path), file);
            const url = await getDownloadURL(snap.ref);

            const data = {
                name: file.name, category: activeCatConfig.id, description: desc,
                url: url, storagePath: path, uploadedAt: serverTimestamp(), uploadedBy: _getCurrentUserId()
            };
            if (executedDate) { data.executedAt = executedDate; data.expiresAt = expDate; }

            await addDoc(collection(_db, "users", userId, "documents"), data);
            window.showToast("Guardado.", "success");
            renderCards();
        } catch (e) {
            console.error(e);
            window.showToast("Error en la subida.", "error");
        } finally {
            resetInput();
        }
    });

    renderCards();
}

// ----------------------------------------------------------
// SUB-MÓDULO 3: CONTROL DOTACIÓN (Lógica Existente Migrada)
// ----------------------------------------------------------
function loadSSTDotacionSubTab(container) {
    // Renderizamos el contenedor específico de alertas
    container.innerHTML = `
        <div class="flex justify-between items-center mb-4">
            <h3 class="font-bold text-gray-700">Inventario Asignado & Alertas</h3>
            <span class="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded border border-yellow-200">
                Vencimientos < 45 días
            </span>
        </div>
        <div id="sst-dotacion-alerts-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div class="col-span-full text-center text-gray-400 italic">Analizando datos...</div>
        </div>
    `;

    // Reutilizamos la lógica de query que ya funcionaba
    const q = query(
        collection(_db, "dotacionHistory"),
        where("action", "==", "asignada"),
        where("status", "==", "activo")
    );

    unsubscribeEmpleadosTab = onSnapshot(q, async (snapshot) => {
        const alertsContainer = document.getElementById('sst-dotacion-alerts-grid');
        if (!alertsContainer) return;

        if (snapshot.empty) {
            alertsContainer.innerHTML = `
                <div class="col-span-full py-10 text-center bg-green-50 rounded-lg border border-green-100">
                    <p class="text-green-700 font-bold">Todo al día</p>
                    <p class="text-green-600 text-xs">No hay dotación por vencer.</p>
                </div>`;
            return;
        }

        const today = new Date(); today.setHours(0, 0, 0, 0);
        const alerts = [];
        const usersMap = _getUsersMap();

        // Carga eficiente de catálogo en paralelo y con caché inteligente (0ms)
        const catalogRefs = new Set(snapshot.docs.map(d => d.data().itemId));
        const catalogMap = new Map();
        const fetchPromises = [];

        for (const itemId of catalogRefs) {
            if (dotacionCatalogCache.has(itemId)) {
                catalogMap.set(itemId, dotacionCatalogCache.get(itemId));
            } else {
                fetchPromises.push(
                    getDoc(doc(_db, "dotacionCatalog", itemId)).then(snap => {
                        if (snap.exists()) {
                            dotacionCatalogCache.set(itemId, snap.data());
                            catalogMap.set(itemId, snap.data());
                        }
                    })
                );
            }
        }
        if (fetchPromises.length > 0) {
            await Promise.all(fetchPromises);
        }

        snapshot.forEach(doc => {
            const entry = doc.data();
            const catalogItem = catalogMap.get(entry.itemId);

            if (catalogItem && catalogItem.vidaUtilDias && entry.fechaEntrega) {
                const delivery = new Date(entry.fechaEntrega + 'T00:00:00');
                const expiration = new Date(delivery);
                expiration.setDate(expiration.getDate() + catalogItem.vidaUtilDias);
                const diffDays = Math.ceil((expiration - today) / (1000 * 60 * 60 * 24));

                if (diffDays <= 45) {
                    const user = usersMap.get(entry.userId);
                    alerts.push({
                        userId: entry.userId,
                        itemId: entry.itemId,
                        userName: user ? `${user.firstName} ${user.lastName}` : 'Desconocido',
                        itemName: entry.itemName,
                        fechaEntrega: delivery.toLocaleDateString('es-CO'),
                        diffDays: diffDays
                    });
                }
            }
        });

        if (alerts.length === 0) {
            alertsContainer.innerHTML = `
                <div class="col-span-full py-10 text-center bg-gray-50 rounded-lg border border-gray-200 border-dashed">
                    <p class="text-gray-500">Ningún EPP vence próximamente.</p>
                </div>`;
            return;
        }

        alerts.sort((a, b) => a.diffDays - b.diffDays);

        alertsContainer.innerHTML = alerts.map(item => {
            const isExpired = item.diffDays <= 0;
            const borderClass = isExpired ? 'border-red-500' : (item.diffDays <= 15 ? 'border-orange-500' : 'border-yellow-500');
            const statusText = isExpired ? `VENCIDO (${Math.abs(item.diffDays)}d)` : `Vence en ${item.diffDays}d`;
            const statusColor = isExpired ? 'text-red-600' : 'text-yellow-700';

            return `
                <div class="bg-white rounded-lg shadow-sm border-l-4 ${borderClass} p-3 hover:shadow transition-shadow border border-gray-100">
                    <div class="flex justify-between mb-1">
                        <span class="text-[10px] font-bold ${statusColor} uppercase tracking-wide">${statusText}</span>
                        <i class="fa-solid fa-triangle-exclamation ${statusColor}"></i>
                    </div>
                    <h4 class="font-bold text-gray-800 text-sm truncate">${item.itemName}</h4>
                    <p class="text-xs text-gray-500 mb-2">${item.userName}</p>
                    <button data-action="renew-dotacion" data-user-id="${item.userId}" data-item-id="${item.itemId}"
                            class="w-full mt-1 bg-gray-50 hover:bg-white border border-gray-200 text-gray-600 text-xs font-bold py-1.5 rounded transition-colors">
                        Renovar
                    </button>
                </div>
            `;
        }).join('');
    });
}

// Función auxiliar de alertas (sin cambios lógicos, solo render)
function loadSSTAlertsInSidePanel() {
    const q = query(collection(_db, "dotacionHistory"), where("action", "==", "asignada"), where("status", "==", "activo"));
    const usersMap = _getUsersMap();

    onSnapshot(q, async (snapshot) => {
        const alertsContainer = document.getElementById('sst-alerts-container');
        if (!alertsContainer) return;

        if (snapshot.empty) {
            alertsContainer.innerHTML = '<div class="p-3 bg-green-50 text-green-700 rounded text-xs text-center">Todo en orden.</div>';
            return;
        }

        const today = new Date(); today.setHours(0, 0, 0, 0);
        const alerts = [];
        const catalogRefs = new Set(snapshot.docs.map(d => d.data().itemId));
        const catalogMap = new Map();
        const fetchPromises = [];

        for (const itemId of catalogRefs) {
            if (dotacionCatalogCache.has(itemId)) {
                catalogMap.set(itemId, dotacionCatalogCache.get(itemId));
            } else {
                fetchPromises.push(
                    getDoc(doc(_db, "dotacionCatalog", itemId)).then(snap => {
                        if (snap.exists()) {
                            dotacionCatalogCache.set(itemId, snap.data());
                            catalogMap.set(itemId, snap.data());
                        }
                    })
                );
            }
        }
        if (fetchPromises.length > 0) {
            await Promise.all(fetchPromises);
        }

        snapshot.forEach(doc => {
            const entry = doc.data();
            const catalogItem = catalogMap.get(entry.itemId);
            if (catalogItem && catalogItem.vidaUtilDias && entry.fechaEntrega) {
                const delivery = new Date(entry.fechaEntrega + 'T00:00:00');
                const expiration = new Date(delivery);
                expiration.setDate(expiration.getDate() + catalogItem.vidaUtilDias);
                const diffDays = Math.ceil((expiration - today) / (1000 * 60 * 60 * 24));

                if (diffDays <= 30) {
                    const user = usersMap.get(entry.userId);
                    alerts.push({
                        userId: entry.userId, itemId: entry.itemId,
                        userName: user ? `${user.firstName} ${user.lastName}` : '?',
                        itemName: entry.itemName, diffDays: diffDays
                    });
                }
            }
        });

        if (alerts.length === 0) {
            alertsContainer.innerHTML = '<div class="p-3 bg-green-50 text-green-700 rounded text-xs text-center">Sin vencimientos próximos.</div>';
            return;
        }

        alerts.sort((a, b) => a.diffDays - b.diffDays);

        alertsContainer.innerHTML = alerts.map(item => {
            const isExpired = item.diffDays <= 0;
            return `
                <div class="p-2 rounded border-l-2 ${isExpired ? 'border-red-500 bg-red-50' : 'border-yellow-500 bg-yellow-50'} shadow-sm">
                    <div class="flex justify-between items-start">
                        <div>
                            <p class="text-[10px] font-bold text-gray-500 uppercase">${item.userName}</p>
                            <p class="text-xs font-bold text-gray-800">${item.itemName}</p>
                            <p class="text-[10px] ${isExpired ? 'text-red-600 font-bold' : 'text-yellow-700'}">
                                ${isExpired ? `Venció hace ${Math.abs(item.diffDays)}d` : `Vence en ${item.diffDays}d`}
                            </p>
                        </div>
                    </div>
                    <button data-action="renew-dotacion" data-user-id="${item.userId}" data-item-id="${item.itemId}"
                        class="mt-2 w-full bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 text-[10px] font-bold py-1 rounded transition-colors">
                        Renovar
                    </button>
                </div>
            `;
        }).join('');
    });
}

// 4. FUNCIÓN CORREGIDA: loadGlobalHistoryTab (Sin eval)
export async function showEmpleadoDetails(userId) {
    _showView('empleado-details');

    // --- LIMPIEZA DE COMPONENTES (CORREGIDO) ---

    // 1. Limpiar Gráfica
    if (typeof destroyActiveChart === 'function') {
        destroyActiveChart();
    }

    // 2. Limpiar Mapa de Asistencia
    // IMPORTANTE: Usamos la variable local 'attendanceMapInstance', SIN 'window.'
    if (attendanceMapInstance) {
        attendanceMapInstance.remove();
        attendanceMapInstance = null;
        // También limpiamos la capa de marcadores por si acaso
        if (typeof attendanceMarkersLayer !== 'undefined') attendanceMarkersLayer = null;
    }
    // -----------------------------------------------

    // Guardar ID para las pestañas
    const detailsView = document.getElementById('empleado-details-view');
    if (detailsView) detailsView.dataset.currentUserId = userId;

    // --- CORRECCIÓN CLAVE: LIMPIAR CONTENEDOR DE PESTAÑAS ---
    const contentContainer = document.getElementById('empleado-details-content-container');
    if (contentContainer) {
        contentContainer.innerHTML = '';
    }

    const usersMap = _getUsersMap();
    const user = usersMap.get(userId);

    // Helper seguro
    const safeSetText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };

    if (!user) {
        safeSetText('empleado-details-name', 'Error: Usuario no encontrado');
        return;
    }

    // 1. Renderizar Encabezado
    const level = user.commissionLevel || 'principiante';
    const levelText = level.charAt(0).toUpperCase() + level.slice(1);

    safeSetText('empleado-details-name', `${user.firstName} ${user.lastName}`);
    const nameEl = document.getElementById('empleado-details-name');
    if (nameEl) nameEl.dataset.userId = userId;

    // Botón Logs
    if (nameEl) {
        const headerContainer = nameEl.parentElement;
        // Limpiar botón previo si existe
        const oldBtn = headerContainer.querySelector('.btn-audit-log');
        if (oldBtn) oldBtn.remove();

        const btnAudit = document.createElement('button');
        btnAudit.className = "btn-audit-log ml-3 text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-2 py-1 rounded border border-gray-300 transition-colors align-middle";
        btnAudit.innerHTML = '<i class="fa-solid fa-clock-rotate-left mr-1"></i> Logs';
        nameEl.insertAdjacentElement('afterend', btnAudit);
        btnAudit.onclick = () => {
            if (typeof window.openMainModal === 'function') window.openMainModal('view-audit-logs', { userId: userId });
        };
    }

    safeSetText('empleado-details-level', `Nivel: ${levelText}`);

    // (Los textos de cédula, email, etc. se llenarán al cargar la pestaña resumen)

    // 2. Configurar Navegación
    const tabsNav = document.getElementById('empleado-details-tabs-nav');
    if (tabsNav) {
        const newTabsNav = tabsNav.cloneNode(false);
        tabsNav.parentNode.replaceChild(newTabsNav, tabsNav);

        newTabsNav.innerHTML = `
            <button data-tab="resumen" class="empleado-details-tab-button active whitespace-nowrap py-4 px-4 border-b-2 font-medium text-sm text-blue-600 border-blue-500 hover:text-blue-800 transition-colors">
                <i class="fa-solid fa-chart-pie mr-2"></i> Resumen
            </button>
            <button data-tab="bitacora" class="empleado-details-tab-button whitespace-nowrap py-4 px-4 border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 transition-colors">
                <i class="fa-solid fa-book-journal-whills mr-2"></i> Bitácora
            </button>
            <button data-tab="asistencia" class="empleado-details-tab-button whitespace-nowrap py-4 px-4 border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 transition-colors">
                <i class="fa-solid fa-location-dot mr-2"></i> Reporte de Ingreso
            </button>
            <button data-tab="documentos" class="empleado-details-tab-button whitespace-nowrap py-4 px-4 border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 transition-colors">
                <i class="fa-solid fa-folder-open mr-2"></i> Expediente
            </button>
            <button data-tab="dotacion" class="empleado-details-tab-button whitespace-nowrap py-4 px-4 border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 transition-colors">
                <i class="fa-solid fa-helmet-safety mr-2"></i> Dotación
            </button>
        `;

        newTabsNav.addEventListener('click', (e) => {
            const button = e.target.closest('.empleado-details-tab-button');
            if (!button) return;

            newTabsNav.querySelectorAll('.empleado-details-tab-button').forEach(btn => {
                btn.classList.remove('active', 'border-blue-500', 'text-blue-600');
                btn.classList.add('border-transparent', 'text-gray-500');
            });

            button.classList.add('active', 'border-blue-500', 'text-blue-600');
            button.classList.remove('border-transparent', 'text-gray-500');

            const tabName = button.dataset.tab;
            switchEmpleadoDetailsTab(tabName, userId);
        });
    }

    // Carga inicial
    switchEmpleadoDetailsTab('resumen', userId);
}

/**
 * Carga el contenido de la pestaña "Productividad" (TABLA ACTUALIZADA EN TIEMPO REAL).
 */
async function loadProductividadTab(container) {

    // 1. Renderizar el "Shell"
    container.innerHTML = `
        <div class="bg-white p-6 rounded-lg shadow-md">
            <div class="overflow-x-auto">
                <table class="w-full text-sm text-left">
                    <thead class="text-xs text-gray-700 uppercase bg-gray-50">
                        <tr>
                            <th class="px-6 py-3">Operario</th>
                            <th class="px-6 py-3 text-center">Nivel Comisión</th>
                            <th class="px-6 py-3 text-right">M² Asignados</th>
                            <th class="px-6 py-3 text-right">M² Completados</th>
                            <th class="px-6 py-3 text-center text-red-600">Días No Reportados</th>
                            <th class="px-6 py-3 text-right text-blue-600">Bonificación (Mes)</th>
                        </tr>
                    </thead>
                    <tbody id="empleados-prod-table-body">
                        <tr><td colspan="6" class="text-center py-10"><div class="loader mx-auto"></div><p class="mt-2 text-gray-500">Sincronizando datos...</p></td></tr>
                    </tbody>
                </table>
            </div>
            <p class="text-xs text-gray-400 mt-2 text-right">* Días no reportados calcula días hábiles (Lun-Sáb) sin registro de ingreso.</p>
        </div>
    `;

    // 2. Referencias
    const monthSelector = document.getElementById('empleado-month-selector');
    const tableBody = document.getElementById('empleados-prod-table-body');

    // Limpiar listener anterior si existe
    if (unsubscribeProductividad) {
        unsubscribeProductividad();
        unsubscribeProductividad = null;
    }

    // Función auxiliar días hábiles
    const countBusinessDays = (year, month) => {
        let count = 0;
        const startDate = new Date(year, month - 1, 1);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let endDate = new Date(year, month, 0);
        if (year === today.getFullYear() && (month - 1) === today.getMonth()) {
            endDate = today;
        } else if (endDate > today) {
            return 0;
        }

        let curDate = new Date(startDate);
        while (curDate <= endDate) {
            const dayOfWeek = curDate.getDay();
            if (dayOfWeek !== 0) count++; // Excluir Domingo
            curDate.setDate(curDate.getDate() + 1);
        }
        return count;
    };

    // --- CARGA DE DATOS EN TIEMPO REAL ---
    const qUsers = query(collection(_db, "users"), where("status", "==", "active"));
    
    unsubscribeProductividad = onSnapshot(qUsers, async (snapshot) => {
        if (snapshot.empty) {
            tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-10 text-gray-500">No se encontraron operarios activos.</td></tr>`;
            return;
        }

        // Obtener usuarios activos actualizados
        const activeUsers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Preparar fechas para consulta de stats
        const selectedMonthYear = monthSelector.value;
        const [selYear, selMonth] = selectedMonthYear.split('-').map(Number);
        const currentStatDocId = selectedMonthYear.replace('-', '_');
        
        const startOfMonth = new Date(selYear, selMonth - 1, 1);
        const endOfMonth = new Date(selYear, selMonth, 0, 23, 59, 59);
        const businessDays = countBusinessDays(selYear, selMonth);

        // Consultar Stats y Asistencia en paralelo para todos los usuarios activos
        const statPromises = activeUsers.map(op => getDoc(doc(_db, "employeeStats", op.id, "monthlyStats", currentStatDocId)));
        
        const attendancePromises = activeUsers.map(op => {
            const q = query(
                collection(_db, "users", op.id, "attendance_reports"),
                where("type", "==", "ingreso"),
                where("timestamp", ">=", startOfMonth),
                where("timestamp", "<=", endOfMonth)
            );
            return getDocs(q);
        });

        try {
            const [statSnapshots, attendanceSnapshots] = await Promise.all([
                Promise.all(statPromises),
                Promise.all(attendancePromises)
            ]);

            const empleadoData = activeUsers.map((operario, index) => {
                const statDoc = statSnapshots[index];
                const stats = statDoc.exists() ? statDoc.data() : {
                    metrosAsignados: 0, metrosCompletados: 0, totalBonificacion: 0
                };
                const attendanceCount = attendanceSnapshots[index].size;
                const missingDays = Math.max(0, businessDays - attendanceCount);

                return { ...operario, stats, missingDays };
            });

            empleadoData.sort((a, b) => b.stats.metrosCompletados - a.stats.metrosCompletados);

            tableBody.innerHTML = '';
            if (empleadoData.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-10 text-gray-500">No hay datos para ${selectedMonthYear}.</td></tr>`;
            }

            empleadoData.forEach(data => {
                const row = document.createElement('tr');
                row.className = 'bg-white border-b hover:bg-gray-50 cursor-pointer transition-colors';
                row.dataset.action = "view-empleado-details";
                row.dataset.id = data.id;

                const level = data.commissionLevel || 'principiante';
                const levelText = level.charAt(0).toUpperCase() + level.slice(1);
                const roleRaw = data.role || 'operario';
                const roleDisplay = roleRaw.charAt(0).toUpperCase() + roleRaw.slice(1);

                let missingDaysHtml = `<span class="text-gray-400 font-bold">-</span>`;
                if (data.missingDays > 0) {
                    missingDaysHtml = `<span class="bg-red-100 text-red-700 px-2 py-1 rounded-full font-bold text-xs">${data.missingDays} días</span>`;
                } else {
                    missingDaysHtml = `<span class="text-green-600 font-bold text-xs"><i class="fa-solid fa-check"></i> Completo</span>`;
                }

                row.innerHTML = `
                    <td class="px-6 py-4 font-medium text-gray-900">
                        ${data.firstName} ${data.lastName}
                        <div class="text-[10px] text-gray-400 uppercase tracking-wide">${roleDisplay}</div>
                    </td>
                    <td class="px-6 py-4 text-center text-gray-600">${levelText}</td>
                    <td class="px-6 py-4 text-right font-medium text-gray-500">${(data.stats.metrosAsignados || 0).toFixed(2)}</td>
                    <td class="px-6 py-4 text-right font-bold text-indigo-700 text-base">${(data.stats.metrosCompletados || 0).toFixed(2)}</td>
                    <td class="px-6 py-4 text-center">${missingDaysHtml}</td>
                    <td class="px-6 py-4 text-right font-bold text-green-600">${currencyFormatter.format(data.stats.totalBonificacion || 0)}</td>
                `;
                
                // Listener de clic para detalles
                row.addEventListener('click', () => {
                     // Asumimos que showEmpleadoDetails está expuesta
                     if(window.showEmpleadoDetails) window.showEmpleadoDetails(data.id);
                     else console.warn("Función showEmpleadoDetails no encontrada");
                });

                tableBody.appendChild(row);
            });
            
        } catch (err) {
            console.error("Error procesando datos:", err);
            tableBody.innerHTML = `<tr><td colspan="6" class="text-center text-red-500">Error de sincronización.</td></tr>`;
        }

    }, (error) => {
        console.error("Error en listener de usuarios:", error);
    });
}


/**
 * Determina la quincena contable activa de forma inteligente.
 */
function loadEmployeeBitacora(userId, startDateInput = null, endDateInput = null) {
    const container = document.getElementById('bitacora-list-container');
    if (!container) return;

    container.innerHTML = '<div class="flex justify-center py-10"><div class="loader"></div></div>';

    if (unsubscribeBitacora) unsubscribeBitacora();

    let q;
    if (startDateInput && endDateInput) {
        const [startYear, startMonth, startDay] = startDateInput.split('-').map(Number);
        const start = new Date(startYear, startMonth - 1, startDay, 0, 0, 0);

        const [endYear, endMonth, endDay] = endDateInput.split('-').map(Number);
        const end = new Date(endYear, endMonth - 1, endDay, 23, 59, 59, 999);

        q = query(collection(_db, "users", userId, "daily_reports"), where("createdAt", ">=", start), where("createdAt", "<=", end), orderBy("createdAt", "desc"));
    } else {
        q = query(collection(_db, "users", userId, "daily_reports"), orderBy("createdAt", "desc"), limit(20));
    }

    unsubscribeBitacora = onSnapshot(q, (snapshot) => {
        container.innerHTML = '';
        if (snapshot.empty) {
            container.innerHTML = `<div class="text-center py-10 text-gray-500 bg-gray-50 rounded-lg border border-dashed border-gray-300"><i class="fa-solid fa-filter-circle-xmark text-2xl mb-2 text-gray-300"></i><p>No hay reportes.</p></div>`;
            return;
        }
        snapshot.forEach(doc => {
            const r = doc.data();
            const dateObj = r.createdAt ? r.createdAt.toDate() : new Date();
            const dateStr = dateObj.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
            const timeStr = dateObj.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

            const card = document.createElement('div');
            card.className = "bg-white p-4 rounded-xl shadow-sm border border-gray-100 border-l-4 border-l-indigo-500 mb-3";
            card.innerHTML = `
                <div class="flex justify-between mb-2">
                    <h4 class="font-bold text-gray-800 capitalize">${dateStr}</h4>
                    <span class="text-xs bg-gray-100 px-2 py-1 rounded font-mono text-gray-500">${timeStr}</span>
                </div>
                <p class="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">${r.content}</p>
                <p class="text-[10px] text-right text-gray-400 mt-2 italic">Por: ${r.createdByName || 'Usuario'}</p>
            `;
            container.appendChild(card);
        });
    });
}



/**
 * Cambia el contenido visible en el detalle del empleado.
 * Crea dinámicamente los contenedores de las pestañas si no existen.
 */
function switchEmpleadoDetailsTab(tabName, userId) {
    // 1. Ocultar todos los contenidos previos
    document.querySelectorAll('.empleado-details-tab-content').forEach(content => {
        content.classList.add('hidden');
    });

    // 2. Buscar o Crear Contenedor de la pestaña
    let activeContent = document.getElementById(`empleado-tab-${tabName}`);

    if (!activeContent) {
        const parentContainer = document.getElementById('empleado-details-content-container');
        if (parentContainer) {
            activeContent = document.createElement('div');
            activeContent.id = `empleado-tab-${tabName}`;
            activeContent.className = 'empleado-details-tab-content mt-6 space-y-6';
            parentContainer.appendChild(activeContent);
        }
    }

    if (activeContent) activeContent.classList.remove('hidden');
    const user = _getUsersMap().get(userId);

    // 3. Lógica por pestaña
    switch (tabName) {
        case 'resumen':
            // Información del Resumen y Gráficas
            activeContent.innerHTML = `
                <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div class="lg:col-span-2 space-y-6">
                        <div class="bg-white p-6 rounded-lg shadow-md border border-gray-200">
                            <h4 class="text-sm font-bold text-gray-500 uppercase mb-4">Productividad (Últimos 6 Meses)</h4>
                            <div class="relative h-64">
                                <canvas id="empleado-productivity-chart"></canvas>
                            </div>
                        </div>
                        
                        <div class="bg-white p-6 rounded-lg shadow-md border border-gray-200">
                            <h4 class="text-sm font-bold text-gray-500 uppercase mb-4 flex items-center">
                                <i class="fa-solid fa-clock-rotate-left mr-2 text-blue-500"></i>
                                Reporte de Ingreso (Mes Actual)
                            </h4>
                            <div id="resumen-asistencia-kpi" class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                                <div class="text-center py-4"><div class="loader-small mx-auto"></div></div>
                            </div>
                            <div class="overflow-hidden rounded-lg border border-gray-100">
                                <table class="w-full text-sm text-left">
                                    <thead class="bg-gray-50 text-xs text-gray-500 uppercase font-semibold">
                                        <tr><th class="px-4 py-2">Fecha</th><th class="px-4 py-2">Hora</th><th class="px-4 py-2 text-center">Evidencia</th><th class="px-4 py-2 text-center">Ubicación</th></tr>
                                    </thead>
                                    <tbody id="resumen-asistencia-tbody" class="divide-y divide-gray-50"></tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    <div class="lg:col-span-1 space-y-6">
                        <div class="p-4 bg-white rounded-lg shadow border border-gray-200">
                            <h3 class="text-lg font-semibold text-gray-800 border-b pb-2 mb-4">Información de Contacto</h3>
                            <div class="space-y-2 text-sm text-gray-700">
                                <p><strong>Cédula:</strong> <span>${user?.idNumber || 'N/A'}</span></p>
                                <p><strong>Email:</strong> <span class="break-all">${user?.email || 'N/A'}</span></p>
                                <p><strong>Teléfono:</strong> <span>${user?.phone || 'N/A'}</span></p>
                                <p><strong>Dirección:</strong> <span>${user?.address || 'N/A'}</span></p>
                            </div>

                            <h3 class="text-lg font-semibold text-gray-800 border-b pb-2 mb-4 mt-6">Datos de Pago</h3>
                            <div class="space-y-2 text-sm text-gray-700">
                                <p><strong>Banco:</strong> <span>${user?.bankName || 'N/A'}</span></p>
                                <p><strong>Cuenta:</strong> <span>${user?.accountType || 'N/A'}</span></p>
                                <p><strong>Número:</strong> <span class="font-mono bg-gray-100 px-1 rounded select-all">${user?.accountNumber || 'N/A'}</span></p>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            loadEmpleadoResumenTab(userId);
            break;

        case 'bitacora':
            // --- CORRECCIÓN CRÍTICA: Verificamos si existe el INPUT, no el contenedor ---
            // Esto obliga a redibujar si faltan los filtros
            if (!activeContent.querySelector('#bitacora-start')) {

                // Fechas: Mañana y 15 días atrás
                const dateTomorrow = new Date();
                dateTomorrow.setDate(dateTomorrow.getDate() + 1);
                const tomorrowStr = dateTomorrow.toISOString().split('T')[0];

                const datePast = new Date();
                datePast.setDate(datePast.getDate() - 15);
                const pastStr = datePast.toISOString().split('T')[0];

                activeContent.innerHTML = `
                    <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-200 min-h-[500px]">
                        
                        <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 border-b border-gray-100 pb-4 gap-4">
                            <div>
                                <h3 class="text-xl font-bold text-gray-800 flex items-center">
                                    <i class="fa-solid fa-book-journal-whills text-indigo-600 mr-2"></i> Bitácora de Actividades
                                </h3>
                                <p class="text-sm text-gray-500">Historial de reportes diarios.</p>
                            </div>

                            <div class="flex flex-wrap items-end gap-2 bg-gray-50 p-2 rounded-lg border border-gray-200">
                                <div>
                                    <label class="block text-[10px] font-bold text-gray-500 uppercase mb-1">Desde</label>
                                    <input type="date" id="bitacora-start" class="border border-gray-300 rounded-md px-2 py-1 text-sm focus:ring-indigo-500 focus:border-indigo-500" value="${pastStr}">
                                </div>
                                <div>
                                    <label class="block text-[10px] font-bold text-gray-500 uppercase mb-1">Hasta</label>
                                    <input type="date" id="bitacora-end" class="border border-gray-300 rounded-md px-2 py-1 text-sm focus:ring-indigo-500 focus:border-indigo-500" value="${tomorrowStr}">
                                </div>
                                <button id="btn-filter-bitacora" class="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold py-1.5 px-4 rounded-md shadow-sm transition-colors h-[30px]">
                                    Filtrar
                                </button>
                            </div>
                        </div>

                        <div id="bitacora-list-container" class="space-y-4">
                            <p class="text-center text-gray-400 py-10">Cargando bitácora...</p>
                        </div>
                    </div>
                `;

                // Listener del Botón Filtrar
                const filterBtn = document.getElementById('btn-filter-bitacora');
                if (filterBtn) {
                    filterBtn.addEventListener('click', () => {
                        const s = document.getElementById('bitacora-start');
                        const e = document.getElementById('bitacora-end');
                        if (s && e) loadEmployeeBitacora(userId, s.value, e.value);
                    });
                }
            }

            // Carga inicial segura (usando los valores de los inputs creados)
            setTimeout(() => {
                const sInput = document.getElementById('bitacora-start');
                const eInput = document.getElementById('bitacora-end');

                if (sInput && eInput) {
                    loadEmployeeBitacora(userId, sInput.value, eInput.value);
                } else {
                    // Fallback de seguridad
                    const dT = new Date(); dT.setDate(dT.getDate() + 1);
                    const dP = new Date(); dP.setDate(dP.getDate() - 15);
                    loadEmployeeBitacora(userId, dP.toISOString().split('T')[0], dT.toISOString().split('T')[0]);
                }
            }, 100);
            break;

        case 'asistencia':
            // PASO 1: Limpieza TOTAL del mapa previo usando la variable LOCAL
            if (attendanceMapInstance) {
                attendanceMapInstance.remove(); // Destruye el mapa viejo correctamente
                attendanceMapInstance = null;
            }

            // PASO 2: Reconstruir HTML SIEMPRE
            activeContent.innerHTML = `
                <div class="flex justify-between items-center bg-white p-4 rounded-lg shadow border border-gray-200 mb-6">
                    <h3 class="text-lg font-bold text-gray-800">Historial de Asistencia</h3>
                    <div class="flex gap-2" id="attendance-controls-group">
                        <button type="button" data-range="7" class="range-btn bg-blue-100 text-blue-700 px-3 py-1 rounded-md text-sm font-bold border border-blue-200 transition-colors shadow-sm">7 Días</button>
                        <button type="button" data-range="15" class="range-btn bg-gray-100 text-gray-600 px-3 py-1 rounded-md text-sm font-bold border border-gray-200 transition-colors hover:bg-gray-200">15 Días</button>
                        <button type="button" data-range="30" class="range-btn bg-gray-100 text-gray-600 px-3 py-1 rounded-md text-sm font-bold border border-gray-200 transition-colors hover:bg-gray-200">30 Días</button>
                    </div>
                </div>

                <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                    <div class="bg-white p-4 rounded-lg shadow border border-gray-200">
                        <h4 class="text-sm font-bold text-gray-500 uppercase mb-4">Tendencia de Llegada</h4>
                        <div class="relative h-64 w-full">
                            <canvas id="attendance-chart"></canvas>
                        </div>
                    </div>
                    
                    <div class="bg-white p-4 rounded-lg shadow border border-gray-200 flex flex-col">
                        <h4 class="text-sm font-bold text-gray-500 uppercase mb-4">Mapa de Reportes</h4>
                        <div id="attendance-map" class="flex-grow w-full h-64 rounded-lg border border-gray-300 z-0 relative bg-gray-100"></div>
                    </div>
                </div>

                <div class="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
                    <div class="px-6 py-4 border-b border-gray-100 bg-gray-50">
                        <h4 class="text-sm font-bold text-gray-700">Bitácora de Registros</h4>
                    </div>
                    <div class="overflow-x-auto max-h-80 custom-scrollbar">
                        <table class="w-full text-sm text-left">
                            <thead class="text-xs text-gray-700 uppercase bg-gray-100 sticky top-0 z-10 shadow-sm">
                                <tr>
                                    <th class="px-6 py-3">Fecha</th>
                                    <th class="px-6 py-3">Hora</th>
                                    <th class="px-6 py-3 text-center">Evidencia</th>
                                    <th class="px-6 py-3 text-center">Mapa</th>
                                    <th class="px-6 py-3">Dispositivo</th>
                                </tr>
                            </thead>
                            <tbody id="attendance-list-body" class="divide-y divide-gray-100">
                                <tr><td colspan="5" class="text-center py-4 text-gray-400">Cargando datos...</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            `;

            // PASO 3: Asignar Listeners a los botones
            const controls = activeContent.querySelector('#attendance-controls-group');
            if (controls) {
                controls.addEventListener('click', (e) => {
                    const btn = e.target.closest('.range-btn');
                    if (!btn) return;

                    // Estilos Visuales
                    controls.querySelectorAll('.range-btn').forEach(b => {
                        b.className = "range-btn bg-gray-100 text-gray-600 px-3 py-1 rounded-md text-sm font-bold border border-gray-200 transition-colors hover:bg-gray-200";
                    });
                    btn.className = "range-btn bg-blue-100 text-blue-700 px-3 py-1 rounded-md text-sm font-bold border border-blue-200 transition-colors shadow-sm";

                    // Cargar Datos
                    const range = parseInt(btn.dataset.range);
                    loadAttendanceTab(userId, range);
                });
            }

            // PASO 4: Carga Inicial (7 días)
            loadAttendanceTab(userId, 7);

            // Fix Mapa Leaflet
            setTimeout(() => {
                if (attendanceMapInstance) { // Sin window.
                    attendanceMapInstance.invalidateSize();
                }
            }, 300);
            break;

        case 'documentos':
            loadEmpleadoDocumentosTab(userId, activeContent);
            break;

        case 'dotacion':
            if (typeof window.loadDotacionAsignaciones === 'function') {
                window.loadDotacionAsignaciones(userId, `empleado-tab-dotacion`);
            }
            break;
    }
}


/**
 * Carga el contenido de la pestaña "Resumen":
 * 1. Gráfico de Productividad.
 * 2. Resumen de Asistencia (KPIs y Mini Tabla).
 */
async function loadEmpleadoResumenTab(userId) {
    // --- PARTE 1: GRÁFICO DE PRODUCTIVIDAD (Lógica existente) ---
    try {
        const labels = [];
        const dataBonificacion = [];
        const dataEnTiempo = [];
        const dataFueraTiempo = [];

        const today = new Date();
        const monthlyStatRefs = [];
        const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

        for (let i = 5; i >= 0; i--) {
            const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const statDocId = `${year}_${month}`;

            labels.push(`${monthNames[d.getMonth()]} ${year}`);
            monthlyStatRefs.push(getDoc(doc(_db, "employeeStats", userId, "monthlyStats", statDocId)));
        }

        const statSnapshots = await Promise.all(monthlyStatRefs);

        statSnapshots.forEach(snap => {
            if (snap.exists()) {
                const stats = snap.data();
                dataBonificacion.push(stats.totalBonificacion || 0);
                dataEnTiempo.push(stats.metrosEnTiempo || 0);
                dataFueraTiempo.push(stats.metrosFueraDeTiempo || 0);
            } else {
                dataBonificacion.push(0);
                dataEnTiempo.push(0);
                dataFueraTiempo.push(0);
            }
        });

        const ctx = document.getElementById('empleado-productivity-chart');
        if (ctx) {
            if (typeof window.ensureChart === 'function') {
                await window.ensureChart();
            }
            createProductivityChart(ctx.getContext('2d'), labels, dataBonificacion, dataEnTiempo, dataFueraTiempo);
        }

    } catch (error) {
        console.error("Error al cargar gráfico de productividad:", error);
    }

    // --- PARTE 2: RESUMEN DE ASISTENCIA (NUEVA LÓGICA) ---
    const kpiContainer = document.getElementById('resumen-asistencia-kpi');
    const tableBody = document.getElementById('resumen-asistencia-tbody');

    if (!kpiContainer || !tableBody) return;

    try {
        // Consultar los últimos 30 registros de ingreso
        const q = query(
            collection(_db, "users", userId, "attendance_reports"),
            where("type", "==", "ingreso"),
            orderBy("timestamp", "desc"),
            limit(30)
        );

        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            kpiContainer.innerHTML = `<div class="col-span-3 text-center text-gray-400 text-sm italic">Sin registros de ingreso recientes.</div>`;
            tableBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-gray-400 text-xs">No hay datos.</td></tr>`;
            return;
        }

        const reports = snapshot.docs.map(d => d.data());
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        // A. Calcular KPIs del Mes Actual
        let daysWorked = 0;
        let totalMinutes = 0;
        let countForAvg = 0;

        const currentMonthReports = reports.filter(r => {
            const d = r.timestamp.toDate();
            return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
        });

        daysWorked = currentMonthReports.length;

        currentMonthReports.forEach(r => {
            const d = r.timestamp.toDate();
            // Convertir hora a minutos desde medianoche (ej: 8:30 = 510 min)
            totalMinutes += (d.getHours() * 60) + d.getMinutes();
            countForAvg++;
        });

        let avgTimeStr = "---";
        if (countForAvg > 0) {
            const avgTotalMinutes = Math.round(totalMinutes / countForAvg);
            const avgH = Math.floor(avgTotalMinutes / 60);
            const avgM = avgTotalMinutes % 60;
            const ampm = avgH >= 12 ? 'PM' : 'AM';
            const displayH = avgH > 12 ? avgH - 12 : avgH;
            avgTimeStr = `${displayH}:${avgM.toString().padStart(2, '0')} ${ampm}`;
        }

        const lastReport = reports[0]; // El primero es el más reciente por el orderBy desc
        const lastDateStr = lastReport.timestamp.toDate().toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
        const lastTimeStr = lastReport.timestamp.toDate().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

        // Renderizar KPIs
        kpiContainer.innerHTML = `
            <div class="bg-blue-50 p-3 rounded-lg border border-blue-100 text-center">
                <p class="text-xs text-blue-500 font-bold uppercase">Días Trabajados</p>
                <p class="text-2xl font-bold text-blue-800">${daysWorked}</p>
                <p class="text-[10px] text-blue-400">Mes Actual</p>
            </div>
            <div class="bg-indigo-50 p-3 rounded-lg border border-indigo-100 text-center">
                <p class="text-xs text-indigo-500 font-bold uppercase">Promedio Llegada</p>
                <p class="text-2xl font-bold text-indigo-800">${avgTimeStr}</p>
                <p class="text-[10px] text-indigo-400">Hora estimada</p>
            </div>
            <div class="bg-green-50 p-3 rounded-lg border border-green-100 text-center">
                <p class="text-xs text-green-600 font-bold uppercase">Último Ingreso</p>
                <p class="text-lg font-bold text-green-800">${lastDateStr}</p>
                <p class="text-sm font-bold text-green-600">${lastTimeStr}</p>
            </div>
        `;

        // B. Renderizar Mini Tabla (Últimos 5)
        const last5 = reports.slice(0, 5);
        tableBody.innerHTML = last5.map(r => {
            const dateObj = r.timestamp.toDate();
            const dateStr = dateObj.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
            const timeStr = dateObj.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
            const lat = r.location?.lat;
            const lng = r.location?.lng;

            return `
                <tr class="border-b border-gray-50 hover:bg-gray-50">
                    <td class="px-4 py-2 font-medium text-gray-700">${dateStr}</td>
                    <td class="px-4 py-2 text-blue-600 font-bold">${timeStr}</td>
                    <td class="px-4 py-2 text-center">
                        ${r.photoURL ?
                    `<button onclick="window.openImageModal('${r.photoURL}')" class="text-gray-400 hover:text-indigo-600 transition-colors" title="Ver Evidencia"><i class="fa-regular fa-image"></i></button>`
                    : '<span class="text-gray-300">-</span>'}
                    </td>
                    <td class="px-4 py-2 text-center">
                        ${lat && lng ?
                    `<a href="https://www.google.com/maps/search/?api=1&query=${lat},${lng}" target="_blank" class="text-gray-400 hover:text-green-600 transition-colors" title="Ver Mapa"><i class="fa-solid fa-map-location-dot"></i></a>`
                    : '<span class="text-gray-300">-</span>'}
                    </td>
                </tr>
            `;
        }).join('');

    } catch (error) {
        console.error("Error al cargar resumen de asistencia:", error);
        kpiContainer.innerHTML = `<div class="col-span-3 text-center text-red-500 text-xs">Error cargando datos.</div>`;
    }
}

// 4. ACTUALIZAR loadEmpleadoDocumentosTab (EXPEDIENTE ESTRUCTURADO)
async function loadEmpleadoDocumentosTab(userId, container) {
    // --- CONFIGURACIÓN DE CASILLAS FIJAS ---
    const REQUIRED_DOCS = [
        { id: 'contrato', label: 'Contrato Laboral', icon: 'fa-file-signature', color: 'text-blue-600', bg: 'bg-blue-50' },
        { id: 'cedula', label: 'Cédula Ciudadanía', icon: 'fa-id-card', color: 'text-indigo-600', bg: 'bg-indigo-50' },
        { id: 'hoja_vida', label: 'Hoja de Vida', icon: 'fa-user-tie', color: 'text-slate-600', bg: 'bg-slate-50' },
        { id: 'examenes', label: 'Exámenes Médicos', icon: 'fa-user-doctor', color: 'text-emerald-600', bg: 'bg-emerald-50' },
        { id: 'seguridad_social', label: 'Seguridad Social', icon: 'fa-shield-heart', color: 'text-rose-600', bg: 'bg-rose-50' },
        { id: 'certificados', label: 'Certificados', icon: 'fa-graduation-cap', color: 'text-amber-600', bg: 'bg-amber-50' },
        { id: 'otros', label: 'Otros', icon: 'fa-folder-open', color: 'text-gray-600', bg: 'bg-gray-50' }
    ];

    const currentYear = new Date().getFullYear();

    container.innerHTML = `
        <div class="space-y-6">
            <div class="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                <div>
                    <h3 class="font-bold text-gray-800 flex items-center text-lg">
                        <i class="fa-solid fa-folder-tree mr-2 text-indigo-600"></i> Expediente Digital
                    </h3>
                </div>
                <div class="flex items-center gap-2">
                    <label class="text-sm font-bold text-gray-600">Vigencia:</label>
                    <select id="expediente-year-filter" class="border border-indigo-300 bg-indigo-50 text-indigo-900 font-bold text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2">
                        <option value="${currentYear + 1}">${currentYear + 1}</option>
                        <option value="${currentYear}" selected>${currentYear}</option>
                        <option value="${currentYear - 1}">${currentYear - 1}</option>
                        <option value="${currentYear - 2}">${currentYear - 2}</option>
                    </select>
                </div>
            </div>

            <div id="documents-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"></div>
        </div>
        
        <input type="file" id="global-doc-upload" class="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp">
    `;

    const gridContainer = document.getElementById('documents-grid');
    const yearFilter = document.getElementById('expediente-year-filter');
    const fileInput = document.getElementById('global-doc-upload');

    let activeSlotId = null;

    const renderSlots = async (year) => {
        gridContainer.innerHTML = `<div class="col-span-full text-center py-10"><div class="loader-small mx-auto"></div></div>`;

        try {
            const q = query(collection(_db, "users", userId, "documents"));
            const snapshot = await getDocs(q);
            const docsMap = new Map();

            snapshot.forEach(docSnap => {
                const data = docSnap.data();
                let docYear = data.year;
                // Fallback para documentos viejos sin año: usar fecha de subida
                if (!docYear && data.uploadedAt) docYear = data.uploadedAt.toDate().getFullYear();

                if (String(docYear) === String(year)) {
                    docsMap.set(data.category, { id: docSnap.id, ...data });
                }
            });

            gridContainer.innerHTML = '';

            REQUIRED_DOCS.forEach(slot => {
                const existingDoc = docsMap.get(slot.id);
                const card = document.createElement('div');

                if (existingDoc) {
                    // LLENO
                    const dateStr = existingDoc.uploadedAt ? existingDoc.uploadedAt.toDate().toLocaleDateString('es-CO') : 'N/A';
                    let fileIcon = existingDoc.type?.includes('pdf') ? 'fa-file-pdf text-red-500' : 'fa-file-image text-blue-500';

                    card.className = "bg-white border border-gray-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-all relative group overflow-hidden";
                    card.innerHTML = `
                        <div class="absolute top-0 left-0 w-1 h-full bg-green-500"></div>
                        <div class="flex justify-between items-start mb-3 pl-2">
                            <div class="flex items-center gap-3">
                                <div class="w-10 h-10 rounded-lg ${slot.bg} flex items-center justify-center">
                                    <i class="fa-solid ${slot.icon} ${slot.color} text-lg"></i>
                                </div>
                                <div>
                                    <h5 class="text-sm font-bold text-gray-800">${slot.label}</h5>
                                    <span class="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded font-bold">CARGADO</span>
                                </div>
                            </div>
                            <div class="text-right"><i class="fa-solid ${fileIcon} text-xl"></i></div>
                        </div>
                        <div class="pl-2 mb-3">
                            <p class="text-xs text-gray-500 truncate" title="${existingDoc.name}">${existingDoc.name}</p>
                            <p class="text-[10px] text-gray-400">Subido: ${dateStr}</p>
                        </div>
                        <div class="flex gap-2 pl-2">
                            <a href="${existingDoc.url}" target="_blank" class="flex-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold py-2 rounded text-center transition-colors"><i class="fa-solid fa-eye mr-1"></i> Ver</a>
                            <button class="btn-delete-doc flex-1 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold py-2 rounded text-center transition-colors" 
                                data-id="${existingDoc.id}" data-path="${existingDoc.storagePath}" data-name="${existingDoc.name}">
                                <i class="fa-solid fa-trash mr-1"></i> Borrar
                            </button>
                        </div>
                    `;
                    card.querySelector('.btn-delete-doc').addEventListener('click', function () {
                        openConfirmModal(`¿Eliminar documento?`, async () => {
                            try {
                                await deleteObject(ref(_storage, this.dataset.path));
                                await deleteDoc(doc(_db, "users", userId, "documents", this.dataset.id));
                                window.showToast("Eliminado.", "success");
                                renderSlots(year);
                            } catch (e) { console.error(e); window.showToast("Error al eliminar.", "error"); }
                        });
                    });
                } else {
                    // VACÍO
                    card.className = "border-2 border-dashed border-gray-300 rounded-xl p-4 flex flex-col items-center justify-center text-center hover:border-indigo-400 hover:bg-gray-50 transition-all cursor-pointer group min-h-[160px]";
                    card.innerHTML = `
                        <div class="w-12 h-12 rounded-full bg-gray-100 group-hover:bg-indigo-100 flex items-center justify-center mb-3 transition-colors">
                            <i class="fa-solid ${slot.icon} text-gray-400 group-hover:text-indigo-600 text-xl"></i>
                        </div>
                        <h5 class="text-sm font-bold text-gray-600 group-hover:text-indigo-800 mb-1">${slot.label}</h5>
                        <p class="text-xs text-gray-400 mb-3">Pendiente ${year}</p>
                        <span class="bg-white border border-gray-300 text-gray-600 text-xs font-bold py-1 px-3 rounded-full shadow-sm group-hover:border-indigo-500 group-hover:text-indigo-600">
                            <i class="fa-solid fa-cloud-arrow-up mr-1"></i> Subir
                        </span>
                    `;
                    card.onclick = () => {
                        activeSlotId = slot.id;
                        fileInput.click();
                    };
                }
                gridContainer.appendChild(card);
            });
        } catch (error) {
            console.error(error);
            gridContainer.innerHTML = `<p class="col-span-full text-red-500 text-center">Error cargando expediente.</p>`;
        }
    };

    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file || !activeSlotId) return;
        const selectedYear = yearFilter.value;
        const slotInfo = REQUIRED_DOCS.find(s => s.id === activeSlotId);

        if (file.size > 5 * 1024 * 1024) {
            window.showToast("Archivo muy pesado (Máx 5MB).", "error");
            return;
        }

        window.showToast("Subiendo...", "info");
        try {
            const storagePath = `expedientes/${userId}/${selectedYear}/${activeSlotId}_${Date.now()}_${file.name}`;
            const storageRef = ref(_storage, storagePath);
            const snapshot = await uploadBytes(storageRef, file);
            const downloadURL = await getDownloadURL(snapshot.ref);

            await addDoc(collection(_db, "users", userId, "documents"), {
                name: file.name,
                category: activeSlotId,
                description: slotInfo ? slotInfo.label : 'Documento',
                year: parseInt(selectedYear),
                url: downloadURL,
                storagePath: storagePath,
                type: file.type,
                size: file.size,
                uploadedAt: serverTimestamp(),
                uploadedBy: _getCurrentUserId()
            });

            window.showToast("Subido con éxito.", "success");
            renderSlots(selectedYear);
        } catch (error) {
            console.error(error);
            window.showToast("Error en subida.", "error");
        } finally {
            fileInput.value = '';
            activeSlotId = null;
        }
    });

    yearFilter.addEventListener('change', (e) => renderSlots(e.target.value));
    renderSlots(currentYear);
}

/**
 * Abre el modal de Comprobante de Pago.
 * ADAPTADO: Incluye Vacaciones, Liquidación detallada, Logos y Firmas dinámicas.
 */
async function openPaymentVoucherModal(payment, user) {
    const modal = document.getElementById('payment-voucher-modal');
    
    const earningsList = document.getElementById('voucher-earnings-list');
    const deductionsList = document.getElementById('voucher-deductions-list');

    if (!modal) return;

    // ============================================================
    // 1. LIMPIEZA DE DOM
    // ============================================================
    const modalBody = modal.querySelector('.p-8') || modal.querySelector('.bg-white');

    const existingDynamic = document.getElementById('voucher-dynamic-header');
    if (existingDynamic) existingDynamic.remove();

    const oldSigs = document.getElementById('voucher-dynamic-signatures');
    if (oldSigs) oldSigs.remove();
    
    const oldDateEl = document.getElementById('voucher-date');
    if (oldDateEl) oldDateEl.innerHTML = '';
    
    const oldContractDates = document.getElementById('voucher-contract-dates');
    if (oldContractDates) oldContractDates.remove();

    modalBody.querySelectorAll('h3, h2').forEach(el => {
        if (el.textContent.includes('Comprobante') || (el.id !== 'voucher-concept' && el.id !== 'voucher-employee-name')) {
             if (!el.id) el.style.display = 'none'; 
        }
    });

    // ============================================================
    // 2. CONFIGURAR TEMA
    // ============================================================
    let title = 'COMPROBANTE DE NÓMINA';
    let subtitle = 'Pago Periódico';
    let themeColor = 'text-blue-600';
    let themeBg = 'bg-blue-50';
    let themeBorder = 'border-blue-200';
    let icon = 'fa-money-check-dollar';

    const concepto = (payment.concepto || '').toLowerCase();

    if (concepto.includes('prima')) {
        title = 'PRIMA DE SERVICIOS';
        subtitle = 'Prestación Social';
        themeColor = 'text-indigo-700';
        themeBg = 'bg-indigo-50';
        themeBorder = 'border-indigo-200';
        icon = 'fa-gift';
    } else if (concepto.includes('cesant')) {
        title = 'CESANTÍAS (FONDO)';
        subtitle = 'Liquidación Anual';
        themeColor = 'text-emerald-700';
        themeBg = 'bg-emerald-50';
        themeBorder = 'border-emerald-200';
        icon = 'fa-piggy-bank';
    } else if (concepto.includes('vacaciones')) {
        title = 'COMPROBANTE DE VACACIONES';
        subtitle = 'Novedad de Nómina';
        themeColor = 'text-cyan-700';
        themeBg = 'bg-cyan-50';
        themeBorder = 'border-cyan-200';
        icon = 'fa-umbrella-beach';
    } else if (concepto.includes('liquidaci')) {
        title = 'LIQUIDACIÓN FINAL';
        subtitle = 'Cierre de Contrato';
        themeColor = 'text-red-700';
        themeBg = 'bg-red-50';
        themeBorder = 'border-red-200';
        icon = 'fa-door-open';
    }

    // ============================================================
    // CORRECCIÓN DE FECHA: Soporte para Timestamp, JSON o String
    // ============================================================
    let dateObj = new Date();

    if (payment.createdAt) {
        // Caso A: Es un Timestamp de Firestore real (tiene la función)
        if (typeof payment.createdAt.toDate === 'function') {
            dateObj = payment.createdAt.toDate();
        } 
        // Caso B: Es un objeto plano recuperado de JSON (tiene seconds)
        else if (payment.createdAt.seconds) {
            dateObj = new Date(payment.createdAt.seconds * 1000);
        } 
        // Caso C: Es un string ISO o un objeto Date
        else {
            dateObj = new Date(payment.createdAt);
        }
    } else if (payment.paymentDate) {
        // Caso D: Fecha manual tipo "2023-12-31"
        dateObj = new Date(payment.paymentDate + 'T00:00:00');
    }

    const dateStr = dateObj.toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' });

    // ============================================================
    // 3. OBTENER DATOS EMPRESA
    // ============================================================
    let companyName = "Pinturas Industriales Prismacolor SAS";
    let companyNit = "";
    let companyLogo = null;
    let managerSignature = null;

    try {
        if (window.companyHeaderCache) {
            companyName = window.companyHeaderCache.nombre;
            companyNit = window.companyHeaderCache.nit;
            companyLogo = window.companyHeaderCache.logo;
            managerSignature = window.companyHeaderCache.signature;
        } else {
            const snap = await getDoc(doc(_db, "config", "general"));
            if(snap.exists()) {
                const data = snap.data();
                const emp = data.empresa || {}; 
                
                companyName = emp.nombre || companyName;
                companyNit = emp.nit ? `NIT: ${emp.nit}` : "";
                
                // Buscar Logo (Prioridad a tu configuración 'logoURL')
                companyLogo = emp.logoURL || data.logoURL || emp.empresaLogoURL || data.empresaLogoURL || emp.logo || null;
                
                // Buscar Firma
                managerSignature = emp.firmaGerenteURL || data.firmaGerenteURL || emp.empresaFirmaURL || data.empresaFirmaURL || null;
                
                window.companyHeaderCache = { nombre: companyName, nit: companyNit, logo: companyLogo, signature: managerSignature };
            }
        }
    } catch(e) { console.log("Error config", e); }

    // ============================================================
    // 4. HEADER UI
    // ============================================================
    const sidebarLogo = document.querySelector('#desktop-sidebar img')?.getAttribute('src');
    const mobileLogo = document.querySelector('#mobile-header img')?.getAttribute('src');
    const authLogo = document.querySelector('#auth-view img')?.getAttribute('src');
    const defaultLogo = '/app/recursos/LOGO PRISMA.png';
    const resolvedPageLogo = sidebarLogo || mobileLogo || authLogo || defaultLogo;
    const activeLogo = companyLogo || resolvedPageLogo;

    let visualElementHtml = '';
    if (activeLogo) {
        visualElementHtml = `<div class="mb-4 flex justify-center"><img src="${activeLogo}" alt="Logo" class="h-24 w-auto object-contain p-1 bg-white"></div>`;
    } else {
        visualElementHtml = `<div class="flex justify-center mb-3"><div class="w-14 h-14 ${themeBg} rounded-full flex items-center justify-center ${themeColor} text-2xl shadow-sm border-2 ${themeBorder}"><i class="fa-solid ${icon}"></i></div></div>`;
    }

    const headerDiv = document.createElement('div');
    headerDiv.id = 'voucher-dynamic-header';
    headerDiv.className = `text-center mb-6 pb-4 border-b-2 border-dashed ${themeBorder}`;
    headerDiv.innerHTML = `${visualElementHtml}<h2 class="text-xl font-black text-gray-800 uppercase tracking-tight leading-none mb-1">${companyName}</h2><p class="text-xs text-gray-500 font-mono mb-4">${companyNit}</p><div class="flex flex-wrap justify-center items-center gap-3"><div class="inline-block ${themeBg} ${themeColor} px-4 py-1.5 rounded-lg border ${themeBorder} shadow-sm"><p class="text-xs font-bold uppercase tracking-widest">${title}</p></div><div class="h-8 w-px bg-gray-300 hidden sm:block"></div><div class="text-left bg-gray-50 px-3 py-1 rounded border border-gray-100"><p class="text-[9px] text-gray-400 uppercase leading-none font-bold">Fecha de Emisión</p><p class="text-xs font-bold text-gray-700 leading-tight mt-0.5">${dateStr}</p></div></div><p class="text-[10px] text-gray-400 mt-2 uppercase tracking-wide">${subtitle}</p>`;
    
    if (modalBody.firstChild) modalBody.insertBefore(headerDiv, modalBody.firstChild);

    // ============================================================
    // 5. DATOS BASE Y HELPERS (IMPORTANTE: Definidos AQUÍ)
    // ============================================================
    document.getElementById('voucher-employee-name').textContent = `${user.firstName} ${user.lastName}`;
    document.getElementById('voucher-employee-id').textContent = user.idNumber ? `CC: ${user.idNumber}` : '';
    document.getElementById('voucher-concept').textContent = payment.concepto;
    
    const totalEl = document.getElementById('voucher-total');
    totalEl.textContent = currencyFormatter.format(payment.monto);
    totalEl.className = `text-3xl font-black ${themeColor}`;

    // Helper: Parsear moneda
    const parseMoney = (val) => {
        if (!val) return 0;
        if (typeof val === 'number') return val;
        return parseFloat(String(val).replace(/[$. \u00A0]/g, '').replace(',', '.')) || 0;
    };

    // Helper: Crear Fila (DEFINIDO ANTES DE USAR)
    const createRow = (label, val, isBold = false, formula = '') => {
        const displayVal = typeof val === 'number' ? currencyFormatter.format(val) : val;
        let formulaHtml = formula ? `<div class="text-[9px] text-gray-400 mt-0.5 italic tracking-tight">${formula}</div>` : '';

        return `<li class="flex justify-between items-start py-2 border-b border-gray-50 last:border-0 text-sm">
            <div class="flex flex-col pr-2">
                <span class="${isBold ? 'font-bold text-gray-700' : 'text-gray-500'} leading-tight">${label}</span>
                ${formulaHtml}
            </div>
            <span class="font-bold text-gray-800 whitespace-nowrap">${displayVal}</span>
        </li>`;
    };
    
    earningsList.innerHTML = '';
    deductionsList.innerHTML = '';
    const det = payment.details || {};
    const d = payment.desglose || {};

    // ============================================================
    // 6. RENDERIZADO DE CONCEPTOS
    // ============================================================

    // --- FECHAS DE CONTRATO (Solo Liquidación) ---
    if (concepto.includes('liquidaci') && det.fechaIngreso && det.fechaRetiro) {
        const datesDiv = document.createElement('div');
        datesDiv.id = 'voucher-contract-dates';
        datesDiv.className = "mb-6 grid grid-cols-2 gap-4 bg-gray-50 p-3 rounded-lg border border-gray-100";
        datesDiv.innerHTML = `
            <div class="text-center border-r border-gray-200"><p class="text-[10px] text-gray-400 uppercase font-bold">Inicio Contrato</p><p class="text-sm font-bold text-gray-800">${det.fechaIngreso}</p></div>
            <div class="text-center"><p class="text-[10px] text-gray-400 uppercase font-bold">Fecha Retiro</p><p class="text-sm font-bold text-gray-800">${det.fechaRetiro}</p></div>
        `;
        const empBlock = document.getElementById('voucher-employee-name').parentElement.parentElement;
        empBlock.insertAdjacentElement('afterend', datesDiv);
    }

    if (concepto.includes('prima')) {
        const base = parseFloat(det.baseCalculo) || 0;
        const dias = parseFloat(det.diasSemestre) || 0;
        const primaBruta = (base * dias) / 360;
        
        earningsList.innerHTML += createRow('Valor Prima (Bruta)', primaBruta, true);
        if (det.rangoFechas) earningsList.innerHTML += createRow('Periodo', det.rangoFechas);
        if (det.diasSemestre) earningsList.innerHTML += createRow('Días Liquidados', `${det.diasSemestre}`);
        if (det.baseCalculo) earningsList.innerHTML += createRow('Base Promedio', det.baseCalculo);
        
        if (det.descuentoPrestamos > 0) {
            deductionsList.innerHTML += createRow('Descuento Préstamos', det.descuentoPrestamos, true);
        } else {
            deductionsList.innerHTML = '<li class="text-xs text-gray-300 text-center py-2 italic">Sin deducciones</li>';
        }

    } else if (concepto.includes('cesant')) {
        earningsList.innerHTML += createRow('Valor Fondo', payment.monto, true);
        if (det.periodo) earningsList.innerHTML += createRow('Periodo', det.periodo);
        if (det.base) earningsList.innerHTML += createRow('Base', det.base);
        if (det.dias) earningsList.innerHTML += createRow('Días', `${det.dias}`);
        if (det.interesesCalculados) {
             earningsList.innerHTML += `<li class="mt-2 p-2 bg-yellow-50 text-xs text-center text-yellow-800 rounded border border-yellow-100">Intereses (12%): <strong>${currencyFormatter.format(det.interesesCalculados)}</strong><br>(Pagados aparte)</li>`;
        }
        deductionsList.innerHTML = '<li class="text-xs text-gray-300 text-center py-2 italic">Consignación Fondo</li>';

    } else if (concepto.includes('vacaciones')) {
        // --- VACACIONES ---
        earningsList.innerHTML += createRow('Pago Vacaciones', payment.monto, true);
        if (det.diasPagados) earningsList.innerHTML += createRow('Días Pagados', `${det.diasPagados} días`);
        if (det.tipoVacaciones) {
            const labelTipo = det.tipoVacaciones === 'dinero' ? 'Compensadas en Dinero' : 'Disfrute (Tiempo)';
            earningsList.innerHTML += createRow('Modalidad', labelTipo);
        }
        if (det.periodoNota) earningsList.innerHTML += createRow('Nota', det.periodoNota);
        deductionsList.innerHTML = '<li class="text-xs text-gray-300 text-center py-2 italic">Sin deducciones</li>';

    } else if (concepto.includes('liquidaci')) {
        // --- LIQUIDACIÓN DETALLADA ---
        const baseP = det.basePrestacional ? currencyFormatter.format(det.basePrestacional) : 'Base';
        const baseS = det.baseSalarial ? currencyFormatter.format(det.baseSalarial) : 'Salario';
        const dias = det.diasLiquidados || 'Días';

        // Cesantías
        if(det.cesantias && parseMoney(det.cesantias) > 0) 
            earningsList.innerHTML += createRow('Cesantías', det.cesantias, false, `${baseP} x ${dias} / 360`);
        
        // Intereses
        if(det.intereses && parseMoney(det.intereses) > 0) 
            earningsList.innerHTML += createRow('Intereses Cesantías', det.intereses, false, `12% sobre Cesantías`);
        
        // Prima
        if(det.prima && parseMoney(det.prima) > 0) 
            earningsList.innerHTML += createRow('Prima Servicios', det.prima, false, `Proporcional (Menos anticipos)`);
        
        // Vacaciones
        if(det.vacaciones && parseMoney(det.vacaciones) > 0) 
            earningsList.innerHTML += createRow('Vacaciones', det.vacaciones, false, `${baseS} x Días Pend. / 720`);
        
        // Indemnización (Solo si > 0)
        if(parseMoney(det.indemnizacion) > 0) 
            earningsList.innerHTML += createRow('Indemnización', det.indemnizacion, true, 'Despido sin justa causa');

        // Deducciones
        let totalDed = 0;
        if(det.deducciones) totalDed += parseMoney(det.deducciones);
        if(totalDed > 0) deductionsList.innerHTML += createRow('Préstamos Pendientes', totalDed, true);
        else deductionsList.innerHTML = '<li class="text-xs text-gray-300 text-center py-2 italic">Sin deducciones</li>';

    } else {
        // --- NÓMINA NORMAL ---
        let displaySalario = d.salarioProrrateado;
        let displayBonificacion = d.bonificacionM2 || 0;
        let labelSalario = `Salario Básico (${payment.diasPagados} días)`;

        if (d.deduccionSobreMinimo && d.baseDeduccion > 0) {
             if (displaySalario > d.baseDeduccion) {
                const excedente = displaySalario - d.baseDeduccion;
                displaySalario = d.baseDeduccion; 
                labelSalario = `Salario Básico (Min. Legal)`;
                displayBonificacion += excedente; 
            }
        }

        if (displaySalario > 0) earningsList.innerHTML += createRow(labelSalario, displaySalario);
        if (d.auxilioTransporteProrrateado > 0) {
            const diasAux = payment.diasAuxTransporte !== undefined ? payment.diasAuxTransporte : (d.diasAuxTransporte !== undefined ? d.diasAuxTransporte : payment.diasPagados);
            earningsList.innerHTML += createRow(`Aux. Transporte (${diasAux} días)`, d.auxilioTransporteProrrateado);
        }
        if (d.horasExtra > 0) earningsList.innerHTML += createRow('Horas Extra', d.horasExtra);
        
        if (displayBonificacion > 0) {
            const labelBono = (d.deduccionSobreMinimo) ? 'Bonificación / Aux. No Salarial' : 'Bonificación';
            earningsList.innerHTML += createRow(labelBono, displayBonificacion, true);
        }
        
        if (d.otros) earningsList.innerHTML += createRow('Otros', d.otros);

        if (d.deduccionSalud) deductionsList.innerHTML += createRow('Salud', Math.abs(d.deduccionSalud));
        if (d.deduccionPension) deductionsList.innerHTML += createRow('Pensión', Math.abs(d.deduccionPension));
        if (d.abonoPrestamos) deductionsList.innerHTML += createRow('Préstamos', d.abonoPrestamos);
        if (d.otros < 0) deductionsList.innerHTML += createRow('Otras', Math.abs(d.otros));
    }

    // --- 7. FIRMAS ---
    const signaturesDiv = document.createElement('div');
    signaturesDiv.id = 'voucher-dynamic-signatures';
    signaturesDiv.className = "mt-12 flex justify-between text-center items-end px-6";
    
    let managerSigHtml = '<div class="h-16 w-full"></div>';
    if (managerSignature) {
        managerSigHtml = `<img src="${managerSignature}" alt="Firma" class="h-16 w-auto object-contain mx-auto mb-1">`;
    }

    const formattedCompanyName = companyName.toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    signaturesDiv.innerHTML = `
        <div class="w-[40%] flex flex-col justify-end">
            ${managerSigHtml}
            <div class="border-t border-slate-350 mb-2 w-full"></div>
            <p class="text-[10px] font-black text-slate-500 uppercase tracking-wider">FIRMA EMPRESA</p>
            <p class="text-[8px] font-bold text-slate-400 mt-0.5 uppercase">${formattedCompanyName}</p>
        </div>
        <div class="w-[40%] flex flex-col justify-end">
            <div class="h-16 w-full"></div>
            <div class="border-t border-slate-350 mb-2 w-full"></div>
            <p class="text-[10px] font-black text-slate-500 uppercase tracking-wider">RECIBÍ CONFORME</p>
            <p class="text-[8px] font-bold text-slate-400 mt-0.5">C.C. ${user.idNumber || '---'}</p>
        </div>
    `;
    modalBody.appendChild(signaturesDiv);

    // --- 8. MOSTRAR ---
    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    const closeModal = () => { modal.style.display = 'none'; };
    const btnX = document.getElementById('voucher-close-btn');
    const btnF = document.getElementById('voucher-close-footer-btn');
    
    if(btnX) { const n = btnX.cloneNode(true); btnX.parentNode.replaceChild(n, btnX); n.onclick = closeModal; }
    if(btnF) { const n = btnF.cloneNode(true); btnF.parentNode.replaceChild(n, btnF); n.onclick = closeModal; }
}

/** * (FUNCIÓN CORREGIDA) 
 * Maneja la subida de un documento de empleado.
 */
async function handleDocumentUpload(e) {
    if (!e.target.classList.contains('upload-empleado-doc-input')) return;

    const file = e.target.files[0];
    const docType = e.target.dataset.docType;
    const userId = document.getElementById('empleado-details-name').dataset.userId;

    if (!file || !docType || !userId) return;

    const label = e.target.closest('label');
    label.textContent = 'Subiendo...';
    label.style.pointerEvents = 'none';

    try {
        const storageRef = ref(_storage, `employee_documents/${userId}/${docType}/${file.name}`);
        const snapshot = await uploadBytes(storageRef, file);
        const downloadURL = await getDownloadURL(snapshot.ref);

        // Usamos setDoc con el docType como ID para evitar duplicados
        // Esto sobrescribirá el documento anterior si suben uno nuevo
        const docRef = doc(_db, "users", userId, "documents", docType);

        await setDoc(docRef, {
            type: docType,
            name: file.name,
            url: downloadURL,
            uploadedAt: serverTimestamp()
        });

    } catch (error) {
        console.error("Error al subir documento de empleado:", error);
        alert("Error al subir documento.");
    } finally {
        label.textContent = 'Subir';
        label.style.pointerEvents = 'auto';
    }
}

/** * (FUNCIÓN CORREGIDA) 
 * Maneja el borrado de un documento de empleado.
 */
async function handleDocumentDelete(e) {
    const button = e.target.closest('[data-action="delete-empleado-doc"]');
    if (!button) return;

    const docId = button.dataset.docId; // Este es el ID del documento (ej. "cedula")
    const docUrl = button.dataset.docUrl; // URL del archivo en Storage
    const userId = document.getElementById('empleado-details-name').dataset.userId;

    if (!docId || !userId) return;

    _openConfirmModal("¿Seguro que quieres eliminar este documento?", async () => {
        try {
            // 1. Borrar el registro de Firestore
            await deleteDoc(doc(_db, "users", userId, "documents", docId));

            // 2. Borrar el archivo de Storage (si tenemos la URL)
            if (docUrl) {
                try {
                    const fileRef = ref(_storage, docUrl);
                    await deleteObject(fileRef);
                } catch (storageError) {
                    console.error("Error al borrar archivo de Storage (puede que ya no exista):", storageError);
                    // No detenemos el proceso si falla el borrado de Storage,
                    // lo principal es borrar el registro de Firestore.
                }
            }
        } catch (error) {
            console.error("Error al borrar documento:", error);
            alert("Error al borrar documento.");
        }
    });
}


/**
 * (FUNCIÓN EXISTENTE - SIN CAMBIOS)
 * Destruye la instancia del gráfico de empleado activa.
 */
function destroyActiveChart() {
    if (activeEmpleadoChart) {
        activeEmpleadoChart.destroy();
        activeEmpleadoChart = null;
    }
}

/**
 * (FUNCIÓN EXISTENTE - SIN CAMBIOS)
 * Crea un gráfico de barras para la productividad.
 */
function createProductivityChart(ctx, labels, dataBonificacion, dataEnTiempo, dataFueraTiempo) {
    if (!window.Chart) {
        console.error("Chart.js no está cargado.");
        return;
    }

    destroyActiveChart();

    activeEmpleadoChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Bonificación ($)',
                    data: dataBonificacion,
                    backgroundColor: '#84CC16', // lime-500
                    yAxisID: 'yBonificacion',
                    order: 3
                },
                {
                    label: 'M² a Tiempo',
                    data: dataEnTiempo,
                    backgroundColor: '#10B981', // green-500
                    yAxisID: 'yMetros',
                    order: 1,
                    stack: 'Stack 0',
                },
                {
                    label: 'M² Fuera de Tiempo',
                    data: dataFueraTiempo,
                    backgroundColor: '#EF4444', // red-500
                    yAxisID: 'yMetros',
                    order: 2,
                    stack: 'Stack 0',
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    stacked: true,
                },
                yMetros: {
                    type: 'linear',
                    position: 'left',
                    stacked: true,
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Metros Cuadrados (M²)'
                    }
                },
                yBonificacion: {
                    type: 'linear',
                    position: 'right',
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Bonificación (COP)'
                    },
                    grid: {
                        drawOnChartArea: false,
                    },
                }
            },
            plugins: {
                legend: {
                    position: 'bottom',
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                }
            }
        }
    });
}

/**
 * Abre el modal de creación de préstamo con calculadora en tiempo real.
 */
function openCustomInputModal(title, label, inputType = 'text', placeholder = '') {
    return new Promise((resolve) => {
        // 1. Crear el Overlay
        const overlay = document.createElement('div');
        overlay.className = "fixed inset-0 bg-gray-900 bg-opacity-50 z-[9999] flex items-center justify-center transition-opacity opacity-0";

        // 2. Crear la Tarjeta Modal
        const modal = document.createElement('div');
        modal.className = "bg-white rounded-xl shadow-2xl w-full max-w-md p-6 transform scale-95 transition-transform duration-200";

        modal.innerHTML = `
            <h3 class="text-lg font-bold text-gray-800 mb-4">${title}</h3>
            <div class="mb-5">
                <label class="block text-xs font-bold text-gray-500 uppercase mb-2">${label}</label>
                <input type="${inputType}" id="custom-modal-input" 
                    class="w-full border border-gray-300 rounded-lg p-3 text-gray-700 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                    placeholder="${placeholder}">
            </div>
            <div class="flex justify-end gap-3">
                <button id="btn-cancel-custom" class="px-4 py-2 text-sm font-bold text-gray-500 hover:bg-gray-100 rounded-lg transition-colors">
                    Cancelar
                </button>
                <button id="btn-confirm-custom" class="px-5 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-md transition-transform transform active:scale-95">
                    Confirmar
                </button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Animación de entrada
        requestAnimationFrame(() => {
            overlay.classList.remove('opacity-0');
            modal.classList.remove('scale-95');
            modal.classList.add('scale-100');
            document.getElementById('custom-modal-input').focus();
        });

        // Lógica de Cierre
        const close = (val) => {
            overlay.classList.add('opacity-0');
            modal.classList.remove('scale-100');
            modal.classList.add('scale-95');
            setTimeout(() => { if (document.body.contains(overlay)) document.body.removeChild(overlay); }, 200);
            resolve(val);
        };

        // Listeners
        document.getElementById('btn-cancel-custom').onclick = () => close(null);

        const confirmBtn = document.getElementById('btn-confirm-custom');
        const input = document.getElementById('custom-modal-input');

        const handleConfirm = () => {
            const val = input.value.trim();
            if (!val) {
                input.classList.add('border-red-500', 'ring-1', 'ring-red-500');
                input.focus();
                return;
            }
            close(val);
        };

        confirmBtn.onclick = handleConfirm;

        // Permitir Enter para confirmar
        input.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') handleConfirm();
            if (e.key === 'Escape') close(null);
        });
    });
}

/**
 * Abre un modal para seleccionar documentos y descargarlos como ZIP.
 * (CORREGIDO: Usa _db y agrega opción de Certificado sin sueldo)
 */
async function openBatchDownloadModal(user) {
    const userId = user.id;
    const userName = `${user.firstName}_${user.lastName}`.replace(/\s+/g, '_');

    // 1. Definir categorías RRHH
    const RELEVANT_RRHH = ['cedula', 'hoja_vida', 'certificados', 'seguridad_social'];
    const RRHH_LABELS = {
        'cedula': 'Cédula de Ciudadanía',
        'hoja_vida': 'Hoja de Vida',
        'certificados': 'Certificados de Estudio',
        'seguridad_social': 'Certificados ARL/EPS/CCF'
    };

    // 2. Modal UI
    let modalId = 'zip-download-modal';
    const existing = document.getElementById(modalId);
    if (existing) existing.remove();

    const modalHtml = `
        <div id="${modalId}" class="fixed inset-0 bg-gray-900 bg-opacity-50 z-[60] flex items-center justify-center transition-opacity">
            <div class="bg-white rounded-xl shadow-2xl w-full max-w-2xl p-6 m-4 transform transition-all scale-100">
                <div class="flex justify-between items-center mb-4 border-b pb-2">
                    <h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-file-zipper text-indigo-600 mr-2"></i> Compilar Documentos</h3>
                    <button id="close-zip-modal" class="text-gray-400 hover:text-gray-600"><i class="fa-solid fa-xmark text-xl"></i></button>
                </div>
                
                <div id="zip-modal-content" class="max-h-[60vh] overflow-y-auto custom-scrollbar p-1">
                    <div class="text-center py-10"><div class="loader mx-auto"></div><p class="text-xs text-gray-400 mt-2">Buscando documentos...</p></div>
                </div>

                <div class="mt-6 pt-4 border-t border-gray-100 flex flex-col sm:flex-row justify-between items-center gap-4">
                    
                    <button id="btn-gen-cert-sst" class="text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-colors border border-transparent hover:border-indigo-100 w-full sm:w-auto justify-center">
                        <i class="fa-solid fa-file-contract"></i> Certificado (Solo Cargo)
                    </button>

                    <div class="flex items-center gap-4 w-full sm:w-auto justify-end">
                        <div class="text-xs text-gray-500 text-right hidden sm:block">
                            <span id="zip-selected-count">0</span> seleccionados
                        </div>
                        <button id="btn-start-download" disabled class="bg-gray-300 text-white px-6 py-2 rounded-lg font-bold text-sm flex items-center justify-center transition-colors shadow-sm w-full sm:w-auto">
                            Descargar ZIP
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Listener para cerrar
    document.getElementById('close-zip-modal').onclick = () => document.getElementById(modalId).remove();

    // --- LISTENER DEL NUEVO BOTÓN DE CERTIFICADO ---
    document.getElementById('btn-gen-cert-sst').onclick = () => {
        document.getElementById(modalId).remove();

        // Usamos window.openMainModal porque estamos en un módulo
        if (window.openMainModal) {
            window.openMainModal('generate-certification', {
                ...user,
                forceNoSalary: true, // <--- ESTO ACTIVA EL MODO SIN SUELDO
                jobTitle: user.jobTitle || 'Operario'
            });
        }
    };

    try {
        // 3. Consultar documentos (USANDO _db)
        const q = query(collection(_db, "users", userId, "documents")); // <--- CORRECCIÓN AQUÍ (_db)
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            document.getElementById('zip-modal-content').innerHTML = `<p class="text-center text-gray-500 py-8">Este usuario no tiene documentos cargados.</p>`;
            return;
        }

        // 4. Clasificar
        const rrhhDocs = [];
        const sstDocs = [];

        snapshot.forEach(doc => {
            const data = doc.data();
            if (RELEVANT_RRHH.includes(data.category)) rrhhDocs.push(data);
            else if (data.category.startsWith('sst_')) sstDocs.push(data);
        });

        const contentDiv = document.getElementById('zip-modal-content');
        contentDiv.innerHTML = '';

        const renderSection = (title, docs, color) => {
            if (docs.length === 0) return '';
            let html = `<h4 class="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2 mt-4 border-b pb-1">${title}</h4>`;
            html += docs.map(doc => {
                const date = doc.uploadedAt ? doc.uploadedAt.toDate().toLocaleDateString() : '';
                const label = RRHH_LABELS[doc.category] || doc.description || doc.name;
                return `
                    <label class="flex items-center p-3 rounded-lg border border-gray-100 hover:bg-${color}-50 cursor-pointer transition-colors group">
                        <input type="checkbox" class="zip-checkbox form-checkbox h-5 w-5 text-${color}-600 rounded border-gray-300 focus:ring-${color}-500" 
                            data-url="${doc.url}" data-name="${doc.name}" data-cat="${doc.category}">
                        <div class="ml-3 flex-1 min-w-0">
                            <p class="text-sm font-bold text-gray-700 group-hover:text-${color}-700 truncate">${label}</p>
                            <p class="text-xs text-gray-400">${doc.name} • ${date}</p>
                        </div>
                        <i class="fa-solid fa-file-arrow-down text-gray-300 group-hover:text-${color}-400"></i>
                    </label>
                `;
            }).join('');
            return html;
        };

        contentDiv.innerHTML += renderSection('Documentos Personales (RRHH)', rrhhDocs, 'blue');
        contentDiv.innerHTML += renderSection('Seguridad y Salud (SST)', sstDocs, 'indigo');

        if (rrhhDocs.length === 0 && sstDocs.length === 0) {
            contentDiv.innerHTML = `<p class="text-center text-gray-500 py-8">No hay documentos de las categorías requeridas.</p>`;
            return;
        }

        // 5. Lógica de Selección
        const checkboxes = contentDiv.querySelectorAll('.zip-checkbox');
        const btnDownload = document.getElementById('btn-start-download');
        const countLabel = document.getElementById('zip-selected-count');

        const updateCount = () => {
            const count = contentDiv.querySelectorAll('.zip-checkbox:checked').length;
            countLabel.textContent = count;
            if (count > 0) {
                btnDownload.disabled = false;
                btnDownload.classList.remove('bg-gray-300');
                btnDownload.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
            } else {
                btnDownload.disabled = true;
                btnDownload.classList.add('bg-gray-300');
                btnDownload.classList.remove('bg-indigo-600', 'hover:bg-indigo-700');
            }
        };

        checkboxes.forEach(cb => cb.addEventListener('change', updateCount));

        btnDownload.onclick = async () => {
            const selected = Array.from(contentDiv.querySelectorAll('.zip-checkbox:checked'));
            if (selected.length === 0) return;
            btnDownload.disabled = true;
            btnDownload.innerHTML = `<div class="loader-small-white mr-2"></div> Comprimiendo...`;

            const zip = new JSZip();
            const folderName = `Documentos_${userName}`;
            const folder = zip.folder(folderName);

            try {
                const promises = selected.map(async (checkbox) => {
                    const url = checkbox.dataset.url;
                    const originalName = checkbox.dataset.name;
                    const category = checkbox.dataset.cat;
                    const safeName = originalName.replace(/[^a-z0-9.\-_]/gi, '_');
                    const fileName = `${category}_${safeName}`;

                    const response = await fetch(url);
                    if (!response.ok) throw new Error(`Error descargando ${originalName}`);
                    const blob = await response.blob();
                    folder.file(fileName, blob);
                });

                await Promise.all(promises);
                const content = await zip.generateAsync({ type: "blob" });
                saveAs(content, `${folderName}.zip`);

                if (window.showToast) window.showToast("Descarga iniciada.", "success");
                document.getElementById(modalId).remove();

            } catch (error) {
                console.error("Error ZIP:", error);
                if (window.showToast) window.showToast("Error en descarga.", "error");
                btnDownload.innerHTML = "Reintentar";
                btnDownload.disabled = false;
            }
        };

    } catch (error) {
        console.error("Error loading for zip:", error);
        document.getElementById('zip-modal-content').innerHTML = `<p class="text-red-500 text-center">Error cargando documentos.</p>`;
    }
}

// --- VARIABLES GLOBALES PARA ASISTENCIA ---
let attendanceChartInstance = null;
let attendanceMapInstance = null;
let attendanceMarkersLayer = null;

/**
 * Carga la pestaña de Asistencia / Reporte de Ingreso.
 * @param {string} userId - ID del empleado.
 * @param {number} days - Días a consultar (7, 15, 30).
 */
async function loadAttendanceTab(userId, days = 7) {
    const listBody = document.getElementById('attendance-list-body');
    const chartCanvas = document.getElementById('attendance-chart');

    if (!listBody || !chartCanvas) return;

    // 1. Calcular rango de fechas
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0); // Aseguramos inicio del día

    // Limpiar UI
    listBody.innerHTML = '<tr><td colspan="5" class="text-center py-4"><div class="loader mx-auto"></div></td></tr>';

    try {
        // 2. Consultar Firestore (CORREGIDO: Usamos _db en lugar de db)
        const q = query(
            collection(_db, "users", userId, "attendance_reports"),
            where("type", "==", "ingreso"),
            where("timestamp", ">=", startDate),
            orderBy("timestamp", "desc")
        );

        const snapshot = await getDocs(q);
        const reports = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // 3. Procesar datos para Grafica y Mapa
        const chartLabels = [];
        const chartData = [];
        const mapPoints = [];

        listBody.innerHTML = ''; // Limpiar loader

        if (reports.length === 0) {
            listBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-gray-500">No hay registros en este periodo.</td></tr>';
            if (attendanceChartInstance) attendanceChartInstance.destroy();

            // Limpiar mapa si existe
            if (attendanceMarkersLayer) attendanceMarkersLayer.clearLayers();
            return;
        }

        // Recorremos en orden inverso (cronológico para la gráfica)
        const reportsForChart = [...reports].reverse();

        reportsForChart.forEach(report => {
            const dateObj = report.timestamp.toDate();
            const dateStr = dateObj.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });

            // Convertir hora a decimal para la gráfica (Ej: 8:30 -> 8.5)
            const hours = dateObj.getHours();
            const minutes = dateObj.getMinutes();
            const timeDecimal = hours + (minutes / 60);

            chartLabels.push(dateStr);
            chartData.push(timeDecimal);
        });

        // Llenar Tabla (El más reciente primero)
        reports.forEach(report => {
            const dateObj = report.timestamp.toDate();
            const dateStr = dateObj.toLocaleDateString('es-CO');
            const timeStr = dateObj.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true });

            const lat = report.location?.lat;
            const lng = report.location?.lng;
            const hasLocation = lat && lng;

            if (hasLocation) {
                mapPoints.push({ lat, lng, date: `${dateStr} - ${timeStr}` });
            }

            // Detectar dispositivo simplificado
            let deviceName = "Móvil";
            if (report.device && report.device.includes("Windows")) deviceName = "PC";
            if (report.device && report.device.includes("Macintosh")) deviceName = "Mac";
            if (report.device && report.device.includes("Linux")) deviceName = "Linux";

            const row = document.createElement('tr');
            row.className = "bg-white border-b hover:bg-gray-50";
            row.innerHTML = `
                <td class="px-6 py-4 font-medium text-gray-900">${dateStr}</td>
                <td class="px-6 py-4 font-bold text-blue-600">${timeStr}</td>
                <td class="px-6 py-4 text-center">
                    ${report.photoURL ?
                    `<button onclick="window.openImageModal('${report.photoURL}')" class="text-xs bg-indigo-50 text-indigo-600 px-2 py-1 rounded border border-indigo-100 hover:bg-indigo-100 transition-colors">Ver Foto</button>`
                    : '<span class="text-gray-400">-</span>'}
                </td>
                <td class="px-6 py-4 text-center">
                    ${hasLocation ?
                    `<a href="https://www.google.com/maps/search/?api=1&query=${lat},${lng}" target="_blank" class="text-green-500 hover:text-green-700" title="Abrir en Google Maps"><i class="fa-solid fa-map-location-dot text-xl"></i></a>`
                    : '<span class="text-gray-300"><i class="fa-solid fa-location-slash"></i></span>'}
                </td>
                <td class="px-6 py-4 text-xs text-gray-500 truncate max-w-[150px]" title="${report.device || ''}">${deviceName}</td>
            `;
            listBody.appendChild(row);
        });

        // 4. Renderizar Gráfica
        if (typeof window.ensureChart === 'function') {
            await window.ensureChart();
        }
        renderAttendanceChart(chartCanvas, chartLabels, chartData);

        // 5. Renderizar Mapa (con pequeño delay para asegurar que el div es visible)
        setTimeout(() => {
            renderAttendanceMap(mapPoints);
        }, 200);

    } catch (error) {
        console.error("Error cargando asistencia:", error);
        listBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-red-500">Error cargando datos: ${error.message}</td></tr>`;
    }
}

function renderAttendanceChart(canvas, labels, data) {
    if (attendanceChartInstance) {
        attendanceChartInstance.destroy();
    }

    attendanceChartInstance = new Chart(canvas, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Hora de Ingreso',
                data: data,
                borderColor: '#2563eb', // Blue 600
                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                borderWidth: 2,
                pointBackgroundColor: '#fff',
                pointBorderColor: '#2563eb',
                pointRadius: 4,
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    min: 6, // 6:00 AM
                    max: 12, // 12:00 PM (ajustable)
                    ticks: {
                        callback: function (value) {
                            const hours = Math.floor(value);
                            const minutes = Math.round((value - hours) * 60);
                            const ampm = hours >= 12 ? 'PM' : 'AM';
                            const displayHour = hours > 12 ? hours - 12 : hours;
                            return `${displayHour}:${minutes.toString().padStart(2, '0')} ${ampm}`;
                        }
                    },
                    title: { display: true, text: 'Hora (AM)' }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const value = context.raw;
                            const hours = Math.floor(value);
                            const minutes = Math.round((value - hours) * 60);
                            return `Llegada: ${hours}:${minutes.toString().padStart(2, '0')}`;
                        }
                    }
                }
            }
        }
    });
}

async function renderAttendanceMap(points) {
    const mapContainer = document.getElementById('attendance-map');
    if (!mapContainer) return;

    await window.ensureLeaflet();

    // Si el mapa no está inicializado, crearlo
    if (!attendanceMapInstance) {
        // Coordenadas por defecto (Colombia) o la primera del punto
        const center = points.length > 0 ? [points[0].lat, points[0].lng] : [4.6097, -74.0817];
        attendanceMapInstance = L.map('attendance-map').setView(center, 12);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(attendanceMapInstance);

        attendanceMarkersLayer = L.layerGroup().addTo(attendanceMapInstance);
    } else {
        // Si ya existe, invalidar tamaño (fix común de Leaflet en pestañas ocultas)
        attendanceMapInstance.invalidateSize();
    }

    // Limpiar marcadores anteriores
    if (attendanceMarkersLayer) attendanceMarkersLayer.clearLayers();

    if (points.length > 0) {
        const group = new L.featureGroup();

        points.forEach(p => {
            const marker = L.marker([p.lat, p.lng])
                .bindPopup(`<b>${p.date}</b>`)
                .addTo(attendanceMarkersLayer);
            group.addLayer(marker);
        });

        // Ajustar zoom para ver todos los puntos
        attendanceMapInstance.fitBounds(group.getBounds().pad(0.1));
    }
}

// Exponer openPaymentVoucherModal al cargarse el módulo para que esté accesible dinámicamente
window.openPaymentVoucherModal = openPaymentVoucherModal;

// ==========================================
// COMPATIBILIDAD CON EL FLUJO CLÁSICO
// ==========================================

export function loadEmpleados() {
    if (!currentUserData || currentUserData.role !== 'admin') {
        return () => { }; 
    }

    const cachedData = localStorage.getItem(EMPLEADOS_CACHE_KEY);
    
    let mapUsers = new Map();
    let maxLastUpdated = 0; // Guardará la fecha exacta del documento más reciente

    // 1. Cargar desde el caché local (Velocidad instantánea)
    if (cachedData) {
        try {
            const parsedData = JSON.parse(cachedData);
            parsedData.forEach(u => {
                mapUsers.set(u.id, u);
                // Buscamos cuál es el timestamp más reciente que tenemos guardado
                if (u._lastUpdated && u._lastUpdated > maxLastUpdated) {
                    maxLastUpdated = u._lastUpdated;
                }
            });
            setAllUsers(Array.from(mapUsers.values()));
            renderAndAttachEmployeeListeners(Array.from(mapUsers.values()));
        } catch (e) {
            console.warn("Caché de empleados corrupto. Se limpiará.");
            localStorage.removeItem(EMPLEADOS_CACHE_KEY);
            localStorage.removeItem(EMPLEADOS_SYNC_KEY);
        }
    }

    // 2. onSnapshot Diferencial basado en la información real del servidor
    const colRef = collection(db, "users");
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
                mapUsers.set(doc.id, { id: doc.id, ...data });
                huboCambios = true;
            }
            if (change.type === "removed") {
                mapUsers.delete(doc.id);
                huboCambios = true;
            }
        });

        // 4. Si hubo un cambio, actualizamos la memoria, el caché local y la pantalla
        if (huboCambios) {
            const finalArray = Array.from(mapUsers.values());
            
            finalArray.sort((a, b) => {
                const statusOrder = { 'pending': 1, 'inactive': 2, 'active': 3 };
                const orderA = statusOrder[a.status] || 99;
                const orderB = statusOrder[b.status] || 99;
                if (orderA !== orderB) return orderA - orderB;
                return (a.nombre || '').localeCompare(b.nombre || '');
            });

            localStorage.setItem(EMPLEADOS_CACHE_KEY, JSON.stringify(finalArray));
            
            setAllUsers(finalArray);
            renderAndAttachEmployeeListeners(finalArray);
            
            if (!isInitial) {
                console.log(`[Empleados] ${snapshot.docChanges().length} cambios detectados en tiempo real.`);
            }
        }
        isInitial = false;
    }, (error) => {
        console.error("Error en onSnapshot diferencial de empleados:", error);
    });

    return unsubscribe;
}

function updateLocalCache(newOrUpdatedUser) {
    const cachedData = localStorage.getItem(EMPLEADOS_CACHE_KEY);
    let users = cachedData ? JSON.parse(cachedData) : [];
    
    const index = users.findIndex(u => u.id === newOrUpdatedUser.id);
    if (index !== -1) users[index] = newOrUpdatedUser;
    else users.push(newOrUpdatedUser);
    
    users.sort((a, b) => {
        const statusOrder = { 'pending': 1, 'inactive': 2, 'active': 3 };
        const orderA = statusOrder[a.status] || 99;
        const orderB = statusOrder[b.status] || 99;
        if (orderA !== orderB) return orderA - orderB;
        return (a.nombre || '').localeCompare(b.nombre || '');
    });
    
    localStorage.setItem(EMPLEADOS_CACHE_KEY, JSON.stringify(users));
    setAllUsers(users);
    renderAndAttachEmployeeListeners(users);
}

export function loadAllLoanRequests() {
    const q = query(collection(db, "prestamos"), where("status", "==", "solicitado"));
    return onSnapshot(q, (snapshot) => {
        const pending = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setAllPendingLoans(pending);
        
        const badge = document.getElementById('header-loan-badge');
        if (badge) {
            if (pending.length > 0) {
                badge.textContent = pending.length;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }
    }, (error) => {
        console.warn("Error en onSnapshot de todas las solicitudes de préstamo:", error.message || error);
    });
}

// --- RENDERIZADO Y MODALES DE EMPLEADOS ---
function renderAndAttachEmployeeListeners(users) {
    const empleadosListEl = document.getElementById('empleados-list');
    if (!empleadosListEl) return;

    // 1. Filtrar los usuarios según el estado del botón
    const filteredUsers = users.filter(u => {
        if (showInactiveEmployees) return true; // Mostrar todos
        return u.status !== 'inactive'; // Ocultar inactivos
    });

    // Ordenar: planta (1), facturador (2), admin (3) al final. Si son iguales, por nombre alfabéticamente.
    const roleOrder = {
        'planta': 1,
        'facturador': 2,
        'admin': 3
    };
    filteredUsers.sort((a, b) => {
        const orderA = roleOrder[(a.role || '').toLowerCase().trim()] || 99;
        const orderB = roleOrder[(b.role || '').toLowerCase().trim()] || 99;
        if (orderA !== orderB) {
            return orderA - orderB;
        }
        return (a.nombre || '').localeCompare(b.nombre || '');
    });

    // 2. Construir la cabecera con el botón de filtro
    const activeCount = users.filter(u => u.status === 'active').length;
    const inactiveCount = users.filter(u => u.status === 'inactive').length;
    const pendingCount = users.filter(u => u.status === 'pending').length;

    let htmlContent = `
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-5 bg-slate-50 border border-slate-200/60 p-4 rounded-2xl shadow-xs">
            <div class="text-xs sm:text-sm text-slate-600">
                <span class="font-bold text-slate-800">Total:</span> ${users.length} 
                <span class="mx-1 text-slate-300">&bull;</span>
                <span class="text-emerald-700 font-semibold">${activeCount} Activos</span>, 
                <span class="text-amber-700 font-semibold">${pendingCount} Pendientes</span>, 
                <span class="text-slate-500 font-semibold">${inactiveCount} Inactivos</span>
            </div>
            <button id="toggle-inactive-btn" class="w-full sm:w-auto text-center text-xs font-bold px-4 py-2.5 rounded-xl transition-all shadow-xs ${showInactiveEmployees ? 'bg-slate-800 hover:bg-slate-900 text-white' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'}">
                ${showInactiveEmployees ? 'Ocultar Inactivos' : 'Mostrar Inactivos'}
            </button>
        </div>
        <div class="space-y-4">
    `;

    if (filteredUsers.length === 0) {
        htmlContent += `<p class="text-center text-slate-500 py-6">No hay empleados para mostrar con los filtros actuales.</p>`;
    }

    // 3. Generar las tarjetas de los empleados
    filteredUsers.forEach(empleado => {
        const isMe = (empleado.id === currentUser.uid); // Comprobamos si es el propio admin
        const nameInitial = (empleado.nombre || 'E').charAt(0).toUpperCase();

        let statusBadge = '';
        let toggleButtonHTML = '';

        switch (empleado.status) {
            case 'active':
                statusBadge = `<span class="bg-emerald-50 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded-md border border-emerald-250 uppercase tracking-wider">Activo</span>`;
                toggleButtonHTML = `<button data-uid="${empleado.id}" data-status="inactive" class="user-status-btn bg-amber-600 hover:bg-amber-700 text-white py-2 px-3 sm:py-2.5 sm:px-4 rounded-xl text-xs sm:text-sm font-bold transition w-full shadow-xs">Desactivar</button>`;
                break;
            case 'inactive':
                statusBadge = `<span class="bg-slate-100 text-slate-700 text-[10px] font-bold px-2 py-0.5 rounded-md border border-slate-250 uppercase tracking-wider">Inactivo</span>`;
                toggleButtonHTML = `<button data-uid="${empleado.id}" data-status="active" class="user-status-btn bg-emerald-650 hover:bg-emerald-755 text-white py-2 px-3 sm:py-2.5 sm:px-4 rounded-xl text-xs sm:text-sm font-bold transition w-full shadow-xs">Activar</button>`;
                break;
            default:
                statusBadge = `<span class="bg-amber-50 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded-md border border-amber-250 uppercase tracking-wider">Pendiente</span>`;
                toggleButtonHTML = `<button data-uid="${empleado.id}" data-status="active" class="user-status-btn bg-emerald-650 hover:bg-emerald-755 text-white py-2 px-3 sm:py-2.5 sm:px-4 rounded-xl text-xs sm:text-sm font-bold transition w-full shadow-xs">Activar</button>`;
                break;
        }

        // Medida de seguridad: Si es el propio Admin, no puede desactivarse ni eliminarse
        if (isMe) {
            toggleButtonHTML = `<button disabled class="bg-slate-100 text-slate-400 border border-slate-200 py-2 px-3 sm:py-2.5 sm:px-4 rounded-xl text-xs sm:text-sm font-bold cursor-not-allowed w-full shadow-xs">Tu Cuenta</button>`;
        }

        // Si el usuario está inactivo, le ponemos un fondo gris claro a su tarjeta para distinguirlo rápidamente
        const cardBgClass = empleado.status === 'inactive' ? 'opacity-70 bg-slate-50' : 'bg-white';

        htmlContent += `
            <div class="premium-card premium-card-indigo p-4 sm:p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 ${cardBgClass} shadow-xs hover:shadow-md transition">
                <div class="flex items-center gap-4 flex-grow w-full text-left min-w-0">
                    <div class="premium-avatar premium-avatar-indigo flex-shrink-0">${nameInitial}</div>
                    <div class="flex-grow min-w-0">
                        <div class="flex items-center gap-2 mb-1 flex-wrap">
                             <p class="font-extrabold text-base sm:text-lg text-slate-900 truncate">${empleado.nombre} ${isMe ? '<span class="text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded ml-2 uppercase">Tú</span>' : ''}</p>
                             ${statusBadge}
                        </div>
                        <p class="text-xs text-slate-500 font-medium">${empleado.email} &bull; <span class="font-bold text-indigo-650 uppercase text-[10px] tracking-wider">${empleado.role}</span></p>
                    </div>
                </div>
                <div class="flex-shrink-0 grid grid-cols-2 sm:grid-cols-3 lg:flex lg:flex-row gap-2 w-full sm:w-auto mt-2 sm:mt-0">
                    <button data-user-json='${JSON.stringify(empleado)}' class="manage-rrhh-docs-btn bg-teal-650 hover:bg-teal-755 text-white py-2 px-3 sm:py-2.5 sm:px-4 rounded-xl text-xs sm:text-sm font-bold transition shadow-xs">RR.HH.</button>
                    <button data-user-json='${JSON.stringify(empleado)}' class="manage-user-btn bg-indigo-650 hover:bg-indigo-755 text-white py-2 px-3 sm:py-2.5 sm:px-4 rounded-xl text-xs sm:text-sm font-bold transition shadow-xs">Gestionar</button>
                    <div class="col-span-2 sm:col-span-1 w-full lg:w-auto">
                        ${toggleButtonHTML}
                    </div>
                </div>
            </div>`;
    });

    htmlContent += `</div>`; // Cerramos el contenedor de las tarjetas
    empleadosListEl.innerHTML = htmlContent;

    // 4. Asignar Eventos a los Botones
    
    // Botón de Filtro
    const toggleBtn = document.getElementById('toggle-inactive-btn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            showInactiveEmployees = !showInactiveEmployees;
            renderAndAttachEmployeeListeners(users); // Volvemos a dibujar la lista
        });
    }

    // Botones de Estado (Activar/Desactivar)
    document.querySelectorAll('.user-status-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const userId = e.currentTarget.dataset.uid;
            const newStatus = e.currentTarget.dataset.status;
            
            if (currentUserData.role !== 'admin') {
                return showModalMessage("Solo los administradores pueden hacer esto.");
            }

            if (confirm(`¿Estás seguro de que quieres cambiar el estado de este usuario a "${newStatus}"?`)) {
                showModalMessage("Actualizando estado...", true);
                try {
                    await updateDoc(doc(db, "users", userId), {
                        status: newStatus,
                        _lastUpdated: serverTimestamp()
                    });
                    
                    const userActual = allUsers.find(u => u.id === userId);
                    if (userActual) {
                        updateLocalCache({ ...userActual, status: newStatus, _lastUpdated: Date.now() });
                    }

                    hideModal();
                    showTemporaryMessage("Estado del usuario actualizado.", "success");
                } catch (error) {
                    console.error("Error al cambiar estado en Firestore:", error);
                    showModalMessage(`Error de permisos: Asegúrate de ser Administrador.`);
                }
            }
        });
    });

    // Botones de RRHH y Gestionar
    document.querySelectorAll('.manage-rrhh-docs-btn').forEach(btn => btn.addEventListener('click', (e) => showRRHHModal(JSON.parse(e.currentTarget.dataset.userJson))));
    document.querySelectorAll('.manage-user-btn').forEach(btn => btn.addEventListener('click', (e) => showAdminEditUserModal(JSON.parse(e.currentTarget.dataset.userJson))));
}

function showAdminEditUserModal(user) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    const userPermissions = user.permissions || {};

    let permissionsHTML = ALL_MODULES.filter(m => m !== 'empleados').map(module => {
        const isChecked = userPermissions[module] || false;
        const capitalized = module.charAt(0).toUpperCase() + module.slice(1);
        return `
                <label class="flex items-center space-x-2" style="display: flex !important;">
                    <input type="checkbox" class="permission-checkbox h-4 w-4 rounded border-slate-350 text-indigo-600 focus:ring-indigo-500" data-module="${module}" ${isChecked ? 'checked' : ''}>
                    <span class="text-sm font-semibold text-slate-700">${capitalized}</span>
                </label>
            `;
    }).join('');

    modalContentWrapper.innerHTML = `
        <div class="modal-card max-w-lg w-full mx-auto" style="height: auto; max-height: 85vh;">
            <div class="modal-header-fixed">
                <h2 class="text-xl font-bold text-slate-800">Gestionar Empleado: ${user.nombre}</h2>
                <button id="close-admin-edit-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <form id="admin-edit-user-form" class="modal-body-scroll p-6 space-y-4">
                <input type="hidden" id="admin-edit-user-id" value="${user.id}">
                <div>
                    <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Nombre Completo</label>
                    <input type="text" id="admin-edit-name" class="w-full p-2.5 border border-slate-300 rounded-xl bg-white shadow-xs focus:ring-2 focus:ring-indigo-500 text-sm" value="${user.nombre || ''}" required>
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Cédula de Ciudadanía</label>
                    <input type="text" id="admin-edit-id-number" class="w-full p-2.5 border border-slate-300 rounded-xl bg-white shadow-xs focus:ring-2 focus:ring-indigo-500 text-sm" value="${user.idNumber || user.cedula || ''}" placeholder="Ej: 10203040">
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Correo Electrónico</label>
                    <input type="email" id="admin-edit-email" class="w-full p-2.5 border border-slate-300 rounded-xl bg-white shadow-xs focus:ring-2 focus:ring-indigo-500 text-sm" value="${user.email || ''}" required>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Teléfono</label>
                        <input type="tel" id="admin-edit-phone" class="w-full p-2.5 border border-slate-300 rounded-xl bg-white shadow-xs focus:ring-2 focus:ring-indigo-500 text-sm" value="${user.telefono || ''}">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Fecha de Nacimiento</label>
                        <input type="date" id="admin-edit-dob" class="w-full p-2.5 border border-slate-300 rounded-xl bg-white shadow-xs focus:ring-2 focus:ring-indigo-500 text-sm" value="${user.dob || ''}">
                    </div>
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Dirección</label>
                    <input type="text" id="admin-edit-address" class="w-full p-2.5 border border-slate-300 rounded-xl bg-white shadow-xs focus:ring-2 focus:ring-indigo-500 text-sm" value="${user.direccion || ''}">
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Rol</label>
                    <select id="admin-edit-role-select" class="w-full p-2.5 border border-slate-300 rounded-xl bg-white shadow-xs focus:ring-2 focus:ring-indigo-500 text-sm">
                        <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Administrador</option>
                        <option value="planta" ${user.role === 'planta' ? 'selected' : ''}>Planta</option>
                        <option value="contabilidad" ${user.role === 'contabilidad' ? 'selected' : ''}>Contabilidad</option>
                    </select>
                </div>
                <div class="bg-slate-50 border border-slate-100 p-4 rounded-2xl space-y-3">
                    <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Datos de Pago y Nómina</label>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label class="block text-[11px] font-bold text-slate-500 uppercase tracking-wider">Banco</label>
                            <input type="text" id="admin-edit-bank-name" class="w-full p-2.5 border border-slate-300 rounded-xl bg-white shadow-xs focus:ring-2 focus:ring-indigo-500 text-sm shadow-xs" value="${user.bankName || ''}">
                        </div>
                        <div>
                            <label class="block text-[11px] font-bold text-slate-500 uppercase tracking-wider">Tipo de Cuenta</label>
                            <select id="admin-edit-account-type" class="w-full p-2.5 border border-slate-300 rounded-xl bg-white shadow-xs focus:ring-2 focus:ring-indigo-500 text-sm shadow-xs">
                                <option value="" ${!user.accountType ? 'selected' : ''}>Seleccione...</option>
                                <option value="Ahorros" ${user.accountType === 'Ahorros' ? 'selected' : ''}>Ahorros</option>
                                <option value="Corriente" ${user.accountType === 'Corriente' ? 'selected' : ''}>Corriente</option>
                            </select>
                        </div>
                    </div>
                    <div>
                        <label class="block text-[11px] font-bold text-slate-500 uppercase tracking-wider">Número de Cuenta</label>
                        <input type="text" id="admin-edit-account-number" class="w-full p-2.5 border border-slate-300 rounded-xl bg-white shadow-xs focus:ring-2 focus:ring-indigo-500 text-sm shadow-xs" value="${user.accountNumber || ''}">
                    </div>
                    <label class="flex items-center space-x-2 pt-1" style="display: flex !important;">
                        <input type="checkbox" id="admin-edit-deduccion-sobre-minimo" class="h-4 w-4 rounded border-slate-350 text-indigo-650 focus:ring-indigo-500" ${user.deduccionSobreMinimo === true || user.deduccionSobreMinimo === 'true' ? 'checked' : ''}>
                        <span class="text-sm font-semibold text-slate-700">Calcular prestaciones sobre el Mínimo Legal</span>
                    </label>
                </div>
                <div id="admin-edit-permissions-container" class="bg-slate-50 border border-slate-100 p-4 rounded-2xl">
                    <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Permisos de Módulos</label>
                    <div class="grid grid-cols-2 gap-3">
                        ${permissionsHTML}
                    </div>
                </div>
                <button type="submit" class="w-full bg-indigo-650 hover:bg-indigo-755 text-white font-bold py-3 rounded-xl transition-colors shadow-xs mt-2">Guardar Cambios</button>
            </form>
        </div>
        `;

    const roleSelect = document.getElementById('admin-edit-role-select');
    const permissionsContainer = document.getElementById('admin-edit-permissions-container');

    function togglePermissionsUI(role) {
        permissionsContainer.style.display = (role === 'admin') ? 'none' : 'block';
    }

    roleSelect.addEventListener('change', (e) => togglePermissionsUI(e.target.value));
    togglePermissionsUI(user.role);

    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-admin-edit-modal').addEventListener('click', hideModal);
    
    document.getElementById('admin-edit-user-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const userId = document.getElementById('admin-edit-user-id').value;
        const newRole = document.getElementById('admin-edit-role-select').value;
        const newPermissions = {};

        document.querySelectorAll('#admin-edit-permissions-container .permission-checkbox').forEach(cb => {
            newPermissions[cb.dataset.module] = cb.checked;
        });

        const updatedData = {
            nombre: document.getElementById('admin-edit-name').value,
            cedula: document.getElementById('admin-edit-id-number').value,
            idNumber: document.getElementById('admin-edit-id-number').value,
            email: document.getElementById('admin-edit-email').value,
            telefono: document.getElementById('admin-edit-phone').value,
            direccion: document.getElementById('admin-edit-address').value,
            dob: document.getElementById('admin-edit-dob').value,
            role: newRole,
            permissions: (newRole === 'admin') ? {} : newPermissions,
            bankName: document.getElementById('admin-edit-bank-name').value,
            accountType: document.getElementById('admin-edit-account-type').value,
            accountNumber: document.getElementById('admin-edit-account-number').value,
            deduccionSobreMinimo: document.getElementById('admin-edit-deduccion-sobre-minimo').checked,
            _lastUpdated: serverTimestamp() 
        };

        showModalMessage("Guardando cambios...", true);
        try {
            await updateDoc(doc(db, "users", userId), updatedData);
            
            updateLocalCache({ ...user, ...updatedData, _lastUpdated: Date.now() });

            hideModal();
            showModalMessage("Datos del empleado actualizados.", false, 2000);
        } catch (error) {
            console.error("Error al actualizar empleado:", error);
            showModalMessage("Error al guardar los cambios.");
        }
    });
}

function showRRHHModal(empleado) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');

    modalContentWrapper.innerHTML = `
            <div class="modal-card max-w-5xl w-full mx-auto" style="height: 85vh; max-height: 85vh;">
                <div class="modal-header-fixed">
                    <h2 class="text-xl font-bold text-slate-800">Recursos Humanos: ${empleado.nombre}</h2>
                    <button id="close-rrhh-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
                </div>
                <div class="border-b border-slate-200 bg-slate-50/50 flex-shrink-0">
                    <nav class="-mb-px flex space-x-6 px-6 overflow-x-auto">
                        <button id="rrhh-tab-contratacion" class="dashboard-tab-btn active py-4 px-1 font-semibold whitespace-nowrap border-b-2 border-transparent transition-all">Datos y Contratación</button>
                        <button id="rrhh-tab-descargos" class="dashboard-tab-btn py-4 px-1 font-semibold whitespace-nowrap border-b-2 border-transparent transition-all">Descargos</button>
                        <button id="rrhh-tab-prestamos" class="dashboard-tab-btn py-4 px-1 font-semibold whitespace-nowrap border-b-2 border-transparent transition-all">Préstamos</button>
                    </nav>
                </div>
                <div class="modal-body-scroll p-6 flex-grow flex flex-col min-h-0">
                    <div id="rrhh-view-contratacion" class="w-full"></div>
                    <div id="rrhh-view-descargos" class="hidden w-full"></div>
                    <div id="rrhh-view-prestamos" class="hidden w-full"></div>
                </div>
            </div>
        `;
    document.getElementById('modal').classList.remove('hidden');

    document.getElementById('close-rrhh-modal').addEventListener('click', hideModal);

    const tabs = [
        document.getElementById('rrhh-tab-contratacion'),
        document.getElementById('rrhh-tab-descargos'),
        document.getElementById('rrhh-tab-prestamos')
    ];
    const views = [
        document.getElementById('rrhh-view-contratacion'),
        document.getElementById('rrhh-view-descargos'),
        document.getElementById('rrhh-view-prestamos')
    ];

    const switchRrhhTab = (activeIndex) => {
        tabs.forEach((tab, index) => tab.classList.toggle('active', index === activeIndex));
        views.forEach((view, index) => view.classList.toggle('hidden', index !== activeIndex));
    };

    tabs.forEach((tab, i) => tab.addEventListener('click', () => switchRrhhTab(i)));

    renderContratacionTab(empleado, views[0]);
    renderDescargosTab(empleado, views[1]);
    renderPrestamosTab(empleado, views[2]);
}
function renderContratacionTab(empleado, container) {
    const contratacionData = empleado.contratacion || {};
    const yearsWithData = Object.keys(contratacionData).filter(key => !isNaN(parseInt(key)));
    const currentYear = new Date().getFullYear().toString();
    const availableYears = [...new Set([currentYear, ...yearsWithData])].sort((a, b) => b - a);

    const selectedYear = availableYears[0];
    let yearOptions = availableYears.map(year => `<option value="${year}" ${year === selectedYear ? 'selected' : ''}>${year}</option>`).join('');
    container.innerHTML = `
        <form id="contratacion-form" class="space-y-6">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div class="space-y-4">
                    <h3 class="text-lg font-bold text-slate-800 border-b border-slate-100 pb-2">Información Laboral</h3>
                    <div>
                        <label class="block text-sm font-semibold text-slate-700">Cédula de Ciudadanía</label>
                        <input type="text" id="rrhh-idNumber" class="w-full p-2.5 border border-slate-300 rounded-lg mt-1 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all bg-white" value="${empleado.idNumber || empleado.cedula || ''}" placeholder="Ej: 10203040">
                    </div>
                    <div>
                        <label class="block text-sm font-semibold text-slate-700">Fecha de Ingreso</label>
                        <input type="date" id="rrhh-fechaIngreso" class="w-full p-2.5 border border-slate-300 rounded-lg mt-1 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all bg-white" value="${contratacionData.fechaIngreso || ''}">
                    </div>
                    <div>
                        <label class="block text-sm font-semibold text-slate-700">Salario</label>
                        <input type="text" id="rrhh-salario" class="w-full p-2.5 border border-slate-300 rounded-lg mt-1 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all bg-white" value="${contratacionData.salario ? formatCurrency(contratacionData.salario) : ''}">
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-semibold text-slate-700">EPS</label>
                            <input type="text" id="rrhh-eps" class="w-full p-2.5 border border-slate-300 rounded-lg mt-1 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all bg-white" value="${contratacionData.eps || ''}">
                        </div>
                        <div>
                            <label class="block text-sm font-semibold text-slate-700">AFP</label>
                            <input type="text" id="rrhh-afp" class="w-full p-2.5 border border-slate-300 rounded-lg mt-1 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all bg-white" value="${contratacionData.afp || ''}">
                        </div>
                    </div>
                    
                    <div class="bg-slate-50 border border-slate-100 p-4 rounded-xl space-y-3">
                        <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider">Datos de Pago y Nómina</label>
                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label class="block text-[11px] font-bold text-slate-500 uppercase tracking-wider">Banco</label>
                                <input type="text" id="rrhh-bank-name" class="w-full p-2.5 border border-slate-300 rounded-xl bg-white shadow-xs focus:ring-2 focus:ring-indigo-500 text-sm" value="${empleado.bankName || ''}">
                            </div>
                            <div>
                                <label class="block text-[11px] font-bold text-slate-500 uppercase tracking-wider">Tipo de Cuenta</label>
                                <select id="rrhh-account-type" class="w-full p-2.5 border border-slate-300 rounded-xl bg-white shadow-xs focus:ring-2 focus:ring-indigo-500 text-sm">
                                    <option value="" ${!empleado.accountType ? 'selected' : ''}>Seleccione...</option>
                                    <option value="Ahorros" ${empleado.accountType === 'Ahorros' ? 'selected' : ''}>Ahorros</option>
                                    <option value="Corriente" ${empleado.accountType === 'Corriente' ? 'selected' : ''}>Corriente</option>
                                </select>
                            </div>
                        </div>
                        <div>
                            <label class="block text-[11px] font-bold text-slate-500 uppercase tracking-wider">Número de Cuenta</label>
                            <input type="text" id="rrhh-account-number" class="w-full p-2.5 border border-slate-300 rounded-xl bg-white shadow-xs focus:ring-2 focus:ring-indigo-500 text-sm" value="${empleado.accountNumber || ''}">
                        </div>
                        <label class="flex items-center space-x-2 pt-1" style="display: flex !important;">
                            <input type="checkbox" id="rrhh-deduccion-sobre-minimo" class="h-4 w-4 rounded border-slate-350 text-indigo-650 focus:ring-indigo-500" ${empleado.deduccionSobreMinimo === true || empleado.deduccionSobreMinimo === 'true' ? 'checked' : ''}>
                            <span class="text-xs font-semibold text-slate-700">Calcular prestaciones sobre el Mínimo Legal</span>
                        </label>
                    </div>
                </div>
                <div class="space-y-4">
                    <div class="flex flex-col sm:flex-row justify-between sm:items-center border-b border-slate-100 pb-2 gap-2">
                        <h3 class="text-lg font-bold text-slate-800">Documentos</h3>
                        <div class="flex items-center gap-2">
                            <label for="rrhh-year-filter" class="text-sm font-medium text-slate-600">Año:</label>
                            <select id="rrhh-year-filter" class="p-1.5 border border-slate-300 rounded-lg bg-white shadow-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500">${yearOptions}</select>
                            <button type="button" id="download-all-docs-btn" class="bg-indigo-650 hover:bg-indigo-700 text-white font-bold py-1.5 px-3 rounded-lg text-sm transition-colors shadow-sm">Descargar Todo</button>
                        </div>
                    </div>
                    <div id="rrhh-documents-list" class="border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden bg-white shadow-sm"></div>
                </div>
            </div>
            <div class="flex justify-end pt-4 border-t border-slate-100">
                <button type="submit" class="bg-indigo-650 text-white font-bold py-2.5 px-6 rounded-xl hover:bg-indigo-700 transition-colors shadow-sm">Guardar Información</button>
            </div>
        </form>
    `;
    renderDocumentList(empleado, selectedYear);

    document.getElementById('rrhh-year-filter').addEventListener('change', (e) => {
        renderDocumentList(empleado, e.target.value);
    });

    const salarioInput = document.getElementById('rrhh-salario');
    if (salarioInput) {
        salarioInput.addEventListener('focus', (e) => unformatCurrencyInput(e.target));
        salarioInput.addEventListener('blur', (e) => formatCurrencyInput(e.target));
    }

    const contratacionForm = document.getElementById('contratacion-form');
    if (contratacionForm) {
        contratacionForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const updatedData = {
                "cedula": document.getElementById('rrhh-idNumber').value,
                "idNumber": document.getElementById('rrhh-idNumber').value,
                "contratacion.fechaIngreso": document.getElementById('rrhh-fechaIngreso').value,
                "contratacion.salario": unformatCurrency(document.getElementById('rrhh-salario').value),
                "contratacion.eps": document.getElementById('rrhh-eps').value,
                "contratacion.afp": document.getElementById('rrhh-afp').value,
                "bankName": document.getElementById('rrhh-bank-name').value,
                "accountType": document.getElementById('rrhh-account-type').value,
                "accountNumber": document.getElementById('rrhh-account-number').value,
                "deduccionSobreMinimo": document.getElementById('rrhh-deduccion-sobre-minimo').checked,
                "_lastUpdated": serverTimestamp()
            };
            showTemporaryMessage("Guardando datos...", "info");
            try {
                await updateDoc(doc(db, "users", empleado.id), updatedData);
                
                empleado.cedula = updatedData.cedula;
                empleado.idNumber = updatedData.idNumber;
                if (!empleado.contratacion) empleado.contratacion = {};
                empleado.contratacion.fechaIngreso = updatedData["contratacion.fechaIngreso"];
                empleado.contratacion.salario = updatedData["contratacion.salario"];
                empleado.contratacion.eps = updatedData["contratacion.eps"];
                empleado.contratacion.afp = updatedData["contratacion.afp"];
                empleado.bankName = updatedData.bankName;
                empleado.accountType = updatedData.accountType;
                empleado.accountNumber = updatedData.accountNumber;
                empleado.deduccionSobreMinimo = updatedData.deduccionSobreMinimo;
                updateLocalCache({ ...empleado, _lastUpdated: Date.now() });

                showTemporaryMessage("Datos guardados con éxito.", "success");
            } catch (error) {
                console.error("Error al guardar datos:", error);
                showTemporaryMessage("Error al guardar los datos.", "error");
            }
        });
    }

    document.getElementById('download-all-docs-btn').addEventListener('click', () => {
        const selectedYear = document.getElementById('rrhh-year-filter').value;
        downloadAllDocsAsZip(empleado, selectedYear);
    });
}

function renderDocumentList(empleado, year) {
    const documentsListContainer = document.getElementById('rrhh-documents-list');
    if (!documentsListContainer) return;

    const contratacionData = empleado.contratacion || {};
    const documentosDelAnio = contratacionData[year]?.documentos || {};

    let documentsHTML = RRHH_DOCUMENT_TYPES.map(docType => {
        const docUrl = documentosDelAnio[docType.id];
        const fileInputId = `file-rrhh-${docType.id}-${empleado.id}`;
        return `
            <div class="flex justify-between items-center p-3.5 hover:bg-slate-50 transition-colors">
                <span class="font-semibold text-sm text-slate-700">${docType.name}</span>
                <div class="flex items-center gap-3">
                    ${docUrl ? `
                        <span class="text-xs font-semibold bg-green-100 text-green-800 px-2 py-0.5 rounded-full">Adjunto</span>
                        <button type="button" data-pdf-url="${docUrl}" data-doc-name="${docType.name}" class="view-rrhh-pdf-btn bg-indigo-550 hover:bg-indigo-100 text-indigo-700 font-bold px-3 py-1.5 rounded-lg text-xs transition-colors shadow-xs">Ver</button>
                    ` : `
                        <span class="text-xs font-medium text-slate-400">Sin archivo</span>
                    `}
                    <input type="file" id="${fileInputId}" class="hidden" accept=".pdf,.jpg,.jpeg,.png">
                    <label for="${fileInputId}" style="display: inline-block !important;" class="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors border border-slate-200 shadow-xs">Adjuntar</label>
                </div>
            </div>
        `;
    }).join('');

    documentsListContainer.innerHTML = documentsHTML;

    documentsListContainer.querySelectorAll('.view-rrhh-pdf-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            showPdfModal(e.currentTarget.dataset.pdfUrl, e.currentTarget.dataset.docName);
        });
    });

    RRHH_DOCUMENT_TYPES.forEach(docType => {
        const fileInput = documentsListContainer.querySelector(`#file-rrhh-${docType.id}-${empleado.id}`);
        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    const selectedYear = document.getElementById('rrhh-year-filter').value;
                    const docPath = `contratacion.${selectedYear}.documentos.${docType.id}`;
                    handleFileUpload(empleado, docPath, file);
                }
            });
        }
    });
}

async function handleFileUpload(empleado, docPath, file) {
    if (!file) return;
    showTemporaryMessage(`Subiendo ${file.name}...`, 'info');

    const storageRef = ref(storage, `empleados/${empleado.id}/documentos/${docPath.split('.').pop()}_${Date.now()}_${file.name}`);
    try {
        const snapshot = await uploadBytes(storageRef, file);
        const downloadURL = await getDownloadURL(snapshot.ref);
        const updatePayload = { _lastUpdated: serverTimestamp() };
        updatePayload[docPath] = downloadURL;
        await updateDoc(doc(db, "users", empleado.id), updatePayload);
        
        const updatedDoc = await getDocs(query(collection(db, "users"), where("__name__", "==", empleado.id)));
        if (!updatedDoc.empty) {
            updateLocalCache({ id: empleado.id, ...updatedDoc.docs[0].data() });
            showRRHHModal(allUsers.find(u => u.id === empleado.id));
        }
        
        showTemporaryMessage("¡Documento subido con éxito!", 'success');
    } catch (error) {
        console.error("Error al subir el archivo:", error);
        showTemporaryMessage("Error al subir el archivo.", 'error');
    }
}

async function downloadAllDocsAsZip(empleado, year) {
    const documentos = empleado.contratacion?.[year]?.documentos;
    if (!documentos || Object.keys(documentos).length === 0) {
        showModalMessage("Este empleado no tiene documentos para descargar en este año.");
        return;
    }

    showModalMessage("Preparando descarga... Esto puede tardar unos segundos.", true);

    try {
        const zip = new window.JSZip();
        const promises = [];

        for (const docType in documentos) {
            const url = documentos[docType];
            if (url) {
                const promise = fetch(url)
                    .then(response => {
                        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                        return response.blob();
                    })
                    .then(blob => {
                        const docInfo = RRHH_DOCUMENT_TYPES.find(d => d.id === docType);
                        const docName = docInfo ? docInfo.name.replace(/ /g, '_') : docType;
                        let fileExtension = 'pdf'; 
                        try {
                            const urlPath = new URL(url).pathname;
                            const extensionMatch = urlPath.match(/\.([^.]+)$/);
                            if (extensionMatch) fileExtension = extensionMatch[1].split('?')[0];
                            else fileExtension = blob.type.split('/')[1] || 'pdf';
                        } catch (e) {
                            fileExtension = blob.type.split('/')[1] || 'pdf';
                        }
                        zip.file(`${docName}.${fileExtension}`, blob);
                    })
                    .catch(error => {
                        console.error(`No se pudo descargar ${docType}:`, error);
                        zip.file(`ERROR_${docType}.txt`, `Error: ${error.message}`);
                    });
                promises.push(promise);
            }
        }

        await Promise.all(promises);

        zip.generateAsync({ type: "blob" }).then(function (content) {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(content);
            a.download = `documentos_${empleado.nombre.replace(/ /g, '_')}_${year}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
            hideModal();
        });
    } catch (error) {
        console.error("Error al crear el archivo zip:", error);
        showModalMessage("Error al crear el archivo ZIP.");
    }
}



function renderDescargosTab(empleado, container) {
    const descargos = empleado.descargos || [];
    const descargosHTML = descargos.length > 0
        ? descargos.slice().sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).map((d) => `
                <div class="bg-slate-50 border border-slate-100 p-4 rounded-xl shadow-xs">
                    <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                        <div>
                            <p class="font-bold text-slate-800 text-sm">${d.motivo}</p>
                            <p class="text-xs text-slate-400 mt-1">Fecha de reunión: ${d.fecha}</p>
                        </div>
                        <div class="flex items-center gap-2 border-t sm:border-t-0 pt-2 sm:pt-0 w-full sm:w-auto">
                            ${d.citacionUrl ? `<button type="button" data-pdf-url="${d.citacionUrl}" data-doc-name="Citación" class="view-rrhh-pdf-btn text-xs font-bold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors border border-indigo-100 shadow-xs">Citación</button>` : ''}
                            ${d.actaUrl ? `<button type="button" data-pdf-url="${d.actaUrl}" data-doc-name="Acta" class="view-rrhh-pdf-btn text-xs font-bold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors border border-indigo-100 shadow-xs">Acta</button>` : ''}
                            ${d.conclusionUrl ? `<button type="button" data-pdf-url="${d.conclusionUrl}" data-doc-name="Conclusión" class="view-rrhh-pdf-btn text-xs font-bold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors border border-indigo-100 shadow-xs">Conclusión</button>` : ''}
                        </div>
                    </div>
                </div>
            `).join('')
        : '<p class="text-center text-slate-500 py-6 text-sm">No hay descargos registrados.</p>';

    container.innerHTML = `
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div class="md:col-span-1">
                    <div class="bg-slate-50 border border-slate-100 p-4 rounded-xl shadow-xs">
                        <h3 class="text-sm font-bold text-slate-800 border-b border-slate-100 pb-2">Registrar Descargo</h3>
                        <form id="descargos-form" class="space-y-4 mt-3">
                            <div>
                                <label for="descargo-fecha" class="text-xs font-semibold text-slate-600">Fecha de Reunión</label>
                                <input type="date" id="descargo-fecha" class="w-full p-2.5 border border-slate-300 rounded-lg mt-1 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all bg-white" required>
                            </div>
                            <div>
                                <label for="descargo-motivo" class="text-xs font-semibold text-slate-600">Motivo de Reunión</label>
                                <textarea id="descargo-motivo" class="w-full p-2.5 border border-slate-300 rounded-lg mt-1 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all bg-white" rows="3" required></textarea>
                            </div>
                            <div>
                                <label for="descargo-citacion" class="text-xs font-semibold text-slate-600">Citación a descargos (PDF)</label>
                                <input type="file" id="descargo-citacion" class="w-full text-xs mt-1 block file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200" accept=".pdf">
                            </div>
                            <div>
                                <label for="descargo-acta" class="text-xs font-semibold text-slate-600">Acta de descargos (PDF)</label>
                                <input type="file" id="descargo-acta" class="w-full text-xs mt-1 block file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200" accept=".pdf">
                            </div>
                            <div>
                                <label for="descargo-conclusion" class="text-xs font-semibold text-slate-600">Conclusión de descargos (PDF)</label>
                                <input type="file" id="descargo-conclusion" class="w-full text-xs mt-1 block file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200" accept=".pdf">
                            </div>
                            <button type="submit" class="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-lg transition-colors shadow-xs">Guardar Descargo</button>
                        </form>
                    </div>
                </div>
                <div class="md:col-span-2">
                     <h3 class="text-lg font-bold text-slate-800 mb-2">Historial de Descargos</h3>
                     <div class="space-y-3">${descargosHTML}</div>
                </div>
            </div>
        `;
    document.querySelectorAll('.view-rrhh-pdf-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            showPdfModal(e.currentTarget.dataset.pdfUrl, e.currentTarget.dataset.docName);
        });
    });

    document.getElementById('descargos-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fecha = document.getElementById('descargo-fecha').value;
        const motivo = document.getElementById('descargo-motivo').value;
        const citacionFile = document.getElementById('descargo-citacion').files[0];
        const actaFile = document.getElementById('descargo-acta').files[0];
        const conclusionFile = document.getElementById('descargo-conclusion').files[0];

        showModalMessage("Guardando descargo y subiendo archivos...", true);

        try {
            const timestamp = Date.now();
            const uploadPromises = [];
            const fileData = {};

            if (citacionFile) {
                const citacionRef = ref(storage, `empleados/${empleado.id}/descargos/${timestamp}_citacion.pdf`);
                uploadPromises.push(uploadBytes(citacionRef, citacionFile).then(snap => getDownloadURL(snap.ref)).then(url => fileData.citacionUrl = url));
            }
            if (actaFile) {
                const actaRef = ref(storage, `empleados/${empleado.id}/descargos/${timestamp}_acta.pdf`);
                uploadPromises.push(uploadBytes(actaRef, actaFile).then(snap => getDownloadURL(snap.ref)).then(url => fileData.actaUrl = url));
            }
            if (conclusionFile) {
                const conclusionRef = ref(storage, `empleados/${empleado.id}/descargos/${timestamp}_conclusion.pdf`);
                uploadPromises.push(uploadBytes(conclusionRef, conclusionFile).then(snap => getDownloadURL(snap.ref)).then(url => fileData.conclusionUrl = url));
            }

            await Promise.all(uploadPromises);

            const nuevoDescargo = { fecha, motivo, ...fileData, timestamp: new Date().toISOString() };
            await updateDoc(doc(db, "users", empleado.id), { descargos: arrayUnion(nuevoDescargo), _lastUpdated: serverTimestamp() });
            
            const updatedUser = { ...empleado, descargos: [...descargos, nuevoDescargo], _lastUpdated: Date.now() };
            updateLocalCache(updatedUser);

            e.target.reset();
            showModalMessage("Descargo registrado con éxito.", false, 2000);
            showRRHHModal(updatedUser);
        } catch (error) {
            console.error("Error al registrar descargo:", error);
            showModalMessage("Error al guardar el descargo.");
        }
    });
}

// --- SISTEMA DE PRÉSTAMOS ---
function renderPrestamosTab(empleado, container) {
    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    let monthOptions = monthNames.map((month, i) => `<option value="${i}" ${i === currentMonth ? 'selected' : ''}>${month}</option>`).join('');
    let yearOptions = '';
    for (let i = 0; i < 5; i++) {
        const year = currentYear - i;
        yearOptions += `<option value="${year}">${year}</option>`;
    }

    container.innerHTML = `
        <div class="space-y-5">
            <div class="bg-slate-50 border border-slate-100 p-4 rounded-xl shadow-xs">
                <h3 class="text-sm font-bold text-slate-800 border-b border-slate-100 pb-2">Filtrar Préstamos</h3>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
                    <div>
                        <label class="block text-xs font-semibold text-slate-600 mb-1">Filtrar por Mes</label>
                        <div class="flex gap-2">
                            <select id="loan-month-filter" class="p-2 border border-slate-300 rounded-lg bg-white w-full focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all">${monthOptions}</select>
                            <select id="loan-year-filter" class="p-2 border border-slate-300 rounded-lg bg-white w-full focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all">${yearOptions}</select>
                        </div>
                    </div>
                    <div>
                        <label class="block text-xs font-semibold text-slate-600 mb-1">Filtrar por Rango</label>
                        <div class="flex gap-2 items-center">
                            <input type="date" id="loan-start-date" class="p-2 border border-slate-300 rounded-lg w-full focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all">
                            <span class="text-slate-400 font-bold">-</span>
                            <input type="date" id="loan-end-date" class="p-2 border border-slate-300 rounded-lg w-full focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all">
                        </div>
                    </div>
                </div>
            </div>
            <div>
                <h3 class="text-lg font-bold text-slate-800 mb-2">Solicitudes de Préstamo</h3>
                <div id="rrhh-prestamos-list" class="space-y-3">Cargando...</div>
            </div>
        </div>
    `;

    const monthFilter = document.getElementById('loan-month-filter');
    const yearFilter = document.getElementById('loan-year-filter');
    const startDateFilter = document.getElementById('loan-start-date');
    const endDateFilter = document.getElementById('loan-end-date');

    const filterLoans = async () => {
        const startDate = startDateFilter.value;
        const endDate = endDateFilter.value;
        const month = monthFilter.value;
        const year = yearFilter.value;
        let prestamosQuery;

        if (startDate && endDate) {
            prestamosQuery = query(
                collection(db, "prestamos"),
                where("employeeId", "==", empleado.id),
                where("requestDate", ">=", startDate),
                where("requestDate", "<=", endDate)
            );
        } else {
            const firstDay = new Date(year, month, 1).toISOString().split('T')[0];
            const lastDay = new Date(year, parseInt(month) + 1, 0).toISOString().split('T')[0];
            prestamosQuery = query(
                collection(db, "prestamos"),
                where("employeeId", "==", empleado.id),
                where("requestDate", ">=", firstDay),
                where("requestDate", "<=", lastDay)
            );
        }

        const snapshot = await getDocs(prestamosQuery);
        const prestamos = snapshot.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => new Date(b.requestDate) - new Date(a.requestDate));
        renderLoanList(prestamos);
    };

    monthFilter.addEventListener('change', () => { startDateFilter.value = ''; endDateFilter.value = ''; filterLoans(); });
    yearFilter.addEventListener('change', () => { startDateFilter.value = ''; endDateFilter.value = ''; filterLoans(); });
    endDateFilter.addEventListener('change', () => {
        if (startDateFilter.value) {
            monthFilter.value = now.getMonth();
            yearFilter.value = now.getFullYear();
            filterLoans();
        }
    });

    filterLoans();
}

function renderLoanList(prestamos) {
    const prestamosListEl = document.getElementById('rrhh-prestamos-list');
    if (!prestamosListEl) return;

    if (prestamos.length === 0) {
        prestamosListEl.innerHTML = '<p class="text-center text-gray-500 py-4">No se encontraron préstamos para el filtro seleccionado.</p>';
        return;
    }
    prestamosListEl.innerHTML = '';
    prestamos.forEach(p => {
        const el = document.createElement('div');
        el.className = 'bg-slate-50 border border-slate-100 p-4 rounded-xl shadow-xs hover:shadow-md transition-shadow';

        let statusBadge = '';
        let actions = '';
        switch (p.status) {
            case 'solicitado':
                statusBadge = `<span class="text-xs font-semibold bg-yellow-100 text-yellow-800 px-2.5 py-1 rounded-full border border-yellow-200">Solicitado</span>`;
                actions = `
                    <button data-loan-json='${JSON.stringify(p)}' class="approve-loan-btn bg-green-600 hover:bg-green-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors shadow-xs">Aprobar</button>
                    <button data-loan-id="${p.id}" data-action="denegado" class="loan-action-btn bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors shadow-xs">Denegar</button>
                `;
                break;
            case 'aprobado': statusBadge = `<span class="text-xs font-semibold bg-blue-100 text-blue-800 px-2.5 py-1 rounded-full border border-blue-200">Aprobado</span>`; break;
            case 'cancelado': statusBadge = `<span class="text-xs font-semibold bg-slate-100 text-slate-800 px-2.5 py-1 rounded-full border border-slate-200">Cancelado</span>`; break;
            case 'denegado': statusBadge = `<span class="text-xs font-semibold bg-red-100 text-red-800 px-2.5 py-1 rounded-full border border-red-200">Denegado</span>`; break;
        }
        el.innerHTML = `
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div>
                    <p class="font-black text-xl text-indigo-650">${formatCurrency(p.amount)}</p>
                    <p class="text-sm text-slate-700 italic mt-0.5">"${p.reason}"</p>
                    <p class="text-xs text-slate-400 mt-1">Solicitado el: ${p.requestDate}</p>
                </div>
                <div class="flex items-center gap-3 mt-3 sm:mt-0 border-t sm:border-t-0 pt-2 sm:pt-0 w-full sm:w-auto justify-between sm:justify-end">
                    ${statusBadge}
                    <div class="flex items-center gap-2">${actions}</div>
                </div>
            </div>
        `;
        prestamosListEl.appendChild(el);
    });

    prestamosListEl.querySelectorAll('.approve-loan-btn').forEach(btn => {
        btn.addEventListener('click', (e) => showApproveLoanModal(JSON.parse(e.currentTarget.dataset.loanJson)));
    });
    prestamosListEl.querySelectorAll('.loan-action-btn').forEach(btn => {
        btn.addEventListener('click', (e) => handleLoanAction(e.currentTarget.dataset.loanId, e.currentTarget.dataset.action));
    });
}

function showLoanRequestModal() {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');

    modalContentWrapper.innerHTML = `
        <div class="modal-card max-w-lg w-full mx-auto text-left">
            <div class="modal-header-fixed">
                <h2 class="text-xl font-bold text-slate-800">Solicitud de Préstamo</h2>
                <button id="close-loan-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <div class="modal-body-scroll space-y-6">
                <form id="loan-request-form" class="space-y-4">
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label for="loan-amount" class="block text-sm font-semibold text-slate-700">Monto a Solicitar</label>
                            <input type="text" id="loan-amount" class="w-full p-2.5 border border-slate-300 rounded-lg mt-1 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white transition-all font-mono font-bold text-slate-800" inputmode="numeric" required>
                        </div>
                        <div>
                            <label for="loan-installments" class="block text-sm font-semibold text-slate-700">Número de Cuotas</label>
                            <input type="number" id="loan-installments" min="1" max="48" value="1" class="w-full p-2.5 border border-slate-300 rounded-lg mt-1 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white transition-all font-bold text-center text-slate-800" required>
                        </div>
                    </div>
                    <div>
                        <label for="loan-reason" class="block text-sm font-semibold text-slate-700">Motivo</label>
                        <textarea id="loan-reason" class="w-full p-2.5 border border-slate-300 rounded-lg mt-1 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white transition-all" rows="3" required></textarea>
                    </div>
                    <button type="submit" class="w-full bg-indigo-650 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-xl transition-colors shadow-sm">Enviar Solicitud</button>
                </form>
                <div class="border-t border-slate-100 pt-4">
                    <h3 class="text-base font-bold text-slate-800">Mis Solicitudes</h3>
                    <div id="my-loans-list" class="space-y-3 mt-3 max-h-60 overflow-y-auto divide-y divide-slate-100">Cargando...</div>
                </div>
            </div>
        </div>
    `;
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-loan-modal').addEventListener('click', hideModal);

    const amountInput = document.getElementById('loan-amount');
    amountInput.addEventListener('focus', (e) => unformatCurrencyInput(e.target));
    amountInput.addEventListener('blur', (e) => formatCurrencyInput(e.target));

    document.getElementById('loan-request-form').addEventListener('submit', handleLoanRequestSubmit);

    if (unsubscribeMyLoans) {
        unsubscribeMyLoans();
        unsubscribeMyLoans = null;
    }
    const loansListEl = document.getElementById('my-loans-list');
    const q = query(collection(db, "prestamos"), where("employeeId", "==", currentUser.uid));
    unsubscribeMyLoans = onSnapshot(q, (snapshot) => {
        const prestamos = snapshot.docs.map(d => d.data());
        prestamos.sort((a, b) => new Date(b.requestDate) - new Date(a.requestDate));

        if (prestamos.length === 0) {
            loansListEl.innerHTML = '<p class="text-center text-gray-500 py-4">No tienes solicitudes de préstamo.</p>';
            return;
        }
        loansListEl.innerHTML = '';
        prestamos.forEach(p => {
            const el = document.createElement('div');
            el.className = 'bg-slate-50 border border-slate-100 p-3 rounded-xl flex justify-between items-center';
            let statusBadge = '';
            switch (p.status) {
                case 'solicitado': statusBadge = `<span class="text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-250 px-2 py-0.5 rounded-md uppercase tracking-wider">Solicitado</span>`; break;
                case 'aprobado': statusBadge = `<span class="text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-250 px-2 py-0.5 rounded-md uppercase tracking-wider">Aprobado</span>`; break;
                case 'cancelado': statusBadge = `<span class="text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200 px-2 py-0.5 rounded-md uppercase tracking-wider">Cancelado</span>`; break;
                case 'denegado': statusBadge = `<span class="text-[10px] font-bold bg-rose-50 text-rose-800 border border-rose-200 px-2 py-0.5 rounded-md uppercase tracking-wider">Denegado</span>`; break;
            }
            el.innerHTML = `
                    <div>
                        <p class="font-extrabold text-slate-800">${formatCurrency(p.amount)}</p>
                        <div class="flex items-center gap-2 mt-0.5">
                            <span class="text-xs text-slate-400 font-medium">${p.requestDate}</span>
                            ${p.installments ? `<span class="h-1.5 w-1.5 rounded-full bg-slate-300"></span><span class="text-xs text-slate-450 font-semibold">Cuotas: ${p.installments}</span>` : ''}
                        </div>
                    </div>
                    ${statusBadge}
                `;
            loansListEl.appendChild(el);
        });
    }, (error) => {
        console.warn("Error en onSnapshot de préstamos del empleado:", error.message || error);
    });
}

async function handleLoanRequestSubmit(e) {
    e.preventDefault();
    const amount = unformatCurrency(document.getElementById('loan-amount').value);
    const installments = parseInt(document.getElementById('loan-installments').value) || 1;
    const reason = document.getElementById('loan-reason').value;

    if (amount <= 0) return showModalMessage("El monto debe ser mayor a cero.");
    if (installments <= 0) return showModalMessage("El número de cuotas debe ser mayor a cero.");

    const newLoan = {
        employeeId: currentUser.uid,
        employeeName: currentUserData.nombre,
        amount: amount,
        installments: installments,
        reason: reason,
        requestDate: new Date().toISOString().split('T')[0],
        status: 'solicitado'
    };

    showModalMessage("Enviando solicitud...", true);
    try {
        await addDoc(collection(db, "prestamos"), newLoan);
        hideModal();
        showModalMessage("¡Solicitud enviada con éxito!", false, 2000);
    } catch (error) {
        console.error("Error al solicitar préstamo:", error);
        showModalMessage("Error al enviar la solicitud.");
    }
}

function showAllLoansModal(requests) {
    const getInitials = (name) => {
        if (!name) return '??';
        const parts = name.trim().split(/\s+/);
        if (parts.length >= 2) {
            return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        }
        return parts[0].substring(0, 2).toUpperCase();
    };

    let requestsHTML = '';
    if (requests.length === 0) {
        requestsHTML = `
            <div class="text-center py-12">
                <i class="fa-solid fa-folder-open text-slate-300 text-4xl mb-3"></i>
                <p class="text-slate-450 italic text-sm">No hay solicitudes de préstamo pendientes.</p>
            </div>
        `;
    } else {
        requests.sort((a, b) => new Date(b.requestDate) - new Date(a.requestDate));
        requestsHTML = requests.map(p => {
            const empleado = allUsers.find(u => u.id === p.employeeId);
            const initials = getInitials(p.employeeName);
            const requestDateStr = p.requestDate || 'N/A';
            const bankName = empleado?.bankName || 'No registrado';
            const accountType = empleado?.accountType || 'Sin tipo';
            const accountNumber = empleado?.accountNumber || 'No registrado';

            return `
            <div class="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs text-left space-y-4 hover:shadow-md transition-shadow relative overflow-hidden">
                <!-- Top Row: User details & status -->
                <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center font-bold text-indigo-650 text-xs shrink-0">
                            ${initials}
                        </div>
                        <div>
                            <h4 class="text-sm font-black text-slate-800 leading-tight uppercase">${p.employeeName}</h4>
                            <p class="text-[10px] text-slate-400 mt-0.5">Solicitado el ${requestDateStr}</p>
                        </div>
                    </div>
                    <span class="text-[9px] font-black bg-amber-50 text-amber-600 border border-amber-200 px-2.5 py-1 rounded-full uppercase tracking-wider flex items-center gap-1.5 shrink-0">
                        <i class="fa-solid fa-circle text-[5px] text-amber-500 animate-pulse"></i> Pendiente
                    </span>
                </div>

                <!-- Two-Column Details -->
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-slate-100">
                    <!-- Left: Amount & Comment -->
                    <div class="space-y-2">
                        <span class="block text-[8px] font-black text-slate-400 uppercase tracking-widest">Monto Solicitado</span>
                        <div class="flex items-baseline gap-1.5">
                            <span class="text-xl font-black text-slate-800">${formatCurrency(p.amount)}</span>
                            <span class="text-[10px] font-black text-slate-400">(${p.installments || 1} pagos)</span>
                        </div>
                        <div class="bg-slate-50 border border-slate-100 p-2.5 rounded-xl text-xs text-slate-500 italic">
                            "${p.reason || 'Sin motivo especificado'}"
                        </div>
                    </div>

                    <!-- Right: Destination bank account -->
                    <div class="space-y-2">
                        <span class="block text-[8px] font-black text-slate-400 uppercase tracking-widest">Cuenta de Destino</span>
                        <div class="flex items-center gap-3 bg-slate-50/50 border border-slate-100 p-2.5 rounded-xl">
                            <div class="w-9 h-9 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-650 text-sm shrink-0">
                                <i class="fa-solid fa-building-columns"></i>
                            </div>
                            <div class="flex-1 min-w-0">
                                <p class="text-xs font-black text-slate-700 uppercase leading-tight truncate">${bankName}</p>
                                <p class="text-[9px] text-indigo-650 mt-0.5 truncate">${accountType}</p>
                            </div>
                            <div class="bg-white border border-indigo-100 rounded px-2 py-1 flex items-center gap-1.5 font-mono text-[10px] font-bold text-slate-800 shrink-0">
                                <span class="transfer-account-number-list">${accountNumber}</span>
                                ${empleado?.accountNumber ? `
                                <button type="button" class="btn-copy-account-list text-indigo-400 hover:text-indigo-650 transition-colors" data-account-number="${accountNumber}" title="Copiar cuenta">
                                    <i class="fa-regular fa-copy"></i>
                                </button>
                                ` : ''}
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Footer: Action -->
                <div class="flex justify-end pt-2 border-t border-slate-100">
                    <button data-loan-json='${JSON.stringify(p)}' class="approve-loan-btn bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black uppercase tracking-wider px-4 py-2 rounded-xl transition-all shadow-xs flex items-center gap-1.5 transform active:scale-95">
                        Revisar y Aprobar <i class="fa-solid fa-arrow-right"></i>
                    </button>
                </div>
            </div>`;
        }).join('');
    }

    const activeUsers = [];
    allUsers.forEach(u => {
        if (u.status === 'active') activeUsers.push(u);
    });
    activeUsers.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
    const activeUsersOptionsHTML = activeUsers.map(u => {
        const displayName = (u.firstName && u.lastName) ? `${u.firstName} ${u.lastName}` : (u.nombre || 'Colaborador Sin Nombre');
        return `<option value="${u.id}">${displayName} (${u.role || 'Operario'})</option>`;
    }).join('');

    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    modalContentWrapper.innerHTML = `
        <div class="modal-card max-w-4xl w-full mx-auto overflow-hidden rounded-2xl shadow-xl bg-white flex flex-col" style="height: 85vh; max-height: 85vh;">
            <!-- Header -->
            <div class="bg-[#1e293b] p-4 text-white flex items-center justify-between shrink-0">
                <div class="flex items-center gap-3">
                    <div class="bg-white/10 p-2.5 rounded-full flex items-center justify-center">
                        <i class="fa-solid fa-inbox text-xl text-white"></i>
                    </div>
                    <div>
                        <h2 class="text-base font-black text-white leading-tight">Solicitudes Pendientes</h2>
                        <p class="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">Revisión y aprobación de créditos</p>
                    </div>
                </div>
                <button id="close-all-loans-modal" class="text-white/80 hover:text-white text-2xl transition-colors">&times;</button>
            </div>

            <!-- Tab Navigation -->
            <div class="bg-white border-b border-slate-100 flex px-6 shrink-0 gap-6">
                <button id="tab-btn-pending" class="py-3.5 text-xs font-black uppercase tracking-wider border-b-2 border-indigo-600 text-indigo-600 flex items-center gap-2 transition-all">
                    <i class="fa-solid fa-folder-open"></i> Solicitudes Pendientes
                </button>
                <button id="tab-btn-history" class="py-3.5 text-xs font-black uppercase tracking-wider border-b-2 border-transparent text-slate-400 hover:text-slate-650 flex items-center gap-2 transition-all">
                    <i class="fa-solid fa-clock-rotate-left"></i> Historial por Colaborador
                </button>
            </div>

            <!-- Scrollable Body Container -->
            <div class="flex-1 overflow-y-auto p-6 bg-slate-50/50">
                <!-- Content Tab 1: Pending Requests -->
                <div id="content-tab-pending" class="space-y-4">
                    ${requestsHTML}
                </div>

                <!-- Content Tab 2: History (hidden by default) -->
                <div id="content-tab-history" class="hidden space-y-4">
                    <div class="bg-white border border-slate-200 p-4 rounded-xl shadow-xs space-y-3">
                        <label for="history-user-select" class="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Seleccionar Colaborador</label>
                        <select id="history-user-select" class="w-full p-2.5 border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-indigo-500 outline-none text-xs font-semibold text-slate-700">
                            <option value="">-- Elija un Colaborador --</option>
                            ${activeUsersOptionsHTML}
                        </select>
                    </div>
                    <div id="history-results-container" class="space-y-4">
                        <p class="text-center text-slate-450 italic py-8 text-xs">Seleccione un colaborador para cargar su historial de créditos.</p>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.getElementById('modal').classList.remove('hidden');

    // Cancel / Close Buttons
    document.getElementById('close-all-loans-modal').onclick = hideModal;

    // Tabs navigation event listeners
    const tabPendingBtn = document.getElementById('tab-btn-pending');
    const tabHistoryBtn = document.getElementById('tab-btn-history');
    const contentPending = document.getElementById('content-tab-pending');
    const contentHistory = document.getElementById('content-tab-history');

    tabPendingBtn.onclick = () => {
        tabPendingBtn.className = "py-3.5 text-xs font-black uppercase tracking-wider border-b-2 border-indigo-600 text-indigo-600 flex items-center gap-2 transition-all";
        tabHistoryBtn.className = "py-3.5 text-xs font-black uppercase tracking-wider border-b-2 border-transparent text-slate-400 hover:text-slate-650 flex items-center gap-2 transition-all";
        contentPending.classList.remove('hidden');
        contentHistory.classList.add('hidden');
    };

    tabHistoryBtn.onclick = () => {
        tabHistoryBtn.className = "py-3.5 text-xs font-black uppercase tracking-wider border-b-2 border-indigo-600 text-indigo-600 flex items-center gap-2 transition-all";
        tabPendingBtn.className = "py-3.5 text-xs font-black uppercase tracking-wider border-b-2 border-transparent text-slate-400 hover:text-slate-650 flex items-center gap-2 transition-all";
        contentPending.classList.add('hidden');
        contentHistory.classList.remove('hidden');
    };

    // Copy Account Buttons in Card List
    modalContentWrapper.querySelectorAll('.btn-copy-account-list').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const num = e.currentTarget.dataset.accountNumber;
            navigator.clipboard.writeText(num);
            if (window.showToast) window.showToast("Número de cuenta copiado.", 'success');
        };
    });

    // History select handler
    const historySelect = document.getElementById('history-user-select');
    if (historySelect) {
        historySelect.onchange = async (e) => {
            const userId = e.target.value;
            const resultsContainer = document.getElementById('history-results-container');
            if (!userId) {
                resultsContainer.innerHTML = '<p class="text-center text-slate-450 italic py-8 text-xs">Seleccione un colaborador para cargar su historial de créditos.</p>';
                return;
            }
            resultsContainer.innerHTML = '<div class="py-8 text-center"><p class="text-xs text-slate-400">Cargando historial...</p></div>';
            try {
                const snap = await getDocs(query(collection(db, "users", userId, "loans"), orderBy("date", "desc")));
                if (snap.empty) {
                    resultsContainer.innerHTML = '<p class="text-center text-slate-450 italic py-8 text-xs">Este colaborador no registra historial de préstamos.</p>';
                    return;
                }
                let html = '';
                snap.forEach(docSnap => {
                    const l = docSnap.data();
                    let statusBadge = '';
                    if (l.status === 'active') {
                        statusBadge = '<span class="text-[9px] font-black bg-emerald-50 text-emerald-600 border border-emerald-200 px-2 py-0.5 rounded-full uppercase">Activo</span>';
                    } else if (l.status === 'paid') {
                        statusBadge = '<span class="text-[9px] font-black bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 rounded-full uppercase">Pagado</span>';
                    }
                    html += `
                        <div class="bg-white border border-slate-200 p-4 rounded-xl shadow-xs text-left space-y-3">
                            <div class="flex justify-between items-center border-b border-slate-100 pb-2">
                                <div>
                                    <p class="text-xs font-black text-slate-700">${l.description || 'Préstamo'}</p>
                                    <p class="text-[9px] text-slate-405 mt-0.5">Fecha: ${l.date}</p>
                                </div>
                                ${statusBadge}
                            </div>
                            <div class="grid grid-cols-2 gap-4 text-xs">
                                <div>
                                    <p class="text-slate-400 font-semibold text-[10px]">Monto Original</p>
                                    <p class="font-black text-slate-800 font-mono mt-0.5">${formatCurrency(l.amount)}</p>
                                </div>
                                <div>
                                    <p class="text-slate-400 font-semibold text-[10px]">Saldo Pendiente</p>
                                    <p class="font-black text-rose-600 font-mono mt-0.5">${formatCurrency(l.balance)}</p>
                                </div>
                            </div>
                        </div>
                    `;
                });
                resultsContainer.innerHTML = html;
            } catch (err) {
                console.error("Error al consultar historial:", err);
                resultsContainer.innerHTML = '<p class="text-center text-rose-500 py-8 text-xs">Error al cargar el historial de créditos.</p>';
            }
        };
    }

    // Approve Loan buttons (open approval modal)
    modalContentWrapper.querySelectorAll('.approve-loan-btn').forEach(btn => {
        btn.addEventListener('click', (e) => showApproveLoanModal(JSON.parse(e.currentTarget.dataset.loanJson), true));
    });
}

// Publish showAllLoansModal globally
window.showAllLoansModal = showAllLoansModal;

function showApproveLoanModal(loan, fromListModal = false) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    const metodosDePagoHTML = METODOS_DE_PAGO.map(metodo => `<option value="${metodo}">${metodo}</option>`).join('');
    const applicant = allUsers.find(u => u.id === loan.employeeId);

    const getInitials = (name) => {
        if (!name) return '??';
        const parts = name.trim().split(/\s+/);
        if (parts.length >= 2) {
            return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        }
        return parts[0].substring(0, 2).toUpperCase();
    };

    modalContentWrapper.innerHTML = `
        <div class="modal-card max-w-3xl w-full mx-auto text-left border border-slate-200 overflow-hidden rounded-2xl shadow-xl bg-white">
            <!-- Header -->
            <div class="bg-gradient-to-r from-emerald-600 to-teal-650 p-4 text-white flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <div class="bg-white/20 p-2.5 rounded-full flex items-center justify-center">
                        <i class="fa-solid fa-file-signature text-xl text-white"></i>
                    </div>
                    <div>
                        <h2 class="text-base font-black text-white leading-tight">Aprobación de Crédito</h2>
                        <p class="text-[10px] font-bold text-emerald-100 uppercase tracking-wider mt-0.5">Revisión final y autorización</p>
                    </div>
                </div>
                <button id="close-approve-loan-modal" class="text-white/80 hover:text-white text-2xl transition-colors">&times;</button>
            </div>

            <!-- Body -->
            <form id="approve-loan-form" class="modal-body-scroll p-6 space-y-6 bg-slate-50/50">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <!-- Left Column -->
                    <div class="space-y-4">
                        <!-- Applicant Card -->
                        <div class="bg-white border border-slate-200 p-4 rounded-2xl flex items-center gap-3.5 shadow-xs">
                            <div class="w-12 h-12 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-650 font-black text-sm shrink-0">
                                ${getInitials(loan.employeeName)}
                            </div>
                            <div>
                                <span class="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Solicitante</span>
                                <h4 class="text-sm font-black text-slate-800 leading-tight uppercase mt-0.5">${loan.employeeName}</h4>
                            </div>
                        </div>

                        <!-- Original Request Card -->
                        <div class="bg-white border border-slate-200 p-4 rounded-2xl shadow-xs space-y-3 text-left">
                            <div class="border-b border-slate-100 pb-2.5 flex justify-between items-center">
                                <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Solicitud Original</span>
                                <span class="bg-slate-100 text-slate-600 text-[10px] font-black px-2 py-0.5 rounded border border-slate-200">${loan.installments || 1} Cuotas</span>
                            </div>
                            <div class="space-y-2">
                                <p class="text-2xl font-black text-slate-800 tracking-tight">${formatCurrency(loan.amount)}</p>
                                <div class="bg-slate-50 border border-slate-100/70 p-3 rounded-xl text-xs text-slate-500 italic leading-relaxed">
                                    "${loan.reason || 'Sin motivo especificado'}"
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Right Column -->
                    <div class="space-y-4">
                        <!-- Approval Conditions Card -->
                        <div class="bg-emerald-50/20 border border-emerald-100 p-4 rounded-2xl shadow-xs space-y-4 text-left">
                            <div class="flex items-center gap-2 border-b border-emerald-100/50 pb-2.5">
                                <i class="fa-solid fa-gavel text-emerald-600"></i>
                                <span class="text-[9px] font-black text-emerald-700 uppercase tracking-widest">Condiciones de Aprobación</span>
                            </div>
                            <div class="space-y-3">
                                <div>
                                    <label for="approve-loan-final-amount" class="block text-[9px] font-black text-emerald-700 uppercase tracking-wider mb-1.5">Monto Aprobado</label>
                                    <input type="text" id="approve-loan-final-amount" class="w-full border border-emerald-250 rounded-xl p-2.5 text-sm font-mono font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white transition-all text-right" value="${formatCurrency(loan.amount)}">
                                </div>
                                <div>
                                    <label for="approve-loan-final-installments" class="block text-[9px] font-black text-emerald-700 uppercase tracking-wider mb-1.5">Cuotas Finales</label>
                                    <input type="number" id="approve-loan-final-installments" class="w-full border border-emerald-250 rounded-xl p-2.5 text-sm font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white transition-all text-center" value="${loan.installments || 1}" min="1" max="100">
                                </div>
                            </div>
                        </div>

                        <!-- Internal Note -->
                        <div class="space-y-1.5 text-left">
                            <label for="approve-loan-internal-note" class="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Nota Interna (Opcional)</label>
                            <textarea id="approve-loan-internal-note" class="w-full border border-slate-300 rounded-xl p-3 text-xs text-slate-700 placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-white transition-all" rows="2" placeholder="Ej: Aprobado según capacidad de pago..."></textarea>
                        </div>
                    </div>
                </div>

                <!-- Girar A Block -->
                <div class="bg-indigo-50/40 border border-indigo-100 p-3.5 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-left">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0">
                            <i class="fa-solid fa-building-columns text-indigo-650 text-lg"></i>
                        </div>
                        <div>
                            <span class="block text-[8px] font-black text-indigo-400 uppercase tracking-widest">Girar a (Datos Destinatario)</span>
                            <h5 class="text-xs font-bold text-indigo-950 mt-0.5">
                                ${applicant?.bankName || 'No Registrado'} - ${applicant?.accountType || 'Sin Cuenta'}
                            </h5>
                        </div>
                    </div>
                    <div class="flex items-center gap-3">
                        <div class="bg-white border border-indigo-100 rounded-lg px-2.5 py-1.5 flex items-center gap-2 font-mono text-xs font-bold text-indigo-950">
                            <span id="transfer-account-number">${applicant?.accountNumber || 'No registrado'}</span>
                            ${applicant?.accountNumber ? `
                            <button type="button" id="btn-copy-account" class="text-indigo-400 hover:text-indigo-650 transition-colors" title="Copiar número de cuenta">
                                <i class="fa-regular fa-copy"></i>
                            </button>
                            ` : ''}
                        </div>
                    </div>
                </div>

                <!-- Fuente de Pago dropdown inside body -->
                <div class="space-y-1.5 text-left">
                    <label for="approve-loan-payment-method" class="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Fuente de Pago (Caja/Banco origen)</label>
                    <select id="approve-loan-payment-method" class="w-full p-3 border border-slate-300 rounded-xl bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-xs font-bold text-slate-700" required>
                        ${metodosDePagoHTML}
                    </select>
                </div>

                <!-- Footer style buttons -->
                <div class="flex justify-between items-center pt-4 border-t border-slate-200/60 bg-white -mx-6 -mb-6 p-6 rounded-b-2xl shrink-0">
                    <button type="button" id="btn-reject-loan" class="text-rose-600 hover:text-rose-700 font-black text-xs uppercase tracking-wider flex items-center gap-1.5 transition-colors transform active:scale-95">
                        <i class="fa-solid fa-ban text-sm"></i> Rechazar
                    </button>
                    <div class="flex items-center gap-4">
                        <button type="button" id="btn-cancel-approve" class="text-slate-500 hover:text-slate-700 font-black text-xs uppercase tracking-wider transition-colors">
                            Cancelar
                        </button>
                        <button type="submit" id="btn-confirm-approve" class="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-wider px-6 py-3 rounded-xl transition-all shadow-md flex items-center gap-1.5 transform active:scale-95">
                            <i class="fa-solid fa-check text-sm"></i> Aprobar
                        </button>
                    </div>
                </div>
            </form>
        </div>
    `;

    document.getElementById('modal').classList.remove('hidden');

    // Format final amount input
    const finalAmountInput = document.getElementById('approve-loan-final-amount');
    finalAmountInput.addEventListener('input', (e) => {
        formatCurrencyInput(e.target);
    });

    // Copy Account Button
    const btnCopy = document.getElementById('btn-copy-account');
    if (btnCopy) {
        btnCopy.onclick = () => {
            const num = document.getElementById('transfer-account-number').textContent;
            navigator.clipboard.writeText(num);
            if (window.showToast) window.showToast("Número de cuenta copiado.", 'success');
        };
    }

    // Cancel / Close Buttons
    document.getElementById('close-approve-loan-modal').onclick = () => {
        if (fromListModal && typeof showAllLoansModal === 'function') {
            showAllLoansModal(allPendingLoans);
        } else {
            hideModal();
        }
    };
    document.getElementById('btn-cancel-approve').onclick = () => {
        if (fromListModal && typeof showAllLoansModal === 'function') {
            showAllLoansModal(allPendingLoans);
        } else {
            hideModal();
        }
    };

    // Reject Button
    document.getElementById('btn-reject-loan').onclick = () => {
        _openConfirmModal("¿Está seguro de que desea rechazar y eliminar esta solicitud de préstamo?", () => {
            handleLoanAction(loan.id, 'denegado');
        });
    };

    // Submit Form (Approve)
    document.getElementById('approve-loan-form').onsubmit = (e) => {
        e.preventDefault();
        const paymentMethod = document.getElementById('approve-loan-payment-method').value;
        const finalInstallments = parseInt(document.getElementById('approve-loan-final-installments').value) || 1;
        const approvedAmount = unformatCurrency(finalAmountInput.value);
        const internalNote = document.getElementById('approve-loan-internal-note').value;

        handleApproveLoan(loan, paymentMethod, finalInstallments, approvedAmount, internalNote);
    };
}

async function handleApproveLoan(loan, paymentMethod, installments, approvedAmount, internalNote) {
    showModalMessage("Procesando aprobación...", true);
    try {
        const approvalDate = new Date();
        const dateString = approvalDate.toISOString().split('T')[0];

        const finalAmount = approvedAmount !== undefined ? approvedAmount : loan.amount;

        const nuevoGasto = {
            fecha: dateString,
            proveedorId: loan.employeeId,
            proveedorNombre: `Préstamo Aprobado: ${loan.employeeName}`,
            numeroFactura: `Préstamo RRHH`,
            valorTotal: finalAmount,
            fuentePago: paymentMethod,
            registradoPor: currentUser.uid,
            timestamp: Date.now(),
            isLoanAdvance: true,
            _lastUpdated: serverTimestamp()
        };
        await addDoc(collection(db, "gastos"), nuevoGasto);

        const nuevoPago = {
            motivo: `Préstamo: ${loan.reason.substring(0, 30)}`,
            valor: finalAmount,
            fecha: dateString,
            fuentePago: paymentMethod,
            timestamp: approvalDate.toISOString()
        };

        const batch = writeBatch(db);
        const loanDocRef = doc(db, "prestamos", loan.id);
        batch.update(loanDocRef, {
            status: 'aprobado',
            paymentMethod: paymentMethod,
            aprobadoBy: currentUser.uid,
            aprobadoDate: dateString,
            installments: installments,
            approvedAmount: finalAmount,
            internalNote: internalNote || ''
        });

        const userLoanRef = doc(collection(db, "users", loan.employeeId, "loans"), loan.id);
        batch.set(userLoanRef, {
            amount: finalAmount,
            balance: finalAmount,
            description: loan.reason,
            installments: installments,
            date: dateString,
            status: 'active',
            createdAt: serverTimestamp(),
            createdBy: currentUser.uid,
            internalNote: internalNote || ''
        });

        const userRef = doc(db, "users", loan.employeeId);
        batch.update(userRef, {
            pagos: arrayUnion(nuevoPago),
            _lastUpdated: serverTimestamp()
        });

        const empleadoAfectado = allUsers.find(u => u.id === loan.employeeId);
        if (empleadoAfectado) {
            if (!empleadoAfectado.pagos) empleadoAfectado.pagos = [];
            empleadoAfectado.pagos.push(nuevoPago);
            empleadoAfectado._lastUpdated = Date.now();
            updateLocalCache(empleadoAfectado);
        }

        await batch.commit();
        hideModal();
        if (window.showToast) window.showToast("Préstamo aprobado y registrado.", 'success');
        else showTemporaryMessage("Préstamo aprobado y registrado.", 'success');
    } catch (error) {
        console.error("Error al aprobar préstamo:", error);
        hideModal();
        showModalMessage("Error al procesar la aprobación.");
    }
}

async function handleLoanAction(loanId, action) {
    if (action === 'aprobado') return;

    showModalMessage("Actualizando préstamo...", true);
    try {
        if (action === 'denegado') {
            await deleteDoc(doc(db, "prestamos", loanId));
            showModalMessage("Préstamo denegado y eliminado.", false, 2000);
        } else {
            await updateDoc(doc(db, "prestamos", loanId), {
                status: action,
                [`${action}By`]: currentUser.uid,
                [`${action}Date`]: new Date().toISOString().split('T')[0]
            });
            showModalMessage(`Préstamo marcado como ${action}.`, false, 2000);
        }
    } catch (error) {
        console.error(`Error al ${action} el préstamo:`, error);
        showModalMessage("Error al actualizar el estado del préstamo.");
    }
}

export function setupEmpleadosEvents() {
    if (window.__setupEmpleadosEventsInit) return;
    window.__setupEmpleadosEventsInit = true;

    document.addEventListener('click', (e) => {
        const settingsBtn = e.target.closest('#payroll-config-settings-btn');
        if (settingsBtn) {
            e.preventDefault();
            showPayrollConfigModal();
        }
    });

    const loanRequestBtn = document.getElementById('loan-request-btn');
    if (loanRequestBtn) {
        loanRequestBtn.addEventListener('click', showLoanRequestModal);
    }

    const viewAllLoansBtn = document.getElementById('view-all-loans-btn');
    if (viewAllLoansBtn) {
        viewAllLoansBtn.addEventListener('click', () => { showAllLoansModal(allPendingLoans); });
    }
}

export function cleanupEmpleadosListeners() {
    if (unsubscribeMyLoans) {
        try {
            unsubscribeMyLoans();
        } catch (e) {
            console.warn("Error al desuscribir préstamos personales:", e);
        }
        unsubscribeMyLoans = null;
    }
}

async function showPayrollConfigModal() {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    if (!modalContentWrapper) return;

    showModalMessage("Cargando configuración...", true);
    
    try {
        const configDoc = await getDoc(doc(_db, "config", "payroll"));
        const config = configDoc.exists() ? configDoc.data() : {
            salarioMinimo: 1300000,
            auxilioTransporte: 249095,
            porcentajeSalud: 4,
            porcentajePension: 4,
            multiplicadorHoraExtra: 1.25
        };
        
        hideModal(); // oculta el mensaje de carga

        modalContentWrapper.innerHTML = `
            <div class="modal-card max-w-md w-full mx-auto" style="height: auto; max-height: 85vh;">
                <div class="modal-header-fixed bg-indigo-650 text-white rounded-t-2xl p-4 flex justify-between items-center">
                    <h2 class="text-lg font-bold flex items-center gap-2">
                        <i class="fa-solid fa-gear"></i> Configuración de Nómina y Ley
                    </h2>
                    <button id="close-payroll-config-modal" class="text-white hover:text-indigo-200 text-3xl font-bold leading-none">&times;</button>
                </div>
                <form id="payroll-config-form" class="modal-body-scroll p-6 space-y-4">
                    <div>
                        <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Salario Mínimo Mensual (COP)</label>
                        <input type="text" id="config-salario-minimo" class="w-full p-2.5 border border-slate-300 rounded-xl bg-white shadow-xs focus:ring-2 focus:ring-indigo-500 text-sm font-semibold" value="${formatCurrency(config.salarioMinimo)}" required>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Auxilio de Transporte Mensual (COP)</label>
                        <input type="text" id="config-auxilio-transporte" class="w-full p-2.5 border border-slate-300 rounded-xl bg-white shadow-xs focus:ring-2 focus:ring-indigo-500 text-sm font-semibold" value="${formatCurrency(config.auxilioTransporte)}" required>
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Pensión Empleado (%)</label>
                            <input type="number" step="0.1" id="config-pension" class="w-full p-2.5 border border-slate-300 rounded-xl bg-white shadow-xs focus:ring-2 focus:ring-indigo-500 text-sm font-semibold" value="${config.porcentajePension || 4}" required>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Salud Empleado (%)</label>
                            <input type="number" step="0.1" id="config-salud" class="w-full p-2.5 border border-slate-300 rounded-xl bg-white shadow-xs focus:ring-2 focus:ring-indigo-500 text-sm font-semibold" value="${config.porcentajeSalud || 4}" required>
                        </div>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Recargo Hora Extra Diurna (Factor)</label>
                        <input type="number" step="0.01" id="config-horas-extra" class="w-full p-2.5 border border-slate-300 rounded-xl bg-white shadow-xs focus:ring-2 focus:ring-indigo-500 text-sm font-semibold" value="${config.multiplicadorHoraExtra || 1.25}" required>
                        <p class="text-[10px] text-gray-400 mt-1">Ejemplo: 1.25 indica 25% de recargo sobre el valor de la hora ordinaria.</p>
                    </div>
                    <button type="submit" class="w-full bg-indigo-650 hover:bg-indigo-755 text-white font-bold py-3 rounded-xl transition-colors shadow-xs mt-2">Guardar Configuración</button>
                </form>
            </div>
        `;

        document.getElementById('modal').classList.remove('hidden');
        document.getElementById('close-payroll-config-modal').addEventListener('click', hideModal);

        // Formatear inputs de dinero en tiempo real
        const salarioMinimoInput = document.getElementById('config-salario-minimo');
        const auxilioTransporteInput = document.getElementById('config-auxilio-transporte');

        salarioMinimoInput.addEventListener('input', (e) => formatCurrencyInput(e.target));
        auxilioTransporteInput.addEventListener('input', (e) => formatCurrencyInput(e.target));

        document.getElementById('payroll-config-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const newConfig = {
                salarioMinimo: unformatCurrency(salarioMinimoInput.value),
                auxilioTransporte: unformatCurrency(auxilioTransporteInput.value),
                porcentajePension: parseFloat(document.getElementById('config-pension').value) || 4,
                porcentajeSalud: parseFloat(document.getElementById('config-salud').value) || 4,
                multiplicadorHoraExtra: parseFloat(document.getElementById('config-horas-extra').value) || 1.25,
                _lastUpdated: serverTimestamp()
            };

            showModalMessage("Guardando configuración...", true);
            try {
                await setDoc(doc(_db, "config", "payroll"), newConfig);
                hideModal();
                showTemporaryMessage("Configuración de nómina guardada exitosamente.", "success");
            } catch (error) {
                console.error("Error al guardar configuración:", error);
                hideModal();
                showTemporaryMessage("Error al guardar la configuración: " + error.message, "error");
            }
        });

    } catch (error) {
        console.error("Error al cargar configuración:", error);
        hideModal();
        showTemporaryMessage("Error al cargar la configuración: " + error.message, "error");
    }
}