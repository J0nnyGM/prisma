import { currentUserData } from './main.js';
import { showDashboardModal, showEditProfileModal, showLoanRequestModal } from './empleados.js';

const ALL_MODULES = ['remisiones', 'facturacion', 'clientes', 'items', 'colores', 'gastos', 'proveedores', 'empleados'];

const viewTemplates = {
    remisiones: `
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
            <div id="remision-form-container" class="lg:col-span-1 bg-white p-6 rounded-xl shadow-md">
                <h2 class="text-xl font-semibold mb-4">Nueva Remisión</h2>
                <form id="remision-form" class="space-y-4">
                    <div class="relative">
                        <input type="text" id="cliente-search-input" autocomplete="off" placeholder="Buscar y seleccionar cliente..." class="w-full p-3 border border-gray-300 rounded-lg" required>
                        <input type="hidden" id="cliente-id-hidden" name="clienteId">
                        <div id="cliente-search-results" class="search-results hidden"></div>
                    </div>
                    <div>
                        <label for="fecha-recibido" class="block text-sm font-medium text-gray-700">Fecha Recibido</label>
                        <input type="date" id="fecha-recibido" class="w-full p-3 border border-gray-300 rounded-lg mt-1 bg-gray-100" readonly>
                    </div>
                    <div class="border-t border-b border-gray-200 py-4">
                        <h3 class="text-lg font-semibold mb-2">Ítems de la Remisión</h3>
                        <div id="items-container" class="space-y-4"></div>
                        <button type="button" id="add-item-btn" class="mt-4 w-full bg-gray-200 text-gray-700 font-semibold py-2 px-4 rounded-lg hover:bg-gray-300 transition-colors">+ Añadir Ítem</button>
                    </div>
                    <select id="forma-pago" class="w-full p-3 border border-gray-300 rounded-lg bg-white" required>
                        <option value="" disabled selected>Forma de Pago</option>
                        <option value="Pendiente">Pendiente</option>
                        <option value="Efectivo">Efectivo</option>
                        <option value="Nequi">Nequi</option>
                        <option value="Davivienda">Davivienda</option>
                    </select>
                    <div class="bg-gray-50 p-4 rounded-lg space-y-2">
                        <div class="flex justify-between items-center"><span class="font-medium">Subtotal:</span><span id="subtotal" class="font-bold text-lg">$ 0</span></div>
                        <div class="flex justify-between items-center">
                            <label for="incluir-iva" class="flex items-center space-x-2 cursor-pointer">
                                <input type="checkbox" id="incluir-iva" class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500">
                                <span>Incluir IVA (19%)</span>
                            </label>
                            <span id="valor-iva" class="font-medium text-gray-600">$ 0</span>
                        </div>
                        <hr>
                        <div class="flex justify-between items-center text-xl"><span class="font-bold">TOTAL:</span><span id="valor-total" class="font-bold text-indigo-600">$ 0</span></div>
                    </div>
                    <button type="submit" class="w-full bg-indigo-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-indigo-700 transition-colors">Guardar y Enviar Remisión</button>
                </form>
            </div>
            <div id="remisiones-list-container" class="lg:col-span-2 bg-white p-6 rounded-xl shadow-md">
                <div class="flex flex-col sm:flex-row justify-between sm:items-center mb-4 flex-wrap gap-4">
                    <h2 class="text-xl font-semibold">Historial de Remisiones</h2>
                    <div class="flex items-center gap-2 flex-wrap w-full">
                        <select id="filter-remisiones-month" class="p-2 border rounded-lg bg-white"></select>
                        <select id="filter-remisiones-year" class="p-2 border rounded-lg bg-white"></select>
                        <input type="search" id="search-remisiones" placeholder="Buscar..." class="p-2 border rounded-lg flex-grow">
                    </div>
                </div>
                <div id="remisiones-list" class="space-y-3"><p id="loading-remisiones" class="text-center text-gray-500 py-8">Cargando...</p></div>
            </div>
        </div>`,
    facturacion: `
        <div class="bg-white p-6 rounded-xl shadow-md max-w-6xl mx-auto">
            <h2 class="text-2xl font-semibold mb-4">Gestión de Facturación</h2>
            <div class="border-b border-gray-200 mb-6">
                <nav id="facturacion-nav" class="-mb-px flex space-x-6">
                    <button id="tab-pendientes" class="dashboard-tab-btn active py-3 px-1 font-semibold">Pendientes</button>
                    <button id="tab-realizadas" class="dashboard-tab-btn py-3 px-1 font-semibold">Realizadas</button>
                </nav>
            </div>
            <div id="view-pendientes">
                <h3 class="text-xl font-semibold text-gray-800 mb-4">Remisiones Pendientes de Facturar</h3>
                <div id="facturacion-pendientes-list" class="space-y-3"></div>
            </div>
            <div id="view-realizadas" class="hidden">
                <h3 class="text-xl font-semibold text-gray-800 mb-4">Remisiones Facturadas</h3>
                <div id="facturacion-realizadas-list" class="space-y-3"></div>
            </div>
        </div>`,
    clientes: `
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
            <div class="lg:col-span-1 bg-white p-6 rounded-xl shadow-md">
                <h2 class="text-xl font-semibold mb-4">Añadir Nuevo Cliente</h2>
                <form id="add-cliente-form" class="space-y-4">
                    <input type="text" id="nuevo-cliente-nombre" placeholder="Nombre Completo" class="w-full p-3 border border-gray-300 rounded-lg" required>
                    <input type="email" id="nuevo-cliente-email" placeholder="Correo Electrónico" class="w-full p-3 border border-gray-300 rounded-lg" required>
                    <input type="tel" id="nuevo-cliente-telefono1" placeholder="Teléfono 1" class="w-full p-3 border border-gray-300 rounded-lg" required>
                    <input type="tel" id="nuevo-cliente-telefono2" placeholder="Teléfono 2 (Opcional)" class="w-full p-3 border border-gray-300 rounded-lg">
                    <input type="text" id="nuevo-cliente-nit" placeholder="NIT (Opcional)" class="w-full p-3 border border-gray-300 rounded-lg">
                    <button type="submit" class="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-700 transition-colors">Registrar Cliente</button>
                </form>
            </div>
            <div class="lg:col-span-2 bg-white p-6 rounded-xl shadow-md">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-xl font-semibold">Clientes Registrados</h2>
                    <input type="search" id="search-clientes" placeholder="Buscar cliente..." class="p-2 border rounded-lg">
                </div>
                <div id="clientes-list" class="space-y-3"><p id="loading-clientes" class="text-center text-gray-500 py-8">Cargando...</p></div>
            </div>
        </div>`,
    proveedores: `
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
            <div class="lg:col-span-1 bg-white p-6 rounded-xl shadow-md">
                <h2 class="text-xl font-semibold mb-4">Añadir Nuevo Proveedor</h2>
                <form id="add-proveedor-form" class="space-y-4">
                    <input type="text" id="nuevo-proveedor-nombre" placeholder="Nombre del Proveedor" class="w-full p-3 border border-gray-300 rounded-lg" required>
                    <input type="text" id="nuevo-proveedor-contacto" placeholder="Nombre de Contacto (Opcional)" class="w-full p-3 border border-gray-300 rounded-lg">
                    <input type="tel" id="nuevo-proveedor-telefono" placeholder="Teléfono" class="w-full p-3 border border-gray-300 rounded-lg">
                    <input type="email" id="nuevo-proveedor-email" placeholder="Correo Electrónico" class="w-full p-3 border border-gray-300 rounded-lg">
                    <button type="submit" class="w-full bg-teal-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-teal-700 transition-colors">Registrar Proveedor</button>
                </form>
            </div>
            <div class="lg:col-span-2 bg-white p-6 rounded-xl shadow-md">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-xl font-semibold">Proveedores Registrados</h2>
                    <input type="search" id="search-proveedores" placeholder="Buscar proveedor..." class="p-2 border rounded-lg">
                </div>
                <div id="proveedores-list" class="space-y-3"><p id="loading-proveedores" class="text-center text-gray-500 py-8">Cargando...</p></div>
            </div>
        </div>`,
    items: `
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
            <div class="lg:col-span-1 bg-white p-6 rounded-xl shadow-md">
                <h2 class="text-xl font-semibold mb-4">Añadir Nuevo Ítem</h2>
                <form id="add-item-form" class="space-y-4">
                    <input type="text" id="nuevo-item-ref" placeholder="Referencia (ej. P-001)" class="w-full p-3 border border-gray-300 rounded-lg" required>
                    <input type="text" id="nuevo-item-desc" placeholder="Descripción del Ítem o Servicio" class="w-full p-3 border border-gray-300 rounded-lg" required>
                    <button type="submit" class="w-full bg-green-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-green-700 transition-colors">Registrar Ítem</button>
                </form>
            </div>
            <div class="lg:col-span-2 bg-white p-6 rounded-xl shadow-md">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-xl font-semibold">Catálogo de Ítems</h2>
                    <input type="search" id="search-items" placeholder="Buscar por ref. o desc..." class="p-2 border rounded-lg">
                </div>
                <div id="items-list" class="space-y-3"><p id="loading-items" class="text-center text-gray-500 py-8">Cargando...</p></div>
            </div>
        </div>`,
    colores: `
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
            <div class="lg:col-span-1 bg-white p-6 rounded-xl shadow-md">
                <h2 class="text-xl font-semibold mb-4">Añadir Nuevo Color</h2>
                <form id="add-color-form" class="space-y-4">
                    <input type="text" id="nuevo-color-nombre" placeholder="Nombre del Color (ej. RAL 7016)" class="w-full p-3 border border-gray-300 rounded-lg" required>
                    <button type="submit" class="w-full bg-purple-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-purple-700 transition-colors">Registrar Color</button>
                </form>
            </div>
            <div class="lg:col-span-2 bg-white p-6 rounded-xl shadow-md">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-xl font-semibold">Catálogo de Colores</h2>
                    <input type="search" id="search-colores" placeholder="Buscar color..." class="p-2 border rounded-lg">
                </div>
                <div id="colores-list" class="space-y-3"><p id="loading-colores" class="text-center text-gray-500 py-8">Cargando...</p></div>
            </div>
        </div>`,
    gastos: `
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
            <div class="lg:col-span-1 bg-white p-6 rounded-xl shadow-md">
                <h2 class="text-xl font-semibold mb-4">Nuevo Gasto</h2>
                <form id="add-gasto-form" class="space-y-4">
                    <div><label for="gasto-fecha">Fecha</label><input type="date" id="gasto-fecha" class="w-full p-3 border border-gray-300 rounded-lg mt-1" required></div>
                    <div class="relative">
                        <label for="proveedor-search-input">Proveedor</label>
                        <input type="text" id="proveedor-search-input" autocomplete="off" placeholder="Buscar proveedor..." class="w-full p-3 border border-gray-300 rounded-lg mt-1" required>
                        <input type="hidden" id="proveedor-id-hidden" name="proveedorId">
                        <div id="proveedor-search-results" class="search-results hidden"></div>
                    </div>
                    <input type="text" id="gasto-factura" placeholder="N° de Factura (Opcional)" class="w-full p-3 border border-gray-300 rounded-lg">
                    <input type="text" id="gasto-valor-total" inputmode="numeric" placeholder="Valor Total" class="w-full p-3 border border-gray-300 rounded-lg" required>
                    <label class="flex items-center space-x-2"><input type="checkbox" id="gasto-iva" class="h-4 w-4 rounded border-gray-300"><span>IVA del 19% ya está incluido en el valor total</span></label>
                    <div>
                        <label for="gasto-fuente">Fuente del Pago</label>
                        <select id="gasto-fuente" class="w-full p-3 border border-gray-300 rounded-lg mt-1 bg-white" required>
                            <option value="Efectivo">Efectivo</option>
                            <option value="Nequi">Nequi</option>
                            <option value="Davivienda">Davivienda</option>
                        </select>
                    </div>
                    <button type="submit" class="w-full bg-orange-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-orange-700">Registrar Gasto</button>
                </form>
            </div>
            <div class="lg:col-span-2 bg-white p-6 rounded-xl shadow-md">
                <div class="flex justify-between items-center mb-4 flex-wrap gap-2">
                    <h2 class="text-xl font-semibold">Historial de Gastos</h2>
                    <div class="flex items-center gap-2">
                        <select id="filter-gastos-month" class="p-2 border rounded-lg bg-white"></select>
                        <select id="filter-gastos-year" class="p-2 border rounded-lg bg-white"></select>
                        <input type="search" id="search-gastos" placeholder="Buscar..." class="p-2 border rounded-lg w-40">
                    </div>
                </div>
                <div id="gastos-list" class="space-y-3"><p id="loading-gastos" class="text-center text-gray-500 py-8">Cargando...</p></div>
            </div>
        </div>`,
    empleados: `
        <div class="bg-white p-6 rounded-xl shadow-md max-w-4xl mx-auto">
            <h2 class="text-xl font-semibold mb-4">Gestión de Empleados</h2>
            <div id="empleados-list" class="space-y-3"></div>
        </div>`
};

export function injectHTMLTemplates() {
    for (const viewName in viewTemplates) {
        const viewContainer = document.getElementById(`view-${viewName}`);
        if (viewContainer) {
            viewContainer.innerHTML = viewTemplates[viewName];
        }
    }
}

export function setupUIEventListeners() {
    const tabs = { 
        remisiones: document.getElementById('tab-remisiones'), 
        facturacion: document.getElementById('tab-facturacion'), 
        clientes: document.getElementById('tab-clientes'), 
        items: document.getElementById('tab-items'), 
        colores: document.getElementById('tab-colores'), 
        gastos: document.getElementById('tab-gastos'), 
        proveedores: document.getElementById('tab-proveedores'), 
        empleados: document.getElementById('tab-empleados') 
    };
    const views = { 
        remisiones: document.getElementById('view-remisiones'), 
        facturacion: document.getElementById('view-facturacion'), 
        clientes: document.getElementById('view-clientes'), 
        items: document.getElementById('view-items'), 
        colores: document.getElementById('view-colores'), 
        gastos: document.getElementById('view-gastos'), 
        proveedores: document.getElementById('view-proveedores'), 
        empleados: document.getElementById('view-empleados') 
    };

    Object.keys(tabs).forEach(key => {
        if(tabs[key]) {
            tabs[key].addEventListener('click', () => switchView(key, tabs, views));
        }
    });

    document.getElementById('summary-btn').addEventListener('click', showDashboardModal);
    document.getElementById('edit-profile-btn').addEventListener('click', showEditProfileModal);
    document.getElementById('loan-request-btn').addEventListener('click', showLoanRequestModal);
}

export function switchView(viewName, tabs, views) {
    Object.values(tabs).forEach(tab => { if(tab) tab.classList.remove('active') });
    Object.values(views).forEach(view => { if(view) view.classList.add('hidden') });
    if(tabs[viewName]) tabs[viewName].classList.add('active');
    if(views[viewName]) views[viewName].classList.remove('hidden');
}

export function updateUIVisibility(userData) {
    const nav = document.getElementById('main-nav');
    if (!userData || !nav) return;

    const permissions = userData.permissions || {};
    const isAdmin = userData.role && userData.role.toLowerCase() === 'admin';

    ALL_MODULES.forEach(module => {
        const tab = document.getElementById(`tab-${module}`);
        if (tab) {
            let hasPermission = isAdmin || permissions[module];
            if (module === 'empleados') {
                hasPermission = isAdmin;
            }
            
            if (hasPermission) {
                tab.classList.remove('hidden');
            } else {
                tab.classList.add('hidden');
            }
        }
    });
    
    const summaryBtn = document.getElementById('summary-btn');
    if(summaryBtn) {
        if (isAdmin) {
            summaryBtn.classList.remove('hidden');
        } else {
            summaryBtn.classList.add('hidden');
        }
    }
}

let modalTimeout;
export function showModalMessage(message, isLoader = false, duration = 0) {
    const modal = document.getElementById('modal');
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    modalContentWrapper.innerHTML = `<div id="modal-content" class="bg-white rounded-lg p-6 shadow-xl max-w-sm w-full mx-auto text-center"></div>`;
    const modalContent = document.getElementById('modal-content');
    clearTimeout(modalTimeout);

    let contentHTML = '';
    if (isLoader) {
        contentHTML = `<svg class="animate-spin h-8 w-8 text-indigo-600 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><p class="mt-4 text-gray-700 font-semibold">${message}</p>`;
    } else {
        contentHTML = `<p class="text-gray-800 font-semibold mb-4">${message}</p>`;
        if (duration === 0) {
            contentHTML += `<button id="close-message-modal-btn" class="w-full bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-indigo-700">Cerrar</button>`;
        }
    }
    
    modalContent.innerHTML = contentHTML;
    modal.classList.remove('hidden');

    if (duration > 0) {
        modalTimeout = setTimeout(hideModal, duration);
    } else if (!isLoader) {
        const closeBtn = document.getElementById('close-message-modal-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', hideModal);
        }
    }
}

export function hideModal() {
    const modal = document.getElementById('modal');
    modal.classList.add('hidden');
}

export function formatCurrency(value) { 
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(value); 
}

export function unformatCurrency(value) {
    if (typeof value !== 'string') return parseFloat(value) || 0;
    return parseFloat(value.replace(/[^0-9]/g, '')) || 0;
}

export function populateDateFilters(prefix) {
    const monthSelect = document.getElementById(`${prefix}-month`);
    const yearSelect = document.getElementById(`${prefix}-year`);
    if (!monthSelect || !yearSelect) return;

    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    
    monthSelect.innerHTML = '<option value="all">Todos los Meses</option>';
    for (let i = 0; i < 12; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = monthNames[i];
        monthSelect.appendChild(option);
    }

    yearSelect.innerHTML = '<option value="all">Todos los Años</option>';
    const currentYear = new Date().getFullYear();
    for (let i = 0; i < 5; i++) {
        const year = currentYear - i;
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        yearSelect.appendChild(option);
    }
}

export function showPdfModal(pdfUrl, title) {
    const modalContentWrapper = document.getElementById('modal-content-wrapper');
    modalContentWrapper.innerHTML = `
        <div class="bg-white rounded-lg shadow-xl w-full max-w-6xl mx-auto flex flex-col" style="height: 80vh;">
            <div class="flex justify-between items-center p-4 border-b">
                <h2 class="text-xl font-semibold">Visor: ${title}</h2>
                <button id="close-pdf-modal" class="text-gray-500 hover:text-gray-800 text-3xl">&times;</button>
            </div>
            <div class="flex-grow p-2 bg-gray-200">
                <iframe id="pdf-iframe" src="${pdfUrl}" class="w-full h-full" frameborder="0" allow="fullscreen"></iframe>
            </div>
        </div>`;
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('close-pdf-modal').addEventListener('click', hideModal);
}

export function initSearchableInput(inputElement, resultsContainer, getData, displayFn, onSelect) {
    inputElement.addEventListener('input', () => {
        const searchTerm = inputElement.value.toLowerCase();
        const data = getData();
        const filtered = data.filter(item => displayFn(item).toLowerCase().includes(searchTerm));
        
        resultsContainer.innerHTML = '';
        if (filtered.length > 0 && searchTerm) {
            resultsContainer.classList.remove('hidden');
            filtered.forEach(item => {
                const div = document.createElement('div');
                div.className = 'search-result-item';
                div.textContent = displayFn(item);
                div.addEventListener('click', () => {
                    inputElement.value = displayFn(item);
                    onSelect(item);
                    resultsContainer.classList.add('hidden');
                });
                resultsContainer.appendChild(div);
            });
        } else {
            resultsContainer.classList.add('hidden');
        }
    });

    document.addEventListener('click', (e) => {
        if (!inputElement.contains(e.target) && !resultsContainer.contains(e.target)) {
            resultsContainer.classList.add('hidden');
        }
    });
}

export function autoFormatCurrency(event) {
    const input = event.target;
    let value = input.value.replace(/[^0-9]/g, '');
    if (value) {
        value = parseInt(value, 10);
        input.value = formatCurrency(value);
    } else {
        input.value = '';
    }
}
